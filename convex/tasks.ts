import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const getTasks = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tasks")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

export const createTask = mutation({
  args: {
    userId: v.string(),
    title: v.string(),
    estimatedTime: v.number(),
    startDate: v.optional(v.union(v.number(), v.null())),
    endDate: v.optional(v.union(v.number(), v.null())),
    notes: v.optional(v.string()),
    status: v.optional(v.string()),
    project: v.optional(v.id("projects")),
    order: v.optional(v.number()),
    pic: v.optional(v.string()),
    support: v.optional(v.string()),
    priority: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const insertObj = { ...args };
    if (insertObj.startDate === null) insertObj.startDate = undefined;
    if (insertObj.endDate === null) insertObj.endDate = undefined;
    return await ctx.db.insert("tasks", insertObj);
  },
});

export const updateTask = mutation({
  args: {
    id: v.id("tasks"),
    title: v.optional(v.string()),
    estimatedTime: v.optional(v.number()),
    startDate: v.optional(v.union(v.number(), v.null())),
    endDate: v.optional(v.union(v.number(), v.null())),
    notes: v.optional(v.string()),
    status: v.optional(v.string()),
    project: v.optional(v.id("projects")),
    order: v.optional(v.number()),
    pic: v.optional(v.string()),
    support: v.optional(v.string()),
    priority: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...rest } = args;
    const patchObj: any = { ...rest };
    if (rest.startDate === null) patchObj.startDate = undefined;
    if (rest.endDate === null) patchObj.endDate = undefined;
    return await ctx.db.patch(id, patchObj);
  },
});

export const updateTaskOrders = mutation({
  args: {
    updates: v.array(
      v.object({
        id: v.id("tasks"),
        order: v.number(),
        startDate: v.optional(v.number()),
        endDate: v.optional(v.number()),
        status: v.optional(v.string()),
        project: v.optional(v.union(v.id("projects"), v.null())),
      })
    ),
  },
  handler: async (ctx, args) => {
    for (const update of args.updates) {
      const patch: Record<string, unknown> = { order: update.order };
      if (update.startDate !== undefined) patch.startDate = update.startDate;
      if (update.endDate !== undefined) patch.endDate = update.endDate;
      if (update.status !== undefined) patch.status = update.status;
      if (update.project !== undefined) {
        patch.project = update.project === null ? undefined : update.project;
      }
      await ctx.db.patch(update.id, patch);
    }
  },
});

export const getTasksByProject = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tasks")
      .filter((q) => q.eq(q.field("project"), args.projectId))
      .collect();
  },
});

export const deleteTask = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    // Cascade delete dependencies
    const deps = await ctx.db
      .query("taskDependencies")
      .withIndex("by_task", (q) => q.eq("taskId", args.id))
      .collect();
    const depOn = await ctx.db
      .query("taskDependencies")
      .withIndex("by_depends_on", (q) => q.eq("dependsOnTaskId", args.id))
      .collect();
    for (const dep of [...deps, ...depOn]) {
      await ctx.db.delete(dep._id);
    }
    return await ctx.db.delete(args.id);
  },
});

// === DEPENDENCY FUNCTIONS ===

export const getAllDependencies = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("taskDependencies")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

export const getTaskDependencies = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    // Returns predecessor tasks that this task depends on
    return await ctx.db
      .query("taskDependencies")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .collect();
  },
});

export const getTaskDependents = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    // Returns successor tasks that depend on this task
    return await ctx.db
      .query("taskDependencies")
      .withIndex("by_depends_on", (q) => q.eq("dependsOnTaskId", args.taskId))
      .collect();
  },
});

export const createDependency = mutation({
  args: {
    userId: v.string(),
    taskId: v.id("tasks"),
    dependsOnTaskId: v.id("tasks"),
    dependencyType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, taskId, dependsOnTaskId, dependencyType } = args;

    // Prevent self-reference
    if (taskId === dependsOnTaskId) {
      throw new Error("Cannot create a dependency on itself");
    }

    // Check for duplicate
    const existing = await ctx.db
      .query("taskDependencies")
      .withIndex("by_task", (q) => q.eq("taskId", taskId))
      .collect();
    if (existing.some((d) => d.dependsOnTaskId === dependsOnTaskId)) {
      throw new Error("This dependency already exists");
    }

    // Circular dependency check: walk backwards from dependsOnTaskId
    // to see if we'd reach taskId, which would create a cycle.
    let visited = new Set<string>();
    let queue = [dependsOnTaskId];
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (currentId === taskId) {
        throw new Error("Circular dependency detected");
      }
      if (visited.has(currentId)) continue;
      visited.add(currentId);
      const deps = await ctx.db
        .query("taskDependencies")
        .withIndex("by_depends_on", (q) => q.eq("dependsOnTaskId", currentId))
        .collect();
      for (const d of deps) {
        queue.push(d.taskId);
      }
    }

    return await ctx.db.insert("taskDependencies", {
      userId,
      taskId,
      dependsOnTaskId,
      dependencyType: dependencyType || "finish-to-start",
    });
  },
});

export const deleteDependency = mutation({
  args: { id: v.id("taskDependencies") },
  handler: async (ctx, args) => {
    return await ctx.db.delete(args.id);
  },
});

export const isTaskBlocked = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    // A task is blocked if any of its predecessors are not done
    const deps = await ctx.db
      .query("taskDependencies")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .collect();

    for (const dep of deps) {
      const predecessor = await ctx.db.get(dep.dependsOnTaskId);
      if (predecessor && predecessor.status !== "done") {
        return true;
      }
    }
    return false;
  },
});
