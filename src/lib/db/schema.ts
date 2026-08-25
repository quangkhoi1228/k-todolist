import {
  pgTable,
  text,
  integer,
  boolean,
  jsonb,
  bigserial,
  real,
  doublePrecision,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// ─── Helper: BIGINT as string (JSON-safe) ───────────────────
export const bigintAsString = (name: string) =>
  bigserial(name, { mode: "number" });

// ─── projects ───────────────────────────────────────────────
export const projects = pgTable(
  "projects",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("userId").notNull(),
    name: text("name").notNull(),
    color: text("color"),
    order: real("order"),
    archived: boolean("archived"),
    notes: text("notes"),
    deletedAt: real("deletedAt"),
    createdAt: real("createdAt").notNull().default(0),
  },
  (t) => [index("projects_by_user").on(t.userId)]
);

// ─── tasks ──────────────────────────────────────────────────
export const tasks = pgTable(
  "tasks",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("userId").notNull(),
    title: text("title").notNull(),
    estimatedTime: real("estimatedTime").notNull(), // hours
    startDate: doublePrecision("startDate"), // ms epoch
    endDate: doublePrecision("endDate"),
    status: text("status"), // 'todo','processing','pending','done'
    isCompleted: boolean("isCompleted"),
    project: integer("project"), // FK projects.id
    order: real("order"),
    pic: text("pic"),
    support: text("support"),
    path: text("path"), // đường dẫn phân cấp, vd "1. Chuẩn bị / 2.1 Hạ tầng"
    priority: text("priority"), // 'low','normal','high'
    notes: text("notes"),
    createdAt: real("createdAt").notNull().default(0),
  },
  (t) => [
    index("tasks_by_user").on(t.userId),
    index("tasks_by_project").on(t.project),
  ]
);

// ─── taskDependencies ───────────────────────────────────────
export const taskDependencies = pgTable(
  "taskDependencies",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("userId").notNull(),
    taskId: integer("taskId").notNull(), // successor
    dependsOnTaskId: integer("dependsOnTaskId").notNull(), // predecessor
    dependencyType: text("dependencyType").notNull().default("finish-to-start"),
  },
  (t) => [
    index("taskDeps_by_user").on(t.userId),
    index("taskDeps_by_task").on(t.taskId),
    index("taskDeps_by_depends").on(t.dependsOnTaskId),
    uniqueIndex("taskDeps_unique").on(t.taskId, t.dependsOnTaskId),
  ]
);

// ─── userPreferences ────────────────────────────────────────
export const userPreferences = pgTable(
  "userPreferences",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("userId").notNull(),
    hideDoneTasks: boolean("hideDoneTasks").notNull().default(false),
  },
  (t) => [uniqueIndex("prefs_by_user").on(t.userId)]
);

// ─── notes ──────────────────────────────────────────────────
export const notes = pgTable(
  "notes",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("userId").notNull(),
    title: text("title").notNull(),
    content: text("content"),
    projectId: integer("projectId"),
    parentNoteId: integer("parentNoteId"),
    order: real("order"),
    icon: text("icon"),
    shareSlug: text("shareSlug"),
    createdAt: real("createdAt").notNull().default(0),
  },
  (t) => [
    index("notes_by_user").on(t.userId),
    index("notes_by_project").on(t.projectId),
    index("notes_by_parent").on(t.parentNoteId),
    uniqueIndex("notes_by_slug").on(t.shareSlug),
  ]
);

// ─── projectRoles ───────────────────────────────────────────
export const projectRoles = pgTable(
  "projectRoles",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("userId").notNull(),
    name: text("name").notNull(),
    color: text("color"),
    order: real("order"),
    capabilities: jsonb("capabilities"), // array of {key,label,enabled,note?}
    createdAt: real("createdAt").notNull(),
  },
  (t) => [index("roles_by_user").on(t.userId), uniqueIndex("roles_by_user_name").on(t.userId, t.name)]
);

// ─── projectMembers ─────────────────────────────────────────
export const projectMembers = pgTable(
  "projectMembers",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    projectId: integer("projectId").notNull(),
    userId: text("userId").notNull(),
    name: text("name").notNull(),
    email: text("email"),
    roleId: integer("roleId"), // FK roles.id
    roleName: text("roleName").notNull(),
    source: text("source").notNull(), // manual (giữ cột cho tương thích dữ liệu cũ)
    permissions: jsonb("permissions"), // array of {key,label,enabled,note?}
    createdAt: real("createdAt").notNull(),
  },
  (t) => [
    index("members_by_project").on(t.projectId),
    index("members_by_user").on(t.userId),
  ]
);

// ─── files (uploaded images) ────────────────────────────────
export const files = pgTable(
  "files",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("userId").notNull(),
    name: text("name").notNull(),
    mimeType: text("mimeType").notNull(),
    size: integer("size").notNull(),
    data: text("data").notNull(), // base64 data URL
    createdAt: real("createdAt").notNull(),
  },
  (t) => [index("files_by_user").on(t.userId)]
);

// ─── taskTemplates (task list mẫu — DÙNG CHUNG cho mọi user) ──────────────
export const taskTemplates = pgTable(
  "taskTemplates",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("userId"), // nullable — dùng chung, không còn per-user
    name: text("name").notNull(),
    category: text("category"),
    description: text("description"),
    items: jsonb("items").notNull(), // array of { phase, title, details?, support?, manday?, startOffsetDays?, endOffsetDays? } hoặc { type:"module", moduleId }
    triggers: jsonb("triggers"), // từ khoá để auto-detect từ mô tả dự án
    isActive: boolean("isActive").notNull().default(true),
    createdAt: real("createdAt").notNull(),
    updatedAt: real("updatedAt").notNull(),
  },
  (t) => [
    index("tt_by_active").on(t.isActive),
  ]
);

// ─── taskModules (module task tái sử dụng — DÙNG CHUNG, template tham chiếu) ─
export const taskModules = pgTable(
  "taskModules",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("userId"), // nullable — dùng chung, không còn per-user
    name: text("name").notNull(),
    description: text("description"),
    items: jsonb("items").notNull(),
    createdAt: real("createdAt").notNull(),
    updatedAt: real("updatedAt").notNull(),
  }
);
