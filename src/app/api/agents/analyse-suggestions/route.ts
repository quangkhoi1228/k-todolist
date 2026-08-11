import { NextResponse } from "next/server";

const LLM_KEY = process.env.OPENAI_API_KEY || "";
const LLM_MODEL = process.env.LLM_MODEL || "deepsseek-v4_mimo_combo";
const LLM_BASE = process.env.OPENAI_BASE_URL;

function extractLLMContent(rawText: string): string | null {
  try {
    const parsed = JSON.parse(rawText);
    const choices = parsed.choices as Array<Record<string, unknown>> | undefined;
    const msg = choices?.[0]?.message as Record<string, unknown> | undefined;
    const content = msg?.content as string | undefined;
    if (content) return content;
  } catch {}

  const contentMatch = rawText.match(/"content"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (contentMatch) {
    return contentMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }

  return null;
}

export async function POST(req: Request) {
  try {
    const { projectName, projectId, messages } = await req.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ ok: true, suggestions: [] });
    }

    if (!LLM_KEY || !LLM_BASE) {
      // Fallback: rule-based suggestion extraction
      const suggestions = generateFallbackSuggestions(projectName, messages);
      return NextResponse.json({ ok: true, suggestions });
    }

    // Build a compact message history for LLM analysis
    const messageLog = messages
      .slice(-50) // Last 50 messages
      .map((m: any) => `[${m.sender || "Unknown"}] (${m.chatName || "chat"}): ${m.content?.slice(0, 500) || ""}`)
      .join("\n");

    const systemPrompt = `Bạn là PM Agent - trợ lý quản lý dự án thông minh.
    
Nhiệm vụ của bạn là phân tích tin nhắn Teams của dự án "${projectName}" và đưa ra các gợi ý hành động cho PM.

Phân tích các loại gợi ý sau:
1. **transfer_request** - Yêu cầu chuyển thông tin từ Sale/Presale cho team triển khai. Dấu hiệu: có người mới được tag, yêu cầu bàn giao thông tin, đề cập đến sale/presale handover.
2. **mention** - Tin nhắn có đề cập đến bạn (PM) hoặc cần PM hành động. Dấu hiệu: tag tên, "@PM", "@anh", yêu cầu PM xử lý.
3. **action_item** - Công việc cần làm được nhắc đến: cần confirm, cần approval, cần gửi document, cần họp, v.v.
4. **deadline** - Deadline/ hạn chót được nhắc đến.
5. **info** - Thông tin quan trọng cần lưu ý.
6. **warning** - Cảnh báo: vấn đề phát sinh, risk, conflict, chậm tiến độ.

QUAN TRỌNG: Chỉ đưa ra gợi ý khi thực sự cần thiết, không spam.
QUAN TRỌNG: Tất cả nội dung text (title, description, input, reasoning, expectedOutcome, actionLabel) PHẢI viết tiếng Việt CÓ DẤU đầy đủ. NGHIÊM CẤM viết tiếng Việt không dấu.
Output phải là JSON array (không markdown, không code block):
[
  {
    "type": "transfer_request",
    "title": "Tiêu đề ngắn gọn",
    "description": "Mô tả chi tiết gợi ý, bao gồm trích dẫn tin nhắn gốc",
    "sourceSender": "Tên người gửi",
    "sourceChatName": "Tên nhóm chat",
    "sourceMessage": "Nội dung tin nhắn gốc",
    "actionLabel": "Nhãn nút hành động (nếu có)",
    "input": "Tóm tắt ngắn gọn dữ liệu/tin nhắn gốc đã dùng làm căn cứ (2-3 câu, trích dẫn nội dung liên quan)",
    "reasoning": "Suy luận/tại sao đi đến kết luận này, căn cứ vào điều gì trong tin nhắn (2-4 câu)",
    "expectedOutcome": "Kết quả mong muốn nếu thực hiện gợi ý này (1-2 câu)"
  }
]`;

    const requestBody = {
      model: LLM_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Phân tích các tin nhắn Teams sau đây của dự án "${projectName}" và đưa ra gợi ý hành động cho PM:\n\n${messageLog}` },
      ],
      temperature: 0.1,
      max_tokens: 4096,
    };

    const res = await fetch(`${LLM_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LLM_KEY}`,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      console.error(`[AnalyseSuggestions] LLM returned ${res.status}`);
      const suggestions = generateFallbackSuggestions(projectName, messages);
      return NextResponse.json({ ok: true, suggestions });
    }

    const rawText = await res.text();
    const content = extractLLMContent(rawText);

    if (!content) {
      const suggestions = generateFallbackSuggestions(projectName, messages);
      return NextResponse.json({ ok: true, suggestions });
    }

    // Try to parse JSON from content
    try {
      // Find JSON array in the response
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const suggestions = JSON.parse(jsonMatch[0]);
        return NextResponse.json({ ok: true, suggestions: Array.isArray(suggestions) ? suggestions : [] });
      }
    } catch {
      // If JSON parsing fails, fall to rule-based
    }

    const suggestions = generateFallbackSuggestions(projectName, messages);
    return NextResponse.json({ ok: true, suggestions });
  } catch (err) {
    console.error("[AnalyseSuggestions] Error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}

/**
 * Rule-based fallback suggestion generation when LLM is unavailable
 */
function generateFallbackSuggestions(projectName: string, messages: any[]) {
  const suggestions: Array<{
    type: string;
    title: string;
    description: string;
    sourceSender?: string;
    sourceChatName?: string;
    sourceMessage?: string;
    actionLabel?: string;
  }> = [];

  const MENTION_KEYWORDS = [/@pm/i, /@anh/i, /@khoa/i, /@trưởng/i, /@truong/i, /pm\s+(?:ơi|oi)/i, /anh\s+(?:khoa|hưng|tuấn|an|tùng|huy)/i];
  const TRANSFER_KEYWORDS = [/bàn\s*giao/i, /chuyển\s*(?:thông\s*tin|tiếp|qua)/i, /handover/i, /sales?\s*bàn\s*giao/i, /presale/i];
  const ACTION_KEYWORDS = [/cần\s*(?:xác\s*nhận|approve|confirm|duyệt|gửi|họp|báo\s*giá)/i, /làm\s*ngay/i, /request/i, /cần\s*(?:support|hỗ\s*trợ)/i];
  const DEADLINE_KEYWORDS = [/hạn\s*chót/i, /deadline/i, /due\s*date/i, /kịp/i, /chậm/i, /delay/i, /trễ/i];
  const WARNING_KEYWORDS = [/lỗi/i, /problem/i, /vấn\s*đề/i, /risk/i, /rủi\s*ro/i, /không\s*kịp/i, /conflict/i, /tắc/i, /chậm\s*tiến/i];

  const seen = new Set<string>();

  // Process newest messages first
  const reversed = [...messages].reverse();

  for (const msg of reversed) {
    const content = (msg.content || "").trim();
    const sender = msg.sender || "Unknown";
    const chatName = msg.chatName || "Teams";
    if (!content) continue;

    // Skip very short messages
    if (content.length < 15) continue;

    const dedupKey = `${sender}|${content.slice(0, 60)}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    // Check for transfer/sales-presale handover requests
    if (TRANSFER_KEYWORDS.some(k => k.test(content))) {
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

    // Check for mentions / PM action needed
    if (MENTION_KEYWORDS.some(k => k.test(content))) {
      suggestions.push({
        type: "mention",
        title: "Bạn được đề cập trong tin nhắn",
        description: `"${sender}" đã đề cập đến bạn trong "${chatName}". Nội dung: "${content.slice(0, 200)}"`,
        sourceSender: sender,
        sourceChatName: chatName,
        sourceMessage: content,
      });
    }

    // Check for action items
    if (ACTION_KEYWORDS.some(k => k.test(content))) {
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

    // Check for deadlines
    if (DEADLINE_KEYWORDS.some(k => k.test(content))) {
      suggestions.push({
        type: "deadline",
        title: "Deadline được nhắc đến",
        description: `Tin nhắn từ "${sender}" trong "${chatName}" có nhắc đến deadline: "${content.slice(0, 200)}"`,
        sourceSender: sender,
        sourceChatName: chatName,
        sourceMessage: content,
      });
    }

    // Check for warnings/issues
    if (WARNING_KEYWORDS.some(k => k.test(content))) {
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

  // Limit to at most 10 suggestions
  return suggestions.slice(0, 10);
}
