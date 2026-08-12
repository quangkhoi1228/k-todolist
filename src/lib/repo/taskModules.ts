import { asc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { taskModules } from "../db";

export interface ModuleItem {
  phase: string;
  title: string;
  details?: string;
  support?: string;
  manday?: number;
  startOffsetDays?: number;
  endOffsetDays?: number;
  isGroup?: boolean;
}

export function mapModule(m: any): any {
  return {
    ...m,
    _id: String(m.id),
    items: typeof m.items === "string" ? JSON.parse(m.items) : (m.items ?? []),
  };
}

// ─── Queries ───────────────────────────────────────────────
// Module dùng chung cho mọi user — không lọc theo userId.
export async function getTaskModules(_userId?: string | null) {
  const db = getDb();
  const rows = await db
    .select()
    .from(taskModules)
    .orderBy(asc(taskModules.createdAt));
  return rows.map(mapModule);
}

export async function getTaskModule(id: number | string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(taskModules)
    .where(eq(taskModules.id, Number(id)));
  return rows[0] ? mapModule(rows[0]) : null;
}

// ─── Mutations ─────────────────────────────────────────────
export async function createTaskModule(args: {
  userId?: string | null;
  name: string;
  description?: string;
  items: ModuleItem[];
}) {
  const db = getDb();
  const now = Date.now();
  const res = await db
    .insert(taskModules)
    .values({
      userId: args.userId ?? null,
      name: args.name,
      description: args.description ?? null,
      items: args.items,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return mapModule(res[0]);
}

export async function updateTaskModule(
  id: number | string,
  args: Partial<{
    name: string;
    description: string;
    items: ModuleItem[];
  }>
) {
  const db = getDb();
  const patch: Record<string, unknown> = { updatedAt: Date.now() };
  if (args.name !== undefined) patch.name = args.name;
  if (args.description !== undefined) patch.description = args.description;
  if (args.items !== undefined) patch.items = args.items;
  const res = await db
    .update(taskModules)
    .set(patch)
    .where(eq(taskModules.id, Number(id)))
    .returning();
  return res[0] ? mapModule(res[0]) : null;
}

export async function deleteTaskModule(id: number | string, _userId?: string) {
  const db = getDb();
  const res = await db
    .delete(taskModules)
    .where(eq(taskModules.id, Number(id)))
    .returning();
  return res.length > 0;
}

// ─── Expand module references ───────────────────────────────
/**
 * Mở rộng danh sách items của template — thay mỗi item dạng
 * { type: "module", moduleId } bằng các task thật trong module.
 * Item bình thường (có title, không phải module) giữ nguyên.
 * Module dùng chung — không lọc theo userId.
 */
export async function expandTemplateItems(
  _userId: string,
  items: any[]
): Promise<any[]> {
  if (!Array.isArray(items) || items.length === 0) return [];
  const moduleIds = items
    .filter((it: any) => it.type === "module" && it.moduleId)
    .map((it: any) => String(it.moduleId));
  if (moduleIds.length === 0) return items;

  const db = getDb();
  // Module dùng chung — lấy tất cả rồi filter theo moduleId trong-memory
  const allModules = await db.select().from(taskModules);
  const modMap = new Map(allModules.map((m) => [String(m.id), m]));

  const result: any[] = [];
  for (const item of items) {
    if (item.type === "module" && item.moduleId) {
      const mod = modMap.get(String(item.moduleId));
      if (mod) {
        const modItems = typeof mod.items === "string" ? JSON.parse(mod.items) : (mod.items ?? []);
        for (const mi of modItems) {
          if (mi.isGroup || !mi.title) continue;
          result.push({ ...mi });
        }
      }
    } else if (!item.isGroup && item.title) {
      result.push(item);
    }
  }
  return result;
}
