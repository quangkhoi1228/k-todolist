import { NextRequest, NextResponse } from "next/server";
import { getSessions, getSession, getSessionByTicket, getMessages, getGeneralSession, getSessionByProject, getProjectSessions, createGeneralSession, createProjectSession, createSession, updateSession, addMessage, advanceStep, deleteSession, createCustomProject, createProjectFromTicket } from "@/lib/repo/agentsPm";
import { requireUserId, readJsonBody, handleRoute } from "../_helpers";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return handleRoute(req, async (req) => {
    const sp = new URL(req.url).searchParams;
    const action = sp.get("action") ?? "getSessions";
    switch (action) {
      case "getSessions": {
        const userId = sp.get("userId") ?? "";
        return await getSessions(userId);
      }
      case "getSession": {
        const id = sp.get("id") ?? "";
        return await getSession(id);
      }
      case "getSessionByTicket": {
        const userId = sp.get("userId") ?? "";
        const ticketId = sp.get("ticketId") ?? "";
        return await getSessionByTicket(userId, ticketId);
      }
      case "getMessages": {
        const sessionId = sp.get("sessionId") ?? "";
        return await getMessages(sessionId);
      }
      case "getGeneralSession": {
        const userId = sp.get("userId") ?? "";
        return await getGeneralSession(userId);
      }
      case "getSessionByProject": {
        const userId = sp.get("userId") ?? "";
        const projectId = sp.get("projectId") ?? "";
        return await getSessionByProject(userId, projectId);
      }
      case "getProjectSessions": {
        const userId = sp.get("userId") ?? "";
        return await getProjectSessions(userId);
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
      case "createGeneralSession":
        requireUserId(body);
        return await createGeneralSession(body.userId);
      case "createProjectSession":
        requireUserId(body);
        return await createProjectSession(body.userId, body.projectId, body.projectName);
      case "createSession":
        requireUserId(body);
        return await createSession(body);
      case "updateSession":
        return await updateSession(body.id, body);
      case "addMessage":
        return await addMessage(body);
      case "advanceStep":
        return await advanceStep(body.id, body.step);
      case "deleteSession":
        return await deleteSession(body.id);
      case "createCustomProject":
        requireUserId(body);
        return await createCustomProject(body.userId, body.projectName);
      case "createProjectFromTicket":
        requireUserId(body);
        return await createProjectFromTicket(body);
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  });
}