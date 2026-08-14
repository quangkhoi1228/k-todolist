import { NextRequest, NextResponse } from "next/server";
import {
  getTaskTemplates,
  getTaskTemplate,
  detectTemplateForProject,
  createTaskTemplate,
  updateTaskTemplate,
  deleteTaskTemplate,
} from "@/lib/repo/taskTemplates";
import { createTasksFromTemplates } from "@/lib/repo/tasks";
import { expandTemplateItems } from "@/lib/repo/taskModules";
import { requireUserId, readJsonBody, handleRoute } from "../_helpers";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return handleRoute(req, async () => {
    const sp = new URL(req.url).searchParams;
    const action = sp.get("action") ?? "getTaskTemplates";
    switch (action) {
      case "getTaskTemplates": {
        const includeInactive = sp.get("includeInactive") === "true";
        const expand = sp.get("expand") === "true";
        const list = await getTaskTemplates(null, includeInactive);
        if (!expand) return list;
        // Resolve module references thành task items thật để UI preview hiển thị chi tiết
        const expanded = [];
        for (const t of list) {
          expanded.push({ ...t, items: await expandTemplateItems("", t.items ?? []) });
        }
        return expanded;
      }
      case "getTaskTemplate": {
        const id = sp.get("id") ?? "";
        return await getTaskTemplate(id);
      }
      case "detectTemplateForProject": {
        const text = sp.get("text") ?? "";
        return await detectTemplateForProject("", text);
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
      case "createTaskTemplate":
        return await createTaskTemplate({ ...body, userId: body.userId ?? null });
      case "updateTaskTemplate":
        return await updateTaskTemplate(body.id, body.updates ?? body);
      case "deleteTaskTemplate":
        return await deleteTaskTemplate(body.id);
      case "createFromTemplates": {
        const userId = requireUserId(body);
        const projectId = body.projectId;
        const templateIds: Array<number | string> = Array.isArray(body.templateIds)
          ? body.templateIds
          : [];
        if (!projectId) {
          return NextResponse.json({ error: "Thiếu projectId" }, { status: 400 });
        }
        return await createTasksFromTemplates({ userId, projectId, templateIds });
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  });
}
