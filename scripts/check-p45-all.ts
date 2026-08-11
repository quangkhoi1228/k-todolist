import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { getDb } from "../src/lib/db";
import { projectChats } from "../src/lib/db/schema";
import { and, eq, like } from "drizzle-orm";

async function main() {
  const db = getDb();
  // All Teams in project 45
  const rows = await db.select({
    sender: projectChats.sender, isMine: projectChats.isMine, content: projectChats.content,
    timestampMs: projectChats.timestampMs, chatName: projectChats.chatName, messageId: projectChats.messageId,
  })
  .from(projectChats)
  .where(and(eq(projectChats.platform, "teams"), eq(projectChats.projectId, 45)))
  .orderBy(projectChats.chatName, projectChats.timestampMs);

  const byChat: Record<string, any[]> = {};
  for (const r of rows) (byChat[r.chatName] ??= []).push(r);

  for (const [chat, msgs] of Object.entries(byChat)) {
    console.log(`\n=== "${chat}" (${msgs.length} msgs) ===`);
    let lastContent = "";
    for (const m of msgs) {
      const ts = new Date(Number(m.timestampMs)).toISOString().slice(0,16);
      const c = (m.content || "").slice(0, 60).replace(/\n/g, " / ");
      console.log(`  [${ts}] me=${m.isMine ? "Y" : "n"} | ${(m.sender || "").padEnd(20)} | "${c}"`);
    }
  }
  console.log(`\nTotal: ${rows.length}`);
}
main().catch(e => { console.error(e); process.exit(1); });
