import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { pmAgentSessions, pmAgentMessages, projects, projectMembers, projectRoles, projectIsdData } from "../db";

function mapSession(s: any): any {
  return {
    ...s,
    _id: String(s.id),
    _creationTime: s.createdAt ?? 0,
    projectId: s.projectId !== null ? String(s.projectId) : undefined,
  };
}

function mapMessage(m: any): any {
  return {
    ...m,
    _id: String(m.id),
    _creationTime: m.createdAt ?? 0,
    sessionId: String(m.sessionId),
  };
}

async function insertGeneral(values: any) {
  const db = getDb();
  const res = await db.insert(pmAgentSessions).values(values).returning();
  return res[0].id;
}

// ─── Queries ───────────────────────────────────────────────
export async function getSessions(userId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(pmAgentSessions)
    .where(eq(pmAgentSessions.userId, userId))
    .orderBy(desc(pmAgentSessions.updatedAt));
  return rows.map(mapSession);
}

export async function getSession(id: number | string) {
  const db = getDb();
  const row = await db.query.pmAgentSessions.findFirst({
    where: eq(pmAgentSessions.id, Number(id)),
  });
  return row ? mapSession(row) : null;
}

export async function getSessionByTicket(userId: string, ticketId: string) {
  const sessions = await getSessions(userId);
  return sessions.find((s) => s.ticketId === ticketId && s.status === "active") || null;
}

export async function getMessages(sessionId: number | string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(pmAgentMessages)
    .where(eq(pmAgentMessages.sessionId, Number(sessionId)))
    .orderBy(asc(pmAgentMessages.createdAt));
  return rows.map(mapMessage);
}

export async function getGeneralSession(userId: string) {
  const sessions = await getSessions(userId);
  return sessions.find((s) => s.type === "general") || null;
}

export async function getSessionByProject(userId: string, projectId: number | string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(pmAgentSessions)
    .where(eq(pmAgentSessions.projectId, Number(projectId)))
    .orderBy(desc(pmAgentSessions.updatedAt))
    .limit(1);
  return rows.length > 0 ? mapSession(rows[0]) : null;
}

export async function getProjectSessions(userId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(pmAgentSessions)
    .where(and(eq(pmAgentSessions.userId, userId), eq(pmAgentSessions.type, "project")))
    .orderBy(desc(pmAgentSessions.updatedAt));
  return rows.map(mapSession);
}

// ─── Mutations ─────────────────────────────────────────────
async function insertMessage(sessionId: number, role: string, content: string, metadata?: string, createdAt?: number) {
  const db = getDb();
  await db.insert(pmAgentMessages).values({
    sessionId,
    role,
    content,
    metadata: metadata ?? null,
    createdAt: createdAt ?? Date.now(),
  });
}

export async function createGeneralSession(userId: string) {
  const now = Date.now();
  const sessionId = await insertGeneral({
    userId,
    ticketId: "",
    projectName: "General",
    salesInfo: "{}",
    status: "active",
    currentStep: "general",
    workflowData: JSON.stringify({ notes: "" }),
    isdTicketData: null,
    isdConfig: null,
    presaleInfo: null,
    type: "general",
    projectId: null,
    createdAt: now,
    updatedAt: now,
  });
  await insertMessage(
    sessionId,
    "agent",
    `Chào bạn! Tôi là PM Agents. Tôi có thể giúp gì cho bạn?\n\n- **Tạo dự án mới**\n- **Tìm & đến dự án** (paste link hoặc nhập tên/ticket)\n- **Xem thông tin ticket**`,
    JSON.stringify({ action: "general_session_created", step: "general" }),
    now + 1
  );
  return sessionId;
}

export async function createProjectSession(userId: string, projectId: number | string, projectName: string) {
  const now = Date.now();
  const sessionId = await insertGeneral({
    userId,
    ticketId: "",
    projectName,
    salesInfo: "{}",
    status: "active",
    currentStep: "init",
    workflowData: JSON.stringify({
      personnel: [],
      meeting: null,
      sow: { status: "pending", draftUrl: "", reviewNotes: "" },
      notes: "",
      linkedProjectId: Number(projectId),
    }),
    isdTicketData: null,
    isdConfig: null,
    presaleInfo: null,
    type: "project",
    projectId: Number(projectId),
    createdAt: now,
    updatedAt: now,
  });
  await insertMessage(
    sessionId,
    "agent",
    `Đã kết nối với dự án **${projectName}**.\n\nTôi có thể giúp gì cho dự án này?\n\n- **Xem chi tiết dự án**\n- **Thêm nhân sự**\n- **Tạo meeting kickoff**\n- **Cập nhật SOW**`,
    JSON.stringify({ action: "project_session_created", step: "init" }),
    now + 1
  );
  return sessionId;
}

export async function createSession(args: {
  userId: string;
  ticketId: string;
  projectName: string;
  salesInfo: string;
  isdConfig?: string;
  presaleInfo?: string;
}) {
  const now = Date.now();
  const sessionId = await insertGeneral({
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
    isdTicketData: null,
    isdConfig: args.isdConfig ?? null,
    presaleInfo: args.presaleInfo ?? null,
    createdAt: now,
    updatedAt: now,
  });
  await insertMessage(
    sessionId,
    "agent",
    `Đã tiếp nhận ticket #${args.ticketId} cho dự án "${args.projectName}". Tôi đang đồng bộ thông tin từ ISD...`,
    JSON.stringify({ action: "session_created", step: "init" }),
    now + 1
  );
  return sessionId;
}

export async function updateSession(id: number | string, updates: {
  projectName?: string;
  status?: string;
  currentStep?: string;
  workflowData?: string;
  isdTicketData?: string;
  presaleInfo?: string;
}) {
  const db = getDb();
  const pid = Number(id);
  const patch: any = { updatedAt: Date.now() };
  if (updates.projectName !== undefined) patch.projectName = updates.projectName;
  if (updates.status !== undefined) patch.status = updates.status;
  if (updates.currentStep !== undefined) patch.currentStep = updates.currentStep;
  if (updates.workflowData !== undefined) patch.workflowData = updates.workflowData;
  if (updates.isdTicketData !== undefined) patch.isdTicketData = updates.isdTicketData;
  if (updates.presaleInfo !== undefined) patch.presaleInfo = updates.presaleInfo;
  await db.update(pmAgentSessions).set(patch).where(eq(pmAgentSessions.id, pid));
}

export async function addMessage(args: {
  sessionId: number | string;
  role: string;
  content: string;
  metadata?: string;
}) {
  const db = getDb();
  const res = await db
    .insert(pmAgentMessages)
    .values({
      sessionId: Number(args.sessionId),
      role: args.role,
      content: args.content,
      metadata: args.metadata ?? null,
      createdAt: Date.now(),
    })
    .returning();
  return mapMessage(res[0]);
}

export async function advanceStep(id: number | string, step: string) {
  const now = Date.now();
  const db = getDb();
  await db
    .update(pmAgentSessions)
    .set({ currentStep: step, updatedAt: now })
    .where(eq(pmAgentSessions.id, Number(id)));
  await insertMessage(
    Number(id),
    "system",
    `Chuyen sang buoc: ${step}`,
    JSON.stringify({ action: "step_change", step }),
    now + 1
  );
}

export async function deleteSession(id: number | string) {
  const db = getDb();
  const sid = Number(id);
  await db.delete(pmAgentMessages).where(eq(pmAgentMessages.sessionId, sid));
  await db.delete(pmAgentSessions).where(eq(pmAgentSessions.id, sid));
}

export async function createCustomProject(userId: string, projectName: string) {
  const now = Date.now();
  const db = getDb();

  // 1. Create project
  const project = await db
    .insert(projects)
    .values({ userId, name: projectName, notes: "", archived: false })
    .returning();
  const projectId = project[0].id;

  // 2. Create session
  const sessionId = await insertGeneral({
    userId,
    ticketId: "",
    projectName,
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
    isdConfig: null,
    isdTicketData: null,
    presaleInfo: null,
    type: "project",
    projectId,
    createdAt: now,
    updatedAt: now,
  });

  // 3. Welcome message
  await insertMessage(
    sessionId,
    "agent",
    `Đã tạo dự án từ chính: **${projectName}**\n\nDự án đã sẵn sàng. Tôi có thể giúp bạn tiếp theo:\n\n1. Xem chi tiết dự án trong KFlow\n2. Tiếp tục quy trình Kickoff (thêm nhân sự, tạo meeting)\n3. Cập nhật SOW\n\nBạn muốn làm gì tiếp theo?`,
    JSON.stringify({ action: "project_created", step: "init" }),
    now + 1
  );

  return { sessionId, projectId, projectName, success: true };
}

export async function createProjectFromTicket(args: {
  userId: string;
  ticketId: string;
  isdEndpoint?: string;
  isdToken?: string;
  isdData?: string;
}) {
  const db = getDb();
  const now = Date.now();

  // Duplicate check
  const sessions = await getSessions(args.userId);
  let dup: any = undefined;
  for (const s of sessions) {
    if (s.ticketId !== args.ticketId || s.status !== "active") continue;
    let isValid = false;
    if (s.workflowData) {
      try {
        const wf = JSON.parse(s.workflowData);
        if (wf.linkedProjectId) {
          const proj = await db.query.projects.findFirst({
            where: eq(projects.id, Number(wf.linkedProjectId)),
          });
          if (proj && !proj.deletedAt) isValid = true;
        }
      } catch {}
    }
    if (isValid) {
      dup = s;
      break;
    }
  }

  if (dup) {
    let projectId: number | null = null;
    if (dup.workflowData) {
      try {
        const wf = JSON.parse(dup.workflowData);
        if (wf.linkedProjectId) {
          const proj = await db.query.projects.findFirst({
            where: eq(projects.id, Number(wf.linkedProjectId)),
          });
          if (proj?.deletedAt) {
            await db.update(projects).set({ deletedAt: null }).where(eq(projects.id, proj.id));
          }
          projectId = proj?.id ?? null;
        }
      } catch {}
    }
    return {
      sessionId: dup.id,
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
  let ticketSummary = "", ticketStatus = "", ticketPriority = "";
  let ticketAssignee = "", ticketReporter = "", ticketDescription = "";
  let ticketCreated = "", ticketUpdated = "", ticketIssueType = "";
  let ticketComponents: string[] = [], ticketLabels: string[] = [], ticketProjectKey = "";
  let ticketReporterEmail = "", ticketAssigneeEmail = "", ticketCreator = "", ticketCreatorEmail = "";
  let resourceTicketIds: string[] = [];
  let internalGroupUrl: string | null = null, customerGroupUrl: string | null = null;
  let consultingTicketId = "", deploymentTicketId = "", owner = "", ownerEmail = "", ownerContact = "";

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

  // Fallback upstream fetch
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
              .replace(/<\/?[^>]+(>|$)/g, "")
              .replace(/\n{2,}/g, "</p><p>")
              .replace(/\n/g, "<br>")
              .trim()
              .slice(0, 2000)
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
      }
    } catch {}
  }

  const projectName = ticketSummary || `Ticket #${args.ticketId}`;
  const priorityColors: Record<string, string> = {
    P1: "#ef4444", P2: "#f97316", P3: "#eab308", P4: "#22c55e", P5: "#6b7280",
  };
  const projectColor = priorityColors[ticketPriority] || undefined;

  // Notes HTML
  let resourceTicketsLinks = "";
  if (resourceTicketIds && resourceTicketIds.length > 0) {
    resourceTicketsLinks = `\n<h2>Tài nguyên triển khai ISD</h2>\n<ul>\n` +
      resourceTicketIds
        .map((id: string) => {
          const match = id.match(/ISD-\d+/i);
          if (match) {
            const extractedId = match[0].toUpperCase();
            return `  <li><a href="https://servicedesk.fci.vn/browse/${extractedId}">${extractedId}</a></li>`;
          }
          const url = id.startsWith("http") ? id : `https://servicedesk.fci.vn/browse/${id}`;
          return `  <li><a href="${url}">${id}</a></li>`;
        })
        .join("\n") +
      `\n</ul>`;
  }

  const defaultNotesHTML = `<h2>Thông tin chung</h2>
<p><strong>Mô tả:</strong> ${ticketDescription || "Không có"}</p>
<p><strong>Người tạo:</strong> ${ticketCreator} ${ticketCreatorEmail ? `(${ticketCreatorEmail})` : ""}</p>
<p><strong>Người phụ trách:</strong> ${ticketAssignee} ${ticketAssigneeEmail ? `(${ticketAssigneeEmail})` : ""}</p>
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

  // Create project
  const project = await db
    .insert(projects)
    .values({
      userId: args.userId,
      name: projectName,
      color: projectColor ?? null,
      notes: defaultNotesHTML,
      archived: false,
      ticketId: args.ticketId,
      isdStatus: ticketStatus || null,
      isdUpdatedAt: Date.now(),
      // KHÔNG ghi internalGroupUrl/customerGroupUrl vào project — 2 field deprecated này
      // chứa tên nhóm thường (không phải deep link) từ ticket ISD, gây sync nhóm ma.
      // Dữ liệu ISD vẫn lưu đầy đủ trong `projectIsdData` (xem bên dưới) để hiển thị.
      internalGroupUrl: null,
      customerGroupUrl: null,
    })
    .returning();
  const projectId = project[0].id;

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

  const sessionId = await insertGeneral({
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
      : null,
    isdTicketData,
    presaleInfo: null,
    type: "project",
    projectId,
    createdAt: now,
    updatedAt: now,
  });

  // Auto-detect members
  const existingRoles = await db
    .select()
    .from(projectRoles)
    .where(eq(projectRoles.userId, args.userId));
  const getRoleId = (roleName: string) => existingRoles.find((r) => r.name === roleName)?.id ?? null;

  if (ticketReporter) {
    await db.insert(projectMembers).values({
      projectId,
      userId: args.userId,
      name: ticketReporter,
      email: ticketReporterEmail || null,
      roleId: getRoleId("Sale"),
      roleName: "Sale",
      source: "isd",
      createdAt: Date.now(),
    });
  }
  if (owner) {
    await db.insert(projectMembers).values({
      projectId,
      userId: args.userId,
      name: owner,
      email: ownerEmail || null,
      roleId: getRoleId("Project Manager"),
      roleName: "Project Manager",
      source: "isd",
      createdAt: Date.now(),
    });
  }

  // Save ISD data
  await db.insert(projectIsdData).values({
    projectId,
    userId: args.userId,
    ticketId: args.ticketId,
    summary: ticketSummary,
    status: ticketStatus || null,
    priority: ticketPriority || null,
    description: ticketDescription || null,
    assignee: ticketAssignee || null,
    assigneeEmail: ticketAssigneeEmail || null,
    reporter: ticketReporter || null,
    reporterEmail: ticketReporterEmail || null,
    creator: ticketCreator || null,
    creatorEmail: ticketCreatorEmail || null,
    owner: owner || null,
    ownerEmail: ownerEmail || null,
    ownerContact: ownerContact || null,
    issueType: ticketIssueType || null,
    projectKey: ticketProjectKey || null,
    components: ticketComponents.length > 0 ? ticketComponents : null,
    labels: ticketLabels.length > 0 ? ticketLabels : null,
    createdDate: ticketCreated || null,
    updatedDate: ticketUpdated || null,
    consultingTicketId: consultingTicketId || null,
    deploymentTicketId: deploymentTicketId || null,
    resourceTicketIds: resourceTicketIds.length > 0 ? resourceTicketIds : null,
    internalGroupUrl: internalGroupUrl || null,
    customerGroupUrl: customerGroupUrl || null,
    fetchedAt: Date.now(),
  });

  const success = !!ticketSummary;
  await insertMessage(
    sessionId,
    "agent",
    success
      ? `Đã lấy thông tin ticket **#${args.ticketId}** từ ISD.\n\n**${ticketSummary}**\nTrạng thái: ${ticketStatus} | Priority: ${ticketPriority}\nAssignee: ${ticketAssignee} | Reporter: ${ticketReporter}\n\nĐã tạo dự án mới trong KFlow: **${projectName}**`
      : `Đã tạo dự án từ ticket **#${args.ticketId}** nhưng không đồng bộ được thông tin từ ISD (API không thể truy cập). Bạn có thể kiểm tra lại ISD token.`,
    JSON.stringify({ action: "project_created", step: "init" }),
    now + 1
  );
  await insertMessage(
    sessionId,
    "agent",
    `Dự án đã sẵn sàng. Tôi có thể giúp bạn tiếp theo:\n\n1. Xem chi tiết dự án trong KFlow\n2. Tiếp tục quy trình Kickoff (thêm nhân sự, tạo meeting)\n3. Cập nhật SOW\n\nBạn muốn làm gì tiếp theo?`,
    JSON.stringify({ action: "ready_for_next", step: "init" }),
    now + 2
  );

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
}