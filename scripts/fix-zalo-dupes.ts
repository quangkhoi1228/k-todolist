/**
 * Xoá / chuẩn hoá tin nhắn Zalo còn sót messageId dạng cũ (chứa sender).
 *
 * Vấn đề: trước khi sửa `saveMessages` (messageId không còn chứa sender),
 * messageId có dạng `<pid>_zalo_<epoch>_<SENDER>_<content>`. Khi sync lại,
 * messageId mới `<pid>_zalo_<epoch>_<content>` khác → upsert không đè được
 * → row cũ trở thành duplicate hiển thị.
 *
 * Xử lý từng row cũ:
 *   1. Nếu row mới (messageId sạch, cùng project/chat) ĐÃ TỒN TẠI → row cũ
 *      là duplicate → xoá.
 *   2. Nếu CHƯA có row mới → migrate messageId của row cũ sang format sạch
 *      (giữ nguyên nội dung) để lần sync sau upsert đúng, không tạo duplicate.
 *
 * Chạy: npx tsx scripts/fix-zalo-dupes.ts
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { getDb } from "../src/lib/db";
import { projectChats } from "../src/lib/db";

async function main() {
  const db = getDb();

  const rows = await db
    .select()
    .from(projectChats)
    .where(
      sql`${projectChats.platform} = 'zalo' AND ${projectChats.messageId} LIKE '%\_zalo\_%'`
    );

  // Format mới: pid_zalo_<epoch>_<content> — chỉ 1 segment sau epoch.
  // Format cũ:  pid_zalo_<epoch>_<SENDER>_<content> — >= 2 segment sau epoch.
  const oldRows = rows.filter((row) => {
    const after = (row.messageId as string).split("_zalo_")[1];
    if (!after) return false;
    return after.split("_").length >= 2;
  });
  console.log(`Tìm thấy ${oldRows.length} row messageId cũ (chứa sender)`);

  let deleted = 0;
  let migrated = 0;
  let skipped = 0;
  for (const row of oldRows) {
    const after = (row.messageId as string).split("_zalo_")[1]!;
    const segs = after.split("_");
    const contentRest = segs.slice(2).join("_");
    const cand = `${row.projectId}_zalo_${segs[0]}_${contentRest}`;
    if (!contentRest) {
      skipped++;
      continue;
    }

    // Row mới cùng project + messageId sạch (loại trừ chính row đang xét)
    const newer = await db
      .select({ id: projectChats.id })
      .from(projectChats)
      .where(
        sql`${projectChats.projectId} = ${row.projectId} AND ${projectChats.messageId} = ${cand} AND ${projectChats.id} <> ${row.id}`
      )
      .limit(1);

    if (newer.length > 0) {
      // Đã có bản mới → row cũ là duplicate → xoá
      await db.delete(projectChats).where(sql`${projectChats.id} = ${row.id}`);
      deleted++;
    } else {
      // Chưa có bản mới → migrate messageId sang format sạch
      await db
        .update(projectChats)
        .set({ messageId: cand })
        .where(sql`${projectChats.id} = ${row.id}`);
      migrated++;
    }
  }

  console.log(
    `Xoá ${deleted} row duplicate, migrate ${migrated} row sang messageId sạch, skip ${skipped}.`
  );
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
