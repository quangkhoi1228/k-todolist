import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  projects: defineTable({
    userId: v.string(),
    name: v.string(),
    color: v.optional(v.string()),
    order: v.optional(v.number()),
  }).index("by_user", ["userId"]),
  
  tasks: defineTable({
    userId: v.string(),
    title: v.string(),
    estimatedTime: v.number(), // in hours
    startDate: v.number(), // timestamp
    endDate: v.number(), // timestamp
    status: v.optional(v.string()), // 'todo', 'processing', 'pending', 'done'
    isCompleted: v.optional(v.boolean()),
    project: v.optional(v.id("projects")),
    order: v.optional(v.number()),
    pic: v.optional(v.string()), // Person In Charge
    support: v.optional(v.string()),
    priority: v.optional(v.string()), // 'low', 'normal', 'high'
  }).index("by_user", ["userId"]),
});
