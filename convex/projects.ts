import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const getProjects = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("projects")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

export const createProject = mutation({
  args: {
    userId: v.string(),
    name: v.string(),
    color: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("projects", args);
  },
});

export const updateProject = mutation({
  args: {
    id: v.id("projects"),
    name: v.string(),
    color: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    return await ctx.db.patch(id, updates);
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

    // 2. Delete the project itself
    return await ctx.db.delete(args.id);
  },
});

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
