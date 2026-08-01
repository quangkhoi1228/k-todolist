/**
 * LLM Intent Parser Client
 * Goi API route /api/agents/parse-intent de phan tich yeu cau tu nhien
 * Neu LLM khong available, fallback ve rule-based parser
 */

import { parseIntent, generateAgentResponse } from "./intent-parser";
import type { ParsedIntent } from "./intent-parser";

export type LLMAction = "create_project" | "lookup_ticket" | "view_project" | "goto_project" | "chat" | "add_personnel" | "create_meeting" | "update_sow";

export interface LLMResult {
  action: LLMAction;
  ticketId: string | null;
  projectQuery?: string | null;
  reply: string;
  confidence: number;
}

export async function analyzeWithLLM(
  text: string,
  history?: Array<{ role: "user" | "agent" | "system"; content: string }>,
  contextProject?: { name: string; ticketId?: string | null } | null
): Promise<LLMResult> {
  try {
    const res = await fetch("/api/agents/parse-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        history: (history || []).slice(-10),
        contextProject: contextProject || null,
      }),
    });

    if (!res.ok) {
      console.warn("[LLM] API error:", res.status);
      return fallbackParse(text);
    }

    const data: LLMResult = await res.json();

    // Validate response
    const validActions = ["create_project", "lookup_ticket", "view_project", "goto_project", "chat", "add_personnel", "create_meeting", "update_sow"];
    if (!data.action || !validActions.includes(data.action)) {
      return fallbackParse(text);
    }

    return data;
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
  };
}
