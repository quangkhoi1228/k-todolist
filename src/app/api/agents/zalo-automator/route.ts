/**
 * POST /api/agents/zalo-automator
 *
 * Actions:
 *   { headless?, groupName? }   — start automation
 *   { action: "status" }        — check if a process is running
 *   { action: "healthcheck" }   — check login session health
 *   { action: "list_chats" }    — list available groups from sidebar
 */

import { NextResponse, type NextRequest } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";

const RUNNING_FILE = path.join(process.cwd(), ".zalo-automator-running");
const SYNC_RUNNING_FILE = path.join(process.cwd(), ".zalo-sync-running");

/** Dừng sync Zalo nền đang chạy để giải phóng Chrome profile cho login headfull.
 *  Chỉ kill sync ZALO — KHÔNG kill sync Teams (2 platform dùng Chrome profile
 *  khác nhau, Teams sync không cản trở login Zalo). */
function stopBackgroundSync() {
  try {
    if (fs.existsSync(SYNC_RUNNING_FILE)) {
      // Lock mới chứa nhiều PID (mỗi script con 1 dòng) — kill tất cả
      const pids = fs.readFileSync(SYNC_RUNNING_FILE, "utf-8")
        .split("\n").map(l => l.trim()).filter(Boolean)
        .map(l => parseInt(l, 10)).filter(p => !isNaN(p));
      for (const pid of pids) {
        try { process.kill(pid, 9); } catch { /* already dead */ }
      }
      fs.unlinkSync(SYNC_RUNNING_FILE);
    }
  } catch { /* */ }
  // Release stale Chrome profile locks
  for (const f of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
    try {
      fs.unlinkSync(
        path.join(/* turbopackIgnore: true */ process.cwd(), ".zalo-session", "chrome-profile", f)
      );
    } catch { /* */ }
  }
}

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    // Double-check: verify it's our node process
    const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf-8").replace(/\0/g, " ");
    return cmd.includes("zalo-automator") || cmd.includes("node");
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
    // /proc not available (macOS)
    try {
      if (fs.existsSync(RUNNING_FILE)) {
        const content = fs.readFileSync(RUNNING_FILE, "utf-8").trim();
        const parts = content.split(",");
        const pid = parseInt(parts[0], 10);
        const timestamp = parseInt(parts[1] || "0", 10);
        if (isNaN(pid)) { fs.unlinkSync(RUNNING_FILE); return null; }

        try {
          process.kill(pid, 0);
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
      const scriptPath = path.join(process.cwd(), "agents/pm/scripts/zalo-health.ts");
      const headless = body.headless !== false;
      
      // Pass full env so child processes (Chrome via Playwright) get system vars.
      // Lưu ý: KHÔNG force USE_CDP ở đây như list_chats — Zalo có profile riêng
      // (.zalo-session); nếu CDP 9222 là Chrome Teams thì connect nhầm. Script
      // zalo-health tự quyết định: USE_CDP bật nếu Chrome Zalo đang chạy.
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
      const scriptPath = path.join(process.cwd(), "agents/pm/scripts/zalo-list-chats.ts");
      const headless = body.headless !== false;

      // Zalo LUÔN dùng persistent profile riêng (.zalo-session), KHÔNG CDP.
      // CDP 9222 thường là Chrome profile Teams — Zalo connect vào đó bị
      // "Đổi thiết bị" đá logout session Zalo chính.
      const env = { ...process.env, USE_CDP: "0" };

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
    const groupName = body.groupName as string | undefined;
    const headless = body.headless !== false;
    const keepOpen = body.keepOpen === true;
    const useRealChrome = body.useRealChrome !== false;

    const existingPid = getRunningPid();
    if (existingPid) {
      return NextResponse.json({
        ok: false,
        error: "A Zalo automation process is already running.",
        pid: existingPid,
      });
    }

    // Login cần browser headfull với profile riêng — dừng sync nền đang giữ profile
    if (!headless) {
      stopBackgroundSync();
    }

    const scriptPath = path.join(process.cwd(), "agents/pm/scripts/zalo-automator.ts");

    const args: string[] = [scriptPath];
    if (headless) args.push("--headless");
    if (keepOpen) args.push("--keep-open");
    if (useRealChrome) args.push("--use-real-chrome");

    // Ensure full env so Chrome/Playwright gets system vars
    const env: Record<string, string | undefined> = {
      ...process.env,
      ZALO_GROUP_NAME: groupName || "",
      PLATFORM: "zalo",
      // Zalo LUÔN dùng persistent profile riêng (.zalo-session), KHÔNG CDP.
      // CDP 9222 thường là Chrome profile Teams — Zalo connect vào đó bị
      // "Đổi thiết bị" đá logout session Zalo chính.
      USE_CDP: "0",
    };

    const opts: Record<string, unknown> = {
      env,
      stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"],
      detached: true,
    };

    const child = spawn("npx", ["tsx", ...args], opts);
    const pid = child.pid ?? 0;

    try {
      fs.writeFileSync(RUNNING_FILE, `${pid},${Date.now()}`, "utf-8");
    } catch { /* */ }

    child.on("exit", (code: number | null) => {
      try {
        if (fs.existsSync(RUNNING_FILE)) fs.unlinkSync(RUNNING_FILE);
      } catch { /* */ }
      console.log(`[ZaloAutomator] Process ${pid} exited with code ${code}`);
    });

    child.unref();

    return NextResponse.json({
      ok: true,
      pid,
      message: "Zalo automation started in background.",
      note: "Results will be written to zalo-messages.json.",
    });
  } catch (err) {
    console.error("[ZaloAutomator API] Error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
