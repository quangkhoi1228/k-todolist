/**
 * GET /api/agents/health-status
 *
 * Returns the latest hourly healthcheck result for Teams + Zalo,
 * as written by agents/pm/scripts/hourly-healthcheck.ts (via src/instrumentation.ts).
 */
import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";

export const runtime = "nodejs";

export async function GET() {
  try {
    const statusFile = path.join(process.cwd(), ".health-status.json");
    if (fs.existsSync(statusFile)) {
      const raw = fs.readFileSync(statusFile, "utf-8");
      const data = JSON.parse(raw);
      return NextResponse.json({ ok: true, ...data });
    }
    return NextResponse.json({ ok: true, teams: null, zalo: null, lastRunAt: null });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message });
  }
}
