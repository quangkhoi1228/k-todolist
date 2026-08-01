import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  scrapedGroups: defineTable({
    userId: v.string(),
    platform: v.string(), // "teams" | "zalo"
    name: v.string(),
    url: v.optional(v.string()), // mainly for Teams URLs
    scrapedAt: v.number(),
    syncedAt: v.optional(v.number()),
  }).index("by_user_platform", ["userId", "platform"]),

  projects: defineTable({
    userId: v.string(),
    name: v.string(),
    color: v.optional(v.string()),
    order: v.optional(v.number()),
    archived: v.optional(v.boolean()),
    notes: v.optional(v.string()),
    deletedAt: v.optional(v.number()),
    internalGroupUrl: v.optional(v.string()), // Deprecated
    customerGroupUrl: v.optional(v.string()), // Deprecated
    teamsGroups: v.optional(
      v.array(
        v.object({
          name: v.string(), // URL or name
          type: v.string(), // "internal" | "customer"
          platform: v.optional(v.string()), // "teams" | "zalo" — default "teams"
        })
      )
    ),
    ticketId: v.optional(v.string()), // ISD ticket key (e.g. "ISD-12345")
    isdStatus: v.optional(v.string()), // ISD ticket status name (e.g. "In Progress")
    isdUpdatedAt: v.optional(v.number()), // Last time ISD status was fetched
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
    autoSyncInterval: v.optional(v.number()), // in minutes (0 means disabled)
    lastSyncTime: v.optional(v.number()), // Unix timestamp
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

  pmAgentSessions: defineTable({
    userId: v.string(),
    ticketId: v.string(),
    projectName: v.string(),
    salesInfo: v.string(), // JSON: { name, contact, email }
    status: v.string(), // 'active', 'completed', 'cancelled'
    currentStep: v.string(), // 'init', 'kickoff', 'sow_draft', 'sow_review', 'completed', 'general'
    workflowData: v.string(), // JSON: { personnel, meeting, sow, notes }
    isdTicketData: v.optional(v.string()), // JSON: cached ISD ticket data
    isdConfig: v.optional(v.string()), // JSON: { endpoint, token }
    presaleInfo: v.optional(v.string()), // JSON: presale contact info
    type: v.optional(v.string()), // 'project' | 'general' — default 'project' for backward compat
    projectId: v.optional(v.id("projects")), // KFlow project ID (for project-type sessions)
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_project", ["projectId"])
    .index("by_user_type", ["userId", "type"]),

  pmAgentMessages: defineTable({
    sessionId: v.id("pmAgentSessions"),
    role: v.string(), // 'agent', 'user', 'system'
    content: v.string(),
    metadata: v.optional(v.string()), // JSON: action, step references
    createdAt: v.number(),
  })
    .index("by_session", ["sessionId"])
    .index("by_session_order", ["sessionId", "createdAt"]),

  projectSuggestions: defineTable({
    projectId: v.id("projects"),
    userId: v.string(),
    type: v.string(), // "transfer_request", "mention", "action_item", "deadline", "info", "warning"
    title: v.string(),
    description: v.string(),
    sourceMessage: v.optional(v.string()), // The Teams message that triggered this
    sourceSender: v.optional(v.string()),
    sourceChatName: v.optional(v.string()),
    sourceTimestamp: v.optional(v.string()),
    actionLabel: v.optional(v.string()),
    actionUrl: v.optional(v.string()),
    suggestionData: v.optional(v.string()), // JSON: extra data
    isRead: v.boolean(),
    isResolved: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_user", ["userId"])
    .index("by_user_unresolved", ["userId", "isResolved"]),

  projectChats: defineTable({
    projectId: v.id("projects"),
    chatName: v.string(), // "Nhóm khách hàng" or "Nhóm nội bộ"
    messageId: v.string(), // Hash or composite key to prevent duplicates
    sender: v.string(),
    senderAvatar: v.optional(v.string()),
    content: v.string(),
    images: v.optional(v.string()), // JSON array of image URLs
    timestamp: v.string(),
    timestampMs: v.optional(v.number()), // Unix timestamp for stable dedup
    scrapedAt: v.number(),
    platform: v.optional(v.string()), // "teams" | "zalo" — default "teams"
    isMine: v.optional(v.boolean()), // True if sent by the logged-in user
  })
    .index("by_project", ["projectId"])
    .index("by_project_chat", ["projectId", "chatName"])
    .index("by_project_and_time", ["projectId", "timestamp"])
    .index("by_messageId", ["messageId"]),

  syncLogs: defineTable({
    projectId: v.optional(v.id("projects")),
    chatName: v.optional(v.string()),
    type: v.string(), // "sync_start", "sync_end", "sync_error", "sync_progress"
    message: v.string(),
    details: v.optional(v.string()), // JSON: extra data like count, errors
    createdAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_type", ["type"])
    .index("by_created_at", ["createdAt"]),

  sentEmails: defineTable({
    userId: v.string(),
    to: v.array(v.string()),
    cc: v.optional(v.array(v.string())),
    bcc: v.optional(v.array(v.string())),
    subject: v.string(),
    body: v.string(),          // HTML content
    attachmentNames: v.optional(v.array(v.string())),
    importance: v.optional(v.string()), // "low" | "normal" | "high"
    status: v.string(),        // "sending" | "sent" | "failed"
    errorMessage: v.optional(v.string()),
    projectId: v.optional(v.id("projects")),
    sentAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_project", ["projectId"])
    .index("by_user_and_status", ["userId", "status"])
    .index("by_user_project", ["userId", "projectId"]),

  knownRecipients: defineTable({
    userId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    lastUsedAt: v.number(),
    useCount: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_email", ["userId", "email"]),

  // ─── Project Roles (system-wide, per user) ───────────────
  projectRoles: defineTable({
    userId: v.string(),           // Clerk user ID
    name: v.string(),             // Tên role: "Sale", "Pre-sale", "Tech Infras", ...
    color: v.optional(v.string()), // Màu hiển thị (hex)
    order: v.optional(v.number()), // Thứ tự sắp xếp
    createdAt: v.number(),
  }).index("by_user", ["userId"]),

  // ─── Project Members (project-specific) ──────────────────
  projectMembers: defineTable({
    projectId: v.id("projects"),
    userId: v.string(),           // Clerk user ID (chủ dự án)
    name: v.string(),             // Tên member
    email: v.optional(v.string()),
    roleId: v.optional(v.id("projectRoles")), // FK tới roles
    roleName: v.string(),          // Denormalized role name
    source: v.string(),            // "isd" | "manual"
    createdAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_user", ["userId"]),

  // ─── Project ISD Data ─────────────────────────────────────
  projectIsdData: defineTable({
    projectId: v.id("projects"),
    userId: v.string(),           // Clerk user ID (chủ dự án)
    // Ticket info
    ticketId: v.string(),         // ISD ticket key (e.g. "ISD-12345")
    summary: v.string(),          // Ticket summary/title
    status: v.optional(v.string()),
    priority: v.optional(v.string()),
    description: v.optional(v.string()),
    // People
    assignee: v.optional(v.string()),
    assigneeEmail: v.optional(v.string()),
    reporter: v.optional(v.string()),  // Người yêu cầu
    reporterEmail: v.optional(v.string()),
    creator: v.optional(v.string()),
    creatorEmail: v.optional(v.string()),
    owner: v.optional(v.string()),
    ownerEmail: v.optional(v.string()),
    ownerContact: v.optional(v.string()),
    // Metadata
    issueType: v.optional(v.string()),
    projectKey: v.optional(v.string()),
    components: v.optional(v.array(v.string())),
    labels: v.optional(v.array(v.string())),
    createdDate: v.optional(v.string()),
    updatedDate: v.optional(v.string()),
    // Custom fields
    consultingTicketId: v.optional(v.string()),
    deploymentTicketId: v.optional(v.string()),
    resourceTicketIds: v.optional(v.array(v.string())),
    internalGroupUrl: v.optional(v.string()),
    customerGroupUrl: v.optional(v.string()),
    // Sync
    fetchedAt: v.number(),        // When this data was last fetched
  })
    .index("by_project", ["projectId"])
    .index("by_ticket", ["ticketId"]),
});
