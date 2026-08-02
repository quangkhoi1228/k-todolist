import { NextRequest, NextResponse } from "next/server";
import { getUserPreferences, updateUserPreferences } from "@/lib/repo/userPreferences";
import { requireUserId, readJsonBody, handleRoute } from "../_helpers";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return handleRoute(req, async (req) => {
    const sp = new URL(req.url).searchParams;
    const userId = sp.get("userId") ?? "";
    return await getUserPreferences(userId);
  });
}

export async function POST(req: NextRequest) {
  return handleRoute(req, async (req) => {
    const body = await readJsonBody(req);
    requireUserId(body);
    await updateUserPreferences(body);
    return { ok: true };
  });
}