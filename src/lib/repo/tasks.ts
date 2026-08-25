import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { tasks, taskDependencies } from "../db";
import { getTaskTemplate } from "./taskTemplates";
import { expandTemplateItems } from "./taskModules";

// ─── Helpers ───────────────────────────────────────────────
export function mapTask(t: any): any {
  return {
    ...t,
    _id: String(t.id),
    _creationTime: t.createdAt ?? 0,
    project: t.project !== null ? String(t.project) : undefined,
  };
}

// ─── Queries ───────────────────────────────────────────────
export async function getTasks(userId: string) {
  const db = getDb();
  const rows = await db.select().from(tasks).where(eq(tasks.userId, userId));
  return rows.map(mapTask);
}

export async function getTasksByProject(projectId: number | string) {
  const db = getDb();
  const rows = await db.select().from(tasks).where(eq(tasks.project, Number(projectId)));
  return rows.map(mapTask);
}

// ─── Mutations ─────────────────────────────────────────────
export async function createTask(args: {
  userId: string;
  title: string;
  estimatedTime: number;
  startDate?: number | null;
  endDate?: number | null;
  notes?: string;
  status?: string;
  project?: number | string | null;
  order?: number;
  pic?: string;
  support?: string;
  path?: string;
  priority?: string;
}) {
  const db = getDb();
  const res = await db
    .insert(tasks)
    .values({
      userId: args.userId,
      title: args.title,
      estimatedTime: args.estimatedTime,
      startDate: args.startDate ?? null,
      endDate: args.endDate ?? null,
      notes: args.notes ?? null,
      status: args.status ?? null,
      project: args.project !== undefined && args.project !== null ? Number(args.project) : null,
      order: args.order ?? null,
      pic: args.pic ?? null,
      support: args.support ?? null,
      path: args.path ?? null,
      priority: args.priority ?? null,
      createdAt: Date.now(),
    })
    .returning();
  const created = mapTask(res[0]);

  return created;
}

export async function updateTask(id: number | string, updates: {
  title?: string;
  estimatedTime?: number;
  startDate?: number | null;
  endDate?: number | null;
  notes?: string;
  status?: string;
  project?: number | string | null;
  order?: number;
  pic?: string;
  support?: string;
  path?: string;
  priority?: string;
}) {
  const db = getDb();
  const pid = Number(id);
  const patch: any = {};
  if (updates.title !== undefined) patch.title = updates.title;
  if (updates.estimatedTime !== undefined) patch.estimatedTime = updates.estimatedTime;
  if (updates.startDate !== undefined) patch.startDate = updates.startDate ?? null;
  if (updates.endDate !== undefined) patch.endDate = updates.endDate ?? null;
  if (updates.notes !== undefined) patch.notes = updates.notes;
  if (updates.status !== undefined) patch.status = updates.status;
  if (updates.project !== undefined) patch.project = updates.project === null ? null : Number(updates.project);
  if (updates.order !== undefined) patch.order = updates.order;
  if (updates.pic !== undefined) patch.pic = updates.pic;
  if (updates.support !== undefined) patch.support = updates.support;
  if (updates.path !== undefined) patch.path = updates.path;
  if (updates.priority !== undefined) patch.priority = updates.priority;
  await db.update(tasks).set(patch).where(eq(tasks.id, pid));
}

export async function updateTaskOrders(updates: Array<{
  id: number | string;
  order: number;
  startDate?: number;
  endDate?: number;
  status?: string;
  project?: number | string | null;
}>) {
  const db = getDb();
  for (const u of updates) {
    const patch: any = { order: u.order };
    if (u.startDate !== undefined) patch.startDate = u.startDate;
    if (u.endDate !== undefined) patch.endDate = u.endDate;
    if (u.status !== undefined) patch.status = u.status;
    if (u.project !== undefined) patch.project = u.project === null ? null : Number(u.project);
    await db.update(tasks).set(patch).where(eq(tasks.id, Number(u.id)));
  }
}

export async function deleteTask(id: number | string) {
  const db = getDb();
  const tid = Number(id);
  // Cascade delete dependencies
  await db.delete(taskDependencies).where(eq(taskDependencies.taskId, tid));
  await db.delete(taskDependencies).where(eq(taskDependencies.dependsOnTaskId, tid));
  await db.delete(tasks).where(eq(tasks.id, tid));
}

// ─── Batch import from templates ───────────────────────────
/**
 * Tạo nhiều task từ nhiều template, theo thứ tự template đã truyền.
 * Mỗi template tạo ra các task theo items order; order tăng dần liên tục
 * bắt đầu từ max(order) hiện có của project + 1000.
 */
export async function createTasksFromTemplates(args: {
  userId: string;
  projectId: number | string;
  templateIds: Array<number | string>;
}) {
  const db = getDb();
  const pid = Number(args.projectId);
  if (!pid) throw new Error("Thiếu projectId");
  if (!args.templateIds || args.templateIds.length === 0) {
    throw new Error("Thiếu templateIds");
  }

  // Tìm max order hiện có trong project
  const existing = await db
    .select({ order: tasks.order })
    .from(tasks)
    .where(eq(tasks.project, pid));
  let maxOrder = 0;
  for (const t of existing) {
    if (t.order && t.order > maxOrder) maxOrder = t.order;
  }

  const now = Date.now();
  const created: any[] = [];
  let orderCursor = maxOrder;

  for (const templateId of args.templateIds) {
    const template = await getTaskTemplate(templateId);
    if (!template) continue;
    // Expand module references to real task items
    const expandedItems = await expandTemplateItems(args.userId, template.items ?? []);
    // Theo dõi group header hiện hành để gán path cho task con
    let currentPhase = "";
    let currentGroup = "";
    for (const item of expandedItems) {
      // Group header (isGroup) → cập nhật phase/group, vẫn tạo task để giữ cấu trúc
      if (item.isGroup) {
        if (item.phase) currentPhase = item.phase;
        currentGroup = item.title || "";
        continue;
      }
      if (!item.title) continue;
      orderCursor += 1000;
      const path = [item.phase || currentPhase, currentGroup].filter(Boolean).join(" / ") || item.phase || null;
      const res = await db
        .insert(tasks)
        .values({
          userId: args.userId,
          title: item.title,
          estimatedTime: item.manday ?? 1,
          startDate: null,
          endDate: null,
          status: "todo",
          project: pid,
          order: orderCursor,
          pic: item.pic || null,
          support: item.support || null,
          path,
          priority: "normal",
          notes: item.details || null,
          createdAt: now,
        })
        .returning();
      created.push(res[0]);
    }
  }

  return {
    ok: true,
    createdTasks: created.length,
    templateCount: args.templateIds.length,
  };
}



// ─── Dependencies ──────────────────────────────────────────
export function mapDependency(d: any): any {
  return {
    ...d,
    _id: String(d.id),
    _creationTime: 0,
    taskId: String(d.taskId),
    dependsOnTaskId: String(d.dependsOnTaskId),
  };
}

export async function getAllDependencies(userId: string) {
  const db = getDb();
  const rows = await db.select().from(taskDependencies).where(eq(taskDependencies.userId, userId));
  return rows.map(mapDependency);
}

export async function getTaskDependencies(taskId: number | string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(taskDependencies)
    .where(eq(taskDependencies.taskId, Number(taskId)));
  return rows.map(mapDependency);
}

export async function getTaskDependents(taskId: number | string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(taskDependencies)
    .where(eq(taskDependencies.dependsOnTaskId, Number(taskId)));
  return rows.map(mapDependency);
}

export async function createDependency(args: {
  userId: string;
  taskId: number | string;
  dependsOnTaskId: number | string;
  dependencyType?: string;
}) {
  const db = getDb();
  const taskId = Number(args.taskId);
  const dependsOnTaskId = Number(args.dependsOnTaskId);

  if (taskId === dependsOnTaskId) {
    throw new Error("Cannot create a dependency on itself");
  }

  // Duplicate check
  const existing = await db
    .select()
    .from(taskDependencies)
    .where(eq(taskDependencies.taskId, taskId));
  if (existing.some((d) => d.dependsOnTaskId === dependsOnTaskId)) {
    throw new Error("This dependency already exists");
  }

  // Circular check: walk backwards from dependsOnTaskId
  let visited = new Set<number>();
  let queue = [dependsOnTaskId];
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (currentId === taskId) {
      throw new Error("Circular dependency detected");
    }
    if (visited.has(currentId)) continue;
    visited.add(currentId);
    const deps = await db
      .select()
      .from(taskDependencies)
      .where(eq(taskDependencies.dependsOnTaskId, currentId));
    for (const d of deps) {
      queue.push(d.taskId);
    }
  }

  const res = await db
    .insert(taskDependencies)
    .values({
      userId: args.userId,
      taskId,
      dependsOnTaskId,
      dependencyType: args.dependencyType || "finish-to-start",
    })
    .returning();
  return mapDependency(res[0]);
}

export async function deleteDependency(id: number | string) {
  const db = getDb();
  await db.delete(taskDependencies).where(eq(taskDependencies.id, Number(id)));
}

export async function isTaskBlocked(taskId: number | string) {
  const deps = await getTaskDependencies(taskId);
  const db = getDb();
  for (const dep of deps) {
    const predecessor = await db.query.tasks.findFirst({
      where: eq(tasks.id, Number(dep.dependsOnTaskId)),
    });
    if (predecessor && predecessor.status !== "done") {
      return true;
    }
  }
  return false;
}