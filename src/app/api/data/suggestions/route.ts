import { NextRequest, NextResponse } from "next/server";
import { getSuggestionsByProject, getUnresolvedSuggestionsByUser, getUnresolvedCountByUser, getUnresolvedCountByProject, addSuggestion, markSuggestionAsRead, markSuggestionAsResolved, markAllAsReadByProject, deleteSuggestion, addSuggestionsBatch } from "@/lib/repo/projectSuggestions";
import { requireUserId, readJsonBody, handleRoute } from "../_helpers";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return handleRoute(req, async (req) => {
    const sp = new URL(req.url).searchParams;
    const action = sp.get("action") ?? "getSuggestionsByProject";
    switch (action) {
      case "getSuggestionsByProject": {
        const projectId = sp.get("projectId") ?? "";
        return await getSuggestionsByProject(projectId);
      }
      case "getUnresolvedSuggestionsByUser": {
        const userId = sp.get("userId") ?? "";
        return await getUnresolvedSuggestionsByUser(userId);
      }
      case "getUnresolvedCountByUser": {
        const userId = sp.get("userId") ?? "";
        return await getUnresolvedCountByUser(userId);
      }
      case "getUnresolvedCountByProject": {
        const projectId = sp.get("projectId") ?? "";
        return await getUnresolvedCountByProject(projectId);
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
      case "addSuggestion":
        requireUserId(body);
        return await addSuggestion(body);
      case "markSuggestionAsRead":
        return await markSuggestionAsRead(body.id);
      case "markSuggestionAsResolved":
        return await markSuggestionAsResolved(body.id);
      case "markAllAsReadByProject":
        return await markAllAsReadByProject(body.projectId);
      case "deleteSuggestion":
        return await deleteSuggestion(body.id);
      case "addSuggestionsBatch":
        requireUserId(body);
        return await addSuggestionsBatch(body);
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  });
}