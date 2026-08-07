import { getLatestTimestampMs } from "../src/lib/repo/projectChats";
import { getDb } from "../src/lib/db";
import { projectChats } from "../src/lib/db";
import { sql } from "drizzle-orm";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

/* Chạy: npx tsx scripts/check-sync-watermark.ts */
async function main() {
  const db = getDb();
  const rows = await db
    .select({
      projectId: projectChats.projectId,
      chatName: projectChats.chatName,
      platform: projectChats.platform,
      maxTs: sql<number>`max(${projectChats.timestampMs})`,
      cnt: sql<number>`count(*)`,
    })
    .from(projectChats)
    .groupBy(projectChats.projectId, projectChats.chatName, projectChats.platform)
    .orderBy(sql`count(*) desc`)
    .limit(10);
  for (const r of rows) {
    const wm = await getLatestTimestampMs(r.projectId, r.chatName, r.platform ?? undefined);
    console.log(`project=${r.projectId} platform=${r.platform} chat="${r.chatName}" count=${r.cnt} maxTs=${r.maxTs} getLatest=${wm} match=${r.maxTs === wm}`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
