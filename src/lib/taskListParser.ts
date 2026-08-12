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
  startDate?: number | null; // timestamp (ms) — ngày bắt đầu theo kế hoạch (Plan)
  endDate?: number | null; // timestamp (ms) — ngày kết thúc theo kế hoạch (Plan)
  status?: string;
  phase: string; // phase cấp 1 (vd "Chuẩn bị", "Triển khai") — segment đầu của path
  path: string; // đường dẫn phân cấp đầy đủ, vd "1. Chuẩn bị / 2.1 Hạ tầng"
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

/** Bỏ dấu ngoặc kép bao quanh cell (Excel bọc cell nhiều dòng trong "...") và unescape "" → ". */
function cleanCell(c: string): string {
  let s = c;
  if (s.startsWith('"') && s.endsWith('"')) {
    s = s.slice(1, -1).replace(/""/g, '"');
  }
  return s;
}

/** Tách dòng TSV (paste từ Excel) — giữ tab; dòng có ít nhất 2 cột khác rỗng mới tính. */
function splitTsvLine(line: string): string[] {
  return line.split("\t").map((c) => normalizeCell(cleanCell(c)));
}

/**
 * Merge các dòng vật lý đang nằm trong cell được Excel bọc "..." (cell nhiều dòng).
 * VD: `2.1.1\t...\t"Tạo 2 VPC: ...\nChi tiết: Sheet BOM"\t...` → gộp 2 dòng thành 1.
 */
function mergeQuotedLines(lines: string[]): string[] {
  const out: string[] = [];
  let buf = "";
  let inQuote = false;
  for (const ln of lines) {
    buf = buf ? buf + "\n" + ln : ln;
    let q = 0;
    for (let i = 0; i < ln.length; i++) {
      if (ln[i] === '"') {
        if (ln[i + 1] === '"') {
          i++;
          continue;
        }
        q++;
      }
    }
    if (q % 2 === 1) inQuote = !inQuote;
    if (!inQuote) {
      out.push(buf);
      buf = "";
    }
  }
  if (buf) out.push(buf);
  return out;
}

function looksLikeHeaderRow(cells: string[]): boolean {
  const joined = cells.join(" ").toLowerCase();
  return (
    joined.includes("task") ||
    joined.includes("no") ||
    joined.includes("start date") ||
    joined.includes("end date") ||
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

/**
 * Parse ngày dạng "d/M/yyyy" (Excel Việt Nam, vd "1/7/2026") hoặc "dd-MM-yyyy" → timestamp ms.
 * Trả về null nếu sai định dạng / không parse được. Ưu tiên day-first (d/M/yyyy).
 */
function parseDate(raw: string): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (isNaN(dt.getTime())) return null;
  return dt.getTime();
}

/** Số segment của số thứ tự (vd "1"→0, "2.1"→1, "2.1.1"→2). Trả -1 nếu không phải số phân cấp. */
function levelDepth(no: string): number {
  if (!no) return -1;
  const segs = no.split(".");
  if (segs.some((s) => s === "" || !/^\d+$/.test(s))) return -1;
  return segs.length - 1;
}

/**
 * Hàng nhóm (phase hoặc nhóm con): [No] [title] + các cột còn lại rỗng/ít thông tin.
 * - Phase: no là số nguyên đơn (vd "1", "2", "3") → depth 0.
 * - Nhóm con: no có dấu chấm (vd "2.1", "2.2.3") → depth ≥ 1.
 *   Lá (vd "2.1.1") có đủ thông tin → không phải nhóm.
 */
function isGroupHeaderRow(cells: string[]): { depth: number; title: string; skip: boolean } {
  const no = cells[0] ?? "";
  const title = cells[1] ?? "";
  if (!no || !title) return { depth: -1, title: "", skip: false };
  const rest = cells.slice(2);
  const restEmpty = rest.every((c) => !c);
  if (!restEmpty) return { depth: -1, title: "", skip: false };

  const depth = levelDepth(no);
  if (depth >= 0) return { depth, title, skip: true };
  return { depth: -1, title: "", skip: false };
}

/** Parse nội dung paste (TSV hoặc text thuần) → rows task. */
export function parseTaskListPaste(rawText: string): TaskListParseResult {
  const text = String(rawText ?? "");
  const rawLines = text.split(/\r?\n/);

  const tsvCandidate = rawLines.filter((l) => l.includes("\t")).length;
  const useTsv = tsvCandidate > Math.max(1, rawLines.length * 0.3);

  // Merge dòng vật lý nằm trong cell bọc "..." (cell nhiều dòng của Excel)
  const lines = useTsv ? mergeQuotedLines(rawLines) : rawLines;

  const rows: ParsedTaskRow[] = [];
  const skipped: string[] = [];
  // Stack phân cấp theo depth (vd stack[0]="Chuẩn bị", stack[1]="Hạ tầng")
  const levelStack: string[] = [];
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
      const grp = isGroupHeaderRow(cells);
      if (grp.skip) {
        // Cập nhật stack theo depth
        levelStack[grp.depth] = grp.title;
        levelStack.length = grp.depth + 1; // cắt bỏ cấp sâu hơn
        if (grp.depth === 0) currentPhase = grp.title;
        skipped.push(line);
        continue;
      }
      const [no, title, ...rest] = cells;
      const details = rest[0] ?? "";
      const pic = rest[1] ?? "";
      const support = rest[2] ?? "";
      const mandayRaw = rest[3] ?? "";
      const planStartRaw = rest[4] ?? "";
      const planEndRaw = rest[5] ?? "";
      const statusRaw = rest.slice(6).find((c) => normalizeStatus(c));
      // Task rỗng title nhưng có details (vd "5.2", "5.3") → dùng details làm title
      const effTitle = title || details;
      if (!effTitle) {
        skipped.push(line);
        continue;
      }
      rows.push({
        no,
        title: effTitle,
        details: title ? details || undefined : undefined,
        pic: pic || undefined,
        support: support || undefined,
        manday: mandayRaw && !isNaN(Number(mandayRaw)) ? Number(mandayRaw) : undefined,
        startDate: parseDate(planStartRaw),
        endDate: parseDate(planEndRaw),
        status: normalizeStatus(statusRaw ?? ""),
        phase: currentPhase,
        path: levelStack.join(" / "),
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
          levelStack.length = 0;
          levelStack[0] = title;
          skipped.push(line);
          continue;
        }
      }
      rows.push({ no, title, phase: currentPhase, path: levelStack.join(" / ") });
    }
  }

  // Dòng cuối — nếu không có phase nào và toàn bộ là text thuần → giữ rows
  return { rows, skipped, source: useTsv ? "tsv" : "lines" };
}

/** Nhóm rows theo phase → group → items để hiển thị preview/import. */
export function groupRowsByPhase(
  rows: ParsedTaskRow[]
): { phase: string; items: ParsedTaskRow[] }[] {
  const groups: { phase: string; items: ParsedTaskRow[] }[] = [];
  for (const r of rows) {
    const key = r.phase || "Khác";
    const g = groups.find((x) => x.phase === key);
    if (g) g.items.push(r);
    else groups.push({ phase: key, items: [r] });
  }
  return groups;
}

/** Nhóm rows theo phase/group để hiển thị preview 2 cấp (group = segment cuối của path). */
export function groupRowsByPhaseAndGroup(
  rows: ParsedTaskRow[]
): { phase: string; groups: { group: string; items: ParsedTaskRow[] }[] }[] {
  const phases: { phase: string; groups: { group: string; items: ParsedTaskRow[] }[] }[] = [];
  for (const r of rows) {
    const ph = r.phase || "Khác";
    const segments = r.path ? r.path.split(" / ") : [];
    const gr = segments.length > 1 ? segments[segments.length - 1] : "";
    let phObj = phases.find((x) => x.phase === ph);
    if (!phObj) {
      phObj = { phase: ph, groups: [] };
      phases.push(phObj);
    }
    let grObj = phObj.groups.find((x) => x.group === gr);
    if (!grObj) {
      grObj = { group: gr, items: [] };
      phObj.groups.push(grObj);
    }
    grObj.items.push(r);
  }
  return phases;
}

/** Chuyển rows → dạng task chuẩn để import (bỏ fields rỗng). */
export function rowsToTasks(rows: ParsedTaskRow[]) {
  return rows
    .filter((r) => r.title)
    .map((r) => ({
      phase: r.phase,
      path: r.path || undefined,
      title: r.title,
      details: r.details || undefined,
      pic: r.pic || undefined,
      support: r.support || undefined,
      manday: r.manday ?? undefined,
      startDate: r.startDate ?? undefined,
      endDate: r.endDate ?? undefined,
      status: r.status,
      no: r.no,
    }));
}