import { asc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { taskTemplates } from "../db";

export interface TaskTemplateItem {
  phase: string;
  title: string;
  details?: string;
  support?: string;
  manday?: number;
  startOffsetDays?: number;
  endOffsetDays?: number;
  isGroup?: boolean;
}

export function mapTemplate(t: any): any {
  return {
    ...t,
    _id: String(t.id),
    _creationTime: t.createdAt ?? 0,
    items: typeof t.items === "string" ? JSON.parse(t.items) : (t.items ?? []),
    triggers: typeof t.triggers === "string" ? JSON.parse(t.triggers) : (t.triggers ?? []),
  };
}

// ─── Queries ───────────────────────────────────────────────
// Template dùng chung cho mọi user — không lọc theo userId.
export async function getTaskTemplates(_userId?: string | null, includeInactive = false) {
  const db = getDb();
  const rows = await db
    .select()
    .from(taskTemplates)
    .where(includeInactive ? undefined : eq(taskTemplates.isActive, true))
    .orderBy(asc(taskTemplates.createdAt));
  return rows.map(mapTemplate);
}

export async function getTaskTemplate(id: number | string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(taskTemplates)
    .where(eq(taskTemplates.id, Number(id)));
  return rows[0] ? mapTemplate(rows[0]) : null;
}

// Auto-detect template phù hợp từ mô tả dự án (project name/notes/ticket summary)
export async function detectTemplateForProject(_userId: string, text: string) {
  const db = getDb();
  const templates = await db
    .select()
    .from(taskTemplates)
    .where(eq(taskTemplates.isActive, true));
  const lower = (text || "").toLowerCase();
  let best: any = null;
  let bestScore = 0;
  for (const t of templates) {
    const triggers: string[] = Array.isArray(t.triggers) ? t.triggers : [];
    let score = 0;
    for (const kw of triggers) {
      if (lower.includes(kw.toLowerCase())) score += kw.length;
    }
    // Name/description keywords also count
    const allText = `${t.name} ${t.description || ""}`.toLowerCase();
    for (const kw of triggers) {
      if (allText.includes(kw.toLowerCase())) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return bestScore > 0 ? mapTemplate(best) : null;
}

// ─── Mutations ─────────────────────────────────────────────
export async function createTaskTemplate(args: {
  userId?: string | null;
  name: string;
  category?: string;
  description?: string;
  items: TaskTemplateItem[];
  triggers?: string[];
}) {
  const db = getDb();
  const now = Date.now();
  const res = await db
    .insert(taskTemplates)
    .values({
      userId: args.userId ?? null,
      name: args.name,
      category: args.category ?? null,
      description: args.description ?? null,
      items: args.items,
      triggers: args.triggers ?? null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return mapTemplate(res[0]);
}

export async function updateTaskTemplate(
  id: number | string,
  args: Partial<{
    name: string;
    category: string;
    description: string;
    items: TaskTemplateItem[];
    triggers: string[];
    isActive: boolean;
  }>
) {
  const db = getDb();
  const patch: Record<string, unknown> = { updatedAt: Date.now() };
  if (args.name !== undefined) patch.name = args.name;
  if (args.category !== undefined) patch.category = args.category;
  if (args.description !== undefined) patch.description = args.description;
  if (args.items !== undefined) patch.items = args.items;
  if (args.triggers !== undefined) patch.triggers = args.triggers;
  if (args.isActive !== undefined) patch.isActive = args.isActive;
  const res = await db
    .update(taskTemplates)
    .set(patch)
    .where(eq(taskTemplates.id, Number(id)))
    .returning();
  return res[0] ? mapTemplate(res[0]) : null;
}

export async function deleteTaskTemplate(id: number | string, _userId?: string) {
  const db = getDb();
  const res = await db
    .delete(taskTemplates)
    .where(eq(taskTemplates.id, Number(id)))
    .returning();
  return res.length > 0;
}
