/**
 * Shared PM action monitor — used by sync-single-chat, sync-all-projects
 * and auto-monitor. Analyzes recent messages (cross-platform: Teams + Zalo)
 * with an LLM and creates suggestions in projectSuggestions with priority.
 */

import { getMessagesByProject } from "../../../src/lib/repo/projectChats";
import {
  addSuggestionsBatch,
  collapseOlderPendingDuplicatesByProject,
  getSuggestionsByProject,
} from "../../../src/lib/repo/projectSuggestions";
import { runDebatePipeline } from "../../../src/lib/ai/debate";
import { getSessionByProject, getGeneralSession, addMessage, getMessages } from "../../../src/lib/repo/agentsPm";
import { getProject } from "../../../src/lib/repo/projects";
import { getMembersByProject } from "../../../src/lib/repo/projectMembers";
import { isPendingDuplicate, isPendingItem } from "../../../src/lib/suggestionDedup";

export interface MonitorMessage {
  sender?: string;
  content?: string;
  platform?: string;
  chatName?: string;
  images?: any[];
}

/**
 * Analyze the last N messages (across ALL platforms of the project) and
 * create PM action suggestions.
 *
 * One LLM call per project (not per chat) — call once after all groups
 * of a project have been synced to avoid N sequential LLM round trips.
 *
 * @param savedMessages  messages just saved by the sync (fallback if DB query fails)
 * @param projectId      project id
 * @param chatName       chat that was just synced
 * @param userId         owner user id
 * @param projectName    optional project name for context
 */
export async function runMonitor(
  savedMessages: MonitorMessage[],
  projectId: string | number,
  chatName: string,
  userId: string,
  projectName?: string
) {
  if (!savedMessages || savedMessages.length === 0) return;

  try {
    // Không monitor project đã archive/delete — user không còn theo dõi dự án
    // này nữa, không nên tốn LLM call hay tạo gợi ý cho nó.
    let projectGroups: Array<{ name: string; platform?: string; type?: string }> = [];
    try {
      const proj = await getProject(projectId);
      if (proj && ((proj as any)?.archived || (proj as any)?.deletedAt)) {
        console.log(`[Monitor] Skip project ${projectId} — archived/deleted.`);
        return;
      }
      if (Array.isArray((proj as any)?.teamsGroups)) {
        projectGroups = (proj as any).teamsGroups
          .filter((g: any) => g && g.name)
          .map((g: any) => ({ name: g.name, platform: g.platform, type: g.type }));
      }
    } catch { /* DB lỗi thì vẫn tiếp tục như cũ */ }

    console.log(`[Monitor] Analysing ${savedMessages.length} new messages for PM action...`);

    // Merge recent messages from BOTH platforms for full context
    let crossPlatformLog: string[] = [];
    let recent: any[] = [];
    try {
      recent = (await getMessagesByProject(projectId, undefined)) || [];
      crossPlatformLog = recent
        .map((m: any) => `[${m.platform || ""}] [${m.chatName || ""}] ${m.sender || "Unknown"}: ${(m.content || "").slice(0, 400)}`)
        .filter((s: string) => s.length > 0);
    } catch (e) {
      console.warn(`[Monitor] Could not load cross-platform history: ${e}`);
    }
    // Fall back to the just-saved messages if DB query failed
    if (crossPlatformLog.length === 0) {
      recent = savedMessages.slice(-30);
      crossPlatformLog = recent
        .map((m: any) => `[${m.sender || "Unknown"}]: ${(m.content || "").slice(0, 500)}`)
        .filter((s: string) => s.length > 0);
    }

    const messageLog = crossPlatformLog.join("\n");

    // Tải danh sách thành viên dự án (đặc biệt Sale) để LLM điền tên/xưng hô trong checklist message
    let members: Array<{ name?: string; email?: string; roleName?: string }> = [];
    try {
      const m = await getMembersByProject(projectId);
      members = (m || []).map((mm: any) => ({
        name: mm.name,
        email: mm.email,
        roleName: mm.roleName,
      }));
    } catch (e) {
      console.warn(`[Monitor] Could not load project members: ${e}`);
    }

    // ── Phân tích bằng multi-agent debate pipeline ──
    // Stage 0 (LLM chọn quy trình từ kho — semantic, KHÔNG keyword-match)
    // + Stage 1/2/3 (per-group → synthesis → critic). Trả về suggestions
    // đã verified kèm confidence.
    // Giới hạn 20 tin gần nhất để tránh timeout LLM khi project có nhiều lịch sử.
    // Gộp bản trùng chưa làm + tải gợi ý pending để không báo lại cùng chủ đề.
    try {
      const n = await collapseOlderPendingDuplicatesByProject(projectId);
      if (n > 0) console.log(`[Monitor] Collapsed ${n} older pending duplicate suggestion(s).`);
    } catch (e) {
      console.warn(`[Monitor] Collapse pending duplicates failed: ${e}`);
    }
    let pendingSuggestions: any[] = [];
    try {
      const existing = await getSuggestionsByProject(projectId);
      pendingSuggestions = (existing || []).filter((s: any) => isPendingItem(s));
    } catch (e) {
      console.warn(`[Monitor] Could not load existing suggestions: ${e}`);
    }

    const recentForAnalysis = recent.slice(-20);
    const debate = await runDebatePipeline({
      projectName: projectName || `Dự án ${projectId}`,
      projectId,
      messages: recentForAnalysis.map((m: any) => {
        const g = projectGroups.find((x) => x.name === m.chatName);
        return {
          sender: m.sender,
          chatName: m.chatName,
          content: m.content,
          platform: m.platform || g?.platform,
          timestampMs: m.timestampMs,
          groupType: g?.type === "customer" || g?.type === "internal" ? g.type : undefined,
        };
      }),
      projectContext: messageLog,
      userId,
      members,
      projectGroups,
      pendingSuggestions,
      includeTrace: false,
    });

    let actions: any[] = debate.suggestions || [];

    if (actions.length === 0) {
      console.log(`[Monitor] No PM action needed`);
      return;
    }

    console.log(`[Monitor] Found ${actions.length} action(s) needing PM:`);
    actions.forEach((a: any) => console.log(`  - [${a.confidence || "medium"}] ${a.title}: ${a.actionLabel || ""}`));

    const saved = await addSuggestionsBatch({
      projectId: projectId,
      userId,
      suggestions: actions.map((a: any) => ({
        type: a.type || "action_item",
        title: a.title || "Cần PM xử lý",
        description: a.description || "",
        sourceSender: a.sourceSender,
        sourceChatName: a.sourceChatName || chatName,
        sourceMessage: a.sourceMessage,
        actionLabel: a.actionLabel,
        // Encode priority + confidence + detected time + reasoning details in suggestionData for UI display
        suggestionData: JSON.stringify({
          priority: a.priority || a.confidence || "medium",
          confidence: a.confidence || "medium",
          detectedAt: Date.now(),
          input: a.input,
          reasoning: a.reasoning,
          expectedOutcome: a.expectedOutcome,
          checklist: Array.isArray(a.checklist) ? a.checklist : null,
        }),
      })),
    });

    console.log(`[Monitor] Saved ${saved.saved} new suggestion(s) to Postgres${saved.skipped ? `, skipped ${saved.skipped} pending duplicate(s)` : ""}.`);

    // Chỉ báo chat những gợi ý THẬT SỰ mới lưu — không nhắn lại card pending chưa làm.
    const newActions = actions.filter((a: any) =>
      (saved.inserted || []).some(
        (s) => s.title === (a.title || "Cần PM xử lý") && s.description === (a.description || "")
      )
    );
    if (newActions.length > 0) {
      await notifyPmChat({ actions: newActions, projectId, userId, projectName });
    }
  } catch (err) {
    console.warn(`[Monitor] Error:`, err);
  }
}

/**
 * Gửi tin nhắn thông báo gợi ý mới vào khung chat PM Agent.
 * Ưu tiên session của project; nếu chưa có thì dùng general session.
 * Nếu không có session nào → bỏ qua (tin nhắn sẽ chỉ hiện ở panel Gợi ý).
 */
async function notifyPmChat(opts: {
  actions: any[];
  projectId: string | number;
  userId: string;
  projectName?: string;
}): Promise<void> {
  try {
    let { actions, projectId, userId, projectName } = opts;

    let sessionId: number | null = null;
    try {
      const projectSession = await getSessionByProject(userId, projectId);
      if (projectSession) {
        sessionId = Number(projectSession._id);
      } else {
        const general = await getGeneralSession(userId);
        if (general) sessionId = Number(general._id);
      }
    } catch (e) {
      console.warn(`[Monitor] Could not resolve PM session: ${e}`);
      return;
    }

    if (!sessionId) {
      console.log(`[Monitor] No PM session found — skip chat notification.`);
      return;
    }

    // Nếu khung chat đã có card cùng chủ đề chưa thực thi → không nhắn lại.
    try {
      const recent = await getMessages(sessionId);
      const pendingNotifs: any[] = [];
      for (const m of (recent || []).slice(-40)) {
        if (!m.metadata) continue;
        let meta: any;
        try {
          meta = JSON.parse(m.metadata);
        } catch {
          continue;
        }
        if (meta?.action !== "suggestion_notification" || !Array.isArray(meta.suggestions)) continue;
        for (const s of meta.suggestions) {
          pendingNotifs.push({
            title: s.title,
            description: s.description,
            sourceMessage: s.sourceMessage,
            checklist: s.checklist,
            isResolved: false,
          });
        }
      }
      const fresh = actions.filter((a: any) => !isPendingDuplicate(a, pendingNotifs));
      if (fresh.length === 0) {
        console.log(`[Monitor] Skip chat notification — pending unexecuted card already in session ${sessionId}.`);
        return;
      }
      actions = fresh;
    } catch (e) {
      console.warn(`[Monitor] Could not check existing chat notifications: ${e}`);
    }

    // Tên dự án để hiển thị trong tin nhắn
    let displayName = projectName || `Dự án ${projectId}`;
    if (!projectName) {
      try {
        const proj = await getProject(projectId);
        if (proj) displayName = proj.name;
      } catch { /* ignore */ }
    }

    const lines = actions.slice(0, 5).map((a: any) => {
      const conf = a.confidence || "medium";
      const confLabel = conf === "high" ? "🔴" : conf === "low" ? "🟢" : "🟡";
      const src = a.sourceChatName ? ` (${a.sourceChatName})` : "";
      return `- ${confLabel} **${a.title || "Gợi ý"}**${src}\n  ${(a.description || "").slice(0, 180)}`;
    });

    // Checklist (các bước hành động cụ thể) — từ steps quy trình nghiệp vụ khớp.
    // Hiển thị dạng checkbox để PM biết việc cần làm ngay.
    const checklistLines = actions
      .slice(0, 5)
      .flatMap((a: any) => {
        const cl = Array.isArray(a.checklist) ? a.checklist : [];
        if (cl.length === 0) return [];
        return [
          `  📋 **${a.title || "Gợi ý"}**:`,
          ...cl.map((c: any) => {
            const grp = c.targetGroup ? ` → **${c.targetGroup}**` : "";
            const msg = c.messageContent ? `\n      \`${c.messageContent}\`` : "";
            return `    - ☐ ${c.title || ""}${grp}${msg}`;
          }),
        ];
      });

    const extra = actions.length > 5 ? `\n\n... và ${actions.length - 5} gợi ý khác.` : "";

    const content =
      `📬 **PM Agents phát hiện ${actions.length} gợi ý mới** cho dự án **${displayName}**:\n\n` +
      lines.join("\n") +
      (checklistLines.length > 0 ? `\n\n${checklistLines.join("\n")}` : "") +
      `${extra}\n\nBạn có thể xem chi tiết & xử lý trong mục **Gợi ý** (biểu tượng ✨ bên trái).`;

    // Metadata chứa đầy đủ thông tin chi tiết từng gợi ý (reasoning + checklist)
    // để frontend render nguyên nhân, checklist action và nút Duyệt/Từ chối.
    const suggestionItems = actions.map((a: any) => ({
      title: a.title || "Gợi ý",
      description: a.description || "",
      type: a.type || "action_item",
      confidence: a.confidence || "medium",
      priority: a.priority || a.confidence || "medium",
      sourceSender: a.sourceSender || null,
      sourceChatName: a.sourceChatName || null,
      sourceMessage: a.sourceMessage || null,
      actionLabel: a.actionLabel || null,
      input: a.input || null,
      reasoning: a.reasoning || null,
      expectedOutcome: a.expectedOutcome || null,
      checklist: Array.isArray(a.checklist) ? a.checklist : null,
    }));

    await addMessage({
      sessionId,
      role: "agent",
      content,
      metadata: JSON.stringify({
        action: "suggestion_notification",
        projectId: String(projectId),
        projectName: displayName,
        suggestionCount: actions.length,
        suggestions: suggestionItems,
      }),
    });
    console.log(`[Monitor] Sent chat notification to PM session ${sessionId}.`);
  } catch (err) {
    console.warn(`[Monitor] Chat notification failed (non-fatal):`, err);
  }
}
