/* Chạy: npx tsx scripts/check-zalo-single.ts — tổng quan tất cả chat Zalo */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { getDb } from "../src/lib/db";
import { sql } from "drizzle-orm";
async function main() {
  const db = getDb();
  const res = await db.execute(sql`
    SELECT "chatName", "sender", "isMine", COUNT(*) as n
    FROM "projectChats" WHERE "platform" = 'zalo'
    GROUP BY "chatName", "sender", "isMine" ORDER BY "chatName", n DESC
  `);
  for (const r of res.rows as any[]) console.log(String(r.chatName).slice(0,22), "|", r.sender, "| mine:", r.isMine, "|", r.n);
}
main().catch((e) => { console.error(e); process.exit(1); });
