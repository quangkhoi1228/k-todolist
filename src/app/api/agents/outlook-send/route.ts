/**
 * POST /api/agents/outlook-send
 *
 * Actions:
 *   { action: "send", to, cc, bcc, subject, body, attachments, importance, headless?, dryRun? }
 *   { action: "status" }    — check if a send process is running
 *   { action: "health" }    — check if Outlook session is valid
 */

import { NextResponse, type NextRequest } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";

const RUNNING_FILE = path.join(process.cwd(), ".outlook-send-running");

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
        // If file is older than 10 minutes, treat as stale (emails shouldn't take that long)
        if (timestamp > 0 && Date.now() - timestamp > 10 * 60 * 1000) {
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
      const scriptPath = path.join(process.cwd(), "agents/pm/scripts/outlook-send.ts");
      const env = { ...process.env };

      try {
        const { stdout } = await exec(`npx tsx "${scriptPath}" --health`, {
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

    // ── Send email ──────────────────────────────────
    if (action === "send") {
      const to = body.to as string[] | undefined;
      const cc = body.cc as string[] | undefined;
      const bcc = body.bcc as string[] | undefined;
      const subject = body.subject as string | undefined;
      const emailBody = body.body as string | undefined;
      const attachments = body.attachments as string[] | undefined;
      const importance = body.importance as string | undefined;
      const headless = body.headless !== false;
      const dryRun = body.dryRun === true;

      // Validate required fields
      if (!to || to.length === 0) {
        return NextResponse.json(
          { ok: false, error: "Missing required field: to" },
          { status: 400 }
        );
      }
      if (!subject) {
        return NextResponse.json(
          { ok: false, error: "Missing required field: subject" },
          { status: 400 }
        );
      }

      const existingPid = getRunningPid();
      if (existingPid) {
        return NextResponse.json({
          ok: false,
          error: "An Outlook send process is already running.",
          pid: existingPid,
        });
      }

      const scriptPath = path.join(process.cwd(), "agents/pm/scripts/outlook-send.ts");

      const args: string[] = [
        scriptPath,
        "--to",
        to.join(","),
        "--subject",
        subject,
        "--body",
        emailBody || "",
      ];

      if (cc && cc.length > 0) {
        args.push("--cc", cc.join(","));
      }
      if (bcc && bcc.length > 0) {
        args.push("--bcc", bcc.join(","));
      }
      if (attachments && attachments.length > 0) {
        args.push("--attach", attachments.join(","));
      }
      if (importance) {
        args.push("--importance", importance);
      }
      if (headless) {
        args.push("--headless");
      }
      if (dryRun) {
        args.push("--dry-run");
      }

      const env: Record<string, string | undefined> = {
        ...process.env,
      };

      // Promisify the child process so we wait for the actual send result
      const result = await new Promise<{ ok: boolean; error?: string; message?: string }>(
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
              console.log(`[OutlookSend] stderr: ${stderr.slice(-500)}`);
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

            resolve({ ok: true, message: "Email sent successfully." });
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
    console.error("[OutlookSend API] Error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
