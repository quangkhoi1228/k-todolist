import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const getNotes = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("notes")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

export const getNotesByProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("notes")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

export const getNote = query({
  args: { id: v.id("notes") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const createNote = mutation({
  args: {
    userId: v.string(),
    title: v.string(),
    content: v.optional(v.string()),
    projectId: v.optional(v.id("projects")),
    parentNoteId: v.optional(v.id("notes")),
    icon: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Get max order for sibling notes
    let order = 0;
    if (args.parentNoteId) {
      const siblings = await ctx.db
        .query("notes")
        .withIndex("by_parent", (q) => q.eq("parentNoteId", args.parentNoteId!))
        .collect();
      order = siblings.length;
    } else if (args.projectId) {
      const siblings = await ctx.db
        .query("notes")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId!))
        .collect();
      order = siblings.length;
    } else {
      const allNotes = await ctx.db
        .query("notes")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .collect();
      order = allNotes.length;
    }

    return await ctx.db.insert("notes", {
      userId: args.userId,
      title: args.title,
      content: args.content || "",
      projectId: args.projectId,
      parentNoteId: args.parentNoteId,
      order,
      icon: args.icon || "📝",
    });
  },
});

export const updateNote = mutation({
  args: {
    id: v.id("notes"),
    title: v.optional(v.string()),
    content: v.optional(v.string()),
    projectId: v.optional(v.id("projects")),
    parentNoteId: v.optional(v.union(v.id("notes"), v.null())),
    order: v.optional(v.number()),
    icon: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const patch: Record<string, unknown> = {};
    if (updates.title !== undefined) patch.title = updates.title;
    if (updates.content !== undefined) patch.content = updates.content;
    if (updates.projectId !== undefined) patch.projectId = updates.projectId;
    if (updates.parentNoteId !== undefined) {
      patch.parentNoteId = updates.parentNoteId === null ? undefined : updates.parentNoteId;
    }
    if (updates.order !== undefined) patch.order = updates.order;
    if (updates.icon !== undefined) patch.icon = updates.icon;
    return await ctx.db.patch(id, patch);
  },
});

export const deleteNote = mutation({
  args: { id: v.id("notes") },
  handler: async (ctx, args) => {
    // Recursively delete all child notes
    const children = await ctx.db
      .query("notes")
      .withIndex("by_parent", (q) => q.eq("parentNoteId", args.id))
      .collect();

    for (const child of children) {
      await deleteNoteHandler(ctx, child._id);
    }

    return await ctx.db.delete(args.id);
  },
});

async function deleteNoteHandler(ctx: any, noteId: string) {
  const children = await ctx.db
    .query("notes")
    .withIndex("by_parent", (q) => q.eq("parentNoteId", noteId))
    .collect();

  for (const child of children) {
    await deleteNoteHandler(ctx, child._id);
  }

  return await ctx.db.delete(noteId);
}

export const updateNoteOrders = mutation({
  args: {
    updates: v.array(
      v.object({
        id: v.id("notes"),
        order: v.number(),
        parentNoteId: v.optional(v.union(v.id("notes"), v.null())),
      })
    ),
  },
  handler: async (ctx, args) => {
    for (const update of args.updates) {
      const patch: Record<string, unknown> = { order: update.order };
      if (update.parentNoteId !== undefined) {
        patch.parentNoteId = update.parentNoteId === null ? undefined : update.parentNoteId;
      }
      await ctx.db.patch(update.id, patch);
    }
  },
});

export const getNotesWithoutProject = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("notes")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("projectId"), undefined))
      .collect();
  },
});

export const moveNoteToProject = mutation({
  args: {
    noteId: v.id("notes"),
    projectId: v.optional(v.union(v.id("projects"), v.null())),
  },
  handler: async (ctx, args) => {
    const note = await ctx.db.get(args.noteId);
    if (!note) throw new Error("Note not found");

    // Update this note's project
    const patch: Record<string, unknown> = {};
    if (args.projectId !== undefined) {
      patch.projectId = args.projectId === null ? undefined : args.projectId;
    }
    await ctx.db.patch(args.noteId, patch);

    // Recursively update all children to the same project
    await updateChildrenProject(ctx, args.noteId, args.projectId);
  },
});

async function updateChildrenProject(
  ctx: any,
  parentNoteId: string,
  projectId: string | null | undefined
) {
  const children = await ctx.db
    .query("notes")
    .withIndex("by_parent", (q) => q.eq("parentNoteId", parentNoteId))
    .collect();

  for (const child of children) {
    const patch: Record<string, unknown> = {};
    if (projectId !== undefined) {
      patch.projectId = projectId === null ? undefined : projectId;
    }
    await ctx.db.patch(child._id, patch);
    await updateChildrenProject(ctx, child._id, projectId);
  }
}

function generateSlug(length: number = 12): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export const generateShareSlug = mutation({
  args: { noteId: v.id("notes") },
  handler: async (ctx, args) => {
    const note = await ctx.db.get(args.noteId);
    if (!note) throw new Error("Note not found");

    // Reuse existing slug if present
    if (note.shareSlug) return note.shareSlug;

    // Generate a unique slug
    let slug = generateSlug();
    let attempts = 0;
    while (attempts < 10) {
      const existing = await ctx.db
        .query("notes")
        .withIndex("by_shareSlug", (q) => q.eq("shareSlug", slug))
        .first();
      if (!existing) break;
      slug = generateSlug();
      attempts++;
    }

    await ctx.db.patch(args.noteId, { shareSlug: slug });
    return slug;
  },
});

export const removeShareSlug = mutation({
  args: { noteId: v.id("notes") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.noteId, { shareSlug: undefined });
  },
});

export const getNoteByShareSlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const note = await ctx.db
      .query("notes")
      .withIndex("by_shareSlug", (q) => q.eq("shareSlug", args.slug))
      .first();

    if (!note) return null;

    // Build breadcrumb of parent notes
    const breadcrumb: { id: string; title: string }[] = [];
    let current = note;
    while (current.parentNoteId) {
      const parent = await ctx.db.get(current.parentNoteId as any);
      if (parent) {
        breadcrumb.unshift({ id: parent._id, title: parent.title });
        current = parent as any;
      } else {
        break;
      }
    }

    // Get project info if assigned
    let projectName: string | null = null;
    if (note.projectId) {
      const project = await ctx.db.get(note.projectId as any);
      if (project) {
        projectName = (project as any).name;
      }
    }

    // Get child notes (just titles + IDs for the sidebar)
    const childNotes = await ctx.db
      .query("notes")
      .withIndex("by_parent", (q) => q.eq("parentNoteId", note._id))
      .collect();

    return {
      ...note,
      breadcrumb,
      projectName,
      childNotes: childNotes.map((c) => ({ id: c._id, title: c.title, icon: c.icon })),
    };
  },
});
