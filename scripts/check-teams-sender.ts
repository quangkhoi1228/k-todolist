/* Chạy: npx tsx scripts/check-teams-sender.ts [PROJECT_ID] [PLATFORM] [CHAT_NAME_FILTER] */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { getDb } from "../src/lib/db";
import { projectChats } from "../src/lib/db/schema";
import { and, eq, like, sql } from "drizzle-orm";

async function main() {
  const db = getDb();
  const platform = process.argv[3] || "teams";
  const pid = Number(process.argv[2] || 45);
  const filter = process.argv[4] || "Hackathon";

  const rows = await db
    .select({
      id: projectChats.id,
      sender: projectChats.sender,
      isMine: projectChats.isMine,
      content: projectChats.content,
      timestampMs: projectChats.timestampMs,
      chatName: projectChats.chatName,
      messageId: projectChats.messageId,
      timestamp: projectChats.timestamp,
    })
    .from(projectChats)
    .where(and(eq(projectChats.platform, platform), eq(projectChats.projectId, pid), like(projectChats.chatName, `%${filter}%`)))
    .orderBy(projectChats.timestampMs)
    .limit(200);

  console.log(`\n=== Platform=${platform} Project=${pid} chat~"${filter}" === Total ${rows.length} rows`);
  const bySender: Record<string, number> = {};
  for (const r of rows) bySender[r.sender || ""] = (bySender[r.sender || ""] || 0) + 1;
  console.log("By sender:");
  for (const [k, v] of Object.entries(bySender).sort((a, b) => b[1] - a[1])) console.log(`  "${k}": ${v}`);

  console.log("\nAll messages (chronological):");
  for (const r of rows) {
    const c = (r.content || "").slice(0, 90).replace(/\n/g, " / ");
    const ts = Number(r.timestampMs);
    const when = new Date(ts).toISOString().slice(0, 16);
    console.log(`  [${when}] me=${r.isMine === true ? "Y" : "n"} | ${r.sender?.slice(0, 20).padEnd(20)} | ${c}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
