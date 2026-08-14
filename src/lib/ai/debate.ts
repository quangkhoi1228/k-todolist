/**
 * Shared multi-agent debate pipeline for PM action analysis.
 *
 * Used by BOTH:
 *  - `src/app/api/agents/analyse-suggestions/route.ts` (HTTP, UI "AI Debate" tab)
 *  - `agents/pm/lib/monitor.ts` (background sync — runs in Node/tsx, no HTTP)
 *
 * Stages:
 *  - Stage 0: LLM selects relevant business processes from the process library
 *             (semantic selection — NO keyword matching).
 *  - Stage 1: Per-group analysis (parallel).
 *  - Stage 2: Cross-group synthesis (common points, conflicts, draft suggestions).
 *  - Stage 3: Critic verification (validate against original messages, confidence).
 */

import { getBusinessProcesses } from "../repo/businessProcesses";
import { isPendingDuplicate } from "../suggestionDedup";

// ─── Types ──────────────────────────────────────────────────

export type GroupLabel = "KHÁCH HÀNG" | "NỘI BỘ" | "CHƯA PHÂN LOẠI";
export type Confidence = "high" | "medium" | "low";
export type Urgency = "high" | "medium" | "low";

export interface ChatMessage {
  sender?: string;
  chatName?: string;
  content?: string;
  timestampMs?: number | string;
  platform?: "teams" | "zalo";
  groupType?: "customer" | "internal";
}

interface GroupedChat {
  chatName: string;
  groupType: GroupLabel;
  platform: string;
  messages: ChatMessage[];
}

export interface Finding {
  type: string;
  title: string;
  description: string;
  sourceSender?: string;
  sourceMessage?: string;
  urgency: Urgency;
}

export interface Suggestion {
  type: string;
  title: string;
  description: string;
  sourceSender?: string;
  sourceChatName?: string;
  sourceMessage?: string;
  actionLabel?: string;
  input?: string;
  reasoning?: string;
  expectedOutcome?: string;
  /** Checklist hành động (từ steps của quy trình nghiệp vụ khớp) — hiển thị trong thông báo gợi ý. */
  checklist?: Array<{
    title: string;
    description?: string;
    targetGroup?: string;
    messageContent?: string;
  }>;
  confidence: Confidence;
}

export interface Conflict {
  description: string;
  group1: string;
  group2: string;
  sourceMessages: string[];
}

export interface DebateTrace {
  processSelection?: {
    selected: any[];
    raw: string;
  };
  groups: Array<{
    chatName: string;
    groupType: string;
    platform: string;
    messageCount: number;
    findings: any[];
    status: "ok" | "failed";
  }>;
  synthesis?: {
    suggestions: any[];
    conflicts: Conflict[];
    raw: string;
  };
  critic?: {
    inputSuggestions: any[];
    verified: any[];
    removed: any[];
    raw: string;
  };
}

export interface DebateResult {
  ok: boolean;
  suggestions: Suggestion[];
  conflicts: Conflict[];
  debugInfo: {
    stage0Ms: number;
    stage1Ms: number;
    stage2Ms: number;
    stage3Ms: number;
    totalMs: number;
    groupCount: number;
  };
  trace?: DebateTrace;
}

export interface DebateOptions {
  projectName: string;
  projectId: string | number;
  messages: ChatMessage[];
  projectContext?: string;
  /** userId to load the business process library (Stage 0 selection). */
  userId?: string;
  /** Danh sách thành viên dự án (đặc biệt Sale) để LLM điền tên/xưng hô trong checklist message. */
  members?: Array<{ name?: string; email?: string; roleName?: string }>;
  /** Danh sách nhóm chat thực tế của dự án (từ project.teamsGroups) để LLM biết chính xác nhóm KH/nội bộ + platform Teams/Zalo khi sinh targetGroup. */
  projectGroups?: Array<{ name: string; platform?: string; type?: string }>;
  /** Gợi ý chưa xử lý hiện có — không sinh lại card cùng chủ đề (vd gia hạn license). */
  pendingSuggestions?: Array<{ title?: string; description?: string; sourceMessage?: string; isResolved?: boolean; suggestionData?: string | null }>;
  includeTrace?: boolean;
}

// ─── Helpers ────────────────────────────────────────────────

/** Loại bỏ HTML tags + decode entities, giữ text thuần. */
function stripHtml(html: string): string {
  if (!html) return "";
  const decoded = html
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'");
  return decoded.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

/** Trích JSON array từ response LLM (chống markdown wrapper). */
function safeJsonParse(content: string): any[] {
  if (!content) return [];
  try {
    const trimmed = content.trim();
    const cleaned = trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") {
      if (Array.isArray(parsed.suggestions)) return parsed.suggestions;
      if (Array.isArray(parsed.findings)) return parsed.findings;
      if (Array.isArray(parsed.draftSuggestions)) return parsed.draftSuggestions;
    }
  } catch {}
  try {
    const match = content.match(/\[[\s\S]*\]/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

/** Đoán loại nhóm từ tên khi không có groupType. */
function inferGroupType(chatName: string): GroupLabel {
  const name = (chatName || "").toLowerCase();
  const INTERNAL_KEYWORDS = ["nội bộ", "internal", "tcsc", "fci", "team ", "dev"];
  const CUSTOMER_KEYWORDS = ["khách", "customer", "external", "kh ", "frt", "dự án"];
  if (INTERNAL_KEYWORDS.some((kw) => name.includes(kw))) return "NỘI BỘ";
  if (CUSTOMER_KEYWORDS.some((kw) => name.includes(kw))) return "KHÁCH HÀNG";
  return "CHƯA PHÂN LOẠI";
}

/** Nhóm messages theo chatName, gắn label type. */
function groupMessagesByChat(messages: ChatMessage[]): GroupedChat[] {
  const groups = new Map<string, GroupedChat>();
  for (const m of messages) {
    const chatName = m.chatName || "Khác";
    if (!groups.has(chatName)) {
      const gType: GroupLabel =
        m.groupType === "customer"
          ? "KHÁCH HÀNG"
          : m.groupType === "internal"
            ? "NỘI BỘ"
            : inferGroupType(chatName);
      groups.set(chatName, {
        chatName,
        groupType: gType,
        platform: m.platform || "Teams",
        messages: [],
      });
    }
    groups.get(chatName)!.messages.push(m);
  }
  return Array.from(groups.values());
}

/** Trích nội dung text từ response LLM (chuẩn OpenAI + DeepSeek reasoning). */
function extractLLMContent(rawText: string): string | null {
  try {
    const parsed = JSON.parse(rawText);
    const choices = parsed.choices as Array<Record<string, unknown>> | undefined;
    const msg = choices?.[0]?.message as Record<string, unknown> | undefined;
    const content = msg?.content as string | undefined;
    if (content) return content;
    const reasoning = msg?.reasoning_content as string | undefined;
    if (reasoning) return reasoning;
  } catch {}

  const contentMatch = rawText.match(/"content"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (contentMatch) {
    return contentMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }

  return null;
}

/** Wrapper gọi LLM có timeout. */
async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  timeoutMs: number,
): Promise<string | null> {
  const LLM_KEY = process.env.OPENAI_API_KEY || "";
  const LLM_BASE = process.env.OPENAI_BASE_URL;
  const LLM_MODEL = process.env.LLM_MODEL || "deepsseek-v4_mimo_combo";
  if (!LLM_KEY || !LLM_BASE) return null;
  const requestBody = {
    model: LLM_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.1,
    max_tokens: maxTokens,
  };
  try {
    const res = await fetch(`${LLM_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LLM_KEY}`,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      console.error(`[LLM] Error ${res.status}`);
      return null;
    }
    const rawText = await res.text();
    return extractLLMContent(rawText);
  } catch (e) {
    console.error("[LLM] Exception:", e);
    return null;
  }
}

// ─── Stage Prompts ──────────────────────────────────────────

const STAGE0_SYSTEM = `Bạn là chuyên gia chọn quy trình nghiệp vụ (business process) cho PM Agent.

Bạn nhận:
1. Tin nhắn chat dự án (Teams nội bộ + Zalo khách hàng)
2. Danh sách các quy trình nghiệp vụ có sẵn trong kho

Nhiệm vụ: Chọn RA NHỮNG QUY TRÌNH PHÙ HỢP NHẤT với tình huống trong tin nhắn, dựa trên NGỮ NGHĨA (hiểu ý nghĩa tin nhắn), KHÔNG dựa trên từ khoá đơn lẻ.

Quy tắc:
- Chọn tối đa 3 quy trình
- Chỉ chọn khi quy trình thực sự liên quan tới tình huống (VD: KH báo hết hạn license → chọn quy trình gia hạn license)
- Nếu không có quy trình nào phù hợp → trả []
- Trả về JSON array các object: [{ "id": <number>, "name": "<tên quy trình>" }]`;

const STAGE1_SYSTEM = (group: GroupedChat, projectContext: string) =>
  `Bạn là chuyên gia phân tích tin nhắn nhóm ${group.groupType} (${group.platform}).
Bạn CHỈ phân tích tin nhắn từ nhóm "${group.chatName}" — KHÔNG suy luận từ nhóm khác.

Thông tin dự án (KB):
---
${projectContext.slice(0, 1500) || "(không có)"}
---

Nhiệm vụ: Phân tích tin nhắn và rút ra:
1. Các yêu cầu/action item cần PM xử lý
2. Deadline/mốc thời gian
3. Vấn đề/risk phát sinh
4. Thông tin quan trọng

Output JSON array [...findings]. Mỗi finding có:
{ "type": string, "title": string, "description": string, "sourceSender": string, "sourceMessage": string, "urgency": "high"|"medium"|"low" }

Nếu không có gì cần xử lý, trả [].`;

const STAGE2_SYSTEM = (projectName: string, memberInfo: string, projectGroupsInfo: string) =>
  `Bạn là AI tổng hợp (Synthesizer). Bạn nhận kết quả phân tích từ NHIỀU nhóm chat của dự án "${projectName}".

${memberInfo}

${projectGroupsInfo}

Nhiệm vụ:
1. Tìm điểm chung giữa các nhóm (VD: cả KH và NB đều nhắc deadline)
2. Phát hiện MÂU THUẪN: khi nhóm khách hàng nói khác nhóm nội bộ → đây là signal quan trọng, PM cần biết ngay
3. Tổng hợp thành danh sách gợi ý hành động cho PM

Output JSON:
{
  "suggestions": [
    { "type": string, "title": string, "description": string, "sourceSender": string,
      "sourceChatName": string, "sourceMessage": string, "actionLabel": string,
      "input": string, "reasoning": string, "expectedOutcome": string,
      "checklist": [ { "title": string, "description": string, "targetGroup": string, "messageContent": string } ]
    }
  ],
  "conflicts": [
    { "description": string, "group1": string, "group2": string, "sourceMessages": string[] }
  ]
}

QUAN TRỌNG:
- Mỗi gợi ý PHẢI ghi rõ sourceChatName (từ nhóm nào)
- Nếu phát hiện mâu thuẫn → tạo 1 suggestion type "warning" + 1 entry trong conflicts
- KHÔNG tạo gợi ý chỉ để lặp lại nội dung của các QUY TRÌNH NGHIỆP VỤ đã được cung cấp trong context. Thay vào đó, nếu tình huống khớp 1 quy trình → tạo 1 gợi ý tóm tắt + đính kèm "checklist" (các bước hành động cụ thể) dựa trên steps của quy trình đó.
- Khi tin nhắn báo hết hạn / gia hạn license firewall: checklist BẮT BUỘC gồm đúng 2 bước GỬI TIN — (1) nhóm khách hàng (Zalo) xác nhận tiếp nhận, (2) nhóm nội bộ (Teams) nhờ Sale tạo Renewal Ticket. Không được bỏ 2 bước gửi Zalo/Teams này.
- DIỄN GIẢI CHECKLIST: với mỗi bước quy trình, viết lại thành câu hành động CỤ THỂ với thông tin từ tin nhắn:
    * "Nhắn nhóm khách hàng xác nhận đã tiếp nhận" → title: "Nhắn nhóm KH <TÊN NHÓM THẬT từ tin nhắn> (Zalo/Teams) xác nhận đã tiếp nhận thông tin hết hạn license"
    * "Nhắn nhóm nội bộ push Sale tạo Renewal Ticket" → title: "Gửi nhóm nội bộ <TÊN NHÓM NỘI BỘ> báo Sale tạo ticket gia hạn"
    * Ghi rõ tên nhóm, loại firewall, ngày hết hạn nếu biết từ tin nhắn.
- MỖI BƯỚC CHECKLIST PHẢI CÓ:
    * "targetGroup": TÊN NHÓM CHAT THẬT từ DANH SÁCH NHÓM CHAT ở trên (KHÔNG tự bịa tên nhóm). Ưu tiên nhóm KHÁCH HÀNG cho bước nhắn KH, nhóm NỘI BỘ cho bước nhắn nội bộ. Phải khớp CHÍNH XÁC tên nhóm trong danh sách (giữ nguyên tiền tố [FPT Cloud] nếu có). VD: "[FPT Cloud] Triển khai dự án Domesco HKT" (Zalo), "FCI Internal Team" (Teams).
    * "messageContent": tin nhắn LỊCH SỰ đã soạn sẵn — KHÔNG copy nguyên văn câu thô. Xưng "Bên em", văn nhờ vả, chào anh/chị + TÊN THẬT người nhận, đủ thông tin (tên KH, loại firewall, ngày hết hạn...).
      VD nhóm KH: "Chào anh Kang Chan, bên em đã tiếp nhận thông tin license Palo Alto sắp hết hạn trong 2 ngày tới. Bên em đang phối hợp để tạo ticket gia hạn và sẽ cập nhật tiến độ sớm ạ."
      VD nhóm nội bộ: "Chào a Hung ơi, khách hàng Domesco HKT báo license Palo Alto sắp hết hạn trong 2 ngày tới. Bên em nhờ anh tạo Renewal Ticket để bắt đầu quy trình gia hạn giúp ạ. Thông tin: KH Domesco HKT, firewall Palo Alto, hết hạn trong 2 ngày nên nhờ anh tạo sớm giúp Teams nhé."
    * Khi điền tên Sale: dùng TÊN THẬT từ danh sách THÀNH VIÊN DỰ ÁN ở trên (VD Sale: hungdt43 → "anh Hung"), KHÔNG để template <TÊN KH>, <LOẠI FIREWALL>, <NGÀY HẾT HẠN> — phải điền giá trị THẬT từ tin nhắn.
- KHÔNG tạo gợi ý mang tính "thu thập thông tin dự án" chung chung (hỏi Scope/Topology/Next actions/Timeline) — việc này đã là bước trong quy trình kickoff.
- Viết tiếng Việt CÓ DẤU`;

const STAGE3_SYSTEM = `Bạn là AI kiểm duyệt (Critic). Nhiệm vụ: kiểm tra từng gợi ý có ĐỦ CHỨNG CỨ từ tin nhắn gốc hay không.

Với MỖI gợi ý, hãy:
1. Tìm tin nhắn gốc khớp với sourceMessage — có thật không?
2. Nếu sourceMessage không khớp bất kỳ tin nhắn nào → GỢI Ý NÀY LÀ HALLUCINATION → LOẠI BỎ
3. Nếu có chứng cứ rõ ràng → confidence: "high"
4. Nếu chứng cứ gián tiếp → confidence: "medium"
5. Nếu yếu/mơ hồ → confidence: "low"

Output JSON array: chỉ chứa suggestions ĐÃ VERIFIED (bỏ hallucination).
Mỗi item giữ nguyên fields + thêm "confidence": "high"|"medium"|"low".
Các gợi ý có field "checklist" → GIỮ NGUYÊN checklist (không cắt bỏ).`;

// ─── Stage 0: LLM-based process selection ───────────────────

/**
 * Chọn quy trình phù hợp từ kho quy trình bằng LLM (semantic), thay cho
 * keyword-matching. Trả về danh sách quy trình đã chọn (đầy đủ steps).
 */
async function selectRelevantProcesses(
  userId: string,
  messages: ChatMessage[],
  projectContext: string,
): Promise<any[]> {
  const LLM_KEY = process.env.OPENAI_API_KEY || "";
  const LLM_BASE = process.env.OPENAI_BASE_URL;
  if (!LLM_KEY || !LLM_BASE || !userId) return [];

  const messageLog = messages
    .slice(-40)
    .map((m) => `[${m.chatName || "chat"}] ${m.sender || "Unknown"}: ${m.content?.slice(0, 400) || ""}`)
    .join("\n");

  const allProcesses = await getBusinessProcesses(userId, false);
  if (!allProcesses || allProcesses.length === 0) return [];

  const catalog = allProcesses
    .map((p: any) => `- id=${p.id} | ${p.name}${p.category ? ` [${p.category}]` : ""} | ${p.description || ""}`)
    .join("\n");

  const userPrompt = `Tin nhắn chat dự án:
---
${messageLog.slice(0, 7000) || "(không có)"}
---

Thông tin dự án (KB):
---
${projectContext.slice(0, 1000) || "(không có)"}
---

Danh sách quy trình nghiệp vụ có sẵn:
---
${catalog}
---

Chọn quy trình phù hợp nhất với tình huống trong tin nhắn. Trả JSON array [{ "id": number, "name": string }].`;

  const res = await callLLM(STAGE0_SYSTEM, userPrompt, 2048, 15000);
  if (!res) return [];

  const selected = safeJsonParse(res).filter((x: any) => x && x.id);
  const selectedIds = new Set(selected.map((x: any) => Number(x.id)));
  return allProcesses.filter((p: any) => selectedIds.has(Number(p.id))).slice(0, 3);
}

/** Build process context string (same shape as before, for LLM reference). */
function buildProcessContext(relevantProcesses: any[]): string {
  if (relevantProcesses.length === 0) return "";
  return `\n\nDƯỚI ĐÂY LÀ CÁC QUY TRÌNH NGHIỆP VỤ CỦA BẠN KHỚP VỚI BỐI CẢNH HIỆN TẠI (tham khảo để đưa ra gợi ý, KHÔNG bắt buộc phải tuân theo):
${relevantProcesses
  .map((p: any) => {
    const steps = Array.isArray(p.steps)
      ? (p.steps as any[])
          .filter((s: any) => s && s.title)
          .map((s: any) => {
            const base = `${s.order ?? ""}. ${s.title}${s.description ? `: ${s.description}` : ""}${s.owner ? ` (${s.owner})` : ""}${s.duration ? ` — ${s.duration}` : ""}`;
            const grp = s.targetGroup ? `\n   → Gửi tới nhóm: ${s.targetGroup}` : "";
            const msg = s.messageContent ? `\n   → Nội dung tin nhắn mẫu: "${s.messageContent}"` : "";
            return base + grp + msg;
          })
          .join("\n")
      : "";
    return `### ${p.name}${p.category ? ` [${p.category}]` : ""}
Mô tả: ${p.description || ""}
Các bước:
${steps || "(không có bước)"}
${p.outcome ? `Kết quả mong đợi: ${p.outcome}` : ""}`;
  })
  .join("\n\n")}`;
}

// ─── Process-aware post-process ─────────────────────────────

const LICENSE_RENEWAL_PATTERNS: RegExp[] = [
  /\bgia\s*hạn\s+license\b/i,
  /\bextend\s+license\b/i,
  /\blicense.*(?:palo\s*alto|pallo\s*alto|fortinet|firewall|hết\s*hạn|het han|expir|renew)/i,
  /\b(?:palo\s*alto|pallo\s*alto|fortinet).*(?:hết\s*hạn|expir|gia\s*hạn|renew)/i,
  /\brenewal\s+ticket\b/i,
  /\b(?:hết\s*hạn|het han).*(?:license|firewall|palo|fortinet)\b/i,
];

const GENERIC_PREINFO_PATTERNS: RegExp[] = [
  /\bthu\s*thập\s+thông\s+tin\s+(dự\s+án|sơ\s+bộ|du\s+an)\b/i,
  /\bthu\s*thap\s+thong\s+tin\b/i,
  /\bnhận\s+thông\s+tin.*(?:scope|topology|timeline|next\s*actions?)\b/i,
  /\bcần\s+thông\s+tin.*(?:scope|topology|timeline|next\s*actions?)\b/i,
  /\b(?:scope|topology|next\s*actions?|timeline).*từ.*(?:sale|pre[-\s]?sale)\b/i,
];

type ProjectGroup = { name: string; platform?: string; type?: string };
type ProjectMember = { name?: string; email?: string; roleName?: string };

interface PostProcessCtx {
  projectGroups?: ProjectGroup[];
  members?: ProjectMember[];
  messages?: ChatMessage[];
  projectName?: string;
  pendingSuggestions?: Array<{ title?: string; description?: string; sourceMessage?: string; isResolved?: boolean; suggestionData?: string | null }>;
}

function isLicenseProcessName(name: string): boolean {
  return /gia\s*hạn\s+license|firewall/i.test(name || "") || /palo\s*alto|fortinet/i.test(name || "");
}

function findLicenseRenewalProcess(relevantProcesses: any[], allProcesses: any[] = []): any | undefined {
  return (
    (relevantProcesses || []).find((p) => isLicenseProcessName(p?.name || "")) ||
    (allProcesses || []).find((p) => isLicenseProcessName(p?.name || ""))
  );
}

function isLicenseRenewalSuggestion(s: any): boolean {
  const blob = `${s?.title || ""} ${s?.description || ""} ${s?.sourceMessage || ""}`;
  return LICENSE_RENEWAL_PATTERNS.some((re) => re.test(blob));
}

/** Mọi card liên quan hết hạn license/firewall — dùng để gộp thành 1 gợi ý gửi Zalo+Teams. */
function isLicenseRelatedSuggestion(s: any, licenseProcess?: any): boolean {
  if (isLicenseRenewalSuggestion(s) || isLicenseSendStepSuggestion(s, licenseProcess)) return true;
  const t = `${s?.title || ""} ${s?.description || ""} ${s?.sourceMessage || ""}`;
  return /license|palo\s*alto|pallo\s*alto|fortinet|fortigate|firewall/i.test(t);
}

function isLicenseSendStepSuggestion(s: any, licenseProcess?: any): boolean {
  const t = `${s?.title || ""} ${s?.description || ""}`;
  const sendLike = /nhắn|gửi|zalo|teams|nhóm kh|nhóm nội bộ|xác nhận tiếp nhận|renewal ticket/i.test(t);
  if (sendLike && (isLicenseRenewalSuggestion(s) || /license|firewall|palo\s*alto|fortinet|renewal|gia\s*hạn/i.test(t))) {
    return true;
  }
  const steps = Array.isArray(licenseProcess?.steps) ? licenseProcess.steps : [];
  for (const step of steps) {
    if (step?.title && tokenOverlap((s?.title || "").toLowerCase(), String(step.title).toLowerCase()) >= 0.5) {
      return true;
    }
  }
  return false;
}

function messagesHintLicenseRenewal(messages: ChatMessage[] = []): boolean {
  const blob = messages.map((m) => m.content || "").join("\n");
  if (!blob) return false;
  const hasProduct = /license|pall?o\s*alto|fortinet|fortigate|firewall/i.test(blob);
  const hasExpiry = /hết\s*hạn|het han|expir|gia\s*hạn|gia han|renewal|sắp hết|extend/i.test(blob);
  return hasProduct && hasExpiry;
}

function buildChecklistFromProcess(p: any): Array<{
  title: string;
  description?: string;
  targetGroup?: string;
  messageContent?: string;
}> {
  const steps = Array.isArray(p?.steps) ? p.steps : [];
  return steps
    .filter((s: any) => s && s.title)
    .map((s: any) => ({
      title: s.title,
      description: s.description || undefined,
      targetGroup: s.targetGroup || undefined,
      messageContent: s.messageContent || undefined,
    }));
}

function pickProjectGroup(groups: ProjectGroup[] | undefined, kind: "customer" | "internal"): ProjectGroup | undefined {
  if (!groups || groups.length === 0) return undefined;
  if (kind === "customer") {
    return (
      groups.find((g) => g.type === "customer" && g.platform === "zalo") ||
      groups.find((g) => g.type === "customer") ||
      groups.find((g) => g.platform === "zalo")
    );
  }
  return (
    groups.find((g) => g.type === "internal" && g.platform !== "zalo") ||
    groups.find((g) => g.type === "internal") ||
    groups.find((g) => g.platform === "teams" || !g.platform)
  );
}

function displayPersonName(raw: string): string {
  if (!raw) return "";
  const noEmail = raw.split("@")[0].trim();
  if (/\s/.test(noEmail)) return noEmail;
  const m = noEmail.match(/^([a-zA-ZÀ-ỹ]+)/);
  if (m && /\d/.test(noEmail)) {
    return m[1].charAt(0).toUpperCase() + m[1].slice(1);
  }
  return noEmail;
}

function pickRoleName(members: ProjectMember[] | undefined, pattern: RegExp): string {
  const m = (members || []).find((x) => pattern.test(x.roleName || "") || pattern.test(x.name || ""));
  return displayPersonName(m?.name || "");
}

function extractFirewallAndExpiry(messages: ChatMessage[] = []): { fw: string; expiry: string; source: ChatMessage | null } {
  const blob = messages.map((m) => m.content || "").join("\n");
  let fw = "firewall";
  if (/pall?o\s*alto/i.test(blob)) fw = "Palo Alto";
  else if (/fortinet|fortigate/i.test(blob)) fw = "Fortinet";
  else if (/\bvar\b/i.test(blob)) fw = "vAR";
  const days = blob.match(/(\d+)\s*ngày/i);
  const expiry = days ? `${days[1]} ngày tới` : "thời gian sắp tới";
  const source =
    messages.find((m) => /license|pall?o\s*alto|fortinet|firewall/i.test(m.content || "") && /hết hạn|expir|gia hạn|renewal|extend/i.test(m.content || "")) ||
    messages.find((m) => /license|pall?o\s*alto|fortinet|firewall/i.test(m.content || "")) ||
    null;
  return { fw, expiry, source };
}

/** Tên KH trên tin nội bộ: ưu tiên tên dự án trong nhóm Zalo (vd Domesco HKT), không dùng tên người. */
function extractCustomerOrg(ctx: PostProcessCtx): string {
  const customer = pickProjectGroup(ctx.projectGroups, "customer");
  const gName = customer?.name || "";
  const fromProject = gName.match(/dự án\s+(.+)$/i);
  if (fromProject?.[1]) return fromProject[1].trim();
  const stripped = gName.replace(/^\[[^\]]+\]\s*/, "").trim();
  if (stripped && stripped.length >= 3 && !/nhóm KH|customer/i.test(stripped)) return stripped;
  return pickRoleName(ctx.members, /khách|customer/i) || ctx.projectName || "khách hàng";
}

function isPlaceholderGroup(name?: string): boolean {
  if (!name) return true;
  return /<[^>]+>|nhóm KH|nhóm nội bộ|TÊN DỰ ÁN|FCI Internal Team/i.test(name);
}

function checklistHasSendSteps(cl: any): boolean {
  if (!Array.isArray(cl)) return false;
  return cl.filter((c: any) => c && c.targetGroup && c.messageContent).length >= 2;
}

/** Điền tên nhóm Zalo/Teams thật + nội dung tin nếu checklist còn template/placeholder. */
function enrichLicenseChecklist(
  steps: Array<{ title: string; description?: string; targetGroup?: string; messageContent?: string }>,
  ctx: PostProcessCtx,
): typeof steps {
  const customer = pickProjectGroup(ctx.projectGroups, "customer");
  const internal = pickProjectGroup(ctx.projectGroups, "internal");
  const khName = pickRoleName(ctx.members, /khách|customer/i);
  const saleName = pickRoleName(ctx.members, /^sale$|sales?\b/i);
  const { fw, expiry } = extractFirewallAndExpiry(ctx.messages || []);
  const khLabel = extractCustomerOrg(ctx);
  const khHello = khName ? `anh ${khName}` : "anh/chị";
  const saleHello = saleName ? `a ${saleName}` : "a Sale";

  return steps.map((s, i) => {
    // Chỉ đọc title + targetGroup — description hay viết "KH báo hết hạn" nên `\bkh\b`
    // sẽ gắn nhầm bước nội bộ sang nhóm Zalo.
    const head = `${s.title || ""} ${s.targetGroup || ""}`;
    const isInternal = /nội bộ|internal|\bteams\b|renewal ticket|nhóm nội bộ/i.test(head) || i === 1;
    const isCustomer = !isInternal && (/khách|customer|\bzalo\b|nhóm KH|\(nhóm KH\)/i.test(head) || i === 0);
    const group = isCustomer ? customer : isInternal ? internal : undefined;
    const next = { ...s };
    if (group?.name && isPlaceholderGroup(s.targetGroup)) {
      next.targetGroup = group.name;
    } else if (!s.targetGroup && group?.name) {
      next.targetGroup = group.name;
    }
    if (!/zalo|teams/i.test(s.title || "")) {
      if (isCustomer) {
        const plat = group?.platform === "teams" ? "Teams" : "Zalo";
        next.title = `Gửi ${plat} nhóm KH xác nhận tiếp nhận hết hạn license`;
      } else if (isInternal) {
        const plat = group?.platform === "zalo" ? "Zalo" : "Teams";
        next.title = `Gửi ${plat} nhóm nội bộ nhờ Sale tạo Renewal Ticket`;
      }
    }
    const needsMsg = !s.messageContent || /<[^>]+>/.test(s.messageContent) || !/bên em/i.test(s.messageContent);
    if (needsMsg && isCustomer) {
      next.messageContent = `Chào ${khHello}, bên em đã tiếp nhận thông tin license ${fw} sắp hết hạn trong ${expiry}. Bên em đang phối hợp để tạo ticket gia hạn và sẽ cập nhật tiến độ sớm ạ.`;
    } else if (needsMsg && isInternal) {
      next.messageContent = `Chào ${saleHello} ơi, khách hàng ${khLabel} báo license ${fw} sắp hết hạn trong ${expiry}. Bên em nhờ anh tạo Renewal Ticket để bắt đầu quy trình gia hạn giúp ạ. Thông tin: KH ${khLabel}, firewall ${fw}, hết hạn trong ${expiry} nên nhờ anh tạo sớm giúp Teams nhé.`;
    }
    return next;
  });
}

/**
 * Loại gợi ý generic kickoff, gắn/bảo toàn checklist gửi Zalo+Teams khi gia hạn license.
 *
 * Bug cũ: khi Stage 0 chọn quy trình "Gia hạn license firewall", filter overlap
 * với step title ("Nhắn nhóm KH…", "Gửi nhóm nội bộ…") XOÁ mất đúng gợi ý gửi
 * Zalo/Teams — PM không còn thấy bước gửi tin.
 */
export function postProcessSuggestions(
  suggestions: any[],
  relevantProcesses: any[],
  allProcesses: any[] = [],
  ctx: PostProcessCtx = {},
): any[] {
  const list = Array.isArray(suggestions) ? [...suggestions] : [];
  const licenseRenewalProcess = findLicenseRenewalProcess(relevantProcesses, allProcesses);

  const processStepTitles: string[] = [];
  for (const p of relevantProcesses || []) {
    if (isLicenseProcessName(p?.name || "")) continue; // không dùng step license để xoá gợi ý gửi tin
    const steps = Array.isArray(p?.steps) ? p.steps : [];
    for (const s of steps) {
      if (s?.title) processStepTitles.push(s.title.toLowerCase());
    }
  }

  let kept = list.filter((s: any) => {
    const title = (s?.title || "").toLowerCase();
    const description = (s?.description || "").toLowerCase();
    if (GENERIC_PREINFO_PATTERNS.some((p) => p.test(title) || p.test(description))) return false;
    if (isLicenseRenewalSuggestion(s) || isLicenseSendStepSuggestion(s, licenseRenewalProcess)) return true;
    for (const stepTitle of processStepTitles) {
      if (stepTitle.length < 8) continue;
      if (tokenOverlap(title, stepTitle) >= 0.6 || tokenOverlap(description, stepTitle) >= 0.6) {
        return false;
      }
    }
    return true;
  });

  const licenseChecklist = licenseRenewalProcess
    ? enrichLicenseChecklist(buildChecklistFromProcess(licenseRenewalProcess), ctx)
    : [];

  const attachLicenseChecklist = (s: any) => {
    if (licenseChecklist.length === 0) return s;
    const existing = Array.isArray(s.checklist) ? s.checklist : [];
    if (checklistHasSendSteps(existing)) {
      return { ...s, checklist: enrichLicenseChecklist(existing, ctx) };
    }
    return { ...s, checklist: licenseChecklist };
  };

  const buildLicenseCard = (base?: any) => {
    const { source } = extractFirewallAndExpiry(ctx.messages || []);
    const card = {
      type: base?.type || "warning",
      title: base?.title || "Gia hạn license firewall",
      description:
        base?.description ||
        (source?.content
          ? `Khách hàng báo license sắp hết hạn: "${String(source.content).slice(0, 180)}". Cần nhắn nhóm KH (Zalo) xác nhận tiếp nhận và nhắn nhóm nội bộ (Teams) nhờ Sale tạo Renewal Ticket.`
          : "Cần nhắn nhóm khách hàng (Zalo) xác nhận tiếp nhận và nhắn nhóm nội bộ (Teams) nhờ Sale tạo Renewal Ticket gia hạn license firewall."),
      sourceSender: base?.sourceSender || source?.sender,
      sourceChatName: base?.sourceChatName || source?.chatName,
      sourceMessage: base?.sourceMessage || source?.content,
      actionLabel: base?.actionLabel || "Gửi Zalo + Teams",
      confidence: base?.confidence || "high",
      priority: base?.priority || base?.confidence || "high",
      input: base?.input,
      reasoning: base?.reasoning,
      expectedOutcome: base?.expectedOutcome,
      checklist: base?.checklist,
    };
    return attachLicenseChecklist(card);
  };

  // Gộp MỌI card license thành 1 gợi ý + checklist 2 bước Gửi Zalo (KH) + Gửi Teams (nội bộ).
  // Bug cũ: LLM hay sinh 6–8 card "license hết hạn / tạo ticket / rủi ro..." — chỉ 1 card
  // có checklist, các card còn lại bấm Duyệt không gửi được gì.
  const licenseHint = messagesHintLicenseRenewal(ctx.messages || []);
  if (licenseRenewalProcess && licenseChecklist.length > 0) {
    const licenseCards = kept.filter((s) => isLicenseRelatedSuggestion(s, licenseRenewalProcess));
    const others = kept.filter((s) => !isLicenseRelatedSuggestion(s, licenseRenewalProcess));
    if (licenseCards.length > 0 || licenseHint) {
      const preferred =
        licenseCards.find((s) => checklistHasSendSteps(s.checklist)) ||
        licenseCards.find((s) => isLicenseRenewalSuggestion(s) && !isLicenseSendStepSuggestion(s, licenseRenewalProcess)) ||
        licenseCards[0];
      const card = buildLicenseCard(preferred);
      // Đã có gợi ý cùng chủ đề chưa làm → không sinh/báo lại.
      if (isPendingDuplicate(card, ctx.pendingSuggestions || [])) {
        console.log("[Debate] Skip license card — pending unexecuted suggestion already exists.");
        kept = others;
      } else {
        kept = [card, ...others];
      }
    }
  } else {
    kept = kept.map((s: any) => {
      if (!Array.isArray(s.checklist) || s.checklist.length === 0) {
        for (const p of relevantProcesses || []) {
          if (!p || !Array.isArray(p.steps) || p.steps.length === 0) continue;
          if (isLicenseProcessName(p.name || "")) continue;
          const pKeywords = [p.name, p.description].filter(Boolean).join(" ");
          const pTokens = new Set(tokenize(pKeywords));
          const sTokens = new Set(tokenize(`${s.title || ""} ${s.description || ""}`));
          if (pTokens.size === 0 || sTokens.size === 0) continue;
          let overlap = 0;
          for (const t of pTokens) if (sTokens.has(t)) overlap++;
          if (overlap / Math.max(pTokens.size, 1) >= 0.4) {
            return { ...s, checklist: buildChecklistFromProcess(p) };
          }
        }
      }
      return s;
    });
  }

  return kept;
}

/** Chia chuỗi thành token (lowercase, bỏ dấu + dấu câu) để so khớp fuzzy. */
function tokenize(text: string): string[] {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

/**
 * Tỷ lệ token của `needle` xuất hiện trong `haystack` (0..1).
 * Dùng để đo độ giống nhau fuzzy giữa gợi ý và step quy trình.
 */
function tokenOverlap(haystack: string, needle: string): number {
  const haystackTokens = new Set(tokenize(haystack));
  const needleTokens = tokenize(needle);
  if (needleTokens.length === 0 || haystackTokens.size === 0) return 0;
  const matched = needleTokens.filter((t) => haystackTokens.has(t)).length;
  return matched / needleTokens.length;
}

// ─── Rule-based fallback (LLM unavailable) ──────────────────

export function generateFallbackSuggestions(projectName: string, messages: any[]) {
  const suggestions: Array<{
    type: string;
    title: string;
    description: string;
    sourceSender?: string;
    sourceChatName?: string;
    sourceMessage?: string;
    actionLabel?: string;
  }> = [];

  const LICENSE_KEYWORDS = [/license/i, /pall?o\s*alto/i, /fortinet|fortigate/i, /gia\s*hạn/i, /hết\s*hạn.*(?:license|firewall)/i, /extend\s+license/i];
  const MENTION_KEYWORDS = [/@pm/i, /@anh/i, /@khoa/i, /@trưởng/i, /@truong/i, /pm\s+(?:ơi|oi)/i, /anh\s+(?:khoa|hưng|tuấn|an|tùng|huy)/i];
  const TRANSFER_KEYWORDS = [/bàn\s*giao/i, /chuyển\s*(?:thông\s*tin|tiếp|qua)/i, /handover/i, /sales?\s*bàn\s*giao/i, /presale/i];
  const ACTION_KEYWORDS = [/cần\s*(?:xác\s*nhận|approve|confirm|duyệt|gửi|họp|báo\s*giá)/i, /làm\s*ngay/i, /request/i, /cần\s*(?:support|hỗ\s*trợ)/i];
  const DEADLINE_KEYWORDS = [/hạn\s*chót/i, /deadline/i, /due\s*date/i, /kịp/i, /chậm/i, /delay/i, /trễ/i];
  const WARNING_KEYWORDS = [/lỗi/i, /problem/i, /vấn\s*đề/i, /risk/i, /rủi\s*ro/i, /không\s*kịp/i, /conflict/i, /tắc/i, /chậm\s*tiến/i];

  const seen = new Set<string>();
  const reversed = [...messages].reverse();

  for (const msg of reversed) {
    const content = (msg.content || "").trim();
    const sender = msg.sender || "Unknown";
    const chatName = msg.chatName || "Teams";
    if (!content) continue;
    if (content.length < 15) continue;

    const dedupKey = `${sender}|${content.slice(0, 60)}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    if (LICENSE_KEYWORDS.some((k) => k.test(content)) && /hết hạn|expir|gia hạn|renewal|extend|license/i.test(content)) {
      suggestions.push({
        type: "warning",
        title: "Gia hạn license firewall",
        description: `Tin nhắn từ "${sender}" trong "${chatName}" báo license/firewall sắp hết hạn: "${content.slice(0, 200)}". Cần nhắn nhóm KH (Zalo) xác nhận và nhắn nhóm nội bộ (Teams) nhờ Sale tạo Renewal Ticket.`,
        sourceSender: sender,
        sourceChatName: chatName,
        sourceMessage: content,
        actionLabel: "Gửi Zalo + Teams",
      });
    }
    if (TRANSFER_KEYWORDS.some((k) => k.test(content))) {
      suggestions.push({
        type: "transfer_request",
        title: "Cần chuyển thông tin Sale/Presale",
        description: `Tin nhắn từ "${sender}" trong "${chatName}" có đề cập đến việc bàn giao/chuyển thông tin. Cần PM phối hợp để transfer thông tin từ Sale và Presale cho team triển khai.`,
        sourceSender: sender,
        sourceChatName: chatName,
        sourceMessage: content,
        actionLabel: "Tạo task bàn giao",
      });
    }
    if (MENTION_KEYWORDS.some((k) => k.test(content))) {
      suggestions.push({
        type: "mention",
        title: "Bạn được đề cập trong tin nhắn",
        description: `"${sender}" đã đề cập đến bạn trong "${chatName}". Nội dung: "${content.slice(0, 200)}"`,
        sourceSender: sender,
        sourceChatName: chatName,
        sourceMessage: content,
      });
    }
    if (ACTION_KEYWORDS.some((k) => k.test(content))) {
      suggestions.push({
        type: "action_item",
        title: "Có yêu cầu cần xử lý",
        description: `"${sender}" yêu cầu: "${content.slice(0, 200)}"`,
        sourceSender: sender,
        sourceChatName: chatName,
        sourceMessage: content,
        actionLabel: "Tạo task",
      });
    }
    if (DEADLINE_KEYWORDS.some((k) => k.test(content))) {
      suggestions.push({
        type: "deadline",
        title: "Deadline được nhắc đến",
        description: `Tin nhắn từ "${sender}" trong "${chatName}" có nhắc đến deadline: "${content.slice(0, 200)}"`,
        sourceSender: sender,
        sourceChatName: chatName,
        sourceMessage: content,
      });
    }
    if (WARNING_KEYWORDS.some((k) => k.test(content))) {
      suggestions.push({
        type: "warning",
        title: "Cảnh báo: vấn đề phát sinh",
        description: `"${sender}" báo cáo vấn đề trong "${chatName}": "${content.slice(0, 200)}". Cần PM kiểm tra và xử lý.`,
        sourceSender: sender,
        sourceChatName: chatName,
        sourceMessage: content,
        actionLabel: "Kiểm tra ngay",
      });
    }
  }

  return suggestions.slice(0, 10);
}

// ─── Main pipeline ──────────────────────────────────────────

export async function runDebatePipeline(opts: DebateOptions): Promise<DebateResult> {
  const overallStart = Date.now();
  const { projectName, projectId, messages, projectContext, userId, members, projectGroups, pendingSuggestions, includeTrace = true } = opts;

  // Danh sách thành viên dự án — đặc biệt Sale, để LLM điền tên/xưng hô vào checklist message.
  const memberInfo = (() => {
    if (!members || members.length === 0) return "";
    const lines = members
      .filter((m) => m && (m.name || m.email))
      .map((m) => {
        const role = m.roleName || "khác";
        const name = m.name || m.email || "";
        return `  - ${role}: ${name}${m.email && m.email !== name ? ` (${m.email})` : ""}`;
      })
      .join("\n");
    return `THÀNH VIÊN DỰ ÁN (để điền tên/xưng hô phù hợp khi soạn message gửi):\n${lines}`;
  })();

  const projectGroupsInfo = (() => {
    if (!projectGroups || projectGroups.length === 0) return "";
    const lines = projectGroups
      .filter((g) => g && g.name)
      .map((g) => {
        const type = g.type === "customer" ? "KHÁCH HÀNG" : g.type === "internal" ? "NỘI BỘ" : "khác";
        const platform = g.platform || "teams";
        return `  - [${type}] ${g.name} — nền tảng: ${platform}`;
      })
      .join("\n");
    return `DANH SÁCH NHÓM CHAT THẬT CỦA DỰ ÁN (dùng để điền targetGroup chính xác — KHÔNG tự bịa tên nhóm, phải dùng TÊN THẬT từ danh sách này + chọn đúng nền tảng Teams/Zalo):\n${lines}`;
  })();

  const emptyResult = (debugInfo: DebateResult["debugInfo"], trace?: DebateTrace): DebateResult => ({
    ok: true,
    suggestions: [],
    conflicts: [],
    debugInfo,
    ...(includeTrace ? { trace } : {}),
  });

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return emptyResult(
      { stage0Ms: 0, stage1Ms: 0, stage2Ms: 0, stage3Ms: 0, totalMs: Date.now() - overallStart, groupCount: 0 },
      { groups: [] },
    );
  }

  const LLM_KEY = process.env.OPENAI_API_KEY || "";
  const LLM_BASE = process.env.OPENAI_BASE_URL;
  if (!LLM_KEY || !LLM_BASE) {
    const suggestions = generateFallbackSuggestions(projectName, messages);
    let fallbackProcesses: any[] = [];
    if (userId) {
      try {
        fallbackProcesses = await getBusinessProcesses(userId, false);
      } catch { /* ignore */ }
    }
    return {
      ok: true,
      suggestions: postProcessSuggestions(suggestions, [], fallbackProcesses, {
        projectGroups,
        members,
        messages,
        projectName,
        pendingSuggestions,
      }),
      conflicts: [],
      debugInfo: { stage0Ms: 0, stage1Ms: 0, stage2Ms: 0, stage3Ms: 0, totalMs: Date.now() - overallStart, groupCount: 0 },
      ...(includeTrace ? { trace: { groups: [] } } : {}),
    };
  }

  const contextPlain = stripHtml(projectContext || "");
  const groups = groupMessagesByChat(messages);
  const trace: DebateTrace = { groups: [] };

  // ==========================================
  // STAGE 0: LLM process selection (semantic, no keywords)
  // ==========================================
  const stage0Start = Date.now();
  let relevantProcesses: any[] = [];
  if (userId) {
    try {
      relevantProcesses = await selectRelevantProcesses(userId, messages, contextPlain);
      if (relevantProcesses.length > 0) {
        console.log(
          `[Debate] Stage 0 selected ${relevantProcesses.length} business process(es):`,
          relevantProcesses.map((p) => p.name)
        );
      }
    } catch (e) {
      console.warn(`[Debate] Stage 0 process selection failed: ${e}`);
    }
  }
  const processContext = buildProcessContext(relevantProcesses);
  trace.processSelection = {
    selected: relevantProcesses.map((p: any) => ({ id: p.id, name: p.name })),
    raw: "",
  };
    // Toàn bộ thư viện quy trình active của user — dùng làm fallback khi cần
  // gắn checklist cho gợi ý khớp 1 quy trình nhưng LLM Stage 0 không chọn
  // quy trình đó (VD: gợi ý "Gia hạn license" nhưng Stage 0 miss).
  let allProcesses: any[] = [];
  if (userId) {
    try {
      allProcesses = await getBusinessProcesses(userId, false);
    } catch (e) {
      console.warn(`[Debate] Could not load full business process library: ${e}`);
    }
  }

  const stage0Ms = Date.now() - stage0Start;

  const postCtx: PostProcessCtx = { projectGroups, members, messages, projectName, pendingSuggestions };

  // ==========================================
  // STAGE 1: Per-Group Analysis (parallel)
  // ==========================================
  const stage1Start = Date.now();
  console.log(`[Debate] Stage 1: Analyzing ${groups.length} groups in parallel`);

  const stage1Promises = groups.map(async (group) => {
    const messageLog = group.messages
      .slice(-30)
      .map((m) => `[${m.sender || "Unknown"}]: ${m.content?.slice(0, 600) || ""}`)
      .join("\n");

    const res = await callLLM(STAGE1_SYSTEM(group, contextPlain), messageLog, 2048, 60000);
    const findings = res ? safeJsonParse(res) : [];
    trace.groups.push({
      chatName: group.chatName,
      groupType: group.groupType,
      platform: group.platform,
      messageCount: group.messages.length,
      findings,
      status: findings.length > 0 ? "ok" : "failed",
    });
    return {
      chatName: group.chatName,
      groupType: group.groupType,
      platform: group.platform,
      findings: res,
    };
  });

  const stage1Results = await Promise.allSettled(stage1Promises);
  const validGroupFindings = stage1Results
    .filter((r) => r.status === "fulfilled" && r.value.findings)
    .map((r) => (r as PromiseFulfilledResult<any>).value);
  const stage1Ms = Date.now() - stage1Start;
  console.log(`[Debate] Stage 1 took ${stage1Ms}ms`);

  if (validGroupFindings.length === 0) {
    console.warn("[Debate] Stage 1 yielded no findings. Falling back.");
    const suggestions = generateFallbackSuggestions(projectName, messages);
    return {
      ok: true,
      suggestions: postProcessSuggestions(suggestions, relevantProcesses, allProcesses, postCtx),
      conflicts: [],
      debugInfo: { stage0Ms, stage1Ms, stage2Ms: 0, stage3Ms: 0, totalMs: Date.now() - overallStart, groupCount: groups.length },
      ...(includeTrace ? { trace } : {}),
    };
  }

  // ==========================================
  // STAGE 2: Cross-Group Synthesis
  // ==========================================
  const stage2Start = Date.now();
  console.log("[Debate] Stage 2: Cross-group synthesis");

  const stage2UsrPrompt = `Kết quả phân tích từ các nhóm:
${validGroupFindings
  .map((f) => `--- Nhóm: ${f.chatName} (${f.groupType}) ---\n${f.findings}`)
  .join("\n\n")}

QUY TRÌNH NGHIỆP VỤ THAM KHẢO (nếu có):
${processContext || "(không có quy trình khớp)"}`;

  const stage2Res = await callLLM(STAGE2_SYSTEM(projectName || "Dự án", memberInfo, projectGroupsInfo), stage2UsrPrompt, 4096, 60000);
  const stage2Ms = Date.now() - stage2Start;
  console.log(`[Debate] Stage 2 took ${stage2Ms}ms`);

  let stage2Data: { suggestions: any[]; conflicts: Conflict[] } | null = null;
  if (stage2Res) {
    try {
      const cleaned = stage2Res
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();
      const parsed = JSON.parse(cleaned);
      if (parsed && typeof parsed === "object") {
        stage2Data = {
          suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
          conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts : [],
        };
      }
    } catch {}
    if (!stage2Data) {
      const arr = safeJsonParse(stage2Res);
      if (arr.length > 0) {
        stage2Data = { suggestions: arr, conflicts: [] };
      }
    }
    trace.synthesis = {
      suggestions: stage2Data?.suggestions || [],
      conflicts: stage2Data?.conflicts || [],
      raw: stage2Res,
    };
  }

  if (!stage2Data || stage2Data.suggestions.length === 0) {
    console.warn("[Debate] Stage 2 failed. Merging Stage 1 findings.");
    const mergedSuggestions: Suggestion[] = [];
    for (const f of validGroupFindings) {
      const findings = safeJsonParse(f.findings);
      for (const fd of findings) {
        mergedSuggestions.push({
          type: fd.type || "info",
          title: fd.title || fd.description?.slice(0, 80) || "Gợi ý",
          description: fd.description || "",
          sourceSender: fd.sourceSender,
          sourceChatName: f.chatName,
          sourceMessage: fd.sourceMessage,
          confidence: "medium",
        });
      }
    }
    const conflicts = stage2Data?.conflicts || [];
    return {
      ok: true,
      suggestions: postProcessSuggestions(mergedSuggestions, relevantProcesses, allProcesses, postCtx),
      conflicts,
      debugInfo: { stage0Ms, stage1Ms, stage2Ms, stage3Ms: 0, totalMs: Date.now() - overallStart, groupCount: groups.length },
      ...(includeTrace ? { trace } : {}),
    };
  }

  // ==========================================
  // STAGE 3: Critic Verification
  // ==========================================
  const stage3Start = Date.now();
  console.log("[Debate] Stage 3: Critic verification");

  const allMessagesLog = messages
    .slice(-50)
    .map((m) => `[${m.chatName || "chat"}] ${m.sender || "Unknown"}: ${m.content?.slice(0, 300) || ""}`)
    .join("\n");

  const stage3UsrPrompt = `Gợi ý sơ bộ cần kiểm tra:
---
${JSON.stringify(stage2Data.suggestions, null, 2)}
---

Tin nhắn gốc (để đối chiếu):
---
${allMessagesLog.slice(0, 9000)}
---`;

  const stage3Res = await callLLM(STAGE3_SYSTEM, stage3UsrPrompt, 4096, 60000);
  const stage3Ms = Date.now() - stage3Start;
  console.log(`[Debate] Stage 3 took ${stage3Ms}ms`);
  console.log(`[Debate] Total pipeline time: ${Date.now() - overallStart}ms`);

  const verified = safeJsonParse(stage3Res || "");
  const removed = stage2Data.suggestions.filter(
    (s: any) => !verified.some((v: any) => v.title === s.title || v.sourceMessage === s.sourceMessage),
  );
  trace.critic = {
    inputSuggestions: stage2Data.suggestions,
    verified,
    removed,
    raw: stage3Res || "",
  };

  if (verified.length === 0) {
    console.warn("[Debate] Stage 3 failed, gracefully degrading to Stage 2 drafts.");
    const downgradedSuggestions: Suggestion[] = stage2Data.suggestions.map((s: any) => ({
      ...s,
      confidence: "medium" as Confidence,
    }));
    return {
      ok: true,
      suggestions: postProcessSuggestions(downgradedSuggestions, relevantProcesses, allProcesses, postCtx),
      conflicts: stage2Data.conflicts,
      debugInfo: { stage0Ms, stage1Ms, stage2Ms, stage3Ms, totalMs: Date.now() - overallStart, groupCount: groups.length },
      ...(includeTrace ? { trace } : {}),
    };
  }

  const finalized = postProcessSuggestions(verified, relevantProcesses, allProcesses, postCtx);
  if (finalized.length !== verified.length) {
    console.log(
      `[Debate] Post-process: ${verified.length} → ${finalized.length} suggestion(s) (license checklist / dedup).`
    );
  }

  return {
    ok: true,
    suggestions: finalized,
    conflicts: stage2Data.conflicts,
    debugInfo: { stage0Ms, stage1Ms, stage2Ms, stage3Ms, totalMs: Date.now() - overallStart, groupCount: groups.length },
    ...(includeTrace ? { trace } : {}),
  };
}