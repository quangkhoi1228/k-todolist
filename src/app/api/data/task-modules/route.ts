import { NextRequest, NextResponse } from "next/server";
import {
  getTaskModules,
  getTaskModule,
  createTaskModule,
  updateTaskModule,
  deleteTaskModule,
} from "@/lib/repo/taskModules";
import { readJsonBody, handleRoute } from "../_helpers";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return handleRoute(req, async () => {
    const sp = new URL(req.url).searchParams;
    const action = sp.get("action") ?? "getTaskModules";
    switch (action) {
      case "getTaskModules":
        return await getTaskModules(null);
      case "getTaskModule": {
        const id = sp.get("id") ?? "";
        return await getTaskModule(id);
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
      case "createTaskModule":
        return await createTaskModule({ ...body, userId: body.userId ?? null });
      case "updateTaskModule":
        return await updateTaskModule(body.id, body.updates ?? body);
      case "deleteTaskModule":
        return await deleteTaskModule(body.id);
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  });
}
