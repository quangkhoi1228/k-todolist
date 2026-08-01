import type { PMWorkflowStep, WorkflowData, PersonnelInfo, KickoffMeeting, SOWInfo, DeployTask, TeamsMessage, AgentSuggestion } from "./types";

// ─── Step Order ────────────────────────────────────────────
const STEP_ORDER: PMWorkflowStep[] = [
  "init",
  "teams_intro",
  "consulting_check",
  "kickoff",
  "sow_draft",
  "sow_review",
  "in_progress",
  "handover",
  "completed",
];

export function getNextStep(current: PMWorkflowStep): PMWorkflowStep | null {
  const idx = STEP_ORDER.indexOf(current);
  if (idx === -1 || idx >= STEP_ORDER.length - 1) return null;
  return STEP_ORDER[idx + 1];
}

export function getStepLabel(step: PMWorkflowStep): string {
  const labels: Record<PMWorkflowStep, string> = {
    init: "Tiếp nhận ticket",
    teams_intro: "Giới thiệu & Teams",
    consulting_check: "Kiểm tra tư vấn",
    kickoff: "Kickoff",
    sow_draft: "Soạn thảo SOW",
    sow_review: "KH Review SOW",
    in_progress: "Triển khai",
    handover: "Bàn giao",
    completed: "Hoàn tất",
  };
  return labels[step];
}

// ─── Default Workflow Data ─────────────────────────────────
export function createDefaultWorkflowData(): WorkflowData {
  return {
    personnel: [],
    meeting: null,
    sow: { status: "pending", draftUrl: "", reviewNotes: "" },
    tasks: [],
    notes: "",
    presaleName: "",
    presaleEmail: "",
    consultingTicketId: "",
    consultingOwner: "",
    internalGroupId: "",
    externalGroupId: "",
    teamsMessages: [],
    handoverEmailSent: false,
    linkedProjectId: undefined,
  };
}

// ─── Parse scope từ Teams message ─────────────────────────
export interface ScopeInfo {
  infra: boolean;
  security: boolean;
  network: boolean;
  other: string[];
}

export function parseScopeFromMessages(messages: TeamsMessage[]): ScopeInfo {
  const scope: ScopeInfo = { infra: false, security: false, network: false, other: [] };
  for (const msg of messages) {
    const c = msg.content.toLowerCase();
    if (c.includes("firewall") || c.includes("infra") || c.includes("hạ tầng")) scope.infra = true;
    if (c.includes("security") || c.includes("bảo mật") || c.includes("firewall")) scope.security = true;
    if (c.includes("network") || c.includes("mạng") || c.includes("peering")) scope.network = true;
  }
  return scope;
}

// ─── Generate intro message for Sale ──────────────────────
export function generateIntroToSale(ticketId: string, projectName: string, pmName?: string): string {
  return `**PM - Tiếp nhận dự án**

Chào anh/chị,

Tôi là PM vừa được assign ticket **#${ticketId}** - **${projectName}**.

Nhờ anh/chị add tôi vào:
1. **Nhóm nội bộ (Internal)** - để trao đổi với team kỹ thuật
2. **Nhóm khách hàng (External)** - để cập nhật thông tin cho KH

Trân trọng,${pmName ? `\n${pmName}` : "\nPM"} – KFlow PM Agent 🤖`;
}

// ─── Generate request to Presale ──────────────────────────
export function generatePresaleRequest(presaleName: string, ticketId: string, consultingTicketId?: string): string {
  const consultingNote = consultingTicketId
    ? `(Ticket tư vấn: **#${consultingTicketId}**)`
    : "";
  return `**PM - Yêu cầu thông tin dự án**

Chào anh/chị ${presaleName} ${consultingNote},

Tôi là PM phụ trách ticket **#${ticketId}**.

Nhờ anh/chị cung cấp giúp:
1. **Hiện trạng khách hàng**: hệ thống hiện tại, hạ tầng đang dùng
2. **Target / mục tiêu**: KH muốn đạt được gì?
3. **Yêu cầu đặc biệt**: các lưu ý về topology, security, migration...
4. **SOW draft** (nếu có)
5. **Link folder SharePoint** (nếu đã tạo)

Trân trọng,
PM – KFlow PM Agent 🤖`;
}

// ─── Generate kickoff schedule ────────────────────────────
export function generateKickoffMessage(
  date: string,
  time: string,
  participants: string[]
): string {
  const list = participants.map((p) => `- ${p}`).join("\n");
  return `**KICKOFF MEETING**

Thời gian: **${date} lúc ${time}**

Thành viên tham gia:
${list}

Nội dung:
1. Presale trình bày yêu cầu KH, phương án triển khai
2. PM xin nhân sự, phân công nhiệm vụ
3. Thống nhất timeline, SOW

Vui lòng xác nhận tham gia.`;
}

// ─── Generate tasks from SOW ──────────────────────────────
export function parseTasksFromSOW(sowContent: string, assigneeName: string, assigneeEmail: string): DeployTask[] {
  const tasks: DeployTask[] = [];

  // Simple keyword-based parser
  const lines = sowContent.split("\n");
  let currentSection = "";

  for (const line of lines) {
    const lower = line.toLowerCase().trim();
    if (lower.startsWith("## ") || lower.startsWith("h2.")) {
      currentSection = line.replace(/^## |^h2\.\s*/, "").trim();
      continue;
    }
    if (lower.startsWith("- [ ]") || lower.startsWith("  - [ ]")) {
      const title = line.replace(/^\s*- \[ \]\s*/, "").trim();
      if (title) {
        const isHigh = lower.includes("priority: high") || lower.includes("khẩn") || lower.includes("gấp");
        tasks.push({
          id: `task_${tasks.length + 1}`,
          title,
          assignee: assigneeName,
          assigneeEmail,
          priority: isHigh ? "high" : "normal",
          status: "pending",
          dueDate: "",
          notes: `Từ section: ${currentSection}`,
        });
      }
    }
  }

  // If no tasks parsed, add some defaults
  if (tasks.length === 0) {
    tasks.push({
      id: "task_default_1",
      title: "Triển khai hạ tầng theo SOW",
      assignee: assigneeName,
      assigneeEmail,
      priority: "high",
      status: "pending",
      dueDate: "",
      notes: "Từ SOW",
    });
  }

  return tasks;
}

// ─── Generate handover email ──────────────────────────────
export function generateHandoverEmail(
  projectName: string,
  ticketId: string,
  tasks: DeployTask[],
  sowUrl?: string
): string {
  const doneTasks = tasks.filter((t) => t.status === "done");
  const totalManDay = tasks.reduce((sum) => sum + 1, 0); // simplified

  return `**BÀN GIAO DỰ ÁN SAU TRIỂN KHAI**

Kính gửi: Operations Team (L1/L2)

Dự án: **${projectName}** | Ticket: **#${ticketId}**

**1. Thông tin bàn giao:**
- Scope đã triển khai: ${doneTasks.length}/${tasks.length} hạng mục
- SOW: ${sowUrl || "Xem trên ticket"}
- Tổng Manday: ${totalManDay} MD

**2. Công việc đã hoàn thành:**
${doneTasks.map((t) => `- [x] ${t.title} (${t.assignee})`).join("\n") || "Không có"}

**3. Lưu ý:**
- KH đã xác nhận bàn giao thành công
- FCI hỗ trợ theo luồng HTKT khi KH có yêu cầu

Trân trọng,
PM Team – KFlow`;
}

// ─── Task priority monitoring ────────────────────────────
export function getUrgentTasks(tasks: DeployTask[]): Array<{ task: DeployTask; reason: string }> {
  const now = Date.now();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const urgent: Array<{ task: DeployTask; reason: string }> = [];

  for (const task of tasks) {
    if (task.status === "done") continue;
    if (!task.dueDate) continue;

    const due = new Date(task.dueDate).getTime();
    const diffDays = Math.ceil((due - now) / (1000 * 60 * 60 * 24));

    if (task.priority === "high" && diffDays <= 2) {
      urgent.push({ task, reason: `Còn ${diffDays} ngày (High priority - báo trước 2 ngày)` });
    } else if (task.priority === "normal" && diffDays <= 0) {
      urgent.push({ task, reason: `Đến hạn hôm nay (Normal priority - báo sáng)` });
    }
  }

  return urgent;
}

// ─── Assessment from teams monitoring ────────────────────
export function assessTeamsForScopeChange(messages: TeamsMessage[]): AgentSuggestion[] {
  const suggestions: AgentSuggestion[] = [];

  for (const msg of messages) {
    const c = msg.content.toLowerCase();

    // Firewall detection -> add infras + security
    if (c.includes("firewall") && (c.includes("thêm") || c.includes("cần") || c.includes("yêu cầu"))) {
      suggestions.push({
        id: `fw_${msg.id}`,
        type: "action",
        title: "Phát hiện yêu cầu Firewall - Cập nhật scope",
        description: `Từ ${msg.sender}: "${msg.content.slice(0, 100)}"\n\nĐề xuất: Bổ sung Infras + Security vào scope triển khai và chuyển trạng thái dự án sang Kickoff.`,
        actionLabel: "Cập nhật scope",
        source: "teams_monitor",
      });
    }

    // Customer requesting more resources
    if (c.includes("thêm") && (c.includes("vm") || c.includes("dịch vụ") || c.includes("tài nguyên"))) {
      suggestions.push({
        id: `req_${msg.id}`,
        type: "info",
        title: "KH yêu cầu bổ sung",
        description: `Từ ${msg.sender}: "${msg.content.slice(0, 100)}"\n\nCần làm SOW amendment hoặc tạo ticket mới.`,
        actionLabel: "Xem chi tiết",
        source: "teams_monitor",
      });
    }
  }

  return suggestions;
}

// ─── Priority monitoring suggestions ─────────────────────
export function getDeadlineSuggestions(tasks: DeployTask[]): AgentSuggestion[] {
  const urgent = getUrgentTasks(tasks);
  return urgent.map((u, i) => ({
    id: `deadline_${i}`,
    type: u.task.priority === "high" ? "warning" : "info",
    title: `Task sắp đến hạn: ${u.task.title}`,
    description: u.reason,
    actionLabel: "Nhắc PIC",
    source: "deadline",
  }));
}
