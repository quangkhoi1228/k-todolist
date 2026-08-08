import { NextResponse, type NextRequest } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { auth } from "@clerk/nextjs/server";

const RUNNING_FILE = path.join(process.cwd(), ".teams-sync-running");
const PROGRESS_FILE = path.join(process.cwd(), ".teams-sync-progress.json");

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session.userId;
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const action = body.action as string | undefined;
    const headless = body.headless !== false; // default true

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

      // Read progress file
      let progress: Record<string, unknown> | null = null;
      try {
        if (fs.existsSync(PROGRESS_FILE)) {
          progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf-8"));
        }
      } catch { /* ignore */ }

      return NextResponse.json({ running: isRunning, progress });
    }

    // Stop sync — kill the running process and clean up locks so the
    // Teams/Zalo profiles are free for an interactive (headfull) login.
    if (action === "stop") {
      let stopped = false;
      try {
        if (fs.existsSync(RUNNING_FILE)) {
          const pid = parseInt(fs.readFileSync(RUNNING_FILE, "utf-8").trim(), 10);
          if (!isNaN(pid)) {
            try { process.kill(pid, 9); stopped = true; } catch { /* already dead */ }
          }
          fs.unlinkSync(RUNNING_FILE);
        }
      } catch { /* */ }

      // Release Chrome profile locks left behind by a killed browser
      const locks = [
        path.join(process.cwd(), ".zalo-session", "chrome-profile"),
        path.join(process.cwd(), ".teams-session", "chrome-profile"),
      ];
      for (const dir of locks) {
        for (const f of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
          try {
            const p = path.join(dir, f);
            if (fs.existsSync(p)) fs.unlinkSync(p);
          } catch { /* */ }
        }
      }

      return NextResponse.json({ ok: true, stopped });
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
        error: "A sync process is already running.",
      });
    }

    const scriptPath = path.join(process.cwd(), "agents/pm/scripts/sync-all-projects.ts");

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      USER_ID: userId,
      HEADLESS: headless ? "true" : "false",
      // Mặc định dùng CDP (Chrome thật user mở thủ công) giống mọi route khác.
      // Nếu không set, script chạy chế độ launch Chrome riêng trên cùng profile
      // — vừa xung đột profile vừa gây cleanup orphan giết nhầm Chrome CDP.
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
    } catch { /* */ }

    child.on("exit", (code) => {
      try {
        if (fs.existsSync(RUNNING_FILE)) fs.unlinkSync(RUNNING_FILE);
      } catch { /* */ }
      console.log(`[SyncAllProjects] Process ${pid} exited with code ${code}`);
    });

    child.unref();

    return NextResponse.json({
      ok: true,
      message: "Sync started in background.",
    });
  } catch (err) {
    console.error("[SyncAllProjects API] Error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
