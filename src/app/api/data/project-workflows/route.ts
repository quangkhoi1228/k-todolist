import { NextRequest, NextResponse } from "next/server";
import {
  getWorkflowByProject,
  ensureWorkflow,
  updateWorkflowStep,
  updateWorkflowPhase,
  updateWorkflowData,
  generateTrackingTasks,
} from "@/lib/repo/projectWorkflows";
import { updateProject } from "@/lib/repo/projects";
import { requireUserId, readJsonBody, handleRoute } from "../_helpers";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return handleRoute(req, async (req) => {
    const sp = new URL(req.url).searchParams;
    const action = sp.get("action") ?? "getWorkflowByProject";
    switch (action) {
      case "getWorkflowByProject": {
        const projectId = sp.get("projectId") ?? "";
        return await getWorkflowByProject(projectId);
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
      case "ensureWorkflow":
        requireUserId(body);
        return await ensureWorkflow(body.projectId, body.userId);
      case "updateWorkflowStep":
        requireUserId(body);
        return await updateWorkflowStep(body.projectId, body.userId, body.stepKey, body.status ?? null);
      case "updateWorkflowPhase": {
        requireUserId(body);
        // Đồng bộ phase vào projects để hiển thị trên board + dùng làm input các bước tiếp theo
        await updateProject(body.projectId, { phase: body.phase });
        return await updateWorkflowPhase(body.projectId, body.userId, body.phase, body.patch);
      }
      case "updateWorkflowData":
        requireUserId(body);
        return await updateWorkflowData(body.projectId, body.userId, body.patch ?? {});
      case "generateTrackingTasks": {
        requireUserId(body);
        const created = await generateTrackingTasks({
          projectId: body.projectId,
          userId: body.userId,
          items: body.items ?? [],
          prefix: body.prefix,
        });
        return { ok: true, tasks: created };
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  });
}
