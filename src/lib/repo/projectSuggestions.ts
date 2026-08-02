import { and, desc, eq, isNull, ne, or, lt } from "drizzle-orm";
import { getDb } from "../db";
import { projectSuggestions } from "../db";

function mapSuggestion(s: any): any {
  return {
    ...s,
    _id: String(s.id),
    _creationTime: 0,
    projectId: String(s.projectId),
  };
}

// ─── Queries ───────────────────────────────────────────────
export async function getSuggestionsByProject(projectId: number | string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(projectSuggestions)
    .where(eq(projectSuggestions.projectId, Number(projectId)))
    .orderBy(desc(projectSuggestions.createdAt))
    .limit(50);
  return rows.map(mapSuggestion);
}

export async function getUnresolvedSuggestionsByUser(userId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(projectSuggestions)
    .where(
      and(
        eq(projectSuggestions.userId, userId),
        eq(projectSuggestions.isResolved, false)
      )
    )
    .orderBy(desc(projectSuggestions.createdAt))
    .limit(100);
  return rows.map(mapSuggestion);
}

export async function getUnresolvedCountByUser(userId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(projectSuggestions)
    .where(
      and(
        eq(projectSuggestions.userId, userId),
        eq(projectSuggestions.isResolved, false)
      )
    );
  return rows.length;
}

// ─── Mutations ─────────────────────────────────────────────
export async function addSuggestion(args: {
  projectId: number | string;
  userId: string;
  type: string;
  title: string;
  description: string;
  sourceMessage?: string;
  sourceSender?: string;
  sourceChatName?: string;
  sourceTimestamp?: string;
  actionLabel?: string;
  actionUrl?: string;
  suggestionData?: string;
}) {
  const db = getDb();
  const res = await db
    .insert(projectSuggestions)
    .values({
      projectId: Number(args.projectId),
      userId: args.userId,
      type: args.type,
      title: args.title,
      description: args.description,
      sourceMessage: args.sourceMessage ?? null,
      sourceSender: args.sourceSender ?? null,
      sourceChatName: args.sourceChatName ?? null,
      sourceTimestamp: args.sourceTimestamp ?? null,
      actionLabel: args.actionLabel ?? null,
      actionUrl: args.actionUrl ?? null,
      suggestionData: args.suggestionData ?? null,
      isRead: false,
      isResolved: false,
      createdAt: Date.now(),
    })
    .returning();
  return mapSuggestion(res[0]);
}

export async function markSuggestionAsRead(id: number | string) {
  const db = getDb();
  await db
    .update(projectSuggestions)
    .set({ isRead: true })
    .where(eq(projectSuggestions.id, Number(id)));
}

export async function markSuggestionAsResolved(id: number | string) {
  const db = getDb();
  await db
    .update(projectSuggestions)
    .set({ isResolved: true, isRead: true })
    .where(eq(projectSuggestions.id, Number(id)));
}

export async function markAllAsReadByProject(projectId: number | string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(projectSuggestions)
    .where(
      and(
        eq(projectSuggestions.projectId, Number(projectId)),
        eq(projectSuggestions.isRead, false)
      )
    );
  for (const s of rows) {
    await db
      .update(projectSuggestions)
      .set({ isRead: true })
      .where(eq(projectSuggestions.id, s.id));
  }
  return { updated: rows.length };
}

export async function deleteSuggestion(id: number | string) {
  const db = getDb();
  await db.delete(projectSuggestions).where(eq(projectSuggestions.id, Number(id)));
}

export async function addSuggestionsBatch(args: {
  projectId: number | string;
  userId: string;
  suggestions: Array<{
    type: string;
    title: string;
    description: string;
    sourceMessage?: string;
    sourceSender?: string;
    sourceChatName?: string;
    sourceTimestamp?: string;
    actionLabel?: string;
    actionUrl?: string;
  }>;
}) {
  const db = getDb();
  const pid = Number(args.projectId);

  const existing = await db
    .select()
    .from(projectSuggestions)
    .where(eq(projectSuggestions.projectId, pid));
  const existingKeys = new Set(
    existing.map((s) => `${s.type}|${s.title}|${s.description}`)
  );

  let count = 0;
  const now = Date.now();
  for (const s of args.suggestions) {
    const key = `${s.type}|${s.title}|${s.description}`;
    if (existingKeys.has(key)) continue;
    await db.insert(projectSuggestions).values({
      projectId: pid,
      userId: args.userId,
      type: s.type,
      title: s.title,
      description: s.description,
      sourceMessage: s.sourceMessage ?? null,
      sourceSender: s.sourceSender ?? null,
      sourceChatName: s.sourceChatName ?? null,
      sourceTimestamp: s.sourceTimestamp ?? null,
      actionLabel: s.actionLabel ?? null,
      actionUrl: s.actionUrl ?? null,
      suggestionData: null,
      isRead: false,
      isResolved: false,
      createdAt: now,
    });
    count++;
    existingKeys.add(key);
  }
  return { saved: count };
}