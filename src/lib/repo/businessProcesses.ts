import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import { businessProcesses } from "../db";

function mapProcess(p: any): any {
  return {
    ...p,
    _id: String(p.id),
    _creationTime: p.createdAt ?? 0,
  };
}

// ─── Queries ───────────────────────────────────────────────
export async function getBusinessProcesses(userId: string, includeInactive = false) {
  const db = getDb();
  const rows = await db
    .select()
    .from(businessProcesses)
    .where(
      and(
        eq(businessProcesses.userId, userId),
        includeInactive ? undefined : eq(businessProcesses.isActive, true)
      )
    )
    .orderBy(desc(businessProcesses.updatedAt));
  return rows.map(mapProcess);
}

export async function getBusinessProcess(id: number | string) {
  const db = getDb();
  const row = await db
    .select()
    .from(businessProcesses)
    .where(eq(businessProcesses.id, Number(id)))
    .limit(1);
  return row[0] ? mapProcess(row[0]) : null;
}

/**
 * Tìm quy trình khớp với bối cảnh hiện tại — dùng cho LLM gợi ý tham khảo.
 * Match theo: từ khoá trong triggers (LIKE) + category + tên/mô tả.
 */
export async function searchBusinessProcesses(userId: string, keywords: string[], category?: string, limit = 5) {
  const db = getDb();
  const kw = keywords.filter(Boolean).map((k) => k.trim().toLowerCase());
  const conditions: any[] = [eq(businessProcesses.userId, userId), eq(businessProcesses.isActive, true)];

  if (category) {
    conditions.push(eq(businessProcesses.category, category));
  }

  if (kw.length > 0) {
    const likeConds = kw.map((k) =>
      or(
        ilike(businessProcesses.name, `%${k}%`),
        ilike(businessProcesses.description, `%${k}%`),
        sql`${businessProcesses.triggers}::text ilike ${`%${k}%`}`,
        sql`${businessProcesses.steps}::text ilike ${`%${k}%`}`
      )
    );
    conditions.push(or(...likeConds));
  }

  const rows = await db
    .select()
    .from(businessProcesses)
    .where(and(...conditions))
    .orderBy(desc(businessProcesses.updatedAt))
    .limit(limit);
  return rows.map(mapProcess);
}

// ─── Mutations ─────────────────────────────────────────────
export async function createBusinessProcess(args: {
  userId: string;
  name: string;
  category?: string;
  description: string;
  steps: any[];
  triggers?: string[];
  outcome?: string;
}) {
  const db = getDb();
  const now = Date.now();
  const res = await db
    .insert(businessProcesses)
    .values({
      userId: args.userId,
      name: args.name,
      category: args.category ?? null,
      description: args.description,
      steps: args.steps,
      triggers: args.triggers ?? null,
      outcome: args.outcome ?? null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return mapProcess(res[0]);
}

export async function updateBusinessProcess(
  id: number | string,
  updates: {
    name?: string;
    category?: string;
    description?: string;
    steps?: any[];
    triggers?: string[];
    outcome?: string;
    isActive?: boolean;
  }
) {
  const db = getDb();
  const patch: any = { updatedAt: Date.now() };
  if (updates.name !== undefined) patch.name = updates.name;
  if (updates.category !== undefined) patch.category = updates.category ?? null;
  if (updates.description !== undefined) patch.description = updates.description;
  if (updates.steps !== undefined) patch.steps = updates.steps;
  if (updates.triggers !== undefined) patch.triggers = updates.triggers ?? null;
  if (updates.outcome !== undefined) patch.outcome = updates.outcome ?? null;
  if (updates.isActive !== undefined) patch.isActive = updates.isActive;
  const res = await db
    .update(businessProcesses)
    .set(patch)
    .where(eq(businessProcesses.id, Number(id)))
    .returning();
  return res[0] ? mapProcess(res[0]) : null;
}

export async function deleteBusinessProcess(id: number | string) {
  const db = getDb();
  await db.delete(businessProcesses).where(eq(businessProcesses.id, Number(id)));
  return { ok: true };
}
