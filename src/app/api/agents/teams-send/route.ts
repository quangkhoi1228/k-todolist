/**
 * POST /api/agents/teams-send
 *
 * Gửi tin nhắn tới một chat Teams (nhóm hoặc 1:1) với cơ chế verify an toàn:
 * - CHỈ gửi khi xác minh được chat đang mở đúng tên mục tiêu
 * - `dryRun: true` — soạn tin nhưng KHÔNG gửi (xoá ngay)
 * - `action: "compose"` — mở chat + soạn sẵn tin nhắn, KHÔNG gửi, giữ Chrome mở
 *   để user tự kiểm tra (deep-link style) — trả về ngay khi đã soạn xong
 * - Luôn mở browser headfull khi gửi thật để user quan sát được
 *
 * Actions:
 *   { action: "send", chatName, message, dryRun?, headless? } — gửi tin nhắn
 *   { action: "compose", chatName, message } — mở chat + soạn sẵn, không gửi
 *   { action: "status" } — check if a send process is running
 *   { action: "health" } — check if Teams session is valid
 */

import { NextResponse, type NextRequest } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";

const RUNNING_FILE = path.join(process.cwd(), ".teams-send-running");

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
/** Cho phép gửi Teams chạy tới 180s (script kill ở 150s). */
export const maxDuration = 180;

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
      const scriptPath = path.join(process.cwd(), "agents/pm/scripts/teams-health.ts");
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

    // ── Send message / Compose-only (mở chat + soạn sẵn, không gửi) ──
    if (action === "send" || action === "compose") {
      const chatName = body.chatName as string | undefined;
      const message = body.message as string | undefined;
      const dryRun = body.dryRun === true;
      const compose = action === "compose";
      const headless = body.headless !== false; // mặc định headless; headfull khi body.headless === false

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
          error: "A Teams send process is already running.",
          pid: existingPid,
        });
      }

      const scriptPath = path.join(process.cwd(), "agents/pm/scripts/teams-send.ts");

      const args: string[] = [scriptPath, "--chat", chatName, "--message", message];
      if (compose) {
        // Compose-only: soạn sẵn, không gửi. CDP mode (Chrome thật) tự giữ tab
        // mở sẵn — KHÔNG dùng --keep-open vì nó treo process vô hạn (API route
        // chờ exit sẽ không bao giờ trả response).
        args.push("--compose");
        args.push("--headless");
      } else {
        if (dryRun) args.push("--dry-run");
        if (!dryRun) args.push("--yes"); // CLI requires --yes for real send
        if (headless) args.push("--headless");
      }

      const env: Record<string, string | undefined> = {
        ...process.env,
        // Bật CDP: nếu Chrome thật đang chạy (CDP 9222) thì dùng luôn, fallback
        // persistent profile. Không set → script mở Chrome riêng trùng profile,
        // crash "Teams profile đang bị Chrome khác dùng".
        USE_CDP: process.env.USE_CDP ?? "1",
        CDP_PORT: process.env.CDP_PORT ?? "9222",
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

          // Hard timeout: nếu script con không exit (treo do browser.close() kẹt,
          // Chrome con giữ profile, v.v.) thì KILL và trả lỗi — API KHÔNG BAO GIỜ
          // treo vô hạn, user luôn nhận được kết quả.
          const TIMEOUT_MS = 150_000;
          const killTimer = setTimeout(() => {
            try {
              child.kill("SIGKILL");
            } catch { /* */ }
            try {
              if (fs.existsSync(RUNNING_FILE)) fs.unlinkSync(RUNNING_FILE);
            } catch { /* */ }
            resolve({
              ok: false,
              error: `Quá thời gian gửi (${TIMEOUT_MS / 1000}s). Đã hủy process ${pid}. Chrome có thể bị kẹt giữ profile — thử lại sau vài giây.`,
            });
          }, TIMEOUT_MS);
          killTimer.unref();

          child.on("exit", (code: number | null) => {
            clearTimeout(killTimer);
            try {
              if (fs.existsSync(RUNNING_FILE)) fs.unlinkSync(RUNNING_FILE);
            } catch {
              /* */
            }

            if (stderr) {
              console.log(`[TeamsSend] stderr: ${stderr.slice(-500)}`);
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

            resolve({ ok: true, message: "Teams message sent successfully." });
          });

          child.on("error", (err) => {
            clearTimeout(killTimer);
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
    console.error("[TeamsSend API] Error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
