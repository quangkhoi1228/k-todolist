import { NextRequest, NextResponse } from "next/server";
import {
  getTaskTemplates,
  getTaskTemplate,
  detectTemplateForProject,
  createTaskTemplate,
  updateTaskTemplate,
  deleteTaskTemplate,
} from "@/lib/repo/taskTemplates";
import { requireUserId, readJsonBody, handleRoute } from "../_helpers";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return handleRoute(req, async () => {
    const sp = new URL(req.url).searchParams;
    const userId = requireUserId({ userId: sp.get("userId") });
    const action = sp.get("action") ?? "getTaskTemplates";
    switch (action) {
      case "getTaskTemplates": {
        const includeInactive = sp.get("includeInactive") === "true";
        return await getTaskTemplates(userId, includeInactive);
      }
      case "getTaskTemplate": {
        const id = sp.get("id") ?? "";
        return await getTaskTemplate(id);
      }
      case "detectTemplateForProject": {
        const text = sp.get("text") ?? "";
        return await detectTemplateForProject(userId, text);
      }
      default:
        return { error: `Unknown action: ${action}` };
    }
  });
}

export async function POST(req: NextRequest) {
  return handleRoute(req, async (req) => {
    const body = await readJsonBody(req);
    requireUserId(body);
    const action = body.action;
    switch (action) {
      case "createTaskTemplate":
        return await createTaskTemplate(body);
      case "updateTaskTemplate":
        return await updateTaskTemplate(body.id, body.updates ?? body);
      case "deleteTaskTemplate":
        return await deleteTaskTemplate(body.id, body.userId);
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  });
}
