/**
 * Natural Language Intent Parser for PM Agent
 *
 * Phan tich cau noi tieng Viet cua PM de hieu y dinh va trich xuat thong tin.
 * Khong dung AI, chi dung pattern matching + keyword.
 */

export interface ParsedIntent {
  action: "create_project" | "lookup_ticket" | "add_personnel" | "create_meeting" | "update_sow" | "view_project" | "goto_project" | "chat";
  confidence: number; // 0-1
  ticketId?: string;
  entities: Record<string, string>;
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
  const trimmed = text.trim();
  let bestAction: ParsedIntent["action"] = "chat";
  let bestScore = 0;
  const entities: Record<string, string> = {};

  // Ticket ID luon duoc extract neu co
  const ticketId = extractTicketId(trimmed);

  // Neu co ticket ID + khong co action cu the -> lookup
  for (const [, rule] of Object.entries(KEYWORDS)) {
    for (const pattern of rule.patterns) {
      if (pattern.test(trimmed)) {
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
    if (/tao|mo|khoi tao|bat dau|tiep nhan/i.test(trimmed)) {
      bestAction = "create_project";
      bestScore = 2;
    }
  }

  // Trich xuat entities bo sung
  if (/nhan su|personnel|nguoi|ai|ten/i.test(trimmed)) {
    // Try to extract names
    const nameMatch = trimmed.match(/(?:la |ten |them |add )\s*([A-ZÀ-Ỹ][a-zà-ỹ]+(?:\s+[A-ZÀ-Ỹ][a-zà-ỹ]+)+)/);
    if (nameMatch) entities["person_name"] = nameMatch[1].trim();
  }

  if (/meeting|hop|kickoff/i.test(trimmed)) {
    const dateMatch = trimmed.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
    if (dateMatch) entities["meeting_date"] = `${dateMatch[1]}/${dateMatch[2]}`;
  }

  return {
    action: bestAction,
    confidence: bestScore / 2, // normalize to 0-1
    ticketId,
    entities,
    original: trimmed,
  };
}

// ─── Response Generator ─────────────────────────────────

export function generateAgentResponse(intent: ParsedIntent, context?: { projectName?: string; ticketSummary?: string }): string {
  switch (intent.action) {
    case "create_project":
      if (intent.ticketId) {
        return `Toi se tao du an tu ticket **#${intent.ticketId}**. Dang dong bo thong tin tu ISD...`;
      }
      return `Vui long cung cap so ticket ISD. VD: "Tao du an tu ticket ISD-90335"`;

    case "lookup_ticket":
      if (intent.ticketId) {
        return `Dang tra cuu thong tin ticket **#${intent.ticketId}** tu ISD...`;
      }
      return `Vui long cho toi so ticket can xem. VD: "Xem ticket ISD-90335"`;

    case "add_personnel":
      return `Toi se giup ban them nhan su vao du an. Vui long cho thong tin: ten, email, team, vai tro (PIC/Support).`;

    case "create_meeting":
      return `Toi se giup ban tao meeting kickoff. Can chuan bi: ngay, gio, danh sach thanh vien tham gia, agenda.`;

    case "update_sow":
      return `Toi se giup cap nhat SOW. Hien tai SOW dang o trang thai: **${context?.projectName || "Cho xu ly"}**`;

    case "view_project":
      return `Du an **${context?.projectName || "hien tai"}** dang duoc quan ly.`;

    case "goto_project":
      return `Dang tim du an **${intent.ticketId || intent.original.replace(/chuyển\s*(?:sang|đến|qua|tới|đi)\s+|đến\s+|tìm\s+/i, "").trim() || "..."}**.`;

    default:
      return `Toi da nhan duoc tin nhan cua ban. Toi co the giup:
- Tao du an tu ticket ISD
- Xem thong tin ticket
- Them nhan su trien khai
- Tao meeting kickoff
- Cap nhat SOW

Ban muon lam gi?`;
  }
}
