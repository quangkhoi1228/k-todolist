import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// ─── Queries ───────────────────────────────────────────────

export const getByProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("projectIsdData")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .first();
  },
});

export const getByTicketId = query({
  args: { ticketId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("projectIsdData")
      .withIndex("by_ticket", (q) => q.eq("ticketId", args.ticketId))
      .first();
  },
});

// ─── Mutations ─────────────────────────────────────────────

export const upsertByProject = mutation({
  args: {
    projectId: v.id("projects"),
    userId: v.string(),
    ticketId: v.string(),
    summary: v.string(),
    status: v.optional(v.string()),
    priority: v.optional(v.string()),
    description: v.optional(v.string()),
    assignee: v.optional(v.string()),
    assigneeEmail: v.optional(v.string()),
    reporter: v.optional(v.string()),
    reporterEmail: v.optional(v.string()),
    creator: v.optional(v.string()),
    creatorEmail: v.optional(v.string()),
    owner: v.optional(v.string()),
    ownerEmail: v.optional(v.string()),
    ownerContact: v.optional(v.string()),
    issueType: v.optional(v.string()),
    projectKey: v.optional(v.string()),
    components: v.optional(v.array(v.string())),
    labels: v.optional(v.array(v.string())),
    createdDate: v.optional(v.string()),
    updatedDate: v.optional(v.string()),
    consultingTicketId: v.optional(v.string()),
    deploymentTicketId: v.optional(v.string()),
    resourceTicketIds: v.optional(v.array(v.string())),
    internalGroupUrl: v.optional(v.string()),
    customerGroupUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("projectIsdData")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .first();

    const data = {
      projectId: args.projectId,
      userId: args.userId,
      ticketId: args.ticketId,
      summary: args.summary,
      status: args.status,
      priority: args.priority,
      description: args.description,
      assignee: args.assignee,
      assigneeEmail: args.assigneeEmail,
      reporter: args.reporter,
      reporterEmail: args.reporterEmail,
      creator: args.creator,
      creatorEmail: args.creatorEmail,
      owner: args.owner,
      ownerEmail: args.ownerEmail,
      ownerContact: args.ownerContact,
      issueType: args.issueType,
      projectKey: args.projectKey,
      components: args.components,
      labels: args.labels,
      createdDate: args.createdDate,
      updatedDate: args.updatedDate,
      consultingTicketId: args.consultingTicketId,
      deploymentTicketId: args.deploymentTicketId,
      resourceTicketIds: args.resourceTicketIds,
      internalGroupUrl: args.internalGroupUrl,
      customerGroupUrl: args.customerGroupUrl,
      fetchedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, data);
      return existing._id;
    } else {
      return await ctx.db.insert("projectIsdData", data);
    }
  },
});

export const removeByProject = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("projectIsdData")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .first();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});
