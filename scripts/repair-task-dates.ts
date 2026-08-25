/* Repair task timestamps corrupted by float32 (real) column rounding.
 *
 * Background: tasks.startDate/endDate were stored as PostgreSQL `real`
 * (single-precision float). At epoch-ms magnitude (~1.75e12) the float32
 * ULP is ~131072 ms (~2 min), so midnight values drifted to 23:58-23:59 of
 * the previous day (or 00:00-00:01 of the intended day), shifting tasks to
 * the wrong day in the Workload view. The schema has been changed to
 * double precision; this script snaps existing values to the nearest
 * 15-minute boundary to restore the intended day and a clean time.
 *
 * Chạy dry-run:  npx tsx scripts/repair-task-dates.ts
 * Chạy thật:     npx tsx scripts/repair-task-dates.ts --apply
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { Pool } from "pg";

const SNAP_MIN = 15;
const apply = process.argv.includes("--apply");

function snap(ts: number): number {
  const d = new Date(ts);
  const rounded = Math.round(d.getMinutes() / SNAP_MIN) * SNAP_MIN;
  d.setMinutes(rounded, 0, 0);
  return d.getTime();
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("❌ Chưa có DATABASE_URL trong .env.local");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 10000 });

  const res = await pool.query(
    `SELECT id, title, "startDate", "endDate" FROM tasks WHERE "startDate" IS NOT NULL ORDER BY id`
  );
  const rows = res.rows;
  console.log(`Tổng task có startDate: ${rows.length} (mode: ${apply ? "APPLY" : "dry-run"})`);

  const changed: Array<{ id: number; title: string; oldS: number; newS: number; oldE: number | null; newE: number | null }> = [];

  for (const r of rows) {
    const s = Number(r.startDate);
    const e = r.endDate === null ? null : Number(r.endDate);
    const newS = snap(s);
    let newE: number | null = e;
    if (e !== null) {
      // Preserve original duration when snapping endDate
      const delta = e - s;
      newE = newS + delta;
    }
    if (newS !== s || newE !== e) {
      changed.push({ id: r.id, title: r.title, oldS: s, newS, oldE: e, newE });
    }
  }

  console.log(`Task cần sửa: ${changed.length}\n`);
  for (const c of changed) {
    const d = new Date(c.oldS).toString();
    const nd = new Date(c.newS).toString();
    console.log(`#${c.id} "${c.title}"`);
    console.log(`   startDate: ${c.oldS} (${d})`);
    console.log(`           -> ${c.newS} (${nd})`);
    if (c.newE !== null && c.newE !== c.oldE) {
      console.log(`   endDate:   ${c.oldE} -> ${c.newE}`);
    }
  }

  if (!apply) {
    console.log("\n🔍 Dry-run — chạy lại với --apply để ghi DB.");
    await pool.end();
    return;
  }

  // Apply in a transaction
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const c of changed) {
      await client.query(
        `UPDATE tasks SET "startDate" = $1, "endDate" = $2 WHERE id = $3`,
        [c.newS, c.newE, c.id]
      );
    }
    await client.query("COMMIT");
    console.log(`\n✅ Đã cập nhật ${changed.length} task.`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  await pool.end();
}

main();
