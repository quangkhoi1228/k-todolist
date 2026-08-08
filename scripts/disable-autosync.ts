import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { getDb } from "../src/lib/db";
import { userPreferences } from "../src/lib/db/schema";
import { sql } from "drizzle-orm";
async function main() {
  const db = getDb();
  await db.execute(sql`UPDATE "userPreferences" SET "autoSyncInterval" = 0`);
  console.log("Đã tắt auto-sync (autoSyncInterval=0)");
}
main().catch((e) => { console.error(e); process.exit(1); });
