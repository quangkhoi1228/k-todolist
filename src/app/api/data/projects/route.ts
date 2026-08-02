import { NextRequest, NextResponse } from "next/server";
import { getProject, getProjects, getActiveProjectsWithTeamsGroups, createProject, updateProject, updateProjectDetail, updateProjectTeamsGroups, updateProjectIsdStatus, setProjectArchived, softDeleteProject, restoreProject, deleteProject, updateProjectOrders, cloneProject } from "@/lib/repo/projects";
import { requireUserId, readJsonBody, handleRoute } from "../_helpers";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return handleRoute(req, async (req) => {
    const sp = new URL(req.url).searchParams;
    const action = sp.get("action") ?? "getProjects";
    switch (action) {
      case "getProjects": {
        const userId = sp.get("userId") ?? "";
        const includeArchived = sp.get("includeArchived") === "true";
        const includeTrashed = sp.get("includeTrashed") === "true";
        return await getProjects({ userId, includeArchived, includeTrashed });
      }
      case "getProject": {
        const id = sp.get("id") ?? "";
        return await getProject(id);
      }
      case "getActiveProjectsWithTeamsGroups": {
        const userId = sp.get("userId") ?? "";
        return await getActiveProjectsWithTeamsGroups(userId);
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
      case "createProject":
        requireUserId(body);
        return await createProject({ userId: body.userId, name: body.name, color: body.color });
      case "updateProject":
        return await updateProject(body.id, body);
      case "updateProjectDetail":
        return await updateProjectDetail(body.id, body.notes);
      case "updateProjectTeamsGroups":
        return await updateProjectTeamsGroups(body.id, body);
      case "updateProjectIsdStatus":
        return await updateProjectIsdStatus(body.id, body);
      case "setProjectArchived":
        return await setProjectArchived(body.id, body.archived);
      case "softDeleteProject":
        return await softDeleteProject(body.id);
      case "restoreProject":
        return await restoreProject(body.id);
      case "deleteProject":
        return await deleteProject(body.id);
      case "updateProjectOrders":
        return await updateProjectOrders(body.updates ?? []);
      case "cloneProject":
        return await cloneProject(body.projectId, body.userId, body.name);
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  });
}