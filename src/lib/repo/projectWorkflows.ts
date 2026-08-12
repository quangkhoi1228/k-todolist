import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { projectWorkflows, tasks } from "../db";

// ─── Row types ─────────────────────────────────────────────
export type WorkflowStepKey =
  | "greet_sale" // init: đã gửi tin nhắn chào sale
  | "input_preinfo" // init: đã nhập thông tin sơ bộ (pre-sale, nhóm ext/internal)
  | "send_kickoff_questions" // kickoff: đã gửi câu hỏi cho Pre-sale/Sale
  | "input_requirements" // kickoff: đã nhập yêu cầu sơ bộ dự án
  | "sow_planning" // sow: đã chốt task list SoW (từ template đề xuất / import SOW)
  | "close_project"; // closed: đã chốt đóng dự án (task xong / KH confirm)

/** Nhóm chat được chọn trong thông tin sơ bộ (giống teamsGroups) — kèm nền tảng để tái dùng sau này */
export interface WorkflowGroupRef {
  name: string;
  platform: "teams" | "zalo";
}

export interface WorkflowInitData {
  presale?: string; // tên Pre-sale phụ trách
  presaleEmail?: string; // email Pre-sale (tìm được từ Teams search)
  externalGroups?: Array<string | WorkflowGroupRef>; // nhóm external liên quan (tên cũ hoặc {name, platform})
  internalGroups?: Array<string | WorkflowGroupRef>; // nhóm internal liên quan (tên cũ hoặc {name, platform})
  [key: string]: unknown;
}

export interface WorkflowRequirement {
  id: string;
  title: string; // tên yêu cầu
  detail?: string; // chi tiết / mô tả
  priority?: "low" | "normal" | "high";
  [key: string]: unknown;
}

/** Kết quả LLM phân tích yêu cầu sơ bộ (scope/next actions/tính năng multi-choice) */
export interface WorkflowPreinfoAnalysis {
  scope: string[];
  nextActions: string[];
  featureSuggestions: string[];
  selectedFeatures?: string[];
  source?: "llm" | "fallback";
}

/** SoW planning — task list output của phase sow (từ template đề xuất / import SOW) */
export interface WorkflowSowPlan {
  templateId?: number | string | null;
  templateName?: string;
  templateCategory?: string;
  items: Array<{
    phase?: string;
    title: string;
    details?: string;
    pic?: string;
    support?: string;
    manday?: number;
    isGroup?: boolean;
  }>;
  taskIds?: number[];
}

export interface WorkflowRow {
  id: number;
  projectId: number;
  userId: string;
  phase: string; // "init" | "kickoff" | "sow"
  steps: Record<string, string>;
  initData: WorkflowInitData | null;
  requirements: WorkflowRequirement[] | null;
  kickoffQuestions: string[] | null;
  taskIds: number[] | null;
  sowPlan: WorkflowSowPlan | null;
  /** LLM đã phân tích yêu cầu sơ bộ — scope + next actions + tính năng multi-choice (lưu dạng JSONB) */
  preinfoAnalysis?: WorkflowPreinfoAnalysis | null;
  updatedAt: number;
  createdAt: number;
}

function mapWorkflow(w: any): any {
  return {
    ...w,
    _id: String(w.id),
    _creationTime: w.createdAt ?? 0,
    projectId: String(w.projectId),
  };
}

// ─── Queries ───────────────────────────────────────────────
export async function getWorkflowByProject(projectId: number | string) {
  const db = getDb();
  const row = await db.query.projectWorkflows.findFirst({
    where: eq(projectWorkflows.projectId, Number(projectId)),
  });
  return row ? mapWorkflow(row) : null;
}

// ─── Mutations ─────────────────────────────────────────────
export async function ensureWorkflow(projectId: number | string, userId: string) {
  const db = getDb();
  const pid = Number(projectId);
  const existing = await db.query.projectWorkflows.findFirst({
    where: eq(projectWorkflows.projectId, pid),
  });
  if (existing) return mapWorkflow(existing);
  const now = Date.now();
  const res = await db
    .insert(projectWorkflows)
    .values({
      projectId: pid,
      userId,
      phase: "init",
      steps: {},
      initData: null,
      requirements: null,
      kickoffQuestions: null,
      taskIds: null,
      sowPlan: null,
      updatedAt: now,
      createdAt: now,
    })
    .returning();
  return mapWorkflow(res[0]);
}

export async function updateWorkflowStep(
  projectId: number | string,
  userId: string,
  stepKey: string,
  status: "done" | "skipped" | null
) {
  const wf = await ensureWorkflow(projectId, userId);
  const db = getDb();
  const steps = { ...(wf.steps || {}) };
  if (status === null) {
    delete steps[stepKey];
  } else {
    steps[stepKey] = status;
  }
  await db
    .update(projectWorkflows)
    .set({ steps, updatedAt: Date.now() })
    .where(eq(projectWorkflows.id, Number(wf._id)));
  return getWorkflowByProject(projectId);
}

export async function updateWorkflowPhase(
  projectId: number | string,
  userId: string,
  phase: string,
  patch?: {
    steps?: Record<string, string>;
    initData?: WorkflowInitData | null;
    requirements?: WorkflowRequirement[] | null;
    kickoffQuestions?: string[] | null;
    taskIds?: number[] | null;
    sowPlan?: WorkflowSowPlan | null;
    preinfoAnalysis?: WorkflowPreinfoAnalysis | null;
  }
) {
  const wf = await ensureWorkflow(projectId, userId);
  const db = getDb();
  const set: any = { phase, updatedAt: Date.now() };
  if (patch?.steps !== undefined) set.steps = patch.steps;
  if (patch?.initData !== undefined) set.initData = patch.initData;
  if (patch?.requirements !== undefined) set.requirements = patch.requirements;
  if (patch?.kickoffQuestions !== undefined) set.kickoffQuestions = patch.kickoffQuestions;
  if (patch?.taskIds !== undefined) set.taskIds = patch.taskIds;
  if (patch?.sowPlan !== undefined) set.sowPlan = patch.sowPlan;
  if (patch?.preinfoAnalysis !== undefined) set.preinfoAnalysis = patch.preinfoAnalysis;
  await db.update(projectWorkflows).set(set).where(eq(projectWorkflows.id, Number(wf._id)));
  return getWorkflowByProject(projectId);
}

export async function updateWorkflowData(
  projectId: number | string,
  userId: string,
  patch: {
    initData?: WorkflowInitData | null;
    requirements?: WorkflowRequirement[] | null;
    kickoffQuestions?: string[] | null;
    taskIds?: number[] | null;
    sowPlan?: WorkflowSowPlan | null;
    preinfoAnalysis?: WorkflowPreinfoAnalysis | null;
  }
) {
  const wf = await ensureWorkflow(projectId, userId);
  const db = getDb();
  const set: any = { updatedAt: Date.now() };
  if (patch.initData !== undefined) set.initData = patch.initData;
  if (patch.requirements !== undefined) set.requirements = patch.requirements;
  if (patch.kickoffQuestions !== undefined) set.kickoffQuestions = patch.kickoffQuestions;
  if (patch.taskIds !== undefined) set.taskIds = patch.taskIds;
  if (patch.sowPlan !== undefined) set.sowPlan = patch.sowPlan;
  if (patch.preinfoAnalysis !== undefined) set.preinfoAnalysis = patch.preinfoAnalysis;
  await db.update(projectWorkflows).set(set).where(eq(projectWorkflows.id, Number(wf._id)));
  return getWorkflowByProject(projectId);
}

/**
 * Tự sinh các task tracking từ input của dự án (yêu cầu sơ bộ / thông tin init).
 * Mỗi yêu cầu → 1 task "tracking". Trả về mảng task đã tạo (kèm taskIds mới).
 */
export async function generateTrackingTasks(args: {
  projectId: number | string;
  userId: string;
  items: Array<{ title: string; detail?: string; priority?: string }>;
  prefix?: string;
}) {
  const db = getDb();
  const pid = Number(args.projectId);
  const prefix = args.prefix || "[Kickoff]";
  const created: any[] = [];
  const now = Date.now();

  for (const [i, item] of args.items.entries()) {
    if (!item.title || !item.title.trim()) continue;
    const res = await db
      .insert(tasks)
      .values({
        userId: args.userId,
        title: `${prefix} ${item.title.trim()}`,
        estimatedTime: 0,
        notes: item.detail ? item.detail.trim() : null,
        status: "todo",
        project: pid,
        order: i + 1,
        priority: item.priority || "normal",
        startDate: null,
        endDate: null,
        createdAt: now + i,
      })
      .returning();
    created.push(res[0]);
  }
  return created;
}

/**
 * Tạo task list thực tế từ SoW plan (phase sow) — output của phase SoW planning.
 * Bỏ các item group (phase cha — chỉ giữ leaf tasks), giữ phase/pic/support/manday.
 */
export async function generateSowTasks(args: {
  projectId: number | string;
  userId: string;
  items: Array<{
    title: string;
    phase?: string;
    details?: string;
    pic?: string;
    support?: string;
    manday?: number;
    isGroup?: boolean;
  }>;
}) {
  const db = getDb();
  const pid = Number(args.projectId);
  const created: any[] = [];
  const now = Date.now();
  let order = 0;

  for (const item of args.items) {
    if (item.isGroup || !item.title || !item.title.trim()) continue;
    const res = await db
      .insert(tasks)
      .values({
        userId: args.userId,
        title: item.title.trim(),
        estimatedTime: item.manday ?? 1,
        notes: item.details ? item.details.trim() : null,
        status: "todo",
        project: pid,
        order: ++order,
        priority: "normal",
        pic: item.pic || null,
        support: item.support || null,
        startDate: null,
        endDate: null,
        createdAt: now + order,
      })
      .returning();
    created.push(res[0]);
  }
  return created;
}
