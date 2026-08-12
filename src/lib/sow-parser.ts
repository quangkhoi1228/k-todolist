import * as XLSX from "xlsx";
import { TaskTemplateItem } from "./repo/taskTemplates";

// ─── Types ────────────────────────────────────────────────
export interface ParsedSow {
  templateName: string;
  templateCategory: string;
  templateDescription: string;
  triggers: string[];
  items: SowItem[];
  rawRows: number;
  skippedRows: number;
}

// item mở rộng với metadata parse
export type SowItem = TaskTemplateItem & { _parentNo?: string; isGroup?: boolean; pic?: string };

// ─── Auto-detect template type from text ──────────────────
const DETECT_RULES: {
  category: string;
  name: string;
  triggers: string[];
  description: string;
}[] = [
  {
    category: "migration",
    name: "Migration Cloud",
    triggers: ["migrate", "migration", "migrating", "onprem", "on-prem", "cloud migration", "lift and shift", "di chuyển"],
    description: "Triển khai di chuyển workload lên Cloud (migrate VM, dữ liệu, cấu hình hạ tầng)",
  },
  {
    category: "security",
    name: "Security / Firewall (FW)",
    triggers: ["firewall", "fw ", "fortinet", "palo alto", "ngfw", "security", "dnat", "rule survey", "firewall system"],
    description: "Triển khai thiết bị/cấu hình tường lửa và bảo mật (Fortinet, Palo Alto...)",
  },
  {
    category: "waf",
    name: "WAF (Web Application Firewall)",
    triggers: ["waf", "web application", "domain", "loadbalancer", "lb", "cdn"],
    description: "Triển khai WAF bảo vệ ứng dụng web (domain survey, policy WAF...)",
  },
  {
    category: "general",
    name: "Dự án triển khai tổng quát",
    triggers: ["triển khai", "implement", "deployment", "deploy"],
    description: "Template triển khai dự án tổng quát (chuẩn bị → triển khai → nghiệm thu)",
  },
];

export function detectTemplateType(text: string): { category: string; name: string; triggers: string[]; description: string } {
  const lower = (text || "").toLowerCase();
  for (const rule of DETECT_RULES) {
    for (const kw of rule.triggers) {
      if (lower.includes(kw)) return rule;
    }
  }
  return DETECT_RULES[DETECT_RULES.length - 1];
}

// ─── Utility: normalize string cell ───────────────────────
function cleanCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    return v.toISOString().slice(0, 10);
  }
  return String(v).replace(/\s+/g, " ").trim();
}

function cleanManday(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).replace(/,/g, "").trim();
  const n = parseFloat(s);
  return isNaN(n) ? undefined : n;
}

// ─── Parse SOW sheet rows into items ──────────────────────
/**
 * Tìm sheet chứa cột "Task" (thường là "SoW", "SoW WAF...") và parse ra danh sách task items.
 * Dòng có số thứ tự dạng "1", "1.1", "2.1.2" sẽ thành phase (cấp 1) hoặc task con.
 */
export function parseSowWorkbook(buffer: ArrayBuffer | Buffer, filename?: string): ParsedSow {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });

  // 1. Tìm sheet phù hợp: ưu tiên tên chứa "sow" (không tính sheet "Project High Level")
  const sheetNames = wb.SheetNames;
  const sowSheets =
    sheetNames.filter((n) => /sow/i.test(n) && !/high level/i.test(n)).length > 0
      ? sheetNames.filter((n) => /sow/i.test(n) && !/high level/i.test(n))
      : sheetNames.filter((n) => /work|task|sow/i.test(n));
  const sheetName = sowSheets[0] ?? sheetNames[0];

  const ws = wb.Sheets[sheetName];
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });

  // 2. Tìm header row (chứa cột "Task")
  let headerIdx = -1;
  let colNo = -1, colTask = -1, colDetails = -1, colPic = -1, colSupport = -1, colManday = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    for (let c = 0; c < r.length; c++) {
      const v = cleanCell(r[c]).toLowerCase();
      if (v === "task") {
        headerIdx = i;
        colTask = c;
        // No thường nằm ngay trước Task
        colNo = c - 1 >= 0 ? c - 1 : -1;
        break;
      }
    }
    if (headerIdx >= 0) break;
  }
  if (headerIdx < 0) {
    throw new Error(`Không tìm thấy cột "Task" trong sheet "${sheetName}"`);
  }

  // Tìm cột Details, PIC, Support/Team, Manday trong header row
  const header = rows[headerIdx];
  const findCol = (names: string[]) => {
    for (let c = 0; c < header.length; c++) {
      const v = cleanCell(header[c]).toLowerCase();
      if (names.some((n) => v === n)) return c;
    }
    return -1;
  };
  colDetails = findCol(["details", "detail", "mô tả", "mo ta"]);
  colPic = findCol(["pic", "pic/owner", "owner", "person in charge"]);
  colSupport = findCol(["support", "team"]);
  colManday = findCol(["manday", "man-day", "man day", "effort", "ngày công"]);

  // 3. Parse rows từ headerIdx+1 đến hết
  const items: SowItem[] = [];
  const childrenMap: Record<string, boolean> = {}; // _parentNo nào có con → là group
  let skippedRows = 0;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const task = cleanCell(colTask >= 0 ? r[colTask] : "");
    if (!task) {
      if (r.some((v) => cleanCell(v))) skippedRows++;
      continue;
    }

    const noRaw = cleanCell(colNo >= 0 ? r[colNo] : "");
    const no = noRaw || String(i - headerIdx);
    // Level = số phần trong số thứ tự (1, 1.1, 2.1.2)
    const level = no.split(/[.\s]/).filter(Boolean).length;

    const details = colDetails >= 0 ? cleanCell(r[colDetails]) : "";
    const pic = colPic >= 0 ? cleanCell(r[colPic]) : "";
    const support = colSupport >= 0 ? cleanCell(r[colSupport]) : "";
    const manday = colManday >= 0 ? cleanManday(r[colManday]) : undefined;

    // Phase = tên của task cha trực tiếp (level-1)
    const phase = level <= 1 ? task : (() => {
      const parentNo = no.split(".").slice(0, -1).join(".");
      const parent = items.find((it) => it._parentNo === parentNo);
      return parent ? parent.title : "";
    })();

    if (level > 1) childrenMap[no.split(".").slice(0, -1).join(".")] = true;

    items.push({
      _parentNo: no,
      phase: phase || "Triển khai",
      title: task,
      details: details || undefined,
      pic: pic || undefined,
      support: support || undefined,
      manday,
    } as SowItem);
  }

  // Đánh dấu group: item có con
  for (const it of items) {
    if (childrenMap[it._parentNo!]) {
      it.isGroup = true;
    }
  }

  // 4. Auto-detect loại template từ nội dung file
  const allText = [
    sheetName,
    ...items.map((it) => `${it.phase} ${it.title} ${it.details ?? ""}`),
  ].join(" ");
  const detected = detectTemplateType(allText);

  // 5. Trả về items sạch (bỏ _parentNo) — pic chỉ dùng cho task thật, không lưu vào template
  const cleanItems: SowItem[] = items.map(({ _parentNo, isGroup, ...rest }) => ({ ...rest, isGroup }));

  return {
    templateName: detected.name,
    templateCategory: detected.category,
    templateDescription: detected.description,
    triggers: detected.triggers,
    items: cleanItems,
    rawRows: rows.length - headerIdx - 1,
    skippedRows,
  };
}
