"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  Loader2, Send, Bot, User, X, Sparkles,
  Maximize2, Minus, ChevronDown, Check, CheckCheck, Clock,
  AlertTriangle, MessageSquare, PanelRightOpen, ExternalLink,
  Users
} from "lucide-react";
import TextareaAutosize from "react-textarea-autosize";
import { usePmSessions, useProjects, usePmSessionByProject, usePmGeneralSession, usePmMessages, usePmSessionById, usePmMutations, useSuggestionMutations, useTaskMutations, useTasksByProject, useMembersByProject } from "../../../src/hooks/useDomain";
import { analyzeWithLLM } from "../lib/llm-client";
import type { LLMAction, LLMTaskItem } from "../lib/llm-client";
import { resolveSendTarget, sendChatMessage, platformLabel, resolveEmailTarget, sendOutlookEmail } from "../../../src/lib/chatSend";
import { supersededSuggestionMessageIds } from "../../../src/lib/suggestionDedup";
import { NotificationBadge } from "./NotificationBadge";
import { SuggestionNotificationCard, parseSuggestionNotification } from "../../../src/components/chat/SuggestionNotificationCard";
import type { DeployTask, WorkflowData } from "../lib/types";

interface PendingAction {
  text: string;
  action: LLMAction;
  ticketId: string | null;
  projectQuery: string | null;
  reply: string;
  tasks?: LLMTaskItem[];
  platform?: "teams" | "zalo";
  chatName?: string;
  messageBody?: string;
  memberName?: string;
  emailTo?: string[];
  emailSubject?: string;
  emailBody?: string;
}

/**
 * Fetch ISD ticket data via the Next.js API proxy route.
 * This avoids Convex cloud network restrictions since the API route
 * runs on the Next.js server which can reach the internal Jira network.
 */
async function fetchISDData(ticketId: string) {
  const res = await fetch("/api/agents/fetch-isd", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticketId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(err.error || `Failed to fetch ISD data (${res.status})`);
  }
  return res.json();
}

interface ChatMessage {
  _id: string;
  role: "agent" | "user" | "system";
  content: string;
  metadata?: string;
  createdAt: number;
}

type MessageStatus = "sending" | "sent" | "seen";

type CreateFlowStep = "idle" | "select_type" | "enter_isd" | "enter_custom_name";

interface PendingMessage {
  tempId: string;
  role: "user" | "agent";
  content: string;
  status: MessageStatus;
  createdAt: number;
}

let tempIdCounter = 0;
function nextTempId() {
  tempIdCounter += 1;
  return `pending_${tempIdCounter}_${Date.now()}`;
}

function formatTime(ts: number) {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

const URL_PATTERN = /(https?:\/\/[^\s<]+)/g;

function renderMessage(content: string, isAgent: boolean): React.ReactNode {
  const lines = content.split("\n");
  return lines.map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    const rendered = parts.map((part, j) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={j} className="font-bold">{part.slice(2, -2)}</strong>;
      }
      const urlParts = part.split(URL_PATTERN);
      if (urlParts.length === 1) return <span key={j}>{urlParts[0]}</span>;
      return urlParts.map((seg, k) =>
        seg.match(URL_PATTERN)
          ? <a key={k} href={seg} target="_blank" rel="noopener noreferrer" className={`underline break-all transition-colors ${isAgent ? 'text-blue-600 dark:text-blue-400 font-semibold hover:text-blue-700 dark:hover:text-blue-300 underline-offset-2' : 'text-white font-bold hover:text-white/80 underline-offset-2'}`}>{seg}</a>
          : <span key={k}>{seg}</span>
      );
    });
    return <span key={i}>{rendered}{i < lines.length - 1 && <br />}</span>;
  });
}

const POPUP_ACTION_LABELS: Record<string, string> = {
  create_project: "Tạo dự án mới",
  lookup_ticket: "Tra cứu thông tin ticket",
  view_project: "Xem dự án",
  goto_project: "Chuyển đến dự án",
  add_personnel: "Thêm nhân sự",
  create_meeting: "Tạo meeting kickoff",
  update_sow: "Cập nhật SOW",
  add_task: "Tạo task cho dự án",
  send_message: "Gửi tin nhắn",
  send_email: "Gửi email",
};

function popupActionDescription(pa: PendingAction): string {
  const label = POPUP_ACTION_LABELS[pa.action] || pa.action;
  let base = "";
  if (pa.ticketId) base = `Bạn sắp thực hiện: ${label} #${pa.ticketId}.`;
  else if (pa.projectQuery) base = `Bạn sắp thực hiện: ${label}: "${pa.projectQuery}".`;
  else base = `Bạn sắp thực hiện: ${label}.`;
  if (pa.action === "add_task" && Array.isArray(pa.tasks) && pa.tasks.length > 0) {
    const list = pa.tasks
      .map((t) => `• ${t.title}${t.priority === "high" ? " (ưu tiên cao)" : ""}${t.dueDate ? ` — hạn ${t.dueDate}` : ""}`)
      .join("\n");
    base += `\n\nSẽ tạo **${pa.tasks.length} task**:\n${list}`;
  }
  if (pa.action === "send_message") {
    base += `\n\nNền tảng: ${platformLabel(pa.platform)}`;
    if (pa.chatName) base += `\nNhóm: ${pa.chatName}`;
    if (pa.memberName) base += `\nNgười nhận: ${pa.memberName}`;
    if (pa.messageBody) base += `\nNội dung: "${pa.messageBody}"`;
  }
  if (pa.action === "send_email") {
    if (pa.memberName) base += `\nNgười nhận: ${pa.memberName}`;
    if (pa.emailTo && pa.emailTo.length > 0) base += `\nĐến: ${pa.emailTo.join(", ")}`;
    if (pa.emailSubject) base += `\nTiêu đề: ${pa.emailSubject}`;
    if (pa.emailBody) base += `\nNội dung: "${pa.emailBody}"`;
  }
  return base;
}

function StatusIcon({ status, isAgent }: { status?: MessageStatus; isAgent: boolean }) {
  if (isAgent) return null;
  switch (status) {
    case "sending": return <Clock className="w-3 h-3 text-gray-300 animate-pulse" />;
    case "sent": return <Check className="w-3 h-3 text-gray-400" />;
    case "seen": return <CheckCheck className="w-3 h-3 text-blue-500" />;
    default: return null;
  }
}

const SUGGESTIONS = [
  { label: "Tạo dự án mới", icon: "🚀" },
  { label: "Đến dự án", icon: "🔍" },
  { label: "Xem thông tin ticket", icon: "🎫" },
  { label: "Thêm nhân sự", icon: "👥" },
  { label: "Tạo meeting kickoff", icon: "📅" },
  { label: "Gửi email", icon: "📧" },
];

/**
 * Tạo nhiều task cho 1 dự án qua API /api/data/tasks (action=createTask).
 * Trả về summary text tiếng Việt cho agent reply.
 */
async function createTasksForProject(
  userId: string,
  projectId: number | string,
  items: LLMTaskItem[],
  opts?: { lastOrder?: number; existingTitles?: Set<string> }
): Promise<{ created: number; skipped: number; message: string }> {
  const created: Array<{ title: string; id: number }> = [];
  let skipped = 0;
  let order = opts?.lastOrder ?? 0;

  for (const item of items) {
    const title = (item.title || "").trim();
    if (!title) continue;

    // Trùng tên với task đang có → bỏ qua, tránh duplicate
    const dupKey = title.toLowerCase();
    if (opts?.existingTitles?.has(dupKey)) {
      skipped++;
      continue;
    }
    opts?.existingTitles?.add(dupKey);

    let startDate: number | null = null;
    let endDate: number | null = null;
    if (item.dueDate && /\d{4}-\d{2}-\d{2}/.test(item.dueDate)) {
      const ms = new Date(item.dueDate).getTime();
      if (!isNaN(ms)) {
        startDate = ms;
        endDate = ms + 8 * 3600 * 1000;
      }
    }

    try {
      const res = await fetch("/api/data/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "createTask",
          userId,
          title,
          estimatedTime: item.manday ?? 0,
          notes: item.detail || null,
          status: "todo",
          project: projectId,
          order: ++order,
          pic: item.pic || null,
          support: item.support || null,
          priority: item.priority || "normal",
          startDate,
          endDate,
        }),
      });
      const data = await res.json();
      if (res.ok && data && typeof data._id !== "undefined") {
        created.push({ title, id: Number(data._id) });
      } else {
        skipped++;
      }
    } catch (err) {
      console.error("[createTasksForProject] error:", err);
      skipped++;
    }
  }

  const createdTitles = created.map((c) => `- ${c.title}`).join("\n");
  const message =
    created.length > 0
      ? `Đã tạo **${created.length} task** cho dự án:\n${createdTitles}` +
        (skipped > 0 ? `\n\n${skipped} task bị bỏ qua (trùng tên hoặc lỗi).` : "")
      : `Không tạo được task nào.`;
  return { created: created.length, skipped, message };
}

export function PMAgentPopup({ isResizablePanel = false, onClose }: { isResizablePanel?: boolean; onClose?: () => void } = {}) {
  const router = useRouter();
  const { userId } = useAuth();
  const [internalIsOpen, setInternalIsOpen] = useState(true);
  const isOpen = isResizablePanel ? true : internalIsOpen;
  
  const handleClose = () => {
    if (onClose) {
      onClose();
    } else {
      setInternalIsOpen(false);
    }
  };

  const setIsOpen = (val: boolean) => {
    if (!val) handleClose();
    else setInternalIsOpen(val);
  };
  
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [input, setInput] = useState("");
  const [processing, setProcessing] = useState(false);
  const [pendingMessages, setPendingMessages] = useState<PendingMessage[]>([]);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [monitoringTasks, setMonitoringTasks] = useState<DeployTask[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [createFlowStep, setCreateFlowStep] = useState<CreateFlowStep>("idle");
  const [createFlowProjectName, setCreateFlowProjectName] = useState("");

  const { data: sessions } = usePmSessions(userId);
  const { data: allProjects } = useProjects(userId, { includeArchived: true, includeTrashed: false });

  // ─── Auto-detect current project context from URL ─────
  const pathname = usePathname();
  const urlProjectId = pathname?.match(/^\/projects\/([^/]+)/)?.[1] ?? null;
  // Dùng URL để chọn session (project page vs general). Members/groups lấy thêm từ session.linkedProjectId.
  const contextProjectId = urlProjectId;

  const urlProject = urlProjectId && allProjects
    ? allProjects.find((p) => p._id === urlProjectId)
    : null;

  // ─── Context-aware session selection ──────────────────
  // When on a project page: find existing session for that project, or auto-create one
  // When on other pages: find existing general session, or auto-create one
  const { data: projectSession } = usePmSessionByProject(contextProjectId ?? null, userId);
  const { data: generalSession } = usePmGeneralSession(userId);

  const pmx = usePmMutations();
  const createGeneralSessionMut = pmx.createGeneralSession;
  const createProjectSessionMut = pmx.createProjectSession;

  const [sessionId, setSessionId] = useState<string | null>(null);
  const isInitializingRef = useRef(false);
  // Tracks the URL context for which the current session was auto-chosen.
  // When context changes (navigating between projects, or project ↔ general),
  // we switch to the appropriate session.
  const lastContextRef = useRef<string | null>(null);

  /**
   * Build a context key from the current URL pathname.
   * For project pages: "project:<projectId>"
   * For general pages: "general"
   */
  const contextKey = contextProjectId ? `project:${contextProjectId}` : "general";

  // Effect: auto-select or auto-create the right session based on URL context.
  // Switches session when the user navigates between projects or project ↔ general.
  useEffect(() => {
    if (!userId) return;
    if (isInitializingRef.current) return;

    const prevKey = lastContextRef.current;

    // Skip if context hasn't changed (e.g. re-render, not navigation)
    if (prevKey === contextKey && sessionId) return;

    // If context changed to a project page
    if (contextProjectId) {
      if (projectSession === undefined) return; // Still loading
      if (projectSession) {
        setSessionId(projectSession._id);
        lastContextRef.current = contextKey;
      } else if (!isInitializingRef.current) {
        const project = urlProject;
        if (!project) return;
        isInitializingRef.current = true;
        createProjectSessionMut(userId, project._id, project.name).then((sid) => {
          setSessionId(sid);
          lastContextRef.current = contextKey;
        }).catch(console.error).finally(() => {
          isInitializingRef.current = false;
        });
      }
    } else {
      // ── General page ──
      if (generalSession === undefined) return; // Still loading
      if (generalSession) {
        setSessionId(generalSession._id);
        lastContextRef.current = contextKey;
      } else if (!isInitializingRef.current) {
        isInitializingRef.current = true;
        createGeneralSessionMut(userId).then((sid) => {
          setSessionId(sid);
          lastContextRef.current = contextKey;
        }).catch(console.error).finally(() => {
          isInitializingRef.current = false;
        });
      }
    }
  }, [userId, contextKey, contextProjectId, projectSession, generalSession, urlProject, createProjectSessionMut, createGeneralSessionMut, sessionId]);

  const { data: messages, mutate: mutateMessages } = usePmMessages(sessionId ?? null);
  const { data: session } = usePmSessionById(sessionId ?? null);

  const sessionLinkedProjectId = (() => {
    if (!session) return null;
    try {
      const wf = JSON.parse(session.workflowData || "{}");
      if (wf.linkedProjectId) return String(wf.linkedProjectId);
    } catch {}
    if (session.projectId) return String(session.projectId);
    return null;
  })();

  const effectiveProjectId = urlProjectId ?? sessionLinkedProjectId;
  const contextProject = effectiveProjectId && allProjects
    ? allProjects.find((p) => p._id === effectiveProjectId)
    : null;

  const addMessage = pmx.addMessage;
  const createProjectFromTicket = pmx.createProjectFromTicket;
  const createCustomProjectMutation = pmx.createCustomProject;
  const smx = useSuggestionMutations();
  const addSuggestionsBatch = smx.addSuggestionsBatch;
  const tmx = useTaskMutations();
  const createTask = tmx.createTask;
  const { data: projectTasks } = useTasksByProject(effectiveProjectId ?? null);
  const { data: contextProjectMembers } = useMembersByProject(effectiveProjectId ?? null);
  const pendingRef = useRef<PendingMessage[]>([]);

  /** Keep pendingRef in sync with pendingMessages */
  useEffect(() => {
    pendingRef.current = pendingMessages;
  }, [pendingMessages]);

  /**
   * Create a project from an ISD ticket by:
   * 1. Fetching ISD data via the Next.js API proxy (avoids Convex network restrictions)
   * 2. Passing pre-fetched data to the Convex mutation
   */
  /**
   * Auto-generate suggestions after creating a project from ISD ticket.
   * Calls the API route which maps ISD status to deployment flow state,
   * backfills past-state suggestions, and uses LLM for kickoff messages.
   */
  const generateSuggestions = useCallback(async (ticketId: string, projectId: string, isdData: any) => {
    try {
      const res = await fetch("/api/agents/generate-project-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId, isdData }),
      });

      if (!res.ok) {
        console.warn("[generateSuggestions] API error:", res.status);
        return;
      }

      const result = await res.json();
      if (!result.ok || !Array.isArray(result.suggestions) || result.suggestions.length === 0) return;

      await addSuggestionsBatch({
        projectId: projectId,
        userId: userId!,
        suggestions: result.suggestions.map((s: any) => ({
          type: s.type,
          title: s.title,
          description: s.description,
          actionLabel: s.actionLabel,
          suggestionData:
            s.saleEmail || s.emailSubject || s.emailBody || s.teamsDeepLink || s.input || s.reasoning || s.expectedOutcome || s.groupAction
              ? JSON.stringify({
                  saleEmail: s.saleEmail,
                  emailSubject: s.emailSubject,
                  emailBody: s.emailBody,
                  teamsDeepLink: s.teamsDeepLink,
                  input: s.input,
                  reasoning: s.reasoning,
                  expectedOutcome: s.expectedOutcome,
                  groupAction: s.groupAction,
                })
              : undefined,
        })),
      });
    } catch (err) {
      console.warn("[generateSuggestions] Error:", err);
    }
  }, [userId, addSuggestionsBatch]);

  const createProjectFromISD = useCallback(async (ticketId: string) => {
    // Fetch ISD data via the API proxy (runs on Next.js server)
    const isdData = await fetchISDData(ticketId);
    // Call the mutation with pre-fetched data
    const result = await createProjectFromTicket({
      userId: userId!,
      ticketId,
      isdData: JSON.stringify(isdData),
    });

    // Auto-generate suggestions based on ISD status (fire-and-forget)
    if (result.projectId && !result.duplicate) {
      generateSuggestions(ticketId, result.projectId, isdData);
    }

    return result;
  }, [userId, createProjectFromTicket, generateSuggestions]);

  // When a new session is created, persist pending create-flow messages to Convex
  useEffect(() => {
    if (!sessionId) return;
    const msgs = pendingRef.current;
    if (msgs.length === 0) return;
    // Save and clear in background
    (async () => {
      for (const p of msgs) {
        if (p.status === "sent" || p.status === "sending") {
          await addMessage({ sessionId, role: p.role, content: p.content }).catch(() => {});
        }
      }
    })();
    setPendingMessages([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Smart auto-scroll: chỉ scroll xuống nếu user đang ở gần cuối
  useEffect(() => {
    if (!isOpen || !isNearBottom) return;
    const timer = setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);
    return () => clearTimeout(timer);
  }, [messages, pendingMessages, isOpen, isNearBottom]);

  // Theo dõi vị trí scroll
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const threshold = 150; // px from bottom
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setIsNearBottom(bottom < threshold);
  }, []);

  useEffect(() => {
    const handler = (e: CustomEvent) => { setIsOpen(true); };
    window.addEventListener("pm-agent:toggle", handler as EventListener);
    return () => window.removeEventListener("pm-agent:toggle", handler as EventListener);
  }, []);

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 300);
  }, [isOpen]);

  useEffect(() => {
    if (messages && messages.length > 0) {
      // Remove pendingMessages that have already been persisted to Convex.
      // Use role+content as the dedup key (not createdAt, which differs between client and server).
      const persisted = new Set(messages.map((m) => `${m.role}|${m.content}`));
      setPendingMessages((prev) =>
        prev.filter((p) => !persisted.has(`${p.role}|${p.content}`))
      );

      // Show seen indicator on the last agent message
      setShowSuggestions(false);
    }
  }, [messages]);

  // ─── Monitoring simulation ────────────────────────────
  // Periodically scan mock Teams data and generate suggestions
  // Auto-sync project chats every 10 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      fetch("/api/agents/sync-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync" }),
      }).catch(console.error);
    }, 10 * 60 * 1000); // 10 minutes

    return () => clearInterval(interval);
  }, []);



  const chatHistory = (messages ?? []).map((m) => ({
    role: m.role as "user" | "agent" | "system",
    content: m.content,
  }));

  // ─── Workflow data helpers ────────────────────────────
  const getWf = useCallback((): WorkflowData | null => {
    if (!session?.workflowData) return null;
    try { return JSON.parse(session.workflowData); } catch { return null; }
  }, [session?.workflowData]);

  // ─── Action detection ────────────────────────────────
  const detectAction = useCallback(async (text: string): Promise<PendingAction | null> => {
    // If we're in create flow, handle the input differently
    if (createFlowStep !== "idle") return null;

    const memberList = (contextProjectMembers ?? []).map((m: any) => ({
      name: m.name,
      roleName: m.roleName,
      email: m.email ?? null,
    }));
    const groupList = (contextProject?.teamsGroups ?? []).map((g: any) => ({
      name: g.name,
      type: g.type,
      platform: g.platform,
    }));
    const llmResult = await analyzeWithLLM(text, [...chatHistory.slice(-6)], contextProject, memberList, groupList);
    const { action, ticketId, projectQuery, reply, tasks, platform, chatName, messageBody, memberName, emailTo, emailSubject, emailBody } = llmResult;

    // ── Auto-handle actions that match the current context ──────
    // If already viewing a project and user asks to view it, no confirmation needed
    if (action === "view_project" && contextProject) {
      return { text, action: "goto_project", ticketId, projectQuery: contextProject.name, reply };
    }

    const needsConfirmation: LLMAction[] = [
      "lookup_ticket",
      "add_personnel", "create_meeting", "update_sow",
      "add_task",
      "send_message", "send_email",
    ];
    if (needsConfirmation.includes(action)) {
      let resolvedChatName = chatName;
      let resolvedPlatform = platform;
      let finalReply = reply;
      if (action === "send_message") {
        const resolved = resolveSendTarget({
          memberName,
          chatName,
          platform,
          members: memberList,
          groups: groupList,
          projectName: contextProject?.name,
        });
        if (resolved.chatName) resolvedChatName = resolved.chatName;
        resolvedPlatform = resolved.platform;
        if (resolved.note || resolved.error) {
          finalReply = `${reply}\n\n💡 ${resolved.note || resolved.error}`;
        }
      }
      let resolvedEmailTo = emailTo;
      let resolvedMemberName = memberName;
      if (action === "send_email") {
        const resolved = resolveEmailTarget({
          emailTo,
          memberName,
          members: memberList,
          projectName: contextProject?.name,
        });
        if (resolved.emailTo.length > 0) resolvedEmailTo = resolved.emailTo;
        if (resolved.memberName) resolvedMemberName = resolved.memberName;
        if (resolved.note || resolved.error) {
          finalReply = `${reply}\n\n💡 ${resolved.note || resolved.error}`;
        }
      }
      return {
        text, action, ticketId, projectQuery: projectQuery ?? null, reply: finalReply,
        tasks: tasks ?? undefined, platform: resolvedPlatform, chatName: resolvedChatName,
        messageBody, memberName: resolvedMemberName, emailTo: resolvedEmailTo, emailSubject, emailBody,
      };
    }

    // create_project — handle directly in handleSend, no session needed
    if (action === "create_project") return { text, action, ticketId, projectQuery: projectQuery ?? null, reply };

    // goto_project — handle directly in handleSend
    if (action === "goto_project") return { text, action, ticketId, projectQuery: projectQuery ?? null, reply };

    if (!sessionId) return null;

    await addMessage({ sessionId, role: "user", content: text });
    await addMessage({ sessionId, role: "agent", content: reply || `Đã nhận: "${text}". Tôi có thể giúp gì thêm?` });
    return null;
  }, [sessionId, chatHistory, addMessage, createFlowStep, contextProject, contextProjectMembers]);

  // ─── Execute confirmed action ────────────────────────
  const executeAction = useCallback(async (pa: PendingAction) => {
    const { action, ticketId, projectQuery, text, reply } = pa;
    setPendingAction(null);

    // ── Use context project to auto-bind actions ──────────────
    const effectiveProject = contextProject || null;

    // ── goto_project shortcut: if contextProject is already the target, just stay ──
    if (action === "goto_project" && contextProject) {
      // Already viewing a project, and user asked to "go there" — just confirm
      return { message: `Bạn đang xem dự án **${contextProject.name}**. Tôi có thể giúp gì cho dự án này?` };
    }

    // Intercept create_project — start the create flow
    if (action === "create_project") {
      if (ticketId) {
        // User already provided a ticket ID — go straight to ISD creation
        setProcessing(true);
        try {
          const result = await createProjectFromISD(ticketId);
          if (result.duplicate) {
            setSessionId(result.sessionId);
            if (result.projectId) {
              setTimeout(() => router.push(`/projects/${result.projectId}`), 500);
            }
            return { noRedirect: true, message: `Ticket **#${ticketId}** đã tồn tại (dự án **${result.projectName}**).\n\nĐang chuyển tới dự án...` };
          }
          setSessionId(result.sessionId);
          if (result.projectId) {
            setTimeout(() => router.push(`/projects/${result.projectId}`), 500);
          }
          return { noRedirect: true, message: `Đã tạo dự án thành công từ **#${ticketId}**! 🎉` };
        } catch (err) {
          return { message: `Lỗi: ${err instanceof Error ? err.message : "Lỗi không xác định"}` };
        } finally {
          setProcessing(false);
        }
      } else {
        // No ticket ID — start the multi-step create flow
        setCreateFlowStep("select_type");
        return { message: "Bạn muốn tạo dự án kiểu nào?" };
      }
    }

    // ── send_message / send_email: gửi thật, không phụ thuộc session ──
    // Tin user đã persist lúc handleSend (trước confirm) — không ghi lại.
    if (action === "send_message") {
      const messageBody = (pa.messageBody || "").trim();
      const post = async (content: string) => {
        if (sessionId) await addMessage({ sessionId, role: "agent", content });
        else return { message: content };
        return {};
      };
      if (!messageBody) {
        return post(`Tôi cần thêm **nội dung tin nhắn**.\n\nVD: "Nhắn cho Kang Chan 'Đã nhận yêu cầu' trên Zalo"`);
      }
      const resolved = resolveSendTarget({
        memberName: pa.memberName,
        chatName: pa.chatName,
        platform: pa.platform,
        members: contextProjectMembers ?? [],
        groups: contextProject?.teamsGroups ?? [],
        projectName: contextProject?.name,
      });
      if (resolved.error || !resolved.chatName) {
        return post(resolved.error || "Không xác định được nhóm đích.");
      }
      await post(`⏳ Đang gửi tin nhắn đến nhóm **${resolved.chatName}** trên ${platformLabel(resolved.platform)}...`);
      try {
        const result = await sendChatMessage({
          platform: resolved.platform,
          chatName: resolved.chatName,
          message: messageBody,
        });
        if (result.ok) {
          return post(
            `✅ Đã gửi tin nhắn đến nhóm **${resolved.chatName}**` +
            (resolved.memberName ? ` (${resolved.memberName})` : "") +
            ` trên ${platformLabel(resolved.platform)}:\n\n> ${messageBody}`
          );
        }
        return post(`❌ Gửi tin nhắn đến **${resolved.chatName}** thất bại: ${result.error || "Lỗi không xác định"}`);
      } catch (err) {
        return post(`❌ Lỗi khi gửi tin nhắn: ${err instanceof Error ? err.message : "Lỗi không xác định"}`);
      }
    }

    if (action === "send_email") {
      const post = async (content: string) => {
        if (sessionId) await addMessage({ sessionId, role: "agent", content });
        else return { message: content };
        return {};
      };
      const resolved = resolveEmailTarget({
        emailTo: pa.emailTo,
        memberName: pa.memberName,
        members: contextProjectMembers ?? [],
        projectName: contextProject?.name,
      });
      const to = resolved.emailTo;
      const subject = (pa.emailSubject || "").trim() || "Tin nhắn từ PM Agent";
      const emailBody = (pa.emailBody || "").trim();
      if (to.length === 0) {
        return post(resolved.error || `Tôi cần địa chỉ email để gửi.\n\nVD: "Gửi email đến abc@gmail.com với tiêu đề Test và nội dung Xin chào"`);
      }
      await post(`⏳ Đang gửi email đến **${to.join(", ")}**${resolved.memberName ? ` (${resolved.memberName})` : ""}...`);
      try {
        const result = await sendOutlookEmail({ to, subject, body: emailBody });
        if (result.ok) {
          return post(`✅ Đã gửi email đến **${to.join(", ")}** với tiêu đề **${subject}**.`);
        }
        return post(`❌ Gửi email đến **${to.join(", ")}** thất bại: ${result.error || "Lỗi không xác định"}`);
      } catch (err) {
        return post(`❌ Lỗi khi gửi email: ${err instanceof Error ? err.message : "Lỗi không xác định"}`);
      }
    }

    if (!sessionId) {
      // No active session — use contextProject as target if available
      if (contextProject) {
        if (action === "add_personnel") {
          return { message: `Đang mở trang quản lý nhân sự cho dự án **${contextProject.name}**... 📋` };
        }
        if (action === "create_meeting") {
          return { message: `Đang mở trang dự án **${contextProject.name}** để tạo meeting kickoff... 📅` };
        }
        if (action === "update_sow") {
          return { message: `Đang mở trang dự án **${contextProject.name}** để cập nhật SOW... 📝` };
        }
      }
      return { message: reply || `Tôi tìm thấy ticket **${ticketId}**. Bạn muốn tạo dự án mới không?` };
    }

    // ── add_task: tạo task cho dự án (context project / session project) ──
    if (action === "add_task") {
      const items = (pa.tasks ?? []).filter((t) => t && t.title && t.title.trim());
      const target = (() => {
        try {
          const wf = session?.workflowData ? JSON.parse(session.workflowData) : null;
          if (wf?.linkedProjectId) return { projectId: Number(wf.linkedProjectId), name: session?.projectName || "dự án" };
        } catch {}
        return contextProject ? { projectId: contextProject._id as string, name: contextProject.name } : null;
      })();

      if (!target) {
        await addMessage({
          sessionId, role: "agent",
          content: "Tôi cần biết task này thuộc **dự án nào**. Hãy mở trang dự án (hoặc bảo tôi \"đến dự án ...\") rồi thử lại.",
        });
        return {};
      }
      if (items.length === 0) {
        await addMessage({
          sessionId, role: "agent",
          content: `Bạn muốn tạo task cho dự án **${target.name}**? Hãy mô tả nội dung task (mỗi dòng 1 task, có thể kèm mức ưu tiên / người phụ trách / hạn chót).`,
        });
        return {};
      }

      try {
        const existingTitles = new Set(
          (projectTasks ?? []).map((t: any) => String(t.title || "").toLowerCase()).filter(Boolean)
        );
        const lastOrder = (projectTasks ?? []).reduce((max: number, t: any) => Math.max(max, Number(t.order) || 0), 0);
        const result = await createTasksForProject(userId!, target.projectId, items, { lastOrder, existingTitles });
        await addMessage({ sessionId, role: "agent", content: result.message });
      } catch (err) {
        await addMessage({
          sessionId, role: "agent",
          content: `Lỗi khi tạo task cho dự án **${target.name}**: ${err instanceof Error ? err.message : "Lỗi không xác định"}`,
        });
      }
      return {};
    }

    if (action === "lookup_ticket") {
      const ticketToLookup = ticketId || session?.ticketId || contextProject?.ticketId || null;
      if (!ticketToLookup) {
        await addMessage({ sessionId, role: "agent", content: "Không có ticket nào để tra cứu." });
        return {};
      }
      try {
        const isdData = await fetchISDData(ticketToLookup);
        await addMessage({
          sessionId, role: "agent",
          content: `**#${ticketToLookup}**: ${isdData.summary || "N/A"}\nTrạng thái: ${isdData.status || "N/A"} · Ưu tiên: ${isdData.priority || "N/A"}\nPhụ trách: ${isdData.assignee || "Chưa có"}`,
        });
      } catch {
        await addMessage({ sessionId, role: "agent", content: `Không thể lấy thông tin ticket **#${ticketToLookup}**.` });
      }
      return {};
    }

    // Handle project-scoped actions — bind to contextProject if session doesn't have a linked project
    if (action === "add_personnel" || action === "create_meeting" || action === "update_sow") {
      const targetProject = (() => {
        try {
          const wf = session?.workflowData ? JSON.parse(session.workflowData) : null;
          if (wf?.linkedProjectId) return null; // session already has a target
        } catch {}
        return contextProject ? `\n\nDự án hiện tại: **${contextProject.name}**` : "";
      })();
      await addMessage({
        sessionId, role: "agent",
        content: `Đã nhận yêu cầu **${POPUP_ACTION_LABELS[action] || action}**.${targetProject}` + (reply || `\n\nTôi sẽ hỗ trợ bạn ${POPUP_ACTION_LABELS[action]?.toLowerCase() || action}. Vui lòng cung cấp thêm chi tiết.`),
      });
      return {};
    }

    await addMessage({
      sessionId, role: "agent",
      content: reply || `Đã nhận: "${text}". Tôi có thể giúp gì thêm?`,
    });
    return {};
  }, [sessionId, userId, session, addMessage, createProjectFromISD, router, contextProject, contextProjectMembers]);

  const cancelAction = useCallback(() => {
    setPendingAction(null);
    setPendingMessages([]);
    setCreateFlowStep("idle");
    setCreateFlowProjectName("");
  }, []);

  const confirmAction = useCallback(async (pa: PendingAction) => {
    setProcessing(true);
    try {
      const result = await executeAction(pa);
      if (result?.message) {
        // Show as pending then it'll be merged
        setPendingMessages((prev) => [
          ...prev,
          { tempId: `result_${Date.now()}`, role: "agent", content: result.message, status: "sent", createdAt: Date.now() },
        ]);
      }
    } catch (err) {
      console.error("Error:", err);
      if (sessionId) {
        await addMessage({ sessionId, role: "agent", content: `Xin lỗi, đã có lỗi: ${err instanceof Error ? err.message : "Lỗi không xác định"}.` });
      }
    } finally {
      setProcessing(false);
    }
  }, [sessionId, addMessage, executeAction]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || processing || !userId) return;
    setInput("");

    // ─── Handle create flow steps ─────────────────────
    if (createFlowStep === "select_type") {
      // Allow cancelling at any step
      if (/^(?:h(?:ủ|uy)|cancel|th(?:ô|o)i|quay l(?:ạ|a)i|back)$/i.test(text.trim())) {
        setCreateFlowStep("idle");
        setPendingMessages((prev) => [...prev, {
          tempId: nextTempId(), role: "user", content: text, status: "sending", createdAt: Date.now(),
        }]);
        setPendingMessages((prev) => [...prev, {
          tempId: nextTempId(), role: "agent", content: "Đã huỷ thao tác.", status: "sent", createdAt: Date.now(),
        }]);
        return;
      }
      if (text.toLowerCase().includes("isd") || text.toLowerCase().includes("ticket") || text.includes("ISD")) {
        setCreateFlowStep("enter_isd");
        setPendingMessages((prev) => [...prev, {
          tempId: nextTempId(), role: "user", content: text, status: "sending", createdAt: Date.now(),
        }]);
        setPendingMessages((prev) => [...prev, {
          tempId: nextTempId(), role: "agent", content: "Vui lòng nhập **mã ticket ISD** hoặc **paste link ISD** để tạo dự án.\n\nVD: `ISD-90335` hoặc `https://servicedesk.fci.vn/browse/ISD-90335`", status: "sent", createdAt: Date.now(),
        }]);
        return;
      } else {
        // Custom project
        setCreateFlowStep("enter_custom_name");
        setPendingMessages((prev) => [...prev, {
          tempId: nextTempId(), role: "user", content: text, status: "sending", createdAt: Date.now(),
        }]);
        setPendingMessages((prev) => [...prev, {
          tempId: nextTempId(), role: "agent", content: "Vui lòng nhập **tên dự án** để tạo.", status: "sent", createdAt: Date.now(),
        }]);
        return;
      }
    }

    if (createFlowStep === "enter_isd") {
      setPendingMessages((prev) => [...prev, {
        tempId: nextTempId(), role: "user", content: text, status: "sending", createdAt: Date.now(),
      }]);
      // Allow cancelling
      if (/^(?:h(?:ủ|uy)|cancel|th(?:ô|o)i|quay l(?:ạ|a)i|back)$/i.test(text.trim())) {
        setCreateFlowStep("idle");
        setProcessing(false);
        setPendingMessages((prev) => [...prev, {
          tempId: nextTempId(), role: "agent", content: "Đã huỷ thao tác.", status: "sent", createdAt: Date.now(),
        }]);
        return;
      }
      setProcessing(true);
      setCreateFlowStep("idle");
      try {
        // Extract ticket ID from input
        const isdMatch = text.match(/ISD[-\s]?(\d+)/i);
        const ticketId = isdMatch ? `ISD-${isdMatch[1]}` : null;
        if (!ticketId) {
          setPendingMessages((prev) => [...prev, {
            tempId: nextTempId(), role: "agent", content: "Không tìm thấy mã ticket ISD. Vui lòng thử lại.", status: "sent", createdAt: Date.now(),
          }]);
          setProcessing(false);
          return;
        }
        const result = await createProjectFromISD(ticketId);
        if (result.duplicate) {
          setSessionId(result.sessionId);
          setPendingMessages((prev) => [...prev, {
            tempId: nextTempId(), role: "agent", content: `Ticket **#${ticketId}** đã tồn tại (dự án **${result.projectName}**).\n\nĐang chuyển tới dự án...`, status: "sent", createdAt: Date.now(),
          }]);
          if (result.projectId) {
            setTimeout(() => router.push(`/projects/${result.projectId}`), 800);
          }
        } else {
          setSessionId(result.sessionId);
          setPendingMessages((prev) => [...prev, {
            tempId: nextTempId(), role: "agent", content: `Đã tạo dự án thành công từ **#${ticketId}**! 🎉`, status: "sent", createdAt: Date.now(),
          }]);
          if (result.projectId) {
            setTimeout(() => router.push(`/projects/${result.projectId}`), 800);
          }
        }
      } catch (err) {
        setPendingMessages((prev) => [...prev, {
          tempId: nextTempId(), role: "agent", content: `Lỗi: ${err instanceof Error ? err.message : "Lỗi không xác định"}`, status: "sent", createdAt: Date.now(),
        }]);
      } finally {
        setProcessing(false);
      }
      return;
    }

    if (createFlowStep === "enter_custom_name") {
      if (!text.trim()) return;
      setPendingMessages((prev) => [...prev, {
        tempId: nextTempId(), role: "user", content: text, status: "sending", createdAt: Date.now(),
      }]);
      // Allow cancelling
      if (/^(?:h(?:ủ|uy)|cancel|th(?:ô|o)i|quay l(?:ạ|a)i|back)$/i.test(text.trim())) {
        setCreateFlowStep("idle");
        setProcessing(false);
        setPendingMessages((prev) => [...prev, {
          tempId: nextTempId(), role: "agent", content: "Đã huỷ thao tác.", status: "sent", createdAt: Date.now(),
        }]);
        return;
      }
      setProcessing(true);
      setCreateFlowStep("idle");
      try {
        const result = await createCustomProjectMutation(userId!, text.trim());
        setSessionId(result.sessionId);
        setPendingMessages((prev) => [...prev, {
          tempId: nextTempId(), role: "agent", content: `Đã tạo dự án **${text.trim()}** thành công! 🎉`, status: "sent", createdAt: Date.now(),
        }]);
        if (result.projectId) {
          setTimeout(() => router.push(`/projects/${result.projectId}`), 800);
        }
      } catch (err) {
        setPendingMessages((prev) => [...prev, {
          tempId: nextTempId(), role: "agent", content: `Lỗi: ${err instanceof Error ? err.message : "Lỗi không xác định"}`, status: "sent", createdAt: Date.now(),
        }]);
      } finally {
        setProcessing(false);
      }
      return;
    }

    // ─── Normal flow ──────────────────────────────────
    const tempId = nextTempId();
    setPendingMessages((prev) => [...prev, {
      tempId, role: "user", content: text, status: "sending", createdAt: Date.now(),
    }]);
    setShowSuggestions(false);
    setProcessing(true);

    try {
      const pa = await detectAction(text);
      // Always mark user message as sent once we have a response
      setPendingMessages((prev) => prev.map((p) => p.tempId === tempId ? { ...p, status: "sent" as const } : p));

      if (pa) {
        // create_project — go straight to create flow, no confirmation needed
        if (pa.action === "create_project") {
          setProcessing(false);

          if (pa.ticketId) {
            // Already has ticket ID — execute directly
            setProcessing(true);
            try {
              const result = await createProjectFromISD(pa.ticketId);
              if (result.duplicate) {
                setSessionId(result.sessionId);
                setPendingMessages((prev) => [...prev, {
                  tempId: nextTempId(), role: "agent", content: `Ticket **#${pa.ticketId}** đã tồn tại (dự án **${result.projectName}**).\n\nĐang chuyển tới dự án...`, status: "sent", createdAt: Date.now(),
                }]);
                if (result.projectId) {
                  setTimeout(() => router.push(`/projects/${result.projectId}`), 800);
                }
              } else {
                setSessionId(result.sessionId);
                setPendingMessages((prev) => [...prev, {
                  tempId: nextTempId(), role: "agent", content: `Đã tạo dự án thành công từ **#${pa.ticketId}**! 🎉`, status: "sent", createdAt: Date.now(),
                }]);
                if (result.projectId) {
                  setTimeout(() => router.push(`/projects/${result.projectId}`), 800);
                }
              }
            } catch (err) {
              setPendingMessages((prev) => [...prev, {
                tempId: nextTempId(), role: "agent", content: `Lỗi: ${err instanceof Error ? err.message : "Lỗi không xác định"}`, status: "sent", createdAt: Date.now(),
              }]);
            } finally {
              setProcessing(false);
            }
          } else {
            // No ticket ID — show create type selector
            setPendingMessages((prev) => [...prev, {
              tempId: nextTempId(), role: "agent", content: "Bạn muốn tạo dự án kiểu nào?", status: "sent", createdAt: Date.now(),
            }]);
            setCreateFlowStep("select_type");
          }
          return;
        }

        // goto_project — LLM-powered project matching and redirect
        if (pa.action === "goto_project") {
          // ── Fast path: already on a project detail page ──────────
          if (contextProject) {
            setPendingMessages((prev) => [...prev, {
              tempId: nextTempId(), role: "agent",
              content: `Bạn đang xem dự án **${contextProject.name}**. Tôi có thể giúp gì cho dự án này?`,
              status: "sent", createdAt: Date.now(),
            }]);
            setProcessing(false);
            return;
          }

          // Determine the query text: use LLM-extracted projectQuery, then ticketId, then raw text
          let query = (pa.projectQuery || pa.ticketId || "").trim();
          if (!query) {
            const isdMatch = text.match(/ISD[-\s]?(\d+)/i);
            query = isdMatch ? `ISD-${isdMatch[1]}` : text.trim();
          }
          // Clean up: remove common leading words if the LLM left them in
          query = query.replace(/^(?:chuyển\s*(?:sang|đến|qua|tới|đi)\s+|đến\s+|tìm\s+|mở\s+|xem\s+)/i, "").trim();

          try {
            // ── Fast path: exact ISD ticket ID match ─────────────
            // Skip LLM matching when user pastes a direct ISD URL/ticket ID
            const exactSessionMatch = sessions?.find(
              (s) => s.ticketId && s.ticketId.toUpperCase() === query.toUpperCase()
            );

            if (exactSessionMatch) {
              let exactProjectId: string | null = null;
              try {
                const wf = JSON.parse(exactSessionMatch.workflowData || "{}");
                exactProjectId = wf.linkedProjectId || null;
              } catch {}
              if (exactProjectId) {
                setPendingMessages((prev) => [...prev, {
                  tempId: nextTempId(), role: "agent",
                  content: `Đang chuyển đến dự án... 🚀`,
                  status: "sent", createdAt: Date.now(),
                }]);
                setProcessing(false);
                setTimeout(() => router.push(`/projects/${exactProjectId}`), 500);
                return;
              }
            }

            // Also check allProjects notes for exact ticket ID match
            const exactProjectMatch = allProjects?.find((p) => {
              if (p.notes) {
                try {
                  const notes = JSON.parse(p.notes);
                  return notes.ticketId && notes.ticketId.toUpperCase() === query.toUpperCase();
                } catch {}
              }
              return false;
            });

            if (exactProjectMatch) {
              setPendingMessages((prev) => [...prev, {
                tempId: nextTempId(), role: "agent",
                content: `Đang chuyển đến dự án... 🚀`,
                status: "sent", createdAt: Date.now(),
              }]);
              setProcessing(false);
              setTimeout(() => router.push(`/projects/${exactProjectMatch._id}`), 500);
              return;
            }

            // ── LLM-powered matching ────────────────────────────
            // Build combined project list (max 30 recent)
            const projectEntries: Array<{ id: string; name: string; ticketId: string | null }> = [];
            const seenIds = new Set<string>();

            // Sessions first (most recent, with linked KFlow projects)
            for (const s of (sessions || [])) {
              if (projectEntries.length >= 30) break;
              let linkedProjectId: string | null = null;
              try {
                const wf = JSON.parse(s.workflowData || "{}");
                linkedProjectId = wf.linkedProjectId || null;
              } catch {}
              if (linkedProjectId && !seenIds.has(linkedProjectId)) {
                seenIds.add(linkedProjectId);
                projectEntries.push({
                  id: linkedProjectId,
                  name: s.projectName,
                  ticketId: s.ticketId || null,
                });
              }
            }

            // Supplement with allProjects
            for (const p of (allProjects || [])) {
              if (projectEntries.length >= 30) break;
              const pid = p._id as string;
              if (!seenIds.has(pid)) {
                seenIds.add(pid);
                let ticketId: string | null = null;
                if (p.notes) {
                  try {
                    const notes = JSON.parse(p.notes);
                    ticketId = notes.ticketId || null;
                  } catch {}
                }
                projectEntries.push({ id: pid, name: p.name, ticketId });
              }
            }

            // Call the LLM match-project API
            const matchRes = await fetch("/api/agents/match-project", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ query, projects: projectEntries }),
            });

            if (!matchRes.ok) {
              throw new Error(`Match API error (${matchRes.status})`);
            }

            const matchResult = await matchRes.json();

            if (matchResult.matched && matchResult.projectId) {
              setPendingMessages((prev) => [...prev, {
                tempId: nextTempId(), role: "agent",
                content: `Đang chuyển đến dự án **${matchResult.projectName}**... 🚀`,
                status: "sent", createdAt: Date.now(),
              }]);
              setProcessing(false);
              setTimeout(() => router.push(`/projects/${matchResult.projectId}`), 500);
            } else {
              setPendingMessages((prev) => [...prev, {
                tempId: nextTempId(), role: "agent",
                content: `Không tìm thấy dự án nào khớp với **${query}**.\n\nBạn có thể thử:\n- **Tạo dự án mới** từ ticket ISD\n- Kiểm tra lại tên dự án hoặc mã ticket\n- Mô tả rõ hơn về dự án bạn muốn tìm (tên dự án hoặc mã ticket)`,
                status: "sent", createdAt: Date.now(),
              }]);
              setProcessing(false);
            }
          } catch (err) {
            console.error("[goto_project error]", err);
            setPendingMessages((prev) => [...prev, {
              tempId: nextTempId(), role: "agent",
              content: `Không thể tìm kiếm dự án: ${err instanceof Error ? err.message : "Lỗi không xác định"}. Vui lòng thử lại.`,
              status: "sent", createdAt: Date.now(),
            }]);
            setProcessing(false);
          }
          return;
        }

        setPendingAction(pa);
        // Persist user ngay khi cần xác nhận — agent replies sau đó luôn đứng dưới.
        if (sessionId) {
          await addMessage({ sessionId, role: "user", content: text }).catch(() => {});
        }
        setProcessing(false);
        return;
      }

      // No pending action — if no session, show default greeting
      if (!sessionId) {
        setPendingMessages((prev) => [...prev, {
          tempId: nextTempId(), role: "agent", content: "Chào bạn! Tôi có thể giúp gì cho bạn?\n\n- **Tạo dự án mới**\n- **Tìm & đến dự án** (paste link hoặc nhập tên/ticket)\n- **Xem thông tin ticket**", status: "sent", createdAt: Date.now(),
        }]);
      }
      setProcessing(false);
    } catch (err) {
      console.error("Error:", err);
      // Keep user message visible, mark as sent
      setPendingMessages((prev) => prev.map((p) => p.tempId === tempId ? { ...p, status: "sent" as const } : p));
      setPendingMessages((prev) => [...prev, {
        tempId: nextTempId(), role: "agent", content: `Xin lỗi, đã có lỗi xử lý. Vui lòng thử lại.`, status: "sent", createdAt: Date.now(),
      }]);
      if (sessionId) {
        await addMessage({ sessionId, role: "agent", content: `Xin lỗi, đã có lỗi: ${err instanceof Error ? err.message : "Lỗi không xác định"}.` });
      }
      setProcessing(false);
    }
  }, [input, processing, userId, sessionId, addMessage, detectAction, createFlowStep, createProjectFromISD, createCustomProjectMutation, router]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };



  const displayMessages = messages ?? [];

  // Loading state: sessionId is set but messages haven't arrived yet
  const isLoadingMessages = sessionId && messages === undefined;

  const persistedKeys = new Set(displayMessages.map((m) => `${m.role}|${m.content}`));
  const extraPending = pendingMessages.filter((p) => !persistedKeys.has(`${p.role}|${p.content}`));
  // DB đã theo thứ tự createdAt,id — pending chỉ append cuối, không sort lẫn với DB.
  const rawAllMessages: Array<{ _id: string; role: "agent" | "user" | "system"; content: string; createdAt: number; status?: MessageStatus; metadata?: string }> = [
    ...displayMessages,
    ...extraPending.map((p) => ({
      _id: p.tempId, role: p.role, content: p.content, createdAt: p.createdAt, status: p.status,
    })),
  ];
  const hiddenNotifs = supersededSuggestionMessageIds(rawAllMessages);
  const allMessages = rawAllMessages.filter((m) => !hiddenNotifs.has(String(m._id)));

  // ─── FAB ─────────────────────────────────────────────
  if (!isOpen) {
    return (
      <div className="fixed bottom-6 right-6 z-[9999] animate-in fade-in slide-in-from-bottom-4 duration-500 flex flex-col items-end gap-3">
        <NotificationBadge tasks={monitoringTasks} />
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="w-14 h-14 rounded-full bg-gradient-to-tr from-primary to-primary/80 text-primary-foreground shadow-lg shadow-primary/30 hover:shadow-xl hover:shadow-primary/40 hover:-translate-y-1 active:scale-95 transition-all duration-300 cursor-pointer flex items-center justify-center ring-4 ring-primary/20"
        >
          <Bot className="w-6 h-6" />
        </button>
      </div>
    );
  }

  // ─── Main Popup ──────────────────────────────────────
  const wfData = getWf();
  const tasks = wfData?.tasks || [];

  return (
    <div className={`
      animate-in slide-in-from-bottom-full duration-300
      ${isResizablePanel 
        ? 'w-full h-full flex' 
        : 'fixed bottom-0 right-0 left-0 top-16 z-[9999] sm:top-auto sm:left-auto sm:bottom-6 sm:right-6 sm:slide-in-from-bottom-8 lg:static lg:z-40 lg:flex lg:h-full lg:shrink-0 lg:animate-in lg:slide-in-from-right-8 lg:duration-300'
      }
    `}>
      <div className="flex h-full lg:h-full items-start gap-3 w-full relative">
        {/* Chat box */}
        <div className={`
          flex flex-col overflow-hidden bg-background/95 dark:bg-zinc-900/95 backdrop-blur-2xl shadow-2xl
          ${isResizablePanel 
            ? 'w-full h-full rounded-none border-0 shadow-none ring-0' 
            : 'w-full h-full rounded-t-3xl border-t border-border/50 sm:w-[460px] sm:h-[600px] sm:max-h-[80vh] sm:rounded-[2rem] sm:border sm:border-border/50 sm:shadow-black/20 sm:ring-1 sm:ring-white/10 sm:dark:ring-white/5 lg:w-[460px] lg:h-full lg:max-h-full lg:rounded-none lg:border-0 lg:border-l lg:border-border/50 lg:shadow-xl lg:ring-0'
          }
        `}>
            {/* Header */}
            <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-border/40 dark:border-zinc-800 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent dark:from-primary/20 dark:via-primary/10 dark:to-transparent">
              <div className="flex items-center gap-3.5">
                <div className="relative">
                  <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center ring-2 ring-primary/20 shadow-sm bg-white/50 dark:bg-zinc-800/50">
                    <Bot className="w-5 h-5 text-primary" />
                  </div>
                  <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-emerald-500 border-[2.5px] border-background dark:border-zinc-900 rounded-full" />
                </div>
                <div className="min-w-0">
                  <p className="text-base font-bold text-foreground dark:text-zinc-50 leading-tight tracking-tight">PM Agents</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {session && wfData?.linkedProjectId ? (
                      <button
                        type="button"
                        onClick={() => router.push(`/projects/${wfData.linkedProjectId}`)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/10 text-primary hover:bg-primary/20 dark:bg-primary/20 dark:hover:bg-primary/30 transition-colors cursor-pointer shrink-0"
                        title="Xem dự án trong KFlow"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shrink-0" />
                        {session.projectName.length > 20 ? session.projectName.slice(0, 20) + "…" : session.projectName}
                      </button>
                    ) : contextProject ? (
                      <button
                        type="button"
                        onClick={() => router.push(`/projects/${contextProject._id}`)}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 dark:hover:bg-emerald-500/30 transition-colors cursor-pointer shrink-0"
                        title="Đang xem dự án"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                        {contextProject.name.length > 20 ? contextProject.name.slice(0, 20) + "..." : contextProject.name}
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-muted text-muted-foreground shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground shrink-0" />
                        General
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <NotificationBadge tasks={tasks} />
                {session && wfData?.linkedProjectId ? (
                  <button type="button" onClick={() => router.push(`/projects/${wfData.linkedProjectId}`)} className="w-8 h-8 rounded-full hover:bg-foreground/5 dark:hover:bg-white/10 flex items-center justify-center cursor-pointer text-muted-foreground hover:text-foreground dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors" title="Xem dự án trong KFlow">
                    <ExternalLink className="w-4 h-4" />
                  </button>
                ) : (
                  <button type="button" onClick={() => router.push("/pm-agent/chat")} className="w-8 h-8 rounded-full hover:bg-foreground/5 dark:hover:bg-white/10 flex items-center justify-center cursor-pointer text-muted-foreground hover:text-foreground dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors" title="Mở toàn màn hình">
                    <Maximize2 className="w-4 h-4" />
                  </button>
                )}
                <button type="button" onClick={() => setIsOpen(false)} className="w-8 h-8 rounded-full hover:bg-destructive/10 dark:hover:bg-red-500/20 flex items-center justify-center cursor-pointer text-muted-foreground hover:text-destructive dark:text-zinc-400 dark:hover:text-red-400 transition-colors ml-1" title="Đóng">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto bg-transparent scroll-smooth">
              <div className="px-2 py-2 space-y-1.5">
                {isLoadingMessages ? (
                  <div className="flex flex-col items-center justify-center h-full text-center py-12">
                    <div className="flex items-center gap-1.5 mb-4">
                      {[0, 1, 2].map((i) => (
                        <span key={i} className="w-2.5 h-2.5 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                      ))}
                    </div>
                    <p className="text-sm text-muted-foreground/60 font-medium">Đang tải lịch sử chat...</p>
                  </div>
                ) : allMessages.length === 0 && showSuggestions ? (
                  <div className="flex flex-col items-center justify-center h-full text-center pt-6 pb-2">
                    <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-primary/20 via-primary/10 to-purple-500/10 flex items-center justify-center mb-5 shadow-lg shadow-primary/5 ring-1 ring-primary/10 bg-white/50 dark:bg-zinc-800/50">
                      <Sparkles className="w-8 h-8 text-primary" />
                    </div>
                    <p className="text-xl font-bold text-foreground dark:text-zinc-50 tracking-tight mb-2">Chào bạn!</p>
                    <p className="text-sm text-muted-foreground dark:text-zinc-400 mb-8 max-w-[280px] leading-relaxed">
                      Tôi là <span className="font-semibold text-foreground dark:text-zinc-200">PM Agents</span>.<br />
                      Hãy chọn một trong các gợi ý dưới đây hoặc nhập yêu cầu của bạn:
                    </p>
                    <div className="grid grid-cols-2 gap-2.5 w-full max-w-[320px]">
                      {SUGGESTIONS.map((s) => (
                        <button
                          key={s.label}
                          type="button"
                          onClick={() => {
                            if (s.label === "Tạo dự án mới") {
                              setPendingMessages([]);
                              setCreateFlowStep("select_type");
                              setInput("");
                              return;
                            }
                            const inputMap: Record<string, string> = {
                              "Xem thông tin ticket": "Xem ticket ISD-90335",
                              "Đến dự án": "Đến dự án ISD-",
                              "Gửi email": "Gửi email đến quangkhoi1228@gmail.com với tiêu đề Test PM Agent và nội dung Xin chào",
                            };
                            setInput(inputMap[s.label] || s.label);
                            inputRef.current?.focus();
                          }}
                          className="flex flex-col items-start gap-2 px-3 py-3 rounded-2xl border border-border/40 dark:border-zinc-700/60 bg-card/50 dark:bg-zinc-800/60 hover:bg-card dark:hover:bg-zinc-800 hover:border-primary/40 transition-all duration-300 text-left cursor-pointer group shadow-sm hover:shadow-md hover:-translate-y-0.5"
                        >
                          <span className="text-lg bg-background dark:bg-zinc-900 rounded-xl p-2 shadow-sm border border-border/30 dark:border-zinc-700/50 group-hover:scale-110 group-hover:bg-primary/10 group-hover:text-primary transition-all duration-300">{s.icon}</span>
                          <p className="text-[12px] font-bold text-foreground/90 dark:text-zinc-100 group-hover:text-primary transition-colors leading-tight">{s.label}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {allMessages.map((msg, idx) => {
                      const isAgent = msg.role === "agent";
                      const msgStatus = "status" in msg ? (msg as any).status as MessageStatus : undefined;
                      const prev = allMessages[idx - 1];
                      const consecutive = prev && prev.role === msg.role;

                      return (
                        <div key={msg._id} className={`flex items-end gap-2.5 ${isAgent ? "" : "flex-row-reverse"}`}>
                          {!consecutive && (
                            <div className={`w-8 h-8 rounded-2xl flex items-center justify-center shrink-0 shadow-sm ring-1 bg-white/50 dark:bg-zinc-800/50 ${
                              isAgent
                                ? "bg-gradient-to-br from-primary/20 to-primary/5 ring-primary/20"
                                : "bg-gradient-to-br from-foreground/10 to-muted ring-border/50 dark:ring-zinc-700/50"
                            }`}>
                              {isAgent ? <Bot className="w-4 h-4 text-primary" /> : <User className="w-4 h-4 text-muted-foreground dark:text-zinc-400" />}
                            </div>
                          )}
                          {consecutive && <div className="w-8 shrink-0" />}
                          <div className={`max-w-[82%] min-w-0 px-3 py-2.5 text-[14px] leading-relaxed shadow-sm break-words overflow-hidden ${
                            isAgent
                              ? "bg-card dark:bg-zinc-800 border border-border/40 dark:border-zinc-700/60 rounded-[1.25rem] rounded-bl-md text-foreground/90 dark:text-zinc-100"
                              : "bg-gradient-to-tr from-primary to-primary/80 text-primary-foreground dark:text-white rounded-[1.25rem] rounded-br-md"
                          }`}>
                            {renderMessage(msg.content, isAgent)}
                            {isAgent && (() => {
                              const notifMeta = parseSuggestionNotification(msg.metadata);
                              if (!notifMeta) return null;
                              return <SuggestionNotificationCard meta={notifMeta} compact messageId={msg._id} onRefresh={mutateMessages} />;
                            })()}
                            <div className={`flex items-center gap-1.5 mt-1.5 ${isAgent ? "" : "flex-row-reverse"}`}>
                              <span className={`text-[10px] font-medium ${isAgent ? "text-muted-foreground/60 dark:text-zinc-400/80" : "text-primary-foreground/70 dark:text-white/70"}`}>
                                {formatTime(msg.createdAt)}
                              </span>
                              <StatusIcon status={msgStatus} isAgent={isAgent} />
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {processing && (
                      <div className="flex items-end gap-2.5">
                        <div className="w-8 h-8 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 ring-1 ring-primary/20 flex items-center justify-center shrink-0 shadow-sm">
                          <Bot className="w-4 h-4 text-primary" />
                        </div>
                        <div className="bg-card border border-border/40 rounded-[1.25rem] rounded-bl-md px-5 py-4 shadow-sm">
                          <div className="flex items-center gap-1.5">
                            {[0, 1, 2].map((i) => (
                              <span key={i} className="w-2 h-2 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                    <div ref={bottomRef} />
                  </div>
                )}
              </div>
            </div>

            {/* Input */}
            <div className="shrink-0 p-4 bg-background/90 dark:bg-zinc-900/90 backdrop-blur-md border-t border-border/40 dark:border-zinc-800">
              {pendingAction && (
                <div className="mb-3 p-3.5 rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50/80 dark:bg-amber-500/10 backdrop-blur-sm animate-in fade-in slide-in-from-bottom-4 duration-300">
                  <div className="flex items-start gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center shrink-0 mt-0.5">
                      <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-amber-800 dark:text-amber-300 mb-1">Xác nhận thao tác</p>
                      <p className="text-[12px] text-amber-700/80 dark:text-amber-400/80 leading-relaxed whitespace-pre-wrap">{popupActionDescription(pendingAction)}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2.5 mt-3">
                    <button type="button" onClick={cancelAction} className="px-4 py-1.5 rounded-full text-xs font-semibold cursor-pointer text-muted-foreground hover:text-foreground hover:bg-amber-100/50 dark:hover:bg-amber-500/10 transition-all">Hủy</button>
                    <button type="button" onClick={() => confirmAction(pendingAction)} disabled={processing} className="px-4 py-1.5 rounded-full text-xs font-semibold cursor-pointer bg-amber-600 hover:bg-amber-700 text-white dark:bg-amber-500 dark:hover:bg-amber-600 shadow-sm transition-all disabled:opacity-50 flex items-center gap-1.5">
                      {processing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      Xác nhận
                    </button>
                  </div>
                </div>
              )}

              {/* ─── Create flow type selector ──────────────────── */}
              {createFlowStep === "select_type" && (
                <div className="mb-3 animate-in fade-in slide-in-from-bottom-4 duration-300">
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setCreateFlowStep("enter_isd");
                        setPendingMessages((prev) => [...prev, {
                          tempId: nextTempId(), role: "agent",
                          content: "Vui lòng nhập **mã ticket ISD** hoặc **paste link ISD** để tạo dự án.\n\nVD: `ISD-90335` hoặc `https://servicedesk.fci.vn/browse/ISD-90335`",
                          status: "sent", createdAt: Date.now(),
                        }]);
                      }}
                      className="flex-1 px-3 py-2 rounded-xl border border-blue-200 dark:border-blue-500/30 bg-blue-50/80 dark:bg-blue-500/10 hover:bg-blue-100 dark:hover:bg-blue-500/20 cursor-pointer text-center transition-all text-[12px] font-semibold text-blue-700 dark:text-blue-300"
                    >
                      📋 Từ ticket ISD
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCreateFlowStep("enter_custom_name");
                        setPendingMessages((prev) => [...prev, {
                          tempId: nextTempId(), role: "agent",
                          content: "Vui lòng nhập **tên dự án** để tạo.",
                          status: "sent", createdAt: Date.now(),
                        }]);
                      }}
                      className="flex-1 px-3 py-2 rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/80 dark:bg-emerald-500/10 hover:bg-emerald-100 dark:hover:bg-emerald-500/20 cursor-pointer text-center transition-all text-[12px] font-semibold text-emerald-700 dark:text-emerald-300"
                    >
                      ✏️ Tuỳ chỉnh
                    </button>
                    <button
                      type="button"
                      onClick={() => { setCreateFlowStep("idle"); setCreateFlowProjectName(""); }}
                      className="px-2 py-2 rounded-xl hover:bg-foreground/5 dark:hover:bg-white/10 cursor-pointer transition-all text-muted-foreground text-[12px]"
                      title="Huỷ"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}
              <div className="flex items-end gap-2.5 bg-card dark:bg-zinc-800/80 border border-border/50 dark:border-zinc-700/60 rounded-3xl pl-4 pr-1.5 py-1.5 shadow-sm focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/10 transition-all duration-300">
                <TextareaAutosize
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    createFlowStep === "enter_isd"
                      ? "Nhập mã hoặc link ISD..."
                      : createFlowStep === "enter_custom_name"
                        ? "Nhập tên dự án..."
                        : "Hỏi PM Agents..."
                  }
                  disabled={processing || !!pendingAction}
                  minRows={1}
                  maxRows={6}
                  className="flex-1 py-2.5 text-sm bg-transparent border-none outline-none shadow-none focus-visible:ring-0 px-0 placeholder:text-muted-foreground/50 dark:placeholder:text-zinc-500 font-medium dark:text-zinc-100 resize-none"
                />
                {createFlowStep !== "idle" && (
                  <button
                    type="button"
                    onClick={() => {
                      setCreateFlowStep("idle");
                      setCreateFlowProjectName("");
                      setPendingMessages((prev) => [...prev, {
                        tempId: nextTempId(), role: "agent",
                        content: "Đã huỷ thao tác.",
                        status: "sent", createdAt: Date.now(),
                      }]);
                    }}
                    className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/5 dark:hover:bg-white/10 transition-colors shrink-0 cursor-pointer"
                    title="Huỷ"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!input.trim() || processing || !!pendingAction}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 shrink-0 ${
                    !input.trim() || processing || !!pendingAction
                      ? "bg-muted dark:bg-zinc-800 text-muted-foreground cursor-not-allowed shadow-none"
                      : "bg-primary hover:bg-primary/90 hover:-translate-y-0.5 text-primary-foreground cursor-pointer shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30"
                  }`}
                >
                  {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className={`w-4 h-4 ml-0.5 ${!input.trim() ? "opacity-50" : "opacity-100"}`} />}
                </button>
              </div>
            </div>
          </div>


        </div>
      </div>
  );
}
