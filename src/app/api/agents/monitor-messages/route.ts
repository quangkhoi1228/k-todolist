import { NextResponse } from "next/server";

const LLM_KEY = process.env.OPENAI_API_KEY || "";
const LLM_MODEL = process.env.LLM_MODEL || "deepsseek-v4_mimo_combo";
const LLM_BASE = process.env.OPENAI_BASE_URL;

/** Strip SSE `data: [DONE]` trailer */
function cleanRawResponse(raw: string): string {
  const idx = raw.lastIndexOf("data: [DONE]");
  return idx >= 0 ? raw.slice(0, idx).trim() : raw.trim();
}

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
    }
  } catch {}

  const contentMatch = cleaned.match(/"content"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (contentMatch) return contentMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');

  return null;
}

function matchDeploymentState(rawStatus: string): string {
  const status = rawStatus.toLowerCase().trim();
  if (!status) return "in_progress";

  const states: { id: string; keywords: string[] }[] = [
    { id: "open", keywords: ["open", "create", "tạo", "new"] },
    { id: "waiting_for_pm", keywords: ["waiting for pm", "waiting pm", "chờ pm"] },
    { id: "kickoff", keywords: ["kickoff", "kick-off", "kick off"] },
    { id: "draft_sow", keywords: ["draft", "sow", "technical sow"] },
    { id: "customer_review", keywords: ["customer review", "customer", "review sow"] },
    { id: "in_progress", keywords: ["in progress", "task in progress", "đang triển khai", "progress"] },
    { id: "verification", keywords: ["verification", "customer verification", "verify", "xác nhận"] },
    { id: "ho_customer_ops", keywords: ["ho to customer", "ho to operations", "handover", "bàn giao"] },
    { id: "tl_review", keywords: ["tl review", "team lead", "review worklog"] },
    { id: "finalize_manday", keywords: ["finalize", "manday", "pm finalize"] },
    { id: "sale_review", keywords: ["sale review", "sale confirmation", "sale approve"] },
    { id: "ho_ops", keywords: ["pm ho", "ho to operations final", "bàn giao operations"] },
    { id: "closed", keywords: ["closed", "done", "hoàn thành", "resolve", "resolved"] },
    { id: "suspended", keywords: ["suspend", "cancel", "suspended", "cancelled"] },
  ];

  for (const state of states) {
    for (const kw of state.keywords) {
      if (status.includes(kw)) return state.id;
    }
  }
  return "in_progress";
}

function buildSystemPrompt(projectName: string, stateId: string): string {
  const stateActions: Record<string, string> = {
    open: "- Giao việc cho PM phù hợp\n- Làm rõ phạm vi dự án với Sale",
    waiting_for_pm: "- Xác nhận PM nhận dự án\n- Yêu cầu Sale add PM vào các nhóm",
    kickoff: "- Gửi tin nhắn chào Sale (đã có)\n- Xác nhận lịch kickoff",
    draft_sow: "- Yêu cầu kỹ thuật làm rõ giải pháp\n- Hỗ trợ Presale hoàn thiện SOW",
    customer_review: "- Theo dõi phản hồi từ khách hàng\n- Cập nhật SOW theo góp ý",
    in_progress: "- Gọi kỹ thuật khi có issue\n- Theo dõi tiến độ triển khai\n- Xử lý các block/conflict",
    verification: "- Xác nhận khách hàng đã verify\n- Chuẩn bị biên bản nghiệm thu",
    ho_customer_ops: "- Lên template nghiệm thu khi golive\n- Bàn giao tài liệu cho khách hàng\n- Kiểm tra checklist golive",
    tl_review: "- Rà soát worklog với TL\n- Tổng hợp thời gian thực tế",
    finalize_manday: "- Xác nhận manday với khách hàng\n- Đối chiếu công nợ",
    sale_review: "- Trình Sale review và phê duyệt\n- Xác nhận doanh thu",
    ho_ops: "- Bàn giao cho Ops vận hành\n- Cập nhật tài liệu vận hành",
    closed: "",
    suspended: "",
  };

  return `Bạn là PM Agent - trợ lý quản lý dự án thông minh.

Dự án: "${projectName}"
Giai đoạn hiện tại: ${stateId.toUpperCase()}

Nhiệm vụ: Phân tích tin nhắn từ Teams/Zalo của dự án và xác định:
1. Có cần PM tham gia giải quyết vấn đề gì không?
2. Nếu có, cần hành động gì?

Hành động phù hợp với giai đoạn hiện tại:
${stateActions[stateId] || "- Theo dõi và xử lý theo tình huống"}

Các hành động thường dùng (chọn hành động phù hợp nhất):
- "Gọi kỹ thuật" — khi có issue kỹ thuật, lỗi, cần support
- "Lên template nghiệm thu khi golive" — khi gần golive, khách hàng yêu cầu bàn giao
- "Xác nhận với khách hàng" — khi cần khách hàng xác nhận/approve
- "Họp với team" — khi cần align giữa các bên
- "Tạo task" — khi có đầu việc mới được giao
- "Cập nhật tiến độ" — khi khách hàng hỏi tiến độ
- "Theo dõi" — cần PM để mắt nhưng chưa cần hành động gấp

QUAN TRỌNG:
- Chỉ đề xuất hành động KHI THỰC SỰ CẦN THIẾT. Nếu tin nhắn là trao đổi thông thường, không cần PM — trả về mảng rỗng [].
- Mỗi hành động phải có dẫn chứng từ nội dung tin nhắn cụ thể.
- Nếu có nhiều tin nhắn cùng một vấn đề, chỉ tạo MỘT hành động duy nhất.
- Tất cả nội dung text (title, description, sourceSender, actionLabel) PHẢI viết tiếng Việt CÓ DẤU đầy đủ. NGHIÊM CẤM viết tiếng Việt không dấu.

Output là JSON array, không markdown, không code block:
[
  {
    "type": "action_item",
    "title": "Tiêu đề ngắn gọn (VD: Gọi kỹ thuật xử lý lỗi)",
    "description": "Mô tả chi tiết: tin nhắn nào từ ai, nội dung gì, cần làm gì",
    "sourceSender": "Người gửi tin nhắn",
    "sourceChatName": "Nhóm chat",
    "sourceMessage": "Nội dung tin nhắn gốc (gốc, không tóm tắt)",
    "actionLabel": "Hành động đề xuất (VD: Gọi kỹ thuật, Lên template nghiệm thu)"
  }
]

Nếu không có gì cần PM xử lý, trả về: []`;
}

export async function POST(req: Request) {
  try {
    const { projectId, projectName, projectStatus, messages } = await req.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ ok: true, actions: [] });
    }

    if (!LLM_KEY || !LLM_BASE) {
      return NextResponse.json({ ok: true, actions: [] });
    }

    const stateId = matchDeploymentState(projectStatus || "");
    const systemPrompt = buildSystemPrompt(projectName || "Dự án", stateId);

    // Build compact message log — take last 50 messages
    const messageLog = messages
      .slice(-50)
      .map((m: any) => `[${m.sender || "Unknown"}] (${m.chatName || m.platform || "chat"}): ${(m.content || "").slice(0, 500)}`)
      .join("\n");

    const userPrompt = `Phân tích các tin nhắn sau đây của dự án "${projectName || "Dự án"}" (giai đoạn: ${stateId}) và xác định có cần PM xử lý gì không:\n\n${messageLog}`;

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
        max_tokens: 8192,
      }),
      signal: AbortSignal.timeout(120000),
    });

    if (!res.ok) {
      console.error(`[MonitorMessages] LLM returned ${res.status}`);
      return NextResponse.json({ ok: true, actions: [] });
    }

    const rawText = await res.text();
    const content = extractLLMContent(rawText);

    if (!content) {
      return NextResponse.json({ ok: true, actions: [] });
    }

    // Parse JSON array from response
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const actions = JSON.parse(jsonMatch[0]);
        return NextResponse.json({
          ok: true,
          actions: Array.isArray(actions) ? actions : [],
        });
      }
    } catch {}

    return NextResponse.json({ ok: true, actions: [] });
  } catch (err) {
    console.error("[MonitorMessages] Error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 }
    );
  }
}
