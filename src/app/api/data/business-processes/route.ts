import { NextRequest, NextResponse } from "next/server";
import {
  getBusinessProcesses,
  getBusinessProcess,
  searchBusinessProcesses,
  createBusinessProcess,
  updateBusinessProcess,
  deleteBusinessProcess,
} from "@/lib/repo/businessProcesses";
import { requireUserId, readJsonBody, handleRoute } from "../_helpers";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return handleRoute(req, async () => {
    const sp = new URL(req.url).searchParams;
    const userId = requireUserId({ userId: sp.get("userId") });
    const action = sp.get("action") ?? "getBusinessProcesses";
    switch (action) {
      case "getBusinessProcesses": {
        const includeInactive = sp.get("includeInactive") === "true";
        return await getBusinessProcesses(userId, includeInactive);
      }
      case "getBusinessProcess": {
        const id = sp.get("id") ?? "";
        return await getBusinessProcess(id);
      }
      case "searchBusinessProcesses": {
        const keywords = (sp.get("keywords") ?? "").split(",");
        const category = sp.get("category") || undefined;
        const limit = Number(sp.get("limit") ?? 5);
        return await searchBusinessProcesses(userId, keywords, category, limit);
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
      case "createBusinessProcess":
        return await createBusinessProcess(body);
      case "updateBusinessProcess":
        return await updateBusinessProcess(body.id, body.updates ?? body);
      case "deleteBusinessProcess":
        return await deleteBusinessProcess(body.id);
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  });
}