import { NextRequest, NextResponse } from "next/server";
import { getScrapedGroups, syncGroups, updateGroupSyncedAt } from "@/lib/repo/groups";
import { readJsonBody, handleRoute } from "../_helpers";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return handleRoute(req, async (req) => {
    const sp = new URL(req.url).searchParams;
    const action = sp.get("action") ?? "getScrapedGroups";
    switch (action) {
      case "getScrapedGroups": {
        const userId = sp.get("userId") ?? "";
        const platform = sp.get("platform") ?? undefined;
        return await getScrapedGroups(userId, platform);
      }
      default:
        return { error: `Unknown action: ${action}` };
    }
  });
}

export async function POST(req: NextRequest) {
  return handleRoute(req, async (req) => {
    const body = await readJsonBody(req);
    const action = body.action;
    switch (action) {
      case "syncGroups":
        return await syncGroups(body);
      case "updateGroupSyncedAt":
        return await updateGroupSyncedAt(body);
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  });
}