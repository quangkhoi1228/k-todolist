/**
 * Sync queue ĐA NỀN TẢNG — Teams & Zalo chạy SONG SONG.
 *
 * Kiến trúc (xem `docs/dual-platform-sync-queue.md`):
 * - Mỗi platform có worker RIÊNG + queue RIÊNG + lock file RIÊNG.
 * - Trong 1 platform: task tuần tự (Chrome profile chỉ cho 1 instance).
 * - Giữa 2 platform: song song hoàn toàn (profile khác nhau).
 * - KHÔNG cancel sync-all khi mở project — chỉ xen kẽ (interleave): task
 *   project được chèn lên đầu queue, task sync-all đang chạy xong tự nhiên
 *   (~15s) rồi worker lấy task project.
 * - Cooldown 3 phút sau khi sync xong project — trong khoảng nghỉ, sync-all
 *   được chạy tiếp (chống starvation: sync-all không bao giờ bị hủy).
 *
 * Tương thích ngược: routes/UI vẫn gọi `enqueueJob()` như cũ — queue tự chia
 * task theo `platform` vào đúng worker. `getSyncQueueStatus()` gộp 2 worker
 * cho UI cũ; thêm `teamsWorker`/`zaloWorker` chi tiết + `currentTasks` (plural).
 */

import { spawn } from "child_process";
import path from "path";
import fs from "fs";

// ─── Repo imports (dùng trong trigger tóm tắt sau mỗi task sync) ───
import { getLatestLogByProjectChat } from "./repo/syncLogs";
import { getProject } from "./repo/projects";
import { getLatestSummary } from "./repo/projectSummaries";

// ─── Types ───────────────────────────────────────────────────
export interface ChatTask {
  projectId: string;
  chatName: string;
  platform: "teams" | "zalo";
  syncMode?: "incremental" | "full";
}

export interface SyncJob {
  id: string;
  label: string;
  type: "project" | "all" | "single";
  projectId?: string;
  chatTasks: ChatTask[];
  createdAt: number;
  /** Nhóm các job được tạo trong cùng 1 lần enqueue (vd sync-all tách
   *  thành 2 job Teams + Zalo — cùng jobGroupId để UI gộp progress). */
  jobGroupId?: string;
}

export type Platform = "teams" | "zalo";

// ─── Cấu hình ─────────────────────────────────────────────────
const LOCK_FILES: Record<Platform, string> = {
  teams: path.join(process.cwd(), ".teams-sync-running"),
  zalo: path.join(process.cwd(), ".zalo-sync-running"),
};
const SEND_LOCK_FILES: Record<Platform, string> = {
  teams: path.join(process.cwd(), ".teams-send-running"),
  zalo: path.join(process.cwd(), ".zalo-send-running"),
};
const WORKER_LOCK_FILES: Record<Platform, string> = {
  teams: path.join(process.cwd(), ".sync-queue-teams-worker.lock"),
  zalo: path.join(process.cwd(), ".sync-queue-zalo-worker.lock"),
};
const QUEUE_STATE_FILE = path.join(process.cwd(), ".sync-queue-state.json");

/** Cooldown cho project sync: sau khi sync xong tất cả nhóm của 1 project
 *  trên 1 platform, nghỉ 3 phút trước khi sync lại platform đó. */
const PROJECT_SYNC_COOLDOWN_MS = 3 * 60 * 1000;

// ─── State per platform ───────────────────────────────────────
interface PlatformWorkerState {
  queue: SyncJob[];
  currentJob: SyncJob | null;
  currentTask: ChatTask | null;
  taskStatuses: Record<string, TaskStatus>;
  jobStartTime: number;
  taskIndexInJob: number;
  refetchTasks: ChatTask[];
  runningChildren: Set<ReturnType<typeof spawn>>;
  workerStarted: boolean;
  isWorkerActive: boolean;
}

function createEmptyWorkerState(): PlatformWorkerState {
  return {
    queue: [],
    currentJob: null,
    currentTask: null,
    taskStatuses: {},
    jobStartTime: 0,
    taskIndexInJob: 0,
    refetchTasks: [],
    runningChildren: new Set(),
    workerStarted: false,
    isWorkerActive: false,
  };
}

const workers: Record<Platform, PlatformWorkerState> = {
  teams: createEmptyWorkerState(),
  zalo: createEmptyWorkerState(),
};

// ─── Shared state (không tách) ───────────────────────────────
let activeProjectId: string | null = null;
let currentRunnerUserId = "";
const userIds: Record<string, string> = {}; // projectId → userId (đúng user khi chạy từng group)

/** Cooldown tracker: key = `${platform}:${projectId}` → timestamp khi
 *  project sync xong trên platform đó. */
const lastProjectSyncDoneAt: Record<string, number> = {};

export type TaskStatus = "pending" | "running" | "done" | "skipped";

// ─── Helpers ─────────────────────────────────────────────────

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

/** Key định danh 1 task (1 nhóm chat) — dùng để gộp các task tương tự. */
function taskKey(task: ChatTask): string {
  return `${task.projectId}|${task.chatName}|${task.platform}`;
}

function taskInfo(task: ChatTask): string {
  return `[Project ${task.projectId}] "${task.chatName}" (${task.platform}, ${task.syncMode || "incremental"})`;
}

/** Trạng thái của task thứ i trong job (mặc định pending nếu chưa ghi nhận). */
function statusOfTask(state: PlatformWorkerState, job: SyncJob, i: number): TaskStatus {
  return state.taskStatuses[taskKey(job.chatTasks[i])] || "pending";
}

// ─── Lock file per platform ──────────────────────────────────
// Mỗi lock file chứa NHIỀU PID (mỗi script con 1 dòng) vì queue có thể
// chạy song song trong CDP mode. Format cũ (1 PID) vẫn tương thích.

function readRunningPids(platform: Platform): number[] {
  try {
    const file = LOCK_FILES[platform];
    if (!fs.existsSync(file)) return [];
    const content = fs.readFileSync(file, "utf-8");
    return content.split("\n").map(l => l.trim()).filter(Boolean).map(l => parseInt(l, 10)).filter(p => !isNaN(p));
  } catch {
    return [];
  }
}

/** Ghi lock file với danh sách PID con đang chạy. */
function writeRunningPids(platform: Platform, pids: number[]): void {
  try {
    const file = LOCK_FILES[platform];
    const unique = Array.from(new Set(pids.filter(p => p > 0)));
    if (unique.length === 0) {
      try { fs.unlinkSync(file); } catch { /* ignore */ }
    } else {
      fs.writeFileSync(file, unique.join("\n") + "\n", "utf-8");
    }
  } catch { /* ignore */ }
}

/** Có PID nào trong lock file của platform còn sống không. */
function hasLiveRunningPids(platform: Platform): boolean {
  return readRunningPids(platform).some(p => pidAlive(p));
}

/**
 * Đang có sync/send nào đang giữ Chrome profile của platform không.
 * Mỗi worker chỉ check lock của ĐÚNG platform mình — không cross-check
 * (2 platform dùng Chrome profile khác nhau, không xung đột).
 */
function isSyncRunning(platform: Platform): boolean {
  if (hasLiveRunningPids(platform)) return true;
  const sendFile = SEND_LOCK_FILES[platform];
  try {
    if (fs.existsSync(sendFile)) {
      const pid = parseInt(fs.readFileSync(sendFile, "utf-8").trim(), 10);
      if (!isNaN(pid) && pidAlive(pid)) return true;
    }
  } catch { /* ignore */ }
  return false;
}

/**
 * Wrapper tương thích ngược — check CẢ 2 platform. Dùng cho UI/scheduler
 * cần biết tổng quan có sync nào đang chạy không. Worker loop KHÔNG dùng
 * hàm này — dùng `isSyncRunning(platform)` để chỉ check đúng platform.
 */
export function isAnySyncRunning(): boolean {
  return isSyncRunning("teams") || isSyncRunning("zalo");
}

/** Atomic lock của worker — 2 next-server không thể cùng làm worker cho
 *  cùng 1 platform. Mỗi platform có lock riêng để 2 worker chạy song song. */
function acquireWorkerLock(platform: Platform): boolean {
  try {
    const file = WORKER_LOCK_FILES[platform];
    const fd = fs.openSync(file, "wx");
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

function releaseWorkerLock(platform: Platform) {
  try { fs.unlinkSync(WORKER_LOCK_FILES[platform]); } catch { /* ignore */ }
}

// ─── State file ──────────────────────────────────────────────
// GIỮ 1 file duy nhất — chỉ lưu shared state (activeProjectId). Worker
// KHÔNG ghi file này trong mỗi task (tránh 2 worker ghi đè nhau). Scheduler
// / UI đọc activeProjectId từ đây.

function saveSharedState() {
  try {
    fs.writeFileSync(
      QUEUE_STATE_FILE,
      JSON.stringify({ activeProjectId }, null, 2),
      "utf-8"
    );
  } catch { /* ignore */ }
}

function loadSharedState() {
  try {
    if (fs.existsSync(QUEUE_STATE_FILE)) {
      const saved = JSON.parse(fs.readFileSync(QUEUE_STATE_FILE, "utf-8"));
      if (typeof saved.activeProjectId === "string" || saved.activeProjectId === null) {
        activeProjectId = saved.activeProjectId || null;
      }
    }
  } catch { /* ignore */ }
}

// ─── Cooldown cho project sync ───────────────────────────────

/** Đánh dấu project sync xong trên platform — bắt đầu cooldown 3 phút. */
function markProjectSyncDone(platform: Platform, projectId: string) {
  lastProjectSyncDoneAt[`${platform}:${projectId}`] = Date.now();
}

/** Project đang trong cooldown trên platform này không. */
function isProjectInCooldown(platform: Platform, projectId: string): boolean {
  const last = lastProjectSyncDoneAt[`${platform}:${projectId}`];
  if (!last) return false;
  const remaining = PROJECT_SYNC_COOLDOWN_MS - (Date.now() - last);
  if (remaining > 0) {
    console.log(`[Queue] ⏭ Skip ${projectId} (${platform}) — cooldown còn ${Math.round(remaining / 1000)}s`);
    return true;
  }
  return false;
}

// ─── Public API (routes / scheduler) ─────────────────────────

/**
 * Đặt project đang được user xem. KHÔNG cancel sync-all đang chạy —
 * chỉ ghi nhận `activeProjectId`; worker sẽ tự ưu tiên task project ở
 * lần `getNextJob()` tiếp theo (sau khi task sync-all hiện tại xong ~15s).
 */
export function setActiveProjectId(projectId: string | null) {
  activeProjectId = projectId;
  if (projectId) {
    console.log(`[Queue] Active project = ${projectId} — task project sẽ được ưu tiên ở vòng lấy job kế tiếp.`);
  }
  saveSharedState();
}

export function setWorkerUserId(projectId: string, userId: string) {
  userIds[projectId] = userId;
}

/**
 * Enqueue 1 job. Job vào đúng queue theo `task.platform`:
 * - Job "all" chứa cả task Teams + Zalo → tách thành 2 job con (cùng jobGroupId).
 * - Job "project"/"single" → task vào đúng queue platform.
 * - Cooldown: task project trong cooldown → skip (không xếp).
 * - Dedup: task trùng task đang chờ/đang chạy → gộp (nếu cần nâng lên full).
 */
export function enqueueJob(job: SyncJob): { ok: boolean; reason?: string; merged?: number; upgraded?: number; skipped?: number } {
  const jobGroupId = job.jobGroupId || job.id;

  // Cooldown cho project sync: filter task đang trong cooldown
  let cooldownSkipped = 0;
  let effectiveTasks = job.chatTasks;
  if (job.type === "project" && job.projectId) {
    const kept: ChatTask[] = [];
    for (const t of job.chatTasks) {
      if (isProjectInCooldown(t.platform, job.projectId)) {
        cooldownSkipped++;
        continue;
      }
      kept.push(t);
    }
    effectiveTasks = kept;
    if (effectiveTasks.length === 0 && cooldownSkipped > 0) {
      console.log(`[Queue] ⏭ ${job.label}: mọi task đang cooldown — skip.`);
      return { ok: true, skipped: cooldownSkipped, reason: "Mọi task đang trong cooldown." };
    }
  }

  // Phân loại task theo platform
  const teamsTasks = effectiveTasks.filter(t => t.platform === "teams");
  const zaloTasks = effectiveTasks.filter(t => t.platform === "zalo");

  let totalMerged = 0;
  let totalUpgraded = 0;

  // Reject sync-all nếu ĐÃ có sync-all trong ít nhất 1 queue (chỉ 1 sync-all
  // chạy cùng lúc toàn hệ thống — tránh 2 sync-all chồng lên nhau)
  if (job.type === "all") {
    const teamsHasAll = workers.teams.queue.some(j => j.type === "all") || (workers.teams.currentJob?.type === "all");
    const zaloHasAll = workers.zalo.queue.some(j => j.type === "all") || (workers.zalo.currentJob?.type === "all");
    if (teamsHasAll || zaloHasAll) {
      console.log(`[Queue] ⛔ Từ chối ${job.label} — đã có job sync-all trong queue.`);
      return { ok: false, reason: "A sync-all job is already queued or running." };
    }
  }

  // Enqueue vào từng queue có task
  if (teamsTasks.length > 0) {
    const r = enqueueIntoPlatform("teams", { ...job, id: `${job.id}-teams`, jobGroupId, chatTasks: teamsTasks });
    totalMerged += r.merged || 0;
    totalUpgraded += r.upgraded || 0;
  }
  if (zaloTasks.length > 0) {
    const r = enqueueIntoPlatform("zalo", { ...job, id: `${job.id}-zalo`, jobGroupId, chatTasks: zaloTasks });
    totalMerged += r.merged || 0;
    totalUpgraded += r.upgraded || 0;
  }

  return {
    ok: true,
    merged: totalMerged,
    upgraded: totalUpgraded,
    skipped: cooldownSkipped,
  };
}

/** Enqueue 1 job vào 1 platform queue — xử lý dedup + replacement. */
function enqueueIntoPlatform(platform: Platform, job: SyncJob): { ok: boolean; merged: number; upgraded: number } {
  const state = workers[platform];

  // Job project thay thế job project cũ cùng projectId trong queue
  if (job.type === "project") {
    const replaced = state.queue.filter(j => j.type === "project" && j.projectId === job.projectId);
    if (replaced.length > 0) {
      console.log(`[Queue:${platform}] 🔁 Thay thế job project cũ ${replaced[0].id} — job mới ${job.id}.`);
    }
    state.queue = state.queue.filter(j => !(j.type === "project" && j.projectId === job.projectId));
  }

  let merged = 0;
  let upgraded = 0;
  const mergeLogs: string[] = [];

  // 1) Gộp với task đang chạy (currentTask)
  const deduped: ChatTask[] = [];
  for (const t of job.chatTasks) {
    if (state.currentTask && taskKey(state.currentTask) === taskKey(t)) {
      merged++;
      mergeLogs.push(`đang chạy ${taskInfo(t)}`);
      if (t.syncMode === "full" && state.currentTask.syncMode !== "full") {
        upgraded++;
        state.refetchTasks.push({ ...t });
        mergeLogs.push(`  ↳ nâng lên full (sẽ chạy lại sau khi task đang chạy xong)`);
      }
      continue;
    }
    deduped.push(t);
  }

  // 2) Gộp với task đang chờ trong queue + task chưa chạy trong currentJob
  const pending: Map<string, ChatTask> = new Map();
  const refetchKeys = new Set(state.refetchTasks.map(taskKey));
  for (const j of state.queue) {
    for (const t of j.chatTasks) {
      const key = taskKey(t);
      if (refetchKeys.has(key)) continue;
      pending.set(key, t);
    }
  }
  if (state.currentJob) {
    for (const t of state.currentJob.chatTasks) {
      const key = taskKey(t);
      if (refetchKeys.has(key)) continue;
      if (!pending.has(key)) pending.set(key, t);
    }
  }

  const finalTasks: ChatTask[] = [];
  for (const t of deduped) {
    const key = taskKey(t);
    const existing = pending.get(key);
    if (existing) {
      merged++;
      mergeLogs.push(`đang chờ ${taskInfo(t)}`);
      if (t.syncMode === "full" && existing.syncMode !== "full") {
        existing.syncMode = "full";
        upgraded++;
        mergeLogs.push(`  ↳ nâng task chờ lên full`);
      }
      continue;
    }
    finalTasks.push(t);
    pending.set(key, t);
  }

  if (finalTasks.length === 0) {
    console.log(`[Queue:${platform}] 🔀 ${job.label}: tất cả ${merged} task đều trùng — gộp, không xếp mới.\n` + mergeLogs.map(l => `   ${l}`).join("\n"));
    return { ok: true, merged, upgraded };
  }

  state.queue = [...state.queue, { ...job, chatTasks: finalTasks }];
  void startWorker(platform);

  console.log(`[Queue:${platform}] ➕ ${job.label}: xếp ${finalTasks.length} task mới` +
    (merged > 0 ? `, gộp ${merged} task trùng` : "") +
    (upgraded > 0 ? `, nâng ${upgraded} task lên full` : "") +
    `.\n` + finalTasks.map(t => `   + ${taskInfo(t)}`).join("\n") +
    (mergeLogs.length > 0 ? `\n   Gộp: ${mergeLogs.map(l => l.replace(/\n\s*/g, " ")).join(" | ")}` : ""));
  return { ok: true, merged, upgraded };
}

export function getSyncQueueStatus() {
  const teamsState = workers.teams;
  const zaloState = workers.zalo;

  // Gộp 2 worker cho backward-compat
  const currentJob = teamsState.currentJob || zaloState.currentJob;
  const totalTeams = teamsState.currentJob ? teamsState.currentJob.chatTasks.length : 0;
  const totalZalo = zaloState.currentJob ? zaloState.currentJob.chatTasks.length : 0;
  const doneTeams = teamsState.currentJob
    ? teamsState.currentJob.chatTasks.filter((_, i) => statusOfTask(teamsState, teamsState.currentJob!, i) === "done").length
    : 0;
  const doneZalo = zaloState.currentJob
    ? zaloState.currentJob.chatTasks.filter((_, i) => statusOfTask(zaloState, zaloState.currentJob!, i) === "done").length
    : 0;
  const total = totalTeams + totalZalo;
  const done = doneTeams + doneZalo;

  // 2 task có thể chạy cùng lúc (1 Teams + 1 Zalo) — gộp cho progress message
  const teamsTask = teamsState.currentTask;
  const zaloTask = zaloState.currentTask;
  const runningMsgs: string[] = [];
  if (teamsTask) runningMsgs.push(`[Teams] ${teamsTask.chatName} (${teamsState.taskIndexInJob + 1}/${totalTeams || 1})`);
  if (zaloTask) runningMsgs.push(`[Zalo] ${zaloTask.chatName} (${zaloState.taskIndexInJob + 1}/${totalZalo || 1})`);
  const primaryTask = teamsTask || zaloTask;

  const progress = total > 0
    ? {
        total,
        done,
        currentChat: primaryTask?.chatName || undefined,
        currentProjectId: primaryTask?.projectId,
        platform: primaryTask?.platform || undefined,
        message: runningMsgs.length > 0 ? runningMsgs.join(" + ") : (currentJob ? `${currentJob.label} (${done}/${total})` : ""),
      }
    : null;

  // currentJobTasks gộp từ 2 worker
  const currentJobTasks = [
    ...(teamsState.currentJob
      ? teamsState.currentJob.chatTasks.map((t, i) => ({
          id: `${taskKey(t)}_${i}_teams`,
          projectId: t.projectId,
          chatName: t.chatName,
          platform: t.platform as Platform,
          syncMode: t.syncMode || "incremental",
          status: teamsState.taskStatuses[taskKey(t)] || "pending",
        }))
      : []),
    ...(zaloState.currentJob
      ? zaloState.currentJob.chatTasks.map((t, i) => ({
          id: `${taskKey(t)}_${i}_zalo`,
          projectId: t.projectId,
          chatName: t.chatName,
          platform: t.platform as Platform,
          syncMode: t.syncMode || "incremental",
          status: zaloState.taskStatuses[taskKey(t)] || "pending",
        }))
      : []),
  ];

  const queuedJobs = [...teamsState.queue, ...zaloState.queue].map(j => ({
    id: j.id,
    label: j.label,
    type: j.type,
    projectId: j.projectId,
    chats: j.chatTasks.length,
    jobGroupId: j.jobGroupId,
    chatTasks: j.chatTasks.map(t => ({ chatName: t.chatName, platform: t.platform as Platform, syncMode: t.syncMode || "incremental", projectId: t.projectId })),
  }));

  return {
    running: teamsState.isWorkerActive || zaloState.isWorkerActive || teamsState.currentJob !== null || zaloState.currentJob !== null,
    queueLength: teamsState.queue.length + zaloState.queue.length,
    currentJob: currentJob
      ? { id: currentJob.id, label: currentJob.label, type: currentJob.type, projectId: currentJob.projectId }
      : null,
    // Backward-compat: 1 task (ưu tiên Teams). UI mới nên đọc `currentTasks`.
    currentTask: primaryTask
      ? { projectId: primaryTask.projectId, chatName: primaryTask.chatName, platform: primaryTask.platform, syncMode: primaryTask.syncMode }
      : null,
    // MỚI — cả 2 task đang chạy (1 Teams + 1 Zalo)
    currentTasks: [teamsTask, zaloTask].filter((t): t is ChatTask => t !== null).map(t => ({
      projectId: t.projectId,
      chatName: t.chatName,
      platform: t.platform as Platform,
      syncMode: t.syncMode,
    })),
    jobStartTime: teamsState.jobStartTime || zaloState.jobStartTime,
    activeProjectId,
    currentJobTasks,
    queuedJobs,
    progress,
    // MỚI — chi tiết mỗi worker cho UI muốn hiển thị 2 lane
    teamsWorker: {
      running: teamsState.currentJob !== null,
      currentJob: teamsState.currentJob ? { id: teamsState.currentJob.id, label: teamsState.currentJob.label, type: teamsState.currentJob.type, projectId: teamsState.currentJob.projectId } : null,
      currentTask: teamsState.currentTask ? { projectId: teamsState.currentTask.projectId, chatName: teamsState.currentTask.chatName, platform: "teams", syncMode: teamsState.currentTask.syncMode } : null,
      queueLength: teamsState.queue.length,
    },
    zaloWorker: {
      running: zaloState.currentJob !== null,
      currentJob: zaloState.currentJob ? { id: zaloState.currentJob.id, label: zaloState.currentJob.label, type: zaloState.currentJob.type, projectId: zaloState.currentJob.projectId } : null,
      currentTask: zaloState.currentTask ? { projectId: zaloState.currentTask.projectId, chatName: zaloState.currentTask.chatName, platform: "zalo", syncMode: zaloState.currentTask.syncMode } : null,
      queueLength: zaloState.queue.length,
    },
    taskIndexInJob: teamsState.taskIndexInJob || zaloState.taskIndexInJob,
  };
}

/**
 * Kiểm tra xem 1 nhóm chat đang được queue xử lý không (đang chạy hoặc chờ).
 * Check đúng queue của platform đó.
 */
export function isChatQueuedOrRunning(projectId: string, chatName: string, platform: string): boolean {
  const p = (platform === "zalo" ? "zalo" : "teams") as Platform;
  const state = workers[p];
  const match = (t: ChatTask | null) =>
    !!t && t.projectId === projectId && t.chatName === chatName && t.platform === p;
  if (match(state.currentTask)) return true;
  if (state.currentJob && state.currentJob.chatTasks.some(match)) return true;
  return state.queue.some(j => j.chatTasks.some(match));
}

// ─── Worker ───────────────────────────────────────────────────

async function startWorker(platform: Platform) {
  const state = workers[platform];
  if (state.workerStarted) return;
  state.workerStarted = true;
  state.isWorkerActive = true;
  try {
    await workerLoop(platform);
  } finally {
    state.workerStarted = false;
    state.isWorkerActive = false;
    releaseWorkerLock(platform);
    writeRunningPids(platform, []);
  }
}

/**
 * Lấy job kế tiếp từ queue platform. Ưu tiên:
 * 1. Job project đang xem (activeProjectId)
 * 2. Job project bất kỳ
 * 3. Job single
 * 4. Job all (FIFO)
 * KHÔNG kill task đang chạy — chỉ quyết định task TIẾP THEO sau khi task
 * hiện tại xong.
 */
function getNextJob(platform: Platform): SyncJob | null {
  const state = workers[platform];
  const q = state.queue;

  if (activeProjectId) {
    const pj = q.find(j => j.type === "project" && j.projectId === activeProjectId);
    if (pj) {
      state.queue = q.filter(j => j.id !== pj.id);
      return pj;
    }
  }

  const projectJob = q.find(j => j.type === "project");
  if (projectJob) {
    state.queue = q.filter(j => j.id !== projectJob.id);
    return projectJob;
  }

  const singleJob = q.find(j => j.type === "single");
  if (singleJob) {
    state.queue = q.filter(j => j.id !== singleJob.id);
    return singleJob;
  }

  const allJob = q.shift();
  return allJob ?? null;
}

async function workerLoop(platform: Platform) {
  if (!acquireWorkerLock(platform)) {
    console.log(`[Worker:${platform}] Another ${platform} sync worker đang chạy — chờ vòng sau.`);
    await sleep(15_000);
    return;
  }
  console.log(`[Worker:${platform}] Sync worker bắt đầu (lock acquired).`);

  // Teams chạy song song được khi có CDP (multi-tab). Zalo LUÔN tuần tự
  // (không bao giờ dùng CDP — persistent profile chỉ cho 1 instance).
  const canParallel = platform === "teams" ? await checkCdpAvailable() : false;

  try {
    while (true) {
      const next = getNextJob(platform);
      if (!next) return;
      console.log(`[Sync:${platform}] → Bắt đầu job: ${next.label}`);
      await runJob(platform, next, canParallel);
    }
  } finally {
    releaseWorkerLock(platform);
    writeRunningPids(platform, []);
  }
}

async function runJob(platform: Platform, job: SyncJob, canParallel: boolean) {
  const state = workers[platform];
  state.currentJob = job;
  state.jobStartTime = Date.now();
  state.taskIndexInJob = 0;
  state.taskStatuses = {};

  if (canParallel && job.chatTasks.length > 1) {
    await runJobParallel(platform, job);
  } else {
    await runJobSequential(platform, job);
  }

  state.currentJob = null;
  state.currentTask = null;
  state.jobStartTime = 0;
  state.taskIndexInJob = 0;
  state.taskStatuses = {};

  // Đánh dấu cooldown khi project job xong (tất cả task)
  if (job.type === "project" && job.projectId) {
    markProjectSyncDone(platform, job.projectId);
  }

  console.log(`[Sync:${platform}] ✅ Hoàn tất job: ${job.label}`);
}

/** Chạy job tuần tự — hành vi mặc định (Zalo luôn dùng, Teams khi không CDP). */
async function runJobSequential(platform: Platform, job: SyncJob) {
  const state = workers[platform];
  for (const task of job.chatTasks) {
    // Job bị thay thế (project mới mở → enqueueIntoPlatform xoá job cũ)
    // → dừng phần còn lại.
    const isCurrent = state.currentJob?.id === job.id;
    if (!isCurrent) {
      console.log(`[Sync:${platform}] ⏹ Job ${job.id} (${job.label}) bị hủy giữa chừng — đã chạy ${state.taskIndexInJob}/${job.chatTasks.length} task.`);
      return;
    }
    state.currentTask = task;
    state.taskStatuses[taskKey(task)] = "running";
    console.log(`[Sync:${platform}] ▶ Bắt đầu task ${state.taskIndexInJob + 1}/${job.chatTasks.length}: ${taskInfo(task)}`);

    // Chờ nếu send / sync tay đang giữ Chrome của platform này (xung đột profile)
    const deadline = Date.now() + 90_000;
    while (isSyncRunning(platform) && Date.now() < deadline) {
      await sleep(10_000);
    }
    if (isSyncRunning(platform)) {
      state.taskStatuses[taskKey(task)] = "skipped";
      console.log(`[Sync:${platform}] ⏭ Skip task ${taskInfo(task)} — Chrome ${platform} bị chiếm quá 90s.`);
      state.taskIndexInJob++;
      continue;
    }

    await runTaskWithSendPreemption(platform, task);
    state.taskStatuses[taskKey(task)] = "done";
    state.currentTask = null;
    state.taskIndexInJob++;
  }
}

/**
 * Chờ send lock của ĐÚNG platform trong khi task con đang chạy — kill task
 * để nhường Chrome cho lệnh gửi (send-preemption). KHÔNG check send lock
 * của platform kia (2 platform dùng Chrome profile khác nhau → gửi Zalo
 * không cần Teams nghỉ, gửi Teams không cần Zalo nghỉ).
 */
async function runTaskWithSendPreemption(platform: Platform, task: ChatTask): Promise<void> {
  const state = workers[platform];
  const startedAt = Date.now();
  let done = false;
  let killed = false;

  const runPromise = runTask(platform, task).then(() => { done = true; });

  // Poll 2s/lần — send bấm giữa chừng task → kill task ngay
  const sendLock = SEND_LOCK_FILES[platform];
  while (!done) {
    await sleep(2_000);
    let sendWaiting = false;
    try {
      if (fs.existsSync(sendLock)) {
        const pid = parseInt(fs.readFileSync(sendLock, "utf-8").trim(), 10);
        if (!isNaN(pid)) {
          try { process.kill(pid, 0); sendWaiting = true; } catch { /* stale */ }
        }
      }
    } catch { /* ignore */ }
    if (sendWaiting && !killed) {
      killed = true;
      console.log(`[Sync:${platform}] ⏸ Send đang chờ — kill task ${taskInfo(task)} để nhường Chrome.`);
      for (const child of state.runningChildren) {
        if (!child.killed) child.kill("SIGTERM");
      }
      await runPromise.catch(() => {});
      break;
    }
  }

  if (!killed) await runPromise.catch(() => {});
  console.log(`[Sync:${platform}] ✓ Xong task ${taskInfo(task)} (${((Date.now() - startedAt) / 1000).toFixed(1)}s)${killed ? " — bị kill do send" : ""}`);

  if (killed) {
    state.taskStatuses[taskKey(task)] = "skipped";
  }

  // Task yêu cầu "full" bị rơi vào lúc task incremental đang chạy —
  // đã gộp vào refetchTasks lúc enqueue, giờ chạy lại full.
  if (!killed) {
    const idx = state.refetchTasks.findIndex(t => taskKey(t) === taskKey(task));
    if (idx >= 0) {
      const refetch = state.refetchTasks.splice(idx, 1)[0];
      console.log(`[Sync:${platform}] ↻ Task "${task.chatName}" cần full (gộp lúc đang chạy) — chạy lại full.`);
      await spawnTask(platform, { ...refetch, syncMode: "full" });
    }
  }
}

/** Chạy job song song: tối đa PARALLEL_TASKS task cùng lúc (chỉ Teams + CDP). */
async function runJobParallel(platform: Platform, job: SyncJob) {
  const state = workers[platform];
  console.log(`[Sync:${platform}] ⚡ Chạy song song job "${job.label}" (${job.chatTasks.length} tasks, tối đa ${PARALLEL_TASKS} cùng lúc)`);

  const pending = [...job.chatTasks];
  const running = new Set<Promise<void>>();
  let activeCount = 0;

  const launchNext = (): void => {
    if (state.currentJob?.id !== job.id) return; // job bị thay thế → dừng
    const task = pending.shift();
    if (!task) return;
    state.taskStatuses[taskKey(task)] = "running";
    console.log(`[Sync:${platform}] ▶ Bắt đầu task ${taskInfo(task)} (song song)`);
    state.currentTask = task;
    activeCount++;
    state.taskIndexInJob = activeCount;

    let taskPromise: Promise<void> | null = null;
    taskPromise = (async () => {
      try {
        await runTaskWithSendPreemption(platform, task);
      } finally {
        if (taskPromise) running.delete(taskPromise);
        activeCount--;
        state.taskStatuses[taskKey(task)] = "done";
        if (state.currentTask === task) state.currentTask = null;
        state.taskIndexInJob = activeCount;
      }
    })();
    running.add(taskPromise);
  };

  while (pending.length > 0 || running.size > 0) {
    while (pending.length > 0 && running.size < PARALLEL_TASKS) launchNext();
    if (running.size === 0) break;
    await Promise.race(running);
  }
}

async function runTask(platform: Platform, task: ChatTask): Promise<void> {
  const startedAt = Date.now();
  console.log(`[Sync:${platform}] ▶ BẮT ĐẦU ${taskInfo(task)} lúc ${new Date(startedAt).toISOString()}`);
  await spawnTask(platform, task);
  const durationMs = Date.now() - startedAt;
  const durationStr = durationMs >= 60_000
    ? `${(durationMs / 60_000).toFixed(2)}ph`
    : `${(durationMs / 1000).toFixed(1)}s`;
  console.log(`[Sync:${platform}] ✓ KẾT THÚC ${taskInfo(task)} — ${durationStr} (xong lúc ${new Date().toISOString()})`);

  // Tóm tắt dự án tự động: có tin mới + LLM gate → sinh version mới (không chặn sync)
  void maybeAutoGenerateSummary(task);

  // Refetch task (gộp lúc đang chạy) — chạy lại full
  const state = workers[platform];
  const idx = state.refetchTasks.findIndex(t => taskKey(t) === taskKey(task));
  if (idx >= 0) {
    const refetch = state.refetchTasks.splice(idx, 1)[0];
    console.log(`[Sync:${platform}] ↻ Task "${task.chatName}" cần full (gộp lúc đang chạy) — chạy lại full.`);
    await spawnTask(platform, { ...refetch, syncMode: "full" });
  }
}

// ─── Child processes ──────────────────────────────────────────

const PARALLEL_TASKS = Math.min(3, Math.max(1, parseInt(process.env.SYNC_PARALLEL || "2", 10) || 2));

function spawnTask(platform: Platform, task: ChatTask): Promise<void> {
  const state = workers[platform];
  const scriptPath = path.join(process.cwd(), "agents/pm/scripts/sync-single-chat.ts");
  const userId = userIds[task.projectId] || currentRunnerUserId || "";
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    USER_ID: userId,
    PROJECT_ID: task.projectId,
    CHAT_NAME: task.chatName,
    PLATFORM: task.platform,
    HEADLESS: "true",
    SYNC_MODE: task.syncMode || "incremental",
    // QUAN TRỌNG: CDP 9222 thường là Chrome user mở với profile TEAMS.
    // Zalo LUÔN dùng persistent profile riêng (.zalo-session) — nếu
    // connect CDP Teams sẽ bị "Đổi thiết bị" đá logout session Zalo.
    USE_CDP: platform === "zalo" ? "0" : (process.env.USE_CDP ?? "1"),
    CDP_PORT: process.env.CDP_PORT ?? "9222",
    // Đã được queue quản lý — script không tự claim lock.
    SYNC_QUEUE_MANAGED: "1",
  };

  return new Promise<void>(resolve => {
    try {
      const child = spawn("npx", ["tsx", scriptPath], { env, stdio: ["ignore", "pipe", "pipe"] });
      state.runningChildren.add(child);

      // Ghi PID con vào lock file ĐÚNG platform (mỗi script con 1 dòng)
      const pids = readRunningPids(platform);
      if (child.pid) pids.push(child.pid);
      writeRunningPids(platform, pids);

      let out = "";
      let errOut = "";
      child.stdout?.on("data", d => { out += d.toString(); });
      child.stderr?.on("data", d => { errOut += d.toString(); });

      const timeout = setTimeout(() => {
        console.warn(`[Sync:${platform}] ⏱ Slave timeout (5p): ${taskInfo(task)} — kill`);
        child.kill("SIGKILL");
      }, 5 * 60 * 1000);

      const releaseLock = () => {
        const remaining = readRunningPids(platform).filter(p => p !== child.pid);
        writeRunningPids(platform, remaining);
        state.runningChildren.delete(child);
      };

      child.on("exit", code => {
        clearTimeout(timeout);
        releaseLock();
        const tails = (out || errOut).split("\n").filter(l => l.trim()).slice(-4).join(" | ");
        console.log(`[Sync:${platform}] Done ${taskInfo(task)} (exit ${code}) ${tails ? "— " + tails : ""}`);
        resolve();
      });
      child.on("error", e => {
        clearTimeout(timeout);
        releaseLock();
        console.error(`[Sync:${platform}] Spawn error ${taskInfo(task)}:`, e.message);
        resolve();
      });
    } catch (e) {
      console.error(`[Sync:${platform}] Spawn exception:`, e);
      resolve();
    }
  });
}

// ─── CDP check (chỉ Teams dùng) ──────────────────────────────

let cdpAvailable: boolean | null = null;

/** Ping CDP endpoint — Chrome Teams thật đang mở port 9222 không.
 *  Chỉ Teams worker gọi; Zalo worker luôn sequential (canParallel=false). */
async function checkCdpAvailable(): Promise<boolean> {
  if (cdpAvailable !== null) return cdpAvailable;
  try {
    const port = Number(process.env.CDP_PORT || 9222);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: controller.signal });
    clearTimeout(timer);
    cdpAvailable = res.ok;
  } catch {
    cdpAvailable = false;
  }
  console.log(`[Worker:teams] CDP Chrome ${cdpAvailable ? "OK" : "KHÔNG có"} — sync ${cdpAvailable ? `song song tối đa ${PARALLEL_TASKS} task` : "tuần tự"} (fallback an toàn).`);
  return cdpAvailable;
}

// ─── Runner các job định kỳ ───────────────────────────────────

import { getActiveProjectsWithTeamsGroups } from "./repo/projects";

/**
 * Build các task nhóm chat cho 1 project — dùng cho UI.
 * Lọc nhóm kỳ lạ (URL làm tên) — giống các script sync hiện tại.
 */
export async function buildChatTasksForProject(projectId: string, userId: string): Promise<ChatTask[]> {
  currentRunnerUserId = userId;
  const { getProject } = await import("./repo/projects");
  const project = await getProject(projectId);
  if (!project) return [];
  // Không sync project đã archive/delete — tránh mở Chrome khi user không còn theo dõi
  if ((project as any)?.archived || (project as any)?.deletedAt) return [];
  const groups = ((project as any)?.teamsGroups || []) as Array<{ name: string; type: string; platform?: string }>;
  const tasks: ChatTask[] = [];
  for (const g of groups) {
    if (!g.name) continue;
    const name = String(g.name).trim();
    if (/^https?:\/\//i.test(name)) continue;
    tasks.push({
      projectId,
      chatName: name,
      platform: ((g as any).platform || "teams") as Platform,
      syncMode: "incremental",
    });
    userIds[projectId] = userId;
  }
  return tasks;
}

/**
 * Build task tổng hợp từ TẤT CẢ project active có teamsGroups của 1 user
 * (dùng cho sync-all định kỳ 30 phút).
 */
export async function buildAllChatTasks(userId: string): Promise<ChatTask[]> {
  currentRunnerUserId = userId;
  const projects = await getActiveProjectsWithTeamsGroups(userId);
  const tasks: ChatTask[] = [];
  for (const p of projects) {
    const groups = (p.teamsGroups || []) as Array<{ name: string; type: string; platform?: string }>;
    for (const g of groups) {
      if (!g.name) continue;
      const name = String(g.name).trim();
      if (/^https?:\/\//i.test(name)) continue;
      tasks.push({
        projectId: p._id,
        chatName: name,
        platform: ((g as any).platform || "teams") as Platform,
        syncMode: "incremental",
      });
      userIds[p._id] = userId;
    }
  }
  return tasks;
}

/** Khởi tạo queue khi next-server start — khôi phục activeProjectId. */
export function initWorkerState() {
  loadSharedState();
  // Dọn lock cũ: PID đã chết trong lock file của từng platform
  for (const p of ["teams", "zalo"] as Platform[]) {
    try {
      if (fs.existsSync(LOCK_FILES[p])) {
        const alive = readRunningPids(p).filter(pidAlive);
        writeRunningPids(p, alive);
      }
    } catch { /* ignore */ }
  }
}

// ─── Auto-generate project summary sau mỗi task sync ─────────────────────
// Sau khi sync 1 nhóm chat xong (có tin mới), gọi LLM gate đánh giá xem biến
// động có đáng chú ý không; nếu có → sinh + lưu version tóm tắt mới (auto).
// Bị lỗi gì cũng KHÔNG làm hỏng sync — chỉ log, không throw.

const lastSummaryCheckAt: Record<string, number> = {}; // projectId → last check time
const summaryGenerating: Record<string, boolean> = {}; // projectId → đang generate (mutex)

/** Đọc log sync_end mới nhất của nhóm → có tin mới không (saved > 0). */
async function taskHadNewMessages(task: ChatTask): Promise<boolean> {
  try {
    const log = await getLatestLogByProjectChat({
      projectId: task.projectId,
      chatName: task.chatName,
      type: "sync_end",
    });
    if (!log) return false;
    const details = log.details ? JSON.parse(log.details as string) : {};
    const saved = Number(details.saved) || 0;
    return saved > 0;
  } catch {
    return false;
  }
}

/**
 * Sau mỗi task sync xong: nếu nhóm vừa sync có tin mới (saved > 0), đọc
 * messages mới + project basic → gọi LLM gate; gate true → sinh + lưu version.
 * Chống spam: mỗi project tối đa 1 lần check/5 phút. Mutex tránh 2 worker
 * (Teams + Zalo) trigger cùng project cùng lúc sinh 2 version gần nhau.
 */
async function maybeAutoGenerateSummary(task: ChatTask): Promise<void> {
  try {
    const hasNew = await taskHadNewMessages(task);
    if (!hasNew) return;

    // Mutex: nếu đang generate cho project này → bỏ qua
    if (summaryGenerating[task.projectId]) return;
    summaryGenerating[task.projectId] = true;

    try {
      const now = Date.now();
      const last = lastSummaryCheckAt[task.projectId] || 0;
      if (now - last < 5 * 60 * 1000) return;
      lastSummaryCheckAt[task.projectId] = now;

      const userId = userIds[task.projectId] || currentRunnerUserId || "";
      if (!userId) return;

      const generator = await import("./projectSummaryGenerator");

      const [project, latest, messages] = await Promise.all([
        getProject(task.projectId).catch(() => null),
        getLatestSummary(task.projectId).catch(() => null),
        import("./repo/projectChats").then(m => m.getMessagesByProject(task.projectId).catch(() => [])),
      ]);
      if (!project) return;

      const newMessages = (messages || []).slice(-20).map((m: any) => ({
        sender: m.sender || "",
        chatName: m.chatName || "",
        content: m.content || "",
      }));

      const gateRes = await generator.shouldUpdateSummary({
        projectName: project.name,
        projectStatus: project.isdStatus || "",
        newMessages,
        latestSummaryText: latest?.summaryText || null,
      });

      if (!gateRes.shouldUpdate) {
        console.log(`[Summary] ⏭ ${taskInfo(task)}: không có biến động đáng chú ý (${gateRes.reason || "gate false"}).`);
        return;
      }

      console.log(`[Summary] ✨ ${taskInfo(task)}: có biến động — sinh bản tóm tắt mới.`);
      const created = await generator.generateAndSaveSummary({
        projectId: task.projectId,
        userId,
        trigger: "auto",
      });

      if (created) {
        console.log(`[Summary] ✅ ${taskInfo(task)}: lưu bản tóm tắt v${created.version} (${created.trigger}).`);
      } else {
        console.warn(`[Summary] ⚠ ${taskInfo(task)}: generate lỗi hoặc project không tồn tại.`);
      }
    } finally {
      summaryGenerating[task.projectId] = false;
    }
  } catch (err) {
    console.warn("[Summary] trigger error (không ảnh hưởng sync):", err);
  }
}
