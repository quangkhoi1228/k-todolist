/**
 * Hourly Healthcheck — Teams + Zalo
 *
 * Runs the teams-health.ts and zalo-health.ts checks (headless),
 * persists results to .health-status.json and writes a log row to Postgres.
 *
 * Usage:
 *   npx tsx agents/pm/scripts/hourly-healthcheck.ts
 *   DRY_RUN=1 npx tsx agents/pm/scripts/hourly-healthcheck.ts   # no DB write
 */

import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";
import dotenv from "dotenv";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const execAsync = promisify(exec);
const STATUS_FILE = path.join(process.cwd(), ".health-status.json");
const isDryRun = process.env.DRY_RUN === "1";

interface HealthResult {
  ok: boolean;
  status: string;
  message?: string;
  error?: string;
  checkedAt: number;
}

async function runHealthScript(name: "teams" | "zalo"): Promise<HealthResult> {
  const scriptPath = path.join(process.cwd(), `agents/pm/scripts/${name}-health.ts`);
  try {
    const { stdout } = await execAsync(`npx tsx "${scriptPath}"`, {
      env: { ...process.env, HEADLESS: "true" },
      maxBuffer: 1024 * 1024,
      timeout: 60_000,
    });
    const match = stdout.match(/\{"ok":.*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return { ok: true, status: parsed.status || "unknown", message: parsed.message, checkedAt: Date.now() };
    }
    return { ok: false, status: "error", error: "Invalid output from health script", checkedAt: Date.now() };
  } catch (err: any) {
    return { ok: false, status: "error", error: err.message, checkedAt: Date.now() };
  }
}

async function main() {
  const [teams, zalo] = await Promise.all([runHealthScript("teams"), runHealthScript("zalo")]);

  const status = {
    teams,
    zalo,
    lastRunAt: Date.now(),
  };

  try {
    fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2), "utf-8");
    console.log(`[HourlyHealthcheck] Wrote ${STATUS_FILE}`);
  } catch (e) {
    console.error("[HourlyHealthcheck] Failed to write status file:", e);
  }

  if (isDryRun) {
    console.log("[HourlyHealthcheck] DRY_RUN — skipping DB log");
  } else {
    try {
      const { addLog } = await import("../../../src/lib/repo/syncLogs");
      const messages = [
        `Teams: ${teams.status}${teams.message ? " — " + teams.message : ""}${teams.error ? " (error: " + teams.error.slice(0, 100) + ")" : ""}`,
        `Zalo: ${zalo.status}${zalo.message ? " — " + zalo.message : ""}${zalo.error ? " (error: " + zalo.error.slice(0, 100) + ")" : ""}`,
      ];
      for (const message of messages) {
        await addLog({ type: "healthcheck", message, details: JSON.stringify(status) });
      }
      console.log("[HourlyHealthcheck] Logged healthcheck results to DB");
    } catch (e) {
      console.error("[HourlyHealthcheck] Failed to write DB log:", e);
    }
  }

  console.log(`[HourlyHealthcheck] Teams=${teams.status} Zalo=${zalo.status}`);
}

main()
  .catch((err) => {
    console.error("[HourlyHealthcheck] Fatal:", err);
    process.exit(1);
  })
  .finally(() => {
    // NOTE: no process.exit(0) here — let the process exit naturally when the
    // event loop drains. Calling process.exit() from a child spawned by the
    // Next.js server appeared to destabilize the parent in some environments.
  });
