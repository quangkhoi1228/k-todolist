"use client";

import { useState, useEffect, useCallback } from "react";
import { Check, Send, Users, Loader2, AlertCircle } from "lucide-react";
import {
  ChecklistItem,
  checklistKey,
  loadChecklistProgress,
  saveChecklistProgress,
} from "@/lib/checklistProgress";

/**
 * Checklist hành động tương tác.
 *
 * Hai chế độ hiển thị:
 * 1. **Agent execution** — item có `execStatus` ("running" | "done" | "failed")
 *    được cập nhật realtime qua polling metadata. Hiển thị spinner / check /
 *    error icon, không cho tick thủ công.
 * 2. **Manual tick** — PM tự tick "làm đến đâu check đến đó", lưu localStorage.
 *
 * - `disabled`: khi chưa bấm Duyệt (chỉ đọc), bật sau khi approved.
 * - `title`: tiêu đề gợi ý — dùng để tạo key lưu tiến độ.
 */
export function InteractiveChecklist({
  title,
  items,
  disabled = false,
}: {
  title: string;
  items: ChecklistItem[];
  disabled?: boolean;
}) {
  const key = checklistKey(title, items);
  const [checked, setChecked] = useState<boolean[]>(() => loadChecklistProgress(key));

  useEffect(() => {
    setChecked(loadChecklistProgress(key));
  }, [key]);

  const toggle = useCallback(
    (idx: number) => {
      if (disabled) return;
      setChecked((prev) => {
        const next = [...prev];
        next[idx] = !next[idx];
        saveChecklistProgress(key, next);
        return next;
      });
    },
    [disabled, key],
  );

  const total = items.length;
  const doneCount = items.filter((c, idx) =>
    c.execStatus === "done" || (c.execStatus !== "running" && c.execStatus !== "failed" && Boolean(checked[idx]))
  ).length;
  const runningCount = items.filter((c) => c.execStatus === "running").length;
  const failedCount = items.filter((c) => c.execStatus === "failed").length;

  return (
    <div className="mt-2">
      {/* Progress bar */}
      <div className="flex items-center gap-2 mb-1.5">
        <div className="flex-1 h-1.5 rounded-full bg-muted/40 overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              failedCount > 0 ? "bg-amber-500" : runningCount > 0 ? "bg-sky-500" : "bg-emerald-500"
            }`}
            style={{ width: `${total ? (doneCount / total) * 100 : 0}%` }}
          />
        </div>
        <span className="text-[10px] font-semibold text-muted-foreground shrink-0">
          {doneCount}/{total}
          {runningCount > 0 && <span className="text-sky-500 ml-1">({runningCount} đang chạy)</span>}
          {failedCount > 0 && <span className="text-amber-500 ml-1">({failedCount} lỗi)</span>}
        </span>
      </div>
      <div className="space-y-1">
        {items.map((c, idx) => {
          const isManualDone = Boolean(checked[idx]);
          const execRunning = c.execStatus === "running";
          const execDone = c.execStatus === "done";
          const execFailed = c.execStatus === "failed";
          const isDone = execDone || (!execRunning && !execFailed && isManualDone);
          const hasExec = execRunning || execDone || execFailed;

          return (
            <button
              key={idx}
              type="button"
              disabled={disabled || execRunning || (hasExec && !execFailed)}
              onClick={() => toggle(idx)}
              className={`w-full flex items-start gap-2 text-left rounded-lg border px-2 py-1.5 transition-colors ${
                disabled || (hasExec && !execFailed)
                  ? "cursor-default border-transparent"
                  : "cursor-pointer border-border/30 hover:bg-muted/30"
              } ${isDone ? "bg-emerald-500/5 border-emerald-300/30" : ""} ${
                execRunning ? "bg-sky-500/10 border-sky-300/40" : ""
              } ${
                execFailed ? "bg-red-500/5 border-red-300/30" : ""
              }`}
            >
              {/* Checkbox / status icon */}
              <span
                className={`mt-0.5 w-4 h-4 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                  execRunning
                    ? "border-sky-400 bg-sky-500/10"
                    : execFailed
                    ? "border-red-400 bg-red-500/10 text-red-500"
                    : isDone
                    ? "bg-emerald-500 border-emerald-500 text-white"
                    : "border-zinc-400/50 bg-transparent"
                }`}
              >
                {execRunning && <Loader2 className="w-3 h-3 text-sky-500 animate-spin" />}
                {execFailed && <AlertCircle className="w-3 h-3" />}
                {!execRunning && !execFailed && isDone && <Check className="w-3 h-3" strokeWidth={3} />}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={`text-[12px] font-medium leading-snug block ${
                    isDone
                      ? "text-emerald-700 dark:text-emerald-400 line-through decoration-emerald-400/50"
                      : execFailed
                      ? "text-red-600 dark:text-red-400"
                      : "text-foreground dark:text-zinc-200"
                  }`}
                >
                  {c.title}
                </span>
                {c.description && (
                  <span
                    className={`text-[10px] leading-snug block mt-0.5 ${
                      isDone ? "text-emerald-600/60 dark:text-emerald-400/50" : "text-muted-foreground dark:text-zinc-500"
                    }`}
                  >
                    {c.description}
                  </span>
                )}
                {c.targetGroup && (
                  <span
                    className={`inline-flex items-center gap-1 mt-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md border ${
                      execFailed
                        ? "text-red-600/70 dark:text-red-400/60 border-red-300/30 bg-red-500/5"
                        : isDone
                        ? "text-emerald-600/70 dark:text-emerald-400/60 border-emerald-300/30 bg-emerald-500/5"
                        : execRunning
                        ? "text-sky-600 dark:text-sky-400 border-sky-200 dark:border-sky-500/30 bg-sky-500/10"
                        : "text-sky-600 dark:text-sky-400 border-sky-200 dark:border-sky-500/30 bg-sky-500/10"
                    }`}
                  >
                    <Users className="w-2.5 h-2.5" />
                    {c.targetGroup}
                  </span>
                )}
                {c.messageContent && (
                  <span
                    className={`block mt-1 text-[10px] leading-relaxed rounded-md border px-2 py-1.5 ${
                      execFailed
                        ? "text-red-600/70 dark:text-red-400/60 border-red-300/20 bg-red-500/5"
                        : isDone
                        ? "text-emerald-600/70 dark:text-emerald-400/60 border-emerald-300/20 bg-emerald-500/5"
                        : "text-foreground/80 dark:text-zinc-300 border-border/40 bg-muted/20"
                    }`}
                  >
                    <span className="inline-flex items-center gap-1 font-semibold text-[9px] uppercase tracking-wide text-muted-foreground/70 mr-1">
                      <Send className="w-2.5 h-2.5" /> Nội dung gửi:
                    </span>
                    {c.messageContent}
                  </span>
                )}
                {execRunning && (
                  <span className="block mt-1 text-[10px] font-semibold text-sky-600 dark:text-sky-400">
                    Đang gửi...
                  </span>
                )}
                {execFailed && c.execError && (
                  <span className="block mt-1 text-[10px] text-red-500 dark:text-red-400 font-medium leading-relaxed">
                    Lỗi: {c.execError}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
