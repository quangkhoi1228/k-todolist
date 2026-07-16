"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useAuth } from "@clerk/nextjs";
import { ListTodo, FileText, BarChart3, Copy, Check } from "lucide-react";
import { format } from "date-fns";
import type { Doc } from "../../../convex/_generated/dataModel";
import { WysiwygEditor } from "./WysiwygEditor";

const DEFAULT_NOTES = `## Thông tin chung

Mô tả tổng quan về dự án, mục tiêu, phạm vi...

## Link liên quan

- Tên link - https://example.com

## Ghi chú

Các ghi chú, lưu ý, thông tin bổ sung...
`;

interface ProjectDetailPanelProps {
  project: {
    _id: string;
    name: string;
    color?: string;
    notes?: string | null;
  };
}

const STATUS_LABELS: Record<string, { label: string; color: string; short: string }> = {
  todo: { label: "Chưa thực hiện", color: "text-neutral-500", short: "Todo" },
  processing: { label: "Đang xử lý", color: "text-blue-500", short: "Đang XL" },
  pending: { label: "Tạm dừng", color: "text-amber-500", short: "Tạm dừng" },
  done: { label: "Đã hoàn thành", color: "text-emerald-500", short: "Done" },
};

const PRIORITY_CONFIG: Record<string, { label: string; class: string }> = {
  high: { label: "Cao", class: "bg-rose-500/10 text-rose-600 dark:text-rose-400" },
  normal: { label: "TB", class: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400" },
  low: { label: "Thấp", class: "bg-slate-500/10 text-slate-600 dark:text-slate-400" },
};

function StatusBadge({ status }: { status?: string }) {
  const s = STATUS_LABELS[status || "todo"] || STATUS_LABELS["todo"];
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${s.color} bg-current/5`}>
      {s.short}
    </span>
  );
}

function PriorityBadge({ priority }: { priority?: string }) {
  if (!priority || priority === "normal") return null;
  const p = PRIORITY_CONFIG[priority];
  if (!p) return null;
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${p.class}`}>
      {p.label}
    </span>
  );
}

/**
 * Compute a diff-like description of what changed on a task update.
 * Since we only have the current snapshot, we show key fields with
 * their current values as a meaningful "timeline entry".
 */
function TaskTimelineEntry({ task }: { task: Doc<"tasks"> }) {

  return (
    <div className="flex items-start gap-2.5 p-2 rounded-lg border border-border/40 bg-muted/10 hover:bg-muted/20 transition-colors">
      {/* Timeline dot */}
      <div className="flex flex-col items-center gap-0.5 shrink-0">
        <div
          className={`w-2 h-2 rounded-full mt-1.5 ring-2 ring-background ${
            task.status === "done"
              ? "bg-emerald-500"
              : task.status === "processing"
                ? "bg-blue-500"
                : task.status === "pending"
                  ? "bg-amber-500"
                  : "bg-neutral-400"
          }`}
        />
        <div className="w-px flex-1 min-h-[20px] bg-border/40" />
      </div>

      <div className="flex-1 min-w-0 pb-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="text-xs font-medium text-foreground">{task.title}</p>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap mt-1">
          <StatusBadge status={task.status} />
          {task.priority && task.priority !== "normal" && (
            <PriorityBadge priority={task.priority} />
          )}
          {task.estimatedTime > 0 && (
            <span className="text-[10px] text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded">
              {task.estimatedTime}h
            </span>
          )}
        </div>

        {task.endDate && (
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Hạn: {format(new Date(task.endDate), "dd/MM/yyyy HH:mm")}
          </p>
        )}

        <p className="text-[10px] text-muted-foreground/60 mt-0.5">
          Tạo: {format(new Date(task._creationTime), "dd/MM/yyyy HH:mm")}
        </p>
      </div>
    </div>
  );
}

export function ProjectDetailPanel({ project }: ProjectDetailPanelProps) {
  const { userId } = useAuth();
  const [tab, setTab] = useState<"info" | "summary" | "history">("info");
  const [editorContent, setEditorContent] = useState(project.notes || DEFAULT_NOTES);

  const [copied, setCopied] = useState(false);

  const updateProjectDetail = useMutation(api.projects.updateProjectDetail);

  // Auto-save with debounce
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const doSave = useCallback(async (content: string) => {
    if (!userId) return;
    try {
      await updateProjectDetail({
        id: project._id as any,
        notes: content || undefined,
      });
    } catch (err) {
      console.error(err);
    }
  }, [userId, project._id, updateProjectDetail]);

  // Debounced auto-save when editorContent changes
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      doSave(editorContent);
    }, 800);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [editorContent, doSave]);

  // Fetch tasks for history
  const projectTasks =
    useQuery(api.tasks.getTasksByProject, { projectId: project._id as any }) ?? [];

  // Sort by creation time descending (newest first) for timeline
  const timelineTasks = useMemo(() => {
    return [...projectTasks].sort((a, b) => b._creationTime - a._creationTime);
  }, [projectTasks]);

  const stats = useMemo(() => {
    const total = projectTasks.length;
    const done = projectTasks.filter((t) => t.status === "done").length;
    const processing = projectTasks.filter((t) => t.status === "processing").length;
    const pending = projectTasks.filter((t) => t.status === "pending").length;
    const todo = projectTasks.filter((t) => !t.status || t.status === "todo").length;
    return { total, done, processing, pending, todo };
  }, [projectTasks]);

  // Summary: only done tasks grouped by date
  const summaryEntries = useMemo(() => {
    const doneTasks = projectTasks.filter((t) => t.status === "done");
    const groups: Map<string, Doc<"tasks">[]> = new Map();

    for (const task of doneTasks) {
      const date = task.endDate
        ? format(new Date(task.endDate), "dd/MM")
        : format(new Date(task._creationTime), "dd/MM");
      const existing = groups.get(date) || [];
      existing.push(task);
      groups.set(date, existing);
    }

    // Sort by date (parsing dd/MM -> MM/dd for comparison)
    const sorted = Array.from(groups.entries()).sort(([a], [b]) => {
      const [da, ma] = a.split("/").map(Number);
      const [db, mb] = b.split("/").map(Number);
      // Treat undefined year as 2026
      return new Date(2026, ma! - 1, da).getTime() - new Date(2026, mb! - 1, db).getTime();
    });

    return sorted;
  }, [projectTasks]);

  // Next actions: todo + processing tasks
  const nextActions = useMemo(() => {
    const active = projectTasks.filter(
      (t) => !t.status || t.status === "todo" || t.status === "processing"
    );

    // Split into items with and without date
    const withDate = active.filter((t) => t.endDate);
    const withoutDate = active.filter((t) => !t.endDate);

    // Sort withDate by endDate ascending
    withDate.sort((a, b) => (a.endDate || 0) - (b.endDate || 0));

    // From withoutDate, pick at most 1 with highest priority, then newest
    const priorityOrder: Record<string, number> = { high: 0, normal: 1, low: 2 };
    withoutDate.sort((a, b) => {
      const pa = priorityOrder[a.priority || "normal"] ?? 1;
      const pb = priorityOrder[b.priority || "normal"] ?? 1;
      if (pa !== pb) return pa - pb;
      return (b._creationTime || 0) - (a._creationTime || 0);
    });

    return [...withDate, ...(withoutDate.length > 0 ? [withoutDate[0]] : [])];
  }, [projectTasks]);

  // Generate plain text summary for copying
  const summaryText = useMemo(() => {
    const lines: string[] = [];
    lines.push("CURRENT STATUS:");
    lines.push("");

    if (summaryEntries.length === 0) {
      lines.push("Chưa có công việc nào trong dự án này");
    } else {
      for (const [date, tasks] of summaryEntries) {
        lines.push(`${date}:`);
        for (const task of tasks) {
          lines.push(`  - ${task.title} [Done]`);
        }
        lines.push("");
      }
    }

    lines.push("NEXT ACTION:");
    lines.push("");
    if (nextActions.length === 0) {
      lines.push("Đợi thêm yêu cầu mới từ sales");
    } else {
      for (const task of nextActions) {
        const sl = STATUS_LABELS[task.status || "todo"]?.short || "Todo";
        const dl = task.endDate ? ` (Hạn: ${format(new Date(task.endDate), "dd/MM")})` : "";
        lines.push(`- ${task.title} [${sl}]${dl}`);
      }
    }

    return lines.join("\n");
  }, [summaryEntries, nextActions]);

  const handleCopySummary = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(summaryText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = summaryText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [summaryText]);

  return (
    <div className="border border-border/50 rounded-xl bg-card/50 backdrop-blur-sm overflow-hidden shadow-inner">
      {/* Tabs */}
      <div className="flex items-center gap-1 px-2 pt-2 pb-0 border-b border-border/30">
        <button
          type="button"
          onClick={() => setTab("info")}
          className={`px-3 py-1.5 text-[11px] font-semibold rounded-t-lg transition-all cursor-pointer flex items-center gap-1 ${
            tab === "info"
              ? "bg-background text-foreground border border-border/60 border-b-background -mb-px shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
          }`}
        >
          <FileText className="w-3 h-3" />
          Thông tin dự án
        </button>
        <button
          type="button"
          onClick={() => setTab("summary")}
          className={`px-3 py-1.5 text-[11px] font-semibold rounded-t-lg transition-all cursor-pointer flex items-center gap-1 ${
            tab === "summary"
              ? "bg-background text-foreground border border-border/60 border-b-background -mb-px shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
          }`}
        >
          <BarChart3 className="w-3 h-3" />
          Summary
        </button>
        <button
          type="button"
          onClick={() => setTab("history")}
          className={`px-3 py-1.5 text-[11px] font-semibold rounded-t-lg transition-all cursor-pointer flex items-center gap-1 ${
            tab === "history"
              ? "bg-background text-foreground border border-border/60 border-b-background -mb-px shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
          }`}
        >
          <ListTodo className="w-3 h-3" />
          Lịch sử ({projectTasks.length})
        </button>
      </div>

      {/* Tab Content */}
      <div className="p-3">
        {tab === "info" ? (
          <div className="space-y-2">
            {/* WYSIWYG Editor */}
            <div className="relative min-h-[240px] border border-border/50 rounded-lg overflow-hidden">
              <WysiwygEditor
                key={project._id}
                content={editorContent}
                onChange={(md) => setEditorContent(md)}
              />
            </div>
          </div>
        ) : tab === "summary" ? (
          /* Summary Tab — compact, copyable report */
          <div className="space-y-4 max-h-[440px] overflow-y-auto pr-1">
            {/* Stats row */}
            <div className="flex items-center gap-2 flex-wrap pb-1 border-b border-border/20">
              <span className="text-[10px] text-muted-foreground bg-muted/40 px-2 py-0.5 rounded">
                Tổng: <strong className="text-foreground">{stats.total}</strong>
              </span>
              <span className="text-[10px] text-neutral-500 bg-neutral-500/5 px-2 py-0.5 rounded">
                Chưa TH: <strong>{stats.todo}</strong>
              </span>
              <span className="text-[10px] text-blue-500 bg-blue-500/5 px-2 py-0.5 rounded">
                Đang XL: <strong>{stats.processing}</strong>
              </span>
              <span className="text-[10px] text-amber-500 bg-amber-500/5 px-2 py-0.5 rounded">
                Tạm dừng: <strong>{stats.pending}</strong>
              </span>
              <span className="text-[10px] text-emerald-500 bg-emerald-500/5 px-2 py-0.5 rounded">
                Done: <strong>{stats.done}</strong>
              </span>
              <div className="flex-1" />
              <button
                type="button"
                onClick={handleCopySummary}
                className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                title="Copy summary"
              >
                {copied ? (
                  <Check className="w-3 h-3 text-emerald-500" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
                {copied ? "Đã copy" : "Copy"}
              </button>
            </div>

            {/* Copyable text area */}
            <div className="text-[11px] font-sans leading-relaxed text-foreground whitespace-pre-wrap m-0 select-all">
              {summaryText.split("\n").map((line, i) => {
                if (line === "CURRENT STATUS:" || line === "NEXT ACTION:") {
                  return <strong key={i}>{line}<br /></strong>;
                }
                return <span key={i}>{line}<br /></span>;
              })}
            </div>
          </div>
        ) : (
          /* History Tab — timeline view */
          <div className="space-y-3">
            {/* Stats summary */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-muted-foreground bg-muted/40 px-2 py-0.5 rounded">
                Tổng: <strong className="text-foreground">{stats.total}</strong>
              </span>
              <span className="text-[10px] text-neutral-500 bg-neutral-500/5 px-2 py-0.5 rounded">
                Chưa TH: <strong>{stats.todo}</strong>
              </span>
              <span className="text-[10px] text-blue-500 bg-blue-500/5 px-2 py-0.5 rounded">
                Đang XL: <strong>{stats.processing}</strong>
              </span>
              <span className="text-[10px] text-amber-500 bg-amber-500/5 px-2 py-0.5 rounded">
                Tạm dừng: <strong>{stats.pending}</strong>
              </span>
              <span className="text-[10px] text-emerald-500 bg-emerald-500/5 px-2 py-0.5 rounded">
                Hoàn thành: <strong>{stats.done}</strong>
              </span>
            </div>

            {/* Timeline task list */}
            <div className="space-y-0 max-h-[320px] overflow-y-auto pr-1">
              {timelineTasks.length === 0 ? (
                <div className="text-center py-8 text-[11px] text-muted-foreground italic">
                  Chưa có công việc nào trong dự án này
                </div>
              ) : (
                timelineTasks.map((task, idx) => {
                  // Group by date
                  const taskDate = format(new Date(task._creationTime), "dd/MM/yyyy");
                  const prevDate =
                    idx > 0
                      ? format(new Date(timelineTasks[idx - 1]._creationTime), "dd/MM/yyyy")
                      : null;
                  const showDateHeader = !prevDate || prevDate !== taskDate;

                  return (
                    <div key={task._id}>
                      {showDateHeader && (
                        <div className="flex items-center gap-2 pt-3 pb-1">
                          <div className="h-px flex-1 bg-border/30" />
                          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                            {taskDate}
                          </span>
                          <div className="h-px flex-1 bg-border/30" />
                        </div>
                      )}
                      <TaskTimelineEntry task={task} />
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
