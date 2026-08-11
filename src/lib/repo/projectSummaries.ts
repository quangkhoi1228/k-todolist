import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { projectSummaries } from "../db";

export interface SummaryData {
  basic?: Record<string, unknown>;
  status?: Record<string, unknown>;
  nextActions?: Array<Record<string, unknown>>;
  members?: {
    internal?: Array<Record<string, unknown>>;
    customer?: Array<Record<string, unknown>>;
  };
  recentActivity?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

function mapSummary(s: any): any {
  let data: SummaryData = {};
  if (typeof s.summaryData === "string") {
    try {
      data = JSON.parse(s.summaryData);
    } catch {
      data = {};
    }
  } else if (s.summaryData && typeof s.summaryData === "object") {
    data = s.summaryData;
  }
  return {
    ...s,
    summaryData: data,
    _id: String(s.id),
    _creationTime: 0,
    projectId: String(s.projectId),
  };
}

// ─── Queries ───────────────────────────────────────────────
/** Lấy các version tóm tắt, mới nhất trước. */
export async function getSummariesByProject(projectId: number | string, limit = 20) {
  const db = getDb();
  const rows = await db
    .select()
    .from(projectSummaries)
    .where(eq(projectSummaries.projectId, Number(projectId)))
    .orderBy(desc(projectSummaries.version))
    .limit(limit);
  return rows.map(mapSummary);
}

/** Lấy bản tóm tắt mới nhất của project. */
export async function getLatestSummary(projectId: number | string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(projectSummaries)
    .where(eq(projectSummaries.projectId, Number(projectId)))
    .orderBy(desc(projectSummaries.version))
    .limit(1);
  return rows.length > 0 ? mapSummary(rows[0]) : null;
}

// ─── Mutations ─────────────────────────────────────────────
/** Tạo version tóm tắt mới — số version tự tăng theo project. */
export async function createSummary(args: {
  projectId: number | string;
  userId: string;
  trigger: string; // "auto" | "manual"
  summaryText: string;
  summaryData: SummaryData;
}) {
  const db = getDb();
  const pid = Number(args.projectId);
  const latest = await getLatestSummary(pid);
  const nextVersion = (latest?.version ?? 0) + 1;
  const res = await db
    .insert(projectSummaries)
    .values({
      projectId: pid,
      userId: args.userId,
      version: nextVersion,
      trigger: args.trigger,
      summaryText: args.summaryText,
      summaryData: args.summaryData as any,
      createdAt: Date.now(),
    })
    .returning();
  return mapSummary(res[0]);
}

export async function deleteSummary(id: number | string) {
  const db = getDb();
  await db.delete(projectSummaries).where(eq(projectSummaries.id, Number(id)));
}

/** Xoá toàn bộ version của 1 project (dọn dữ liệu test). */
export async function deleteSummariesByProject(projectId: number | string) {
  const db = getDb();
  await db
    .delete(projectSummaries)
    .where(eq(projectSummaries.projectId, Number(projectId)));
}

/** Đếm fast check project có bản tóm tắt nào chưa (tránh load hết rows). */
export async function hasSummaries(projectId: number | string) {
  const db = getDb();
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projectSummaries)
    .where(eq(projectSummaries.projectId, Number(projectId)));
  return (rows[0]?.count ?? 0) > 0;
}