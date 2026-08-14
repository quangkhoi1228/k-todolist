import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  enqueueJob,
  getSyncQueueStatus,
  buildChatTasksForProject,
  buildAllChatTasks,
  setActiveProjectId,
  initWorkerState,
} from "@/lib/sync-queue";
import { startSyncScheduler } from "@/lib/sync-queue-runner";
import { getProject } from "@/lib/repo/projects";

/**
 * POST /api/agents/sync-project-chats
 *
 * Enqueue job sync TUẦN TỰ các nhóm chat (Teams + Zalo) của ĐÚNG project đang
 * user mở, vào queue tập trung (ưu tiên job project đang xem). Mỗi nhóm chạy
 * qua sync-single-chat.ts, incremental theo watermark — nhanh, vài giây/nhóm.
 *
 * Body: { projectId, syncMode? ("incremental"|"full") }
 * Action:
 *   { action: "status" }                  — trạng thái queue (đang chạy job nào)
 *   { action: "setActiveProject" }        — báo server project đang xem (projectId)
 *   { action: "clearActiveProject" }      — rời project / về trang khác
 *   { action: "syncAllNow" }              — enqueue sync-all ngay (nút manual, 30 phút)
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session.userId;
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // Khởi động bộ lập lịch 30 phút (nếu chưa) — lần đầu có userId
    startSyncScheduler(userId);

    const body = await req.json();
    const action = body.action as string | undefined;
    const projectId = body.projectId as string | undefined;

    if (action === "status") {
      return NextResponse.json({ ok: true, ...getSyncQueueStatus() });
    }

    // Đánh dấu project đang xem — job project được ưu tiên trong queue
    if (action === "setActiveProject") {
      if (!projectId) return NextResponse.json({ ok: false, error: "Missing projectId" }, { status: 400 });
      setActiveProjectId(projectId);
      return NextResponse.json({ ok: true, activeProjectId: projectId });
    }

    if (action === "clearActiveProject") {
      setActiveProjectId(null);
      return NextResponse.json({ ok: true });
    }

    if (action === "syncAllNow") {
      const tasks = await buildAllChatTasks(userId);
      if (tasks.length === 0) {
        return NextResponse.json({ ok: false, error: "Không có nhóm chat nào cần sync (chưa add group)." });
      }
      const status = getSyncQueueStatus();
      if (status.queueLength > 0 || status.running) {
        // Ưu tiên: nếu sync-all đang chạy → chỉ báo; nếu project đang xem thì không chèn lên
        return NextResponse.json({ ok: false, error: "Sync khác đang chạy — thử lại sau." });
      }
      const result = enqueueJob({
        id: `all-manual-${Date.now()}`,
        label: `sync-all (manual, ${tasks.length} chats)`,
        type: "all",
        chatTasks: tasks,
        createdAt: Date.now(),
      });
      return NextResponse.json({ ok: result.ok, message: result.ok ? "Đã xếp hàng đợi sync-all." : result.reason });
    }

    if (!projectId) {
      return NextResponse.json({ ok: false, error: "Missing projectId" }, { status: 400 });
    }

    // Không sync project đã archive/delete — trả lỗi ngay, không enqueue.
    try {
      const project = await getProject(projectId);
      if (!project) {
        return NextResponse.json({ ok: false, error: "Dự án không tồn tại." }, { status: 404 });
      }
      if ((project as any)?.archived || (project as any)?.deletedAt) {
        return NextResponse.json({ ok: false, error: "Dự án đã lưu trữ hoặc xoá — không đồng bộ." }, { status: 400 });
      }
    } catch (e) {
      console.warn("[SyncProjectChats API] Could not check project status:", e);
    }

    // Sync project đang xem: tự build nhóm chat từ teamsGroups (incremental luôn)
    const tasks = await buildChatTasksForProject(projectId, userId);
    if (tasks.length === 0) {
      return NextResponse.json({ ok: false, error: `Project ${projectId} không có nhóm chat nào để sync.` });
    }

    const result = enqueueJob({
      id: `project-${projectId}-${Date.now()}`,
      label: `project ${projectId} (${tasks.length} chats)`,
      type: "project",
      projectId,
      chatTasks: tasks,
      createdAt: Date.now(),
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.reason || "Không thể xếp hàng đợi." });
    }

    return NextResponse.json({
      ok: true,
      message: `Project ${projectId}: ${tasks.length} nhóm đã xếp hàng đợi (ưu tiên).`,
    });
  } catch (err) {
    console.error("[SyncProjectChats API] Error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}