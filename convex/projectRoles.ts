import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// ─── Queries ───────────────────────────────────────────────

export const getRoles = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("projectRoles")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("asc")
      .collect();
  },
});

export const getRoleUsageCounts = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const roles = await ctx.db
      .query("projectRoles")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    const allMembers = await ctx.db
      .query("projectMembers")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    const counts: Record<string, number> = {};
    for (const role of roles) {
      counts[role._id] = allMembers.filter((m) => m.roleId === role._id).length;
    }
    return counts;
  },
});

// ─── Seed default roles ────────────────────────────────────

const DEFAULT_ROLES = [
  { name: "Sale", color: "#10b981" },
  { name: "Pre-sale", color: "#3b82f6" },
  { name: "Tech Infras", color: "#f59e0b" },
  { name: "Project Manager", color: "#8b5cf6" },
];

export const seedDefaultRoles = mutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("projectRoles")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    const existingNames = new Set(existing.map((r) => r.name));
    const now = Date.now();

    for (let i = 0; i < DEFAULT_ROLES.length; i++) {
      const role = DEFAULT_ROLES[i];
      if (!existingNames.has(role.name)) {
        await ctx.db.insert("projectRoles", {
          userId: args.userId,
          name: role.name,
          color: role.color,
          order: i,
          createdAt: now,
        });
      }
    }
  },
});

// ─── Mutations ─────────────────────────────────────────────

export const createRole = mutation({
  args: {
    userId: v.string(),
    name: v.string(),
    color: v.optional(v.string()),
    order: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("projectRoles", {
      userId: args.userId,
      name: args.name,
      color: args.color,
      order: args.order,
      createdAt: Date.now(),
    });
  },
});

export const updateRole = mutation({
  args: {
    id: v.id("projectRoles"),
    name: v.optional(v.string()),
    color: v.optional(v.string()),
    order: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const patch: Record<string, unknown> = {};
    if (updates.name !== undefined) patch.name = updates.name;
    if (updates.color !== undefined) patch.color = updates.color;
    if (updates.order !== undefined) patch.order = updates.order;
    return await ctx.db.patch(id, patch);
  },
});

export const deleteRole = mutation({
  args: { id: v.id("projectRoles") },
  handler: async (ctx, args) => {
    const role = await ctx.db.get(args.id);
    if (!role) return;

    // Check if any member is using this role
    const allMembers = await ctx.db
      .query("projectMembers")
      .withIndex("by_user", (q) => q.eq("userId", role.userId))
      .collect();

    const inUse = allMembers.some((m) => m.roleId === args.id);
    if (inUse) {
      throw new Error("Không thể xoá role đang được sử dụng bởi member");
    }

    return await ctx.db.delete(args.id);
  },
});
