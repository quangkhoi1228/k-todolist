import { NextRequest, NextResponse } from "next/server";
import { getTasks, getTasksByProject, createTask, updateTask, updateTaskOrders, deleteTask, getAllDependencies, getTaskDependencies, getTaskDependents, createDependency, deleteDependency, isTaskBlocked } from "@/lib/repo/tasks";
import { requireUserId, readJsonBody, handleRoute } from "../_helpers";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return handleRoute(req, async (req) => {
    const sp = new URL(req.url).searchParams;
    const action = sp.get("action") ?? "getTasks";
    switch (action) {
      case "getTasks": {
        const userId = sp.get("userId") ?? "";
        return await getTasks(userId);
      }
      case "getTasksByProject": {
        const projectId = sp.get("projectId") ?? "";
        return await getTasksByProject(projectId);
      }
      case "getAllDependencies": {
        const userId = sp.get("userId") ?? "";
        return await getAllDependencies(userId);
      }
      case "getTaskDependencies": {
        const taskId = sp.get("taskId") ?? "";
        return await getTaskDependencies(taskId);
      }
      case "getTaskDependents": {
        const taskId = sp.get("taskId") ?? "";
        return await getTaskDependents(taskId);
      }
      case "isTaskBlocked": {
        const taskId = sp.get("taskId") ?? "";
        return await isTaskBlocked(taskId);
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
      case "createTask":
        requireUserId(body);
        return await createTask(body);
      case "updateTask":
        return await updateTask(body.id, body);
      case "updateTaskOrders":
        return await updateTaskOrders(body.updates ?? []);
      case "deleteTask":
        return await deleteTask(body.id);
      case "createDependency":
        requireUserId(body);
        return await createDependency(body);
      case "deleteDependency":
        return await deleteDependency(body.id);
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  });
}