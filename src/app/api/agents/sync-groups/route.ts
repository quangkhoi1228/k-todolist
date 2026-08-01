import { NextResponse, type NextRequest } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { auth } from "@clerk/nextjs/server";

const RUNNING_FILE = path.join(process.cwd(), ".groups-sync-running");

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session.userId;
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const action = body.action as string | undefined;
    const headless = body.headless !== false;

    // Status check
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

    // Start sync
    let isRunning = false;
    try {
      if (fs.existsSync(RUNNING_FILE)) {
        const pid = parseInt(fs.readFileSync(RUNNING_FILE, "utf-8").trim(), 10);
        if (!isNaN(pid)) {
          process.kill(pid, 0);
          isRunning = true;
        }
      }
    } catch {
      fs.unlinkSync(RUNNING_FILE);
    }

    if (isRunning) {
      return NextResponse.json({
        ok: false,
        error: "A group sync process is already running.",
      });
    }

    const scriptPath = path.join(process.cwd(), "agents/pm/scripts/sync-all-groups.ts");

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      USER_ID: userId,
      HEADLESS: headless ? "true" : "false",
    };

    const child = spawn("npx", ["tsx", scriptPath], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });

    const pid = child.pid ?? 0;

    try {
      fs.writeFileSync(RUNNING_FILE, `${pid}`, "utf-8");
    } catch { /* */ }

    child.on("exit", (code) => {
      try {
        if (fs.existsSync(RUNNING_FILE)) fs.unlinkSync(RUNNING_FILE);
      } catch { /* */ }
      console.log(`[SyncAllGroups] Process ${pid} exited with code ${code}`);
    });

    child.unref();

    return NextResponse.json({
      ok: true,
      message: "Group sync started in background.",
    });
  } catch (err) {
    console.error("[SyncAllGroups API] Error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
