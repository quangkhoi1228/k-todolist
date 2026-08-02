/* Test kết nối PostgreSQL.
 * Chạy: npx tsx scripts/test-db.ts
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { Pool } from "pg";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("❌ Chưa có DATABASE_URL trong .env.local");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 10000 });
  try {
    const res = await pool.query("SELECT version() as version, current_database() as db, now() as time");
    const { version, db, time } = res.rows[0];
    console.log("✅ Connected to database:", db);
    console.log("✅ Time:", time.toISOString());
    console.log("✅ PostgreSQL version:", version.split(" on ")[0]);
  } catch (err: any) {
    console.error("❌ Connection failed:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();