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

  // Ưu tiên object chứa "action" (tránh bắt nhầm JSON lồng trong reply)
  const actionObjMatch = text.match(/\{"action"\s*:\s*"[^"]+"[\s\S]*?\}/);
  if (actionObjMatch) {
    try {
      const parsed = JSON.parse(actionObjMatch[0]);
      if (parsed && typeof parsed.action === "string") {
        return { parsed, rawContent: null };
      }
    } catch {}
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

/**
 * Quy đổi dueDate từ LLM (dạng tương đối "today"/"tomorrow"/"+N" hoặc ngày cụ thể "YYYY-MM-DD")
 * về ngày thực tế theo giờ máy chủ. Trả "YYYY-MM-DD" hoặc undefined (không xác định).
 */
function resolveDueDate(raw: unknown): string | undefined {
  const s = String(raw ?? "").trim().toLowerCase();
  if (!s) return undefined;

  const base = new Date();
  base.setHours(0, 0, 0, 0);
  const addDays = (days: number) => {
    const d = new Date(base);
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  if (s === "today" || s === "hom nay" || s === "hôm nay") return addDays(0);
  if (s === "tomorrow" || s === "mai" || s === "ngay mai" || s === "ngày mai") return addDays(1);
  const plusMatch = s.match(/^\+(\d+)$/);
  if (plusMatch) return addDays(Number(plusMatch[1]));

  // Ngày cụ thể dạng YYYY-MM-DD (hoặc DD/MM/YYYY)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T00:00:00`);
    return isNaN(d.getTime()) ? undefined : s;
  }
  const vnMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/);
  if (vnMatch) {
    const dd = Number(vnMatch[1]);
    const mm = Number(vnMatch[2]);
    const yyyy = vnMatch[3] ? Number(vnMatch[3]) : base.getFullYear();
    const d = new Date(yyyy, mm - 1, dd);
    if (isNaN(d.getTime())) return undefined;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return undefined;
}

/**
 * Trích xuất mốc ngày tương đối từ CHÍNH CÂU GỐC của user (không tin LLM tính ngày):
 * - "hôm nay" → today; "ngày mai"/"mai" → tomorrow; "tuần sau" → +7; "N ngày nữa" → +N
 * - Ngày cụ thể "20/08", "20/08/2026", "20-08-2026" → YYYY-MM-DD
 * Trả chuỗi dạng tương đối chuẩn (sẽ đưa qua resolveDueDate) hoặc undefined.
 */
function extractRelativeDueDate(rawText: string): string | undefined {
  const t = String(rawText ?? "").toLowerCase();
  const base = new Date();
  base.setHours(0, 0, 0, 0);

  const m = t.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
      const yyyy = m[3] ? Number(m[3]) : base.getFullYear();
      const d = new Date(yyyy, mm - 1, dd);
      if (!isNaN(d.getTime())) {
        // Ngày cụ thể hợp lệ — trả thẳng dạng chuẩn
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      }
    }
  }

  // "N ngày nữa" / "trong N ngày" — ưu tiên, trước "mai" (vd "3 ngày nữa")
  const nd = t.match(/(\d+)\s*(?:ngay|ngày)\s*(?:nua|nữa)/);
  if (nd) return `+${Number(nd[1])}`;

  if (/\btu(?:â|a)n\s+sau\b|tuần tới/.test(t) || /tuan sau|tuan toi/.test(t)) return "+7";
  if (/\b(?:s|sa)ng\s+mai\b|ngày mai|ngay mai|\bmai\b/.test(t)) return "tomorrow";
  if (/\bh(?:ô|o)m\s+nay\b|hôm nay|hom nay/.test(t)) return "today";
  return undefined;
}

/**
 * Chọn dueDate cuối cho 1 task:
 * 1. Nếu task có mốc ngày riêng (LLM trả dueDate hợp lệ, không quá khứ) → dùng mốc đó.
 * 2. Nếu task không có mốc riêng → dùng mốc chung của câu (relativeDue, đã resolve).
 * 3. Mốc LLM bịa ra ngày QUÁ KHỨ (trước hôm nay) → coi như lỗi, fallback mốc chung (hoặc bỏ).
 */
function pickDueDate(
  taskDue: unknown,
  relativeDue: string | undefined,
  todayStr: string
): string | undefined {
  const resolved = resolveDueDate(taskDue);
  if (resolved) {
    // Loại ngày bịa quá khứ (nhưng vẫn cho phép hôm nay)
    if (resolved >= todayStr) return resolved;
    return relativeDue ?? undefined;
  }
  return relativeDue;
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

    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const weekdayStr = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"][today.getDay()];
    let dateHint = `\n\n**NGÀY HÔM NAY (theo máy chủ):** ${todayStr} (${weekdayStr}).`;
    dateHint += `\nQUAN TRỌNG (tính ngày hạn task): KHÔNG tự bịa ngày cụ thể. Người dùng nói "hôm nay"/"ngày mai"/"mai"/"tuần sau"/"+N ngày"... — trong field "dueDate" hãy trả dạng TƯƠNG ĐỐI đúng nghĩa, KHÔNG quy đổi thành ngày cụ thể:`;
    dateHint += `\n- "hạn hôm nay" / "hôm nay" / "cuối ngày hôm nay" => "today"`;
    dateHint += `\n- "hạn ngày mai" / "mai" / "sáng mai" => "tomorrow"`;
    dateHint += `\n- "tuần sau" / "cuối tuần sau" => "+7"`;
    dateHint += `\n- "3 ngày nữa" / "trong 3 ngày" => "+3"`;
    dateHint += `\n- "hạn 20/8", "20/08/2026", "20-08" => trả đúng ngày cụ thể dạng "YYYY-MM-DD"`;
    dateHint += `\n- KHÔNG ghi "dueDate" (bỏ trống) nếu người dùng không nói hạn.`;
    dateHint += `\nServer sẽ tự quy đổi "today"/"tomorrow"/"+N" sang ngày thực tế.`;

    const systemPrompt = `Ban la PM Agent - tro ly quan ly du an.${contextHint}${dateHint}
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
6. "add_task" - PM muon TAO/THÊM TASK (cong viec, nhiem vu, huy dong, to-do) cho MOT DU AN cu the

Chi tiet:
- "tao du an moi" + ISD-xxxxx => action=create_project, ticketId="ISD-xxxxx"
- "tao du an moi" khong co ISD => action=create_project, ticketId=null
- "xem ticket" + ISD-xxxxx => action=lookup_ticket
- "chuyen den" / "den du an" / "tim du an" => action=goto_project, projectQuery="ten hoac ma"
- "tạo task", "them task", "them cong viec", "tao to-do", "sinh task", "tach task" (ke kem noi dung cong viec) => action=add_task.
  KHI action=add_task, BAT BUOC tach cac task trong yeu cau thanh danh sach JSON truong "tasks":
  - Moi task: { "title": "tieu de", "detail": "mo ta chi tiet (neu co)", "priority": "low|normal|high", "pic": "ten nguoi phu trach (neu co)", "support": "ten nguoi ho tro (neu co)", "dueDate": "today|tomorrow|+N|YYYY-MM-DD (neu co)", "manday": <so ngay cong, neu co> }
  - QUAN TRONG: Chi can co "title" la task HOP LE. Thieu detail/priority/pic/support/dueDate/manday KHONG sao — de trong (hoac bo truong day) va VAN tao task bang title do.
  - QUAN TRONG: "dueDate" phai tuan thu quy tac NGAY HOM NAY o tren: "hạn hôm nay" => "today", "hạn ngày mai"/"mai" => "tomorrow", "tuần sau" => "+7", "N ngày nữa" => "+N"; CHI ghi ngay cu the "YYYY-MM-DD" khi nguoi dung ghi ro ngay. KHONG tu bia ngay cu the.
  - Neu yeu cau chi noi "tao task" ma CHUA co TEN task nao => van action=add_task nhung "tasks": [] (UI se hoi du an + noi dung).
  - Neu yeu cau CHI la hoi thi xem task the nao (vd "xem task", "task dang chay ra sao") => action=chat.
  - "reply" phai tom tat so task va noi dung moi task dang ngan gon.

Output CHI la JSON, VD: { "action": "chat", "ticketId": null, "projectQuery": null, "reply": "Xin chào! Tôi có thể giúp gì cho bạn?", "confidence": 1.0 }
VD add_task: { "action": "add_task", "ticketId": null, "projectQuery": null, "reply": "Tôi sẽ tạo 3 task cho dự án: ...", "confidence": 1.0, "tasks": [ { "title": "Chuẩn bị môi trường", "priority": "high" }, { "title": "Triển khai migration", "detail": "Chạy script migration dữ liệu" } ] }
VD add_task co han: { "action": "add_task", "ticketId": null, "projectQuery": null, "reply": "Tôi sẽ tạo 2 task: Chuẩn bị SoW (hạn mai) và Lấy yêu cầu #1 (hạn hôm nay).", "confidence": 1.0, "tasks": [ { "title": "Chuẩn bị SoW", "dueDate": "tomorrow" }, { "title": "Lấy yêu cầu #1", "dueDate": "today" } ] }
VD add_task chi co ten: { "action": "add_task", "ticketId": null, "projectQuery": null, "reply": "Tôi sẽ tạo task: Kiểm tra bảo mật hệ thống.", "confidence": 1.0, "tasks": [ { "title": "Kiểm tra bảo mật hệ thống" } ] }`;

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
      const rawTasks = parsed.tasks;
      // Mốc ngày từ chính câu gốc của user — ưu tiên hơn ngày LLM tự bịa
      const relativeDue = extractRelativeDueDate(text);
      const tasks = Array.isArray(rawTasks) && rawTasks.length > 0
        ? rawTasks
            .map((t: any) => (typeof t === "string" ? { title: t } : t))
            .filter((t: any) => t && typeof t.title === "string" && t.title.trim())
            .map((t: any) => ({
              title: String(t.title).trim(),
              detail: typeof t.detail === "string" && t.detail.trim() ? String(t.detail).trim() : undefined,
              priority: ["low", "normal", "high"].includes(t.priority) ? t.priority : undefined,
              pic: typeof t.pic === "string" && t.pic.trim() ? String(t.pic).trim() : undefined,
              support: typeof t.support === "string" && t.support.trim() ? String(t.support).trim() : undefined,
              // Ưu tiên mốc riêng của task (LLM đã trả, resolve ra không quá khứ);
              // thiếu → mốc chung từ câu gốc; LLM bịa ngày quá khứ → thay bằng mốc chung
              dueDate: pickDueDate(t.dueDate, relativeDue, todayStr),
              manday: typeof t.manday === "number" && t.manday > 0 ? Number(t.manday) : undefined,
            }))
        : undefined;
      return NextResponse.json({
        action: parsed.action || "chat",
        ticketId: parsed.ticketId || null,
        projectQuery: parsed.projectQuery ?? null,
        reply: parsed.reply || "",
        confidence: parsed.confidence || 0,
        tasks: tasks ?? null,
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
