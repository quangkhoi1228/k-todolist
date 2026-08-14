import { NextRequest, NextResponse } from "next/server";
import {
  getDebateRunsByProject,
  getDebateRunById,
  createDebateRun,
  deleteDebateRun,
  deleteDebateRunsByProject,
} from "@/lib/repo/debateRuns";
import { handleRoute, readJsonBody } from "../_helpers";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return handleRoute(req, async () => {
    const sp = new URL(req.url).searchParams;
    const action = sp.get("action") ?? "getByProject";
    switch (action) {
      case "getByProject": {
        const projectId = sp.get("projectId");
        if (!projectId) return { error: "Missing projectId" };
        const limit = sp.get("limit") ? Number(sp.get("limit")) : 30;
        return await getDebateRunsByProject(projectId, limit);
      }
      case "getById": {
        const id = sp.get("id");
        if (!id) return { error: "Missing id" };
        return await getDebateRunById(id);
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
      case "create":
        return await createDebateRun({
          projectId: body.projectId,
          userId: body.userId,
          result: body.result ?? {},
          suggestionCount: body.suggestionCount,
          conflictCount: body.conflictCount,
          totalMs: body.totalMs,
          groupCount: body.groupCount,
        });
      case "delete":
        return await deleteDebateRun(body.id);
      case "deleteByProject":
        return await deleteDebateRunsByProject(body.projectId);
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  });
}
