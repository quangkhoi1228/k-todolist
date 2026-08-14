/**
 * LLM Intent Parser Client
 * Goi API route /api/agents/parse-intent de phan tich yeu cau tu nhien
 * Neu LLM khong available, fallback ve rule-based parser
 */

import { parseIntent, generateAgentResponse } from "./intent-parser";
import type { ParsedIntent } from "./intent-parser";

export type LLMAction = "create_project" | "lookup_ticket" | "view_project" | "goto_project" | "chat" | "add_personnel" | "create_meeting" | "update_sow" | "add_task" | "send_message" | "send_email";

export interface LLMTaskItem {
  title: string;
  detail?: string;
  priority?: "low" | "normal" | "high";
  pic?: string;
  support?: string;
  dueDate?: string;
  manday?: number;
}

export interface LLMResult {
  action: LLMAction;
  ticketId: string | null;
  projectQuery?: string | null;
  reply: string;
  confidence: number;
  tasks?: LLMTaskItem[] | null;
  // send_message
  platform?: "teams" | "zalo";
  chatName?: string;
  messageBody?: string;
  memberName?: string;
  // send_email
  emailTo?: string[];
  emailSubject?: string;
  emailBody?: string;
}

export async function analyzeWithLLM(
  text: string,
  history?: Array<{ role: "user" | "agent" | "system"; content: string }>,
  contextProject?: { name: string; ticketId?: string | null } | null,
  members?: Array<{ name: string; roleName: string; email?: string | null }> | null,
  groups?: Array<{ name: string; type: string; platform?: string }> | null
): Promise<LLMResult> {
  try {
    const res = await fetch("/api/agents/parse-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        history: (history || []).slice(-10),
        contextProject: contextProject || null,
        members: members || null,
        groups: groups || null,
      }),
    });

    if (!res.ok) {
      console.warn("[LLM] API error:", res.status);
      return fallbackParse(text);
    }

    const data: LLMResult = await res.json();

    // Validate response
    const validActions = ["create_project", "lookup_ticket", "view_project", "goto_project", "chat", "add_personnel", "create_meeting", "update_sow", "add_task", "send_message", "send_email"];
    if (!data.action || !validActions.includes(data.action)) {
      return fallbackParse(text);
    }

    const tasks = Array.isArray(data.tasks) && data.tasks.length > 0
      ? data.tasks
          .map((t: any) => (typeof t === "string" ? { title: t } : t))
          .filter((t: any) => t && typeof t.title === "string" && t.title.trim())
          .map((t: any) => ({
            title: t.title.trim(),
            detail: typeof t.detail === "string" ? t.detail.trim() : undefined,
            priority: ["low", "normal", "high"].includes(t.priority) ? t.priority : undefined,
            pic: typeof t.pic === "string" && t.pic.trim() ? t.pic.trim() : undefined,
            support: typeof t.support === "string" && t.support.trim() ? t.support.trim() : undefined,
            dueDate: typeof t.dueDate === "string" && t.dueDate.trim() ? t.dueDate.trim() : undefined,
            manday: typeof t.manday === "number" && t.manday > 0 ? t.manday : undefined,
          }))
      : undefined;

    // add_task phải kèm danh sách task — thiếu thì coi như chat
    if (data.action === "add_task" && !tasks) {
      return { ...fallbackParse(text), action: "chat" as const };
    }

    return { ...data, tasks };
  } catch (err) {
    console.warn("[LLM] Network error, fallback to rule-based:", err);
    return fallbackParse(text);
  }
}

/**
 * Fallback: dung rule-based parser khi LLM khong available
 */
function fallbackParse(text: string): LLMResult {
  const intent = parseIntent(text);

  // For goto_project, extract project query from the original text
  let projectQuery: string | null = null;
  if (intent.action === "goto_project") {
    // Remove common leading phrases, keep the rest as the project name/query
    const cleaned = text
      .replace(/^(?:chuyển\s*(?:sang|đến|qua|tới|đi)\s+|đến\s+|tìm\s+(?:đến\s+)?|mở\s+)(?:dự\s+án|project)\s+/i, "")
      .trim();
    projectQuery = intent.ticketId || cleaned || null;
  }

  return {
    action: intent.action,
    ticketId: intent.ticketId || null,
    projectQuery,
    reply: generateAgentResponse(intent),
    confidence: intent.confidence,
    tasks: intent.action === "add_task" && intent.tasks && intent.tasks.length > 0
      ? intent.tasks
          .filter((t) => t && t.title && t.title.trim())
          .map((t) => ({
            title: t.title.trim(),
            detail: t.detail?.trim() || undefined,
            priority: (["low", "normal", "high"].includes(t.priority ?? "") ? t.priority : undefined) as LLMTaskItem["priority"],
          }))
      : undefined,
    platform: intent.platform,
    chatName: intent.chatName,
    messageBody: intent.messageBody,
    memberName: intent.memberName,
    emailTo: intent.emailTo,
    emailSubject: intent.emailSubject,
    emailBody: intent.emailBody,
  };
}
