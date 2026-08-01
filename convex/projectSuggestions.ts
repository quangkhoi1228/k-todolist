import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

// ─── Queries ─────────────────────────────────────────────────

export const getSuggestionsByProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const suggestions = await ctx.db
      .query("projectSuggestions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(50);

    return suggestions;
  },
});

export const getUnresolvedSuggestionsByUser = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const suggestions = await ctx.db
      .query("projectSuggestions")
      .withIndex("by_user_unresolved", (q) => q.eq("userId", args.userId).eq("isResolved", false))
      .order("desc")
      .take(100);

    return suggestions;
  },
});

export const getUnresolvedCountByUser = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const suggestions = await ctx.db
      .query("projectSuggestions")
      .withIndex("by_user_unresolved", (q) => q.eq("userId", args.userId).eq("isResolved", false))
      .collect();

    return suggestions.length;
  },
});

// ─── Mutations ───────────────────────────────────────────────

export const addSuggestion = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.string(),
    type: v.string(),
    title: v.string(),
    description: v.string(),
    sourceMessage: v.optional(v.string()),
    sourceSender: v.optional(v.string()),
    sourceChatName: v.optional(v.string()),
    sourceTimestamp: v.optional(v.string()),
    actionLabel: v.optional(v.string()),
    actionUrl: v.optional(v.string()),
    suggestionData: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { projectId, userId, type, title, description, ...optional } = args;

    return await ctx.db.insert("projectSuggestions", {
      projectId,
      userId,
      type,
      title,
      description,
      sourceMessage: optional.sourceMessage,
      sourceSender: optional.sourceSender,
      sourceChatName: optional.sourceChatName,
      sourceTimestamp: optional.sourceTimestamp,
      actionLabel: optional.actionLabel,
      actionUrl: optional.actionUrl,
      suggestionData: optional.suggestionData,
      isRead: false,
      isResolved: false,
      createdAt: Date.now(),
    });
  },
});

export const markSuggestionAsRead = mutation({
  args: { id: v.id("projectSuggestions") },
  handler: async (ctx, args) => {
    return await ctx.db.patch(args.id, { isRead: true });
  },
});

export const markSuggestionAsResolved = mutation({
  args: { id: v.id("projectSuggestions") },
  handler: async (ctx, args) => {
    return await ctx.db.patch(args.id, { isResolved: true, isRead: true });
  },
});

export const markAllAsReadByProject = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const suggestions = await ctx.db
      .query("projectSuggestions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .filter((q) => q.eq(q.field("isRead"), false))
      .collect();

    for (const s of suggestions) {
      await ctx.db.patch(s._id, { isRead: true });
    }

    return { updated: suggestions.length };
  },
});

export const deleteSuggestion = mutation({
  args: { id: v.id("projectSuggestions") },
  handler: async (ctx, args) => {
    return await ctx.db.delete(args.id);
  },
});

export const addSuggestionsBatch = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.string(),
    suggestions: v.array(
      v.object({
        type: v.string(),
        title: v.string(),
        description: v.string(),
        sourceMessage: v.optional(v.string()),
        sourceSender: v.optional(v.string()),
        sourceChatName: v.optional(v.string()),
        sourceTimestamp: v.optional(v.string()),
        actionLabel: v.optional(v.string()),
        actionUrl: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    let count = 0;

    // Get existing suggestions to avoid duplicates
    const existing = await ctx.db
      .query("projectSuggestions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    // Dedup by title + description + type
    const existingKeys = new Set(
      existing.map((s) => `${s.type}|${s.title}|${s.description}`)
    );

    for (const s of args.suggestions) {
      const key = `${s.type}|${s.title}|${s.description}`;
      if (existingKeys.has(key)) continue;

      await ctx.db.insert("projectSuggestions", {
        projectId: args.projectId,
        userId: args.userId,
        type: s.type,
        title: s.title,
        description: s.description,
        sourceMessage: s.sourceMessage,
        sourceSender: s.sourceSender,
        sourceChatName: s.sourceChatName,
        sourceTimestamp: s.sourceTimestamp,
        actionLabel: s.actionLabel,
        actionUrl: s.actionUrl,
        suggestionData: undefined,
        isRead: false,
        isResolved: false,
        createdAt: Date.now(),
      });
      count++;
      existingKeys.add(key);
    }

    return { saved: count };
  },
});
