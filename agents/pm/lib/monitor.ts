/**
 * Shared PM action monitor — used by sync-single-chat, sync-all-projects
 * and auto-monitor. Analyzes recent messages (cross-platform: Teams + Zalo)
 * with an LLM and creates suggestions in projectSuggestions with priority.
 */

import { getMessagesByProject } from "../../../src/lib/repo/projectChats";
import { addSuggestionsBatch } from "../../../src/lib/repo/projectSuggestions";

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

  const apiKey = process.env.OPENAI_API_KEY;
  const apiBase = process.env.OPENAI_BASE_URL;
  const model = process.env.LLM_MODEL || "deepsseek-v4_mimo_combo";

  if (!apiKey || !apiBase) {
    console.log(`[Monitor] Skipped: no LLM credentials`);
    return;
  }

  try {
    console.log(`[Monitor] Analysing ${savedMessages.length} new messages for PM action...`);

    // Merge recent messages from BOTH platforms for full context
    let crossPlatformLog: string[] = [];
    try {
      const recent = await getMessagesByProject(projectId, undefined);
      crossPlatformLog = (recent || [])
        .map((m: any) => `[${m.platform || ""}] [${m.chatName || ""}] ${m.sender || "Unknown"}: ${(m.content || "").slice(0, 400)}`)
        .filter((s: string) => s.length > 0);
    } catch (e) {
      console.warn(`[Monitor] Could not load cross-platform history: ${e}`);
    }
    // Fall back to the just-saved messages if DB query failed
    if (crossPlatformLog.length === 0) {
      crossPlatformLog = savedMessages
        .slice(-30)
        .map((m: any) => `[${m.sender || "Unknown"}]: ${(m.content || "").slice(0, 500)}`)
        .filter((s: string) => s.length > 0);
    }

    const messageLog = crossPlatformLog.join("\n");

    const systemPrompt = `Bạn là PM Agent - trợ lý quản lý dự án thông minh.

Phân tích tin nhắn từ nhóm chat dự án (có thể gồm cả Teams nội bộ và Zalo với khách hàng) và xác định:
1. Có cần PM tham gia giải quyết vấn đề gì không?
2. Nếu có, cần hành động gì?

Phân loại action theo 4 nhóm:
- "action_item" — việc cần PM làm/chỉ đạo (vd: tạo task, cập nhật tiến độ, gửi email)
- "risk" — rủi ro tiềm ẩn cần PM theo dõi (vd: dịch vụ ngừng hỗ trợ, thay đổi scope)
- "blocker" — việc đang vướng/chặn, cần PM xử lý để gỡ (vd: khách kết nối lỗi chưa fix, chờ bên khác mà không phản hồi)
- "decision" — cần chốt quyết định giữa các bên (vd: chọn phương án, chốt timeline, chốt IP plan)

Mỗi action cần có:
- priority: "high" | "medium" | "low" (high = đang chặn tiến độ/ảnh hưởng KH, medium = cần làm trong ngày, low = theo dõi)
- title: ngắn gọn, rõ ràng
- description: giải thích VÌ SAO cần PM + bối cảnh cụ thể từ tin nhắn
- sourceSender: người gửi tin nhắn liên quan
- sourceMessage: trích nguyên văn tin nhắn quan trọng nhất (tối đa 200 ký tự)
- actionLabel: hành động cụ thể PM nên làm (vd: "Theo dõi với Đạt và Minh Long", "Xác nhận với KH qua Zalo")
- input: tóm tắt ngắn gọn dữ liệu/tin nhắn gốc đã dùng làm căn cứ (2-3 câu, trích dẫn nội dung liên quan)
- reasoning: suy luận/tại sao đi đến kết luận này, căn cứ vào điều gì trong tin nhắn (2-4 câu)
- expectedOutcome: kết quả mong muốn nếu PM thực hiện hành động (1-2 câu, mô tả trạng thái hoàn thành)

QUAN TRỌNG: Chỉ đề xuất hành động KHI THỰC SỰ CẦN THIẾT. Nếu tin nhắn là trao đổi thông thường hoặc đã được xử lý xong, trả về [].
QUAN TRỌNG: Tất cả nội dung text (title, description, sourceSender, actionLabel, input, reasoning, expectedOutcome) PHẢI viết tiếng Việt CÓ DẤU đầy đủ. NGHIÊM CẤM viết tiếng Việt không dấu (vd "du an", "ban muon lam gi").

Output là JSON array, không markdown, không code block:
[{"type":"action_item","priority":"high","title":"...","description":"...","sourceSender":"...","sourceMessage":"...","actionLabel":"...","input":"...","reasoning":"...","expectedOutcome":"..."}]`;

    const response = await fetch(`${apiBase}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Phân tích tin nhắn:\n\n${messageLog}` },
        ],
        temperature: 0.1,
        max_tokens: 8192,
        // IMPORTANT: this router appends "data: [DONE]" + a trailing JSON object
        // to non-streamed responses, which breaks JSON.parse. Force stream:false
        // AND handle the merged-trailer case defensively below.
        stream: false,
      }),
      signal: AbortSignal.timeout(240000),
    });

    if (!response.ok) {
      console.warn(`[Monitor] LLM error: ${response.status}`);
      return;
    }

    const rawText = await response.text();

    // Strip SSE trailers. Some proxies append "data: [DONE]" glued straight
    // onto the closing "}" (e.g. `...cost":"0"}data: [DONE]`). Remove the
    // trailer AND any text after the last complete JSON object.
    let content = rawText
      .replace(/data:\s*\[DONE\]\s*$/i, "")
      .replace(/(\]|\})\s*data:\s*\[DONE\]\s*$/i, "$1")
      .trim();

    // If there is still junk after the JSON (defensive), grab the largest
    // balanced block that parses as JSON.
    const parseJson = (s: string): any => {
      try { return { ok: true, value: JSON.parse(s) }; } catch { return { ok: false }; }
    };

    try {
      const parsed = JSON.parse(content);
      const msg = parsed.choices?.[0]?.message;
      if (msg?.content && msg.content.trim().length > 0) {
        content = msg.content;
      } else if (msg?.reasoning_content) {
        // DeepSeek reasoning models put the final answer at the END of
        // reasoning_content. Take the LAST [...] block (the final answer),
        // not the first (which is usually a description of the task).
        content = msg.reasoning_content;
      }
    } catch {}

    content = content.trim();

    let actions: any[] = [];
    // Try direct JSON array parse first (content may already be the array
    // string, or the full OpenAI envelope we unwrap below).
    const envelope = parseJson(content);
    if (envelope.ok) {
      const msg = envelope.value?.choices?.[0]?.message;
      if (msg?.content && typeof msg.content === "string" && msg.content.trim().length > 0) {
        content = msg.content.trim();
      } else if (msg?.reasoning_content) {
        content = msg.reasoning_content;
      }
    }

    try {
      actions = JSON.parse(content);
      if (!Array.isArray(actions)) throw new Error("not array");
    } catch {
      // Fallback: for reasoning content, prefer the LAST [...] block (final answer)
      const matches = content.match(/\[[\s\S]*?\]/g) || [];
      // Keep only blocks that look like JSON arrays of objects
      const candidates = matches.filter(m => {
        const r = parseJson(m);
        return r.ok && Array.isArray(r.value) && r.value.every((x: any) => x && typeof x === "object");
      });
      const best = candidates.length > 0 ? candidates[candidates.length - 1] : null;
      if (best) {
        const r = parseJson(best);
        if (r.ok) {
          actions = r.value;
        } else {
          console.log(`[Monitor] Could not parse JSON from LLM response`);
          return;
        }
      }
    }

    // Keep only actions with a meaningful title (LLM sometimes returns
    // placeholder objects like {actionLabel: ""} for "no action needed")
    actions = actions.filter((a: any) => a && typeof a.title === "string" && a.title.trim().length > 0);

    // Normalize type + priority
    actions = actions.map((a: any) => ({
      ...a,
      type: ["action_item", "risk", "blocker", "decision"].includes(a.type) ? a.type : "action_item",
      priority: ["high", "medium", "low"].includes(a.priority) ? a.priority : "medium",
    }));

    if (!Array.isArray(actions) || actions.length === 0) {
      console.log(`[Monitor] No PM action needed`);
      return;
    }

    console.log(`[Monitor] Found ${actions.length} action(s) needing PM:`);
    actions.forEach((a: any) => console.log(`  - [${a.priority}] ${a.title}: ${a.actionLabel}`));

    await addSuggestionsBatch({
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
        // Encode priority + detected time + reasoning details in suggestionData for UI display
        suggestionData: JSON.stringify({
          priority: a.priority || "medium",
          detectedAt: Date.now(),
          input: a.input,
          reasoning: a.reasoning,
          expectedOutcome: a.expectedOutcome,
        }),
      })),
    });

    console.log(`[Monitor] Saved ${actions.length} suggestion(s) to Postgres.`);
  } catch (err) {
    console.warn(`[Monitor] Error:`, err);
  }
}
