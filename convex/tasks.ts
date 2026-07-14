import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const getTasks = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tasks")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

export const createTask = mutation({
  args: {
    userId: v.string(),
    title: v.string(),
    estimatedTime: v.number(),
    startDate: v.number(),
    endDate: v.number(),
    notes: v.optional(v.string()),
    status: v.optional(v.string()),
    project: v.optional(v.id("projects")),
    order: v.optional(v.number()),
    pic: v.optional(v.string()),
    support: v.optional(v.string()),
    priority: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("tasks", args);
  },
});

export const updateTask = mutation({
  args: {
    id: v.id("tasks"),
    title: v.optional(v.string()),
    estimatedTime: v.optional(v.number()),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    notes: v.optional(v.string()),
    status: v.optional(v.string()),
    project: v.optional(v.id("projects")),
    order: v.optional(v.number()),
    pic: v.optional(v.string()),
    support: v.optional(v.string()),
    priority: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...rest } = args;
    return await ctx.db.patch(id, rest);
  },
});

export const updateTaskOrders = mutation({
  args: {
    updates: v.array(
      v.object({
        id: v.id("tasks"),
        order: v.number(),
        startDate: v.number(), // Might update date if dragged between columns
      })
    ),
  },
  handler: async (ctx, args) => {
    for (const update of args.updates) {
      await ctx.db.patch(update.id, {
        order: update.order,
        startDate: update.startDate,
      });
    }
  },
});

export const deleteTask = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    return await ctx.db.delete(args.id);
  },
});
