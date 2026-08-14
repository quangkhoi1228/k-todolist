/**
 * Natural Language Intent Parser for PM Agent
 *
 * Phan tich cau noi tieng Viet cua PM de hieu y dinh va trich xuat thong tin.
 * Khong dung AI, chi dung pattern matching + keyword.
 */

export interface ParsedIntent {
  action: "create_project" | "lookup_ticket" | "add_personnel" | "create_meeting" | "update_sow" | "view_project" | "goto_project" | "add_task" | "send_message" | "send_email" | "chat";
  confidence: number; // 0-1
  ticketId?: string;
  entities: Record<string, string>;
  tasks?: Array<{ title: string; detail?: string; priority?: string }>;
  // send_message
  platform?: "teams" | "zalo";
  chatName?: string;
  messageBody?: string;
  memberName?: string;
  // send_email
  emailTo?: string[];
  emailSubject?: string;
  emailBody?: string;
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
  send_message: {
    action: "send_message",
    weight: 2.5,
    patterns: [
      /(?:gui|gửi|send|noi?|nhắn)\s+(?:tin\s*nhan|mess(?:age)?|tn|loi\s*nhan|lời nhắn|tin)(?:\s*(?:vao|vào|den|đến|cho|to))?(?:\s*nhom|group|chat)?/i,
      /(?:nhắn|noi?|send)\s+(?:vao|vào|den|đến|cho)\s+(?:nhom|group|chat)\s*(teams|zalo)?/i,
      /(?:gửi|gui|send)\s+(?:vao|vào|den|đến|cho)\s+(teams|zalo)/i,
      /(?:nhắn|message).*(teams|zalo)/i,
    ],
  },
  send_email: {
    action: "send_email",
    weight: 2.5,
    patterns: [
      /(?:gui|gửi|send)\s*(?:email|mail|thu|thư|e-mail)(?:\s*(?:den|đến|cho|to))?/i,
      /(?:gui|gửi|send)\s+(?:den|đến|cho)\s+[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i,
      /(?:email|mail)\s*(?:den|đến|cho)\s+/i,
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}.*(?:gui|gửi|send)/i,
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

  // ─── send_message: trích platform, chatName, memberName, messageBody ───
  let platform: ParsedIntent["platform"] | undefined;
  let chatName: string | undefined;
  let messageBody: string | undefined;
  let memberName: string | undefined;

  if (bestAction === "send_message" || /\b(teams|zalo)\b/i.test(normText)) {
    const platMatch = normText.match(/\b(teams|zalo)\b/i);
    if (platMatch) {
      platform = platMatch[1].toLowerCase() as "teams" | "zalo";
      if (bestAction === "chat") bestAction = "send_message";
    }
  }

  if (bestAction === "send_message") {
    // Trích tên nhóm: sau "nhóm", "group", "chat", hoặc trong ngoặc vuông [...]
    // Ưu tiên tên có dấu: dùng bản gốc (trimmed)
    const namePatterns = [
      /nh(?:ó|o)m\s+(?:chat\s+)?[""\[\(]?([^\]"'\)\n,]{2,80})[""\]\)]?/i,
      /group\s+[""\[\(]?([^\]"'\)\n,]{2,80})[""\]\)]?/i,
      /chat\s+[""\[\(]?([^\]"'\)\n,]{2,80})[""\]\)]?/i,
      /\[([^\]\n]{2,80})\]/,
    ];
    for (const p of namePatterns) {
      const m = trimmed.match(new RegExp(p.source, p.flags));
      if (m && m[1]) {
        chatName = m[1].trim();
        break;
      }
    }
    // Nếu không tìm thấy tên nhóm cụ thể → dùng keyword sau "vào/đến/cho nhóm"
    if (!chatName) {
      const afterToGroup = trimmed.match(/(?:vao|vào|den|đến|cho)\s+(?:nhóm|group|chat)\s+(.+?)(?:\s*(?:voi|với|n(?:ôi|oi)\s*dung|n(?:ộ|o)i\s*dung|tin\s*nhan| nội\s*dung)\s*[: -])/i);
      if (afterToGroup && afterToGroup[1]) {
        const candidate = afterToGroup[1].replace(/\b(teams|zalo)\b/i, "").trim();
        if (candidate.length >= 2 && candidate.length <= 80) chatName = candidate;
      }
    }

    // Trích tên người: sau "cho [tên]" / "đến [tên]" / "gửi [tên]" (không có "nhóm")
    // Nếu đã có chatName rồi thì không cần memberName
    if (!chatName) {
      // Pattern: bắt tên (chữ cái + khoảng trắng, tối đa 3 từ) đứng trước dấu quote / "nội dung" / "rằng" / hết câu
      const personPatterns = [
        /(?:cho|den|đến)\s+(?:anh|chị|em|bạn)?\s*([A-ZÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ][a-zA-ZÀ-ỹ]+(?:\s+[A-ZÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ][a-zA-ZÀ-ỹ]+){0,2})\s+(?:qua|trên|tren)\s+(?:[Zz]alo|[Tt]eams)/,
        /(?:cho|den|đến|gui|gửi|nhắn)\s+(?:cho\s+)?(?:anh|chị|em|bạn|ông|bà|mr|mrs|ms)?\s*([A-ZÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ][a-zA-ZÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ\s]{1,60}?)(?=\s*['"]|\s*(?:n(?:ô|o)i\s*d(?:ụ|u)ng|nội\s*dung|rằng|noi\s*rằng|nói\s*rằng)\s*[:]?)/i,
        /(?:cho|den|đến|gui|gửi|nhắn)\s+(?:cho\s+)?(?:anh|chị|em|bạn|ông|bà|mr|mrs|ms)?\s*([A-ZÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ][a-zA-ZÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ]+(?:\s+[A-ZÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ][a-zA-ZÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ]+){0,2})$/,
      ];
      for (const p of personPatterns) {
        const m = trimmed.match(p);
        if (m && m[1]) {
          const candidate = m[1].trim().replace(/\s+(?:trên|tren|qua)\s+(?:teams|zalo)$/i, "").trim();
          if (candidate.length >= 2 && candidate.length <= 60 && !/tin\s*nhắn|qua\s+(?:zalo|teams)|nội\s*dung/i.test(candidate)) {
            memberName = candidate;
            break;
          }
        }
      }
    }

    // Trích nội dung tin nhắn: sau dấu ':' hoặc trong ngoặc kép
    const colonMatch = trimmed.match(/(?:n(?:ôi|oi)\s*dung|tin\s*nhan|l(?:ời|oi)\s*nhắn|mess(?:age)?)\s*:\s*([\s\S]+)$/i);
    if (colonMatch && colonMatch[1]) {
      messageBody = colonMatch[1].trim();
    } else {
      const quoteMatch = trimmed.match(/[""']([\s\S]+?)[""']/);
      if (quoteMatch && quoteMatch[1] && quoteMatch[1].length >= 2) {
        messageBody = quoteMatch[1].trim();
      }
    }
    // Nếu vẫn không có messageBody → lấy phần sau "rằng" / "nói rằng" / "là"
    if (!messageBody) {
      const rangMatch = trimmed.match(/(?:rằng|noi\s*rằng|nói\s*rằng|la\s*rằng|là\s*rằng|noi\s*la|nói\s*là|)\s*:\s*([\s\S]+)$/i);
      if (rangMatch && rangMatch[1] && rangMatch[1].trim().length >= 2) {
        messageBody = rangMatch[1].trim();
      }
    }
    // Nếu vẫn không có messageBody → lấy phần sau "rằng" / "nói rằng" (không có ":")
    if (!messageBody) {
      const rangMatch2 = trimmed.match(/(?:rang|rằng|noi\s*rang|nói\s*rằng)\s+([\s\S]+)$/i);
      if (rangMatch2 && rangMatch2[1] && rangMatch2[1].trim().length >= 2) {
        messageBody = rangMatch2[1].trim();
      }
    }
    // Phần còn lại sau "qua Zalo/Teams" (vd: "...qua Zalo say hello")
    if (!messageBody) {
      const afterPlat = trimmed.match(/\b(?:qua|trên|tren|on)\s+(?:zalo|teams)\s+(.+)$/i);
      if (afterPlat?.[1] && afterPlat[1].trim().length >= 2) {
        messageBody = afterPlat[1].trim().replace(/^[:\-–]\s*/, "");
      }
    }
  }

  // ─── send_email: trích emailTo, emailSubject, emailBody ───
  let emailTo: string[] | undefined;
  let emailSubject: string | undefined;
  let emailBody: string | undefined;

  if (bestAction === "send_email" || /@(?:[a-zA-Z0-9.-]+\.)[a-zA-Z]{2,}/.test(normText)) {
    // Trích tất cả email addresses
    const emailMatches = trimmed.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
    if (emailMatches && emailMatches.length > 0) {
      emailTo = [...new Set(emailMatches)];
      if (bestAction === "chat") bestAction = "send_email";
    }
  }

  if (bestAction === "send_email") {
    // Trích subject: sau "subject", "tiêu đề", "với tiêu đề", hoặc trong ngoặc kép đầu tiên (nếu không phải body)
    const subjPatterns = [
      /(?:subject|chu\s*de|chủ\s*đề|tie\s*de|tiêu\s*đ[eề])\s*:\s*([^,\n]+?)(?:\s*(?:noi\s*dung|nội\s*dung|body|vn?d)\s*[: -]|\s*$)/i,
      /(?:voi|với)\s+(?:chu\s*de|chủ\s*đề|tie\s*de|tiêu\s*đề|subject)\s*:\s*([^,\n]+?)(?:\s*(?:va|và)\s+(?:noi\s*dung|nội\s*dung|body)\s*:|\s*$)/i,
      /(?:voi|với)\s+(?:chu\s*de|chủ\s*đề|tie\s*de|tiêu\s*đề|subject)\s+(.+?)(?:\s*(?:va|và)\s+(?:noi\s*dung|nội\s*dung|body)\s*[: ]|\s*$)/i,
    ];
    for (const p of subjPatterns) {
      const m = trimmed.match(p);
      if (m && m[1]) {
        emailSubject = m[1].trim();
        // Cắt bỏ phần "và nội dung ..." nếu pattern không bắt được
        emailSubject = emailSubject.replace(/\s+(?:va|và)\s+(?:noi\s*dung|nội\s*dung|body)\s*:.+$/i, "").trim();
        break;
      }
    }
    if (!emailSubject) {
      const quoteMatch = trimmed.match(/[""']([\s\S]+?)[""']/);
      if (quoteMatch && quoteMatch[1] && quoteMatch[1].length >= 3) {
        emailSubject = quoteMatch[1].trim();
      }
    }

    // Trích body: sau "nội dung", "body", "nội dung:", "với nội dung:"
    const bodyPatterns = [
      /(?:noi\s*dung|nội\s*dung|body|vn?d)\s*:\s*([\s\S]+)$/i,
      /(?:voi|với)\s+(?:noi\s*dung|nội\s*dung|body)\s*:\s*([\s\S]+)$/i,
      /(?:va|và)\s+(?:noi\s*dung|nội\s*dung|body)\s*:\s*([\s\S]+)$/i,
      /(?:va|và)\s+(?:noi\s*dung|nội\s*dung|body)\s+([\s\S]+)$/i,
      /(?:noi\s*dung|nội\s*dung)\s+([\s\S]+)$/i,
    ];
    for (const p of bodyPatterns) {
      const m = trimmed.match(p);
      if (m && m[1]) {
        emailBody = m[1].trim();
        break;
      }
    }
    // Nếu không có keyword "nội dung" → lấy phần sau email address (+ subject nếu có)
    if (!emailBody) {
      const afterEmail = trimmed.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\s*([\s\S]+)$/);
      if (afterEmail && afterEmail[1] && afterEmail[1].trim().length >= 2) {
        // Loại bỏ keyword tiêu đề / subject nếu đã trích
        let remainder = afterEmail[1].trim()
          .replace(/(?:voi|với)\s+(?:chu\s*de|chủ\s*đề|tie\s*de|tiêu\s*đề|subject)\s*:\s*[\s\S]+?(?=\s*(?:noi\s*dung|nội\s*dung|body)\s*:|\s*$)/i, "")
          .replace(/(?:chu\s*de|chủ\s*đề|tie\s*de|tiêu\s*đề|subject)\s*:\s*[\s\S]+?(?=\s*(?:noi\s*dung|nội\s*dung|body)\s*:|\s*$)/i, "")
          .replace(/(?:voi|với)\s+(?:chu\s*de|chủ\s*đề|tie\s*de|tiêu\s*đề|subject)\s+[\s\S]+?(?=\s*(?:va|và)\s+(?:noi\s*dung|nội\s*dung|body)\s*:|\s*$)/i, "")
          .trim();
        // Loại bỏ dấu chấm câu đầu/cuối thừa
        remainder = remainder.replace(/^[,;.\s]+|[,;.\s]+$/g, "").trim();
        if (remainder.length >= 2) emailBody = remainder;
      }
    }

    // Trích tên người khi không có địa chỉ email tường minh
    if ((!emailTo || emailTo.length === 0) && !memberName) {
      const personPatterns = [
        /(?:cho|den|đến|gui|gửi)\s+(?:email|mail|thu|thư|e-mail)\s+(?:cho|den|đến|toi|tới)?\s*(?:anh|chị|em|bạn|ông|bà|mr|mrs|ms)?\s*([A-ZÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ][a-zA-ZÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ\s]{1,60}?)(?=\s+(?:voi|với|tieu|tiêu|chu\s*de|chủ|subject|noi|nội|body)|$)/i,
        /(?:email|mail|thu|thư)\s+(?:cho|den|đến)\s+(?:anh|chị|em|bạn)?\s*([A-ZÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ][a-zA-ZÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ\s]{1,60}?)(?=\s+(?:voi|với|tieu|tiêu|subject|noi|nội|body)|$)/i,
      ];
      for (const p of personPatterns) {
        const m = trimmed.match(p);
        if (m && m[1]) {
          const candidate = m[1].trim().replace(/\s+(?:voi|với|va|và).*$/i, "").trim();
          if (candidate.length >= 2 && candidate.length <= 60 && !/@/.test(candidate)) {
            memberName = candidate;
            break;
          }
        }
      }
    }
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
    platform,
    chatName,
    messageBody: bestAction === "send_message" ? toPoliteSendBody(messageBody, memberName) : messageBody,
    memberName,
    emailTo,
    emailSubject,
    emailBody: bestAction === "send_email" ? toPoliteSendBody(emailBody, memberName) : emailBody,
    original: trimmed,
  };
}

function politeAddressee(memberName?: string): string {
  const n = (memberName || "").trim();
  if (!n) return "anh/chị";
  if (/^(anh|chị|a)\s+/i.test(n)) return n;
  if (/@/.test(n) || /\d/.test(n)) {
    const first = n.split(/[\s@._-]+/)[0] || n;
    const nice = first.charAt(0).toUpperCase() + first.slice(1);
    return `anh ${nice}`;
  }
  return `anh ${n}`;
}

/** Tin đã lịch sự (xưng Bên em / nhờ vả) — không wrap thêm. */
export function isAlreadyPoliteSend(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return false;
  if (/bên em|kính gửi/i.test(t)) return true;
  // Đã là lời chào hoàn chỉnh — không wrap thêm lần nữa
  if (/^(chào|hi\s)/i.test(t) && t.length > 20) return true;
  return false;
}

/**
 * Viết lại nội dung gửi chat/mail cho lịch sự: xưng "Bên em", văn nhờ vả.
 * Không gửi nguyên câu lệnh thô của PM (vd "say hello", "tạo ticket").
 */
export function toPoliteSendBody(raw?: string, memberName?: string): string | undefined {
  const text = (raw || "").trim().replace(/^["“«]|["”»]$/g, "").trim();
  if (!text) return undefined;
  if (isAlreadyPoliteSend(text)) return text;
  const you = politeAddressee(memberName);
  if (/^(hi|hello|hey|xin chào|chào|say hello)\b/i.test(text) && text.length < 40) {
    return `Chào ${you}, bên em gửi lời chào ạ.`;
  }
  const inner = text.charAt(0).toLowerCase() + text.slice(1);
  const isRequest =
    /^(?:nhớ|nho|hãy|vui lòng|làm ơn|tạo|tao|gửi|gui|add|check|xác nhận|làm|hỗ trợ|ho tro|nhờ)/i.test(text)
    || /\b(?:giúp|giup|nhé|nhe)\b/i.test(text);
  if (isRequest) {
    return `Chào ${you} ơi, bên em nhờ ${you} ${inner.replace(/\.+$/, "")} giúp ạ.`;
  }
  return `Chào ${you}, bên em ${inner.replace(/\.+$/, "")} ạ.`;
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

    case "send_message": {
      const plat = intent.platform ? intent.platform.toUpperCase() : "Teams/Zalo";
      const grp = intent.chatName ? `nhóm **${intent.chatName}**` : "nhóm";
      const msgPreview = intent.messageBody ? `: "${intent.messageBody.slice(0, 80)}${intent.messageBody.length > 80 ? "..." : ""}"` : "";
      return `Tôi sẽ gửi tin nhắn đến ${grp} trên ${plat}${msgPreview}. Vui lòng xác nhận trước khi gửi.`;
    }

    case "send_email": {
      const to = intent.emailTo && intent.emailTo.length > 0 ? intent.emailTo.join(", ") : "(chưa có)";
      const subj = intent.emailSubject || "(chưa có)";
      return `Tôi sẽ gửi email đến **${to}** với tiêu đề **${subj}**. Vui lòng xác nhận trước khi gửi.`;
    }

    default:
      return `Tôi đã nhận được tin nhắn của bạn. Tôi có thể giúp:
- Tạo dự án từ ticket ISD
- Xem thông tin ticket
- Thêm nhân sự triển khai
- Tạo meeting kickoff
- Cập nhật SOW
- Gửi tin nhắn Teams/Zalo
- Gửi email

Bạn muốn làm gì?`;
  }
}
