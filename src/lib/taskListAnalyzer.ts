/**
 * Phân tích task list (paste từ Excel / text thuần) bằng LLM:
 * - Detect từng task: title, phase, details, pic, support, manday, status.
 * - Assign pic/support theo member list của dự án (combined):
 *   1. Ưu tiên cột PIC/Support trong dữ liệu gốc (map theo tên/email member).
 *   2. Task thiếu pic → LLM gợi ý theo role/tên member (chỉ trong member list).
 *
 * API route: POST /api/data/task-list-import (action=analyze / action=import)
 */

const LLM_KEY = process.env.OPENAI_API_KEY || "";
const LLM_MODEL = process.env.LLM_MODEL || "deepsseek-v4_mimo_combo";
const LLM_BASE = process.env.OPENAI_BASE_URL;

// ─── Types ───────────────────────────────────────────────────
export interface TaskItemInput {
  title: string;
  no?: string;
  phase?: string;
  details?: string;
  pic?: string;
  support?: string;
  manday?: number;
  status?: string;
}

export interface MemberRef {
  name: string;
  email?: string;
  roleName?: string;
}

export interface DetectedTask extends TaskItemInput {
  phase: string;
  pic: string;
  support: string;
}

export interface TaskListAnalyzeResult {
  tasks: DetectedTask[];
  source: "llm" | "fallback";
  mappedPics: Record<string, string>; // picText → member name đã map được
}

/** Strip SSE `data: [DONE]` trailer mà một số proxy nối thêm. */
function cleanRawResponse(raw: string): string {
  const idx = raw.lastIndexOf("data: [DONE]");
  return idx >= 0 ? raw.slice(0, idx).trim() : raw.trim();
}

/** Parse LLM response — content/reasoning_content/delta/Anthropic/Ollama. */
function extractLLMContent(rawText: string): string | null {
  const cleaned = cleanRawResponse(rawText);
  try {
    const parsed = JSON.parse(cleaned);
    const choices = parsed.choices as Array<Record<string, unknown>> | undefined;
    if (choices?.[0]) {
      const msg = choices[0].message as Record<string, unknown> | undefined;
      if (msg?.content && typeof msg.content === "string" && msg.content.length > 0) return msg.content;
      const reasoning = msg?.reasoning_content as string | undefined;
      if ((!msg?.content || (typeof msg.content === "string" && msg.content.length === 0)) && reasoning && reasoning.length > 0) return reasoning;
      const delta = choices[0].delta as Record<string, unknown> | undefined;
      if (delta?.content && typeof delta.content === "string" && delta.content.length > 0) return delta.content;
      if (choices[0].text && typeof choices[0].text === "string") return choices[0].text;
    }
    const claudeContent = parsed.content as string | Array<Record<string, unknown>> | undefined;
    if (typeof claudeContent === "string" && claudeContent.length > 0) return claudeContent;
    if (Array.isArray(claudeContent)) {
      for (const block of claudeContent) {
        if (block.type === "text" && typeof block.text === "string") return block.text;
      }
    }
    if (parsed.response && typeof parsed.response === "string") return parsed.response;
  } catch {}
  const cm = cleaned.match(/"content"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (cm) return cm[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  const tm = cleaned.match(/"text"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (tm) return tm[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  const rm = cleaned.match(/"reasoning_content"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (rm) return rm[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  return null;
}

/** Gọi LLM chat completions, trả raw text (hoặc null khi lỗi). */
async function callLLM(systemPrompt: string, userPrompt: string, maxTokens = 4096, timeoutMs = 60000): Promise<string | null> {
  if (!LLM_KEY || !LLM_BASE) return null;
  try {
    const res = await fetch(`${LLM_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LLM_KEY}`,
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      console.error(`[TaskListAnalyze] LLM returned ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.error("[TaskListAnalyze] LLM call error:", err);
    return null;
  }
}

/** Parse 1 JSON object từ LLM response (bỏ markdown/code block nếu có). */
function extractJsonObject(raw: string): any | null {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {}
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]);
    } catch {}
  }
  return null;
}

// ─── Normalize ────────────────────────────────────────────────

function normText(s: unknown): string {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

/** Chuẩn hoá 1 task từ LLM — đảm bảo mọi field có type đúng. */
function normalizeTask(raw: any): DetectedTask | null {
  if (!raw || typeof raw !== "object") return null;
  const title = normText(raw.title || raw.name || raw.task);
  if (!title) return null;
  const manday = raw.manday === undefined || raw.manday === null || isNaN(Number(raw.manday)) ? undefined : Number(raw.manday);
  return {
    title,
    phase: normText(raw.phase) || "Khác",
    details: normText(raw.details) || undefined,
    pic: normText(raw.pic) || "",
    support: normText(raw.support) || "",
    manday: manday && manday > 0 ? manday : undefined,
    status: normText(raw.status) || undefined,
    no: normText(raw.no) || undefined,
  };
}

/** Fallback rule-based — giữ cấu trúc gốc (paste parse) làm task, chưa assign. */
function fallbackTasks(items: TaskItemInput[]): DetectedTask[] {
  return items
    .map((it) => {
      const title = normText(it.title);
      if (!title) return null;
      return {
        title,
        phase: normText(it.phase) || "Khác",
        details: normText(it.details) || undefined,
        pic: normText(it.pic) || "",
        support: normText(it.support) || "",
        manday: it.manday && it.manday > 0 ? Number(it.manday) : undefined,
        status: it.status,
        no: normText(it.no) || undefined,
      } as DetectedTask;
    })
    .filter(Boolean) as DetectedTask[];
}

// ─── Member matching ──────────────────────────────────────────

/** Tách alias/email từ text PIC (vd "FCI DatPT115", "FCI (datpt115)", "datpt115" hoặc email). */
export function extractPicAliases(picText: string): string[] {
  const aliases: string[] = [];
  const parts = String(picText ?? "").split(/[\/,;()]+/);
  for (const p of parts) {
    const t = p.trim();
    if (!t) continue;
    if (/^fci$/i.test(t)) continue; // "FCI" chung — không phải người
    if (/^kh$/i.test(t)) continue; // khách hàng
    aliases.push(t);
  }
  // Nếu không tách được alias nào → giữ nguyên chuỗi (vd "FCI DatPT115")
  if (aliases.length === 0 && normText(picText)) aliases.push(normText(picText));
  return aliases;
}

/** Map 1 picText → member name (match alias/email trong member list), hoặc null. */
export function matchPicToMember(picText: string, members: MemberRef[]): string | null {
  const aliases = extractPicAliases(picText);
  for (const alias of aliases) {
    const a = alias.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const m of members) {
      const name = normText(m.name).toLowerCase().replace(/[^a-z0-9]/g, "");
      const email = normText(m.email ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
      if (name === a || email === a || email.includes(a) || a.includes(email)) {
        return normText(m.name);
      }
    }
  }
  return null;
}

/** Assign pic/support theo member list — ưu tiên dữ liệu gốc. */
function assignPics(tasks: DetectedTask[], members: MemberRef[]): { tasks: DetectedTask[]; mappedPics: Record<string, string> } {
  const memberStr = members.map((m) => `${m.name}${m.email ? ` (${m.email})` : ""}${m.roleName ? ` — ${m.roleName}` : ""}`).join("\n");
  const mappedPics: Record<string, string> = {};
  const out = tasks.map((t) => {
    const t2 = { ...t };
    // PIC
    if (t.pic) {
      const mapped = matchPicToMember(t.pic, members);
      if (mapped) {
        t2.pic = mapped;
        mappedPics[t.pic] = mapped;
      } else {
        t2.pic = ""; // không khớp member → để trống (PM tự chọn)
      }
    }
    // Support
    if (t.support) {
      const mapped = matchPicToMember(t.support, members);
      if (mapped) t2.support = mapped;
      else t2.support = "";
    }
    return t2;
  });
  return { tasks: out, mappedPics };
}

// ─── LLM analyze ──────────────────────────────────────────────

const SYSTEM_PROMPT = `Bạn là PM Agent của công cụ quản lý dự án K-Todolist (FPT Cloud).

Người dùng dán nội dung task list copy từ file Excel (giữ tab giữa các cột, có thể là dạng text thuần) của một dự án triển khai. Nhiệm vụ của bạn:
1. Tách từng task thành: title, phase (nhóm: Chuẩn bị / Triển khai / Khảo sát / Nghiệm thu / Bàn giao...), details, pic, support, manday (số), status (nếu có).
2. "Pic" và "support" — NGƯỜI CHỊU TRÁCH NHIỆM CHÍNH / HỖ TRỢ:
   - ƯU TIÊN dùng đúng tên/alias trong cột PIC/Support của dữ liệu gốc (VD "FCI DatPT115" → "DatPT115"; "FCI (longpm2)" → "longpm2"; "KH" → bỏ trống).
   - Chỉ CHỌN MỘT người trong danh sách MEMBER dưới đây (dùng chính xác TÊN member), KHÔNG bịa tên ngoài danh sách.
   - Nếu không khớp member nào → để pic/support rỗng.
3. KHÔNG tạo task mới ngoài dữ liệu gốc. Giữ nguyên thứ tự.

DANH SÁCH MEMBER CỦA DỰ ÁN (chỉ assign cho những người này):
<members/>

QUY TẮC OUTPUT:
- Trả về DUY NHẤT 1 JSON object (không markdown, không code block):
{ "tasks": [ { "title": "...", "phase": "...", "details": "...", "pic": "...", "support": "...", "manday": <số hoặc null>, "status": "done|processing|todo|pending|<rỗng>" } ] }
- Mỗi field là string (hoặc số cho manday) — không thêm field khác.
- Bỏ qua dòng tiêu đề (header) và dòng trống.
- Nếu không có task nào → "tasks": [].
`;

/**
 * Phân tích task list dán từ Excel:
 * - LLM detect task + assign pic (ưu tiên cột gốc, thiếu thì gợi ý theo member).
 * - Lỗi/thiếu cấu hình → fallback giữ dữ liệu đã parse (chưa assign).
 */
export async function analyzeTaskList(
  items: TaskItemInput[],
  members: MemberRef[],
  rawText?: string
): Promise<TaskListAnalyzeResult> {
  const trimmedText = String(rawText ?? "").trim();
  const memberStr = members
    .map((m) => `${m.name}${m.email ? ` (${m.email})` : ""}${m.roleName ? ` — ${m.roleName}` : ""}`)
    .join("\n");

  const base = fallbackTasks(items);

  // Nếu không có LLM hoặc không có text → fallback + assign theo member
  if (!trimmedText) {
    const { tasks: assigned, mappedPics } = assignPics(base, members);
    return { tasks: assigned, source: "fallback", mappedPics };
  }

  const system = SYSTEM_PROMPT.replace("<members/>", memberStr || "(không có member — để trống pic/support)");
  const user = `Nội dung task list từ Excel:\n\n${trimmedText.slice(0, 12000)}\n\nHãy phân tích thành tasks theo quy tắc trên.`;

  const raw = await callLLM(system, user, 4096, 60000);
  if (!raw) {
    const { tasks: assigned, mappedPics } = assignPics(base, members);
    return { tasks: assigned, source: "fallback", mappedPics };
  }

  const content = extractLLMContent(raw);
  const parsed = content ? extractJsonObject(content) : null;
  const llmTasks = Array.isArray(parsed?.tasks) ? parsed.tasks.map(normalizeTask).filter(Boolean) : [];

  if (llmTasks.length > 0) {
    const { tasks: assigned, mappedPics } = assignPics(llmTasks, members);
    return { tasks: assigned, source: "llm", mappedPics };
  }

  // LLM không trả đúng → fallback
  const { tasks: assigned, mappedPics } = assignPics(base, members);
  return { tasks: assigned, source: "fallback", mappedPics };
}