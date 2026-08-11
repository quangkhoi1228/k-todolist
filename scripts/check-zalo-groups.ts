import dotenv from "dotenv";
dotenv.config({ path: process.cwd() + "/.env.local" });
import { getDb } from "../src/lib/db";
import { projectChats } from "../src/lib/db/schema";
import { eq, and, desc } from "drizzle-orm";
const db = getDb();

async function main() {
  // Project 15 UICVN: xem 8 message cuối + toàn bộ messageId
  const rows = await db.select({ ts: projectChats.timestampMs, content: projectChats.content, sender: projectChats.sender, mid: projectChats.messageId, time: projectChats.timestamp })
    .from(projectChats)
    .where(and(eq(projectChats.projectId, 15), eq(projectChats.platform, "zalo"), eq(projectChats.chatName, "[FPTCLOUD] - UICVN")))
    .orderBy(desc(projectChats.timestampMs))
    .limit(10);
  console.log("=== P15 UICVN last 10 ===");
  for (const r of rows) console.log(JSON.stringify({ ts: r.ts, sender: r.sender, content: (r.content || "").slice(0, 50), time: r.time, mid: r.mid }));
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
