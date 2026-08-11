"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import {
  Loader2, Send, Bot, User, ArrowLeft, Briefcase,
  Sparkles, Clock, CheckCheck, MoreHorizontal,
  AlertTriangle, Check, X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import TextareaAutosize from "react-textarea-autosize";
import { usePmMessages, usePmSessionById, usePmMutations, useProjects, useSuggestionMutations } from "@/hooks/useDomain";
import { analyzeWithLLM } from "../../../../../agents/pm/lib/llm-client";
import type { LLMAction } from "../../../../../agents/pm/lib/llm-client";

interface PendingAction {
  text: string;
  action: LLMAction;
  ticketId: string | null;
  reply: string;
}

const ISD_ENDPOINT = process.env.NEXT_PUBLIC_ISD_ENDPOINT || "https://servicedesk.fci.vn/rest";
const ISD_TOKEN = process.env.NEXT_PUBLIC_ISD_TOKEN || "";

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

function formatTime(ts: number) {
  const d = new Date(ts);
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

function formatDate(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return "Hom nay";
  if (d.toDateString() === yesterday.toDateString()) return "Hom qua";
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

function shouldShowDateSeparator(curr: number, prev?: number): boolean {
  if (!prev) return true;
  const d1 = new Date(curr).toDateString();
  const d2 = new Date(prev).toDateString();
  return d1 !== d2;
}

export default function PMAgentChatPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { userId } = useAuth();

  const existingSessionId = searchParams.get("session");

  const [sessionId, setSessionId] = useState<string | null>(existingSessionId);
  const [input, setInput] = useState("");
  const [processing, setProcessing] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [temporaryMsg, setShowTemporaryMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { data: messages } = usePmMessages(sessionId ?? undefined);
  const { data: session } = usePmSessionById(sessionId ?? undefined);
  const pmx = usePmMutations();
  const smx = useSuggestionMutations();

  // ─── Auto-detect current project context from URL ─────
  const pathname = usePathname();
  const { data: allProjects } = useProjects(userId, { includeArchived: true, includeTrashed: false });
  const contextProjectId = pathname?.match(/^\/projects\/([^/]+)/)?.[1] ?? null;
  const contextProject = contextProjectId && allProjects
    ? allProjects.find((p) => p._id === contextProjectId)
    : null;

  // Show context project badge in header
  const showContextBadge = contextProject && !session;

  // Auto scroll to bottom when new messages arrive
  useEffect(() => {
    const timer = setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);
    return () => clearTimeout(timer);
  }, [messages]);

  // Focus input on session load
  useEffect(() => {
    if (sessionId) inputRef.current?.focus();
  }, [sessionId]);

  // Show typing indicator while processing
  useEffect(() => {
    if (processing) {
      setIsTyping(true);
      const timer = setTimeout(() => setIsTyping(false), 800);
      return () => clearTimeout(timer);
    }
  }, [processing]);

  const chatHistory = (messages ?? []).map((m) => ({
    role: m.role as "user" | "agent" | "system",
    content: m.content,
  }));

  // ─── Action detection (returns PendingAction for high-impact actions) ──

  const detectAction = useCallback(async (text: string): Promise<PendingAction | null> => {
    const llmResult = await analyzeWithLLM(text, [...chatHistory.slice(-6)], contextProject);
    const { action, ticketId, reply } = llmResult;

    // ── Auto-handle actions that match the current context ──────
    if (action === "view_project" && contextProject) {
      return { text, action: "goto_project", ticketId, reply };
    }

    // Only require confirmation for high-impact actions
    const needsConfirmation: LLMAction[] = [
      "create_project", "lookup_ticket",
      "add_personnel", "create_meeting", "update_sow",
    ];
    if (needsConfirmation.includes(action)) {
      return { text, action, ticketId, reply };
    }

    // For "chat" action, execute immediately
    if (!sessionId) {
      setShowTemporaryMessage(reply || `Tôi tìm thấy ticket **${ticketId}**. Bạn muốn tạo dự án mới không?`);
    } else {
      await pmx.addMessage({ sessionId, role: "user", content: text });
      await pmx.addMessage({ sessionId, role: "agent", content: reply || `Tôi đã nhận: "${text}". Bạn muốn làm gì tiếp?` });
    }
    return null;
  }, [sessionId, chatHistory, pmx, contextProject]);

  // ─── Execute confirmed action ──────────────────────────

  const executeAction = useCallback(async (pa: PendingAction) => {
    const { action, ticketId, text } = pa;
    setPendingAction(null);

    // ── Use context project to auto-bind actions ──────────────
    const effectiveProject = contextProject || null;

    // goto_project shortcut: if already viewing the context project
    if (action === "goto_project" && contextProject) {
      return { message: `Bạn đang xem dự án **${contextProject.name}**. Tôi có thể giúp gì cho dự án này?` };
    }

    if (!sessionId && action === "create_project" && ticketId) {
      let result;
      let isdData: any;
      try {
        isdData = await fetchISDData(ticketId);
        result = await pmx.createProjectFromTicket({
          userId: userId!,
          ticketId,
          isdData: JSON.stringify(isdData),
        });
      } catch (err) {
        return { message: `Lỗi khi tạo dự án từ ticket **#${ticketId}**: ${err instanceof Error ? err.message : "Lỗi không xác định"}. Vui lòng thử lại.` };
      }
      if (result.duplicate) {
        setSessionId(result.sessionId);
        return { redirect: true, sessionId: result.sessionId, message: `Ticket **#${ticketId}** đã được tạo từ trước. Đang mở lại phiên cũ...` };
      }
      // Fire-and-forget: generate suggestions
      if (result.projectId && isdData) {
        fetch("/api/agents/generate-project-suggestions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticketId, isdData }),
        })
          .then((r) => r.json())
          .then((suggestionResult) => {
            if (suggestionResult.ok && Array.isArray(suggestionResult.suggestions) && suggestionResult.suggestions.length > 0) {
              smx.addSuggestionsBatch({
                projectId: result.projectId,
                userId: userId!,
                suggestions: suggestionResult.suggestions.map((s: any) => ({
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
            }
          })
          .catch((err) => console.warn("[executeAction] generateSuggestions error:", err));
      }
      return { redirect: true, sessionId: result.sessionId };
    }

    if (!sessionId) {
      if (contextProject && action !== "create_project") {
        return { message: `Bạn đang xem dự án **${contextProject.name}**. Tôi có thể giúp gì cho dự án này?` };
      }
      return { message: `Tôi tìm thấy ticket **${ticketId}**. Bạn muốn tạo dự án mới không?` };
    }

    await pmx.addMessage({ sessionId, role: "user", content: text });

    if (action === "lookup_ticket") {
      const ticketToLookup = ticketId || session?.ticketId;
      if (!ticketToLookup) {
        await pmx.addMessage({ sessionId, role: "agent", content: "Không có ticket nào để tra cứu." });
        return {};
      }
      try {
        const res = await fetch(`${ISD_ENDPOINT.replace(/\/$/, "")}/api/2/issue/${ticketToLookup}`, {
          headers: { Authorization: `Bearer ${ISD_TOKEN}`, Accept: "application/json" },
        });
        if (res.ok) {
          const data = await res.json();
          const f = data.fields || {};
          await pmx.addMessage({
            sessionId, role: "agent",
            content: `Thông tin ticket **#${data.key}**:\n\nTiêu đề: ${f.summary || "N/A"}\nTrạng thái: ${f.status?.name || "N/A"}\nPriority: ${f.priority?.name || "N/A"}\nAssignee: ${f.assignee?.displayName || "Chưa có"}\nReporter: ${f.reporter?.displayName || "N/A"}`,
          });
        } else {
          await pmx.addMessage({ sessionId, role: "agent", content: `Không thể lấy thông tin ticket **#${ticketToLookup}** từ ISD.` });
        }
      } catch {
        await pmx.addMessage({ sessionId, role: "agent", content: "Lỗi kết nối đến ISD." });
      }
      return {};
    }

    if (action === "view_project") {
      try {
        const wf = JSON.parse(session?.workflowData || "{}");
        if (wf.linkedProjectId) { router.push(`/projects/${wf.linkedProjectId}`); return {}; }
      } catch {}
      await pmx.addMessage({ sessionId, role: "agent", content: `Dự án **${session?.projectName}** (Ticket #${session?.ticketId}) đang được quản lý.` });
      return {};
    }

    // For other actions (add_personnel, create_meeting, update_sow) — respond with instructions
    await pmx.addMessage({
      sessionId, role: "agent",
      content: pa.reply || `Tôi đã nhận: "${text}". Tôi có thể giúp bạn tiếp với dự án **${session?.projectName}**. Bạn muốn làm gì?`,
    });
    return {};
  }, [sessionId, userId, session, pmx, smx, router, contextProject]);

  const cancelAction = useCallback(() => {
    setPendingAction(null);
  }, []);

  const confirmAction = useCallback(async (pa: PendingAction) => {
    setProcessing(true);
    try {
      const result = await executeAction(pa);
      if (result && 'redirect' in result && result.redirect && result.sessionId) {
        setSessionId(result.sessionId);
        if (result.message) setShowTemporaryMessage(result.message);
        router.replace(`/pm-agent/chat?session=${result.sessionId}`, { scroll: false });
      } else if (result && 'message' in result && result.message && !sessionId) {
        setShowTemporaryMessage(result.message);
      }
    } catch (err) {
      console.error("Error:", err);
      if (sessionId) {
        await pmx.addMessage({ sessionId, role: "agent", content: `Xin lỗi, đã có lỗi: ${err instanceof Error ? err.message : "Lỗi không xác định"}.` });
      } else {
        setShowTemporaryMessage(`Xin lỗi, đã có lỗi: ${err instanceof Error ? err.message : "Lỗi không xác định"}`);
      }
    } finally {
      setProcessing(false);
    }
  }, [sessionId, pmx, executeAction, router]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || processing || !userId) return;
    setInput("");
    setProcessing(true);

    try {
      const pa = await detectAction(text);
      if (pa) {
        // Show confirmation UI instead of executing immediately
        setPendingAction(pa);
        setProcessing(false);
        return;
      }
      // For "chat" actions, detectAction already handled the message
      setProcessing(false);
    } catch (err) {
      console.error("Error:", err);
      if (sessionId) {
        await pmx.addMessage({ sessionId, role: "agent", content: `Xin lỗi, đã có lỗi: ${err instanceof Error ? err.message : "Lỗi không xác định"}.` });
      } else {
        setShowTemporaryMessage(`Xin lỗi, đã có lỗi: ${err instanceof Error ? err.message : "Lỗi không xác định"}`);
      }
      setProcessing(false);
    }
  }, [input, processing, userId, sessionId, pmx, detectAction]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const displayMessages = messages ?? [];
  const isNewSession = !sessionId;

  return (
    <div className="h-full flex flex-col bg-gradient-to-b from-background via-background to-primary/[0.02]">
      {/* ─── Header ──────────────────────────────────── */}
      <header className="shrink-0 border-b border-border/40 dark:border-zinc-800 bg-background/80 dark:bg-zinc-900/90 backdrop-blur-2xl supports-[backdrop-filter]:bg-background/60 sticky top-0 z-10">
        <div className="flex items-center justify-between px-6 h-16 max-w-5xl mx-auto w-full">
          <div className="flex items-center gap-4 min-w-0">
            <Link href="/pm-agent">
              <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full cursor-pointer hover:bg-foreground/5 dark:hover:bg-white/10 text-muted-foreground dark:text-zinc-400 hover:text-foreground dark:hover:text-zinc-100 transition-colors">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <div className="relative">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center ring-2 ring-primary/20 shadow-sm bg-white/50 dark:bg-zinc-800/50">
                <Bot className="w-5 h-5 text-primary" />
              </div>
              <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-emerald-500 border-[2.5px] border-background dark:border-zinc-900 rounded-full" />
            </div>
            <div className="min-w-0">
              <p className="text-base font-bold text-foreground dark:text-zinc-50 truncate tracking-tight">
                {session?.projectName || "PM Agent"}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                {session ? (
                  <p className="text-xs font-medium text-muted-foreground/80 dark:text-zinc-400 flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                      #{session.ticketId}
                    </span>
                    <span className="text-muted-foreground/30">&middot;</span>
                    <span>{displayMessages.length} tin nhắn</span>
                  </p>
                ) : showContextBadge && contextProject ? (
                  <button
                    type="button"
                    onClick={() => router.push(`/projects/${contextProject._id}`)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 dark:hover:bg-emerald-500/30 transition-colors cursor-pointer shrink-0"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
                    Đang xem: {contextProject.name.length > 20 ? contextProject.name.slice(0, 20) + "..." : contextProject.name}
                  </button>
                ) : (
                  <p className="text-[11px] font-medium text-muted-foreground/80 mt-0.5">Trợ lý quản lý dự án thông minh</p>
                )}
              </div>
            </div>
          </div>

          {session && (
            <Button
              variant="outline" size="sm"
              onClick={() => {
                try {
                  const wf = JSON.parse(session.workflowData || "{}");
                  if (wf.linkedProjectId) router.push(`/projects/${wf.linkedProjectId}`);
                } catch {}
              }}
              className="h-9 px-4 text-xs font-semibold rounded-full cursor-pointer border-border/60 hover:bg-primary/5 hover:border-primary/40 gap-2 shadow-sm hover:shadow-md transition-all duration-300 hover:-translate-y-0.5"
            >
              <Briefcase className="w-4 h-4" /> Mở dự án
            </Button>
          )}
        </div>
      </header>

      {/* ─── Messages Area ─────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto scroll-smooth">
        <div className="px-6 py-6 max-w-5xl mx-auto space-y-4">
          {isNewSession && !temporaryMsg && (
            <div className="py-12 px-4 animate-in fade-in slide-in-from-bottom-8 duration-700">
              {/* Welcome Card */}
              <div className="max-w-2xl mx-auto text-center mb-10">
                <div className="w-20 h-20 rounded-[2rem] bg-gradient-to-br from-primary/20 via-primary/10 to-purple-500/10 flex items-center justify-center mx-auto mb-6 shadow-xl shadow-primary/5 ring-1 ring-primary/20 bg-white/50 dark:bg-zinc-800/50">
                  <Sparkles className="w-10 h-10 text-primary" />
                </div>
                <h2 className="text-3xl font-bold text-foreground dark:text-zinc-50 mb-3 tracking-tight">Chào bạn!</h2>
                <p className="text-base text-muted-foreground/80 dark:text-zinc-400 max-w-md mx-auto leading-relaxed">
                  Tôi là <span className="font-semibold text-foreground dark:text-zinc-200">PM Agent</span> - trợ lý quản lý dự án thông minh.
                  Hãy chọn một thao tác dưới đây để bắt đầu.
                </p>
              </div>

              {/* Quick suggestions */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
                {[
                  { label: "Tạo dự án mới", icon: "🚀", desc: "Từ ticket ISD" },
                  { label: "Xem thông tin ticket", icon: "🎫", desc: "Tra cứu nhanh" },
                  { label: "Thêm nhân sự", icon: "👥", desc: "Phân công nguồn lực" },
                  { label: "Tạo meeting kickoff", icon: "📅", desc: "Lịch họp dự án" },
                ].map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => {
                      setInput(s.label === "Tạo dự án mới" ? "Tạo dự án mới từ ticket ISD-90335" : s.label);
                      inputRef.current?.focus();
                    }}
                    className="flex items-center gap-4 p-5 rounded-2xl border border-border/40 dark:border-zinc-700/60 bg-card/50 dark:bg-zinc-800/60 backdrop-blur-sm hover:bg-card dark:hover:bg-zinc-800 hover:border-primary/40 transition-all duration-300 cursor-pointer text-left group hover:-translate-y-1"
                  >
                    <span className="text-2xl bg-background dark:bg-zinc-900 rounded-xl p-2.5 shadow-sm border border-border/30 dark:border-zinc-700/50 group-hover:scale-110 transition-transform duration-300">{s.icon}</span>
                    <div>
                      <p className="text-sm font-bold text-foreground/90 dark:text-zinc-100 group-hover:text-primary transition-colors">{s.label}</p>
                      <p className="text-xs text-muted-foreground/70 dark:text-zinc-400 font-medium mt-0.5">{s.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {isNewSession && temporaryMsg && (
            <div className="flex items-start gap-3.5 px-2 py-3 animate-in fade-in zoom-in-95 duration-300">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center ring-2 ring-primary/20 shrink-0 shadow-sm">
                <Bot className="w-5 h-5 text-primary" />
              </div>
              <div className="bg-card rounded-[1.25rem] rounded-tl-md border border-border/40 px-5 py-4 shadow-sm max-w-[85%]">
                <p className="text-[11px] font-bold text-primary mb-1.5 uppercase tracking-wider">PM Agent</p>
                <p className="text-[15px] text-foreground/90 leading-relaxed whitespace-pre-wrap">
                  {renderMessage(temporaryMsg, true)}
                </p>
              </div>
            </div>
          )}

          {displayMessages.map((msg, idx) => {
            const prev = displayMessages[idx - 1];
            const showDate = shouldShowDateSeparator(msg.createdAt, prev?.createdAt);
            const isAgent = msg.role === "agent";
            const consecutive = prev && prev.role === msg.role &&
              !shouldShowDateSeparator(msg.createdAt, prev.createdAt);

            return (
              <div key={msg._id}>
                {showDate && (
                  <div className="flex items-center justify-center py-3">
                    <div className="bg-muted/60 backdrop-blur-sm border border-border/30 px-3 py-1 rounded-full">
                      <span className="text-[10px] font-medium text-muted-foreground/70">
                        {formatDate(msg.createdAt)}
                      </span>
                    </div>
                  </div>
                )}

                <div className={`flex items-end gap-3.5 px-2 py-1.5 ${isAgent ? "" : "flex-row-reverse"} animate-in fade-in zoom-in-95 duration-300`}>
                  {!consecutive && (
                    <div className={`w-9 h-9 rounded-2xl flex items-center justify-center shrink-0 shadow-sm ring-1 bg-white/50 dark:bg-zinc-800/50 ${
                      isAgent
                        ? "bg-gradient-to-br from-primary/20 to-primary/5 ring-primary/20"
                        : "bg-gradient-to-br from-foreground/10 to-muted ring-border/50 dark:ring-zinc-700/50"
                    }`}>
                      {isAgent
                        ? <Bot className="w-5 h-5 text-primary" />
                        : <User className="w-4 h-4 text-muted-foreground dark:text-zinc-400" />
                      }
                    </div>
                  )}
                  {consecutive && <div className="w-9 shrink-0" />}

                  <div className={`max-w-[78%] min-w-0 ${isAgent ? "" : "flex flex-col items-end"}`}>
                    {!consecutive && (
                      <p className={`text-[11px] font-bold mb-1.5 uppercase tracking-wider ${isAgent ? "text-primary" : "text-muted-foreground/80 dark:text-zinc-400"}`}>
                        {isAgent ? "PM Agent" : "Bạn"}
                      </p>
                    )}
                    <div className={`px-5 py-3.5 shadow-sm ${
                      isAgent
                        ? "bg-card dark:bg-zinc-800 border border-border/40 dark:border-zinc-700/60 rounded-[1.25rem] rounded-bl-md"
                        : "bg-gradient-to-tr from-primary to-primary/80 text-primary-foreground dark:text-white rounded-[1.25rem] rounded-br-md"
                    }`}>
                      <p className={`text-[15px] leading-relaxed whitespace-pre-wrap ${
                        isAgent ? "text-foreground/90 dark:text-zinc-100" : "text-primary-foreground/95 dark:text-white/95"
                      }`}>
                        {renderMessage(msg.content, isAgent)}
                      </p>
                    </div>
                    <div className={`flex items-center gap-2 mt-1.5 ${isAgent ? "" : "flex-row-reverse"}`}>
                      <span className={`text-[10px] font-medium ${isAgent ? "text-muted-foreground/60 dark:text-zinc-400/80" : "text-muted-foreground/80 dark:text-zinc-400/80"}`}>{formatTime(msg.createdAt)}</span>
                      {!isAgent && <CheckCheck className="w-3.5 h-3.5 text-muted-foreground/60 dark:text-zinc-500" />}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Typing indicator */}
          {processing && isTyping && (
            <div className="flex items-end gap-3.5 px-2 py-2 animate-in fade-in slide-in-from-bottom-4 duration-300">
              <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 ring-1 ring-primary/20 flex items-center justify-center shrink-0 shadow-sm">
                <Bot className="w-5 h-5 text-primary" />
              </div>
              <div className="bg-card rounded-[1.25rem] rounded-bl-md border border-border/40 px-5 py-4 shadow-sm">
                <div className="flex items-center gap-2">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="w-2.5 h-2.5 rounded-full bg-primary/40 animate-bounce"
                      style={{ animationDelay: `${i * 0.15}s` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* ─── Input Area ───────────────────────────────── */}
      <div className="shrink-0 border-t border-border/40 dark:border-zinc-800 bg-background/80 dark:bg-zinc-900/90 backdrop-blur-2xl supports-[backdrop-filter]:bg-background/60 z-10 pb-safe">
        <div className="px-6 py-4 max-w-5xl mx-auto w-full">
          {/* Confirmation bar */}
          {pendingAction && (
            <div className="mb-3 p-4 rounded-2xl border border-amber-200 dark:border-amber-500/30 bg-amber-50/80 dark:bg-amber-500/10 backdrop-blur-sm animate-in fade-in slide-in-from-bottom-4 duration-300">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-full bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center shrink-0 mt-0.5">
                  <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-amber-800 dark:text-amber-300 mb-1">Xác nhận thao tác</p>
                  <p className="text-[13px] text-amber-700/80 dark:text-amber-400/80 leading-relaxed">
                    {renderActionDescription(pendingAction)}
                  </p>
                </div>
              </div>
              <div className="flex items-center justify-end gap-3 mt-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={cancelAction}
                  className="h-9 px-5 rounded-full text-sm font-semibold cursor-pointer text-muted-foreground hover:text-foreground hover:bg-amber-100/50 dark:hover:bg-amber-500/10 transition-all"
                >
                  <X className="w-4 h-4 mr-1.5" /> Hủy
                </Button>
                <Button
                  size="sm"
                  onClick={() => confirmAction(pendingAction)}
                  disabled={processing}
                  className="h-9 px-5 rounded-full text-sm font-semibold cursor-pointer bg-amber-600 hover:bg-amber-700 text-white dark:bg-amber-500 dark:hover:bg-amber-600 shadow-md shadow-amber-600/20 dark:shadow-amber-500/20 transition-all disabled:opacity-50"
                >
                  {processing
                    ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                    : <Check className="w-4 h-4 mr-1.5" />
                  }
                  Xác nhận
                </Button>
              </div>
            </div>
          )}

          <div className="flex items-end gap-3 bg-card dark:bg-zinc-800/80 border border-border/50 dark:border-zinc-700/60 rounded-3xl pl-5 pr-2 py-2 shadow-sm focus-within:border-primary/50 focus-within:shadow-md focus-within:ring-4 focus-within:ring-primary/10 transition-all duration-300">
            <TextareaAutosize
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={sessionId ? "Nhập tin nhắn..." : "VD: Tạo dự án mới từ ticket ISD-90335"}
              disabled={processing || !!pendingAction}
              minRows={1}
              maxRows={6}
              className="flex-1 py-3 text-[15px] bg-transparent border-none outline-none shadow-none focus-visible:ring-0 px-0 placeholder:text-muted-foreground/50 dark:placeholder:text-zinc-500 font-medium dark:text-zinc-100 resize-none"
            />
            <Button
              size="icon"
              onClick={handleSend}
              disabled={!input.trim() || processing || !!pendingAction}
              className="h-12 w-12 rounded-full cursor-pointer shrink-0 bg-primary hover:bg-primary/90 transition-all duration-300 disabled:opacity-40 shadow-md shadow-primary/20 hover:shadow-lg hover:shadow-primary/30 hover:-translate-y-0.5"
            >
              {processing
                ? <Loader2 className="w-5 h-5 animate-spin text-primary-foreground dark:text-white" />
                : <Send className="w-5 h-5 text-primary-foreground dark:text-white ml-0.5" />
              }
            </Button>
          </div>
          <p className="text-[11px] font-medium text-muted-foreground/50 dark:text-zinc-500 text-center mt-3 tracking-wide">
            PM Agent có thể phạm sai lầm. Hãy kiểm tra lại thông tin quan trọng.
          </p>
        </div>
      </div>
    </div>
  );
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

const ACTION_LABELS: Record<string, string> = {
  create_project: "Tạo dự án mới từ ticket",
  lookup_ticket: "Tra cứu thông tin ticket",
  view_project: "Xem dự án",
  add_personnel: "Thêm nhân sự",
  create_meeting: "Tạo meeting kickoff",
  update_sow: "Cập nhật SOW",
};

function renderActionDescription(pa: PendingAction): string {
  const label = ACTION_LABELS[pa.action] || pa.action;
  if (pa.ticketId) {
    return `Bạn sắp thực hiện: **${label}** #${pa.ticketId}.`;
  }
  return `Bạn sắp thực hiện: **${label}**.`;
}
