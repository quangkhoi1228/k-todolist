/**
 * Xoá các gợi ý lỗi thời / trùng lặp trong projectSuggestions.
 *
 * Chỉ xoá các gợi ý CHƯA XỬ LÝ (isResolved = false) thuộc 1 trong các loại:
 *  1. "Thu thập thông tin dự án" chung chung — trùng workflow kickoff.
 *  2. "Gia hạn license" (Palo Alto/Fortinet/firewall) — trùng quy trình business process.
 *  3. Gợi ý trùng nhau (cùng project + title + description) — giữ lại bản mới nhất.
 *
 * Chạy:
 *   npx tsx scripts/cleanup-stale-suggestions.ts
 *   npx tsx scripts/cleanup-stale-suggestions.ts --projectId=49   // chỉ 1 project
 *   npx tsx scripts/cleanup-stale-suggestions.ts --dryRun          // chỉ đếm, không xoá
 */
import dotenv from "dotenv";
import * as path from "path";
import { and, eq, inArray } from "drizzle-orm";
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

function isStale(s: any): boolean {
  const title = (s.title || "").toLowerCase();
  const description = (s.description || "").toLowerCase();
  return (
    GENERIC_PREINFO_PATTERNS.some((p) => p.test(title) || p.test(description)) ||
    LICENSE_RENEWAL_PATTERNS.some((p) => p.test(title) || p.test(description))
  );
}

async function main() {
  const cli = parseCliArgs(process.argv);
  const dryRun = cli.dryRun === "true" || cli.dryRun === "1";
  const projectId = cli.projectId ? parseInt(cli.projectId, 10) : null;
  const db = getDb();

  const rows = projectId
    ? await db.select().from(projectSuggestions).where(eq(projectSuggestions.projectId, projectId))
    : await db.select().from(projectSuggestions);

  // 1. Gợi ý lỗi thời (thu thập thông tin / gia hạn license) — chưa xử lý
  const staleIds = rows
    .filter((r) => !r.isResolved && isStale(r))
    .map((r) => r.id);

  // 2. Gợi ý trùng lặp (cùng project+title+description) — giữ bản mới nhất (createdAt lớn nhất)
  const dupIds: number[] = [];
  const byKey = new Map<string, any[]>();
  for (const r of rows) {
    const key = `${r.projectId}|${r.title}|${r.description}`.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(r);
  }
  for (const [, group] of byKey) {
    if (group.length <= 1) continue;
    // Những bản chưa resolved ngoài bản mới nhất → xoá
    const unresolved = group.filter((g) => !g.isResolved).sort((a, b) => b.createdAt - a.createdAt);
    for (let i = 1; i < unresolved.length; i++) {
      dupIds.push(unresolved[i].id);
    }
  }

  const idsToDelete = Array.from(new Set([...staleIds, ...dupIds]));
  console.log(`Tổng ${rows.length} gợi ý. Sẽ xoá ${idsToDelete.length} gợi ý lỗi thời/trùng (chưa xử lý).`);
  console.log(`  - lỗi thời (thu thập thông tin / gia hạn license): ${staleIds.length}`);
  console.log(`  - trùng lặp: ${dupIds.length}`);
  console.log(`IDs: [${idsToDelete.sort((a, b) => a - b).join(", ")}]`);

  if (dryRun || idsToDelete.length === 0) {
    console.log(dryRun ? "DRY RUN — chưa xoá gì." : "Không có gì để xoá.");
    return;
  }

  // Xoá theo batch (Postgres giới hạn ~65535 params, chia nhỏ 1000/batch)
  let deleted = 0;
  for (let i = 0; i < idsToDelete.length; i += 999) {
    const chunk = idsToDelete.slice(i, i + 999);
    const res = await db
      .delete(projectSuggestions)
      .where(and(inArray(projectSuggestions.id, chunk), eq(projectSuggestions.isResolved, false)));
    deleted += res.rowCount ?? 0;
  }
  console.log(`Đã xoá ${deleted} gợi ý lỗi thời/trùng lặp.`);
}

main()
  .then(() => closePool())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });