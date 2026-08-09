/**
 * Bộ lập lịch sync-all định kỳ — chạy bên trong next-server (khởi động lazy
 * khi route API đầu tiên được gọi, vì cần userId từ Clerk).
 *
 * Mỗi `autoSyncInterval` phút (mặc định 30), nếu:
 * - Không mở project nào (queue ưu tiên project đang xem sẽ chiếm Chrome)
 * - Không có job nào đang chạy/đang chờ
 * thì enqueue job sync-all: TẤT CẢ nhóm chat đã add của user, incremental
 * theo watermark (không phải full sync).
 */

import {
  enqueueJob,
  getSyncQueueStatus,
  buildAllChatTasks,
  initWorkerState,
  setActiveProjectId,
} from "./sync-queue";

let started = false;
let activeProjectId: string | null = null;
let lastAllSyncAt = 0;

export function setActiveProjectIdGlobal(projectId: string | null) {
  activeProjectId = projectId;
  setActiveProjectId(projectId);
}

export function getActiveProjectIdGlobal() {
  return activeProjectId;
}

export function startSyncScheduler(userId: string) {
  if (started) return;
  started = true;

  initWorkerState();

  setInterval(async () => {
    try {
      // Đang mở project → job project chiếm Chrome — không sync-all
      if (activeProjectId) return;
      const status = getSyncQueueStatus();
      if (status.running || status.queueLength > 0) return;

      // Interval theo cài đặt user (phút), mặc định 30 nếu chưa đặt
      const { getActiveProjectsWithTeamsGroups } = await import("./repo/projects");
      const { getUserPreferences } = await import("./repo/userPreferences");

      let intervalMs = 30 * 60 * 1000;
      try {
        const prefs = await getUserPreferences(userId);
        const mins = Number(prefs.autoSyncInterval) || 30;
        if (mins <= 0) return; // user tắt → không sync tự động
        intervalMs = mins * 60 * 1000;
      } catch { /* dùng mặc định 30 */ }

      // Chưa đủ interval kể từ lần chạy trước → chờ
      const now = Date.now();
      if (now - lastAllSyncAt < intervalMs) return;
      lastAllSyncAt = now;

      const tasks = await buildAllChatTasks(userId);
      if (tasks.length === 0) {
        console.log("[SyncScheduler] Không có nhóm chat nào cần sync (chưa add group).");
        return;
      }

      // Enqueue sync-all — worker có thể đang chạy job project/khác,
      // nhưng enqueue chỉ thành công khi queue không có job all khác.
      const result = enqueueJob({
        id: `all-${now}`,
        label: `sync-all (${tasks.length} chats, ${userId.slice(0, 8)}…)`,
        type: "all",
        chatTasks: tasks,
        createdAt: now,
      });
      if (!result.ok) {
        console.warn("[SyncScheduler] Không enqueue được sync-all:", result.reason);
      } else {
        // Cập nhật mốc "quét cuối" cho UI Omni (LastSyncTime)
        try {
          const { updateUserPreferences } = await import("./repo/userPreferences");
          await updateUserPreferences({ userId, lastSyncTime: now });
        } catch { /* không nghiêm trọng */ }
      }
    } catch (err) {
      console.error("[SyncScheduler] Error:", err);
    }
  }, 15_000);

  console.log(`[SyncScheduler] Bộ lập lịch sync-all bắt đầu (user ${userId.slice(0, 8)}…).`);
}