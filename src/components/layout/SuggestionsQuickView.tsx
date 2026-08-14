"use client";

import { useState, useMemo, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useUnresolvedSuggestionsByUser, useSuggestionMutations, useTaskMutations } from "@/hooks/useDomain";
import {
  Sparkles, X, CheckCircle2,
  MessageSquare, AlertTriangle, Clock, Users, ArrowUpRight,
  BrainCircuit, Target, Quote, ChevronDown, Loader2,
  ListPlus, MessagesSquare
} from "lucide-react";
import { InteractiveChecklist } from "@/components/chat/InteractiveChecklist";
import { ChecklistItem } from "@/lib/checklistProgress";
import { keepNewestPendingPerTopic } from "@/lib/suggestionDedup";

interface SuggestionsQuickViewProps {
  isOpen: boolean;
  onClose: () => void;
}

const TYPE_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  transfer_request: {
    label: "Bàn giao",
    color: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-500/30",
    icon: <Users className="w-3 h-3" />,
  },
  mention: {
    label: "Đề cập",
    color: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-500/30",
    icon: <MessageSquare className="w-3 h-3" />,
  },
  action_item: {
    label: "Hành động",
    color: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-500/30",
    icon: <CheckCircle2 className="w-3 h-3" />,
  },
  deadline: {
    label: "Hạn chót",
    color: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-500/30",
    icon: <Clock className="w-3 h-3" />,
  },
  warning: {
    label: "Cảnh báo",
    color: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-500/30",
    icon: <AlertTriangle className="w-3 h-3" />,
  },
  info: {
    label: "Thông tin",
    color: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-500/30",
    icon: <Sparkles className="w-3 h-3" />,
  },
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string }> = {
  high: { label: "Ưu tiên cao", color: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-500/30" },
  medium: { label: "Ưu tiên TB", color: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-500/30" },
  low: { label: "Theo dõi", color: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-500/30" },
};

function getPriority(s: any): string | undefined {
  try {
    if (s.suggestionData) {
      const parsed = JSON.parse(s.suggestionData);
      if (parsed?.priority && PRIORITY_CONFIG[parsed.priority]) return parsed.priority;
    }
  } catch { /* ignore malformed data */ }
  return undefined;
}

function getReasonDetails(s: any): { input?: string; reasoning?: string; expectedOutcome?: string } {
  try {
    if (s.suggestionData) {
      const parsed = JSON.parse(s.suggestionData);
      return {
        input: parsed?.input,
        reasoning: parsed?.reasoning,
        expectedOutcome: parsed?.expectedOutcome,
      };
    }
  } catch { /* ignore malformed data */ }
  return {};
}

/** Lấy checklist hành động (các bước quy trình nghiệp vụ khớp) từ suggestionData. */
function getChecklist(s: any): Array<{ title: string; description?: string }> {
  try {
    if (s.suggestionData) {
      const parsed = JSON.parse(s.suggestionData);
      if (Array.isArray(parsed?.checklist)) return parsed.checklist;
    }
  } catch { /* ignore malformed data */ }
  return [];
}

/** Lấy thông tin email gửi sale + deep link Teams từ suggestionData (kickoff suggestion) */
function getEmailInfo(s: any): { saleEmail?: string; emailSubject?: string; emailBody?: string; teamsDeepLink?: string } {
  try {
    if (s.suggestionData) {
      const parsed = JSON.parse(s.suggestionData);
      return {
        saleEmail: parsed?.saleEmail,
        emailSubject: parsed?.emailSubject,
        emailBody: parsed?.emailBody,
        teamsDeepLink: parsed?.teamsDeepLink,
      };
    }
  } catch { /* ignore malformed data */ }
  return {};
}

/** Build deep link Teams với nội dung prefill */
function buildTeamsDeepLink(deepLink: string | undefined, text: string): string | undefined {
  if (!deepLink) return undefined;
  try {
    const base = new URL(deepLink);
    base.searchParams.set("message", text);
    return base.toString();
  } catch {
    return deepLink;
  }
}

/** Lấy groupAction từ suggestionData (vd: add_groups — cần thêm nhóm vào dự án) */
function getGroupAction(s: any): string | undefined {
  try {
    if (s.suggestionData) {
      const parsed = JSON.parse(s.suggestionData);
      if (parsed?.groupAction) return parsed.groupAction;
    }
  } catch { /* ignore malformed data */ }
  return undefined;
}
export function SuggestionsQuickView({ isOpen, onClose }: SuggestionsQuickViewProps) {
  const { userId } = useAuth();
  const router = useRouter();
  const smx = useSuggestionMutations();
  const tm = useTaskMutations();
  const [filter, setFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [addingTaskId, setAddingTaskId] = useState<string | null>(null);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [taskAddedId, setTaskAddedId] = useState<string | null>(null);

  // Thêm gợi ý vào tasklist của project
  const handleAddTask = useCallback(async (s: any) => {
    if (addingTaskId) return;
    setAddingTaskId(s._id);
    setTaskError(null);
    setTaskAddedId(null);
    try {
      const projectId = String((s as any).projectId || "");
      const priority = getPriority(s);
      await tm.createTask({
        userId,
        title: s.title,
        estimatedTime: 0,
        notes: s.description,
        project: projectId || undefined,
        status: "todo",
        priority: priority === "high" ? "high" : priority === "low" ? "low" : "normal",
      });
      setTaskAddedId(s._id);
    } catch (err) {
      console.error("Add task failed:", err);
      setTaskError("Lỗi khi thêm task: " + (err instanceof Error ? err.message : "unknown error"));
    } finally {
      setAddingTaskId(null);
    }
  }, [addingTaskId, tm, userId]);

  const { data: unresolvedSuggestionsData } = useUnresolvedSuggestionsByUser(userId);
  const unresolvedSuggestions = keepNewestPendingPerTopic(unresolvedSuggestionsData ?? []);

  const filteredSuggestions = useMemo(() => {
    if (filter === "all") return unresolvedSuggestions;
    return unresolvedSuggestions.filter((s) => s.type === filter);
  }, [unresolvedSuggestions, filter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: unresolvedSuggestions.length };
    for (const s of unresolvedSuggestions) {
      c[s.type] = (c[s.type] || 0) + 1;
    }
    return c;
  }, [unresolvedSuggestions]);

  if (!isOpen) return null;

  return (
    <div className="flex flex-col h-full bg-background/98 dark:bg-zinc-900/98 border-l border-border/50">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-border/40 dark:border-zinc-800 bg-gradient-to-r from-primary/5 to-transparent">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-500/5 flex items-center justify-center ring-2 ring-amber-500/20">
            <Sparkles className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <p className="text-sm font-bold text-foreground dark:text-zinc-100 leading-tight">Gợi ý hành động</p>
            <p className="text-[10px] text-muted-foreground dark:text-zinc-500">
              {unresolvedSuggestions.length} gợi ý chưa xử lý
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-7 h-7 rounded-lg hover:bg-destructive/10 dark:hover:bg-red-500/20 flex items-center justify-center cursor-pointer text-muted-foreground hover:text-destructive dark:text-zinc-400 dark:hover:text-red-400 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Filter tabs */}
      <div className="shrink-0 flex gap-1 px-3 py-2 overflow-x-auto border-b border-border/30">
        {[
          { key: "all", label: "Tất cả" },
          { key: "transfer_request", label: "Bàn giao" },
          { key: "mention", label: "Đề cập" },
          { key: "action_item", label: "Hành động" },
          { key: "deadline", label: "Hạn chót" },
          { key: "warning", label: "Cảnh báo" },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setFilter(tab.key)}
            className={`text-[10px] px-2.5 py-1 rounded-full border font-semibold transition-all cursor-pointer whitespace-nowrap ${
              filter === tab.key
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted/30 text-muted-foreground border-border/50 hover:bg-muted/50"
            }`}
          >
            {tab.label} {counts[tab.key] ? `(${counts[tab.key]})` : ""}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
        {filteredSuggestions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <CheckCircle2 className="w-10 h-10 text-emerald-500/30 mb-3" />
            <p className="text-xs font-medium text-muted-foreground/60">Không có gợi ý nào</p>
            <p className="text-[10px] text-muted-foreground/40 mt-1 max-w-[200px]">
              Agent sẽ tự động phân tích tin nhắn Teams và hiển thị gợi ý tại đây
            </p>
          </div>
        ) : (
          filteredSuggestions.map((s) => {
            const cfg = TYPE_CONFIG[s.type] || TYPE_CONFIG.info;
            return (
              <div
                key={s._id}
                className={`p-3 rounded-xl border transition-all cursor-pointer hover:shadow-sm ${
                  !s.isRead
                    ? "bg-primary/[0.03] border-primary/30"
                    : "bg-card/50 dark:bg-zinc-800/50 border-border/30 dark:border-zinc-700/50 hover:border-border/60"
                }`}
                onClick={() => {
                  if (!s.isRead) smx.markSuggestionAsRead(s._id);
                  // Toggle the reason detail instead of navigating away
                  setExpandedId(expandedId === s._id ? null : s._id);
                }}
              >
                <div className="flex items-start gap-2">
                  <div className={`mt-0.5 w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${cfg?.color || "bg-muted"}`}>
                    {cfg?.icon || <Sparkles className="w-3 h-3" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {s.type && (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${cfg?.color || "bg-muted text-muted-foreground"}`}>
                          {cfg?.label || s.type}
                        </span>
                      )}
                      {getPriority(s) && (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${PRIORITY_CONFIG[getPriority(s)!].color}`}>
                          {PRIORITY_CONFIG[getPriority(s)!].label}
                        </span>
                      )}
                      <span className="text-[11px] font-bold text-foreground dark:text-zinc-100 truncate flex-1">
                        {s.title}
                      </span>
                      {!s.isRead && (
                        <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground dark:text-zinc-400 mt-1 leading-relaxed line-clamp-3">
                      {s.description}
                    </p>
                    {/* Checklist hành động tương tác (từ steps quy trình nghiệp vụ khớp) */}
                    {getChecklist(s).length > 0 && (
                      <InteractiveChecklist
                        title={s.title}
                        items={getChecklist(s) as ChecklistItem[]}
                      />
                    )}
                    {(s.sourceSender || s.sourceChatName) && (
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        {s.sourceSender && (
                          <span className="text-[8px] text-muted-foreground/50 bg-muted/30 px-1.5 py-0.5 rounded">
                            {s.sourceSender}
                          </span>
                        )}
                        {s.sourceChatName && (
                          <span className="text-[8px] text-muted-foreground/50 bg-muted/30 px-1.5 py-0.5 rounded">
                            {s.sourceChatName}
                          </span>
                        )}
                      </div>
                    )}
                    {/* Reason details (input / reasoning / expected outcome) */}
                    {(() => {
                      const reason = getReasonDetails(s);
                      const hasReason = Boolean(reason.input || reason.reasoning || reason.expectedOutcome);
                      const expanded = expandedId === s._id;
                      return (
                        <div className="mt-1.5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedId(expanded ? null : s._id);
                            }}
                            className={`inline-flex items-center gap-1 text-[9px] px-2 py-0.5 rounded-md border transition-colors cursor-pointer ${
                              expanded
                                ? "bg-primary/10 text-primary border-primary/30"
                                : "bg-muted/30 text-muted-foreground border-border/40 hover:bg-muted/50 hover:text-foreground"
                            }`}
                          >
                            <BrainCircuit className="w-2.5 h-2.5" />
                            {expanded ? "Thu gọn" : "Xem nguyên nhân"}
                            <ChevronDown className={`w-2.5 h-2.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
                          </button>
                          {expanded && (
                            <div className="mt-1.5 space-y-1.5 rounded-lg border border-border/30 bg-background/60 dark:bg-zinc-900/60 p-2">
                              {reason.input && (
                                <div className="flex gap-1.5">
                                  <Quote className="w-3 h-3 text-blue-500 shrink-0 mt-0.5" />
                                  <div className="min-w-0">
                                    <p className="text-[8px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wide">Input</p>
                                    <p className="text-[10px] text-muted-foreground dark:text-zinc-400 leading-relaxed whitespace-pre-wrap">{reason.input}</p>
                                  </div>
                                </div>
                              )}
                              {reason.reasoning && (
                                <div className="flex gap-1.5">
                                  <BrainCircuit className="w-3 h-3 text-purple-500 shrink-0 mt-0.5" />
                                  <div className="min-w-0">
                                    <p className="text-[8px] font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wide">Suy luận</p>
                                    <p className="text-[10px] text-muted-foreground dark:text-zinc-400 leading-relaxed whitespace-pre-wrap">{reason.reasoning}</p>
                                  </div>
                                </div>
                              )}
                              {reason.expectedOutcome && (
                                <div className="flex gap-1.5">
                                  <Target className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />
                                  <div className="min-w-0">
                                    <p className="text-[8px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">Kết quả mong muốn</p>
                                    <p className="text-[10px] text-muted-foreground dark:text-zinc-400 leading-relaxed whitespace-pre-wrap">{reason.expectedOutcome}</p>
                                  </div>
                                </div>
                              )}
                              {!hasReason && s.sourceMessage && (
                                <div className="flex gap-1.5">
                                  <Quote className="w-3 h-3 text-blue-500 shrink-0 mt-0.5" />
                                  <div className="min-w-0">
                                    <p className="text-[8px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wide">Tin nhắn gốc</p>
                                    <p className="text-[10px] text-muted-foreground dark:text-zinc-400 leading-relaxed whitespace-pre-wrap">{s.sourceMessage}</p>
                                  </div>
                                </div>
                              )}
                              {!hasReason && !s.sourceMessage && (
                                <div className="flex gap-1.5">
                                  <Quote className="w-3 h-3 text-blue-500 shrink-0 mt-0.5" />
                                  <div className="min-w-0">
                                    <p className="text-[8px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wide">Nguyên nhân</p>
                                    <p className="text-[10px] text-muted-foreground dark:text-zinc-400 leading-relaxed whitespace-pre-wrap">{s.description}</p>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    <div className="flex items-center gap-1.5 mt-2">
                      {/* Gửi tin nhắn qua Teams — mở deep link chat 1:1 với Sale, tin nhắn điền sẵn */}
                      {(() => {
                        const emailInfo = getEmailInfo(s);
                        if (!emailInfo.teamsDeepLink) return null;
                        return (
                          <a
                            href={buildTeamsDeepLink(emailInfo.teamsDeepLink, s.description)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-[9px] px-2 py-0.5 rounded-md bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-500/30 hover:bg-sky-500/20 transition-colors cursor-pointer inline-flex items-center gap-1"
                            title={`Mở chat Teams với Sale: ${emailInfo.saleEmail || ""} — tin nhắn được điền sẵn`}
                          >
                            <><MessagesSquare className="w-2.5 h-2.5" /> Gửi tin nhắn qua Teams</>
                          </a>
                        );
                      })()}
                      {!s.isResolved && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            smx.markSuggestionAsResolved(s._id);
                          }}
                          className="text-[9px] px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30 hover:bg-emerald-500/20 transition-colors cursor-pointer"
                        >
                          Đã xử lý
                        </button>
                      )}
                      {/* Thêm nhóm nội bộ & khách hàng — chuyển sang panel quản lý nhóm của dự án */}
                      {getGroupAction(s) === "add_groups" && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if ((s as any).projectId) {
                              router.push(`/projects/${(s as any).projectId}?tab=chats&addGroup=1`);
                            }
                          }}
                          className="text-[9px] px-2 py-0.5 rounded-md bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-200 dark:border-orange-500/30 hover:bg-orange-500/20 transition-colors cursor-pointer inline-flex items-center gap-1"
                          title="Chuyển tới panel quản lý nhóm của dự án để thêm nhóm nội bộ và nhóm khách hàng"
                        >
                          <><Users className="w-2.5 h-2.5" /> Thêm nhóm vào dự án</>
                        </button>
                      )}
                      {/* Thêm vào tasklist */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddTask(s);
                        }}
                        disabled={addingTaskId !== null}
                        className="text-[9px] px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30 hover:bg-indigo-500/20 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
                        title="Thêm gợi ý này vào danh sách công việc"
                      >
                        {addingTaskId === s._id ? (
                          <><Loader2 className="w-2.5 h-2.5 animate-spin" /> Đang thêm...</>
                        ) : taskAddedId === s._id ? (
                          <><CheckCircle2 className="w-2.5 h-2.5" /> Đã thêm task</>
                        ) : (
                          <><ListPlus className="w-2.5 h-2.5" /> Thêm task</>
                        )}
                      </button>
                      <span className="text-[8px] text-muted-foreground/40 flex items-center gap-0.5 ml-auto">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if ((s as any).projectId) {
                              router.push(`/projects/${(s as any).projectId}`);
                            }
                          }}
                          className="flex items-center gap-0.5 hover:text-foreground transition-colors cursor-pointer"
                        >
                          Xem dự án <ArrowUpRight className="w-2.5 h-2.5" />
                        </button>
                      </span>
                    </div>
                    {taskError && (
                      <p className={`text-[9px] mt-1.5 flex items-center gap-1 text-red-600 dark:text-red-400`}>
                        <AlertTriangle className="w-2.5 h-2.5" />
                        {taskError}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
