/**
 * Sync scheduler tập trung — điều phối mọi loại sync browser (project đang
 * xem, sync-all định kỳ, sync 1 chat) qua MỘT hàng đợi chạy trong next-server.
 *
 * Vì mọi loại sync dùng CHUNG Chrome profile (Playwright không cho 2 Chrome
 * cùng user-data-dir chạy song song), các job phải chạy tuần tự. Queue này:
 * - Job project đang xem được ƯU TIÊN — chèn đầu hàng đợi; nếu đang chạy job
 *   sync-all thì hủy ngay để nhường Chrome.
 * - Mỗi task (1 nhóm chat) chạy qua `sync-single-chat.ts` (script con tự ghi
 *   lock `.teams-sync-running` — giữ nguyên quy đổi với teams-send/UI).
 * - Worker cross-process: dùng atomic lock `.sync-queue-worker.lock` để nếu
 *   có 2 next-server chạy cùng lúc chỉ 1 worker giữ quyền điều phối.
 */

import { spawn } from "child_process";
import path from "path";
import fs from "fs";

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
}

// ─── State ───────────────────────────────────────────────────
const RUNNING_FILE = path.join(process.cwd(), ".teams-sync-running");
const SEND_RUNNING_FILE = path.join(process.cwd(), ".teams-send-running");
const WORKER_LOCK_FILE = path.join(process.cwd(), ".sync-queue-worker.lock");
const QUEUE_STATE_FILE = path.join(process.cwd(), ".sync-queue-state.json");

let queue: SyncJob[] = [];
let currentJob: SyncJob | null = null;
let currentTask: ChatTask | null = null;
let currentChild: ReturnType<typeof spawn> | null = null; // deprecated — dùng runningChildren
let jobStartTime = 0;
let isWorkerActive = false;
let activeProjectId: string | null = null;
let currentRunnerUserId = "";
let taskIndexInJob = 0;
const userIds: Record<string, string> = {}; // projectId → userId (đúng user khi chạy từng group)

// ─── Helpers ─────────────────────────────────────────────────

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Đang có script sync nào chạy ngoài queue (đọc lock file) không. */
export function isAnySyncRunning(): boolean {
  // Lock file sync: có thể chứa nhiều PID (queue chạy song song) — dòng nào
  // còn sống là đang bận. Format cũ (1 PID) vẫn hoạt động.
  try {
    if (fs.existsSync(RUNNING_FILE)) {
      const content = fs.readFileSync(RUNNING_FILE, "utf-8");
      const pids = content.split("\n").map(l => l.trim()).filter(Boolean).map(l => parseInt(l, 10));
      if (pids.some(p => !isNaN(p) && pidAlive(p))) return true;
    }
  } catch { /* ignore */ }
  // Lock send: teams-send + zalo-send (mỗi cái 1 PID). Zalo và Teams dùng
  // profile riêng nhưng chung Chrome instance — send nào cũng phải chờ.
  for (const file of [SEND_RUNNING_FILE, path.join(process.cwd(), ".zalo-send-running")]) {
    try {
      if (fs.existsSync(file)) {
        const pid = parseInt(fs.readFileSync(file, "utf-8").trim(), 10);
        if (!isNaN(pid) && pidAlive(pid)) return true;
      }
    } catch { /* ignore */ }
  }
  return false;
}

/** Atomic lock của worker — 2 next-server không thể cùng chạy worker. */
function acquireWorkerLock(): boolean {
  try {
    const fd = fs.openSync(WORKER_LOCK_FILE, "wx");
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

function releaseWorkerLock() {
  try { fs.unlinkSync(WORKER_LOCK_FILE); } catch { /* ignore */ }
}

function saveState() {
  try {
    fs.writeFileSync(
      QUEUE_STATE_FILE,
      JSON.stringify({
        queue: queue.map(j => ({ id: j.id, label: j.label, type: j.type, projectId: j.projectId, chatCount: j.chatTasks.length })),
        current: currentJob ? { id: currentJob.id, label: currentJob.label, type: currentJob.type, projectId: currentJob.projectId } : null,
        currentTask: currentTask ? { projectId: currentTask.projectId, chatName: currentTask.chatName, platform: currentTask.platform } : null,
        refetchTasks: refetchTasks.map(t => ({ projectId: t.projectId, chatName: t.chatName, platform: t.platform, syncMode: t.syncMode })),
        activeProjectId,
        jobStartTime,
      }, null, 2),
      "utf-8"
    );
  } catch { /* ignore */ }
}

// ─── Public API (routes / scheduler) ─────────────────────────

/**
 * Đặt project đang được user xem. Job project này được ưu tiên;
 * nếu đang chạy job sync-all → hủy để nhường Chrome.
 */
export function setActiveProjectId(projectId: string | null) {
  activeProjectId = projectId;
  if (projectId && currentJob && currentJob.type === "all") {
    console.log(`[SyncQueue] Project ${projectId} đang mở — hủy job sync-all để ưu tiên.`);
    cancelCurrentJob();
  }
  saveState();
}

export function setWorkerUserId(projectId: string, userId: string) {
  userIds[projectId] = userId;
}

/** Key định danh 1 task (1 nhóm chat) — dùng để gộp các task tương tự. */
function taskKey(task: ChatTask): string {
  return `${task.projectId}|${task.chatName}|${task.platform}`;
}

export type TaskStatus = "pending" | "running" | "done" | "skipped";

/** Trạng thái từng task (key = projectId|chatName|platform) — cho job đang chạy. */
let taskStatuses: Record<string, TaskStatus> = {};

function taskInfo(task: ChatTask): string {
  return `[Project ${task.projectId}] "${task.chatName}" (${task.platform}, ${task.syncMode || "incremental"})`;
}

/** Trạng thái của task thứ i trong job (mặc định pending nếu chưa ghi nhận). */
function statusOfTask(job: SyncJob, i: number): TaskStatus {
  return taskStatuses[taskKey(job.chatTasks[i])] || "pending";
}

// Task yêu cầu full nhưng bị rơi vào lúc task incremental đang chạy —
// chạy lại full ngay sau khi task hiện tại xong.
let refetchTasks: ChatTask[] = [];

/**
 * Enqueue 1 job. Tất cả job đi cùng 1 hàng đợi, worker chạy tuần tự.
 * - Job project (project đang xem): luôn chấp nhận, thay job cũ cùng project.
 * - Job all/single: dùng trong queue, không trùng lắp (kiểm tra type).
 *
 * GỘP TASK (dedup): task mới trùng với task đang chờ trong queue hoặc
 * đang chạy (cùng projectId + chatName + platform) sẽ KHÔNG được xếp
 * thêm — gộp vào task hiện có:
 * - Task mới yêu cầu "full" mà task cũ chỉ "incremental" → nâng cấp task
 *   trong queue thành full (nếu task cũ đang chạy → chạy lại full sau).
 * - Ngược lại → bỏ qua task mới, giữ task cũ.
 */
export function enqueueJob(job: SyncJob): { ok: boolean; reason?: string; merged?: number; upgraded?: number } {
  if (job.type === "all" && queue.some(j => j.type === "all")) {
    console.log(`[Queue] ⛔ Từ chối ${job.label} — đã có job sync-all trong queue.`);
    return { ok: false, reason: "A sync-all job is already queued." };
  }

  // Job project thay thế job cũ cùng project — filter TRƯỚC khi gộp task,
  // tránh task mới bị gộp nhầm vào task của job sắp bị xóa.
  if (job.type === "project") {
    const replaced = queue.filter(j => j.type === "project" && j.projectId === job.projectId);
    if (replaced.length > 0) {
      console.log(`[Queue] 🔁 Thay thế job project cũ ${replaced[0].id} (${replaced[0].label}) — job mới ${job.id}.`);
    }
    queue = queue.filter(j => !(j.type === "project" && j.projectId === job.projectId));
  }

  let merged = 0;
  let upgraded = 0;
  const mergeLogs: string[] = [];

  // 1) Gộp task với task đang chạy (currentTask)
  const deduped: ChatTask[] = [];
  for (const t of job.chatTasks) {
    if (currentTask && taskKey(currentTask) === taskKey(t)) {
      merged++;
      mergeLogs.push(`đang chạy ${taskInfo(t)}`);
      // Task đang chạy là incremental, task mới muốn full → chạy lại full sau khi xong
      if (t.syncMode === "full" && currentTask.syncMode !== "full") {
        upgraded++;
        refetchTasks.push({ ...t });
        mergeLogs.push(`  ↳ nâng lên full (sẽ chạy lại sau khi task đang chạy xong)`);
      }
      continue;
    }
    deduped.push(t);
  }

  // 2) Gộp với task trong queue (mọi job, kể cả task chưa chạy trong job
  //    đang chạy — vì job chỉ bị hủy giữa chừng khi mở project mới):
  //    ai trước giữ, nâng full nếu cần.
  const pending: Map<string, ChatTask> = new Map();
  const refetchKeys = new Set(refetchTasks.map(taskKey));
  for (const j of queue) {
    for (const t of j.chatTasks) {
      const key = taskKey(t);
      if (refetchKeys.has(key)) continue; // task này sẽ chạy lại full — không tính trùng
      pending.set(key, t);
    }
  }
  if (currentJob) {
    for (const t of currentJob.chatTasks) {
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
        existing.syncMode = "full"; // nâng cấp task chờ sẵn trong queue
        upgraded++;
        mergeLogs.push(`  ↳ nâng task chờ lên full`);
      }
      continue;
    }
    finalTasks.push(t);
    pending.set(key, t);
  }

  // Không còn task mới nào để chạy — mọi thứ đã có trong queue/đang chạy
  if (finalTasks.length === 0) {
    console.log(`[Queue] 🔀 ${job.label}: tất cả ${merged} task đều trùng — gộp, không xếp mới.\n` + mergeLogs.map(l => `   ${l}`).join("\n"));
    return {
      ok: true,
      merged,
      upgraded,
      reason: "Đã có task tương tự trong queue — gộp, không xếp mới.",
    };
  }

  queue = [...queue, { ...job, chatTasks: finalTasks }];
  saveState();
  void startWorker();

  console.log(`[Queue] ➕ ${job.label}: xếp ${finalTasks.length} task mới` +
    (merged > 0 ? `, gộp ${merged} task trùng` : "") +
    (upgraded > 0 ? `, nâng ${upgraded} task lên full` : "") +
    `.\n` + finalTasks.map(t => `   + ${taskInfo(t)}`).join("\n") +
    (mergeLogs.length > 0 ? `\n   Gộp: ${mergeLogs.map(l => l.replace(/\n\s*/g, " ")).join(" | ")}` : ""));
  return { ok: true, merged, upgraded };
}

export function getSyncQueueStatus() {
  const total = currentJob ? currentJob.chatTasks.length : 0;
  const doneCount = currentJob
    ? currentJob.chatTasks.filter((_, i) => statusOfTask(currentJob!, i) === "done").length
    : 0;
  const progress = currentJob && total > 0
    ? {
        total,
        done: doneCount,
        currentChat: currentTask?.chatName || undefined,
        currentProjectId: currentTask?.projectId,
        platform: currentTask?.platform || undefined,
        message: currentTask
          ? `[Project ${currentTask.projectId}] "${currentTask.chatName}" (${taskIndexInJob + 1}/${total})`
          : `${currentJob.label} (${doneCount}/${total})`,
      }
    : null;

  return {
    running: isWorkerActive || currentJob !== null,
    queueLength: queue.length,
    currentJob: currentJob
      ? { id: currentJob.id, label: currentJob.label, type: currentJob.type, projectId: currentJob.projectId }
      : null,
    currentTask: currentTask ? { projectId: currentTask.projectId, chatName: currentTask.chatName, platform: currentTask.platform, syncMode: currentTask.syncMode } : null,
    jobStartTime,
    activeProjectId,
    // Trạng thái từng task của JOB ĐANG CHẠY (key: projectId|chatName|platform)
    currentJobTasks: currentJob
      ? currentJob.chatTasks.map((t, i) => ({
          id: `${taskKey(t)}_${i}`,
          projectId: t.projectId,
          chatName: t.chatName,
          platform: t.platform,
          syncMode: t.syncMode || "incremental",
          status: taskStatuses[taskKey(t)] || "pending",
        }))
      : [],
    queuedJobs: queue.map(j => ({
      id: j.id,
      label: j.label,
      type: j.type,
      projectId: j.projectId,
      chats: j.chatTasks.length,
      chatTasks: j.chatTasks.map(t => ({ chatName: t.chatName, platform: t.platform, syncMode: t.syncMode || "incremental", projectId: t.projectId })),
    })),
    progress,
    taskIndexInJob,
  };
}

/**
 * Kiểm tra xem 1 nhóm chat cụ thể đang được queue xử lý không
 * (đang chạy hoặc còn chờ trong hàng đợi). Dùng cho UI hiển thị
 * spinner "đang đồng bộ" cho đúng từng nhóm.
 */
export function isChatQueuedOrRunning(projectId: string, chatName: string, platform: string): boolean {
  const match = (t: ChatTask | null) =>
    !!t && t.projectId === projectId && t.chatName === chatName && t.platform === platform;
  if (match(currentTask)) return true;
  if (currentJob && currentJob.chatTasks.some(match)) return true;
  return queue.some(j => j.chatTasks.some(match));
}

// ─── Worker ───────────────────────────────────────────────────

let workerStarted = false;

async function startWorker() {
  if (workerStarted) return;
  workerStarted = true;
  isWorkerActive = true;
  saveState();
  try {
    await workerLoop();
  } finally {
    workerStarted = false;
    isWorkerActive = false;
    releaseWorkerLock();
    saveState();
  }
}

// ─── Parallel-sync support ────────────────────────────────────
// Worker chạy tối đa PARALLEL_TASKS task cùng lúc — NHƯNG chỉ khi Chrome
// thật đang mở CDP (9222). Mỗi script con tự mở 1 tab riêng trên Chrome đó.
// Không có CDP → chạy tuần tự (Chrome persistent profile không mở 2 lần được).
const PARALLEL_TASKS = Math.min(3, Math.max(1, parseInt(process.env.SYNC_PARALLEL || "2", 10) || 2));

let cdpAvailable: boolean | null = null;

/** Ping CDP endpoint — Chrome thật đang mở port 9222 không. */
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
  console.log(`[Worker] CDP Chrome ${cdpAvailable ? "OK" : "KHÔNG có"} — sync ${cdpAvailable ? `song song tối đa ${PARALLEL_TASKS} task` : "tuần tự"} (fallback an toàn).`);
  return cdpAvailable;
}

function resetCdpCheck() {
  cdpAvailable = null;
}

// ─── Lock file ────────────────────────────────────────────────
// `.teams-sync-running` giờ chứa NHIỀU PID (mỗi script con 1 dòng) vì queue
// chạy song song. `teams-send` và `isAnySyncRunning()` đọc tất cả dòng —
// PID nào còn sống nghĩa là đang có sync chạy. Format cũ (1 PID duy nhất)
// vẫn tương thích vì chỉ có 1 dòng.

function readRunningPids(): number[] {
  try {
    if (!fs.existsSync(RUNNING_FILE)) return [];
    const content = fs.readFileSync(RUNNING_FILE, "utf-8");
    return content.split("\n").map(l => l.trim()).filter(Boolean).map(l => parseInt(l, 10)).filter(p => !isNaN(p));
  } catch {
    return [];
  }
}

/** Ghi lock file với danh sách PID con đang chạy. */
function writeRunningPids(pids: number[]): void {
  try {
    const unique = Array.from(new Set(pids.filter(p => p > 0)));
    if (unique.length === 0) {
      try { fs.unlinkSync(RUNNING_FILE); } catch { /* ignore */ }
    } else {
      fs.writeFileSync(RUNNING_FILE, unique.join("\n") + "\n", "utf-8");
    }
  } catch { /* ignore */ }
}

/** Có PID nào trong lock file còn sống không (sync đang chạy ngoài queue). */
function hasLiveRunningPids(): boolean {
  return readRunningPids().some(p => pidAlive(p));
}

async function workerLoop() {
  // Chỉ 1 next-server được làm worker — nếu bận, trả lại quyền sau
  if (!acquireWorkerLock()) {
    console.log("[Worker] Another sync worker (next-server khác) đang chạy — chờ vòng sau.");
    await sleep(15_000);
    return;
  }
  console.log("[Worker] Sync worker bắt đầu (lock acquired).");

  const canParallel = await checkCdpAvailable();

  try {
    while (true) {
      // Job project đang xem luôn ưu tiên chạy trước mọi job khác
      if (activeProjectId) {
        const pj = queue.find(j => j.type === "project" && j.projectId === activeProjectId);
        if (pj) {
          queue = queue.filter(j => j.id !== pj.id);
          await runJob(pj, canParallel);
          continue;
        }
      }

      const next = queue.shift();
      if (!next) return;
      console.log(`[Sync] → Bắt đầu job: ${next.label}`);
      await runJob(next, canParallel);
    }
  } finally {
    releaseWorkerLock();
    writeRunningPids([]); // đảm bảo không để lock file rác
  }
}

function sleep(ms: number) {
  return new Promise<void>(r => setTimeout(r, ms));
}

async function runJob(job: SyncJob, canParallel: boolean) {
  currentJob = job;
  jobStartTime = Date.now();
  taskIndexInJob = 0;
  taskStatuses = {}; // reset trạng thái từng task cho job mới
  saveState();

  if (canParallel && job.chatTasks.length > 1) {
    await runJobParallel(job);
  } else {
    await runJobSequential(job);
  }

  currentJob = null;
  currentTask = null;
  jobStartTime = 0;
  taskIndexInJob = 0;
  taskStatuses = {};
  saveState();
  console.log(`[Sync] ✅ Hoàn tất job: ${job.label}`);
}

/** Chạy job tuần tự (không CDP hoặc job 1 task) — hành vi cũ. */
async function runJobSequential(job: SyncJob) {
  for (const task of job.chatTasks) {
    // Job bị thay thế (project mới mở) → dừng phần còn lại
    const isCurrent = currentJob?.id === job.id;
    if (!isCurrent) {
      console.log(`[Sync] ⏹ Job ${job.id} (${job.label}) bị hủy giữa chừng — đã chạy ${taskIndexInJob}/${job.chatTasks.length} task.`);
      return;
    }
    currentTask = task;
    taskStatuses[taskKey(task)] = "running";
    saveState();
    console.log(`[Sync] ▶ Bắt đầu task ${taskIndexInJob + 1}/${job.chatTasks.length}: ${taskInfo(task)}`);

    // Chờ nếu teams-send hay sync khác đang giữ Chrome (xung đột profile)
    let deadline = Date.now() + 90_000;
    while (isAnySyncRunning() && Date.now() < deadline) {
      await sleep(10_000);
    }
    if (isAnySyncRunning()) {
      taskStatuses[taskKey(task)] = "skipped";
      saveState();
      console.log(`[Sync] ⏭ Skip task ${taskInfo(task)} — Chrome bị chiếm quá 90s.`);
      taskIndexInJob++;
      continue;
    }

    await runTaskWithSendPreemption(task);
    taskStatuses[taskKey(task)] = "done";
    currentTask = null;
    taskIndexInJob++;
    saveState();
  }
}

/**
 * Chờ send lock trong khi task con đang chạy — kill task để nhường Chrome
 * cho lệnh gửi (send-preemption). Gửi phải nhanh: đừng bắt nó chờ sync
 * (sync 2 phút chạy liên tục khi mở project → chờ là treo vô hạn).
 * Chỉ kill task con (script), queue worker vẫn sống, task còn lại xử lý sau.
 */
async function runTaskWithSendPreemption(task: ChatTask): Promise<void> {
  const startedAt = Date.now();
  let done = false;
  let killed = false;

  const runPromise = runTask(task).then(() => { done = true; });

  // Poll 2s/lần — send bấm giữa chừng task → kill task ngay.
  while (!done) {
    await sleep(2_000);
    const sendWaiting = (() => {
      for (const file of [SEND_RUNNING_FILE, path.join(process.cwd(), ".zalo-send-running")]) {
        try {
          if (fs.existsSync(file)) {
            const pid = parseInt(fs.readFileSync(file, "utf-8").trim(), 10);
            if (!isNaN(pid)) {
              try { process.kill(pid, 0); return true; } catch { /* stale */ }
            }
          }
        } catch { /* ignore */ }
      }
      return false;
    })();
    if (sendWaiting && !killed) {
      killed = true;
      console.log(`[Sync] ⏸ Send đang chờ — kill task ${taskInfo(task)} để nhường Chrome.`);
      for (const child of runningChildren) {
        if (!child.killed) child.kill("SIGTERM");
      }
      // Đợi task con thực sự thoát rồi mới cho send chạy tiếp (send đã claim
      // lock NGAY từ đầu nên cũng đang chờ profile rảnh — không ai đè nhau).
      await runPromise.catch(() => {});
      break;
    }
  }

  if (!killed) await runPromise.catch(() => {});
  console.log(`[Sync] ✓ Xong task ${taskInfo(task)} (${((Date.now() - startedAt) / 1000).toFixed(1)}s)${killed ? " — bị kill do send" : ""}`);

  // Task bị kill để nhường send → đánh dấu skipped để task kế tiếp (vòng
  // sync sau, 2 phút) chạy lại đầy đủ. Tránh mất message chưa sync.
  if (killed) {
    taskStatuses[taskKey(task)] = "skipped";
    saveState();
  }

  // Task yêu cầu "full" bị rơi vào lúc task incremental đang chạy —
  // đã gộp vào refetchTasks lúc enqueue, giờ chạy lại full rồi mới để
  // worker sang task kế tiếp.
  if (!killed) {
    const idx = refetchTasks.findIndex(t => taskKey(t) === taskKey(task));
    if (idx >= 0) {
      const refetch = refetchTasks.splice(idx, 1)[0];
      console.log(`[Sync] ↻ Task "${task.chatName}" cần full (gộp lúc đang chạy) — chạy lại full.`);
      await spawnTask({ ...refetch, syncMode: "full" });
    }
  }
}

/** Chạy job song song: tối đa PARALLEL_TASKS task cùng lúc (CDP mode). */
async function runJobParallel(job: SyncJob) {
  console.log(`[Sync] ⚡ Chạy song song job "${job.label}" (${job.chatTasks.length} tasks, tối đa ${PARALLEL_TASKS} cùng lúc)`);

  const pending = [...job.chatTasks];
  const running = new Set<Promise<void>>();
  let activeCount = 0;

  const launchNext = (): void => {
    if (currentJob?.id !== job.id) return; // job bị thay thế → dừng
    const task = pending.shift();
    if (!task) return;
    taskStatuses[taskKey(task)] = "running";
    saveState();
    console.log(`[Sync] ▶ Bắt đầu task ${taskInfo(task)} (song song)`);
    currentTask = task;
    activeCount++;
    taskIndexInJob = activeCount; // để UI hiển thị task đang chạy

    let taskPromise: Promise<void> | null = null;
    taskPromise = (async () => {
      try {
        await runTaskWithSendPreemption(task);
      } finally {
        if (taskPromise) running.delete(taskPromise);
        activeCount--;
        taskStatuses[taskKey(task)] = "done";
        currentTask = null;
        taskIndexInJob = activeCount;
        saveState();
      }
    })();
    running.add(taskPromise);
  };

  // Đổ đầy pool rồi đợi từng task xong, mỗi lần xong lại đổ thêm
  while (pending.length > 0 || running.size > 0) {
    while (pending.length > 0 && running.size < PARALLEL_TASKS) launchNext();
    if (running.size === 0) break;
    await Promise.race(running);
  }
}

async function runTask(task: ChatTask): Promise<void> {
  const startedAt = Date.now();
  // Log rõ thời điểm bắt đầu/kết thúc + duration để đối chiếu tốc độ sync.
  console.log(`[Sync] ▶ BẮT ĐẦU ${taskInfo(task)} lúc ${new Date(startedAt).toISOString()}`);
  await spawnTask(task);
  const durationMs = Date.now() - startedAt;
  const durationStr = durationMs >= 60_000
    ? `${(durationMs / 60_000).toFixed(2)}ph`
    : `${(durationMs / 1000).toFixed(1)}s`;
  console.log(`[Sync] ✓ KẾT THÚC ${taskInfo(task)} — ${durationStr} (xong lúc ${new Date().toISOString()})`);

  // Task yêu cầu "full" bị rơi vào lúc task incremental đang chạy —
  // đã gộp vào refetchTasks lúc enqueue, giờ chạy lại full rồi mới để
  // worker sang task kế tiếp.
  const idx = refetchTasks.findIndex(t => taskKey(t) === taskKey(task));
  if (idx >= 0) {
    const refetch = refetchTasks.splice(idx, 1)[0];
    console.log(`[Sync] ↻ Task "${task.chatName}" cần full (gộp lúc đang chạy) — chạy lại full.`);
    await spawnTask({ ...refetch, syncMode: "full" });
  }
}

// ─── Child processes ──────────────────────────────────────────
const runningChildren = new Set<ReturnType<typeof spawn>>();

function spawnTask(task: ChatTask): Promise<void> {
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
    USE_CDP: task.platform === "zalo" ? "0" : (process.env.USE_CDP ?? "1"),
    CDP_PORT: process.env.CDP_PORT ?? "9222",
    // Đã được queue quản lý — script không tự claim lock.
    // (Trong CDP mode script mở tab riêng — xem shouldUseOwnTab trong script.)
    SYNC_QUEUE_MANAGED: "1",
  };

  return new Promise<void>(resolve => {
    try {
      const child = spawn("npx", ["tsx", scriptPath], { env, stdio: ["ignore", "pipe", "pipe"] });
      runningChildren.add(child);

      // Ghi PID con vào lock file (mỗi script con 1 dòng) — teams-send /
      // sync tay (UI) sẽ thấy queue đang bận và chờ, tránh 2 Chrome đè
      // cùng profile. Nhiều task song song = nhiều PID trong 1 file.
      const pids = readRunningPids();
      if (child.pid) pids.push(child.pid);
      writeRunningPids(pids);

      let out = "";
      let errOut = "";
      child.stdout?.on("data", d => { out += d.toString(); });
      child.stderr?.on("data", d => { errOut += d.toString(); });

      const timeout = setTimeout(() => {
        console.warn(`[Sync] ⏱ Slave timeout (5p): ${taskInfo(task)} — kill`);
        child.kill("SIGKILL");
      }, 5 * 60 * 1000);

      const releaseLock = () => {
        const pids = readRunningPids().filter(p => p !== child.pid);
        writeRunningPids(pids);
        runningChildren.delete(child);
      };

      child.on("exit", code => {
        clearTimeout(timeout);
        releaseLock();
        const tails = (out || errOut).split("\n").filter(l => l.trim()).slice(-4).join(" | ");
        console.log(`[Sync] Done ${taskInfo(task)} (exit ${code}) ${tails ? "— " + tails : ""}`);
        resolve();
      });
      child.on("error", e => {
        clearTimeout(timeout);
        releaseLock();
        console.error(`[Sync] Spawn error ${taskInfo(task)}:`, e.message);
        resolve();
      });
    } catch (e) {
      console.error("[Sync] Spawn exception:", e);
      resolve();
    }
  });
}

function cancelCurrentJob(): void {
  for (const child of runningChildren) {
    if (!child.killed) child.kill("SIGTERM");
  }
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
  const groups = ((project as any)?.teamsGroups || []) as Array<{ name: string; type: string; platform?: string }>;
  const tasks: ChatTask[] = [];
  for (const g of groups) {
    if (!g.name) continue;
    const name = String(g.name).trim();
    if (/^https?:\/\//i.test(name)) continue;
    tasks.push({
      projectId,
      chatName: name,
      platform: ((g as any).platform || "teams") as "teams" | "zalo",
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
        platform: ((g as any).platform || "teams") as "teams" | "zalo",
        syncMode: "incremental",
      });
      userIds[p._id] = userId;
    }
  }
  return tasks;
}

/** Khởi tạo queue khi next-server start — khôi phục trạng thái nếu restart. */
export function initWorkerState() {
  try {
    if (fs.existsSync(QUEUE_STATE_FILE)) {
      const saved = JSON.parse(fs.readFileSync(QUEUE_STATE_FILE, "utf-8"));
      if (Array.isArray(saved.queue)) {
        queue = saved.queue.map((j: any) => ({
          id: j.id, label: j.label, type: j.type, projectId: j.projectId,
          chatTasks: [], createdAt: j.createdAt || Date.now(),
        }));
      }
      if (Array.isArray(saved.refetchTasks)) {
        refetchTasks = saved.refetchTasks
          .filter((t: any) => t && t.chatName && t.projectId && t.platform)
          .map((t: any) => ({
            projectId: t.projectId,
            chatName: t.chatName,
            platform: t.platform as ChatTask["platform"],
            syncMode: t.syncMode || "full",
          }));
      }
      // Job đang chạy dở khi process cũ chết (next-server crash/restart):
      // KHÔNG phục hồi current — process cũ đã chết nên không còn script con
      // nào sống. Nếu giữ current, worker mới sẽ treo vĩnh viễn (không có
      // ai báo exit). Đặt lại current = null, job dở coi như bỏ (task chưa
      // xong sẽ được enqueue lại bởi UI/scheduler).
      currentJob = null;
      currentTask = null;
      jobStartTime = 0;
      taskIndexInJob = 0;
      taskStatuses = {};
      activeProjectId = saved.activeProjectId || null;
    }
  } catch { /* ignore */ }
  // Dọn lock cũ nếu process cũ chết (lock giờ có thể chứa nhiều PID —
  // queue chạy song song, mỗi script con 1 dòng)
  try {
    if (fs.existsSync(RUNNING_FILE)) {
      const alive = readRunningPids().filter(p => pidAlive(p));
      writeRunningPids(alive);
    }
  } catch { /* ignore */ }
}