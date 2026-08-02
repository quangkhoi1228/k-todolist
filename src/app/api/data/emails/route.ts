import { NextRequest, NextResponse } from "next/server";
import { getByUser, getByProject, getEmailById, createEmailLog, updateEmailStatus, setEmailProject, deleteEmail, searchRecipients, getAllRecipients, saveRecipient, saveRecipients } from "@/lib/repo/emails";
import { requireUserId, readJsonBody, handleRoute } from "../_helpers";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return handleRoute(req, async (req) => {
    const sp = new URL(req.url).searchParams;
    const action = sp.get("action") ?? "getByUser";
    switch (action) {
      case "getByUser": {
        const userId = sp.get("userId") ?? "";
        const limit = sp.get("limit") ? Number(sp.get("limit")) : undefined;
        const projectId = sp.get("projectId") ?? undefined;
        return await getByUser({ userId, limit, projectId });
      }
      case "getByProject": {
        const projectId = sp.get("projectId") ?? "";
        const limit = sp.get("limit") ? Number(sp.get("limit")) : undefined;
        return await getByProject(projectId, limit);
      }
      case "getById": {
        const id = sp.get("id") ?? "";
        return await getEmailById(id);
      }
      case "searchRecipients": {
        const userId = sp.get("userId") ?? "";
        const query = sp.get("query") ?? "";
        const limit = sp.get("limit") ? Number(sp.get("limit")) : undefined;
        return await searchRecipients(userId, query, limit);
      }
      case "getAllRecipients": {
        const userId = sp.get("userId") ?? "";
        return await getAllRecipients(userId);
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
      case "createEmailLog":
        requireUserId(body);
        return await createEmailLog(body);
      case "updateEmailStatus":
        return await updateEmailStatus(body.id, body.status, body.errorMessage);
      case "setProject":
        return await setEmailProject(body.id, body.projectId);
      case "deleteEmail":
        return await deleteEmail(body.id);
      case "saveRecipient":
        requireUserId(body);
        return await saveRecipient(body.userId, body.email, body.name);
      case "saveRecipients":
        requireUserId(body);
        return await saveRecipients(body.userId, body.emails ?? []);
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  });
}