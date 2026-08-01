// ─── Workflow Step Enum ────────────────────────────────────
export type PMWorkflowStep =
  | "init"
  | "teams_intro"
  | "consulting_check"
  | "kickoff"
  | "sow_draft"
  | "sow_review"
  | "in_progress"
  | "handover"
  | "completed";

// ─── Session Status ────────────────────────────────────────
export type PMSessionStatus = "active" | "completed" | "cancelled";

// ─── Sales / Presale Info ─────────────────────────────────
export interface SalesInfo {
  name: string;
  email: string;
  role: string; // "Sale" | "Reporter"
}

export interface PresaleInfo {
  name: string;
  email: string;
}

// ─── Deployment Personnel ─────────────────────────────────
export interface PersonnelInfo {
  name: string;
  email: string;
  team: string;
  region: string;
  role: "pic" | "support";
}

// ─── Kickoff Meeting ───────────────────────────────────────
export interface KickoffMeeting {
  date: string;
  time: string;
  participants: string[];
  agenda: string;
  meetingUrl?: string;
  notes?: string;
}

// ─── SOW ──────────────────────────────────────────────────
export type SOWStatus = "pending" | "presale_drafting" | "kt_updating" | "pm_reviewing" | "customer_review" | "approved" | "rejected";

export interface SOWInfo {
  status: SOWStatus;
  draftUrl: string;
  reviewNotes: string;
  sharedFolderUrl?: string;
  evidenceUrl?: string;
}

// ─── Task (for project tasks derived from SOW) ────────────
export interface DeployTask {
  id: string;
  title: string;
  assignee: string;
  assigneeEmail: string;
  priority: "high" | "normal" | "low";
  status: "pending" | "in_progress" | "done";
  dueDate?: string; // ISO date
  notes?: string;
}

// ─── Teams Group ──────────────────────────────────────────
export interface TeamGroup {
  id: string;
  name: string;
  type: "internal" | "external";
  memberCount: number;
}

// ─── Mock Teams Message ───────────────────────────────────
export interface TeamsMessage {
  id: string;
  groupId: string;
  groupName: string;
  sender: string;
  content: string;
  timestamp: number;
}

// ─── Workflow Data ─────────────────────────────────────
export interface WorkflowData {
  // Cốt lõi
  personnel: PersonnelInfo[];
  meeting: KickoffMeeting | null;
  sow: SOWInfo;
  tasks: DeployTask[];
  notes: string;

  // Mới: Teams & Presale
  presaleName: string;
  presaleEmail: string;
  consultingTicketId: string;
  consultingOwner: string;

  // Teams groups
  internalGroupId: string;
  externalGroupId: string;
  teamsMessages: TeamsMessage[];

  // Handover
  handoverEmailSent: boolean;

  // Linked KFlow project
  linkedProjectId?: string;
}

// ─── ISD Ticket Data (cached) ─────────────────────────────
export interface ISDTicketData {
  id: string;
  key: string;
  summary: string;
  status: string;
  priority: string;
  description: string;
  requester: string;
  requesterEmail?: string;
  assignee?: string;
  assigneeEmail?: string;
  components?: string[];
  labels?: string[];
  issueType?: string;
  projectKey?: string;
  createdDate?: string;
  updatedDate?: string;
}

// ─── ISD Config ────────────────────────────────────────────
export interface ISDConfig {
  endpoint: string;
  token: string;
}

// ─── Chat Message ──────────────────────────────────────────
export interface ChatMessage {
  _id: string;
  sessionId: string;
  role: "agent" | "user" | "system";
  content: string;
  metadata?: string;
  createdAt: number;
}

// ─── Agent Suggestion ──────────────────────────────────────
export interface AgentSuggestion {
  id: string;
  type: "info" | "action" | "warning" | "success";
  title: string;
  description: string;
  actionLabel?: string;
  actionPayload?: Record<string, unknown>;
  source?: string; // e.g. "teams_monitor", "deadline", "kickoff"
}

// ─── In-App Notification ──────────────────────────────────
export interface AppNotification {
  id: string;
  type: "info" | "warning" | "deadline" | "mention";
  title: string;
  body: string;
  read: boolean;
  createdAt: number;
  actionUrl?: string;
}
