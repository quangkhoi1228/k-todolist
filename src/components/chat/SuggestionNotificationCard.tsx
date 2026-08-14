"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTaskMutations } from "@/hooks/useDomain";
import { InteractiveChecklist } from "@/components/chat/InteractiveChecklist";
import { ChecklistItem } from "@/lib/checklistProgress";
import {
  Sparkles, ChevronDown, BrainCircuit, Quote, Target,
  CheckCircle2, XCircle, Loader2, ListPlus,
  MessageSquare, AlertTriangle, Clock, Users, ArrowUpRight,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────
export interface SuggestionItem {
  title: string;
  description: string;
  type: string;
  confidence: string;
  priority: string;
  sourceSender?: string | null;
  sourceChatName?: string | null;
  sourceMessage?: string | null;
  actionLabel?: string | null;
  input?: string | null;
  reasoning?: string | null;
  expectedOutcome?: string | null;
  checklist?: Array<{
    title: string;
    description?: string;
    targetGroup?: string;
    messageContent?: string;
    execStatus?: "pending" | "running" | "done" | "failed";
    execError?: string;
  }> | null;
}

export interface SuggestionNotificationMeta {
  action: "suggestion_notification";
  projectId: string;
  projectName?: string;
  suggestionCount: number;
  suggestions: SuggestionItem[];
}

interface Props {
  meta: SuggestionNotificationMeta;
  compact?: boolean;
  messageId?: string;
  /** Trigger re-fetch messages (SWR mutate) — dùng để reload metadata sau khi execute checklist */
  onRefresh?: () => void;
}

// ─── Config ─────────────────────────────────────────────────
const TYPE_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  transfer_request: { label: "Bàn giao", color: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-500/30", icon: <Users className="w-3 h-3" /> },
  mention: { label: "Đề cập", color: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-500/30", icon: <MessageSquare className="w-3 h-3" /> },
  action_item: { label: "Hành động", color: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-500/30", icon: <CheckCircle2 className="w-3 h-3" /> },
  deadline: { label: "Hạn chót", color: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-500/30", icon: <Clock className="w-3 h-3" /> },
  warning: { label: "Cảnh báo", color: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-500/30", icon: <AlertTriangle className="w-3 h-3" /> },
  info: { label: "Thông tin", color: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-500/30", icon: <Sparkles className="w-3 h-3" /> },
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string }> = {
  high: { label: "Ưu tiên cao", color: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-500/30" },
  medium: { label: "Ưu tiên TB", color: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-500/30" },
  low: { label: "Theo dõi", color: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-500/30" },
};

const CONF_ICON: Record<string, string> = { high: "🔴", medium: "🟡", low: "🟢" };

// ─── Helper: parse metadata from message ────────────────────
export function parseSuggestionNotification(metadata: string | undefined): SuggestionNotificationMeta | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata);
    if (parsed?.action === "suggestion_notification" && Array.isArray(parsed.suggestions)) {
      return parsed as SuggestionNotificationMeta;
    }
  } catch { /* ignore */ }
  return null;
}

// ════════════════════════════════════════════════════════════
// Single suggestion row — checklist item with reasoning + actions
// ════════════════════════════════════════════════════════════
function SuggestionRow({
  s,
  index,
  compact,
  messageId,
  projectId,
  onRefresh,
}: {
  s: SuggestionItem;
  index: number;
  compact?: boolean;
  messageId?: string;
  projectId?: string;
  onRefresh?: () => void;
}) {
  const router = useRouter();
  const tmx = useTaskMutations();
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<"pending" | "approved" | "rejected">("pending");
  const [executing, setExecuting] = useState(false);
  const [execResults, setExecResults] = useState<Record<number, "running" | "done" | "failed">>({});
  const [execError, setExecError] = useState<string | null>(null);
  const [currentStepLabel, setCurrentStepLabel] = useState<string | null>(null);
  const [addingTask, setAddingTask] = useState(false);
  const [taskAdded, setTaskAdded] = useState(false);

  const cfg = TYPE_CONFIG[s.type] || TYPE_CONFIG.info;
  const priorityCfg = PRIORITY_CONFIG[s.priority] || PRIORITY_CONFIG.medium;
  const hasReasoning = Boolean(s.input || s.reasoning || s.expectedOutcome || s.sourceMessage);

  const handleApprove = useCallback(async () => {
    if (executing) return;
    const checklist = Array.isArray(s.checklist) ? s.checklist : [];

    setExecuting(true);
    setExecError(null);
    setCurrentStepLabel(checklist[0] ? `Bước 1/${checklist.length}: ${checklist[0].title}` : null);
    setExecResults(checklist.length > 0 ? { 0: "running" } : {});

    if (checklist.length === 0) {
      setExecuting(false);
      setStatus("approved");
      return;
    }

    const items = checklist.map((c, ci) => ({
      title: c.title,
      targetGroup: c.targetGroup,
      messageContent: c.messageContent,
      originalIndex: ci,
    }));

    const applyStep = (
      origIdx: number,
      status: "running" | "done" | "failed",
      title?: string,
      error?: string,
    ) => {
      setExecResults((prev) => ({ ...prev, [origIdx]: status }));
      if (status === "running") {
        const n = origIdx + 1;
        setCurrentStepLabel(`Bước ${n}/${items.length}: ${title || items[origIdx]?.title || ""}`);
      }
      if (status === "failed" && error) {
        setExecError((prev) => (prev ? `${prev} · ${error}` : error));
      }
    };

    try {
      const res = await fetch("/api/agents/execute-checklist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageId,
          projectId,
          suggestionIndex: index,
          items,
        }),
      });

      const contentType = res.headers.get("content-type") || "";
      if (!res.body || !contentType.includes("ndjson")) {
        const data = await res.json().catch(() => ({}));
        if (data.ok && Array.isArray(data.results)) {
          const map: Record<number, "running" | "done" | "failed"> = {};
          data.results.forEach((r: any, i: number) => {
            map[items[i]?.originalIndex ?? i] = r.ok ? "done" : "failed";
          });
          setExecResults(map);
          const failed = (data.results as any[]).filter((r) => !r.ok);
          if (failed.length > 0) {
            setExecError(
              failed.map((r) => r.error || `Không gửi được tới ${r.targetGroup || r.title}`).join(" · ")
            );
          }
        } else {
          setExecError(data.error || "Không thể thực thi checklist.");
        }
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev: any;
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          if (ev.type === "step" && typeof ev.index === "number") {
            const st = ev.status === "failed" ? "failed" : ev.status === "running" ? "running" : "done";
            applyStep(ev.index, st, ev.title, ev.error);
          } else if (ev.type === "done" && ev.ok === false && ev.error) {
            setExecError(ev.error);
          }
        }
      }
    } catch (err: any) {
      setExecError(err?.message || "Lỗi khi thực thi checklist.");
      setExecResults((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((k) => {
          if (next[Number(k)] === "running") next[Number(k)] = "failed";
        });
        return next;
      });
    } finally {
      setExecuting(false);
      setCurrentStepLabel(null);
      setStatus("approved");
      onRefresh?.();
    }
  }, [s, messageId, projectId, index, onRefresh, executing]);

  const handleReject = useCallback(() => {
    setStatus("rejected");
  }, []);

  const handleAddTask = useCallback(async () => {
    if (addingTask) return;
    setAddingTask(true);
    try {
      await tmx.createTask({
        title: s.title,
        estimatedTime: 0,
        notes: s.description,
        project: undefined,
        status: "todo",
        priority: s.priority === "high" ? "high" : s.priority === "low" ? "low" : "normal",
      });
      setTaskAdded(true);
    } catch (err) {
      console.error("Add task failed:", err);
    } finally {
      setAddingTask(false);
    }
  }, [addingTask, tmx, s]);

  return (
    <div className={`rounded-xl border transition-all ${
      status === "approved"
        ? "bg-emerald-500/5 border-emerald-200 dark:border-emerald-500/30"
        : status === "rejected"
        ? "bg-muted/20 border-border/30 dark:border-zinc-700/30 opacity-60"
        : "bg-card/60 dark:bg-zinc-800/40 border-border/40 dark:border-zinc-700/40"
    }`}>
      {/* Header: type badge + priority + confident + title */}
      <div className="flex items-start gap-2 p-2.5">
        <div className={`mt-0.5 w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${cfg.color}`}>
          {cfg.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${cfg.color}`}>
              {cfg.label}
            </span>
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${priorityCfg.color}`}>
              {priorityCfg.label}
            </span>
            <span className="text-[10px]">{CONF_ICON[s.confidence] || "🟡"}</span>
            <span className="text-[11px] font-bold text-foreground dark:text-zinc-100 truncate flex-1">
              {s.title}
            </span>
          </div>
          <p className="text-[10px] text-muted-foreground dark:text-zinc-400 mt-1 leading-relaxed line-clamp-2">
            {s.description}
          </p>
          {/* Checklist hành động (từ steps quy trình nghiệp vụ khớp) */}
          {Array.isArray(s.checklist) && s.checklist.length > 0 && (
            <InteractiveChecklist
              title={s.title}
              items={(s.checklist as ChecklistItem[]).map((c, ci) => ({
                ...c,
                execStatus: execResults[ci] || c.execStatus,
              }))}
              disabled={!executing && status !== "approved"}
            />
          )}
          {(s.sourceSender || s.sourceChatName) && (
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
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
        </div>
      </div>

      {/* Reasoning section (collapsible) */}
      {hasReasoning && (
        <div className="px-2.5 pb-1">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className={`inline-flex items-center gap-1 text-[9px] px-2 py-0.5 rounded-md border transition-colors cursor-pointer ${
              expanded
                ? "bg-primary/10 text-primary border-primary/30"
                : "bg-muted/30 text-muted-foreground border-border/40 hover:bg-muted/50 hover:text-foreground"
            }`}
          >
            <BrainCircuit className="w-2.5 h-2.5" />
            {expanded ? "Thu gọn" : "Nguyên nhân"}
            <ChevronDown className={`w-2.5 h-2.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>
          {expanded && (
            <div className="mt-1.5 space-y-1.5 rounded-lg border border-border/30 bg-background/60 dark:bg-zinc-900/60 p-2">
              {s.input && (
                <div className="flex gap-1.5">
                  <Quote className="w-3 h-3 text-blue-500 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-[8px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wide">Input</p>
                    <p className="text-[10px] text-muted-foreground dark:text-zinc-400 leading-relaxed whitespace-pre-wrap">{s.input}</p>
                  </div>
                </div>
              )}
              {s.reasoning && (
                <div className="flex gap-1.5">
                  <BrainCircuit className="w-3 h-3 text-purple-500 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-[8px] font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wide">Suy luận</p>
                    <p className="text-[10px] text-muted-foreground dark:text-zinc-400 leading-relaxed whitespace-pre-wrap">{s.reasoning}</p>
                  </div>
                </div>
              )}
              {s.expectedOutcome && (
                <div className="flex gap-1.5">
                  <Target className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-[8px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">Kết quả mong muốn</p>
                    <p className="text-[10px] text-muted-foreground dark:text-zinc-400 leading-relaxed whitespace-pre-wrap">{s.expectedOutcome}</p>
                  </div>
                </div>
              )}
              {!s.input && !s.reasoning && !s.expectedOutcome && s.sourceMessage && (
                <div className="flex gap-1.5">
                  <Quote className="w-3 h-3 text-blue-500 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-[8px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wide">Tin nhắn gốc</p>
                    <p className="text-[10px] text-muted-foreground dark:text-zinc-400 leading-relaxed whitespace-pre-wrap">{s.sourceMessage}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Action buttons: Approve / Reject / Add Task */}
      {(status === "pending" || executing) && (
        <div className="flex items-center gap-1.5 px-2.5 pb-2 pt-1 flex-wrap">
          <button
            type="button"
            onClick={handleApprove}
            disabled={executing}
            className="text-[11px] px-3 py-1.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30 hover:bg-emerald-500/20 transition-colors cursor-pointer inline-flex items-center gap-1.5 font-semibold disabled:opacity-80 disabled:cursor-wait"
          >
            {executing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            {executing ? "Đang gửi tin..." : "Duyệt"}
          </button>
          <button
            type="button"
            onClick={handleReject}
            disabled={executing}
            className="text-[9px] px-2.5 py-1 rounded-md bg-red-500/10 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/30 hover:bg-red-500/20 transition-colors cursor-pointer inline-flex items-center gap-1 font-semibold disabled:opacity-50"
          >
            <XCircle className="w-3 h-3" /> Từ chối
          </button>
          <button
            type="button"
            onClick={handleAddTask}
            disabled={addingTask || taskAdded || executing}
            className="text-[9px] px-2.5 py-1 rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30 hover:bg-indigo-500/20 transition-colors cursor-pointer inline-flex items-center gap-1 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {addingTask ? <Loader2 className="w-3 h-3 animate-spin" /> : taskAdded ? <CheckCircle2 className="w-3 h-3" /> : <ListPlus className="w-3 h-3" />}
            {addingTask ? "Đang thêm..." : taskAdded ? "Đã thêm" : "Thêm task"}
          </button>
        </div>
      )}

      {executing && (
        <div className="mx-2.5 mb-2 flex items-center gap-2 rounded-lg border border-sky-300/70 dark:border-sky-500/40 bg-sky-500/10 px-2.5 py-2">
          <Loader2 className="w-4 h-4 animate-spin text-sky-600 dark:text-sky-400 shrink-0" />
          <span className="text-[11px] font-semibold text-sky-700 dark:text-sky-300 leading-snug">
            {currentStepLabel
              ? `Đang thực hiện — ${currentStepLabel}`
              : "Agent đang gửi tin nhắn — Chrome sẽ mở Zalo/Teams."}
          </span>
        </div>
      )}

      {/* Status indicator after action */}
      {status === "approved" && (
        <div className="px-2.5 pb-2 pt-0.5">
          <div className="flex items-center gap-1.5 text-[9px] text-emerald-600 dark:text-emerald-400 font-semibold">
            <CheckCircle2 className="w-3 h-3" /> Đã duyệt
            {executing && <span className="text-sky-500 ml-1">— agent đang gửi tin...</span>}
          </div>
          {execError && (
            <div className="mt-1 flex items-center gap-1 text-[9px] text-red-500 dark:text-red-400 font-semibold">
              <AlertTriangle className="w-2.5 h-2.5" /> {execError}
            </div>
          )}
        </div>
      )}
      {status === "rejected" && (
        <div className="px-2.5 pb-2 pt-0.5 flex items-center gap-1.5 text-[9px] text-muted-foreground font-semibold">
          <XCircle className="w-3 h-3" /> Đã từ chối
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Main card — renders the full notification with checklist
// ════════════════════════════════════════════════════════════
export function SuggestionNotificationCard({ meta, compact, messageId, onRefresh }: Props) {
  const router = useRouter();
  const suggestions = meta.suggestions || [];
  const projectName = meta.projectName || `Dự án ${meta.projectId}`;

  return (
    <div className="mt-2 rounded-2xl border border-amber-200/60 dark:border-amber-500/20 bg-amber-50/40 dark:bg-amber-500/5 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-amber-200/40 dark:border-amber-500/10 bg-gradient-to-r from-amber-500/5 to-transparent">
        <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-500/5 flex items-center justify-center ring-1 ring-amber-500/20 shrink-0">
          <Sparkles className="w-4 h-4 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-bold text-foreground dark:text-zinc-100">
            {suggestions.length} gợi ý mới — {projectName}
          </p>
          <p className="text-[9px] text-muted-foreground dark:text-zinc-500">
            PM Agent phát hiện từ tin nhắn Teams/Zalo
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            window.dispatchEvent(new CustomEvent("suggestions:toggle", { detail: { open: true } }));
          }}
          className="text-[9px] px-2 py-1 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30 hover:bg-amber-500/20 transition-colors cursor-pointer shrink-0 inline-flex items-center gap-1 font-semibold"
          title="Mở panel Gợi ý"
        >
          <ArrowUpRight className="w-2.5 h-2.5" /> Xem tất cả
        </button>
      </div>

      {/* Checklist of suggestions */}
      <div className={`p-2 space-y-1.5 ${compact ? "max-h-[280px]" : "max-h-[360px]"} overflow-y-auto`}>
        {suggestions.map((s, i) => (
          <SuggestionRow
            key={i}
            s={s}
            index={i}
            compact={compact}
            messageId={messageId}
            projectId={meta.projectId}
            onRefresh={onRefresh}
          />
        ))}
      </div>
    </div>
  );
}
