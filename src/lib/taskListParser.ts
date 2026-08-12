/**
 * Parse nội dung task list dán từ Excel (paste giữ tab) thành các dòng task chuẩn.
 *
 * Hỗ trợ:
 * - TSV (Excel copy có tab): [No] [Task] [Details] [PIC] [Support/Team] [Manday] [Plan...] [Status] [Note...]
 * - Dạng text thuần (mỗi dòng 1 task, có thể có số thứ tự "1.1", "2.3" prefix).
 * - Hàng nhóm phase (vd No=1, task="Chuẩn bị", các cột khác rỗng) → tự collapse thành phase cho các task con.
 */

export interface ParsedTaskRow {
  no: string; // số thứ tự gốc ("" nếu không có)
  title: string;
  details?: string;
  pic?: string;
  support?: string;
  manday?: number | null;
  status?: string;
  phase: string; // nhóm phase hiện hành (collapse từ hàng nhóm)
}

export interface TaskListParseResult {
  rows: ParsedTaskRow[];
  skipped: string[]; // dòng bị bỏ (header/rỗng)
  source: "tsv" | "lines"; // detect được kiểu nào
}

const LEVEL_NO_RE = /^(\d+(?:\.\d+)*)\s*[\.\-\)]?\s*(.*)$/;

function normalizeCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    // Số thứ tự Excel đôi khi thành số thực (vd 1.1 → 1.1) — giữ nguyên
    return String(v).trim();
  }
  return String(v).replace(/\s+/g, " ").trim();
}

/** Tách dòng TSV (paste từ Excel) — giữ tab; dòng có ít nhất 2 cột khác rỗng mới tính. */
function splitTsvLine(line: string): string[] {
  return line.split("\t").map(normalizeCell);
}

function looksLikeHeaderRow(cells: string[]): boolean {
  const joined = cells.join(" ").toLowerCase();
  return (
    joined.includes("task") ||
    joined.includes("no") ||
    (joined.includes("details") && cells.length >= 3)
  );
}

/** Detect status từ text (Done/Processing/Not started/Pending/..." — tiếng Việt hoá). */
function normalizeStatus(raw: string): string | undefined {
  const s = raw.toLowerCase();
  if (!s) return undefined;
  if (s.includes("done") || s.includes("hoàn thành") || s.includes("xong")) return "done";
  if (s.includes("processing") || s.includes("đang")) return "processing";
  if (s.includes("pending") || s.includes("chờ")) return "pending";
  if (s.includes("not started") || s.includes("chưa")) return "todo";
  if (s.includes("cancel") || s.includes("hủy")) return "cancelled";
  return undefined;
}

function isPhaseHeaderRow(cells: string[]): boolean {
  // Hàng nhóm phase: [No] [title] + các cột còn lại rỗng/ít thông tin
  const no = cells[0] ?? "";
  const title = cells[1] ?? "";
  if (!no || !title) return false;
  if (!/^\d+$/.test(no)) return false; // no là số nguyên đơn (vd "1", "2", "3")
  const rest = cells.slice(2);
  return rest.every((c) => !c);
}

/** Parse nội dung paste (TSV hoặc text thuần) → rows task. */
export function parseTaskListPaste(rawText: string): TaskListParseResult {
  const text = String(rawText ?? "");
  const lines = text.split(/\r?\n/);

  const tsvCandidate = lines.filter((l) => l.includes("\t")).length;
  const useTsv = tsvCandidate > Math.max(1, lines.length * 0.3);

  const rows: ParsedTaskRow[] = [];
  const skipped: string[] = [];
  let currentPhase = "";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (useTsv) {
      const cells = splitTsvLine(line);
      if (cells.length < 2) {
        skipped.push(line);
        continue;
      }
      if (looksLikeHeaderRow(cells)) {
        skipped.push(line);
        continue;
      }
      if (isPhaseHeaderRow(cells)) {
        currentPhase = cells[1];
        continue;
      }
      const [no, title, ...rest] = cells;
      if (!title) {
        skipped.push(line);
        continue;
      }
      const details = rest[0] ?? "";
      const pic = rest[1] ?? "";
      const support = rest[2] ?? "";
      const mandayRaw = rest[3] ?? "";
      const statusRaw = rest.slice(4).find((c) => normalizeStatus(c));
      rows.push({
        no,
        title,
        details: details || undefined,
        pic: pic || undefined,
        support: support || undefined,
        manday: mandayRaw && !isNaN(Number(mandayRaw)) ? Number(mandayRaw) : undefined,
        status: normalizeStatus(statusRaw ?? ""),
        phase: currentPhase,
      });
    } else {
      // Dòng text thuần — hỗ trợ prefix "1.1", "2.3", "-", "•"
      const m = line.match(LEVEL_NO_RE);
      const no = m ? m[1] : "";
      const title = (m ? m[2] : line).trim();
      if (!title) {
        skipped.push(line);
        continue;
      }
      // Nếu title giống hệt dòng phase đã gặp (vd "Chuẩn bị") → cập nhật phase
      if (no && !no.includes(".") && !title) continue;
      if (no && !no.includes(".") && title === currentPhase) {
        skipped.push(line);
        continue;
      }
      if (no && !no.includes(".") && title) {
        // Có thể là header phase (giống TSV) — nếu ~ từ khoá phase thì collapse
        const PHASE_HINTS = /(chuẩn bị|triển khai|khảo sát|nghiệm thu|bàn giao|kiểm tra|kết thúc|đóng|hỗ trợ|vận hành|chuẩn hoá|chuẩn hóa|upgrade|migration)/i;
        if (PHASE_HINTS.test(title) && !no.includes(".")) {
          currentPhase = title;
          skipped.push(line);
          continue;
        }
      }
      rows.push({ no, title, phase: currentPhase });
    }
  }

  // Dòng cuối — nếu không có phase nào và toàn bộ là text thuần → giữ rows
  return { rows, skipped, source: useTsv ? "tsv" : "lines" };
}

/** Nhóm rows theo phase để hiển thị preview/import. */
export function groupRowsByPhase(rows: ParsedTaskRow[]): { phase: string; items: ParsedTaskRow[] }[] {
  const groups: { phase: string; items: ParsedTaskRow[] }[] = [];
  for (const r of rows) {
    const key = r.phase || "Khác";
    const g = groups.find((x) => x.phase === key);
    if (g) g.items.push(r);
    else groups.push({ phase: key, items: [r] });
  }
  return groups;
}

/** Chuyển rows → dạng task chuẩn để import (bỏ fields rỗng). */
export function rowsToTasks(rows: ParsedTaskRow[]) {
  return rows
    .filter((r) => r.title)
    .map((r) => ({
      phase: r.phase,
      title: r.title,
      details: r.details || undefined,
      pic: r.pic || undefined,
      support: r.support || undefined,
      manday: r.manday ?? undefined,
      status: r.status,
      no: r.no,
    }));
}