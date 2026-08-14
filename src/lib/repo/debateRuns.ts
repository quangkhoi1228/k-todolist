import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { debateRuns } from "../db";

/**
 * Repository cho bảng debateRuns — lưu lịch sử mỗi lần chạy AI Debate
 * (multi-agent analyse-suggestions pipeline) cho 1 project.
 */

type DebateResult = Record<string, unknown>;

function mapRun(r: any): any {
  let result: DebateResult = {};
  if (typeof r.result === "string") {
    try {
      result = JSON.parse(r.result);
    } catch {
      result = {};
    }
  } else if (r.result && typeof r.result === "object") {
    result = r.result as DebateResult;
  }
  return {
    ...r,
    result,
    _id: String(r.id),
    _creationTime: r.createdAt ?? 0,
    projectId: String(r.projectId),
  };
}

export interface CreateDebateRunArgs {
  projectId: number | string;
  userId: string;
  result: DebateResult;
  suggestionCount?: number;
  conflictCount?: number;
  totalMs?: number;
  groupCount?: number;
}

// ─── Queries ───────────────────────────────────────────────
/** Lấy danh sách debate runs của 1 project, mới nhất trước. */
export async function getDebateRunsByProject(projectId: number | string, limit = 30) {
  const db = getDb();
  const rows = await db
    .select()
    .from(debateRuns)
    .where(eq(debateRuns.projectId, Number(projectId)))
    .orderBy(desc(debateRuns.createdAt))
    .limit(limit);
  return rows.map(mapRun);
}

/** Lấy 1 debate run theo id (để xem chi tiết trace). */
export async function getDebateRunById(id: number | string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(debateRuns)
    .where(eq(debateRuns.id, Number(id)))
    .limit(1);
  return rows.length > 0 ? mapRun(rows[0]) : null;
}

/** Đếm nhanh có bao nhiêu debate run thuộc 1 project. */
export async function getDebateRunCountByProject(projectId: number | string) {
  const db = getDb();
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(debateRuns)
    .where(eq(debateRuns.projectId, Number(projectId)));
  return rows[0]?.count ?? 0;
}

// ─── Mutations ─────────────────────────────────────────────
/** Lưu 1 debate run mới. */
export async function createDebateRun(args: CreateDebateRunArgs) {
  const db = getDb();
  const res = await db
    .insert(debateRuns)
    .values({
      projectId: Number(args.projectId),
      userId: args.userId,
      result: args.result as any,
      suggestionCount: args.suggestionCount ?? 0,
      conflictCount: args.conflictCount ?? 0,
      totalMs: args.totalMs ?? 0,
      groupCount: args.groupCount ?? 0,
      createdAt: Date.now(),
    })
    .returning();
  return mapRun(res[0]);
}

/** Xoá 1 debate run. */
export async function deleteDebateRun(id: number | string) {
  const db = getDb();
  await db.delete(debateRuns).where(eq(debateRuns.id, Number(id)));
}

/** Xoá toàn bộ debate runs của 1 project. */
export async function deleteDebateRunsByProject(projectId: number | string) {
  const db = getDb();
  await db
    .delete(debateRuns)
    .where(eq(debateRuns.projectId, Number(projectId)));
}
