import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  projects: defineTable({
    userId: v.string(),
    name: v.string(),
    color: v.optional(v.string()),
    order: v.optional(v.number()),
    archived: v.optional(v.boolean()),
    notes: v.optional(v.string()),
  }).index("by_user", ["userId"]),
  
  tasks: defineTable({
    userId: v.string(),
    title: v.string(),
    estimatedTime: v.number(), // in hours
    startDate: v.optional(v.union(v.number(), v.null())), // timestamp
    endDate: v.optional(v.union(v.number(), v.null())), // timestamp
    status: v.optional(v.string()), // 'todo', 'processing', 'pending', 'done' — kanban also has virtual 'dueToday'
    isCompleted: v.optional(v.boolean()),
    project: v.optional(v.id("projects")),
    order: v.optional(v.number()),
    pic: v.optional(v.string()), // Person In Charge
    support: v.optional(v.string()),
    priority: v.optional(v.string()), // 'low', 'normal', 'high'
  }).index("by_user", ["userId"]),

  taskDependencies: defineTable({
    userId: v.string(),
    taskId: v.id("tasks"), // successor - task phụ thuộc
    dependsOnTaskId: v.id("tasks"), // predecessor - task được phụ thuộc
    dependencyType: v.string(), // 'finish-to-start'
  })
    .index("by_user", ["userId"])
    .index("by_task", ["taskId"])
    .index("by_depends_on", ["dependsOnTaskId"]),

  userPreferences: defineTable({
    userId: v.string(),
    hideDoneTasks: v.boolean(),
  }).index("by_user", ["userId"]),

  notes: defineTable({
    userId: v.string(),
    title: v.string(),
    content: v.optional(v.string()),
    projectId: v.optional(v.id("projects")),
    parentNoteId: v.optional(v.id("notes")),
    order: v.optional(v.number()),
    icon: v.optional(v.string()),
    shareSlug: v.optional(v.string()),
  })
    .index("by_user", ["userId"])
    .index("by_project", ["projectId"])
    .index("by_parent", ["parentNoteId"])
    .index("by_shareSlug", ["shareSlug"]),
});
