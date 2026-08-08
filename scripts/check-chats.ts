/* Chạy: npx tsx scripts/check-chats.ts — xem tin nhắn gần nhất project 45 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { getDb } from "../src/lib/db";
import { projectChats } from "../src/lib/db/schema";
import { desc, eq } from "drizzle-orm";
async function main() {
  const db = getDb();
  const rows = await db.select({ chatName: projectChats.chatName, sender: projectChats.sender, isMine: projectChats.isMine, content: projectChats.content, timestampMs: projectChats.timestampMs }).from(projectChats).where(eq(projectChats.projectId, 45)).orderBy(desc(projectChats.timestampMs)).limit(15);
  for (const r of rows) {
    console.log(r.chatName?.slice(0,20), "|", r.sender?.slice(0,25), "| mine:", r.isMine, "|", (r.content || "").slice(0, 60).replace(/\n/g, " "));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
