/**
 * Project summary generator — core logic dùng chung giữa API route
 * `/api/agents/generate-project-summary` và queue worker (`sync-queue.ts`).
 *
 * Gồm:
 * - `shouldUpdateSummary()`: LLM gate — đánh giá có biến động đáng chú ý không.
 * - `generateAndSaveSummary()`: sinh bản tóm tắt (LLM, fallback rule-based) + lưu version.
 */

import { getProject } from "./repo/projects";
import { getByProject } from "./repo/projectIsdData";
import { getTasksByProject } from "./repo/tasks";
import { getMembersByProject } from "./repo/projectMembers";
import { getMessagesByProject } from "./repo/projectChats";
import { getUnresolvedSuggestionsByUser } from "./repo/projectSuggestions";
import { getSessionByProject } from "./repo/agentsPm";
import { createSummary, getLatestSummary } from "./repo/projectSummaries";

const LLM_KEY = process.env.OPENAI_API_KEY || "";
const LLM_MODEL = process.env.LLM_MODEL || "deepsseek-v4_mimo_combo";
const LLM_BASE = process.env.OPENAI_BASE_URL;

// ─── LLM helpers ────────────────────────────────────────────

/** Strip SSE `data: [DONE]` trailer that some proxies append. */
function cleanRawResponse(raw: string): string {
  const idx = raw.lastIndexOf("data: [DONE]");
  return idx >= 0 ? raw.slice(0, idx).trim() : raw.trim();
}

/** Parse LLM response: handles content, reasoning_content, delta, Anthropic, Ollama. */
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

/** Gọi LLM chat completions, return raw text (hoặc null khi lỗi). */
async function callLLM(systemPrompt: string, userPrompt: string, maxTokens = 8192, timeoutMs = 60000): Promise<string | null> {
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
      console.error(`[GenSummary] LLM returned ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.error("[GenSummary] LLM call error:", err);
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

// ─── Snapshot builder ───────────────────────────────────────

const STATUS_LABELS: Record<string, { label: string; short: string }> = {
  todo: { label: "Chưa thực hiện", short: "Chưa TH" },
  processing: { label: "Đang xử lý", short: "Đang XL" },
  pending: { label: "Tạm dừng", short: "Tạm dừng" },
  done: { label: "Hoàn thành", short: "Xong" },
};

function buildSnapshot(project: any, isdData: any, tasks: any[], members: any[], messages: any[], suggestions: any[], session: any) {
  const stats = {
    total: tasks.length,
    done: tasks.filter((t) => t.status === "done" || t.isCompleted).length,
    processing: tasks.filter((t) => t.status === "processing").length,
    pending: tasks.filter((t) => t.status === "pending").length,
    todo: tasks.filter((t) => t.status === "todo" || !t.status).length,
  };
  const donePct = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;

  const now = Date.now();
  const overdue = tasks.filter((t) => t.status !== "done" && !t.isCompleted && t.endDate && Number(t.endDate) < now);
  const nextActions = tasks
    .filter((t) => t.status !== "done" && !t.isCompleted)
    .sort((a, b) => (a.endDate ?? Infinity) - (b.endDate ?? Infinity))
    .slice(0, 8)
    .map((t) => ({
      title: t.title,
      status: t.status || "todo",
      priority: t.priority || "normal",
      pic: t.pic || "",
      endDate: t.endDate || null,
      overdue: t.endDate ? Number(t.endDate) < now : false,
    }));

  const unresolved = (suggestions || [])
    .filter((s: any) => !s.isResolved)
    .slice(0, 10)
    .map((s: any) => ({
      title: s.title,
      type: s.type,
      sourceChatName: s.sourceChatName || "",
      sourceSender: s.sourceSender || "",
      createdAt: s.createdAt || 0,
    }));

  // Messages đã sắp tăng dần theo thời gian (getMessagesByProject sort sẵn)
  const recentActivity = (messages || [])
    .slice(-12)
    .reverse()
    .map((m: any) => ({
      sender: m.sender || "Unknown",
      chatName: m.chatName || "",
      content: (m.content || "").slice(0, 200),
      timestampMs: m.timestampMs || null,
      isMine: !!m.isMine,
      platform: m.platform || "",
    }));

  // Phân loại member nội bộ vs khách hàng theo roleName + tên (keyword)
  const INTERNAL_RE = /nội\s*bộ|internal|fpt|fci|pm|support|tech|cloud/i;
  const internalMembers = (members || [])
    .filter((m: any) => INTERNAL_RE.test(`${m.roleName || ""} ${m.name || ""}`))
    .map((m: any) => ({ name: m.name, role: m.roleName || "", email: m.email || "" }));
  const customerMembers = (members || [])
    .filter((m: any) => !INTERNAL_RE.test(`${m.roleName || ""} ${m.name || ""}`))
    .map((m: any) => ({ name: m.name, role: m.roleName || "", email: m.email || "" }));

  const basic = {
    name: project?.name || "",
    ticketId: project?.ticketId || "",
    isdStatus: project?.isdStatus || isdData?.status || "",
    priority: isdData?.priority || "",
    summary: isdData?.summary || "",
    issueType: isdData?.issueType || "",
    assignee: isdData?.assignee || "",
    reporter: isdData?.reporter || "",
    owner: isdData?.owner || "",
    createdDate: isdData?.createdDate || "",
    updatedDate: isdData?.updatedDate || "",
    consultingTicketId: isdData?.consultingTicketId || "",
    deploymentTicketId: isdData?.deploymentTicketId || "",
    resourceTicketIds: isdData?.resourceTicketIds || [],
  };

  const status = {
    taskStats: stats,
    donePct,
    overdue: overdue.length,
    overdueTasks: overdue.slice(0, 5).map((t: any) => ({ title: t.title, endDate: t.endDate })),
    syncHealth: "OK",
    currentStep: session?.currentStep || "",
    sessionStatus: session?.status || "",
  };

  return { basic, status, nextActions, unresolvedActions: unresolved, members: { internal: internalMembers, customer: customerMembers }, recentActivity };
}

// ─── Prompts ────────────────────────────────────────────────

function buildGateSystemPrompt(): string {
  return `Bạn là PM Agent của bộ công cụ quản lý dự án K-Todolist.

Nhiệm vụ: đánh giá xem các tin nhắn mới đã đồng bộ về có tạo ra BIẾN ĐỘNG ĐÁNG CHÚ Ý cho dự án hay không — nếu có thì bản tóm tắt dự án nên được tạo/cập nhật mới.

Các tình huống nên cập nhật (shouldUpdate = true):
1. KHÁCH HÀNG hoặc người liên quan đề cập yêu cầu mới, thay đổi scope, chốt quyết định, thông tin quan trọng (deadline, số liệu, milestone).
2. Có blocker/rủi ro/vấn đề phát sinh (lỗi kỹ thuật, chậm tiến độ, tranh chấp, cần PM xử lý gấp).
3. Có hành động mới cần làm (gửi tài liệu, chốt SOW, họp kickoff, bàn giao, nghiệm thu...).
4. Trạng thái ticket / giai đoạn dự án thay đổi so với bản tóm tắt cũ.

Các tình huống KHÔNG nên cập nhật (shouldUpdate = false):
- Tin nhắn chào hỏi, cảm ơn, xác nhận đã nhận, chat xã giao, hỏi thăm không có nội dung quyết định.
- Tin đã có trong bản tóm tắt hiện tại.

Output phải là JSON object duy nhất (không markdown, không code block):
{ "shouldUpdate": true|false, "reason": "lý do ngắn gọn 1-2 câu, viết tiếng Việt CÓ DẤU" }`;
}

function buildGenerateSystemPrompt(): string {
  return `Bạn là PM Agent của bộ công cụ quản lý dự án K-Todolist.

Nhiệm vụ: tạo "Bản tóm tắt dự án" cấu trúc — dùng để PM xem nhanh và ra quyết định. Viết tiếng Việt, súc tích, chính xác, không thêm số liệu không có trong dữ liệu đầu vào.
QUAN TRỌNG: Toàn bộ nội dung PHẢI viết tiếng Việt CÓ DẤU đầy đủ (vd "Tiến độ", "Quá hạn", "đang chờ"). NGHIÊM CẤM viết tiếng Việt không dấu.

Output phải là JSON object duy nhất (không markdown, không code block):
{
  "summaryText": "markdown có các mục:
## Thông tin cơ bản (tên dự án, ticket, trạng thái ISD, ưu tiên, mô tả ngắn)
## Hiện trạng (tiến độ task x/y, % xong, task quá hạn, giai đoạn workflow hiện tại)
## Next actions (từ tasks chưa xong + gợi ý chưa xử lý — ưu tiên cao trước, kèm người phụ trách nếu có)
## Members (nội bộ / khách hàng — tên + vai trò)
## Hoạt động gần đây (3-5 điểm nổi bật từ tin nhắn mới nhất, nêu ai nói gì cần lưu ý)"
}
Chỉ đưa dữ liệu CÓ TRONG INPUT. Không đặt giả định.`;
}

// ─── Public API ─────────────────────────────────────────────

/**
 * LLM gate: đánh giá có nên tạo bản tóm tắt mới không (dựa trên messages mới + project basic).
 * Không gọi LLM được → mặc định shouldUpdate = false (an toàn, tránh spam version).
 */
export async function shouldUpdateSummary(args: {
  projectName: string;
  projectStatus: string;
  newMessages: any[];
  latestSummaryText?: string | null;
}): Promise<{ shouldUpdate: boolean; reason: string }> {
  try {
    if (!LLM_KEY || !LLM_BASE) return { shouldUpdate: false, reason: "LLM not configured" };
    if (!args.newMessages || args.newMessages.length === 0) return { shouldUpdate: false, reason: "No new messages" };

    const messageLog = args.newMessages
      .slice(-20)
      .map((m: any) => `[${m.sender || "Unknown"}] (${m.chatName || "chat"}): ${(m.content || "").slice(0, 300)}`)
      .join("\n");

    const latestText = args.latestSummaryText
      ? `\n\nBản tóm tắt hiện tại (để so sánh):\n${args.latestSummaryText.slice(0, 2000)}`
      : "\n\n(Chưa có bản tóm tắt nào — lần đầu tạo.)";

    const raw = await callLLM(
      buildGateSystemPrompt(),
      `Dự án: "${args.projectName}" (trạng thái ISD: ${args.projectStatus || "chưa có"})\n\nTin nhắn mới đồng bộ về:\n${messageLog}${latestText}\n\nHãy trả lời JSON duy nhất.`,
      1024,
      30000
    );
    if (!raw) return { shouldUpdate: false, reason: "LLM no response" };

    const content = extractLLMContent(raw);
    if (!content) return { shouldUpdate: false, reason: "LLM empty content" };

    const parsed = extractJsonObject(content);
    if (!parsed || typeof parsed.shouldUpdate !== "boolean") {
      return { shouldUpdate: false, reason: "LLM returned invalid JSON" };
    }
    return { shouldUpdate: parsed.shouldUpdate, reason: String(parsed.reason || "") };
  } catch (err) {
    console.error("[GenSummary] Gate error:", err);
    return { shouldUpdate: false, reason: "Gate error" };
  }
}

/**
 * Sinh + LƯU version tóm tắt mới (auto/manual).
 * Trả về summary đã lưu, hoặc null nếu project không tồn tại / lỗi.
 */
export async function generateAndSaveSummary(args: {
  projectId: number | string;
  userId: string;
  trigger: string; // "auto" | "manual"
}): Promise<any | null> {
  try {
    const project = await getProject(args.projectId);
    if (!project) throw new Error("Project not found");

    const [isdData, tasks, members, messages, suggestions, session] = await Promise.all([
      getByProject(args.projectId).catch(() => null),
      getTasksByProject(args.projectId).catch(() => []),
      getMembersByProject(args.projectId).catch(() => []),
      getMessagesByProject(args.projectId).catch(() => []),
      getUnresolvedSuggestionsByUser(args.userId).catch(() => []),
      getSessionByProject(args.userId, args.projectId).catch(() => null),
    ]);

    const snapshot = buildSnapshot(project, isdData, tasks, members, messages, suggestions, session);
    const inputJson = JSON.stringify(snapshot, null, 1);

    const raw = await callLLM(
      buildGenerateSystemPrompt(),
      `Dữ liệu dự án "${project.name}" (userId ${args.userId}):\n\n${inputJson}\n\nHãy tạo bản tóm tắt theo cấu trúc đã chỉ định (JSON duy nhất).`,
      4096,
      90000
    );

    let summaryText: string;
    if (raw) {
      const content = extractLLMContent(raw);
      const parsed = content ? extractJsonObject(content) : null;
      summaryText = typeof parsed?.summaryText === "string" && parsed.summaryText.trim()
        ? parsed.summaryText.trim()
        : buildFallbackSummary(project, snapshot).summaryText;
    } else {
      // Không có LLM: fallback dựng tóm tắt từ số liệu thật
      summaryText = buildFallbackSummary(project, snapshot).summaryText;
    }

    const created = await createSummary({
      projectId: args.projectId,
      userId: args.userId,
      trigger: args.trigger,
      summaryText,
      summaryData: snapshot,
    });
    return created;
  } catch (err) {
    console.error("[GenSummary] Generate error:", err);
    return null;
  }
}

/** Fallback không cần LLM — dựng markdown từ số liệu thật (đủ chuẩn để xem/ra quyết định). */
export function buildFallbackSummary(project: any, s: any): { summaryText: string; summaryData: any } {
  const lines: string[] = [];
  const b = s.basic || {};
  lines.push(`## Thông tin cơ bản`);
  lines.push(`- Dự án: ${b.name || project?.name || "—"}`);
  if (b.ticketId) lines.push(`- Ticket: ${b.ticketId}`);
  if (b.isdStatus) lines.push(`- Trạng thái ISD: ${b.isdStatus}`);
  if (b.priority) lines.push(`- Ưu tiên: ${b.priority}`);
  if (b.summary) lines.push(`- Mô tả: ${b.summary.slice(0, 300)}`);
  lines.push(``);
  lines.push(`## Hiện trạng`);
  const st = s.status || {};
  lines.push(`- Tiến độ: ${st.taskStats?.done ?? 0}/${st.taskStats?.total ?? 0} task xong (${st.donePct ?? 0}%)`);
  if (st.overdue > 0) lines.push(`- Quá hạn: ${st.overdue} task`);
  if (st.currentStep) lines.push(`- Giai đoạn workflow: ${st.currentStep}`);
  lines.push(``);
  lines.push(`## Next actions`);
  const na = s.nextActions || [];
  if (na.length === 0) lines.push(`- Chưa có task đang chờ`);
  for (const t of na) {
    lines.push(`- [${STATUS_LABELS[t.status]?.short || t.status}] ${t.title}${t.pic ? ` (${t.pic})` : ""}${t.endDate ? ` — hạn ${new Date(Number(t.endDate)).toLocaleDateString("vi-VN")}` : ""}`);
  }
  const un = s.unresolvedActions || [];
  if (un.length > 0) {
    lines.push(``);
    lines.push(`## Gợi ý chưa xử lý`);
    for (const u of un) lines.push(`- ${u.title}${u.sourceChatName ? ` (${u.sourceChatName})` : ""}`);
  }
  lines.push(``);
  lines.push(`## Members`);
  const internal = s.members?.internal || [];
  const customer = s.members?.customer || [];
  lines.push(`- Nội bộ: ${internal.length > 0 ? internal.map((m: any) => `${m.name}${m.role ? ` (${m.role})` : ""}`).join(", ") : "chưa có"}`);
  lines.push(`- Khách hàng: ${customer.length > 0 ? customer.map((m: any) => `${m.name}${m.role ? ` (${m.role})` : ""}`).join(", ") : "chưa có"}`);
  lines.push(``);
  lines.push(`## Hoạt động gần đây`);
  const recent = s.recentActivity || [];
  if (recent.length === 0) lines.push(`- Chưa có tin nhắn`);
  for (const m of recent.slice(0, 6)) {
    lines.push(`- ${m.sender}: ${m.content.slice(0, 120)}${m.chatName ? ` (${m.chatName})` : ""}`);
  }
  return { summaryText: lines.join("\n"), summaryData: s };
}

// ─── Tiện ích lấy messages mới cho gate ─────────────────────
export { getLatestSummary };