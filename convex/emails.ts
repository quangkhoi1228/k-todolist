import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// ─── Queries ───────────────────────────────────────────────

/**
 * Get emails sent by a user, ordered by most recent first.
 * Optionally filter by projectId.
 */
export const getByUser = query({
  args: {
    userId: v.string(),
    limit: v.optional(v.number()),
    projectId: v.optional(v.id("projects")),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;

    if (args.projectId) {
      return await ctx.db
        .query("sentEmails")
        .withIndex("by_user_project", (q) =>
          q.eq("userId", args.userId).eq("projectId", args.projectId)
        )
        .order("desc")
        .take(limit);
    }

    return await ctx.db
      .query("sentEmails")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(limit);
  },
});

/**
 * Get emails for a specific project, ordered by most recent first.
 */
export const getByProject = query({
  args: { projectId: v.id("projects"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    return await ctx.db
      .query("sentEmails")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(limit);
  },
});

/**
 * Get a single email by ID.
 */
export const getById = query({
  args: { id: v.id("sentEmails") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// ─── Mutations ─────────────────────────────────────────────

/**
 * Create an email log entry (status: "sending").
 * Called before the automation starts.
 */
export const createEmailLog = mutation({
  args: {
    userId: v.string(),
    to: v.array(v.string()),
    cc: v.optional(v.array(v.string())),
    bcc: v.optional(v.array(v.string())),
    subject: v.string(),
    body: v.string(),
    attachmentNames: v.optional(v.array(v.string())),
    importance: v.optional(v.string()),
    projectId: v.optional(v.id("projects")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("sentEmails", {
      userId: args.userId,
      to: args.to,
      cc: args.cc,
      bcc: args.bcc,
      subject: args.subject,
      body: args.body,
      attachmentNames: args.attachmentNames,
      importance: args.importance,
      projectId: args.projectId,
      status: "sending",
      sentAt: Date.now(),
    });
  },
});

/**
 * Update email status after send attempt.
 */
export const updateEmailStatus = mutation({
  args: {
    id: v.id("sentEmails"),
    status: v.string(),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: args.status,
      errorMessage: args.errorMessage,
    });
  },
});

/**
 * Update email project association.
 */
export const setProject = mutation({
  args: {
    id: v.id("sentEmails"),
    projectId: v.optional(v.id("projects")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { projectId: args.projectId });
  },
});

/**
 * Delete an email log entry.
 */
export const deleteEmail = mutation({
  args: { id: v.id("sentEmails") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});
