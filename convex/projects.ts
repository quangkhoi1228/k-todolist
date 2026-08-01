import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export const getProjects = query({
  args: {
    userId: v.string(),
    includeArchived: v.optional(v.boolean()),
    includeTrashed: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    // Filter out trashed projects unless explicitly requested
    if (!args.includeTrashed) {
      return projects.filter((p) => !p.deletedAt);
    }

    if (args.includeArchived) {
      return projects;
    }
    return projects.filter((p) => !p.archived);
  },
});

export const createProject = mutation({
  args: {
    userId: v.string(),
    name: v.string(),
    color: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("projects", { ...args, archived: false });
  },
});

export const updateProject = mutation({
  args: {
    id: v.id("projects"),
    name: v.optional(v.string()),
    color: v.optional(v.string()),
    archived: v.optional(v.boolean()),
    ticketId: v.optional(v.string()),
    teamsGroups: v.optional(v.array(v.object({
      name: v.string(),
      type: v.string(),
      platform: v.optional(v.string()), // "teams" | "zalo"
    }))),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const patch: Record<string, unknown> = {};
    if (updates.name !== undefined) patch.name = updates.name;
    if (updates.color !== undefined) patch.color = updates.color;
    if (updates.archived !== undefined) patch.archived = updates.archived;
    if (updates.ticketId !== undefined) patch.ticketId = updates.ticketId;
    if (updates.teamsGroups !== undefined) patch.teamsGroups = updates.teamsGroups;
    return await ctx.db.patch(id, patch);
  },
});

export const setProjectArchived = mutation({
  args: {
    id: v.id("projects"),
    archived: v.boolean(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.patch(args.id, { archived: args.archived });
  },
});

export const softDeleteProject = mutation({
  args: { id: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db.patch(args.id, { deletedAt: Date.now() });
  },
});

export const restoreProject = mutation({
  args: { id: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db.patch(args.id, { deletedAt: undefined });
  },
});

export const deleteProject = mutation({
  args: { id: v.id("projects") },
  handler: async (ctx, args) => {
    // 1. Fetch and delete all tasks associated with this project
    const tasks = await ctx.db
      .query("tasks")
      .filter((q) => q.eq(q.field("project"), args.id))
      .collect();

    for (const task of tasks) {
      await ctx.db.delete(task._id);
    }

    // 2. Fetch and delete all notes associated with this project
    const notes = await ctx.db
      .query("notes")
      .withIndex("by_project", (q) => q.eq("projectId", args.id))
      .collect();

    for (const note of notes) {
      // Recursively delete child notes first
      await deleteAllChildNotes(ctx, note._id);
      await ctx.db.delete(note._id);
    }

    // 3. Delete the project itself
    return await ctx.db.delete(args.id);
  },
});

async function deleteAllChildNotes(ctx: MutationCtx, noteId: Id<"notes">) {
  const children = await ctx.db
    .query("notes")
    .withIndex("by_parent", (q) => q.eq("parentNoteId", noteId))
    .collect();

  for (const child of children) {
    await deleteAllChildNotes(ctx, child._id);
    await ctx.db.delete(child._id);
  }
}

export const updateProjectOrders = mutation({
  args: {
    updates: v.array(
      v.object({
        id: v.id("projects"),
        order: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    for (const update of args.updates) {
      await ctx.db.patch(update.id, { order: update.order });
    }
  },
});

export const cloneProject = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.string(),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) {
      throw new Error("Project not found");
    }

    // 1. Create a new cloned project
    const clonedProjectId = await ctx.db.insert("projects", {
      userId: args.userId,
      name: args.name || `${project.name} (Copy)`,
      color: project.color,
      notes: project.notes,
      order: project.order !== undefined ? project.order + 1 : undefined,
      archived: false,
    });

    // 2. Fetch all tasks associated with the original project
    const tasks = await ctx.db
      .query("tasks")
      .filter((q) => q.eq(q.field("project"), args.projectId))
      .collect();

    // 3. Clone tasks as todo with dates cleared
    for (const task of tasks) {
      const { _id, _creationTime, startDate: _startDate, endDate: _endDate, ...taskData } = task;
      await ctx.db.insert("tasks", {
        ...taskData,
        project: clonedProjectId,
        status: "todo",
        isCompleted: false,
      });
    }

    return clonedProjectId;
  },
});

export const updateProjectDetail = mutation({
  args: {
    id: v.id("projects"),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const patch: Record<string, unknown> = {};
    if (updates.notes !== undefined) patch.notes = updates.notes;
    return await ctx.db.patch(id, patch);
  },
});

export const updateProjectTeamsGroups = mutation({
  args: {
    id: v.id("projects"),
    internalGroupUrl: v.optional(v.union(v.string(), v.null())), // Deprecated
    customerGroupUrl: v.optional(v.union(v.string(), v.null())), // Deprecated
    teamsGroups: v.optional(
      v.array(
        v.object({
          name: v.string(),
          type: v.string(),
          platform: v.optional(v.string()), // "teams" | "zalo"
        })
      )
    ),
  },
  handler: async (ctx, args) => {
    const { id, ...groups } = args;
    const patch: Record<string, unknown> = {};
    if (groups.internalGroupUrl !== undefined) patch.internalGroupUrl = groups.internalGroupUrl ?? undefined;
    if (groups.customerGroupUrl !== undefined) patch.customerGroupUrl = groups.customerGroupUrl ?? undefined;
    if (groups.teamsGroups !== undefined) patch.teamsGroups = groups.teamsGroups;
    return await ctx.db.patch(id, patch);
  },
});

export const updateProjectIsdStatus = mutation({
  args: {
    id: v.id("projects"),
    ticketId: v.optional(v.string()),
    isdStatus: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const patch: Record<string, unknown> = {};
    if (updates.ticketId !== undefined) patch.ticketId = updates.ticketId;
    if (updates.isdStatus !== undefined) patch.isdStatus = updates.isdStatus;
    patch.isdUpdatedAt = Date.now();
    return await ctx.db.patch(id, patch);
  },
});

export const getActiveProjectsWithTeamsGroups = query({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    // Only active projects: not archived, not deleted, and have at least one Teams group link
    return projects.filter((p) => {
      if (p.archived) return false;
      if (p.deletedAt) return false;
      if (p.teamsGroups && p.teamsGroups.length > 0) return true;
      if (!p.internalGroupUrl && !p.customerGroupUrl) return false;
      return true;
    });
  },
});
