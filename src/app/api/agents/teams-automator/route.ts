/**
 * POST /api/agents/teams-automator
 *
 * Actions:
 *   { deepLink?, headless?, keywords? }   — start automation
 *   { action: "status" }                   — check if a process is running
 */

import { NextResponse, type NextRequest } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";

const RUNNING_FILE = path.join(process.cwd(), ".teams-automator-running");
const SYNC_RUNNING_FILE = path.join(process.cwd(), ".teams-sync-running");

/** Dừng sync nền đang chạy để giải phóng Chrome profile cho login headfull. */
function stopBackgroundSync() {
  try {
    if (fs.existsSync(SYNC_RUNNING_FILE)) {
      const pid = parseInt(fs.readFileSync(SYNC_RUNNING_FILE, "utf-8").trim(), 10);
      if (!isNaN(pid)) {
        try { process.kill(pid, 9); } catch { /* already dead */ }
      }
      fs.unlinkSync(SYNC_RUNNING_FILE);
    }
  } catch { /* */ }
  // Release stale Chrome profile locks
  const profileDir = path.join(process.cwd(), ".teams-session", "chrome-profile");
  for (const f of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
    try {
      const p = path.join(profileDir, f);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch { /* */ }
  }
}

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    // Double-check: verify it's our node process (not a recycled PID)
    const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf-8").replace(/\0/g, " ");
    return cmd.includes("teams-automator") || cmd.includes("node");
  } catch {
    return false;
  }
}

function getRunningPid(): number | null {
  try {
    if (fs.existsSync(RUNNING_FILE)) {
      const content = fs.readFileSync(RUNNING_FILE, "utf-8").trim();
      const [pidStr] = content.split(",");
      const pid = parseInt(pidStr, 10);
      if (isNaN(pid)) { fs.unlinkSync(RUNNING_FILE); return null; }

      // Check if PID is truly our automator process
      if (isPidRunning(pid)) return pid;

      // Stale PID file — clean up
      fs.unlinkSync(RUNNING_FILE);
    }
  } catch {
    // /proc not available (macOS) — fall back to simple kill(0) + age check
    try {
      if (fs.existsSync(RUNNING_FILE)) {
        const content = fs.readFileSync(RUNNING_FILE, "utf-8").trim();
        const parts = content.split(",");
        const pid = parseInt(parts[0], 10);
        const timestamp = parseInt(parts[1] || "0", 10);
        if (isNaN(pid)) { fs.unlinkSync(RUNNING_FILE); return null; }

        // On macOS just kill(0) + age guard
        try {
          process.kill(pid, 0);
          // If file is older than 30 minutes, treat as stale
          if (timestamp > 0 && Date.now() - timestamp > 30 * 60 * 1000) {
            fs.unlinkSync(RUNNING_FILE);
            return null;
          }
          return pid;
        } catch {
          fs.unlinkSync(RUNNING_FILE);
        }
      }
    } catch { /* */ }
  }
  return null;
}

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body.action as string | undefined;

    // ── Status check ────────────────────────────────
    if (action === "status") {
      const pid = getRunningPid();
      return NextResponse.json({ running: pid !== null, pid });
    }

    // ── Health check ────────────────────────────────
    if (action === "healthcheck") {
      const exec = require("util").promisify(require("child_process").exec);
      const scriptPath = path.join(process.cwd(), "agents/pm/scripts/teams-health.ts");
      const headless = body.headless !== false;
      
      // Pass full env so child processes (Chrome via Playwright) get system vars
      const env = { ...process.env };

      try {
        const headlessFlag = headless ? "" : "--headfull";
        const { stdout } = await exec(`npx tsx "${scriptPath}" ${headlessFlag}`, { env, maxBuffer: 1024 * 1024 });
        const match = stdout.match(/\{"ok":.*\}/);
        if (match) {
          return NextResponse.json(JSON.parse(match[0]));
        }
        return NextResponse.json({ ok: false, error: "Invalid output from health script" });
      } catch (err: any) {
        return NextResponse.json({ ok: false, error: err.message });
      }
    }

    // ── List Chats ──────────────────────────────────
    if (action === "list_chats") {
      const exec = require("util").promisify(require("child_process").exec);
      const scriptPath = path.join(process.cwd(), "agents/pm/scripts/teams-list-chats.ts");
      const headless = body.headless !== false;
      
      // Pass full env so Playwright/Chrome get system vars (TMPDIR, DYLD_*, etc.)
      const env = { ...process.env };

      try {
        const headlessFlag = headless ? "--headless" : "";
        const { stdout } = await exec(`npx tsx "${scriptPath}" ${headlessFlag}`, { env, maxBuffer: 1024 * 1024 * 5 });
        
        // Find the JSON block in stdout
        const match = stdout.match(/\{"ok":.*\}/);
        if (match) {
          const result = JSON.parse(match[0]);
          return NextResponse.json(result);
        }
        return NextResponse.json({ ok: false, error: "Invalid output from script", stdout });
      } catch (err: any) {
        return NextResponse.json({ ok: false, error: err.message, stdout: err.stdout, stderr: err.stderr });
      }
    }

    // ── Start automation ────────────────────────────
    const deepLink = body.deepLink as string | undefined;
    const chatName = body.chatName as string | undefined;
    const headless = body.headless !== false;
    const keepOpen = body.keepOpen === true;
    const useRealChrome = body.useRealChrome !== false; // Default true for Teams v2
    const keywords = (body.keywords as string[]) || [];

    const existingPid = getRunningPid();
    if (existingPid) {
      return NextResponse.json({
        ok: false,
        error: "A Teams automation process is already running.",
        pid: existingPid,
      });
    }

    // Login cần browser headfull với profile riêng — dừng sync nền đang giữ profile
    if (!headless) {
      stopBackgroundSync();
    }

    const scriptPath = path.join(process.cwd(), "agents/pm/scripts/teams-automator.ts");

    const args: string[] = [scriptPath];
    if (headless) args.push("--headless");
    if (keepOpen) args.push("--keep-open");
    if (useRealChrome) args.push("--use-real-chrome");

    // Ensure full env so Chrome/Playwright gets system vars
    const env: Record<string, string | undefined> = {
      ...process.env,
      TEAMS_DEEPLINK: deepLink || "",
      TEAMS_CHAT_NAME: chatName || "",
      TEAMS_KEYWORDS: keywords.join(","),
      PLATFORM: "teams",
    };

    const opts: Record<string, unknown> = {
      env,
      stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"],
      detached: true,
    };

    // Spawn via npx tsx — PATH is guaranteed set above
    const child = spawn("npx", ["tsx", ...args], opts);
    const pid = child.pid ?? 0;

    try {
      fs.writeFileSync(RUNNING_FILE, `${pid},${Date.now()}`, "utf-8");
    } catch { /* */ }

    child.on("exit", (code: number | null) => {
      try {
        if (fs.existsSync(RUNNING_FILE)) fs.unlinkSync(RUNNING_FILE);
      } catch { /* */ }
      console.log(`[TeamsAutomator] Process ${pid} exited with code ${code}`);
    });

    child.unref();

    return NextResponse.json({
      ok: true,
      pid,
      message: "Teams automation started in background.",
      note: "Results will be written to teams-messages.json.",
    });
  } catch (err) {
    console.error("[TeamsAutomator API] Error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
