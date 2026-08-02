import { NextRequest, NextResponse } from "next/server";
import { getRoles, getRoleUsageCounts, seedDefaultRoles, createRole, updateRole, deleteRole } from "@/lib/repo/projectRoles";
import { requireUserId, readJsonBody, handleRoute } from "../_helpers";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return handleRoute(req, async (req) => {
    const sp = new URL(req.url).searchParams;
    const action = sp.get("action") ?? "getRoles";
    switch (action) {
      case "getRoles": {
        const userId = sp.get("userId") ?? "";
        return await getRoles(userId);
      }
      case "getRoleUsageCounts": {
        const userId = sp.get("userId") ?? "";
        return await getRoleUsageCounts(userId);
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
      case "seedDefaultRoles":
        requireUserId(body);
        return await seedDefaultRoles(body.userId);
      case "createRole":
        requireUserId(body);
        return await createRole(body);
      case "updateRole":
        return await updateRole(body.id, body);
      case "deleteRole":
        return await deleteRole(body.id);
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  });
}