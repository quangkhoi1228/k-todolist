/**
 * POST /api/agents/zalo-send
 *
 * Gửi tin nhắn tới một chat Zalo với cơ chế verify an toàn:
 * - CHỈ gửi khi xác minh được chat đang mở đúng tên mục tiêu (sidebar selected)
 * - `dryRun: true` — soạn tin nhưng KHÔNG gửi (xoá ngay)
 * - Luôn mở browser headfull khi gửi thật để user quan sát được
 *
 * Actions:
 *   { action: "send", chatName, message, dryRun?, headless? } — gửi tin nhắn
 *   { action: "status" } — check if a send process is running
 *   { action: "health" } — check if Zalo session is valid
 */

import { NextResponse, type NextRequest } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";

const RUNNING_FILE = path.join(process.cwd(), ".zalo-send-running");

function getRunningPid(): number | null {
  try {
    if (fs.existsSync(RUNNING_FILE)) {
      const content = fs.readFileSync(RUNNING_FILE, "utf-8").trim();
      const parts = content.split(",");
      const pid = parseInt(parts[0], 10);
      const timestamp = parseInt(parts[1] || "0", 10);
      if (isNaN(pid)) {
        fs.unlinkSync(RUNNING_FILE);
        return null;
      }

      try {
        process.kill(pid, 0);
        // If file is older than 5 minutes, treat as stale (sending shouldn't take that long)
        if (timestamp > 0 && Date.now() - timestamp > 5 * 60 * 1000) {
          fs.unlinkSync(RUNNING_FILE);
          return null;
        }
        return pid;
      } catch {
        fs.unlinkSync(RUNNING_FILE);
      }
    }
  } catch {
    /* */
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
    if (action === "health") {
      const exec = require("util").promisify(require("child_process").exec);
      const scriptPath = path.join(process.cwd(), "agents/pm/scripts/zalo-health.ts");
      const env = { ...process.env };
      const headless = body.headless !== false;

      try {
        const headlessFlag = headless ? "" : "--headfull";
        const { stdout } = await exec(`npx tsx "${scriptPath}" ${headlessFlag}`, {
          env,
          maxBuffer: 1024 * 1024,
          timeout: 60_000,
        });
        const match = stdout.match(/\{"ok":.*\}/);
        if (match) {
          return NextResponse.json(JSON.parse(match[0]));
        }
        return NextResponse.json({ ok: false, error: "Invalid output from health script" });
      } catch (err: any) {
        return NextResponse.json({ ok: false, error: err.message });
      }
    }

    // ── Send message ────────────────────────────────
    if (action === "send") {
      const chatName = body.chatName as string | undefined;
      const message = body.message as string | undefined;
      const dryRun = body.dryRun === true;
      const headless = body.headless === true; // default headfull so user sees the send

      // Validate
      if (!chatName || !chatName.trim()) {
        return NextResponse.json(
          { ok: false, error: "Missing required field: chatName" },
          { status: 400 }
        );
      }
      if (!message || !message.trim()) {
        return NextResponse.json(
          { ok: false, error: "Missing required field: message" },
          { status: 400 }
        );
      }
      if (message.length > 2000) {
        return NextResponse.json(
          { ok: false, error: "Message too long (max 2000 chars)" },
          { status: 400 }
        );
      }

      const existingPid = getRunningPid();
      if (existingPid) {
        return NextResponse.json({
          ok: false,
          error: "A Zalo send process is already running.",
          pid: existingPid,
        });
      }

      const scriptPath = path.join(process.cwd(), "agents/pm/scripts/zalo-send.ts");

      const args: string[] = [scriptPath, "--chat", chatName, "--message", message];
      if (dryRun) args.push("--dry-run");
      if (!dryRun) args.push("--yes"); // CLI requires --yes for real send
      if (headless) args.push("--headless");

      const env: Record<string, string | undefined> = {
        ...process.env,
      };

      // Wait for the actual send result
      const result = await new Promise<{ ok: boolean; error?: string; message?: string; dryRun?: boolean }>(
        (resolve) => {
          const opts: Record<string, unknown> = {
            env,
            stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"],
          };

          const child = spawn("npx", ["tsx", ...args], opts);
          const pid = child.pid ?? 0;

          let stdout = "";
          let stderr = "";

          child.stdout?.on("data", (data: Buffer) => {
            stdout += data.toString();
          });
          child.stderr?.on("data", (data: Buffer) => {
            stderr += data.toString();
          });

          try {
            fs.writeFileSync(RUNNING_FILE, `${pid},${Date.now()}`, "utf-8");
          } catch {
            /* */
          }

          child.on("exit", (code: number | null) => {
            try {
              if (fs.existsSync(RUNNING_FILE)) fs.unlinkSync(RUNNING_FILE);
            } catch {
              /* */
            }

            if (stderr) {
              console.log(`[ZaloSend] stderr: ${stderr.slice(-500)}`);
            }

            if (code !== 0) {
              // Try to parse stdout for JSON result first
              const jsonMatch = stdout.match(/\{"ok":.*\}/);
              if (jsonMatch) {
                try {
                  const parsed = JSON.parse(jsonMatch[0]);
                  resolve(parsed);
                  return;
                } catch {
                  /* */
                }
              }
              resolve({
                ok: false,
                error: stderr.trim() || `Process exited with code ${code}`,
              });
              return;
            }

            // Parse the JSON result from stdout
            const jsonMatch = stdout.match(/\{"ok":.*\}/);
            if (jsonMatch) {
              try {
                const parsed = JSON.parse(jsonMatch[0]);
                resolve(parsed);
                return;
              } catch {
                /* */
              }
            }

            resolve({ ok: true, message: "Zalo message sent successfully." });
          });

          child.on("error", (err) => {
            try {
              if (fs.existsSync(RUNNING_FILE)) fs.unlinkSync(RUNNING_FILE);
            } catch {
              /* */
            }
            resolve({ ok: false, error: err.message });
          });
        }
      );

      return NextResponse.json(result);
    }

    return NextResponse.json(
      { ok: false, error: `Unknown action: ${action}` },
      { status: 400 }
    );
  } catch (err) {
    console.error("[ZaloSend API] Error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
