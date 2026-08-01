import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";

export const getLogs = query({
  args: {
    projectId: v.optional(v.id("projects")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;
    if (args.projectId) {
      return await ctx.db
        .query("syncLogs")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId!))
        .order("desc")
        .take(limit);
    }
    return await ctx.db
      .query("syncLogs")
      .withIndex("by_created_at")
      .order("desc")
      .take(limit);
  },
});

export const getLogsPaginated = query({
  args: {
    projectId: v.optional(v.id("projects")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    if (args.projectId) {
      return await ctx.db
        .query("syncLogs")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId!))
        .order("desc")
        .paginate(args.paginationOpts);
    }
    return await ctx.db
      .query("syncLogs")
      .withIndex("by_created_at")
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const getRecentLogs = query({
  args: {
    type: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    if (args.type) {
      return await ctx.db
        .query("syncLogs")
        .withIndex("by_type", (q) => q.eq("type", args.type!))
        .order("desc")
        .take(limit);
    }
    return await ctx.db
      .query("syncLogs")
      .withIndex("by_created_at")
      .order("desc")
      .take(limit);
  },
});

export const addLog = mutation({
  args: {
    projectId: v.optional(v.id("projects")),
    chatName: v.optional(v.string()),
    type: v.string(), // "sync_start", "sync_end", "sync_error", "sync_progress"
    message: v.string(),
    details: v.optional(v.string()), // JSON string
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("syncLogs", {
      projectId: args.projectId,
      chatName: args.chatName,
      type: args.type,
      message: args.message,
      details: args.details,
      createdAt: Date.now(),
    });
  },
});

export const addLogsBatch = mutation({
  args: {
    logs: v.array(
      v.object({
        projectId: v.optional(v.id("projects")),
        chatName: v.optional(v.string()),
        type: v.string(),
        message: v.string(),
        details: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const log of args.logs) {
      await ctx.db.insert("syncLogs", {
        projectId: log.projectId,
        chatName: log.chatName,
        type: log.type,
        message: log.message,
        details: log.details,
        createdAt: now,
      });
    }
  },
});

export const clearLogs = mutation({
  args: {
    before: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const cutoff = args.before ?? Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days
    const logs = await ctx.db
      .query("syncLogs")
      .withIndex("by_created_at", (q) => q.lte("createdAt", cutoff))
      .take(500);
    for (const log of logs) {
      await ctx.db.delete(log._id);
    }
    return { deleted: logs.length };
  },
});
