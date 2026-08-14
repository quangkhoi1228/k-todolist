/**
 * Quick reset một project về trạng thái "sạch" để demo lại ngay trên cùng
 * data chat — KHÔNG cần tạo nhóm mới hay gõ lại data.
 *
 * Những gì bị xoá/reset:
 *   - projectSuggestions  → xoá hết (để agent chạy lại sinh gợi ý mới)
 *   - projectWorkflows    → reset phase về "init", steps rỗng (để demo workflow card lại)
 *   - projectSummaries    → xoá hết (KB dự án sạch)
 *   - syncLogs            → xoá hết log của project (màn hình Activity sạch)
 *
 * Những gì GIỮ NGUYÊN (data gốc — không đụng):
 *   - projectChats        → giữ toàn bộ tin nhắn đã sync (data demo chính)
 *   - projectMembers      → giữ member
 *   - tasks               → giữ task (nếu muốn xoá task, dùng snapshot/restore)
 *   - project config      → giữ teamsGroups, phase, notes...
 *
 * Chạy:
 *   npx tsx scripts/demo-reset.ts --projectId=12
 *   (tuỳ chọn: --keepLogs để không xoá syncLogs)
 */
import dotenv from "dotenv";
import * as path from "path";
import { eq } from "drizzle-orm";
import { getDb } from "../src/lib/db";
import {
  projects, projectSuggestions, projectWorkflows, projectSummaries, syncLogs,
} from "../src/lib/db/schema";
import { closePool, parseCliArgs } from "./demo-utils";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

async function main() {
  const cli = parseCliArgs(process.argv);
  const projectId = parseInt(cli.projectId || "", 10);
  if (!projectId) {
    console.error("Cần --projectId (vd: npx tsx scripts/demo-reset.ts --projectId=12)");
    process.exit(1);
  }
  const keepLogs = cli.keepLogs === "1" || cli.keepLogs === "true";

  const db = getDb();
  const pid = projectId;

  const project = await db.query.projects.findFirst({ where: eq(projects.id, pid) });
  if (!project) {
    console.error(`Không tìm thấy project id=${pid}`);
    process.exit(1);
  }

  // 1. Xoá suggestions
  const delSuggestions = await db.delete(projectSuggestions).where(eq(projectSuggestions.projectId, pid));
  console.log(`🗑  Suggestions: xoá ${delSuggestions.rowCount ?? 0}`);

  // 2. Reset workflow về init + steps rỗng
  const wfDel = await db.delete(projectWorkflows).where(eq(projectWorkflows.projectId, pid));
  console.log(`🗑  Workflow: xoá ${wfDel.rowCount ?? 0} (sẽ tự tạo lại phase init khi mở)`);

  // 3. Xoá summaries
  const delSummaries = await db.delete(projectSummaries).where(eq(projectSummaries.projectId, pid));
  console.log(`🗑  Summaries: xoá ${delSummaries.rowCount ?? 0}`);

  // 4. Xoá syncLogs (tuỳ chọn)
  if (!keepLogs) {
    const delLogs = await db.delete(syncLogs).where(eq(syncLogs.projectId, pid));
    console.log(`🗑  SyncLogs: xoá ${delLogs.rowCount ?? 0}`);
  } else {
    console.log(`ℹ️  SyncLogs: giữ nguyên (--keepLogs)`);
  }

  console.log("");
  console.log(`✅ Reset xong project "${project.name}" (id=${pid}).`);
  console.log("   Data chat (projectChats), members, tasks, config GIỮ NGUYÊN.");
  console.log("   Refresh lại trang để thấy trạng thái sạch.");
}

main()
  .then(() => closePool())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });