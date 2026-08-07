import { and, desc, eq, lte, or } from "drizzle-orm";
import { getDb } from "../db";
import { syncLogs } from "../db";

function mapLog(l: any): any {
  return {
    ...l,
    _id: String(l.id),
    _creationTime: l.createdAt ?? 0,
    projectId: l.projectId !== null ? String(l.projectId) : undefined,
  };
}

// ─── Queries ───────────────────────────────────────────────
export async function getLogs(opts: { projectId?: number | string; userId?: string; limit?: number }) {
  const db = getDb();
  const limit = opts.limit ?? 100;
  let rows: any[];
  if (opts.projectId) {
    rows = await db
      .select()
      .from(syncLogs)
      .where(eq(syncLogs.projectId, Number(opts.projectId)))
      .orderBy(desc(syncLogs.createdAt))
      .limit(limit);
  } else if (opts.userId) {
    // Không có projectId nhưng có userId — chỉ trả log thuộc user đó
    // (log gắn project: userId đã được gán khi ghi; log toàn cục không thuộc ai → không hiện)
    rows = await db
      .select()
      .from(syncLogs)
      .where(eq(syncLogs.userId, opts.userId))
      .orderBy(desc(syncLogs.createdAt))
      .limit(limit);
  } else {
    rows = await db.select().from(syncLogs).orderBy(desc(syncLogs.createdAt)).limit(limit);
  }
  return rows.map(mapLog);
}

export async function getLogsPaginated(opts: {
  projectId?: number | string;
  userId?: string;
  cursor?: number | null;
  limit?: number;
}) {
  const db = getDb();
  const limit = Math.min(opts.limit ?? 50, 100);

  let rows: any[];
  if (opts.projectId) {
    rows = await db
      .select()
      .from(syncLogs)
      .where(
        and(
          eq(syncLogs.projectId, Number(opts.projectId)),
          opts.cursor ? lte(syncLogs.createdAt, opts.cursor) : undefined
        )
      )
      .orderBy(desc(syncLogs.createdAt))
      .limit(limit + 1);
  } else if (opts.userId) {
    rows = await db
      .select()
      .from(syncLogs)
      .where(
        and(
          eq(syncLogs.userId, opts.userId),
          opts.cursor ? lte(syncLogs.createdAt, opts.cursor) : undefined
        )
      )
      .orderBy(desc(syncLogs.createdAt))
      .limit(limit + 1);
  } else {
    rows = await db
      .select()
      .from(syncLogs)
      .where(opts.cursor ? lte(syncLogs.createdAt, opts.cursor) : undefined)
      .orderBy(desc(syncLogs.createdAt))
      .limit(limit + 1);
  }

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const nextCursor = hasMore ? page[page.length - 1].createdAt : null;

  return {
    results: page.map(mapLog),
    hasMore,
    nextCursor,
    isDone: !hasMore,
  };
}

export async function getRecentLogs(opts: { type?: string; userId?: string; limit?: number }) {
  const db = getDb();
  const limit = opts.limit ?? 50;
  let rows: any[];
  if (opts.userId) {
    rows = await db
      .select()
      .from(syncLogs)
      .where(
        and(
          opts.type ? eq(syncLogs.type, opts.type) : undefined,
          eq(syncLogs.userId, opts.userId)
        )
      )
      .orderBy(desc(syncLogs.createdAt))
      .limit(limit);
  } else if (opts.type) {
    rows = await db
      .select()
      .from(syncLogs)
      .where(eq(syncLogs.type, opts.type))
      .orderBy(desc(syncLogs.createdAt))
      .limit(limit);
  } else {
    rows = await db.select().from(syncLogs).orderBy(desc(syncLogs.createdAt)).limit(limit);
  }
  return rows.map(mapLog);
}

// ─── Mutations ─────────────────────────────────────────────
export async function addLog(args: {
  projectId?: number | string;
  userId?: string;
  chatName?: string;
  type: string;
  message: string;
  details?: string;
}) {
  const db = getDb();
  await db.insert(syncLogs).values({
    projectId: args.projectId ? Number(args.projectId) : null,
    userId: args.userId ?? null,
    chatName: args.chatName ?? null,
    type: args.type,
    message: args.message,
    details: args.details ?? null,
    createdAt: Date.now(),
  });
}

export async function addLogsBatch(logs: Array<{
  projectId?: number | string;
  userId?: string;
  chatName?: string;
  type: string;
  message: string;
  details?: string;
}>) {
  const db = getDb();
  const now = Date.now();
  for (const log of logs) {
    await db.insert(syncLogs).values({
      projectId: log.projectId ? Number(log.projectId) : null,
      userId: log.userId ?? null,
      chatName: log.chatName ?? null,
      type: log.type,
      message: log.message,
      details: log.details ?? null,
      createdAt: now,
    });
  }
}

export async function clearLogs(before?: number) {
  const db = getDb();
  const cutoff = before ?? Date.now() - 7 * 24 * 60 * 60 * 1000;
  const rows = await db
    .select()
    .from(syncLogs)
    .where(lte(syncLogs.createdAt, cutoff))
    .limit(500);
  for (const r of rows) {
    await db.delete(syncLogs).where(eq(syncLogs.id, r.id));
  }
  return { deleted: rows.length };
}