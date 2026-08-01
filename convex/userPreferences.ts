import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const getUserPreferences = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const prefs = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    return {
      hideDoneTasks: prefs?.hideDoneTasks ?? false,
      autoSyncInterval: prefs?.autoSyncInterval ?? 0,
      lastSyncTime: prefs?.lastSyncTime ?? 0,
    };
  },
});

export const updateUserPreferences = mutation({
  args: {
    userId: v.string(),
    hideDoneTasks: v.optional(v.boolean()),
    autoSyncInterval: v.optional(v.number()),
    lastSyncTime: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    const patchData: Record<string, any> = {};
    if (args.hideDoneTasks !== undefined) patchData.hideDoneTasks = args.hideDoneTasks;
    if (args.autoSyncInterval !== undefined) patchData.autoSyncInterval = args.autoSyncInterval;
    if (args.lastSyncTime !== undefined) patchData.lastSyncTime = args.lastSyncTime;

    if (existing) {
      await ctx.db.patch(existing._id, patchData);
    } else {
      await ctx.db.insert("userPreferences", {
        userId: args.userId,
        hideDoneTasks: args.hideDoneTasks ?? false,
        autoSyncInterval: args.autoSyncInterval ?? 0,
        lastSyncTime: args.lastSyncTime ?? 0,
      });
    }
  },
});