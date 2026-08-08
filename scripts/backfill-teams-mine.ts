/* Chạy: USER_ID=user_xxx npx tsx scripts/backfill-teams-mine.ts
 * Gán isMine=true + sender="Me" cho tin Teams lịch sử do chính user gửi
 * (sender khớp "Khoi Tran Quang" / "khoitq3" — xem src/lib/repo/projectChats.ts).
 * Không USER_ID → quét toàn bộ DB. */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { backfillTeamsIsMine } from "../src/lib/repo/projectChats";

async function main() {
  const userId = process.env.USER_ID;
  const result = await backfillTeamsIsMine(userId ? { userId } : {});
  console.log(`[Backfill] scanned=${result.scanned} updated=${result.updated}${userId ? ` (userId=${userId})` : " (ALL)"}`);
}
main().catch((e) => { console.error(e); process.exit(1); });