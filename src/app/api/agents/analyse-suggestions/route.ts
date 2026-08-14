import { NextResponse } from "next/server";
import { runDebatePipeline } from "@/lib/ai/debate";
import { createDebateRun } from "@/lib/repo/debateRuns";
import { getMembersByProject } from "@/lib/repo/projectMembers";
import { getProject } from "@/lib/repo/projects";
import { getSuggestionsByProject } from "@/lib/repo/projectSuggestions";
import { isPendingItem } from "@/lib/suggestionDedup";

export const runtime = "nodejs";

/**
 * POST /api/agents/analyse-suggestions
 *
 * Multi-agent debate pipeline (3-stage) for analysing project messages and
 * generating PM action suggestions. Thin wrapper around the shared
 * `runDebatePipeline` in `src/lib/ai/debate.ts` (also used by monitor).
 *
 * Body:
 *   { projectName, projectId, messages, projectContext?, userId?, includeTrace? }
 *
 * Sau khi chạy pipeline, kết quả được lưu vào bảng `debateRuns` để xem lịch sử.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { projectName, projectId, messages, projectContext, userId } = body as {
      projectName: string;
      projectId: string;
      messages: any[];
      projectContext?: string;
      userId?: string;
    };

    // Tải danh sách thành viên + nhóm chat dự án để LLM/checklist điền Zalo/Teams thật
    let members: Array<{ name?: string; email?: string; roleName?: string }> = [];
    let projectGroups: Array<{ name: string; platform?: string; type?: string }> = [];
    let pendingSuggestions: any[] = [];
    if (projectId) {
      try {
        const m = await getMembersByProject(projectId);
        members = (m || []).map((mm: any) => ({
          name: mm.name,
          email: mm.email,
          roleName: mm.roleName,
        }));
      } catch (e) {
        console.warn("[AnalyseSuggestions] Could not load project members:", e);
      }
      try {
        const proj = await getProject(projectId);
        if (Array.isArray((proj as any)?.teamsGroups)) {
          projectGroups = (proj as any).teamsGroups
            .filter((g: any) => g && g.name)
            .map((g: any) => ({ name: g.name, platform: g.platform, type: g.type }));
        }
      } catch (e) {
        console.warn("[AnalyseSuggestions] Could not load project groups:", e);
      }
      try {
        const existing = await getSuggestionsByProject(projectId);
        pendingSuggestions = (existing || []).filter((s: any) => isPendingItem(s));
      } catch (e) {
        console.warn("[AnalyseSuggestions] Could not load pending suggestions:", e);
      }
    }

    const result = await runDebatePipeline({
      projectName,
      projectId,
      messages,
      projectContext,
      userId,
      members,
      projectGroups,
      pendingSuggestions,
      includeTrace: body.includeTrace !== false,
    });

    // Persist debate run history (best-effort — không fail request nếu lưu lỗi)
    if (userId && projectId) {
      try {
        await createDebateRun({
          projectId,
          userId,
          result: result as unknown as Record<string, unknown>,
          suggestionCount: result.suggestions?.length ?? 0,
          conflictCount: result.conflicts?.length ?? 0,
          totalMs: result.debugInfo?.totalMs ?? 0,
          groupCount: result.debugInfo?.groupCount ?? 0,
        });
      } catch (e) {
        console.warn("[AnalyseSuggestions] Failed to save debate run history:", e);
      }
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("[AnalyseSuggestions] Error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}