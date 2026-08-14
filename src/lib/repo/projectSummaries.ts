import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { projectSummaries } from "../db";

export interface ScopeData {
  /** Mục tiêu của dự án */
  goal?: string;
  /** Mô tả tổng quan / phạm vi */
  overview?: string;
  /** Topology / hạ tầng */
  topology?: string;
  /** Timeline / các mốc thời gian */
  timeline?: string;
  [key: string]: unknown;
}

export interface NextStepItem {
  /** Nội dung bước tiếp theo */
  text: string;
  /** Đã hoàn thành chưa */
  done?: boolean;
  /** Nguồn ghi vào: ai / auto:task / ai:suggestion / pm */
  source?: string;
  [key: string]: unknown;
}

export interface SummaryData {
  basic?: Record<string, unknown>;
  status?: Record<string, unknown>;
  nextActions?: Array<Record<string, unknown>>;
  members?: {
    internal?: Array<Record<string, unknown>>;
    customer?: Array<Record<string, unknown>>;
  };
  recentActivity?: Array<Record<string, unknown>>;
  /** KB chung dự án — scope do PM/AI ghi */
  scope?: ScopeData;
  /** KB chung dự án — các bước tiếp theo (checklist) */
  nextSteps?: NextStepItem[];
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

// ─── KB chung dự án — đọc/ghi scope & nextSteps trên bản mới nhất ─────

/** Lấy summaryData (KB) của bản tóm tắt mới nhất — để AI đọc scope/nextSteps bảo toàn. */
export async function getLatestSummaryData(projectId: number | string): Promise<SummaryData> {
  const latest = await getLatestSummary(projectId);
  return latest?.summaryData ?? {};
}

/**
 * Patch (ghi đè/kết hợp) trường vào bản tóm tắt MỚI NHẤT mà KHÔNG tạo version mới.
 * Dùng cho các action ghi KB (tạo task, đổi phase, thêm member, sinh suggestion, PM sửa tay).
 * Nếu project chưa có bản tóm tắt nào → tạo version 1 với summaryData rỗng + patch.
 */
export async function patchLatestSummary(
  projectId: number | string,
  patch: { scope?: Partial<ScopeData>; nextSteps?: NextStepItem[]; members?: Record<string, unknown> },
  opts?: { userId?: string }
) {
  const db = getDb();
  const pid = Number(projectId);
  const latest = await getLatestSummary(pid);

  if (!latest) {
    const data: SummaryData = {};
    if (patch.scope) data.scope = patch.scope;
    if (patch.nextSteps) data.nextSteps = patch.nextSteps;
    if (patch.members) data.members = patch.members as SummaryData["members"];
    const res = await db
      .insert(projectSummaries)
      .values({
        projectId: pid,
        userId: opts?.userId || "",
        version: 1,
        trigger: "kb",
        summaryText: "",
        summaryData: data as any,
        createdAt: Date.now(),
      })
      .returning();
    return mapSummary(res[0]);
  }

  const data: SummaryData = latest.summaryData || {};
  if (patch.scope) {
    data.scope = { ...(data.scope || {}), ...patch.scope };
  }
  if (patch.nextSteps) {
    const existing = data.nextSteps || [];
    const existingTexts = new Set(existing.map((s) => s.text.trim()));
    const merged = [...existing];
    for (const step of patch.nextSteps) {
      const text = (step.text || "").trim();
      if (!text) continue;
      if (existingTexts.has(text)) continue;
      merged.push({ ...step, text });
      existingTexts.add(text);
    }
    data.nextSteps = merged;
  }
  if (patch.members) {
    data.members = { ...(data.members || {}), ...patch.members } as SummaryData["members"];
  }

  const res = await db
    .update(projectSummaries)
    .set({ summaryData: data as any })
    .where(eq(projectSummaries.id, Number(latest._id)));
  await res;
  return getLatestSummary(pid);
}

/** PM/AI set trực tiếp scope (ghi đè) vào bản mới nhất. */
export async function setScope(projectId: number | string, scope: Partial<ScopeData>, opts?: { userId?: string }) {
  return patchLatestSummary(projectId, { scope }, opts);
}

/** PM/AI thay thế toàn bộ nextSteps hoặc append thêm các bước mới. */
export async function setNextSteps(
  projectId: number | string,
  steps: NextStepItem[],
  opts?: { userId?: string; replace?: boolean }
) {
  if (opts?.replace) {
    const db = getDb();
    const pid = Number(projectId);
    const latest = await getLatestSummary(pid);
    if (!latest) {
      return patchLatestSummary(pid, { nextSteps: steps }, opts);
    }
    const data: SummaryData = latest.summaryData || {};
    data.nextSteps = steps;
    await db
      .update(projectSummaries)
      .set({ summaryData: data as any })
      .where(eq(projectSummaries.id, Number(latest._id)));
    return getLatestSummary(pid);
  }
  return patchLatestSummary(projectId, { nextSteps: steps }, opts);
}

/** Đánh dấu done/undone cho 1 nextStep theo index. */
export async function toggleNextStep(projectId: number | string, index: number, done: boolean) {
  const db = getDb();
  const pid = Number(projectId);
  const latest = await getLatestSummary(pid);
  if (!latest) return null;
  const data: SummaryData = latest.summaryData || {};
  const steps = data.nextSteps || [];
  if (index < 0 || index >= steps.length) return getLatestSummary(pid);
  steps[index] = { ...steps[index], done };
  data.nextSteps = steps;
  await db
    .update(projectSummaries)
    .set({ summaryData: data as any })
    .where(eq(projectSummaries.id, Number(latest._id)));
  return getLatestSummary(pid);
}