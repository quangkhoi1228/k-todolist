import { NextRequest, NextResponse } from "next/server";

const LLM_KEY = process.env.OPENAI_API_KEY || "";
const LLM_MODEL = process.env.LLM_MODEL || "deepsseek-v4_mimo_combo";
const LLM_BASE = process.env.OPENAI_BASE_URL;

// ─── Deployment States (matches IsdFlowDiagram.tsx) ─────────────

interface StateDef {
  id: string;
  label: string;
  matchKeywords: string[];
}

const DEPLOYMENT_STATES: StateDef[] = [
  { id: "open", label: "Open", matchKeywords: ["open", "create", "tạo", "new"] },
  { id: "waiting_for_pm", label: "Waiting for PM", matchKeywords: ["waiting for pm", "waiting pm", "chờ pm", "pm assignment"] },
  { id: "kickoff", label: "Kickoff", matchKeywords: ["kickoff", "kick-off", "kick off"] },
  { id: "draft_sow", label: "Draft SOW", matchKeywords: ["draft", "sow", "technical sow", "draft sow", "soạn sow"] },
  { id: "customer_review", label: "Customer Review SOW", matchKeywords: ["customer review", "customer", "review sow", "kh review"] },
  { id: "in_progress", label: "In Progress", matchKeywords: ["in progress", "task in progress", "đang triển khai", "progress"] },
  { id: "verification", label: "Verification", matchKeywords: ["verification", "customer verification", "verify", "xác nhận", "kh verification"] },
  { id: "ho_customer_ops", label: "HO to Customer", matchKeywords: ["ho to customer", "ho to operations", "handover", "bàn giao"] },
  { id: "tl_review", label: "TL Review", matchKeywords: ["tl review", "team lead", "review worklog", "worklog review"] },
  { id: "finalize_manday", label: "Finalize Manday", matchKeywords: ["finalize", "manday", "pm finalize", "tổng hợp manday"] },
  { id: "sale_review", label: "Sale Review", matchKeywords: ["sale review", "sale confirmation", "sale approve", "sale"] },
  { id: "ho_ops", label: "HO to Ops", matchKeywords: ["pm ho", "ho to operations final", "bàn giao operations"] },
  { id: "closed", label: "Closed", matchKeywords: ["closed", "done", "hoàn thành", "đã đóng", "resolve", "resolved"] },
  { id: "suspended", label: "Suspended", matchKeywords: ["suspend", "cancel", "suspended", "cancelled", "tạm dừng", "hủy"] },
];

interface SuggestionTemplate {
  type: string;
  title: string;
  description: string;
  actionLabel?: string;
  /** Email sale (reporter) để gửi tin nhắn kickoff trực tiếp */
  saleEmail?: string;
  /** Subject email gợi ý */
  emailSubject?: string;
  /** Body email gợi ý (plain text / HTML) */
  emailBody?: string;
}

// ─── Match raw ISD status to state ID ────────────────────────

function matchState(rawStatus: string): string | undefined {
  const status = rawStatus.toLowerCase().trim();
  if (!status) return undefined;
  for (const state of DEPLOYMENT_STATES) {
    for (const kw of state.matchKeywords) {
      if (status.includes(kw)) return state.id;
    }
  }
  return undefined;
}

// ─── LLM helpers ─────────────────────────────────────────────

/** Strip SSE `data: [DONE]` trailer that some proxies append. */
function cleanRawResponse(raw: string): string {
  const idx = raw.lastIndexOf("data: [DONE]");
  return idx >= 0 ? raw.slice(0, idx).trim() : raw.trim();
}

/** Parse LLM response: handles content, reasoning_content, and various formats. */
function extractLLMContent(rawText: string): string | null {
  const cleaned = cleanRawResponse(rawText);

  try {
    const parsed = JSON.parse(cleaned);
    const choices = parsed.choices as Array<Record<string, unknown>> | undefined;
    if (choices?.[0]) {
      const msg = choices[0].message as Record<string, unknown> | undefined;

      // Standard content
      if (msg?.content && typeof msg.content === "string" && msg.content.length > 0) {
        return msg.content;
      }

      // DeepSeek reasoning_content (CoT)
      const reasoning = msg?.reasoning_content as string | undefined;
      if ((!msg?.content || (typeof msg.content === "string" && msg.content.length === 0)) && reasoning && reasoning.length > 0) {
        return reasoning;
      }

      // Streaming-style delta
      const delta = choices[0].delta as Record<string, unknown> | undefined;
      if (delta?.content && typeof delta.content === "string" && delta.content.length > 0) {
        return delta.content;
      }

      // choices[0].text (older OpenAI)
      if (choices[0].text && typeof choices[0].text === "string") {
        return choices[0].text;
      }
    }

    // Anthropic-style
    const claudeContent = parsed.content as string | Array<Record<string, unknown>> | undefined;
    if (typeof claudeContent === "string" && claudeContent.length > 0) return claudeContent;
    if (Array.isArray(claudeContent)) {
      for (const block of claudeContent) {
        if (block.type === "text" && typeof block.text === "string") return block.text;
      }
    }

    // Ollama-style
    if (parsed.response && typeof parsed.response === "string") return parsed.response;
  } catch {}

  // Regex fallback on cleaned text
  const cm = cleaned.match(/"content"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (cm) return cm[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");

  const tm = cleaned.match(/"text"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (tm) return tm[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");

  // reasoning_content regex fallback (DeepSeek)
  const rm = cleaned.match(/"reasoning_content"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (rm) return rm[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");

  return null;
}

/**
 * Extract gender from raw LLM output (handles both clean response
 * and DeepSeek reasoning_content chain-of-thought).
 * Strategy: answer is expected on the FIRST line. Fallback: search backward.
 */
function parseGenderFromLLM(raw: string): string {
  const text = raw.trim().replace(/^["']|["']$/g, "").trim();
  const lower = text.toLowerCase();

  // Short exact match
  if (lower === "anh" || lower === "chị") return lower;
  if (lower === "anh/chị" || lower === "anh / chị") return "anh/chị";

  // Answer-first: first word on first line should be the answer
  const allLines = text.split(/[\n.]+/).map(l => l.trim()).filter(Boolean);
  const lines = allLines;
  if (lines.length > 0) {
    const firstLine = lines[0].toLowerCase().replace(/^["']|["']$/g, "").trim();
    if (firstLine === "chị" || firstLine === "anh") return firstLine;
    if (firstLine === "anh/chị" || firstLine === "anh / chị") return "anh/chị";
    // First word
    const firstWord = firstLine.split(/[\s,;:]+/)[0];
    if (firstWord === "chị" || firstWord === "anh") return firstWord;
    if (firstWord === "anh/chị" || firstWord === "anh/chị") return "anh/chị";
  }

  // Search backward (for reasoning_content that put answer at end)
  for (let i = lines.length - 1; i >= 0; i--) {
    const s = lines[i].toLowerCase();
    if (s === "chị" || s === "anh") return s;
    if (s === "anh/chị" || s === "anh / chị") return "anh/chị";
    // Map "nữ"/"nam" from reasoning
    const hasThi = /\bth[iị]\b/.test(s);
    const hasKhongThi = /không\s+(có|phải)\s+th[iị]/.test(s);
    if (s.includes("nữ") && s.includes("nam")) {
      if (hasThi && !hasKhongThi) return "chị";
      continue;
    }
    if (hasThi && !hasKhongThi) return "chị";
    if (s.includes("nữ") || s.includes("nư")) return "chị";
    if (s.includes("male")) return "anh";
    if (s.includes("nam") && !s.includes("không") && !s.includes("nữ")) return "anh";
    const dung = s.match(/dùng\s+(?:từ\s+)?"(chị|anh)"/);
    if (dung) return dung[1];
    const quoted = s.match(/"(chị|anh)"/);
    if (quoted) return quoted[1];
    const arrow = s.match(/→\s*(chị|anh)/);
    if (arrow) return arrow[1];
    const kl = s.match(/kết\s*luận[^a-zà-ỹ]*(chị|anh|nữ|nam)/);
    if (kl) return kl[1] === "nữ" || kl[1] === "nam" ? (kl[1] === "nữ" ? "chị" : "anh") : kl[1];
  }

  // Last word on last non-empty line
  if (lines.length > 0) {
    const lastLine = lines[lines.length - 1].toLowerCase();
    const lastWord = lastLine.split(/[\s,;:]+/).pop() || "";
    if (lastWord === "chị" || lastWord === "anh") return lastWord;
  }

  return "anh/chị";
}

/** Call LLM and return raw extracted text. */
async function callLLM(sys: string, user: string, maxTokens = 256): Promise<string> {
  const res = await fetch(`${LLM_BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${LLM_KEY}` },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      temperature: 0.1,
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = await res.text();
  const c = extractLLMContent(raw);
  if (!c) throw new Error(`No content in response`);
  return c.replace(/^["']|["']$/g, "").trim();
}

// ─── Phase 1: Detect gender from Vietnamese name via LLM ─────

const PHASE1_SYSTEM = `Xác định giới tính từ tên Việt Nam. Chỉ trả về MỘT từ: "anh", "chị" hoặc "anh/chị". KHÔNG thêm gì khác.

Tên chính (từ cuối cùng) quyết định:
- Nữ: tên thường gặp ở nữ, hoặc có "Thị"/"Thi" ở giữa
- Nam: tên thường gặp ở nam
- Cả hai (Anh, Linh, Dương, Hà, Hiếu...): xét "Thị"/"Thi" hoặc tên đệm, không rõ -> anh/chị`;

async function detectGender(saleName: string): Promise<string> {
  if (!LLM_KEY || !LLM_BASE) return "anh/chị";

  try {
    const rawOutput = await callLLM(PHASE1_SYSTEM, `${saleName}`, 256);
    return parseGenderFromLLM(rawOutput);
  } catch (err) {
    console.error(`[detectGender] Error for "${saleName}":`, err);
    return "anh/chị";
  }
}

// ─── Phase 2: Build message directly from template ──────────

function buildKickoffMessage(saleName: string, gender: string, ticketId: string): string {
  const ticketLink = `https://servicedesk.fci.vn/browse/${ticketId}`;
  // gender is "anh", "chị", or "anh/chị"
  return `Hi ${gender} ${saleName} ơi, em Khôi PM mới nhận ticket này ${ticketLink} nhờ ${gender} add giúp em vào nhóm nội bộ và KH nếu dc giúp nhé ạ`;
}

/** Escapes a plain-text body into HTML paragraphs for the email composer. */
function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

// ─── Generate kickoff suggestion (orchestrator) ─────────────

async function generateKickoffSuggestion(
  saleName: string,
  saleEmail: string,
  ticketId: string,
): Promise<SuggestionTemplate | null> {
  const ticketLink = `https://servicedesk.fci.vn/browse/${ticketId}`;

  // Phase 1: detect gender
  const gender = await detectGender(saleName);

  // Phase 2: build message from template using detected gender
  const message = buildKickoffMessage(saleName || "", gender, ticketId);

  return {
    type: "action_item",
    title: "Gửi tin nhắn chào Sale",
    description: message,
    actionLabel: "Sao chép tin nhắn",
    saleEmail: saleEmail || undefined,
    emailSubject: `[Kickoff] Dự án ${ticketId} — nhờ hỗ trợ add vào nhóm`,
    emailBody: textToHtml(message),
  };
}

// ─── Main handler ────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { ticketId, isdData } = await req.json();

    if (!ticketId) {
      return NextResponse.json({ error: "Missing ticketId" }, { status: 400 });
    }

    const data = isdData ? (typeof isdData === "string" ? JSON.parse(isdData) : isdData) : {};
    const rawStatus = data.status || data.ticketStatus || "";
    const saleName = data.reporter || data.requester || data.creator || "";
    // Email của sale (reporter/requester) — dùng để gửi email kickoff trực tiếp
    const saleEmail = data.reporterEmail || data.requesterEmail || data.creatorEmail || "";

    const currentStateId = matchState(rawStatus);

    const suggestions: SuggestionTemplate[] = [];

    if (currentStateId === "kickoff") {
      const kickoffSuggestion = await generateKickoffSuggestion(saleName, saleEmail, ticketId);
      if (kickoffSuggestion) {
        suggestions.push(kickoffSuggestion);
      }
    }

    return NextResponse.json({ ok: true, suggestions });
  } catch (err) {
    console.error("[generate-project-suggestions] Error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}
