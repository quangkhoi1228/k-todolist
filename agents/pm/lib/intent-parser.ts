/**
 * Natural Language Intent Parser for PM Agent
 *
 * Phan tich cau noi tieng Viet cua PM de hieu y dinh va trich xuat thong tin.
 * Khong dung AI, chi dung pattern matching + keyword.
 */

export interface ParsedIntent {
  action: "create_project" | "lookup_ticket" | "add_personnel" | "create_meeting" | "update_sow" | "view_project" | "goto_project" | "add_task" | "chat";
  confidence: number; // 0-1
  ticketId?: string;
  entities: Record<string, string>;
  tasks?: Array<{ title: string; detail?: string; priority?: string }>;
  original: string;
}

// ─── Keywords cho tung hanh dong ─────────────────────────

const KEYWORDS: Record<string, { action: ParsedIntent["action"]; weight: number; patterns: RegExp[] }> = {
  create_project: {
    action: "create_project",
    weight: 2,
    patterns: [
      /(?:tao|mo|khoi tao|bat dau)(?:\s*du an|\s*project)?(?:\s*m(?:ơ|o) i)?/i,
      /tiep nhan ticket/i,
      /nh(?:ậ|a)n (?:du an|project)/i,
      /deploy(?:\s*(?:project|du an))?/i,
      /trien khai(?:\s*(?:du an|project))?/i,
    ],
  },
  lookup_ticket: {
    action: "lookup_ticket",
    weight: 1.5,
    patterns: [
      /(?:xem|lay|tra|hien thi|show|get|fetch|check|k(?:iê|e) m tra)(?:\s*thong tin)?(?:\s*ticket)?/i,
      /th(?:ô|o)ng tin (?:cua |ve )?ticket/i,
      /ticket (?:n(?:à|a)y|do|tren)/i,
      /\bis[dt]\s*-?\d+/i,
    ],
  },
  add_personnel: {
    action: "add_personnel",
    weight: 1.5,
    patterns: [
      /(?:them|add|bo sung|cap nhat)(?:\s*nhan su|personnel|nguoi|thanh vien)/i,
      /xin nhan su/i,
      /phan cong/i,
      /giao viec/i,
      /(?:pic|support|assign)/i,
    ],
  },
  create_meeting: {
    action: "create_meeting",
    weight: 1.5,
    patterns: [
      /(?:tao|dat|sap|to chuc|organize)(?:\s*meeting|kickoff|hop|cuoc hop)/i,
      /kickoff/i,
      /hop kickoff/i,
      /len lich hop/i,
    ],
  },
  update_sow: {
    action: "update_sow",
    weight: 1.5,
    patterns: [
      /(?:sow|so(w|w))/i,
      /cap nhat sow/i,
      /soan thao sow/i,
      /gui sow/i,
      /review sow/i,
      /khach hang (?:duyet|dong y|review)/i,
    ],
  },
  view_project: {
    action: "view_project",
    weight: 1,
    patterns: [
      /(?:xem|mo|show)(?:\s*du an|project)/i,
      /du an (?:nay|do|hi(?:ê|e)n tai)/i,
      /tien do du an/i,
      /trang thai du an/i,
    ],
  },
  goto_project: {
    action: "goto_project",
    weight: 2,
    patterns: [
      /(?:chuy(?:ê|e)n\s*(?:sang|den|qua|toi|di|h(?:ư|u)ong)|den|tim\s*(?:den|ki(?:ê|e)m)?|mo)\s*(?:du an|project)/i,
      /(?:chuy(?:ê|e)n|den|mo|tim)\s+.*(?:du an|project)/i,
    ],
  },
  add_task: {
    action: "add_task",
    weight: 2.2,
    patterns: [
      /(?:tao|them|them moi|tach|chia|note? lai|ghi lai|rut ra|sinh)\s+(?:\d+\s+)?(?:tasks|cong viec|viec|nhiem vu|hu(?:y|u)?dong|deployment tasks|to do|todo|task)\b/i,
      /them\s+(?:nhieu\s+)?task/i,
      /sinh\s+task/i,
      /chia\s+nho\s+(?:cong viec|task)/i,
      /tao\s+to[- ]?do/i,
    ],
  },
};

// ─── Ticket ID Extractor ─────────────────────────────────

// Match ISD-xxxxx, ISDxxxxx, ISD xxxxx from ANY text (URL or not)
const TICKET_PATTERN = /ISD[-\s]?(\d+)/i;

function extractTicketId(text: string): string | undefined {
  const match = text.match(TICKET_PATTERN);
  if (match) return `ISD-${match[1]}`;
  return undefined;
}

// ─── Main Parser ─────────────────────────────────────────

export function parseIntent(text: string): ParsedIntent {
  // Bản gốc (giữ dấu) dùng để trích xuất title/nội dung task
  const trimmed = text.trim();
  // Bản normalize bỏ dấu dùng cho pattern match (regex không dấu)
  const normText = trimmed
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d");
  let bestAction: ParsedIntent["action"] = "chat";
  let bestScore = 0;
  const entities: Record<string, string> = {};

  // Ticket ID luon duoc extract neu co
  const ticketId = extractTicketId(trimmed);

  // Neu co ticket ID + khong co action cu the -> lookup
  for (const [, rule] of Object.entries(KEYWORDS)) {
    for (const pattern of rule.patterns) {
      if (pattern.test(normText)) {
        const score = rule.weight;
        if (score > bestScore) {
          bestScore = score;
          bestAction = rule.action;
        }
        break;
      }
    }
  }

  // Fallback: neu co ticket ID ma khong co action -> lookup
  if (bestAction === "chat" && ticketId) {
    bestAction = "lookup_ticket";
    bestScore = 0.8;
  }

  // Fallback: neu co ca ticket + create -> create_project
  if (bestAction === "lookup_ticket" && ticketId) {
    // Kiem tra lai xem co tu "tao" khong
    if (/tao|mo|khoi tao|bat dau|tiep nhan/i.test(normText)) {
      bestAction = "create_project";
      bestScore = 2;
    }
  }

  // Trich xuat entities bo sung
  if (/nhan su|personnel|nguoi|ai|ten/i.test(normText)) {
    // Try to extract names
    const nameMatch = normText.match(/(?:la |ten |them |add )\s*([A-Za-z]+(?:\s+[A-Za-z]+)+)/);
    if (nameMatch) entities["person_name"] = nameMatch[1].trim();
  }

  if (/meeting|hop|kickoff/i.test(normText)) {
    const dateMatch = normText.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
    if (dateMatch) entities["meeting_date"] = `${dateMatch[1]}/${dateMatch[2]}`;
  }

  // ─── add_task: tách từng dòng thành 1 task ──────────────
  let tasks: ParsedIntent["tasks"];
  if (bestAction === "add_task" || /(?:task|cong viec|nhiem vu|huy dong)/i.test(normText)) {
    tasks = [];
    for (const line of trimmed.split(/\r?\n/)) {
      // Bỏ bullet/số prefix, giữ nguyên dấu cho title
      const t = line.replace(/^[\s>•\-*•·◦▪\d\.\)]+/, "").trim();
      if (!t) continue;
      // Bản không-dấu cho test prefix (regex không dấu), title vẫn giữ bản gốc
      const tNorm = t
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .replace(/Đ/g, "d");
      // Dòng lệnh mở đầu: "Tạo task:" / "Thêm 2 task:" — nếu có nội dung sau ":" thì dùng làm title task đầu
      const cmdBody = tNorm.match(/^(?:tao|them|them moi|tach|chia|note? lai|ghi lai|rut ra|sinh)\s+(?:\d+\s+)?(?:task|tasks|cong viec|viec|nhiem vu|hu(?:y|u)?dong|deployment tasks|to do|todo|hu(?:y|u) dong|deployment)\s*(?:cho du an|cho project)?\s*[: ]+\s*(.+)$/i);
      if (cmdBody) {
        const rest = t.slice(t.indexOf(":") + 1).trim();
        if (!rest) continue; // không có nội dung → bỏ dòng lệnh
        // Nội dung sau ":" có thể là nhiều task (phẩy/và) — xử lý như body
        const commaParts2 = rest.split(/[,;]+(?:\s*(?:và|va)\s*)?/).map((p) => p.trim()).filter(Boolean);
        if (commaParts2.length > 1 && rest.length < 300) {
          for (const part of commaParts2) tasks.push({ title: part });
          continue;
        }
        const andMatch2 = rest.match(/^(.*?)\s+(?:và|va)\s+(.+)$/);
        if (andMatch2 && rest.length < 200) {
          tasks.push({ title: andMatch2[1].trim() });
          tasks.push({ title: andMatch2[2].trim() });
          continue;
        }
        tasks.push({ title: rest });
        continue;
      }
      if (/^(?:task|cong viec|nhiem vu|hu(?:y|u) dong|deployment|to do|todo)\s*[: ]*\s*$/i.test(t)) {
        continue; // header
      }
      // Bỏ cụm lệnh đầu dòng (vd "Thêm 2 task: A, B" → "A, B")
      const body = t
        .replace(/^(?:tao|them|them moi|tach|chia|note? lai|ghi lai|rut ra|sinh)\s+(?:\d+\s+)?(?:task|tasks|cong viec|viec|nhiem vu|hu(?:y|u)?dong|deployment tasks|to do|todo|hu(?:y|u) dong|deployment)\s*(?:cho du an|cho project)?\s*[: ]+\s*/i, "")
        .trim();
      if (!body) continue;
      // Nếu body có dấu phẩy và không phải "A, B và C" trong detail → tách từng task
      const commaParts = body.split(/[,;]+(?:\s*(?:và|va)\s*)?/).map((p) => p.trim()).filter(Boolean);
      if (commaParts.length > 1 && body.length < 300) {
        for (const part of commaParts) {
          tasks.push({ title: part });
        }
        continue;
      }
      // Tách "A và B" (2 task gần nhau)
      const andMatch = body.match(/^(.*?)\s+(?:và|va)\s+(.+)$/);
      if (andMatch && body.length < 200) {
        tasks.push({ title: andMatch[1].trim() });
        tasks.push({ title: andMatch[2].trim() });
        continue;
      }
      // Tách detail nếu có ":" xuất hiện lần đầu (vd "Task: chi tiết")
      const sep = body.indexOf(":");
      if (sep > 0 && sep < 120) {
        const head = body.slice(0, sep).trim();
        if (head.length <= 80) {
          tasks.push({ title: head, detail: body.slice(sep + 1).trim() || undefined });
          continue;
        }
      }
      tasks.push({ title: body });
    }
    if (tasks.length === 0) tasks = undefined;
  }

  return {
    action: bestAction,
    confidence: bestScore / 2, // normalize to 0-1
    ticketId,
    entities,
    tasks,
    original: trimmed,
  };
}

// ─── Response Generator ─────────────────────────────────

export function generateAgentResponse(intent: ParsedIntent, context?: { projectName?: string; ticketSummary?: string }): string {
  switch (intent.action) {
    case "create_project":
      if (intent.ticketId) {
        return `Tôi sẽ tạo dự án từ ticket **#${intent.ticketId}**. Đang đồng bộ thông tin từ ISD...`;
      }
      return `Vui lòng cung cấp số ticket ISD. VD: "Tạo dự án từ ticket ISD-90335"`;

    case "lookup_ticket":
      if (intent.ticketId) {
        return `Đang tra cứu thông tin ticket **#${intent.ticketId}** từ ISD...`;
      }
      return `Vui lòng cho tôi số ticket cần xem. VD: "Xem ticket ISD-90335"`;

    case "add_personnel":
      return `Tôi sẽ giúp bạn thêm nhân sự vào dự án. Vui lòng cho thông tin: tên, email, team, vai trò (PIC/Support).`;

    case "create_meeting":
      return `Tôi sẽ giúp bạn tạo meeting kickoff. Cần chuẩn bị: ngày, giờ, danh sách thành viên tham gia, agenda.`;

    case "update_sow":
      return `Tôi sẽ giúp cập nhật SOW. Hiện tại SOW đang ở trạng thái: **${context?.projectName || "Chờ xử lý"}**`;

    case "view_project":
      return `Dự án **${context?.projectName || "hiện tại"}** đang được quản lý.`;

    case "add_task":
      if (intent.tasks && intent.tasks.length > 0) {
        return `Tôi sẽ tạo **${intent.tasks.length} task** cho dự án. Kiểm tra lại trước khi xác nhận nhé.`;
      }
      return `Bạn muốn tạo task cho dự án nào? Kể tên dự án và nội dung task (mỗi dòng 1 task).`;

    case "goto_project":
      return `Đang tìm dự án **${intent.ticketId || intent.original.replace(/chuyển\s*(?:sang|đến|qua|tới|đi)\s+|đến\s+|tìm\s+/i, "").trim() || "..."}**.`;

    default:
      return `Tôi đã nhận được tin nhắn của bạn. Tôi có thể giúp:
- Tạo dự án từ ticket ISD
- Xem thông tin ticket
- Thêm nhân sự triển khai
- Tạo meeting kickoff
- Cập nhật SOW

Bạn muốn làm gì?`;
  }
}
