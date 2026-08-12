import { NextRequest, NextResponse } from "next/server";
import { getMembersByProject, addMember, addOrUpdateMember, updateMember, removeMember } from "@/lib/repo/projectMembers";
import { requireUserId, readJsonBody, handleRoute } from "../_helpers";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return handleRoute(req, async (req) => {
    const sp = new URL(req.url).searchParams;
    const action = sp.get("action") ?? "getMembersByProject";
    switch (action) {
      case "getMembersByProject": {
        const projectId = sp.get("projectId") ?? "";
        return await getMembersByProject(projectId);
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
      case "addMember":
        requireUserId(body);
        return await addMember(body);
      case "addOrUpdateMember":
        requireUserId(body);
        return await addOrUpdateMember(body);
      case "updateMember":
        return await updateMember(body.id, body);
      case "removeMember":
        return await removeMember(body.id);
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  });
}