import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// ─── Queries ───────────────────────────────────────────────

export const getMembersByProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("projectMembers")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

// ─── Mutations ─────────────────────────────────────────────

export const addMember = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    roleId: v.optional(v.id("projectRoles")),
    roleName: v.string(),
    source: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("projectMembers", {
      projectId: args.projectId,
      userId: args.userId,
      name: args.name,
      email: args.email,
      roleId: args.roleId,
      roleName: args.roleName,
      source: args.source,
      createdAt: Date.now(),
    });
  },
});

export const updateMember = mutation({
  args: {
    id: v.id("projectMembers"),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    roleId: v.optional(v.id("projectRoles")),
    roleName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const patch: Record<string, unknown> = {};
    if (updates.name !== undefined) patch.name = updates.name;
    if (updates.email !== undefined) patch.email = updates.email;
    if (updates.roleId !== undefined) patch.roleId = updates.roleId;
    if (updates.roleName !== undefined) patch.roleName = updates.roleName;
    return await ctx.db.patch(id, patch);
  },
});

export const removeMember = mutation({
  args: { id: v.id("projectMembers") },
  handler: async (ctx, args) => {
    return await ctx.db.delete(args.id);
  },
});
