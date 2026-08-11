import { NextResponse } from "next/server";
import { shouldUpdateSummary, generateAndSaveSummary } from "@/lib/projectSummaryGenerator";

/**
 * POST /api/agents/generate-project-summary
 *
 * Action "should_update": LLM gate — đánh giá các tin nhắn mới có biến động
 * đáng chú ý không (dùng từ queue worker sau mỗi sync có tin mới).
 *
 * Action "generate": sinh + LƯU version tóm tắt mới (auto từ queue / manual từ UI)
 *
 * Body: { action, projectId, userId, trigger?, projectName?, projectStatus?, newMessages?, latestSummaryText? }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = body.action || "generate";

    if (action === "should_update") {
      const result = await shouldUpdateSummary({
        projectName: body.projectName || "Dự án",
        projectStatus: body.projectStatus || "",
        newMessages: body.newMessages || [],
        latestSummaryText: body.latestSummaryText || null,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === "generate") {
      const { projectId, userId, trigger } = body;
      if (!projectId || !userId) {
        return NextResponse.json({ error: "Missing projectId or userId" }, { status: 400 });
      }
      const created = await generateAndSaveSummary({
        projectId,
        userId,
        trigger: trigger === "manual" ? "manual" : "auto",
      });
      if (!created) {
        return NextResponse.json({ error: "Failed to generate summary" }, { status: 500 });
      }
      return NextResponse.json({ ok: true, summary: created });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    console.error("[generate-project-summary] Error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}