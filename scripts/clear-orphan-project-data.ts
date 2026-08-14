/**
 * Clear orphaned project-scoped data — rows whose `projectId` no longer
 * points to an existing project (e.g. left behind by an old hard-delete that
 * did not cascade). Safe by default: prints a report and does nothing unless
 * you pass --apply.
 *
 * Chạy (xem trước):   npx tsx scripts/clear-orphan-project-data.ts
 * Chạy (xoá thật):    npx tsx scripts/clear-orphan-project-data.ts --apply
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { getDb } from "../src/lib/db";
import {
  projects,
  projectChats,
  projectSuggestions,
  projectWorkflows,
  projectSummaries,
  projectMembers,
  projectIsdData,
  debateRuns,
  syncLogs,
} from "../src/lib/db/schema";
import { notInArray, inArray } from "drizzle-orm";

const CHILD_TABLES = [
  { name: "projectChats", table: projectChats, col: projectChats.projectId },
  { name: "projectSuggestions", table: projectSuggestions, col: projectSuggestions.projectId },
  { name: "projectWorkflows", table: projectWorkflows, col: projectWorkflows.projectId },
  { name: "projectSummaries", table: projectSummaries, col: projectSummaries.projectId },
  { name: "projectMembers", table: projectMembers, col: projectMembers.projectId },
  { name: "projectIsdData", table: projectIsdData, col: projectIsdData.projectId },
  { name: "debateRuns", table: debateRuns, col: debateRuns.projectId },
  { name: "syncLogs", table: syncLogs, col: syncLogs.projectId },
] as const;

async function main() {
  const apply = process.argv.includes("--apply");
  const db = getDb();

  const projRows = await db.select({ id: projects.id }).from(projects);
  const validIds = projRows.map((p) => Number(p.id));
  console.log(`Project hợp lệ (còn trong DB): ${validIds.length}`);

  let totalOrphans = 0;
  for (const t of CHILD_TABLES) {
    // Rows whose projectId is NOT in the set of valid project ids.
    const orphanRows = await db
      .select({ pid: t.col })
      .from(t.table)
      .where(validIds.length > 0 ? notInArray(t.col, validIds) : undefined);
    const n = orphanRows.length;
    if (n === 0) {
      console.log(`  ${t.name}: 0 orphan`);
      continue;
    }
    const byPid = new Map<number, number>();
    for (const r of orphanRows) {
      const pid = Number((r as any).pid);
      byPid.set(pid, (byPid.get(pid) ?? 0) + 1);
    }
    const detail = [...byPid.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([pid, c]) => `${pid}:${c}`)
      .join(", ");
    console.log(`  ${t.name}: ${n} orphan  (projectId:count → ${detail})`);
    totalOrphans += n;

    if (apply) {
      await db.delete(t.table).where(validIds.length > 0 ? notInArray(t.col, validIds) : undefined);
    }
  }

  console.log(`\nTổng orphan: ${totalOrphans}`);
  if (apply) {
    console.log("✅ Đã XOÁ toàn bộ orphan ở trên.");
  } else if (totalOrphans > 0) {
    console.log("ℹ️  Dry-run. Chạy lại với --apply để xoá thật.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
