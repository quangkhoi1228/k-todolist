/**
 * Kiểm tra (dry-run) các gợi ý lỗi thời / trùng lặp trong projectSuggestions.
 *
 * Phân loại:
 *  1. "Thu thập thông tin dự án" chung chung — trùng workflow kickoff.
 *  2. "Gia hạn license" (Palo Alto/Fortinet/firewall) — trùng quy trình business process.
 *  3. Gợi ý trùng nhau (cùng title + description) trong cùng project.
 *
 * Chạy:
 *   npx tsx scripts/check-stale-suggestions.ts
 *   npx tsx scripts/check-stale-suggestions.ts --projectId=45
 */
import dotenv from "dotenv";
import * as path from "path";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../src/lib/db";
import { projectSuggestions } from "../src/lib/db/schema";
import { closePool, parseCliArgs } from "./demo-utils";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

// ── Patterns ────────────────────────────────────────────────
const GENERIC_PREINFO_PATTERNS: RegExp[] = [
  /\bthu\s*thập\s+thông\s+tin\s+(dự\s+án|sơ\s+bộ|du\s+an)\b/i,
  /\bthu\s*thap\s+thong\s+tin\b/i,
  /\bnhận\s+thông\s+tin.*(?:scope|topology|timeline|next\s*actions?)\b/i,
  /\bcần\s+thông\s+tin.*(?:scope|topology|timeline|next\s*actions?)\b/i,
  /\b(?:scope|topology|next\s*actions?|timeline).*từ.*(?:sale|pre[-\s]?sale)\b/i,
];

const LICENSE_RENEWAL_PATTERNS: RegExp[] = [
  /\bgia\s*hạn\s+license\b/i,
  /\blicense.*(?:palo\s*alto|fortinet|firewall)\b/i,
  /\b(?:palo\s*alto|fortinet).*(?:hết\s*hạn|expir)/i,
  /\brenewal\s+ticket\b/i,
];

function isStale(s: any): { stale: boolean; reason?: string } {
  const title = (s.title || "").toLowerCase();
  const description = (s.description || "").toLowerCase();
  if (GENERIC_PREINFO_PATTERNS.some((p) => p.test(title) || p.test(description)))
    return { stale: true, reason: "thu-thap-thong-tin" };
  if (LICENSE_RENEWAL_PATTERNS.some((p) => p.test(title) || p.test(description)))
    return { stale: true, reason: "gia-han-license" };
  return { stale: false };
}

async function main() {
  const cli = parseCliArgs(process.argv);
  const projectId = cli.projectId ? parseInt(cli.projectId, 10) : null;
  const db = getDb();

  const rows = projectId
    ? await db.select().from(projectSuggestions).where(eq(projectSuggestions.projectId, projectId))
    : await db.select().from(projectSuggestions);
  console.log(`Tổng cộng ${rows.length} gợi ý${projectId ? ` (project ${projectId})` : ""}.`);

  // Phân loại
  const staleThuThap: any[] = [];
  const staleLicense: any[] = [];
  const dups: any[] = [];
  const seen = new Map<string, any[]>();

  for (const r of rows) {
    const { stale, reason } = isStale(r);
    if (stale) {
      if (reason === "gia-han-license") staleLicense.push(r);
      else staleThuThap.push(r);
    }
    const key = `${r.projectId}|${r.title}|${r.description}`.toLowerCase();
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key)!.push(r);
  }

  // Tìm duplicate (cùng project + title + description, > 1 bản)
  for (const [key, group] of seen) {
    if (group.length > 1) dups.push({ key, count: group.length, ids: group.map((g) => g.id) });
  }

  // Chỉ tình unresolved (đếm riêng — không thể loai resolved vì có thể đã giải quyết đúng)
  const unresolvedStaleThuThap = staleThuThap.filter((r) => !r.isResolved);
  const unresolvedStaleLicense = staleLicense.filter((r) => !r.isResolved);
  const unresolvedStaleAll = [...unresolvedStaleThuThap, ...unresolvedStaleLicense];
  // Lấy ra duplicate ids chưa resolved
  const dupUnresolvedIds: number[] = [];
  for (const d of dups) {
    for (const id of d.ids) {
      const row = rows.find((r) => r.id === id);
      if (row && !row.isResolved) dupUnresolvedIds.push(id);
    }
  }

  // Tổng hợp
  const allStaleIds = new Set<number>([
    ...unresolvedStaleAll.map((r) => r.id),
    ...dupUnresolvedIds,
  ]);

  console.log("\n=== Phân loại ===");
  console.log(`"Thu thập thông tin dự án": ${staleThuThap.length} gợi ý (${unresolvedStaleThuThap.length} chưa xử lý)`);
  staleThuThap.forEach((r) =>
    console.log(`  [${r.id}] p${r.projectId} ${r.isResolved ? "✓resolved" : "UNRESOLVED"}: ${r.title}`)
  );
  console.log(`"Gia hạn license": ${staleLicense.length} gợi ý (${unresolvedStaleLicense.length} chưa xử lý)`);
  staleLicense.forEach((r) =>
    console.log(`  [${r.id}] p${r.projectId} ${r.isResolved ? "✓resolved" : "UNRESOLVED"}: ${r.title}`)
  );
  console.log(`Trùng lặp (cùng project+title+desc): ${dups.length} nhóm, ${dupUnresolvedIds.length} id chưa xử lý`);
  dups.forEach((d) =>
    console.log(`  ${d.key.slice(0, 80)}... ×${d.count} ids=[${d.ids.join(",")}]`)
  );

  console.log("\n=== Tổng hợp ===");
  console.log(`Số gợi ý CHƯA XỬ LÝ cần loại bỏ: ${allStaleIds.size}`);

  const byProject = new Map<number, number>();
  for (const id of allStaleIds) {
    const row = rows.find((r) => r.id === id);
    if (row) {
      const pid = row.projectId;
      byProject.set(pid, (byProject.get(pid) || 0) + 1);
    }
  }
  console.log("Phân bổ theo project:");
  for (const [pid, count] of Array.from(byProject.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  project ${pid}: ${count} gợi ý sẽ bị loại`);
  }

  // List ids để xoá (dry-run, chưa xoá)
  console.log(`\nIDs cần loại bỏ: [${Array.from(allStaleIds).sort((a, b) => a - b).join(", ")}]`);
  console.log("\nĐể thực sự xoá: npx tsx scripts/cleanup-stale-suggestions.ts");
}

main()
  .then(() => closePool())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
