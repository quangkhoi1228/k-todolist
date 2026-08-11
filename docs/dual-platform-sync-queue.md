# Tách Queue Sync theo Platform — Teams & Zalo chạy song song

> **Mục đích tài liệu**: Đây là bản thiết kế chi tiết để các agent sau đọc và implement. Mô tả rõ vấn đề, kiến trúc mới, file cần sửa, logic cụ thể từng phần.

---

## 1. Vấn đề hiện tại

### Kiến trúc cũ: 1 queue duy nhất, tuần tự

```
enqueueSyncJob()
       │
       ▼
┌──────────────────────┐
│   1 Worker duy nhất   │
│   (tuần tự tuyệt đối) │
│   lock: .teams-sync-  │
│   running (dùng chung) │
└──────────┬───────────┘
           │
    Teams task 1 → Teams task 2 → Zalo task 1 → Zalo task 2 → ...
```

**Hệ quả:**
- Sync-all 10 dự án × 2 nhóm/dự án = 20 task tuần tự, mỗi task ~15s → **tổng ~5 phút**
- Dự án đang xem có 1 nhóm Teams + 1 nhóm Zalo → phải chờ nhau dù **dùng 2 Chrome profile hoàn toàn khác nhau**
- Cơ chế ưu tiên project (`setActiveProjectId`) đã có nhưng vẫn tuần tự — nhóm Zalo phải đợi nhóm Teams xong
- Lock `.teams-sync-running` dùng chung cho cả 2 platform → không thể song song

### Cơ hội

Teams và Zalo dùng **Chrome profile riêng biệt**, cơ chế kết nối Chrome cũng khác nhau:

| | Teams | Zalo |
|---|---|---|
| Profile | `.teams-session/chrome-profile` | `.zalo-session/chrome-profile` |
| Kết nối Chrome | CDP port 9222 (`USE_CDP=1`) | Persistent context (`USE_CDP=0` bắt buộc) |
| Song song nội bộ | Có thể multi-tab qua CDP (đã có `PARALLEL_TASKS`) | Không — Chrome chỉ cho 1 instance/profile |

→ **Hoàn toàn có thể chạy song song 2 platform mà không xung đột Chrome.**

---

## 2. Kiến trúc mới: Dual-Platform Queue

```
                    ┌───────────────────────────────────┐
                    │       enqueueSyncJob()             │
                    │  (phân loại task theo platform)     │
                    └──────────┬────────────────────────┘
                               │
                    ┌──────────┴──────────┐
                    ▼                     ▼
          ┌─────────────────┐   ┌─────────────────┐
          │  Teams Worker   │   │  Zalo Worker     │
          │  (queue riêng)  │   │  (queue riêng)   │
          │  lock: .teams-  │   │  lock: .zalo-    │
          │  sync-running   │   │  sync-running    │
          └────────┬────────┘   └────────┬─────────┘
                   │ (song song)         │
                   ▼                     ▼
          Chrome profile            Chrome profile
          .teams-session/           .zalo-session/
          CDP port 9222             Persistent context
```

### Nguyên tắc thiết kế

1. **Mỗi platform có worker riêng**, chạy **song song** với platform kia
2. **Trong cùng 1 platform**, các task vẫn **tuần tự** (tránh xung đột Chrome profile)
3. **Không cancel sync-all, chỉ xen kẽ (interleave)** — task project đang xem được chèn lên đầu queue, task sync-all đang chạy vẫn chạy xong rồi mới nhường (xem mục 2.1)
4. **Cooldown cho project sync** — sau khi sync xong tất cả nhóm của project, nghỉ 3 phút trước khi sync lại. Trong thời gian nghỉ, sync-all được chạy (xem mục 2.1)
5. **Lock file tách riêng**: `.teams-sync-running` chỉ cho Teams, `.zalo-sync-running` (MỚI) cho Zalo
6. **Tương thích ngược**: Routes và UI gọi `enqueueSyncJob()` như cũ — queue tự chia bên trong

### So sánh hiệu quả

| | Trước (1 queue) | Sau (2 queue song song + interleave) |
|---|---|---|
| 20 task (10 Teams + 10 Zalo) | ~5 phút tuần tự | ~2.5 phút (2 lane song song) |
| Project có 1 Teams + 1 Zalo | Chờ nhau ~30s | Cả 2 chạy cùng lúc ~15s |
| Gửi tin Zalo khi Teams đang sync | Phải đợi Teams xong | Gửi ngay (Zalo worker độc lập) |
| User ngồi xem project 1 giờ | Sync-all **không bao giờ chạy xong** | Sync-all **vẫn chạy** trong khoảng cooldown 3 phút |

---

### 2.1. Chống starvation: Interleave + Cooldown (QUAN TRỌNG)

#### Vấn đề nếu project sync luôn cancel sync-all

```
Phút 0: sync-all bắt đầu (20 task)
Phút 0.5: user mở project → CANCEL sync-all → mất hết tiến trình
Phút 0.5: project sync chạy (2 task, xong trong 30s)
Phút 2: project sync lại (2 task)
Phút 4: project sync lại
... sync-all KHÔNG BAO GIỜ hoàn thành
```

#### Giải pháp: 3 cơ chế kết hợp

**Cơ chế 1 — KHÔNG cancel, chỉ chèn lên đầu (interleave)**

Khi user mở project (hoặc project sync fire mỗi 2 phút):
- **KHÔNG kill** task sync-all đang chạy (task đang chạy ~15s, để nó chạy xong)
- **Chèn** task project lên **đầu queue** (trước các task sync-all còn lại)
- Worker chạy xong task hiện tại → lấy task project (ưu tiên) → chạy → rồi tiếp tục sync-all

```
Queue trước khi chèn:
  [đang chạy: all-task-5] → all-task-6 → all-task-7 → all-task-8

User mở project (có 2 nhóm Teams):
  [đang chạy: all-task-5] → ★ proj-teams-1 → ★ proj-teams-2 → all-task-6 → all-task-7 → all-task-8
                             ↑ chèn lên đầu, KHÔNG kill task đang chạy

Kết quả: all-task-5 chạy xong (~15s) → proj-teams-1 → proj-teams-2 → all-task-6 → ...
```

**Lợi ích:** Sync-all không bao giờ bị cancel, không mất tiến trình. Project chỉ chờ tối đa 15s (1 task đang chạy xong).

**Cơ chế 2 — Cooldown 3 phút sau khi sync xong project**

Sau khi tất cả task project chạy xong:
- Ghi timestamp `lastProjectSyncDoneAt[platform]`
- Trong 3 phút tiếp theo, **không enqueue project sync mới** cho platform đó
- Worker rảnh → chạy tiếp các task sync-all còn lại trong queue

```
Timeline (1 platform):
  0:00  Project sync: nhóm A (15s) → nhóm B (15s) → XONG
  0:30  Cooldown bắt đầu — KHÔNG sync project
  0:30  Worker rảnh → chạy sync-all: task-6 (15s) → task-7 (15s) → task-8 (15s)
  1:15  Sync-all tasks xong
  2:00  GlobalSyncManager fire project sync → check cooldown → còn 1 phút → BỎ QUA
  3:30  Cooldown hết → project sync chạy lại
```

**Lợi ích:** Mỗi chu kỳ 3 phút, project sync chiếm ~30s, sync-all chạy ~2.5 phút. Đủ thời gian sync các dự án khác.

**Cơ chế 3 — Skip nếu watermark còn mới**

Trước khi enqueue project sync, check watermark (tin mới nhất đã sync) của từng nhóm:
- Watermark < 2 phút tuổi → nhóm này vừa mới sync xong → **skip**, không enqueue
- Watermark >= 2 phút → enqueue bình thường

```ts
// Trong route sync-project-chats, khi build tasks cho project
for (const group of project.teamsGroups) {
  const watermark = await getLatestTimestampMs(projectId, group.name, group.platform);
  const ageMs = Date.now() - (watermark ?? 0);
  if (ageMs < 2 * 60 * 1000) {
    // Nhóm này vừa sync < 2 phút trước → skip
    continue;
  }
  tasks.push({ chatName: group.name, platform: group.platform, ... });
}
// Nếu tasks rỗng (mọi nhóm đều mới sync) → không enqueue gì cả
```

**Lợi ích:** Nếu sync-all vừa sync nhóm của project rồi, project sync không enqueue lại → tiết kiệm slot.

#### Kết hợp 3 cơ chế — Dòng thời gian thực tế

```
0:00   Sync-all bắt đầu (20 task: 10 Teams + 10 Zalo)
       TeamsWorker: T1 → T2 → T3...
       ZaloWorker:  Z1 → Z2 → Z3...

0:30   User mở project 45 (có 1 nhóm Teams "FRT" + 1 nhóm Zalo "UICVN")
       → setActiveProjectId(45)
       → KHÔNG cancel — chèn task project lên đầu mỗi queue:
         TeamsWorker: [đang: T3] → ★ proj-FRT → T4 → T5...
         ZaloWorker:  [đang: Z3] → ★ proj-UICVN → Z4 → Z5...

0:45   T3 xong → proj-FRT chạy (15s) → xong
       Z3 xong → proj-UICVN chạy (15s) → xong

1:00   Project sync XONG → bắt đầu cooldown 3 phút
       TeamsWorker tiếp: T4 → T5 → T6 → T7 → T8...
       ZaloWorker tiếp:  Z4 → Z5 → Z6 → Z7 → Z8...

2:00   GlobalSyncManager fire project sync → cooldown còn 2 phút → BỎ QUA
2:30   Sync-all XONG tất cả task (không bị cancel lần nào!)

4:00   Cooldown hết → project sync chạy lại (nếu watermark cũ)
```

**Kết quả:**
- Project 45 chờ tối đa **15 giây** (1 task đang chạy) rồi được sync ngay
- Sync-all **vẫn hoàn thành** — không bao giờ bị cancel
- Sync-all task chạy song song Teams + Zalo → xong nhanh hơn 2x

---

## 3. Thay đổi chi tiết theo file

### 3.1. `src/lib/sync-queue.ts` — Thay đổi lớn nhất

#### 3.1.1. Tách cấu trúc dữ liệu

**Trước:**
```ts
let queue: SyncJob[] = [];
let currentJob: SyncJob | null = null;
let currentTask: ChatTask | null = null;
```

**Sau:**
```ts
// Queue riêng cho từng platform
let teamsQueue: SyncJob[] = [];
let zaloQueue: SyncJob[] = [];

// Trạng thái worker riêng cho từng platform
let teamsCurrentJob: SyncJob | null = null;
let teamsCurrentTask: ChatTask | null = null;
let zaloCurrentJob: SyncJob | null = null;
let zaloCurrentTask: ChatTask | null = null;
```

#### 3.1.2. `enqueueSyncJob()` — Phân loại task theo platform + cooldown

Khi nhận 1 job (ví dụ sync-all có 10 task Teams + 8 task Zalo):

```
Input: SyncJob { type: "all", tasks: [T1, T2, ..., T10, Z1, Z2, ..., Z8] }
                                       ↓
                    Phân loại theo task.platform
                                       ↓
Output: teamsTasks = [T1..T10] → tạo SyncJob push vào teamsQueue
        zaloTasks  = [Z1..Z8]  → tạo SyncJob push vào zaloQueue
```

**Logic cụ thể:**
- Tách `tasks` thành `teamsTasks` (platform === "teams") và `zaloTasks` (platform === "zalo")
- Nếu `teamsTasks` không rỗng → tạo job Teams, push vào `teamsQueue`
- Nếu `zaloTasks` không rỗng → tạo job Zalo, push vào `zaloQueue`
- Cả 2 job chia sẻ cùng `jobGroupId` (UUID mới) để UI gộp hiển thị
- **Dedup logic giữ nguyên** nhưng chỉ check trong queue của đúng platform
- **Job replacement logic giữ nguyên** (project job thay thế project job cũ) nhưng trong từng queue riêng

**Cooldown cho project sync:**
```ts
// Biến module-level
const lastProjectSyncDoneAt: Record<string, number> = {};
// key = `${platform}:${projectId}`, value = Date.now() khi project sync xong

const PROJECT_SYNC_COOLDOWN_MS = 3 * 60 * 1000; // 3 phút

// Trong enqueueSyncJob, nếu type === "project":
function enqueueSyncJob(type, tasks, projectId?) {
  if (type === "project" && projectId) {
    // Filter ra những task đang trong cooldown
    tasks = tasks.filter(t => {
      const key = `${t.platform}:${projectId}`;
      const lastDone = lastProjectSyncDoneAt[key];
      if (lastDone && Date.now() - lastDone < PROJECT_SYNC_COOLDOWN_MS) {
        console.log(`[Queue] Skip ${t.chatName} (${t.platform}) — cooldown còn ${Math.round((PROJECT_SYNC_COOLDOWN_MS - (Date.now() - lastDone)) / 1000)}s`);
        return false;
      }
      return true;
    });
    if (tasks.length === 0) return { ok: true, skipped: true }; // mọi nhóm đều đang cooldown
  }
  // ... phân loại + push vào queue như trên
}

// Khi worker chạy xong TẤT CẢ task của 1 project job:
function onProjectJobDone(job: SyncJob, platform: "teams" | "zalo") {
  if (job.type === "project" && job.projectId) {
    lastProjectSyncDoneAt[`${platform}:${job.projectId}`] = Date.now();
  }
}
```

**Thêm field `jobGroupId` vào `SyncJob`:**
```ts
interface SyncJob {
  id: string;
  jobGroupId?: string;  // MỚI — liên kết 2 job cùng 1 lần enqueue
  type: "project" | "all" | "single";
  // ... giữ nguyên
}
```

#### 3.1.3. 2 Worker loops

**Trước:** 1 hàm `startWorker()` → 1 worker loop

**Sau:** 2 hàm `startTeamsWorker()` + `startZaloWorker()`, mỗi cái:
- Lock file riêng: `.sync-queue-teams-worker.lock` / `.sync-queue-zalo-worker.lock`
- Chạy song song, hoàn toàn độc lập
- Logic bên trong giữ nguyên pattern cũ (lấy job → chạy từng task → check cancel)

```ts
async function startTeamsWorker() {
  if (!acquireWorkerLock("teams")) return; // .sync-queue-teams-worker.lock
  while (true) {
    const job = getNextJob("teams"); // lấy từ teamsQueue
    if (!job) { await sleep(2000); continue; }
    await runJob(job, "teams");
  }
}

async function startZaloWorker() {
  if (!acquireWorkerLock("zalo")) return; // .sync-queue-zalo-worker.lock
  while (true) {
    const job = getNextJob("zalo"); // lấy từ zaloQueue
    if (!job) { await sleep(2000); continue; }
    await runJob(job, "zalo");
  }
}
```

#### 3.1.4. `getNextJob(platform)` — Ưu tiên project, KHÔNG cancel sync-all

Worker gọi `getNextJob()` sau khi task hiện tại chạy xong. Logic ưu tiên:
1. Job `project` đang xem > job `project` khác > job `single` > job `all`
2. Task sync-all **không bị cancel** — chỉ bị "nhường" sau khi task hiện tại xong

```ts
function getNextJob(platform: "teams" | "zalo"): SyncJob | null {
  const q = platform === "teams" ? teamsQueue : zaloQueue;

  // Ưu tiên 1: job project đang xem
  if (activeProjectId) {
    const pj = q.find(j => j.type === "project" && j.projectId === activeProjectId);
    if (pj) { remove(q, pj); return pj; }
  }

  // Ưu tiên 2: job project bất kỳ > single > all
  const projectJob = q.find(j => j.type === "project");
  if (projectJob) { remove(q, projectJob); return projectJob; }

  const singleJob = q.find(j => j.type === "single");
  if (singleJob) { remove(q, singleJob); return singleJob; }

  return q.shift() ?? null; // all hoặc rỗng
}
```

**Lưu ý quan trọng:** Logic ưu tiên chỉ quyết định **task tiếp theo** sau khi task hiện tại XONG.
Task đang chạy **không bao giờ bị kill** bởi project sync — nó chạy xong tự nhiên (~15s) rồi worker mới lấy task mới.

#### 3.1.5. `setActiveProjectId()` — Chỉ ghi nhận, KHÔNG cancel

```ts
function setActiveProjectId(id: number | null) {
  activeProjectId = id;
  // KHÔNG cancel job all đang chạy
  // Worker sẽ tự ưu tiên task project ở lần getNextJob() tiếp theo
  // (sau khi task sync-all hiện tại chạy xong ~15s)
  
  if (id !== null) {
    console.log(`[Queue] Active project = ${id} — project tasks sẽ được ưu tiên`);
  }
}
```

**Tại sao KHÔNG cancel?**
- Cancel = kill Chrome giữa chừng → mất dữ liệu đang extract, Chrome treo
- Cancel = công cốc task đang chạy, lần sync-all sau phải chạy lại từ đầu
- Chờ 15s (1 task) là chấp nhận được — user không cảm nhận chậm

#### 3.1.6. Lock file tách riêng

**Trước:** Mọi task sync (Teams lẫn Zalo) đều ghi `.teams-sync-running`

**Sau:**
- Teams task ghi `.teams-sync-running` (giữ nguyên)
- Zalo task ghi `.zalo-sync-running` (**MỚI**)
- `isAnySyncRunning()` check **CẢ 2** file lock

```ts
function getSyncLockFile(platform: "teams" | "zalo"): string {
  return platform === "teams" ? ".teams-sync-running" : ".zalo-sync-running";
}

function isAnySyncRunning(): boolean {
  return isLockActive(".teams-sync-running") || isLockActive(".zalo-sync-running");
}
```

#### 3.1.7. Send preemption — Tách theo platform

- Teams worker chỉ check `.teams-send-running` (gửi tin Teams)
- Zalo worker chỉ check `.zalo-send-running` (gửi tin Zalo)
- Gửi tin Zalo **không ảnh hưởng** Teams worker và ngược lại

#### 3.1.8. `getSyncQueueStatus()` — Gộp 2 queue cho UI

```ts
function getSyncQueueStatus() {
  return {
    running: !!(teamsCurrentJob || zaloCurrentJob),
    // Gộp thông tin 2 worker
    teamsWorker: {
      currentJob: teamsCurrentJob,
      currentTask: teamsCurrentTask,
      queuedJobs: teamsQueue,
    },
    zaloWorker: {
      currentJob: zaloCurrentJob,
      currentTask: zaloCurrentTask,
      queuedJobs: zaloQueue,
    },
    // Thông tin gộp (tương thích ngược)
    queueLength: teamsQueue.length + zaloQueue.length,
    activeProjectId,
    lastAllSyncAt,
    // Progress gộp theo jobGroupId (cho job all)
    // ...
  };
}
```

#### 3.1.9. State file `.sync-queue-state.json`

Giữ nguyên cấu trúc, thêm track trạng thái 2 worker nếu cần:
```json
{
  "activeProjectId": 45,
  "lastAllSyncAt": "2026-08-10T15:00:00Z",
  "refetchTasks": []
}
```

#### 3.1.10. `isChatQueuedOrRunning()` — Giữ nguyên API, check đúng queue

```ts
function isChatQueuedOrRunning(projectId: number, chatName: string, platform: string): boolean {
  const q = platform === "teams" ? teamsQueue : zaloQueue;
  const current = platform === "teams" ? teamsCurrentTask : zaloCurrentTask;
  // check current + queue
}
```

---

### 3.2. `src/lib/sync-queue-runner.ts` — Sửa nhẹ

- `initSyncScheduler()`: gọi `startTeamsWorker()` + `startZaloWorker()` (thay vì `startWorker()`)
- Scheduler logic giữ nguyên: check interval → enqueue sync-all → `enqueueSyncJob()` tự chia 2 queue bên trong

---

### 3.3. Routes — Hầu như không sửa

#### `src/app/api/agents/sync-project-chats/route.ts`
- Không cần sửa logic — vẫn gọi `enqueueSyncJob()` như cũ, queue tự chia theo platform
- `action: "status"` gọi `getSyncQueueStatus()` trả format mới (có `teamsWorker` + `zaloWorker`)

#### `src/app/api/agents/sync-projects/route.ts`
- Giữ nguyên — gọi `enqueueSyncJob("all", tasks)`, queue tự chia

#### `src/app/api/agents/sync-single-chat/route.ts`
- Giữ nguyên — task đơn lẻ tự vào đúng queue theo `platform`

---

### 3.4. UI — Cập nhật hiển thị

#### `src/components/GlobalSyncManager.tsx`
- Không sửa logic chính — vẫn gọi route, route gọi queue
- Status check: giờ `running: true` khi BẤT KỲ worker nào đang chạy (tương thích)

#### `src/components/board/ProjectDetailPanel.tsx`
- Poll status: có thể hiển thị **2 spinner cùng lúc** (1 nhóm Teams + 1 nhóm Zalo chạy song song)
- Logic giữ nguyên: check `currentTask.projectId === project._id` → giờ check ở CẢ `teamsWorker.currentTask` lẫn `zaloWorker.currentTask`

#### Trang Omni — Section "Queue đồng bộ"
- **Tuỳ chọn**: Hiển thị 2 lane "Teams Worker" + "Zalo Worker", mỗi lane có task đang chạy + danh sách chờ
- Hoặc gộp thành 1 view thống nhất (dùng `jobGroupId` để gộp progress của job all)

---

## 4. Các file KHÔNG cần sửa

| File | Lý do |
|---|---|
| `agents/pm/scripts/sync-single-chat.ts` | Script con — xử lý 1 chat duy nhất, Chrome profile do env quyết định. Không biết về queue. |
| `agents/pm/lib/teams-automator.ts` | Automator — chỉ biết sync 1 chat, không biết queue |
| `agents/pm/lib/zalo-automator.ts` | Tương tự |
| `agents/pm/scripts/teams-send.ts` | Gửi tin — lock file riêng `.teams-send-running` |
| `agents/pm/scripts/zalo-send.ts` | Gửi tin — lock file riêng `.zalo-send-running` |
| `agents/pm/scripts/teams-health.ts` | Health check — không liên quan queue |
| `agents/pm/scripts/zalo-health.ts` | Tương tự |

---

## 5. Rủi ro & Lưu ý khi implement (ĐÃ CHECK 2 LẦN VỚI CODE THỰC TẾ)

> ⚠️ Phần này đối chiếu trực tiếp với code trong `sync-queue.ts`, `sync-single-chat.ts`, `teams-send.ts`, `zalo-send.ts`, `teams-automator.ts`, `zalo-automator.ts`. Mỗi rủi ro ghi rõ file + dòng liên quan.

---

### 🔴 5.1. `zalo-send.ts` check nhầm lock file — PHẢI SỬA

**Hiện trạng:** `zalo-send.ts` dòng 40:
```ts
const SYNC_RUNNING_FILE = path.join(process.cwd(), ".teams-sync-running");
```

`zalo-send.ts` đang check `.teams-sync-running` để biết có sync nào đang chạy không. Sau khi tách queue:
- Zalo sync sẽ ghi `.zalo-sync-running` (lock mới)
- Nhưng `zalo-send.ts` vẫn check `.teams-sync-running` (lock cũ) → **không thấy Zalo sync đang chạy** → mở Chrome cùng profile `.zalo-session` → **xung đột profile, crash hoặc dữ liệu hỏng**

**Giải pháp:** Sửa `zalo-send.ts` check `.zalo-sync-running` thay vì `.teams-sync-running`.

```ts
// TRƯỚC (sai):
const SYNC_RUNNING_FILE = path.join(process.cwd(), ".teams-sync-running");
// SAU (đúng):
const SYNC_RUNNING_FILE = path.join(process.cwd(), ".zalo-sync-running");
```

**File cần sửa:** `agents/pm/scripts/zalo-send.ts` dòng 40

---

### 🔴 5.2. `sync-single-chat.ts` ghi `.teams-sync-running` cho cả Zalo — PHẢI SỬA

**Hiện trạng:** `sync-single-chat.ts` dòng 601:
```ts
const SYNC_RUNNING_FILE = path.join(process.cwd(), ".teams-sync-running");
```

Script con (được queue spawn) tự ghi PID vào `.teams-sync-running` khi không chạy qua queue (`SYNC_QUEUE_MANAGED !== "1"`). Khi `SYNC_QUEUE_MANAGED=1`, queue đã tự quản lý lock file — nhưng queue hiện tại cũng ghi vào `.teams-sync-running` cho cả Zalo task.

**Giải pháp:**
- Queue (`sync-queue.ts`): `spawnTask` ghi lock theo platform → `.teams-sync-running` hoặc `.zalo-sync-running`
- Script con (`sync-single-chat.ts`): nếu không qua queue, ghi lock theo `PLATFORM` env

```ts
// sync-single-chat.ts — khi không qua queue:
const SYNC_RUNNING_FILE = path.join(process.cwd(),
  process.env.PLATFORM === "zalo" ? ".zalo-sync-running" : ".teams-sync-running"
);
```

**File cần sửa:**
- `src/lib/sync-queue.ts` — `spawnTask()` + `readRunningPids()` + `writeRunningPids()` tách theo platform
- `agents/pm/scripts/sync-single-chat.ts` dòng 601

---

### 🔴 5.3. `isAnySyncRunning()` trong queue — PHẢI TÁCH

**Hiện trạng:** `sync-queue.ts` dòng ~75:
```ts
export function isAnySyncRunning(): boolean {
  // check ".teams-sync-running"
  // check ".teams-send-running"
  // check ".zalo-send-running"
}
```

Hàm này được gọi trước mỗi task trong `runJobSequential` để chờ nếu có process khác đang dùng Chrome. Sau khi tách queue:
- Teams worker cần check: `.teams-sync-running` có PID nào NGOÀI worker này không? + `.teams-send-running`
- Zalo worker cần check: `.zalo-sync-running` có PID nào NGOÀI worker này không? + `.zalo-send-running`
- **KHÔNG NÊN** cross-check (Teams worker check Zalo lock hoặc ngược lại) — vì 2 platform dùng Chrome profile khác nhau

**Giải pháp:** Tách thành `isSyncRunning(platform)`:
```ts
function isSyncRunning(platform: "teams" | "zalo"): boolean {
  const syncLock = platform === "teams" ? ".teams-sync-running" : ".zalo-sync-running";
  const sendLock = platform === "teams" ? ".teams-send-running" : ".zalo-send-running";
  return isLockActive(syncLock) || isLockActive(sendLock);
}
```

Giữ `isAnySyncRunning()` wrapper cho các nơi cần check tổng (UI status):
```ts
export function isAnySyncRunning(): boolean {
  return isSyncRunning("teams") || isSyncRunning("zalo");
}
```

**File cần sửa:** `src/lib/sync-queue.ts`

---

### 🟡 5.4. `runJobSequential` check `currentJob?.id` — Logic thay thế job

**Hiện trạng:** Trong `runJobSequential`, giữa các task có check:
```ts
const isCurrent = currentJob?.id === job.id;
if (!isCurrent) { /* job bị hủy */ return; }
```

Sau khi tách, mỗi platform có `teamsCurrentJob` / `zaloCurrentJob` riêng. Cần đảm bảo:
- Teams worker chỉ check `teamsCurrentJob`, không đụng `zaloCurrentJob`
- Khi `enqueueSyncJob` thay thế project job, chỉ thay trong queue đúng platform

**Mức rủi ro:** Trung bình — nếu không tách đúng, job chạy dở có thể bị coi là "hủy" sai.

**Giải pháp:** Truyền `platform` vào `runJobSequential` để biết check đúng biến.

---

### 🟡 5.5. `refetchTasks` chia sẻ giữa 2 worker — Race condition

**Hiện trạng:** `refetchTasks` là biến module-level dùng chung:
```ts
let refetchTasks: ChatTask[] = [];
```

Khi 2 worker chạy song song, cả 2 đều push/splice `refetchTasks` → race condition (ít khả năng xảy ra vì Node.js single-threaded, nhưng giữa 2 `await` có thể interleave).

**Giải pháp:** Tách thành 2 biến:
```ts
let teamsRefetchTasks: ChatTask[] = [];
let zaloRefetchTasks: ChatTask[] = [];
```

Hoặc dùng 1 Map theo platform key. Vì Node.js single-threaded, race chỉ xảy ra khi logic await xen kẽ — nhưng tốt nhất tách sạch.

---

### 🟡 5.6. State file `.sync-queue-state.json` — 2 worker ghi đồng thời

**Hiện trạng:** `saveState()` được gọi sau mỗi task:
```ts
function saveState() {
  fs.writeFileSync(".sync-queue-state.json", JSON.stringify(state));
}
```

2 worker ghi cùng 1 file → file có thể bị corrupt (ghi chồng giữa chừng).

**Giải pháp:**
- **Option A (đơn giản):** Tách thành 2 file: `.sync-queue-teams-state.json` + `.sync-queue-zalo-state.json`
- **Option B (giữ 1 file):** Dùng atomic write (ghi tạm + rename) + merge state 2 worker. Node.js single-threaded nên 2 `writeFileSync` không thật sự race, nhưng tách file an toàn hơn.
- **Option C (tốt nhất):** Giữ state trong memory (đã là in-memory rồi), chỉ persist `lastAllSyncAt` + `activeProjectId` — 2 giá trị này CHUNG cho cả 2 worker nên chỉ cần 1 file, ghi bởi scheduler (không phải worker).

**Khuyến nghị:** Option C — worker KHÔNG ghi state file, chỉ scheduler ghi.

---

### 🟡 5.7. `runJobParallel` cho Teams — Tương tác với worker mới

**Hiện trạng:** Teams đã có `runJobParallel` chạy multi-tab CDP (tối đa 3 task cùng lúc). Sau khi tách:
- Teams worker RIÊNG chạy `runJobParallel` → OK, không ảnh hưởng Zalo
- Zalo worker LUÔN chạy `runJobSequential` → OK

**Nhưng:** `runJobParallel` dùng `runningChildren` (shared Set) và `writeRunningPids` (ghi `.teams-sync-running`). Nếu Zalo worker cũng ghi `.zalo-sync-running` dùng cùng `readRunningPids`/`writeRunningPids` helper → NHẦM FILE.

**Giải pháp:** Tách `readRunningPids(platform)` / `writeRunningPids(platform, pids)`:
```ts
const LOCK_FILES = {
  teams: ".teams-sync-running",
  zalo: ".zalo-sync-running",
};
function readRunningPids(platform: "teams" | "zalo"): number[] { ... }
function writeRunningPids(platform: "teams" | "zalo", pids: number[]): void { ... }
```

---

### 🟢 5.8. `teams-automator.ts` + `zalo-automator.ts` — `isSendWaiting()` kiểm tra CẢ 2 send lock

**Hiện trạng:** Cả 2 automator đều check cả `.teams-send-running` VÀ `.zalo-send-running`:
```ts
// teams-automator.ts dòng 36:
for (const file of [".teams-send-running", ".zalo-send-running"]) { ... }
```

Sau khi tách queue, automator không cần sửa — chúng được spawn bởi `sync-single-chat.ts` (script con), không biết về queue. Send preemption trong automator vẫn check cả 2 lock vì **khi sync Teams đang chạy mà user muốn gửi Zalo, Chrome profile Zalo không liên quan nên không cần dừng Teams sync**. Nhưng automator check sẵn cũng vô hại (sẽ thấy send lock khác platform → dừng sớm — không hại, chỉ hơi thừa).

**Tuy nhiên:** Với kiến trúc mới, send preemption nên tách theo platform:
- Teams automator chỉ check `.teams-send-running` (Zalo send không ảnh hưởng Teams Chrome)
- Zalo automator chỉ check `.zalo-send-running`

**Mức rủi ro:** Thấp — không gây lỗi, chỉ dừng sync thừa (mất 1 vòng 2 phút rồi chạy lại). Có thể sửa sau.

**File cần sửa (tuỳ chọn):**
- `agents/pm/lib/teams-automator.ts` dòng 36
- `agents/pm/lib/zalo-automator.ts` dòng 33

---

### 🟢 5.9. `sync-all-projects.ts` + `sync-project-chats.ts` — Script cũ dùng lock cũ

**Hiện trạng:** 2 script cũ (không dùng bởi queue nhưng vẫn chạy được từ CLI):
- `sync-all-projects.ts` dòng 23: `const RUNNING_FILE = ".teams-sync-running"`
- `sync-project-chats.ts` dòng 30: `const RUNNING_FILE = ".teams-sync-running"`

Nếu user chạy tay `npx tsx agents/pm/scripts/sync-all-projects.ts`, nó ghi `.teams-sync-running` → queue Teams worker thấy → chờ 90s rồi skip. Nhưng Zalo tasks trong script đó KHÔNG ghi `.zalo-sync-running` → queue Zalo worker không biết → **có thể xung đột Chrome profile Zalo**.

**Mức rủi ro:** Thấp — script cũ hiếm khi chạy tay (queue đã thay thế). Nhưng nên sửa cho an toàn.

**Giải pháp:** Cập nhật 2 script cũ ghi lock theo platform đang sync.

---

### 🟢 5.10. `GlobalSyncManager` interval 2 phút vs cooldown 3 phút — Khoảng trống

**Hiện trạng:** `GlobalSyncManager` fire project sync mỗi 120s (2 phút). Cooldown mới là 3 phút.

**Kịch bản:**
```
0:00  Project sync xong → cooldown bắt đầu (3 phút)
2:00  GlobalSyncManager fire → cooldown còn 1 phút → BỎ QUA ✓
4:00  GlobalSyncManager fire → cooldown hết → CHẠY ✓
```

**Vấn đề nhỏ:** Giữa 3:00 (cooldown hết) và 4:00 (fire tiếp theo), có 1 phút không ai sync project. Điều này OK — không phải bug, chỉ là khoảng trống tự nhiên.

**Tuỳ chọn cải thiện:** Có thể tăng interval lên 3 phút (khớp cooldown) hoặc giảm cooldown xuống 2 phút. Không bắt buộc.

---

### 🔴 5.11. `send preemption` trong queue — Kill task CROSS-PLATFORM

**Hiện trạng:** `runTaskWithSendPreemption` trong `sync-queue.ts` dòng ~535:
```ts
for (const file of [SEND_RUNNING_FILE, path.join(process.cwd(), ".zalo-send-running")]) {
```

Queue hiện tại check CẢ 2 send lock (`.teams-send-running` + `.zalo-send-running`) rồi kill task đang chạy. Sau khi tách:
- Teams worker đang chạy Teams task → user bấm gửi tin Zalo → `.zalo-send-running` xuất hiện → Teams worker **kill Teams task** → VÔ LÝ (Zalo send không cần Teams Chrome dừng)

**Giải pháp:** Truyền `platform` vào `runTaskWithSendPreemption`:
```ts
async function runTaskWithSendPreemption(task: ChatTask, platform: "teams" | "zalo") {
  const sendLock = platform === "teams" ? ".teams-send-running" : ".zalo-send-running";
  // Chỉ check send lock của ĐÚNG platform
}
```

**File cần sửa:** `src/lib/sync-queue.ts` — `runTaskWithSendPreemption()`

---

## 6. Rủi ro bổ sung (phát hiện từ scan toàn bộ codebase — LẦN 3)

---

### 🔴 5.12. `cancelCurrentJob()` vẫn tồn tại trong `setActiveProjectId` — PHẢI XOÁ

**Hiện trạng:** `sync-queue.ts` dòng ~136:
```ts
function setActiveProjectId(id: number | null) {
  activeProjectId = id;
  if (id !== null) {
    if (currentJob?.type === "all") cancelCurrentJob(); // ← VẪN CÒN
  }
}
```

Plan nói "KHÔNG cancel" nhưng code cũ có `cancelCurrentJob()`. Nếu agent chỉ tách queue mà quên xoá dòng này → vẫn kill task giữa chừng → mất tiến trình sync-all.

**Giải pháp:** XOÁ dòng `cancelCurrentJob()` trong `setActiveProjectId`. Xem mục 3.1.5 của plan.

**File cần sửa:** `src/lib/sync-queue.ts` — `setActiveProjectId()`

---

### 🔴 5.13. `checkCdpAvailable()` quyết định parallel — Zalo KHÔNG ĐƯỢC dùng

**Hiện trạng:** `sync-queue.ts` dòng ~370+432:
```ts
async function checkCdpAvailable(): Promise<boolean> {
  // check CDP port 9222 (Chrome Teams)
}

// Trong startWorker:
const canParallel = await checkCdpAvailable();
await runJob(nextJob, canParallel); // parallel cho TẤT CẢ task
```

CDP port 9222 là Chrome Teams. Nếu Zalo worker cũng gọi `checkCdpAvailable()` → `canParallel = true` → `runJobParallel` cho Zalo → mở nhiều tab qua CDP Teams Chrome → **Zalo chặn multi-tab** (overlay "Đang mở ở tab khác") + connect nhầm profile Teams → **ĐÁ LOGOUT Zalo**.

**Giải pháp:**
```ts
// Teams worker:
const canParallel = await checkCdpAvailable();
// Zalo worker:
const canParallel = false; // LUÔN sequential
```

**File cần sửa:** `src/lib/sync-queue.ts` — 2 worker mới

---

### 🔴 5.14. `zalo-automator/route.ts` — `stopBackgroundSync()` kill nhầm Teams sync

**Hiện trạng:** `src/app/api/agents/zalo-automator/route.ts` dòng 17+20:
```ts
const SYNC_RUNNING_FILE = path.join(process.cwd(), ".teams-sync-running");

function stopBackgroundSync() {
  if (fs.existsSync(SYNC_RUNNING_FILE)) {
    const pid = parseInt(fs.readFileSync(SYNC_RUNNING_FILE, "utf-8").trim(), 10);
    if (!isNaN(pid)) process.kill(pid, 9); // SIGKILL ← !
    fs.unlinkSync(SYNC_RUNNING_FILE);
  }
}
```

Khi user login Zalo headfull → gọi `stopBackgroundSync()` → kill process trong `.teams-sync-running` → **KILL TEAMS SYNC** (không phải Zalo sync). Sau khi tách:
- Cần kill `.zalo-sync-running` (Zalo sync đang chiếm `.zalo-session` profile)
- KHÔNG kill `.teams-sync-running` (Teams sync dùng profile riêng, không ảnh hưởng)

**Giải pháp:**
```ts
const SYNC_RUNNING_FILE = path.join(process.cwd(), ".zalo-sync-running"); // ← SỬA
```

**Lưu ý:** File lock mới chứa NHIỀU PID (format multi-line), nhưng `stopBackgroundSync` chỉ đọc 1 PID. Cần sửa để kill TẤT CẢ PIDs trong file:
```ts
function stopBackgroundSync() {
  const lockFile = path.join(process.cwd(), ".zalo-sync-running");
  try {
    if (fs.existsSync(lockFile)) {
      const pids = fs.readFileSync(lockFile, "utf-8").split("\n")
        .map(l => parseInt(l.trim(), 10)).filter(p => !isNaN(p));
      for (const pid of pids) {
        try { process.kill(pid, 9); } catch { /* dead */ }
      }
      fs.unlinkSync(lockFile);
    }
  } catch { /* */ }
}
```

**File cần sửa:** `src/app/api/agents/zalo-automator/route.ts` dòng 17+20-28

**Cũng check:** `src/app/api/agents/teams-automator/route.ts` dòng 15 — cái này check `.teams-sync-running` cho Teams login → ĐÃ ĐÚNG, không cần sửa.

---

### 🟡 5.15. `enqueueJob` rejection/replacement logic — Phải check CẢ 2 queue

**Hiện trạng:** `sync-queue.ts` `enqueueJob`:
```ts
// Reject sync-all nếu đã có trong queue
if (type === "all") {
  const existingAll = queue.find(j => j.type === "all");
  if (existingAll) return { ok: false };
}

// Thay thế project job cùng projectId
if (type === "project") {
  queue = queue.filter(j => !(j.type === "project" && j.projectId === projectId));
}
```

Sau khi tách, 1 lần enqueue sync-all tạo ra 2 job (Teams + Zalo). Logic rejection/replacement phải check CẢ 2 queue:

```ts
// Reject: check cả 2 queue
if (type === "all") {
  if (teamsQueue.find(j => j.type === "all") || zaloQueue.find(j => j.type === "all")) {
    return { ok: false, reason: "sync-all already queued" };
  }
}

// Replace: xoá ở cả 2 queue
if (type === "project") {
  teamsQueue = teamsQueue.filter(j => !(j.type === "project" && j.projectId === projectId));
  zaloQueue = zaloQueue.filter(j => !(j.type === "project" && j.projectId === projectId));
}
```

**File cần sửa:** `src/lib/sync-queue.ts` — `enqueueJob()`

---

### 🟡 5.16. `getSyncQueueStatus()` — UI đọc `currentJob` / `currentJobTasks` / `progress`

**Hiện trạng — 3 UI consumer khác nhau:**

**ProjectDetailPanel** (poll mỗi 2.5s):
```ts
const cur = data.currentTask as { projectId, chatName, platform };
if (cur?.projectId === project._id && cur.chatName) {
  // show spinner cho group này
}
```

**Omni page** (poll mỗi 5s):
```ts
// Hiển thị: currentJob.label, progress (current/total/message), 
// currentJobTasks[], queuedJobs[]
```

**GlobalSyncManager:**
```ts
if (data.running) { /* sync is running */ }
```

Sau khi tách, có thể có **2 current job cùng lúc** (1 Teams + 1 Zalo). UI cũ chỉ đọc 1 `currentJob`.

**Giải pháp — backward compatible:**
```ts
function getSyncQueueStatus() {
  return {
    // Gộp cho backward compat
    running: !!(teamsCurrentJob || zaloCurrentJob),
    progress: { current: teamsDone + zaloDone, total: teamsTotal + zaloTotal, message: "..." },
    currentJob: teamsCurrentJob || zaloCurrentJob, // 1 trong 2
    currentJobTasks: [...teamsTasksWithStatus, ...zaloTasksWithStatus], // GỘP
    queuedJobs: [...teamsQueue, ...zaloQueue],
    queueLength: teamsQueue.length + zaloQueue.length,
    activeProjectId, lastAllSyncAt,
    // MỚI — chi tiết từng worker
    teamsWorker: { currentJob, currentTask, queue },
    zaloWorker: { currentJob, currentTask, queue },
  };
}
```

**Đặc biệt cho ProjectDetailPanel:** `currentTask` cũ là 1 task, nhưng giờ có thể 2 task chạy cùng lúc. Cần thêm mảng `currentTasks` (plural):
```ts
currentTasks: [teamsCurrentTask, zaloCurrentTask].filter(Boolean),
```

UI check: `data.currentTasks?.some(t => t.projectId === project._id && t.chatName === group.name)`

**File cần sửa:**
- `src/lib/sync-queue.ts` — `getSyncQueueStatus()`
- `src/components/board/ProjectDetailPanel.tsx` — đọc `currentTasks` thay vì `currentTask`
- `src/app/(dashboard)/omni/page.tsx` — (tuỳ chọn) hiện 2 lane

---

### 🟡 5.17. `runningChildren` shared Set — Kill nhầm cross-platform

**Hiện trạng:** `sync-queue.ts`:
```ts
const runningChildren = new Set<ReturnType<typeof spawn>>();
```

`runTaskWithSendPreemption` kill TẤT CẢ children khi phát hiện send lock:
```ts
for (const child of runningChildren) {
  if (!child.killed) child.kill("SIGTERM");
}
```

Sau khi tách, nếu vẫn dùng chung 1 Set → Teams send preemption sẽ kill cả Zalo child process (và ngược lại).

**Giải pháp:** Tách `runningChildren` per platform:
```ts
const teamsRunningChildren = new Set<ChildProcess>();
const zaloRunningChildren = new Set<ChildProcess>();
```

Worker chỉ kill children của đúng platform mình.

**File cần sửa:** `src/lib/sync-queue.ts`

---

### 🟢 5.18. `maybeAutoGenerateSummary` — 2 worker trigger cùng lúc cho cùng project

Nếu Teams worker và Zalo worker cùng sync project 45, cả 2 xong gần nhau → cả 2 gọi `maybeAutoGenerateSummary(project 45)`. Rate-limit 5 phút bằng biến in-memory — nhưng giữa 2 `await`, cả 2 có thể check trước khi cái kia ghi → **sinh 2 bản summary gần nhau**.

**Mức rủi ro:** Thấp — worst case là 2 version summary cách nhau vài giây. Không mất dữ liệu.

**Giải pháp (tuỳ chọn):** Dùng flag `summaryGenerating[projectId] = true` trước await.

---

## 7. Bảng tổng hợp: Biến module-level trong `sync-queue.ts` cần tách

| Biến | Hiện tại | Cần tách? | Ghi chú |
|------|----------|-----------|---------|
| `queue: SyncJob[]` | Mảng duy nhất | ✅ → `teamsQueue` + `zaloQueue` | |
| `currentJob: SyncJob \| null` | 1 biến | ✅ → per platform | 12+ nơi đọc/ghi |
| `currentTask: ChatTask \| null` | 1 biến | ✅ → per platform | 7+ nơi đọc/ghi |
| `taskStatuses: Record<string, string>` | 1 object | ✅ → per platform | Reset `{}` trong `runJob` sẽ xoá status platform kia |
| `jobStartTime: number` | 1 biến | ✅ → per platform | `getSyncQueueStatus` tính elapsed |
| `taskIndexInJob: number` | 1 biến | ✅ → per platform | `getSyncQueueStatus` hiện progress |
| `refetchTasks: ChatTask[]` | 1 mảng | ✅ → per platform | |
| `runningChildren: Set` | 1 Set | ✅ → per platform | 🔴 Kill nhầm cross-platform nếu chung |
| `RUNNING_FILE` | `.teams-sync-running` | ✅ → per platform | |
| `SEND_RUNNING_FILE` | `.teams-send-running` | ✅ → per platform | |
| `WORKER_LOCK_FILE` | `.sync-queue-worker.lock` | ✅ → 2 lock file | 🔴 Chỉ 1 worker start được nếu chung |
| `activeProjectId: number \| null` | 1 biến | ❌ Giữ chung | 1 user, 1 project đang xem |
| `currentRunnerUserId: string` | 1 biến | ❌ Giữ chung | |
| `userIds: Record<string, string>` | 1 object | ❌ Giữ chung | Lookup table |
| `cancelCurrentJob` function | kill `runningChildren` | ❌ **XOÁ** | Plan bỏ cancel — chỉ interleave |

**Gợi ý cấu trúc code:**
```ts
interface PlatformWorkerState {
  queue: SyncJob[];
  currentJob: SyncJob | null;
  currentTask: ChatTask | null;
  taskStatuses: Record<string, string>;
  jobStartTime: number;
  taskIndexInJob: number;
  refetchTasks: ChatTask[];
  runningChildren: Set<ChildProcess>;
}

const workers: Record<"teams" | "zalo", PlatformWorkerState> = {
  teams: createEmptyWorkerState(),
  zalo: createEmptyWorkerState(),
};

// Biến chung (không tách)
let activeProjectId: number | null = null;
let currentRunnerUserId = "";
const userIds: Record<string, string> = {};
const lastProjectSyncDoneAt: Record<string, number> = {};
```

---

## 8. Tổng hợp TẤT CẢ file cần sửa

| File | Mức | Thay đổi |
|------|-----|----------|
| `src/lib/sync-queue.ts` | 🔴 | **Lớn nhất** — tách queue/worker/lock/state, xoá cancel, cooldown, interleave |
| `agents/pm/scripts/zalo-send.ts` | 🔴 | Sửa `SYNC_RUNNING_FILE` → `.zalo-sync-running` |
| `agents/pm/scripts/sync-single-chat.ts` | 🔴 | Sửa `SYNC_RUNNING_FILE` theo `PLATFORM` env |
| `src/app/api/agents/zalo-automator/route.ts` | 🔴 | Sửa `stopBackgroundSync` → check `.zalo-sync-running` |
| `src/lib/sync-queue-runner.ts` | 🟡 | Gọi `startTeamsWorker()` + `startZaloWorker()` |
| `src/components/board/ProjectDetailPanel.tsx` | 🟡 | Đọc `currentTasks` (plural) thay vì `currentTask` |
| `agents/pm/lib/teams-automator.ts` | 🟢 | Chỉ check `.teams-send-running` (bỏ `.zalo-send-running`) |
| `agents/pm/lib/zalo-automator.ts` | 🟢 | Chỉ check `.zalo-send-running` (bỏ `.teams-send-running`) |
| `agents/pm/scripts/sync-all-projects.ts` | 🟢 | Script cũ — ghi lock theo platform |
| `agents/pm/scripts/sync-project-chats.ts` | 🟢 | Script cũ — ghi lock theo platform |
| `src/app/(dashboard)/omni/page.tsx` | 🟢 | (Tuỳ chọn) hiện 2 lane worker |

**File KHÔNG cần sửa:**
- `agents/pm/scripts/teams-send.ts` — check `.teams-sync-running` → đúng rồi
- `src/app/api/agents/teams-automator/route.ts` — check `.teams-sync-running` → đúng rồi
- `agents/pm/scripts/teams-health.ts` / `zalo-health.ts` — dùng `pgrep`, không check lock file
- `agents/pm/scripts/hourly-healthcheck.ts` — chỉ spawn health scripts
- `scripts/deploy/*.plist` — không liên quan

---

## 9. Tổng kết rủi ro theo mức độ

| Mức | Mô tả | Số lượng | Danh sách |
|-----|-------|----------|-----------|
| 🔴 | **Phải sửa** — crash/xung đột profile/logic sai | **7** | 5.1, 5.2, 5.3, 5.11, 5.12, 5.13, 5.14 |
| 🟡 | **Nên sửa** — bug edge case / race / UI vỡ | **5** | 5.4, 5.5, 5.15, 5.16, 5.17 |
| 🟢 | **Sửa sau** — không lỗi nghiêm trọng, tối ưu | **4** | 5.8, 5.9, 5.10, 5.18 |

---

## 10. Checklist cho agent implement (PHIÊN BẢN ĐẦY ĐỦ — 16 ITEMS)

```
TRƯỚC KHI CODE:
□ Đọc mục 2 + 2.1 (kiến trúc + chống starvation — interleave + cooldown)
□ Đọc mục 3 (thay đổi chi tiết từng file)
□ Đọc mục 5 + 6 (rủi ro — ĐẶC BIỆT các mục 🔴)
□ Đọc mục 7 (bảng biến cần tách) + mục 8 (bảng file cần sửa)

KHI CODE — Theo thứ tự ưu tiên:

🔴 BẮT BUỘC (7 items):
□ 5.12 XOÁ cancelCurrentJob() trong setActiveProjectId() — chỉ ghi activeProjectId
□ 5.13 Zalo worker: canParallel = false (LUÔN sequential, KHÔNG gọi checkCdpAvailable)
□ 5.1  Sửa zalo-send.ts dòng 40: SYNC_RUNNING_FILE → ".zalo-sync-running"
□ 5.2  Sửa sync-single-chat.ts dòng 601 + sync-queue.ts spawnTask(): lock file theo PLATFORM env
□ 5.3  Tách isAnySyncRunning() → isSyncRunning(platform) cho worker loop;
       giữ isAnySyncRunning() wrapper cho route/scheduler/UI
□ 5.11 Tách runTaskWithSendPreemption — chỉ check send lock đúng platform
□ 5.14 Sửa zalo-automator/route.ts: stopBackgroundSync check ".zalo-sync-running" (multi-PID)

🟡 NÊN LÀM (5 items):
□ 5.4+5.5+5.17 Tách TẤT CẢ biến module-level per platform → dùng PlatformWorkerState struct
       (queue, currentJob, currentTask, taskStatuses, jobStartTime, taskIndexInJob,
        refetchTasks, runningChildren)
□ 5.6  State file: worker KHÔNG ghi, chỉ scheduler ghi (activeProjectId + lastAllSyncAt)
       HOẶC tách 2 state file per platform
□ 5.15 enqueueJob: rejection sync-all check CẢ 2 queue; replacement project xoá CẢ 2 queue
□ 5.16 getSyncQueueStatus: gộp currentJobTasks từ 2 worker; thêm currentTasks (plural);
       thêm teamsWorker/zaloWorker chi tiết
       + Sửa ProjectDetailPanel đọc currentTasks thay vì currentTask
□ 5.7  Tách acquireWorkerLock(platform) → 2 lock file riêng

🟢 TUỲ CHỌN (4 items):
□ 5.8  Tách isSendWaiting trong automator theo platform (teams-automator.ts, zalo-automator.ts)
□ 5.9  Cập nhật sync-all-projects.ts + sync-project-chats.ts script cũ (lock theo platform)
□ 5.10 Align GlobalSyncManager interval = cooldown
□ 5.18 Mutex cho maybeAutoGenerateSummary (tránh 2 summary cùng project cùng lúc)

SAU KHI CODE:
□ node_modules/.bin/tsc --noEmit → exit 0
□ Verify lock file đúng platform: ls -la .teams-sync-running .zalo-sync-running
□ Verify 2 worker chạy song song (2 lock file .sync-queue-*-worker.lock tồn tại cùng lúc)
□ Verify Zalo KHÔNG chạy parallel (log KHÔNG có "⚡ Chạy song song" cho Zalo task)
□ Verify cooldown: log "[Queue] Skip ... cooldown còn Xs"
□ Verify interleave: task sync-all KHÔNG bị kill khi mở project (log KHÔNG có SIGTERM/cancel)
□ Verify gửi tin Zalo KHÔNG kill Teams sync child process
□ Verify gửi tin Teams KHÔNG kill Zalo sync child process
□ Verify zalo-send chờ đúng lock: log "Dang co sync chay" khi Zalo sync chạy
□ Verify Zalo login (headfull) chỉ kill Zalo sync, KHÔNG kill Teams sync
□ Verify UI: ProjectDetailPanel hiện 2 spinner cùng lúc (1 Teams + 1 Zalo)
```

---

## 11. Verify sau khi implement

### Build check
```bash
node_modules/.bin/tsc --noEmit
```

### Verify thủ công — ưu tiên theo rủi ro
1. **🔴 Lock file đúng platform:** `ls -la .teams-sync-running .zalo-sync-running` — mỗi file chỉ chứa PID đúng platform
2. **🔴 Worker lock:** `ls -la .sync-queue-*-worker.lock` — 2 file tồn tại khi cả 2 worker chạy
3. **🔴 Zalo KHÔNG parallel:** Log Zalo worker KHÔNG có "⚡ Chạy song song"
4. **🔴 Send không kill nhầm:** Gửi tin Zalo → Teams worker log KHÔNG có "SIGTERM" / "kill"
5. **🔴 `zalo-send` chờ đúng lock:** Gửi tin khi Zalo sync → log "Dang co sync chay — cho sync xong"
6. **🔴 Không cancel khi mở project:** Mở project lúc sync-all → log KHÔNG có "hủy" / "cancel"
7. **🔴 Zalo login không kill Teams:** Login Zalo headfull → Teams sync vẫn chạy (log Teams tiếp tục)
8. **🟡 Cooldown:** Project sync xong → log "[Queue] Skip" ở lần fire tiếp (trong 3 phút)
9. **🟡 Interleave:** sync-all → mở project → task hiện tại chạy xong → project task chạy → sync-all tiếp
10. **🟡 UI spinner:** 2 spinner cùng lúc cho 2 nhóm khác platform
11. **🟢 Song song:** Project 1 Teams + 1 Zalo → log timestamp cách <2s
12. **🟢 Omni progress:** Hiện số gộp (vd "15/20") khi sync-all chạy 2 queue


