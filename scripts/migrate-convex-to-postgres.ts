/* Migrate toàn bộ data từ Convex export (JSONL) sang PostgreSQL.
 *
 * Chạy 1 lần:
 *   1. npx convex export --include-file-storage --path /tmp/convex-export-storage
 *   2. npx tsx scripts/migrate-convex-to-postgres.ts /tmp/convex-export-storage
 *
 * Script đọc:
 *   - <dir>/_storage/         — files từ Convex storage (nếu có)
 *   - <dir>/<table>/documents.jsonl — documents mỗi bảng
 *
 * Mapping:
 *   - _id (string) → id (number): giữ bảng ánh xạ để remap FK (project, taskId, ...)
 *   - _creationTime → createdAt (nếu bảng có cột)
 *   - storage:{id} trong chat images/avatars → data URL của file đã tải về,
 *     đồng thời insert vào bảng files để phục vụ GET /api/data/files/{id}.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import * as fs from "fs";
import * as path from "path";
import { Pool } from "pg";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

// ─── Config ─────────────────────────────────────────────────
const EXPORT_DIR = process.argv[2] || path.join(PROJECT_ROOT, ".convex-export");
const STORAGE_DIR = path.join(EXPORT_DIR, "_storage");
const USER_ID_FALLBACK = process.env.MIGRATE_USER_ID; // nếu thiếu userId (không nên có)

// ─── Tables: [tên bảng, có cột _creationTime → createdAt không] ──
const TABLES: Array<{ name: string; hasCreationTime?: boolean }> = [
  { name: "scrapedGroups" },
  { name: "projects", hasCreationTime: true },
  { name: "tasks", hasCreationTime: true },
  { name: "taskDependencies" },
  { name: "userPreferences" },
  { name: "notes", hasCreationTime: true },
  { name: "pmAgentSessions" },
  { name: "pmAgentMessages" },
  { name: "projectSuggestions" },
  { name: "projectChats" },
  { name: "syncLogs" },
  { name: "sentEmails" },
  { name: "knownRecipients" },
  { name: "projectRoles" },
  { name: "projectMembers" },
  { name: "projectIsdData" },
];

// ─── ID remap ───────────────────────────────────────────────
const idMap = new Map<string, number>(); // convexId → pgId (bigserial)

// Collect all convex project IDs referenced by other tables (chats, suggestions,
// logs, ...) so we can create placeholder projects for missing ones.
const referencedProjectIds = new Set<string>();

// ─── Storage files ──────────────────────────────────────────
interface StorageFileInfo {
  id: string; // convex storage id (e.g. kg2010...)
  path: string; // local file path
  contentType: string;
}
const storageFiles = new Map<string, StorageFileInfo>();

function loadStorageFiles() {
  if (!fs.existsSync(STORAGE_DIR)) return;
  const manifest = path.join(STORAGE_DIR, "documents.jsonl");
  if (!fs.existsSync(manifest)) return;

  for (const line of fs.readFileSync(manifest, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    const doc = JSON.parse(line);
    const id = doc._id;
    if (!id) continue;
    // Files on disk have an extension suffix (e.g. kg123.jpeg) — find by prefix.
    const entries = fs.readdirSync(STORAGE_DIR).filter((f) => f.startsWith(id) && f !== "documents.jsonl");
    if (entries.length > 0) {
      storageFiles.set(id, {
        id,
        path: path.join(STORAGE_DIR, entries[0]),
        contentType: doc.contentType || "application/octet-stream",
      });
    }
  }
  console.log(`[Storage] Loaded ${storageFiles.size} files from Convex storage export.`);
}

function storageIdToDataUrl(storageId: string): string | null {
  const info = storageFiles.get(storageId);
  if (!info) return null;
  const buf = fs.readFileSync(info.path);
  const base64 = buf.toString("base64");
  return `data:${info.contentType};base64,${base64}`;
}

// ─── Value transformers ─────────────────────────────────────
const EMPTY_STRING_FIELDS: Record<string, string[]> = {
  tasks: ["title", "estimatedTime"],
};

/** Chuyển value từ Convex doc → value hợp lệ cho Postgres insert. */
function toPgValue(table: string, key: string, value: any): any {
  // Booleans: Postgres boolean — JSONL export dùng Python-style True/False (hợp lệ JSON) nên ok
  if (value === undefined) return undefined;

  // Các field bắt buộc NOT NULL cần có giá trị
  if (EMPTY_STRING_FIELDS[table]?.includes(key)) {
    if (value === null || value === undefined) return "";
  }

  return value;
}

// Column whitelist mapped away from table name
const tableColumns = new Map<string, Set<string>>();

async function loadTableColumns(client: any) {
  const res = await client.query(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_name = ANY($1)`,
    [TABLES.map((t) => t.name).concat("files")]
  );
  for (const row of res.rows) {
    if (!tableColumns.has(row.table_name)) tableColumns.set(row.table_name, new Set());
    tableColumns.get(row.table_name)!.add(row.column_name);
  }
}

// ─── Main ───────────────────────────────────────────────────
async function main() {
  if (!fs.existsSync(path.join(EXPORT_DIR, "_tables", "documents.jsonl"))) {
    console.error(
      `❌ Không thấy Convex export tại ${EXPORT_DIR}. Chạy trước:\n` +
      `  npx convex export --include-file-storage --path ${EXPORT_DIR}`
    );
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("❌ Missing DATABASE_URL");
    process.exit(1);
  }

  loadStorageFiles();

  const pool = new Pool({ connectionString: url, max: 10 });
  const client = await pool.connect();
  console.log("✅ Connected to Postgres");
  await loadTableColumns(client);

  // Track per-table counts
  const counts: Record<string, number> = {};

  // ── 1. Files (storage) ────────────────────────────────────
  // Insert storage files vào bảng files trước, lưu idMap cho storageId → pg fileId
  const storageIdToPgId = new Map<string, number>();
  if (storageFiles.size > 0) {
    console.log("\n[Migrate] Inserting storage files...");
    for (const [storageId, info] of storageFiles) {
      const dataUrl = storageIdToDataUrl(storageId)!;
      const size = fs.statSync(info.path).size;
      const res = await client.query(
        `INSERT INTO files ("userId", name, "mimeType", size, data, "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          USER_ID_FALLBACK || "",
          `storage-${storageId}`,
          info.contentType,
          size,
          dataUrl,
          Date.now(),
        ]
      );
      storageIdToPgId.set(storageId, res.rows[0].id);
    }
    console.log(`[Migrate] Inserted ${storageFiles.size} storage files into "files".`);
  }

  // ── 2. Pre-scan referenced project IDs ────────────────────
  // (chats, suggestions, logs, ... may reference projects that no longer exist)
  for (const { name: table } of TABLES) {
    const docFile = path.join(EXPORT_DIR, table, "documents.jsonl");
    if (!fs.existsSync(docFile)) continue;
    const lines = fs.readFileSync(docFile, "utf-8").split("\n").filter(Boolean);
    for (const line of lines) {
      const doc = JSON.parse(line);
      if (doc.projectId) referencedProjectIds.add(doc.projectId);
    }
  }
  const exportedProjectIds = new Set<string>();
  const projectDocFile = path.join(EXPORT_DIR, "projects", "documents.jsonl");
  if (fs.existsSync(projectDocFile)) {
    for (const line of fs.readFileSync(projectDocFile, "utf-8").split("\n").filter(Boolean)) {
      exportedProjectIds.add(JSON.parse(line)._id);
    }
  }
  const missingProjectIds = [...referencedProjectIds].filter((id) => !exportedProjectIds.has(id));
  if (missingProjectIds.length > 0) {
    console.log(`\n[Migrate] Creating ${missingProjectIds.length} placeholder projects for deleted projects...`);
    for (const pid of missingProjectIds) {
      const res = await client.query(
        `INSERT INTO projects ("userId", name, archived) VALUES ($1, $2, $3) RETURNING id`,
        [USER_ID_FALLBACK || "", `[Migrated] ${pid}`, true]
      );
      idMap.set(pid, res.rows[0].id);
    }
  }

  // ── 3. Tables ─────────────────────────────────────────────
  for (const { name: table, hasCreationTime } of TABLES) {
    const docFile = path.join(EXPORT_DIR, table, "documents.jsonl");
    if (!fs.existsSync(docFile)) {
      console.log(`[Migrate] Skipping "${table}" (no export file).`);
      continue;
    }

    const lines = fs.readFileSync(docFile, "utf-8").split("\n").filter(Boolean);
    console.log(`\n[Migrate] ${table}: ${lines.length} documents...`);

    let inserted = 0;
    let skipped = 0;

    for (const line of lines) {
      const doc = JSON.parse(line);
      const convexId = doc._id;
      const creationTime = doc._creationTime;

      // Remap FK fields
      const row: Record<string, any> = { ...doc };
      delete row._id;
      delete row._creationTime;

      // Project/task/note/session/role FK remaps
      const fkFields: Record<string, string[]> = {
        tasks: ["project"],
        taskDependencies: ["taskId", "dependsOnTaskId"],
        notes: ["projectId", "parentNoteId"],
        pmAgentSessions: ["projectId"],
        pmAgentMessages: ["sessionId"],
        projectSuggestions: ["projectId"],
        projectChats: ["projectId"],
        syncLogs: ["projectId"],
        sentEmails: ["projectId"],
        projectMembers: ["projectId", "roleId"],
        projectIsdData: ["projectId"],
      };

      for (const fk of fkFields[table] || []) {
        if (row[fk] !== undefined && row[fk] !== null) {
          const pgId = idMap.get(row[fk]);
          if (pgId !== undefined) {
            row[fk] = pgId;
          } else {
            // FK trỏ tới doc không có trong export — drop (sẽ là NULL/error tuỳ cột)
            row[fk] = null;
          }
        }
      }

      // Array → JSON (chỉ khi column jsonb và value là array/object)
      for (const key of Object.keys(row)) {
        if (row[key] !== null && typeof row[key] === "object" && !Buffer.isBuffer(row[key])) {
          row[key] = JSON.stringify(row[key]);
        }
      }

      // Storage refs trong projectChats images/senderAvatar
      if (table === "projectChats") {
        for (const field of ["images", "senderAvatar"]) {
          const v = row[field];
          if (typeof v === "string" && v.includes("storage:")) {
            if (field === "images") {
              const urls = JSON.parse(v) as string[];
              const resolved: string[] = [];
              for (const u of urls) {
                if (u.startsWith("storage:")) {
                  const pgFileId = storageIdToPgId.get(u.slice(8));
                  if (pgFileId !== undefined) {
                    resolved.push(`/api/data/files/${pgFileId}`);
                  }
                  // storage file không có — drop khỏi list
                } else {
                  resolved.push(u);
                }
              }
              row[field] = JSON.stringify(resolved);
            } else if (field === "senderAvatar" && v.startsWith("storage:")) {
              const pgFileId = storageIdToPgId.get(v.slice(8));
              row[field] = pgFileId !== undefined ? `/api/data/files/${pgFileId}` : null;
            }
          }
        }
      }

      // created_at from _creationTime
      if (hasCreationTime && creationTime !== undefined && row.createdAt === undefined) {
        row.createdAt = Math.round(creationTime);
      }

      // Fallback userId (không nên xảy ra)
      if (row.userId === undefined && USER_ID_FALLBACK) {
        row.userId = USER_ID_FALLBACK;
      }

      // Filter to only columns that exist in the Postgres table
      const cols = tableColumns.get(table);
      if (cols) {
        for (const k of Object.keys(row)) {
          if (!cols.has(k)) delete row[k];
        }
      }

      // Build INSERT
      const keys = Object.keys(row).filter((k) => row[k] !== undefined);
      if (keys.length === 0) {
        skipped++;
        continue;
      }

      const values = keys.map((k) => toPgValue(table, k, row[k]));
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
      const quotedKeys = keys.map((k) => `"${k}"`).join(", ");

      try {
        const res = await client.query(
          `INSERT INTO "${table}" (${quotedKeys}) VALUES (${placeholders}) RETURNING id`,
          values
        );
        idMap.set(convexId, res.rows[0].id);
        inserted++;
      } catch (err: any) {
        // Duplicate unique key (e.g. taskDeps_unique) — skip silently if identical
        if (err.code === "23505") {
          skipped++;
          continue;
        }
        console.error(`[Migrate] ${table}: insert error: ${err.message}`);
        console.error(`  doc: ${JSON.stringify(row).slice(0, 300)}`);
        skipped++;
      }
    }

    counts[table] = inserted;
    console.log(`[Migrate] ${table}: inserted ${inserted}, skipped ${skipped}.`);
  }

  await client.release();
  await pool.end();

  console.log("\n✅ Migration complete!");
  console.log("Counts:", JSON.stringify(counts, null, 2));
}

main().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
