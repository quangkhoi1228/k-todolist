import { NextRequest, NextResponse } from "next/server";
import { getByProject, getByTicketId, upsertByProject, removeByProject } from "@/lib/repo/projectIsdData";
import { requireUserId, readJsonBody, handleRoute } from "../_helpers";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return handleRoute(req, async (req) => {
    const sp = new URL(req.url).searchParams;
    const action = sp.get("action") ?? "getByProject";
    switch (action) {
      case "getByProject": {
        const projectId = sp.get("projectId") ?? "";
        return await getByProject(projectId);
      }
      case "getByTicketId": {
        const ticketId = sp.get("ticketId") ?? "";
        return await getByTicketId(ticketId);
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
      case "upsertByProject":
        requireUserId(body);
        return await upsertByProject(body);
      case "removeByProject":
        return await removeByProject(body.projectId);
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  });
}