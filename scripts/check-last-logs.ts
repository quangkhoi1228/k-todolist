/* Chạy: npx tsx scripts/check-last-logs.ts — xem 15 log gần nhất */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { getLogs } from "../src/lib/repo/syncLogs";
async function main() {
  const logs = await getLogs({ limit: 15 });
  for (const l of logs) {
    const msg = (l.message || "").slice(0, 120);
    console.log(new Date(l.createdAt).toISOString(), "|", l.projectId ?? "-", "|", l.level ?? "", "|", msg);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
