import dotenv from "dotenv";
dotenv.config({ path: process.cwd() + "/.env.local" });
import { getDb } from "../src/lib/db";
import { projectChats } from "../src/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { getLatestTimestampMs } from "../src/lib/repo/projectChats";
const db = getDb();

async function main() {
  const wm = await getLatestTimestampMs(29, "[FPTCLOUD] - UICVN", "zalo");
  console.log("WATERMARK:", wm);
  const rows = await db.select({
    sender: projectChats.sender, content: projectChats.content,
    ts: projectChats.timestampMs, mid: projectChats.messageId,
  }).from(projectChats)
    .where(and(eq(projectChats.projectId, 29), eq(projectChats.platform, "zalo"), eq(projectChats.chatName, "[FPTCLOUD] - UICVN")))
    .orderBy(desc(projectChats.timestampMs))
    .limit(6);
  for (const r of rows) {
    console.log(JSON.stringify({ ts: r.ts, sender: r.sender, content: (r.content || "").slice(0, 50), mid: r.mid }));
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
