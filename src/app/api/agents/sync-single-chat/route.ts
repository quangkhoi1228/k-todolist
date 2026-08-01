import { NextResponse, type NextRequest } from "next/server";
import { spawn } from "child_process";
import path from "path";
import { auth } from "@clerk/nextjs/server";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session.userId;
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { projectId, chatName, platform } = body;
    const headless = body.headless !== false; // default true

    if (!projectId || !chatName) {
      return NextResponse.json({ ok: false, error: "Missing projectId or chatName" }, { status: 400 });
    }

    const scriptPath = path.join(process.cwd(), "agents/pm/scripts/sync-single-chat.ts");

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      USER_ID: userId,
      PROJECT_ID: projectId,
      CHAT_NAME: chatName,
      PLATFORM: platform || "teams",
      HEADLESS: headless ? "true" : "false",
    };

    const child = spawn("npx", ["tsx", scriptPath], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    child.on("exit", (code) => {
      console.log(`[SyncSingleChat] Process for "${chatName}" exited with code ${code}`);
    });

    child.unref();

    return NextResponse.json({
      ok: true,
      message: `Started syncing chat "${chatName}" in background.`,
    });
  } catch (err) {
    console.error("[SyncSingleChat API] Error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
