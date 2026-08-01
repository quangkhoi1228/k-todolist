import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

// ─── Queries ───────────────────────────────────────────────

export const getSessions = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("pmAgentSessions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .collect();
  },
});

export const getSession = query({
  args: { id: v.id("pmAgentSessions") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const getSessionByTicket = query({
  args: { userId: v.string(), ticketId: v.string() },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("pmAgentSessions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    return sessions.find((s) => s.ticketId === args.ticketId && s.status === "active") || null;
  },
});

export const getMessages = query({
  args: { sessionId: v.id("pmAgentSessions") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("pmAgentMessages")
      .withIndex("by_session_order", (q) => q.eq("sessionId", args.sessionId))
      .order("asc")
      .collect();
  },
});

// ─── New queries for context-aware sessions ───────────────

/**
 * Get the general session for a user.
 * A general session is one explicitly created with type === "general".
 * Old sessions without a type field are project sessions and are excluded.
 */
export const getGeneralSession = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("pmAgentSessions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .collect();
    // Only match sessions explicitly tagged as "general"
    return sessions.find((s) => s.type === "general") || null;
  },
});

/**
 * Get the project-specific session for a project.
 */
export const getSessionByProject = query({
  args: { userId: v.string(), projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("pmAgentSessions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .collect();
    return sessions[0] || null;
  },
});

/**
 * Get all project-type sessions for a user.
 */
export const getProjectSessions = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("pmAgentSessions")
      .withIndex("by_user_type", (q) => q.eq("userId", args.userId).eq("type", "project"))
      .order("desc")
      .collect();
  },
});

// ─── Mutations ─────────────────────────────────────────────

/**
 * Create a general session (not tied to any project).
 */
export const createGeneralSession = mutation({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const sessionId = await ctx.db.insert("pmAgentSessions", {
      userId: args.userId,
      ticketId: "",
      projectName: "General",
      salesInfo: "{}",
      status: "active",
      currentStep: "general",
      workflowData: JSON.stringify({
        notes: "",
      }),
      isdTicketData: undefined,
      isdConfig: undefined,
      presaleInfo: undefined,
      type: "general",
      projectId: undefined,
      createdAt: now,
      updatedAt: now,
    });

    // Add welcome message
    await ctx.db.insert("pmAgentMessages", {
      sessionId,
      role: "agent",
      content: `Chào bạn! Tôi là PM Agents. Tôi có thể giúp gì cho bạn?\n\n- **Tạo dự án mới**\n- **Tìm & đến dự án** (paste link hoặc nhập tên/ticket)\n- **Xem thông tin ticket**`,
      metadata: JSON.stringify({ action: "general_session_created", step: "general" }),
      createdAt: now + 1,
    });

    return sessionId;
  },
});

/**
 * Create a project-specific session.
 */
export const createProjectSession = mutation({
  args: {
    userId: v.string(),
    projectId: v.id("projects"),
    projectName: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const sessionId = await ctx.db.insert("pmAgentSessions", {
      userId: args.userId,
      ticketId: "",
      projectName: args.projectName,
      salesInfo: "{}",
      status: "active",
      currentStep: "init",
      workflowData: JSON.stringify({
        personnel: [],
        meeting: null,
        sow: { status: "pending", draftUrl: "", reviewNotes: "" },
        notes: "",
        linkedProjectId: args.projectId,
      }),
      isdTicketData: undefined,
      isdConfig: undefined,
      presaleInfo: undefined,
      type: "project",
      projectId: args.projectId,
      createdAt: now,
      updatedAt: now,
    });

    // Add welcome message
    await ctx.db.insert("pmAgentMessages", {
      sessionId,
      role: "agent",
      content: `Đã kết nối với dự án **${args.projectName}**.\n\nTôi có thể giúp gì cho dự án này?\n\n- **Xem chi tiết dự án**\n- **Thêm nhân sự**\n- **Tạo meeting kickoff**\n- **Cập nhật SOW**`,
      metadata: JSON.stringify({ action: "project_session_created", step: "init" }),
      createdAt: now + 1,
    });

    return sessionId;
  },
});

export const createSession = mutation({
  args: {
    userId: v.string(),
    ticketId: v.string(),
    projectName: v.string(),
    salesInfo: v.string(), // JSON
    isdConfig: v.optional(v.string()), // JSON
    presaleInfo: v.optional(v.string()), // JSON
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const sessionId = await ctx.db.insert("pmAgentSessions", {
      userId: args.userId,
      ticketId: args.ticketId,
      projectName: args.projectName,
      salesInfo: args.salesInfo,
      status: "active",
      currentStep: "init",
      workflowData: JSON.stringify({
        personnel: [],
        meeting: null,
        sow: { status: "pending", draftUrl: "", reviewNotes: "" },
        notes: "",
      }),
      isdTicketData: undefined,
      isdConfig: args.isdConfig,
      presaleInfo: args.presaleInfo,
      createdAt: now,
      updatedAt: now,
    });

    // Add welcome message
    await ctx.db.insert("pmAgentMessages", {
      sessionId,
      role: "agent",
      content: `Da tiep nhan ticket #${args.ticketId} cho du an "${args.projectName}". Toi dang dong bo thong tin tu ISD...`,
      metadata: JSON.stringify({ action: "session_created", step: "init" }),
      createdAt: now + 1,
    });

    return sessionId;
  },
});

export const updateSession = mutation({
  args: {
    id: v.id("pmAgentSessions"),
    projectName: v.optional(v.string()),
    status: v.optional(v.string()),
    currentStep: v.optional(v.string()),
    workflowData: v.optional(v.string()),
    isdTicketData: v.optional(v.string()),
    presaleInfo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (updates.projectName !== undefined) patch.projectName = updates.projectName;
    if (updates.status !== undefined) patch.status = updates.status;
    if (updates.currentStep !== undefined) patch.currentStep = updates.currentStep;
    if (updates.workflowData !== undefined) patch.workflowData = updates.workflowData;
    if (updates.isdTicketData !== undefined) patch.isdTicketData = updates.isdTicketData;
    if (updates.presaleInfo !== undefined) patch.presaleInfo = updates.presaleInfo;
    return await ctx.db.patch(id, patch);
  },
});

export const addMessage = mutation({
  args: {
    sessionId: v.id("pmAgentSessions"),
    role: v.string(),
    content: v.string(),
    metadata: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("pmAgentMessages", {
      sessionId: args.sessionId,
      role: args.role,
      content: args.content,
      metadata: args.metadata,
      createdAt: Date.now(),
    });
  },
});

export const advanceStep = mutation({
  args: {
    id: v.id("pmAgentSessions"),
    step: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.id, { currentStep: args.step, updatedAt: now });
    await ctx.db.insert("pmAgentMessages", {
      sessionId: args.id,
      role: "system",
      content: `Chuyen sang buoc: ${args.step}`,
      metadata: JSON.stringify({ action: "step_change", step: args.step }),
      createdAt: now + 1,
    });
  },
});

export const deleteSession = mutation({
  args: { id: v.id("pmAgentSessions") },
  handler: async (ctx, args) => {
    // Delete all messages first
    const messages = await ctx.db
      .query("pmAgentMessages")
      .withIndex("by_session", (q) => q.eq("sessionId", args.id))
      .collect();

    for (const msg of messages) {
      await ctx.db.delete(msg._id);
    }

    await ctx.db.delete(args.id);
  },
});

/**
 * Create a custom KFlow project + PM Agent session (no ISD ticket).
 */
export const createCustomProject = mutation({
  args: {
    userId: v.string(),
    projectName: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // 1. Create project in KFlow projects table
    const projectId = await ctx.db.insert("projects", {
      userId: args.userId,
      name: args.projectName,
      color: undefined,
      notes: "",
      archived: false,
    });

    // 2. Create PM Agent session
    const sessionId = await ctx.db.insert("pmAgentSessions", {
      userId: args.userId,
      ticketId: "",
      projectName: args.projectName,
      salesInfo: "{}",
      status: "active",
      currentStep: "init",
      workflowData: JSON.stringify({
        personnel: [],
        meeting: null,
        sow: { status: "pending", draftUrl: "", reviewNotes: "" },
        notes: "",
        linkedProjectId: projectId,
      }),
      isdConfig: undefined,
      isdTicketData: undefined,
      presaleInfo: undefined,
      type: "project",
      projectId,
      createdAt: now,
      updatedAt: now,
    });

    // 3. Add welcome message
    await ctx.db.insert("pmAgentMessages", {
      sessionId,
      role: "agent",
      content: `Da tao du an tu chinh: **${args.projectName}**\n\nDu an da san sang. Toi co the giup ban tiep theo:\n\n1. Xem chi tiet du an trong KFlow\n2. Tiep tuc quy trinh Kickoff (them nhan su, tao meeting)\n3. Cap nhat SOW\n\nBan muon lam gi tiep theo?`,
      metadata: JSON.stringify({ action: "project_created", step: "init" }),
      createdAt: now + 1,
    });

    return {
      sessionId,
      projectId,
      projectName: args.projectName,
      success: true,
    };
  },
});

/**
 * Create a KFlow project + PM Agent session from ISD ticket data.
 * ISD data is pre-fetched client-side via the /api/agents/fetch-isd proxy route
 * so it works even when Convex cloud can't reach the ISD server directly.
 */
export const createProjectFromTicket = mutation({
  args: {
    userId: v.string(),
    ticketId: v.string(),
    // Pre-fetched ISD data (optional — if missing, CFP will try to fetch from Convex)
    isdEndpoint: v.optional(v.string()),
    isdToken: v.optional(v.string()),
    isdData: v.optional(v.string()), // JSON string: pre-fetched ticket data
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Check duplicate: da co session active cho ticket nay chua?
    // Nếu dự án liên kết đã bị xoá (trong thùng rác) thì KHÔNG tính là duplicate
    const existing = await ctx.db
      .query("pmAgentSessions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    let dup: (typeof existing)[0] | undefined;
    for (const s of existing) {
      if (s.ticketId !== args.ticketId || s.status !== "active") continue;
      
      // Check if linked project is still valid (not deleted, not missing)
      let isValid = false;
      if (s.workflowData) {
        try {
          const wfData = JSON.parse(s.workflowData);
          if (wfData.linkedProjectId) {
            const proj = await ctx.db.get(wfData.linkedProjectId as Id<"projects">);
            // Only treat as duplicate if project exists AND is NOT deleted
            if (proj && !proj.deletedAt) isValid = true;
          } else {
            // No linkedProjectId — safe assumption: treat as NOT duplicate
            // because we can't verify the project still exists
            isValid = false;
          }
        } catch {
          // Malformed workflowData — treat as NOT duplicate
          isValid = false;
        }
      } else {
        // No workflowData at all — treat as NOT duplicate
        isValid = false;
      }

      if (isValid) {
        dup = s;
        break;
      }
    }

    if (dup) {
      // Restore project if it was soft-deleted (shouldn't happen here, but safe)
      let projectId: Id<"projects"> | null = null;
      if (dup.workflowData) {
        try {
          const wfData = JSON.parse(dup.workflowData);
          if (wfData.linkedProjectId) {
            const proj = await ctx.db.get(wfData.linkedProjectId as Id<"projects">);
            if (proj?.deletedAt) {
              await ctx.db.patch(wfData.linkedProjectId as Id<"projects">, { deletedAt: undefined });
            }
            projectId = wfData.linkedProjectId as Id<"projects">;
          }
        } catch {}
      }
      return {
        sessionId: dup._id,
        projectId,
        projectName: dup.projectName,
        ticketKey: args.ticketId,
        ticketSummary: "",
        ticketStatus: "",
        success: true,
        duplicate: true,
      };
    }

    // ─── Extract ISD data ─────────────────────────────
    let ticketSummary = "";
    let ticketStatus = "";
    let ticketPriority = "";
    let ticketAssignee = "";
    let ticketReporter = "";
    let ticketDescription = "";
    let ticketCreated = "";
    let ticketUpdated = "";
    let ticketIssueType = "";
    let ticketComponents: string[] = [];
    let ticketLabels: string[] = [];
    let ticketProjectKey = "";
    let ticketReporterEmail = "";
    let ticketAssigneeEmail = "";
    let ticketCreator = "";
    let ticketCreatorEmail = "";
    let resourceTicketIds: string[] = [];
    let internalGroupUrl: string | null = null;
    let customerGroupUrl: string | null = null;
    let consultingTicketId = "";
    let owner = "";
    let ownerEmail = "";
    let ownerContact = "";
    let deploymentTicketId = "";

    // Try pre-fetched data first
    if (args.isdData) {
      try {
        const d = JSON.parse(args.isdData);
        ticketSummary = d.summary || "";
        ticketStatus = d.status || "Unknown";
        ticketPriority = d.priority || "Normal";
        ticketAssignee = d.assignee || "";
        ticketAssigneeEmail = d.assigneeEmail || "";
        ticketReporter = d.reporter || "";
        ticketReporterEmail = d.reporterEmail || "";
        ticketCreator = d.creator || d.reporter || "";
        ticketCreatorEmail = d.creatorEmail || d.reporterEmail || "";
        ticketDescription = (d.description || "").slice(0, 2000);
        ticketCreated = d.createdDate || "";
        ticketUpdated = d.updatedDate || "";
        ticketIssueType = d.issueType || "";
        ticketComponents = d.components || [];
        ticketLabels = d.labels || [];
        ticketProjectKey = d.projectKey || "";
        resourceTicketIds = d.resourceTicketIds || [];
        internalGroupUrl = d.internalGroupUrl || null;
        customerGroupUrl = d.customerGroupUrl || null;
        consultingTicketId = d.consultingTicketId || "";
        deploymentTicketId = d.deploymentTicketId || args.ticketId;
        owner = d.owner || d.assignee || "";
        ownerEmail = d.ownerEmail || d.assigneeEmail || "";
        ownerContact = d.ownerContact || "";
        if (!ownerContact && owner) {
          ownerContact = ownerEmail ? `${owner} (${ownerEmail})` : owner;
        }
      } catch {}
    }

    // Fallback: try fetching from Convex directly (may fail if Convex can't reach the network)
    if (!ticketSummary && args.isdEndpoint && args.isdToken) {
      try {
        const base = args.isdEndpoint.replace(/\/$/, "");
        const url = `${base}/api/2/issue/${args.ticketId}?fields=summary,status,priority,assignee,reporter,description,created,updated,issuetype,components,labels,project,customfield_14011,customfield_14012`;
        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${args.isdToken}`,
            Accept: "application/json",
          },
        });

        if (res.ok) {
          const data = await res.json();
          const f = data.fields || {};
          ticketSummary = f.summary || "";
          ticketStatus = f.status?.name || "Unknown";
          ticketPriority = f.priority?.name || "Normal";
          ticketAssignee = f.assignee?.displayName || "";
          ticketAssigneeEmail = f.assignee?.emailAddress || "";
          ticketReporter = f.reporter?.displayName || "";
          ticketReporterEmail = f.reporter?.emailAddress || "";
          const descRaw = f.description || "";
          ticketDescription = typeof descRaw === "string"
            ? descRaw
                .replace(/<\/?[^>]+(>|$)/g, "")   // strip HTML tags
                .replace(/\n{2,}/g, "</p><p>")    // double newline → paragraph
                .replace(/\n/g, "<br>")            // single newline → line break
                .trim().slice(0, 2000)
            : JSON.stringify(descRaw).slice(0, 2000);
          if (ticketDescription && !ticketDescription.startsWith("<")) {
            ticketDescription = `<p>${ticketDescription}</p>`;
          }
          ticketCreated = f.created || "";
          ticketUpdated = f.updated || "";
          ticketIssueType = f.issuetype?.name || "";
          ticketComponents = (f.components || []).map((c: { name: string }) => c.name);
          ticketLabels = f.labels || [];
          ticketProjectKey = f.project?.key || "";
          consultingTicketId = typeof f.customfield_14011 === "string" ? f.customfield_14011.trim() : "";
          resourceTicketIds = typeof f.customfield_14012 === "string"
            ? f.customfield_14012.split(/[\s,]+/).filter(Boolean)
            : [];
          deploymentTicketId = args.ticketId;
          owner = ticketAssignee;
          ownerEmail = ticketAssigneeEmail;
          ownerContact = ownerEmail ? `${owner} (${ownerEmail})` : owner;
        } else {
          const text = await res.text();
          console.error(`[ISD] Convex fetch failed (${res.status}): ${text.slice(0, 200)}`);
        }
      } catch (err) {
        console.error("[ISD] Convex network error:", err);
      }
    }

    // 2. Determine project name (use ticket summary)
    const projectName = ticketSummary || `Ticket #${args.ticketId}`;

    // Extract a color based on priority
    const priorityColors: Record<string, string> = {
      "P1": "#ef4444",
      "P2": "#f97316",
      "P3": "#eab308",
      "P4": "#22c55e",
      "P5": "#6b7280",
    };
    const projectColor = priorityColors[ticketPriority] || undefined;

    // 3. Build comprehensive notes HTML
    let resourceTicketsLinks = "";
    if (resourceTicketIds && resourceTicketIds.length > 0) {
      resourceTicketsLinks = `\n<h2>Tài nguyên triển khai ISD</h2>\n<ul>\n` + resourceTicketIds.map((id: string) => {
        const match = id.match(/ISD-\d+/i);
        let url, display;
        if (match) {
          const extractedId = match[0].toUpperCase();
          url = `https://servicedesk.fci.vn/browse/${extractedId}`;
          display = extractedId;
        } else {
          url = id.startsWith('http') ? id : `https://servicedesk.fci.vn/browse/${id}`;
          display = id;
        }
        return `  <li><a href="${url}">${display}</a></li>`;
      }).join('\n') + `\n</ul>`;
    }

    const defaultNotesHTML = `<h2>Thông tin chung</h2>
<p><strong>Mô tả:</strong> ${ticketDescription || "Không có"}</p>
<p><strong>Người tạo:</strong> ${ticketCreator} ${ticketCreatorEmail ? `(${ticketCreatorEmail})` : ''}</p>
<p><strong>Người phụ trách:</strong> ${ticketAssignee} ${ticketAssigneeEmail ? `(${ticketAssigneeEmail})` : ''}</p>
<p><strong>Trạng thái:</strong> ${ticketStatus}</p>
<p><strong>Độ ưu tiên:</strong> ${ticketPriority}</p>

<h2>Link liên quan</h2>
<ul>
  <li><a href="${(args.isdEndpoint || "https://servicedesk.fci.vn/rest").replace(/\/rest.*$/, "")}/browse/${args.ticketId}">Ticket gốc (${args.ticketId})</a></li>
</ul>
${resourceTicketsLinks}

<h2>Ghi chú</h2>
<p>Các ghi chú, lưu ý, thông tin bổ sung...</p>
`;

    // 4. Create project in KFlow projects table
    const projectId = await ctx.db.insert("projects", {
      userId: args.userId,
      name: projectName,
      color: projectColor,
      notes: defaultNotesHTML,
      archived: false,
      ticketId: args.ticketId,
      isdStatus: ticketStatus || undefined,
      isdUpdatedAt: Date.now(),
      internalGroupUrl: internalGroupUrl || undefined,
      customerGroupUrl: customerGroupUrl || undefined,
    });

    // 5. Build richer ticket data for session
    const isdTicketData = JSON.stringify({
      id: args.ticketId,
      key: args.ticketId,
      summary: ticketSummary,
      status: ticketStatus,
      priority: ticketPriority,
      description: ticketDescription,
      requester: ticketReporter,
      requesterEmail: ticketReporterEmail,
      assignee: ticketAssignee,
      assigneeEmail: ticketAssigneeEmail,
      components: ticketComponents,
      labels: ticketLabels,
      issueType: ticketIssueType,
      projectKey: ticketProjectKey,
      createdDate: ticketCreated,
      updatedDate: ticketUpdated,
      // Populated from isdData when passed from fetch-isd proxy
      consultingTicketId,
      resourceTicketIds,
      deploymentTicketId: deploymentTicketId || args.ticketId,
      owner,
      ownerEmail,
      ownerContact,
      internalGroupUrl,
      customerGroupUrl,
    });

    const salesInfo = JSON.stringify({
      name: ticketReporter || "Unknown",
      email: ticketReporterEmail || "",
      role: "Reporter / Sale",
    });

    // 5. Create PM Agent session
    const sessionId = await ctx.db.insert("pmAgentSessions", {
      userId: args.userId,
      ticketId: args.ticketId,
      projectName,
      salesInfo,
      status: "active",
      currentStep: "init",
      workflowData: JSON.stringify({
        personnel: [],
        meeting: null,
        sow: { status: "pending", draftUrl: "", reviewNotes: "" },
        notes: "",
        linkedProjectId: projectId,
      }),
      isdConfig: args.isdEndpoint && args.isdToken
        ? JSON.stringify({ endpoint: args.isdEndpoint, token: args.isdToken })
        : undefined,
      isdTicketData,
      presaleInfo: undefined,
      type: "project",
      projectId,
      createdAt: now,
      updatedAt: now,
    });

    // ─── Auto-detect members from ISD ticket ────────────────
    // Seed default roles if needed
    const existingRoles = await ctx.db
      .query("projectRoles")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    const getRoleId = (roleName: string) => existingRoles.find((r) => r.name === roleName)?._id;

    // Add Requester (reporter) as Sale
    if (ticketReporter) {
      await ctx.db.insert("projectMembers", {
        projectId,
        userId: args.userId,
        name: ticketReporter,
        email: ticketReporterEmail || undefined,
        roleId: getRoleId("Sale"),
        roleName: "Sale",
        source: "isd",
        createdAt: Date.now(),
      });
    }

    // Add Owner/Assignee as Project Manager
    if (owner) {
      await ctx.db.insert("projectMembers", {
        projectId,
        userId: args.userId,
        name: owner,
        email: ownerEmail || undefined,
        roleId: getRoleId("Project Manager"),
        roleName: "Project Manager",
        source: "isd",
        createdAt: Date.now(),
      });
    }

    // ─── Save ISD data into projectIsdData table ────────────
    await ctx.db.insert("projectIsdData", {
      projectId,
      userId: args.userId,
      ticketId: args.ticketId,
      summary: ticketSummary,
      status: ticketStatus || undefined,
      priority: ticketPriority || undefined,
      description: ticketDescription || undefined,
      assignee: ticketAssignee || undefined,
      assigneeEmail: ticketAssigneeEmail || undefined,
      reporter: ticketReporter || undefined,
      reporterEmail: ticketReporterEmail || undefined,
      creator: ticketCreator || undefined,
      creatorEmail: ticketCreatorEmail || undefined,
      owner: owner || undefined,
      ownerEmail: ownerEmail || undefined,
      ownerContact: ownerContact || undefined,
      issueType: ticketIssueType || undefined,
      projectKey: ticketProjectKey || undefined,
      components: ticketComponents.length > 0 ? ticketComponents : undefined,
      labels: ticketLabels.length > 0 ? ticketLabels : undefined,
      createdDate: ticketCreated || undefined,
      updatedDate: ticketUpdated || undefined,
      consultingTicketId: consultingTicketId || undefined,
      deploymentTicketId: deploymentTicketId || undefined,
      resourceTicketIds: resourceTicketIds.length > 0 ? resourceTicketIds : undefined,
      internalGroupUrl: internalGroupUrl || undefined,
      customerGroupUrl: customerGroupUrl || undefined,
      fetchedAt: Date.now(),
    });

    // 6. Add agent messages
    const success = !!ticketSummary;

    await ctx.db.insert("pmAgentMessages", {
      sessionId,
      role: "agent",
      content: success
        ? `Da lay thong tin ticket **#${args.ticketId}** tu ISD.\n\n**${ticketSummary}**\nTrang thai: ${ticketStatus} | Priority: ${ticketPriority}\nAssignee: ${ticketAssignee} | Reporter: ${ticketReporter}\n\nDa tao du an moi trong KFlow: **${projectName}**`
        : `Da tao du an tu ticket **#${args.ticketId}** nhung khong dong bo duoc thong tin tu ISD (API khong the truy cap). Ban co the kiem tra lai ISD token.`,
      metadata: JSON.stringify({ action: "project_created", step: "init" }),
      createdAt: now + 1,
    });

    await ctx.db.insert("pmAgentMessages", {
      sessionId,
      role: "agent",
      content: `Du an da san sang. Toi co the giup ban tiep theo:\n\n1. Xem chi tiet du an trong KFlow\n2. Tiep tuc quy trinh Kickoff (them nhan su, tao meeting)\n3. Cap nhat SOW\n\nBan muon lam gi tiep theo?`,
      metadata: JSON.stringify({ action: "ready_for_next", step: "init" }),
      createdAt: now + 2,
    });

    return {
      sessionId,
      projectId,
      projectName,
      ticketKey: args.ticketId,
      ticketSummary,
      ticketStatus,
      success,
      duplicate: false,
    };
  },
});
