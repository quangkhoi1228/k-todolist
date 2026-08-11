import { NextRequest, NextResponse } from "next/server";

const LLM_KEY = process.env.OPENAI_API_KEY || "";
const LLM_MODEL = process.env.LLM_MODEL || "deepsseek-v4_mimo_combo";
const LLM_BASE = process.env.OPENAI_BASE_URL;

/**
 * Try to parse JSON from text:
 * 1. Direct JSON.parse
 * 2. Brace-depth tracking for first complete JSON object
 * 3. Regex for "content" field in truncated JSON
 */
function tryParseJson(text: string): { parsed: Record<string, unknown> | null; rawContent: string | null } {
  try {
    return { parsed: JSON.parse(text), rawContent: null };
  } catch {}

  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") {
      if (start === -1) start = i;
      depth++;
    } else if (text[i] === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        try {
          return { parsed: JSON.parse(text.slice(start, i + 1)), rawContent: null };
        } catch {}
      }
    }
  }

  const contentMatch = text.match(/"content"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (contentMatch) {
    return {
      parsed: null,
      rawContent: contentMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\"),
    };
  }

  return { parsed: null, rawContent: null };
}

function extractLLMContent(rawText: string): string | null {
  const { parsed, rawContent } = tryParseJson(rawText);
  if (rawContent) return rawContent;
  if (parsed) {
    const choices = parsed.choices as Array<Record<string, unknown>> | undefined;
    const msg = (choices?.[0]?.message as Record<string, unknown> | undefined);
    const content = msg?.content as string | undefined;
    if (content) return content;
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const { text, history, contextProject } = await req.json();

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "Missing text" }, { status: 400 });
    }

    if (!LLM_KEY || !LLM_BASE) {
      return NextResponse.json({
        action: null, ticketId: null, projectQuery: null, reply: "", confidence: 0,
      });
    }

    let contextHint = "";
    if (contextProject && contextProject.name) {
      const ticketInfo = contextProject.ticketId ? ` (ISD: ${contextProject.ticketId})` : "";
      contextHint = `\n\n**Ngữ cảnh hiện tại:** PM đang xem dự án "${contextProject.name}"${ticketInfo}.`;
      contextHint += `\nQUAN TRỌNG: Vì PM đang xem dự án "${contextProject.name}", các yêu cầu như "thêm nhân sự", "tạo meeting", "cập nhật SOW", "xem thông tin" sẽ áp dụng cho dự án NÀY.`;
      contextHint += `\nQUAN TRỌNG: Nếu PM nói "đến dự án", "chuyển đến", "mở dự án" — nếu đã đang xem "${contextProject.name}" rồi thì action=goto_project, projectQuery="${contextProject.name}" (để UI biết là đã ở đúng project).`;
    }

    const systemPrompt = `Ban la PM Agent - tro ly quan ly du an.${contextHint}
Phan tich yeu cau cua PM va xac dinh y dinh (intent).

QUAN TRONG: Ban phai tra loi bang tieng Viet CO DAU DAY DU.
- Moi cau tra loi (truong "reply") BAT BUOC viet tieng Viet co dau day du (vd "Xin chào", "Tôi có thể giúp gì", "Dự án", "đang được quản lý").
- NGHIEM CAM tra loi tieng Viet khong dau, khong viet tat kieu "Toi co the giup", "du an", "ban muon lam gi".
- Neu nguoi dung hoi bang tieng Viet khong dau, van phai tra loi tieng Viet CO DAU.

Cac intent:
1. "create_project" - PM muon tao du an moi
2. "lookup_ticket" - PM muon xem thong tin ticket
3. "view_project" - PM muon xem du an da tao
4. "goto_project" - PM muon chuyen den mot du an cu the
5. "chat" - PM tro chuyen thong thuong

Chi tiet:
- "tao du an moi" + ISD-xxxxx => action=create_project, ticketId="ISD-xxxxx"
- "tao du an moi" khong co ISD => action=create_project, ticketId=null
- "xem ticket" + ISD-xxxxx => action=lookup_ticket
- "chuyen den" / "den du an" / "tim du an" => action=goto_project, projectQuery="ten hoac ma"

Output CHI la JSON, VD: { "action": "chat", "ticketId": null, "projectQuery": null, "reply": "Xin chào! Tôi có thể giúp gì cho bạn?", "confidence": 1.0 }`;

    const historyMessages = (history || []).map((msg: { role: string; content: string }) => ({
      role: msg.role === "agent" ? "assistant" : msg.role === "user" ? "user" : "system",
      content: msg.content,
    }));

    const requestBody = {
      model: LLM_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        ...historyMessages.slice(-10),
        { role: "user", content: text },
      ],
      temperature: 0.1,
      max_tokens: 1024,
    };

    const res = await fetch(`${LLM_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LLM_KEY}`,
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(25000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[LLM] ${LLM_BASE} returned ${res.status}: ${errText.slice(0, 200)}`);
      return NextResponse.json({
        action: null, ticketId: null, projectQuery: null, reply: "", confidence: 0,
      });
    }

    const rawText = await res.text();
    const content = extractLLMContent(rawText);

    if (!content) {
      console.error(`[LLM] No content in response: ${rawText.slice(0, 300)}`);
      return NextResponse.json({
        action: null, ticketId: null, projectQuery: null, reply: "", confidence: 0,
      });
    }

    const { parsed } = tryParseJson(content);
    if (parsed) {
      return NextResponse.json({
        action: parsed.action || "chat",
        ticketId: parsed.ticketId || null,
        projectQuery: parsed.projectQuery ?? null,
        reply: parsed.reply || "",
        confidence: parsed.confidence || 0,
      });
    }

    return NextResponse.json({
      action: "chat",
      ticketId: null,
      projectQuery: null,
      reply: content,
      confidence: 0.5,
    });
  } catch (error) {
    console.error("[LLM Parse Error]", error);
    return NextResponse.json({
      action: null, ticketId: null, projectQuery: null, reply: "", confidence: 0,
    });
  }
}
