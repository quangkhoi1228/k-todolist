import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { enqueueJob } from "@/lib/sync-queue";

/**
 * POST /api/agents/sync-single-chat
 *
 * Sync 1 nhóm chat (nút 🔄 / "Đồng bộ toàn bộ" trên UI tab Chats).
 * Đi qua queue tập trung — chạy tuần tự với auto-sync, không đè Chrome profile.
 *
 * Body: { projectId, chatName, platform, syncMode? ("incremental"|"full") }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session.userId;
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { projectId, chatName, platform, syncMode } = body;

    if (!projectId || !chatName) {
      return NextResponse.json({ ok: false, error: "Missing projectId or chatName" }, { status: 400 });
    }

    const result = enqueueJob({
      id: `single-${Date.now()}`,
      label: `sync 1 chat "${chatName}" (${platform})`,
      type: "single",
      chatTasks: [{
        projectId,
        chatName: String(chatName).trim(),
        platform: (platform === "zalo" ? "zalo" : "teams") as "teams" | "zalo",
        syncMode: syncMode === "full" ? "full" : "incremental",
      }],
      createdAt: Date.now(),
    });

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.reason || "Không thể xếp hàng đợi." });
    }

    return NextResponse.json({
      ok: true,
      message: `Đã xếp hàng đợi sync chat "${chatName}" (${platform}).`,
    });
  } catch (err) {
    console.error("[SyncSingleChat API] Error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}