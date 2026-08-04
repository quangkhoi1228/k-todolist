import { desc, eq, isNull } from "drizzle-orm";
import { getDb } from "../db";
import { projects, tasks, notes } from "../db";

// ─── Row types ─────────────────────────────────────────────
export interface TeamGroup {
  name: string;
  type: string; // "internal" | "customer"
  platform?: string; // "teams" | "zalo"
  url?: string;
}

export interface ProjectRow {
  id: number;
  userId: string;
  name: string;
  color: string | null;
  order: number | null;
  archived: boolean | null;
  notes: string | null;
  deletedAt: number | null;
  internalGroupUrl: string | null;
  customerGroupUrl: string | null;
  teamsGroups: TeamGroup[] | null;
  ticketId: string | null;
  isdStatus: string | null;
  isdUpdatedAt: number | null;
}

export interface InsertProject {
  userId: string;
  name: string;
  color?: string | null;
  order?: number | null;
  archived?: boolean | null;
  notes?: string | null;
  deletedAt?: number | null;
  teamsGroups?: TeamGroup[] | null;
  ticketId?: string | null;
  isdStatus?: string | null;
  isdUpdatedAt?: number | null;
}

// Convex-style _id/_creationTime shape for UI compatibility
export function mapProject(p: any): any {
  return {
    ...p,
    _id: String(p.id),
    _creationTime: p.createdAt ?? 0,
  };
}

// ─── Queries ─────────────────────────────────────────────────────
export async function getProjects(opts: {
  userId: string;
  includeArchived?: boolean;
  includeTrashed?: boolean;
}) {
  const { userId, includeArchived = false, includeTrashed = false } = opts;
  const db = getDb();
  let rows = await db.select().from(projects).where(eq(projects.userId, userId));

  if (!includeTrashed) {
    rows = rows.filter((p) => !p.deletedAt);
  }

  if (!includeArchived) {
    rows = rows.filter((p) => !p.archived);
  }

  return rows.map(mapProject);
}

export async function getProject(id: number | string) {
  const db = getDb();
  const pid = Number(id);
  const row = await db.query.projects.findFirst({ where: eq(projects.id, pid) });
  return row ? mapProject(row) : null;
}

export async function getActiveProjectsWithTeamsGroups(userId: string) {
  const db = getDb();
  const rows = await db.select().from(projects).where(eq(projects.userId, userId));
  return rows
    .filter((p) => {
      if (p.archived) return false;
      if (p.deletedAt) return false;
      if (p.teamsGroups && Array.isArray(p.teamsGroups) && p.teamsGroups.length > 0) return true;
      if (!p.internalGroupUrl && !p.customerGroupUrl) return false;
      return true;
    })
    .map(mapProject);
}

// ─── Mutations ───────────────────────────────────────────────────
export async function createProject(args: { userId: string; name: string; color?: string }) {
  const db = getDb();
  const res = await db
    .insert(projects)
    .values({ userId: args.userId, name: args.name, color: args.color, archived: false, createdAt: Date.now() })
    .returning();
  const row = res[0];
  return { ...row, _id: String(row.id), _creationTime: row.createdAt ?? 0 };
}

export async function updateProject(id: number | string, updates: {
  name?: string;
  color?: string;
  archived?: boolean;
  ticketId?: string;
  teamsGroups?: TeamGroup[];
}) {
  const db = getDb();
  const pid = Number(id);
  const patch: any = {};
  if (updates.name !== undefined) patch.name = updates.name;
  if (updates.color !== undefined) patch.color = updates.color;
  if (updates.archived !== undefined) patch.archived = updates.archived;
  if (updates.ticketId !== undefined) patch.ticketId = updates.ticketId;
  if (updates.teamsGroups !== undefined) patch.teamsGroups = updates.teamsGroups;
  await db.update(projects).set(patch).where(eq(projects.id, pid));
}

export async function updateProjectDetail(id: number | string, notes?: string) {
  const db = getDb();
  const patch: any = {};
  if (notes !== undefined) patch.notes = notes;
  await db.update(projects).set(patch).where(eq(projects.id, Number(id)));
}

export async function updateProjectTeamsGroups(id: number | string, groups: {
  internalGroupUrl?: string | null;
  customerGroupUrl?: string | null;
  teamsGroups?: TeamGroup[];
}) {
  const db = getDb();
  const patch: any = {};
  if (groups.internalGroupUrl !== undefined) patch.internalGroupUrl = groups.internalGroupUrl ?? null;
  if (groups.customerGroupUrl !== undefined) patch.customerGroupUrl = groups.customerGroupUrl ?? null;
  if (groups.teamsGroups !== undefined) patch.teamsGroups = groups.teamsGroups;
  await db.update(projects).set(patch).where(eq(projects.id, Number(id)));
}

export async function updateProjectIsdStatus(id: number | string, updates: {
  ticketId?: string;
  isdStatus?: string;
}) {
  const db = getDb();
  const patch: any = {};
  if (updates.ticketId !== undefined) patch.ticketId = updates.ticketId;
  if (updates.isdStatus !== undefined) patch.isdStatus = updates.isdStatus;
  patch.isdUpdatedAt = Date.now();
  await db.update(projects).set(patch).where(eq(projects.id, Number(id)));
}

export async function setProjectArchived(id: number | string, archived: boolean) {
  const db = getDb();
  await db.update(projects).set({ archived }).where(eq(projects.id, Number(id)));
}

export async function softDeleteProject(id: number | string) {
  const db = getDb();
  await db.update(projects).set({ deletedAt: Date.now() }).where(eq(projects.id, Number(id)));
}

export async function restoreProject(id: number | string) {
  const db = getDb();
  await db.update(projects).set({ deletedAt: null }).where(eq(projects.id, Number(id)));
}

async function deleteAllChildNotes(noteId: number) {
  const db = getDb();
  const children = await db.select().from(notes).where(eq(notes.parentNoteId, noteId));
  for (const child of children) {
    await deleteAllChildNotes(child.id);
    await db.delete(notes).where(eq(notes.id, child.id));
  }
}

export async function deleteProject(id: number | string) {
  const db = getDb();
  const pid = Number(id);

  // 1. Delete all tasks
  await db.delete(tasks).where(eq(tasks.project, pid));
  // Also delete task dependencies for those tasks
  const rows = await db.select().from(notes).where(eq(notes.projectId, pid));
  for (const row of rows) {
    await deleteAllChildNotes(row.id);
    await db.delete(notes).where(eq(notes.id, row.id));
  }
  // 2. Delete the project
  await db.delete(projects).where(eq(projects.id, pid));
}

export async function updateProjectOrders(updates: Array<{ id: number | string; order: number }>) {
  const db = getDb();
  for (const u of updates) {
    await db.update(projects).set({ order: u.order }).where(eq(projects.id, Number(u.id)));
  }
}

export async function cloneProject(projectId: number | string, userId: string, name?: string) {
  const db = getDb();
  const pid = Number(projectId);
  const project = await db.query.projects.findFirst({ where: eq(projects.id, pid) });
  if (!project) throw new Error("Project not found");

  const res = await db
    .insert(projects)
    .values({
      userId,
      name: name || `${project.name} (Copy)`,
      color: project.color,
      notes: project.notes,
      order: project.order !== null && project.order !== undefined ? project.order + 1 : undefined,
      archived: false,
      createdAt: Date.now(),
    })
    .returning();
  const cloned = res[0];

  // Clone tasks as todo
  const tasksToClone = await db.select().from(tasks).where(eq(tasks.project, pid));
  for (const t of tasksToClone) {
    const { id: _id, createdAt: _createdAt, ...rest } = t;
    await db.insert(tasks).values({
      ...rest,
      project: cloned.id,
      status: "todo",
      isCompleted: false,
      createdAt: Date.now(),
    });
  }

  return { ...cloned, _id: String(cloned.id), _creationTime: cloned.createdAt ?? 0 };
}