/**
 * Xoá toàn bộ dữ liệu gợi ý (projectSuggestions) trong database.
 *
 * Mặc định xoá TẤT CẢ suggestions của mọi project.
 * Dùng --projectId=NN để chỉ xoá suggestions của 1 project cụ thể.
 *
 * Chạy:
 *   npx tsx scripts/clear-suggestions.ts              // xoá hết
 *   npx tsx scripts/clear-suggestions.ts --projectId=12  // chỉ xoá project 12
 */
import dotenv from "dotenv";
import * as path from "path";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../src/lib/db";
import { projectSuggestions } from "../src/lib/db/schema";
import { closePool, parseCliArgs } from "./demo-utils";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

async function main() {
  const cli = parseCliArgs(process.argv);
  const projectId = cli.projectId ? parseInt(cli.projectId, 10) : null;

  const db = getDb();

  // Đếm trước
  const countRows = projectId
    ? await db
        .select({ count: sql<number>`count(*)::int` })
        .from(projectSuggestions)
        .where(eq(projectSuggestions.projectId, projectId))
    : await db.select({ count: sql<number>`count(*)::int` }).from(projectSuggestions);
  const before = countRows[0]?.count ?? 0;

  if (before === 0) {
    console.log("Không có suggestions nào để xoá.");
    return;
  }

  // Xoá
  const res = projectId
    ? await db
        .delete(projectSuggestions)
        .where(eq(projectSuggestions.projectId, projectId))
    : await db.delete(projectSuggestions);

  const deleted = res.rowCount ?? 0;
  const label = projectId ? `project id=${projectId}` : "tất cả project";
  console.log(`Đã xoá ${deleted} suggestions (${label}).`);
}

main()
  .then(() => closePool())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
