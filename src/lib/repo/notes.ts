import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../db";
import { notes, projects } from "../db";

function mapNote(n: any): any {
  return {
    ...n,
    _id: String(n.id),
    _creationTime: n.createdAt ?? 0,
    projectId: n.projectId !== null ? String(n.projectId) : undefined,
    parentNoteId: n.parentNoteId !== null ? String(n.parentNoteId) : undefined,
  };
}

// ─── Queries ───────────────────────────────────────────────
export async function getNotes(userId: string) {
  const db = getDb();
  const rows = await db.select().from(notes).where(eq(notes.userId, userId));
  return rows.map(mapNote);
}

export async function getNotesByProject(projectId: number | string) {
  const db = getDb();
  const rows = await db.select().from(notes).where(eq(notes.projectId, Number(projectId)));
  return rows.map(mapNote);
}

export async function getNote(id: number | string) {
  const db = getDb();
  const row = await db.query.notes.findFirst({ where: eq(notes.id, Number(id)) });
  return row ? mapNote(row) : null;
}

export async function getNotesWithoutProject(userId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(notes)
    .where(and(eq(notes.userId, userId), isNull(notes.projectId)));
  return rows.map(mapNote);
}

// ─── Mutations ─────────────────────────────────────────────
export async function createNote(args: {
  userId: string;
  title: string;
  content?: string;
  projectId?: number | string | null;
  parentNoteId?: number | string | null;
  icon?: string;
}) {
  const db = getDb();
  // Compute order like Convex (max sibling count)
  let order = 0;
  if (args.parentNoteId) {
    const siblings = await db
      .select()
      .from(notes)
      .where(eq(notes.parentNoteId, Number(args.parentNoteId)));
    order = siblings.length;
  } else if (args.projectId) {
    const siblings = await db
      .select()
      .from(notes)
      .where(eq(notes.projectId, Number(args.projectId)));
    order = siblings.length;
  } else {
    const all = await db.select().from(notes).where(eq(notes.userId, args.userId));
    order = all.length;
  }

  const res = await db
    .insert(notes)
    .values({
      userId: args.userId,
      title: args.title,
      content: args.content || "",
      projectId: args.projectId ? Number(args.projectId) : null,
      parentNoteId: args.parentNoteId ? Number(args.parentNoteId) : null,
      order,
      icon: args.icon || "📝",
      createdAt: Date.now(),
    })
    .returning();
  return mapNote(res[0]);
}

export async function updateNote(id: number | string, updates: {
  title?: string;
  content?: string;
  projectId?: number | string;
  parentNoteId?: number | string | null;
  order?: number;
  icon?: string;
}) {
  const db = getDb();
  const patch: any = {};
  if (updates.title !== undefined) patch.title = updates.title;
  if (updates.content !== undefined) patch.content = updates.content;
  if (updates.projectId !== undefined) patch.projectId = Number(updates.projectId);
  if (updates.parentNoteId !== undefined) patch.parentNoteId = updates.parentNoteId === null ? null : Number(updates.parentNoteId);
  if (updates.order !== undefined) patch.order = updates.order;
  if (updates.icon !== undefined) patch.icon = updates.icon;
  await db.update(notes).set(patch).where(eq(notes.id, Number(id)));
}

async function deleteNoteRecursive(noteId: number) {
  const db = getDb();
  const children = await db.select().from(notes).where(eq(notes.parentNoteId, noteId));
  for (const child of children) {
    await deleteNoteRecursive(child.id);
  }
  await db.delete(notes).where(eq(notes.id, noteId));
}

export async function deleteNote(id: number | string) {
  await deleteNoteRecursive(Number(id));
}

export async function updateNoteOrders(updates: Array<{
  id: number | string;
  order: number;
  parentNoteId?: number | string | null;
}>) {
  const db = getDb();
  for (const u of updates) {
    const patch: any = { order: u.order };
    if (u.parentNoteId !== undefined) patch.parentNoteId = u.parentNoteId === null ? null : Number(u.parentNoteId);
    await db.update(notes).set(patch).where(eq(notes.id, Number(u.id)));
  }
}

export async function moveNoteToProject(noteId: number | string, projectId?: number | string | null) {
  const db = getDb();
  const note = await db.query.notes.findFirst({ where: eq(notes.id, Number(noteId)) });
  if (!note) throw new Error("Note not found");

  const patch: any = {};
  if (projectId !== undefined) {
    patch.projectId = projectId === null ? null : Number(projectId);
  }
  await db.update(notes).set(patch).where(eq(notes.id, Number(noteId)));

  // Recursively update children
  await updateChildrenProject(Number(noteId), projectId);
}

async function updateChildrenProject(parentNoteId: number, projectId?: number | string | null) {
  const db = getDb();
  const children = await db.select().from(notes).where(eq(notes.parentNoteId, parentNoteId));
  for (const child of children) {
    const patch: any = {};
    if (projectId !== undefined) {
      patch.projectId = projectId === null ? null : Number(projectId);
    }
    await db.update(notes).set(patch).where(eq(notes.id, child.id));
    await updateChildrenProject(child.id, projectId);
  }
}

// ─── Share slugs ───────────────────────────────────────────
function generateSlug(length: number = 12): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export async function generateShareSlug(noteId: number | string) {
  const db = getDb();
  const note = await db.query.notes.findFirst({ where: eq(notes.id, Number(noteId)) });
  if (!note) throw new Error("Note not found");
  if (note.shareSlug) return note.shareSlug;

  let slug = generateSlug();
  let attempts = 0;
  while (attempts < 10) {
    const existing = await db.query.notes.findFirst({ where: eq(notes.shareSlug, slug) });
    if (!existing) break;
    slug = generateSlug();
    attempts++;
  }

  await db.update(notes).set({ shareSlug: slug }).where(eq(notes.id, Number(noteId)));
  return slug;
}

export async function removeShareSlug(noteId: number | string) {
  const db = getDb();
  await db.update(notes).set({ shareSlug: null }).where(eq(notes.id, Number(noteId)));
}

export async function getNoteByShareSlug(slug: string) {
  const db = getDb();
  const note = await db.query.notes.findFirst({ where: eq(notes.shareSlug, slug) });
  if (!note) return null;

  // Breadcrumb
  const breadcrumb: { id: string; title: string }[] = [];
  let current: any = note;
  while (current.parentNoteId) {
    const parent = await db.query.notes.findFirst({ where: eq(notes.id, current.parentNoteId) });
    if (parent) {
      breadcrumb.unshift({ id: String(parent.id), title: parent.title });
      current = parent;
    } else {
      break;
    }
  }

  // Project name
  let projectName: string | null = null;
  if (note.projectId) {
    const project = await db.query.projects.findFirst({ where: eq(projects.id, note.projectId) });
    if (project) projectName = project.name;
  }

  // Child notes
  const childNotes = await db.select().from(notes).where(eq(notes.parentNoteId, note.id));

  return {
    ...mapNote(note),
    breadcrumb,
    projectName,
    childNotes: childNotes.map((c) => ({ id: String(c.id), title: c.title, icon: c.icon })),
  };
}