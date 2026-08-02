import { NextRequest, NextResponse } from "next/server";
import { getLogs, getLogsPaginated, getRecentLogs, addLog, addLogsBatch, clearLogs } from "@/lib/repo/syncLogs";
import { readJsonBody, handleRoute } from "../_helpers";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return handleRoute(req, async (req) => {
    const sp = new URL(req.url).searchParams;
    const action = sp.get("action") ?? "getLogs";
    switch (action) {
      case "getLogs": {
        const projectId = sp.get("projectId") ?? undefined;
        const limit = sp.get("limit") ? Number(sp.get("limit")) : undefined;
        return await getLogs({ projectId, limit });
      }
      case "getLogsPaginated": {
        const projectId = sp.get("projectId") ?? undefined;
        const cursor = sp.get("cursor") ? Number(sp.get("cursor")) : null;
        const limit = sp.get("limit") ? Number(sp.get("limit")) : undefined;
        return await getLogsPaginated({ projectId, cursor, limit });
      }
      case "getRecentLogs": {
        const type = sp.get("type") ?? undefined;
        const limit = sp.get("limit") ? Number(sp.get("limit")) : undefined;
        return await getRecentLogs({ type, limit });
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
      case "addLog":
        return await addLog(body);
      case "addLogsBatch":
        await addLogsBatch(body.logs ?? []);
        return { ok: true };
      case "clearLogs":
        return await clearLogs(body.before);
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  });
}