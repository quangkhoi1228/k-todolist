import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  enqueueJob,
  getSyncQueueStatus,
  buildAllChatTasks,
} from "@/lib/sync-queue";
import { startSyncScheduler } from "@/lib/sync-queue-runner";

/**
 * POST /api/agents/sync-projects
 *
 * Đã chuyển sang queue tập trung (`sync-queue.ts`): action "start" enqueue job
 * sync-all (tất cả nhóm chat đã add của user, incremental) thay vì spawn
 * sync-all-projects.ts trực tiếp. Action "status" trả trạng thái queue.
 *
 * Body: { action: "status" | "start" }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session.userId;
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // Khởi động bộ lập lịch sync-all định kỳ (theo autoSyncInterval, mặc định 30 phút)
    startSyncScheduler(userId);

    const body = await req.json();
    const action = body.action as string | undefined;

    if (action === "status") {
      const status = getSyncQueueStatus();
      return NextResponse.json({ ...status, running: status.running });
    }

    // Manual sync (nút "Đồng bộ ngay" trên Omni) — enqueue sync-all
    if (action === "start") {
      const tasks = await buildAllChatTasks(userId);
      if (tasks.length === 0) {
        return NextResponse.json({ ok: false, error: "Không có nhóm chat nào cần sync (chưa add group)." });
      }
      const status = getSyncQueueStatus();
      if (status.running) {
        return NextResponse.json({ ok: false, error: "A sync process is already running." });
      }
      if (status.queueLength > 0) {
        return NextResponse.json({ ok: false, error: "Sync khác đang chờ trong queue — thử lại sau." });
      }
      const result = enqueueJob({
        id: `all-manual-${Date.now()}`,
        label: `sync-all (manual, ${tasks.length} chats)`,
        type: "all",
        chatTasks: tasks,
        createdAt: Date.now(),
      });
      return NextResponse.json({
        ok: result.ok,
        message: result.ok ? `Đã xếp ${tasks.length} nhóm chat vào queue.` : result.reason,
      });
    }

    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("[SyncProjects API] Error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}