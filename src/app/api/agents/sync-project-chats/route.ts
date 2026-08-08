import { NextResponse, type NextRequest } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { auth } from "@clerk/nextjs/server";

const RUNNING_FILE = path.join(process.cwd(), ".teams-sync-running");

/**
 * POST /api/agents/sync-project-chats
 *
 * Spawn script `sync-project-chats.ts` — sync TUẦN TỰ tất cả nhóm chat
 * (Teams + Zalo) trong `teamsGroups` của ĐÚNG project đang được user mở.
 * Incremental theo watermark, chỉ lấy tin mới (nhanh — vài chục giây/vòng).
 * Dùng chung lock `.teams-sync-running` + Chrome profile với sync-projects.
 *
 * Body: { projectId, headless?, syncMode? ("incremental"|"full") }
 * Action: { action: "status" } — sync có đang chạy không (đồng bộ trạng thái
 * với `/api/agents/sync-projects` vì dùng chung lock file).
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session.userId;
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const action = body.action as string | undefined;
    const projectId = body.projectId as string | undefined;

    if (!projectId) {
      return NextResponse.json({ ok: false, error: "Missing projectId" }, { status: 400 });
    }

    // Status: sync của project này có đang chạy không
    if (action === "status") {
      let isRunning = false;
      try {
        if (fs.existsSync(RUNNING_FILE)) {
          const pid = parseInt(fs.readFileSync(RUNNING_FILE, "utf-8").trim(), 10);
          if (!isNaN(pid)) {
            process.kill(pid, 0); // throws if not running
            isRunning = true;
          }
        }
      } catch {
        fs.unlinkSync(RUNNING_FILE);
      }
      return NextResponse.json({ running: isRunning });
    }

    // Chặn trùng lặp: lock file dùng CHUNG với sync-projects (cùng Chrome profile).
    // Nếu sync khác đang chạy mà route vẫn spawn + ghi đè lock → script mới exit sớm
    // và route xoá lock của sync đang chạy → sync sau đó chạy chồng lên nhau.
    let isRunning = false;
    try {
      if (fs.existsSync(RUNNING_FILE)) {
        const pid = parseInt(fs.readFileSync(RUNNING_FILE, "utf-8").trim(), 10);
        if (!isNaN(pid)) {
          process.kill(pid, 0); // throws if not running
          isRunning = true;
        }
      }
    } catch {
      fs.unlinkSync(RUNNING_FILE);
    }

    if (isRunning) {
      return NextResponse.json({
        ok: false,
        error: "A sync process is already running.",
      });
    }

    // Start sync: 1 process cho toàn bộ groups của project (tuần tự)
    const scriptPath = path.join(process.cwd(), "agents/pm/scripts/sync-project-chats.ts");

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      USER_ID: userId,
      PROJECT_ID: projectId,
      HEADLESS: body.headless !== false ? "true" : "false",
      SYNC_MODE: body.syncMode === "full" ? "full" : "incremental",
      USE_CDP: process.env.USE_CDP ?? "1",
      CDP_PORT: process.env.CDP_PORT ?? "9222",
    };

    const child = spawn("npx", ["tsx", scriptPath], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    const pid = child.pid ?? 0;
    try {
      fs.writeFileSync(RUNNING_FILE, `${pid}`, "utf-8");
    } catch { /* ignore */ }

    child.on("exit", (code) => {
      try {
        if (fs.existsSync(RUNNING_FILE)) fs.unlinkSync(RUNNING_FILE);
      } catch { /* ignore */ }
      console.log(`[SyncProjectChats] Process ${pid} exited with code ${code}`);
    });

    child.unref();

    return NextResponse.json({
      ok: true,
      message: `Started syncing all chats of project ${projectId} in background.`,
    });
  } catch (err) {
    console.error("[SyncProjectChats API] Error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
