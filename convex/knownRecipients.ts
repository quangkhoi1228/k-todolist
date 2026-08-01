import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// ─── Queries ───────────────────────────────────────────────

/**
 * Search known recipients by query string (email or name prefix).
 * Results ordered by most recently used first.
 */
export const search = query({
  args: { userId: v.string(), query: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    const q = args.query.toLowerCase().trim();

    // Get all recipients for this user (Convex doesn't support prefix search)
    const all = await ctx.db
      .query("knownRecipients")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(200);

    // Filter by query
    const filtered = all.filter(
      (r) =>
        r.email.toLowerCase().includes(q) ||
        (r.name && r.name.toLowerCase().includes(q))
    );

    // Sort: most recently used first
    filtered.sort((a, b) => b.lastUsedAt - a.lastUsedAt);

    return filtered.slice(0, limit);
  },
});

/**
 * Get all known recipients for a user.
 */
export const getAll = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("knownRecipients")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .collect();
  },
});

// ─── Mutations ─────────────────────────────────────────────

/**
 * Save or update a known recipient.
 * If the email already exists for this user, updates lastUsedAt and increments useCount.
 */
export const saveRecipient = mutation({
  args: {
    userId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (!email.includes("@")) return;

    // Check if already exists
    const existing = await ctx.db
      .query("knownRecipients")
      .withIndex("by_user_email", (q) =>
        q.eq("userId", args.userId).eq("email", email)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name ?? existing.name,
        lastUsedAt: Date.now(),
        useCount: existing.useCount + 1,
      });
    } else {
      await ctx.db.insert("knownRecipients", {
        userId: args.userId,
        email,
        name: args.name,
        lastUsedAt: Date.now(),
        useCount: 1,
      });
    }
  },
});

/**
 * Save multiple recipients at once (e.g. after sending an email).
 */
export const saveRecipients = mutation({
  args: {
    userId: v.string(),
    emails: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    for (const email of args.emails) {
      const trimmed = email.trim().toLowerCase();
      if (!trimmed.includes("@")) continue;

      const existing = await ctx.db
        .query("knownRecipients")
        .withIndex("by_user_email", (q) =>
          q.eq("userId", args.userId).eq("email", trimmed)
        )
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, {
          lastUsedAt: Date.now(),
          useCount: existing.useCount + 1,
        });
      } else {
        await ctx.db.insert("knownRecipients", {
          userId: args.userId,
          email: trimmed,
          lastUsedAt: Date.now(),
          useCount: 1,
        });
      }
    }
  },
});
