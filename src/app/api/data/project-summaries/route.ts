import { NextRequest, NextResponse } from "next/server";
import {
  getSummariesByProject,
  getLatestSummary,
  deleteSummary,
  deleteSummariesByProject,
} from "@/lib/repo/projectSummaries";
import { readJsonBody, handleRoute } from "../_helpers";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return handleRoute(req, async (req) => {
    const sp = new URL(req.url).searchParams;
    const action = sp.get("action") ?? "getSummariesByProject";
    switch (action) {
      case "getSummariesByProject": {
        const projectId = sp.get("projectId") ?? "";
        const limit = Number(sp.get("limit") ?? "20") || 20;
        return await getSummariesByProject(projectId, limit);
      }
      case "getLatestSummary": {
        const projectId = sp.get("projectId") ?? "";
        return await getLatestSummary(projectId);
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
      case "deleteSummary":
        return await deleteSummary(body.id);
      case "deleteSummariesByProject":
        return await deleteSummariesByProject(body.projectId);
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  });
}