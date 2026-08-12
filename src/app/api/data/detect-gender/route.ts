import { NextRequest } from "next/server";
import { detectGenderByLLM } from "@/lib/genderDetector";
import { requireUserId, readJsonBody, handleRoute } from "../_helpers";

export const runtime = "nodejs";

/**
 * Dự đoán giới tính từ tên người bằng LLM.
 * POST { userId, names: string[] } → { genders: Record<string, "anh"|"chị"|"anh/chị"> }
 */
export async function POST(req: NextRequest) {
  return handleRoute(req, async (req) => {
    const body = await readJsonBody(req);
    requireUserId(body);
    const names: string[] = Array.isArray(body.names) ? body.names : [];
    const genders = await detectGenderByLLM(names);
    return { genders };
  });
}