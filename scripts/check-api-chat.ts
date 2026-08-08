/* Chạy: npx tsx scripts/check-api-chat.ts — kiểm tra API trả về chat đơn Zalo đúng sender */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { getDb } from "../src/lib/db";
import { projectChats } from "../src/lib/db/schema";
import { desc, eq } from "drizzle-orm";
async function main() {
  const db = getDb();
  const rows = await db.select({ sender: projectChats.sender, isMine: projectChats.isMine, content: projectChats.content, timestamp: projectChats.timestamp })
    .from(projectChats)
    .where(eq(projectChats.chatName, "Thảo Nguyên BB"))
    .orderBy(desc(projectChats.timestampMs)).limit(10);
  console.log("API data (Thảo Nguyên BB):");
  for (const r of rows) console.log(" ", r.sender, "| mine:", r.isMine, "|", r.timestamp, "|", (r.content||"").slice(0,45).replace(/\n/g," "));
}
main().catch((e) => { console.error(e); process.exit(1); });
