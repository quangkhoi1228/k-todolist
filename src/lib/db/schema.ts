import {
  pgTable,
  text,
  integer,
  boolean,
  jsonb,
  bigserial,
  bigint,
  real,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// ─── Helper: BIGINT as string (JSON-safe) ───────────────────
export const bigintAsString = (name: string) =>
  bigserial(name, { mode: "number" });

// ─── scrapedGroups ──────────────────────────────────────────
export const scrapedGroups = pgTable(
  "scrapedGroups",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("userId").notNull(),
    platform: text("platform").notNull(), // "teams" | "zalo"
    name: text("name").notNull(),
    url: text("url"), // mainly for Teams URLs
    scrapedAt: real("scrapedAt").notNull(), // ms epoch
    syncedAt: real("syncedAt"),
  },
  (t) => [
    index("scrapedGroups_by_user_platform").on(t.userId, t.platform),
  ]
);

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
    internalGroupUrl: text("internalGroupUrl"), // Deprecated
    customerGroupUrl: text("customerGroupUrl"), // Deprecated
    teamsGroups: jsonb("teamsGroups"), // array of {name,type,platform,url}
    ticketId: text("ticketId"),
    isdStatus: text("isdStatus"),
    isdUpdatedAt: real("isdUpdatedAt"),
    phase: text("phase").notNull().default("init"), // "init" | "kickoff" — giai đoạn workflow dự án
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
    startDate: real("startDate"), // timestamp
    endDate: real("endDate"),
    status: text("status"), // 'todo','processing','pending','done'
    isCompleted: boolean("isCompleted"),
    project: integer("project"), // FK projects.id
    order: real("order"),
    pic: text("pic"),
    support: text("support"),
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
    autoSyncInterval: integer("autoSyncInterval").notNull().default(0),
    lastSyncTime: real("lastSyncTime").notNull().default(0),
    chatSyncMode: text("chatSyncMode").notNull().default("incremental"),
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

// ─── pmAgentSessions ────────────────────────────────────────
export const pmAgentSessions = pgTable(
  "pmAgentSessions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("userId").notNull(),
    ticketId: text("ticketId").notNull(),
    projectName: text("projectName").notNull(),
    salesInfo: text("salesInfo").notNull(), // JSON
    status: text("status").notNull(), // active|completed|cancelled
    currentStep: text("currentStep").notNull(), // init|kickoff|sow_draft|sow_review|completed|general
    workflowData: text("workflowData").notNull(), // JSON
    isdTicketData: text("isdTicketData"), // JSON
    isdConfig: text("isdConfig"), // JSON
    presaleInfo: text("presaleInfo"), // JSON
    type: text("type"), // project|general
    projectId: integer("projectId"),
    createdAt: real("createdAt").notNull(),
    updatedAt: real("updatedAt").notNull(),
  },
  (t) => [
    index("sessions_by_user").on(t.userId),
    index("sessions_by_project").on(t.projectId),
    index("sessions_by_user_type").on(t.userId, t.type),
  ]
);

// ─── pmAgentMessages ────────────────────────────────────────
export const pmAgentMessages = pgTable(
  "pmAgentMessages",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    sessionId: integer("sessionId").notNull(),
    role: text("role").notNull(), // agent|user|system
    content: text("content").notNull(),
    metadata: text("metadata"), // JSON
    createdAt: real("createdAt").notNull(),
  },
  (t) => [
    index("messages_by_session").on(t.sessionId),
    index("messages_by_session_order").on(t.sessionId, t.createdAt),
  ]
);

// ─── projectSuggestions ─────────────────────────────────────
export const projectSuggestions = pgTable(
  "projectSuggestions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    projectId: integer("projectId").notNull(),
    userId: text("userId").notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    sourceMessage: text("sourceMessage"),
    sourceSender: text("sourceSender"),
    sourceChatName: text("sourceChatName"),
    sourceTimestamp: text("sourceTimestamp"),
    actionLabel: text("actionLabel"),
    actionUrl: text("actionUrl"),
    suggestionData: text("suggestionData"), // JSON
    isRead: boolean("isRead").notNull().default(false),
    isResolved: boolean("isResolved").notNull().default(false),
    createdAt: real("createdAt").notNull(),
  },
  (t) => [
    index("suggestions_by_project").on(t.projectId),
    index("suggestions_by_user").on(t.userId),
    index("suggestions_by_user_unresolved").on(t.userId, t.isResolved),
  ]
);

// ─── projectChats ───────────────────────────────────────────
export const projectChats = pgTable(
  "projectChats",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    projectId: integer("projectId").notNull(),
    chatName: text("chatName").notNull(),
    messageId: text("messageId").notNull(),
    sender: text("sender").notNull(),
    senderAvatar: text("senderAvatar"),
    content: text("content").notNull(),
    images: text("images"), // JSON array of image URLs
    timestamp: text("timestamp").notNull(),
    // bigint giữ chính xác epoch ms (~1.7e12). `real` (float4) trước đây mất
    // precision (~64s) khiến các message gần nhau bị trùng timestamp →
    // watermark incremental lệch → early-stop sai → thiếu message cuối.
    timestampMs: bigint("timestampMs", { mode: "number" }),
    scrapedAt: bigint("scrapedAt", { mode: "number" }).notNull(),
    platform: text("platform"), // teams|zalo
    isMine: boolean("isMine"),
  },
  (t) => [
    index("chats_by_project").on(t.projectId),
    index("chats_by_project_chat").on(t.projectId, t.chatName),
    index("chats_by_project_time").on(t.projectId, t.timestamp),
    uniqueIndex("chats_by_project_messageId").on(t.projectId, t.messageId),
  ]
);

// ─── syncLogs ───────────────────────────────────────────────
export const syncLogs = pgTable(
  "syncLogs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    projectId: integer("projectId"),
    userId: text("userId"), // chủ sở hữu log (lọc theo user đang đăng nhập)
    chatName: text("chatName"),
    type: text("type").notNull(),
    message: text("message").notNull(),
    details: text("details"), // JSON
    createdAt: real("createdAt").notNull(),
  },
  (t) => [
    index("logs_by_project").on(t.projectId),
    index("logs_by_user").on(t.userId),
    index("logs_by_type").on(t.type),
    index("logs_by_created").on(t.createdAt),
  ]
);

// ─── sentEmails ─────────────────────────────────────────────
export const sentEmails = pgTable(
  "sentEmails",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("userId").notNull(),
    to: jsonb("to").notNull(), // string[]
    cc: jsonb("cc"), // string[]
    bcc: jsonb("bcc"), // string[]
    subject: text("subject").notNull(),
    body: text("body").notNull(), // HTML
    attachmentNames: jsonb("attachmentNames"), // string[]
    importance: text("importance"), // low|normal|high
    status: text("status").notNull(), // sending|sent|failed
    errorMessage: text("errorMessage"),
    projectId: integer("projectId"),
    sentAt: real("sentAt").notNull(),
  },
  (t) => [
    index("emails_by_user").on(t.userId),
    index("emails_by_project").on(t.projectId),
    index("emails_by_user_status").on(t.userId, t.status),
    index("emails_by_user_project").on(t.userId, t.projectId),
  ]
);

// ─── knownRecipients ────────────────────────────────────────
export const knownRecipients = pgTable(
  "knownRecipients",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("userId").notNull(),
    email: text("email").notNull(),
    name: text("name"),
    lastUsedAt: real("lastUsedAt").notNull(),
    useCount: integer("useCount").notNull(),
  },
  (t) => [
    index("recipients_by_user").on(t.userId),
    uniqueIndex("recipients_by_user_email").on(t.userId, t.email),
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
    capabilities: jsonb("capabilities"), // array of {key,label,enabled,note?} — chức năng role được phép thực hiện
    createdAt: real("createdAt").notNull(),
  },
  (t) => [index("roles_by_user").on(t.userId)]
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
    source: text("source").notNull(), // isd|manual
    permissions: jsonb("permissions"), // array of {key,label,enabled,note?} — ghi đè capabilities của role cho riêng member
    createdAt: real("createdAt").notNull(),
  },
  (t) => [
    index("members_by_project").on(t.projectId),
    index("members_by_user").on(t.userId),
  ]
);

// ─── projectIsdData ─────────────────────────────────────────
export const projectIsdData = pgTable(
  "projectIsdData",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    projectId: integer("projectId").notNull(),
    userId: text("userId").notNull(),
    ticketId: text("ticketId").notNull(),
    summary: text("summary").notNull(),
    status: text("status"),
    priority: text("priority"),
    description: text("description"),
    assignee: text("assignee"),
    assigneeEmail: text("assigneeEmail"),
    reporter: text("reporter"),
    reporterEmail: text("reporterEmail"),
    creator: text("creator"),
    creatorEmail: text("creatorEmail"),
    owner: text("owner"),
    ownerEmail: text("ownerEmail"),
    ownerContact: text("ownerContact"),
    issueType: text("issueType"),
    projectKey: text("projectKey"),
    components: jsonb("components"), // string[]
    labels: jsonb("labels"), // string[]
    createdDate: text("createdDate"),
    updatedDate: text("updatedDate"),
    consultingTicketId: text("consultingTicketId"),
    deploymentTicketId: text("deploymentTicketId"),
    resourceTicketIds: jsonb("resourceTicketIds"), // string[]
    internalGroupUrl: text("internalGroupUrl"),
    customerGroupUrl: text("customerGroupUrl"),
    fetchedAt: real("fetchedAt").notNull(),
  },
  (t) => [
    index("isd_by_project").on(t.projectId),
    index("isd_by_ticket").on(t.ticketId),
  ]
);

// ─── files (uploaded images, replaces Convex storage) ───────
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

// ─── taskTemplates (task list mẫu — render task list theo template) ─────────
export const taskTemplates = pgTable(
  "taskTemplates",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("userId").notNull(),
    name: text("name").notNull(), // tên template (vd: "Migration Cloud")
    category: text("category"), // phân loại (vd: "migration", "security", "waf", "general")
    description: text("description"), // mô tả khi nào dùng template này
    items: jsonb("items").notNull(), // array of { phase, title, details?, pic?, support?, manday?, startOffsetDays?, endOffsetDays? }
    triggers: jsonb("triggers"), // từ khoá để auto-detect từ mô tả dự án (vd: ["migrate", "migration", "onpremise"])
    isActive: boolean("isActive").notNull().default(true),
    createdAt: real("createdAt").notNull(),
    updatedAt: real("updatedAt").notNull(),
  },
  (t) => [
    index("tt_by_user").on(t.userId),
    index("tt_by_user_active").on(t.userId, t.isActive),
  ]
);

// ─── projectSummaries (bản tóm tắt dự án theo version — hiện trạng + next actions) ─────
export const projectSummaries = pgTable(
  "projectSummaries",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    projectId: integer("projectId").notNull(),
    userId: text("userId").notNull(),
    version: integer("version").notNull(), // tăng dần theo project (bắt đầu 1)
    trigger: text("trigger").notNull(), // auto | manual
    summaryText: text("summaryText").notNull(), // payload markdown
    summaryData: jsonb("summaryData").notNull(), // snapshot cấu trúc cho UI
    createdAt: real("createdAt").notNull(),
  },
  (t) => [
    index("summaries_by_project").on(t.projectId),
    index("summaries_by_user").on(t.userId),
  ]
);

// ─── projectWorkflows (flow init → kick-off: dữ liệu + tiến độ từng bước) ─────
export const projectWorkflows = pgTable(
  "projectWorkflows",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    projectId: integer("projectId").notNull(),
    userId: text("userId").notNull(),
    phase: text("phase").notNull().default("init"), // "init" | "kickoff"
    // Dữ liệu nhập theo từng bước: { stepKey: "done" | "skipped" | undefined }
    steps: jsonb("steps").notNull().default({}),
    // Input ban đầu của dự án (nhập khi init): presale, external groups, internal groups
    initData: jsonb("initData"),
    // Input yêu cầu sơ bộ dự án (nhập khi kick-off)
    requirements: jsonb("requirements"),
    // Các câu hỏi kick-off đã gửi (snapshot để tracking)
    kickoffQuestions: jsonb("kickoffQuestions"),
    // Link task tracking đã tự sinh
    taskIds: jsonb("taskIds"),
    // SoW planning (phase sow): template đề xuất + task list output
    // { templateId, templateName, templateCategory, items: TaskTemplateItem[], taskIds: number[] }
    sowPlan: jsonb("sowPlan"),
    // LLM phân tích yêu cầu sơ bộ: scope + next actions + tính năng multi-choice đã chọn
    // { scope: string[], nextActions: string[], featureSuggestions: string[], selectedFeatures: string[], source: "llm"|"fallback" }
    preinfoAnalysis: jsonb("preinfoAnalysis"),
    updatedAt: real("updatedAt").notNull(),
    createdAt: real("createdAt").notNull(),
  },
  (t) => [
    index("wf_by_project").on(t.projectId),
    index("wf_by_user").on(t.userId),
  ]
);
