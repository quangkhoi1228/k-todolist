/**
 * GET /api/agents/project-teams-groups
 *
 * Returns aggregated Teams group links from all active projects
 * (not archived, not deleted) that have internalGroupUrl or customerGroupUrl.
 *
 * This is a server-side aggregation via Convex HTTP API.
 */

import { NextResponse } from "next/server";
import path from "path";

interface ProjectGroupEntry {
  projectId: string;
  projectName: string;
  internalGroupUrl: string | null;
  customerGroupUrl: string | null;
}

/**
 * Since we can't use Convex hooks directly in API routes,
 * we read from a cached JSON file that the client can update periodically.
 *
 * The client (Teams Monitor Panel) fetches project data from Convex directly
 * and POSTs to this endpoint to cache it.
 *
 * Alternative: The panel will use this endpoint as a simple pass-through cache.
 */
const CACHE_FILE = path.join(process.cwd(), ".project-teams-groups-cache.json");

export async function GET() {
  try {
    const fs = require("fs");
    if (fs.existsSync(CACHE_FILE)) {
      const raw = fs.readFileSync(CACHE_FILE, "utf-8");
      const data = JSON.parse(raw);
      return NextResponse.json({ ok: true, groups: data });
    }
  } catch { /* */ }
  return NextResponse.json({ ok: true, groups: [] });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const groups = body.groups as ProjectGroupEntry[];
    const fs = require("fs");
    fs.writeFileSync(CACHE_FILE, JSON.stringify(groups, null, 2), "utf-8");
    return NextResponse.json({ ok: true, count: groups.length });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to cache" },
      { status: 500 }
    );
  }
}
