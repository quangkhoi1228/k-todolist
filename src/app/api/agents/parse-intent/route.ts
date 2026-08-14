import { NextRequest, NextResponse } from "next/server";
import { toPoliteSendBody } from "../../../../../agents/pm/lib/intent-parser";

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
    const { text, history, contextProject, members, groups } = await req.json();

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

    // ── Member & group context cho send_message ──
    let memberGroupHint = "";
    if (Array.isArray(members) && members.length > 0) {
      memberGroupHint += `\n\n**DANH SÁCH THÀNH VIÊN dự án hiện tại:**`;
      for (const m of members) {
        memberGroupHint += `\n- ${m.name} (vai trò: ${m.roleName}${m.email ? `, email: ${m.email}` : ""})`;
      }
      memberGroupHint += `\nQUAN TRỌNG (send_message): Khi PM muốn gửi tin nhắn đến 1 NGƯỜI (vd "nhắn cho Kang Chan"), hãy:`;
      memberGroupHint += `\n1. Tìm tên người đó trong danh sách thành viên trên. Nếu tìm thấy → điền "memberName" = tên đúng (như trong danh sách).`;
      memberGroupHint += `\n2. Xác định vai trò (roleName): nếu là "Khách hàng" → tin nhắn gửi vào nhóm KHÁCH HÀNG (type=customer); nếu là vai trò khác (Sale, PM, Pre-sale, Tech...) → gửi vào nhóm NỘI BỘ (type=internal).`;
      memberGroupHint += `\n3. Đồng thời điền "chatName" = tên nhóm phù hợp (từ danh sách nhóm bên dưới) nếu tìm thấy, hoặc để trống "chatName" (UI sẽ xử lý).`;
      memberGroupHint += `\n4. Nếu KHÔNG tìm thấy tên người trong danh sách → vẫn điền "memberName" = tên người dùng nhắc tới, để trống "chatName", và "reply" gợi ý hỏi lại PM.`;
      memberGroupHint += `\nQUAN TRỌNG (send_email): Khi PM muốn GỬI EMAIL đến 1 NGƯỜI (vd "gửi email cho Kang Chan"):`;
      memberGroupHint += `\n1. Tìm tên trong danh sách thành viên. Nếu có email → điền "emailTo" = [email đó], "memberName" = tên đúng.`;
      memberGroupHint += `\n2. Nếu tìm thấy người nhưng KHÔNG có email → vẫn action=send_email, điền "memberName", để "emailTo" = [] (UI sẽ hỏi lại).`;
      memberGroupHint += `\n3. Nếu PM ghi rõ địa chỉ (abc@gmail.com) → dùng đúng địa chỉ đó cho "emailTo", không cần bịa.`;
    }
    if (Array.isArray(groups) && groups.length > 0) {
      memberGroupHint += `\n\n**DANH SÁCH NHÓM của dự án hiện tại:**`;
      for (const g of groups) {
        memberGroupHint += `\n- ${g.name} (loại: ${g.type === "customer" ? "khách hàng" : "nội bộ"}, nền tảng: ${g.platform || "teams"})`;
      }
      memberGroupHint += `\nQUAN TRỌNG (send_message): Khi PM nhắc tên nhóm, hãy lấy CHÍNH XÁC tên từ danh sách trên điền vào "chatName".`;
    }
    contextHint += memberGroupHint;

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
7. "send_message" - PM muon GUI TIN NHAN (mess, message, tn) den mot nhom/chat tren Teams hoac Zalo
8. "send_email" - PM muon GUI EMAIL (thu, mail) den mot dia chi email cu the

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

Chi tiet send_message (GUI TIN NHAN Teams/Zalo):
- "gui tin nhan", "nhắn", "gui mess", "send message" den 1 nhom/chat => action=send_message.
- Truong "platform" chi nhan 1 trong 2 gia tri: "teams" hoac "zalo" (mac dinh "teams" neu khong ro).
- Truong "chatName" la TEN NHOM/CHAT day du (vi du "[FPT Cloud] Triển khai dự án Domesco HKT"). Lay dung ten nhom PM nhac toi.
- Neu PM nhac den TEN 1 NGUOI (vi du "nhắn cho Kang Chan", "gửi cho anh A") chu khong phai ten nhom => dung truong "memberName" (ten nguoi), de trong "chatName" (agent se tu tim nhom phu hop).
- Neu ca hai: nhac ca ten nguoi va ten nhom => dien ca "memberName" va "chatName".
- Truong "messageBody" la NOI DUNG tin se GUI DI — PHAI LICH SU, KHONG copy 100% cau lenh/cau noi thô cua PM.
  * Xung ho "Bên em" (khong dung "toi", khong gui nguyen van "hello"/"say hello"/"tạo ticket").
  * Van nho va, de chiu: "bên em nhờ anh/chị ... giúp ạ", "giúp bên em nhé".
  * Chao dung ten nguoi nhan neu biet (anh/chị + ten). Ket thuc bang "ạ".
  * Giu Y DINH (PM muon noi gi) nhung dien giai lai cho nguoi nhan de doc.
  VD: PM noi "gửi Zalo cho Kang Chan say hello" => messageBody="Chào anh Kang Chan, bên em gửi lời chào ạ."
  VD: PM noi "nhắn Hung nhớ tạo ticket gia hạn" => messageBody="Chào anh Hung ơi, bên em nhờ anh tạo ticket gia hạn giúp ạ."
- Neu thieu chatName va memberName => van action=send_message nhung de trong cac truong do (UI se hoi lai).
- "reply" phai tom tat: gui den nhom nao (hoac nguoi nao), tren platform nao, noi dung gi.

Chi tiet send_email (GUI EMAIL):
- "gui email", "gui thu", "send mail", "gui mail" den 1 dia chi email HOAC 1 NGUOI => action=send_email.
- Truong "emailTo" la MANG cac dia chi email (vi du ["abc@gmail.com"]). Lay dung email PM nhac toi.
- Neu PM nhac TEN 1 NGUOI (vd "gui email cho Kang Chan") chu khong ghi dia chi: dien "memberName", va neu co email trong danh sach thanh vien thi dien "emailTo".
- Truong "emailSubject" la TIEU DE email (neu co). Neu khong co => soan tieu de lich su ngan gon theo y dinh.
- Truong "emailBody" la NOI DUNG email — cung PHAI LICH SU nhu tin nhan: xung "Bên em", van nho va, KHONG copy nguyen van cau lenh PM.
  VD: PM noi "gửi mail Hung nội dung nhớ tạo ticket" => emailBody="Chào anh Hung,\n\nBên em nhờ anh tạo ticket giúp ạ.\n\nTrân trọng."
- Neu thieu emailTo => van action=send_email nhung de trong (UI se hoi lai).
- "reply" phai tom tat: gui den ai, tieu de gi, noi dung gi.

Output CHI la JSON, VD: { "action": "chat", "ticketId": null, "projectQuery": null, "reply": "Xin chào! Tôi có thể giúp gì cho bạn?", "confidence": 1.0 }
VD add_task: { "action": "add_task", "ticketId": null, "projectQuery": null, "reply": "Tôi sẽ tạo 3 task cho dự án: ...", "confidence": 1.0, "tasks": [ { "title": "Chuẩn bị môi trường", "priority": "high" }, { "title": "Triển khai migration", "detail": "Chạy script migration dữ liệu" } ] }
VD add_task co han: { "action": "add_task", "ticketId": null, "projectQuery": null, "reply": "Tôi sẽ tạo 2 task: Chuẩn bị SoW (hạn mai) và Lấy yêu cầu #1 (hạn hôm nay).", "confidence": 1.0, "tasks": [ { "title": "Chuẩn bị SoW", "dueDate": "tomorrow" }, { "title": "Lấy yêu cầu #1", "dueDate": "today" } ] }
VD add_task chi co ten: { "action": "add_task", "ticketId": null, "projectQuery": null, "reply": "Tôi sẽ tạo task: Kiểm tra bảo mật hệ thống.", "confidence": 1.0, "tasks": [ { "title": "Kiểm tra bảo mật hệ thống" } ] }
VD send_message: { "action": "send_message", "ticketId": null, "projectQuery": null, "reply": "Tôi sẽ gửi tin nhắn đến nhóm [FPT Cloud] trên Teams.", "confidence": 1.0, "platform": "teams", "chatName": "[FPT Cloud] Triển khai dự án Domesco", "messageBody": "Chào anh/chị, bên em đã nhận yêu cầu, đội triển khai sẽ liên hệ sớm ạ." }
VD send_message cho 1 nguoi: { "action": "send_message", "ticketId": null, "projectQuery": null, "reply": "Tôi sẽ gửi tin nhắn đến Kang Chan.", "confidence": 1.0, "platform": "zalo", "memberName": "Kang Chan", "messageBody": "Chào anh Kang Chan, bên em gửi lời chào ạ." }
VD send_email: { "action": "send_email", "ticketId": null, "projectQuery": null, "reply": "Tôi sẽ gửi email đến test@gmail.com với tiêu đề Test.", "confidence": 1.0, "emailTo": ["test@gmail.com"], "emailSubject": "Bên em xin gửi thông tin", "emailBody": "Chào anh/chị,\n\nBên em xin gửi thông tin ạ.\n\nTrân trọng." }
VD send_email cho 1 nguoi: { "action": "send_email", "ticketId": null, "projectQuery": null, "reply": "Tôi sẽ gửi email đến Kang Chan.", "confidence": 1.0, "memberName": "Kang Chan", "emailTo": ["kang@example.com"], "emailSubject": "Bên em xin gửi thông tin", "emailBody": "Chào anh Kang Chan,\n\nBên em xin gửi lời chào ạ.\n\nTrân trọng." }`;

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
      const memberName = typeof parsed.memberName === "string" ? parsed.memberName : undefined;
      const action = (parsed.action as string) || "chat";
      return NextResponse.json({
        action,
        ticketId: parsed.ticketId || null,
        projectQuery: parsed.projectQuery ?? null,
        reply: parsed.reply || "",
        confidence: parsed.confidence || 0,
        tasks: tasks ?? null,
        platform: parsed.platform ?? undefined,
        chatName: parsed.chatName ?? undefined,
        messageBody: action === "send_message"
          ? toPoliteSendBody(typeof parsed.messageBody === "string" ? parsed.messageBody : undefined, memberName)
          : parsed.messageBody ?? undefined,
        memberName,
        emailTo: Array.isArray(parsed.emailTo) ? parsed.emailTo : undefined,
        emailSubject: parsed.emailSubject ?? undefined,
        emailBody: action === "send_email"
          ? toPoliteSendBody(typeof parsed.emailBody === "string" ? parsed.emailBody : undefined, memberName)
          : parsed.emailBody ?? undefined,
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
