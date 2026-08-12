import { NextRequest } from "next/server";
import { analyzePreinfo } from "@/lib/preinfoAnalyzer";
import { requireUserId, readJsonBody, handleRoute } from "../_helpers";

export const runtime = "nodejs";

/**
 * Phân tích yêu cầu sơ bộ từ Pre-sale (paste text) bằng LLM:
 * detect scope + next actions + gợi ý tính năng multi-choice.
 * POST { userId, text } → { analysis: { scope[], nextActions[], featureSuggestions[] }, source: "llm"|"fallback" }
 */
export async function POST(req: NextRequest) {
  return handleRoute(req, async (req) => {
    const body = await readJsonBody(req);
    requireUserId(body);
    const text = String(body.text ?? "").trim();
    if (!text) {
      const err: any = new Error("Missing text");
      err.status = 400;
      throw err;
    }
    return await analyzePreinfo(text);
  });
}
