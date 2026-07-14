import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const getUserPreferences = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const prefs = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    return { hideDoneTasks: prefs?.hideDoneTasks ?? false };
  },
});

export const updateUserPreferences = mutation({
  args: {
    userId: v.string(),
    hideDoneTasks: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        hideDoneTasks: args.hideDoneTasks,
      });
    } else {
      await ctx.db.insert("userPreferences", {
        userId: args.userId,
        hideDoneTasks: args.hideDoneTasks,
      });
    }
  },
});