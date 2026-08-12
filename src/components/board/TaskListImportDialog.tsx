"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { useInvalidate } from "@/hooks/useData";
import { useTaskMutations } from "@/hooks/useDomain";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import {
  ClipboardPaste,
  Sparkles,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  ListPlus,
  X,
  ShieldCheck,
  User,
} from "lucide-react";
import type { MemberRef, DetectedTask } from "@/lib/taskListAnalyzer";

interface TaskListImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
  projectDescription?: string;
}

interface MemberRow {
  name: string;
  email?: string;
  roleName: string;
}

interface AnalyzeResponse {
  ok: boolean;
  tasks?: DetectedTask[];
  source?: "llm" | "fallback";
  mappedPics?: Record<string, string>;
  parsedRows?: number;
  skipped?: number;
  error?: string;
}

export function TaskListImportDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
}: TaskListImportDialogProps) {
  const { userId } = useAuth();
  const invalidate = useInvalidate();
  const tm = useTaskMutations();

  const [text, setText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [tasks, setTasks] = useState<DetectedTask[] | null>(null);
  const [analyzeSource, setAnalyzeSource] = useState<"llm" | "fallback" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<number | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);

  // Reset khi đóng
  useEffect(() => {
    if (!open) {
      setText("");
      setTasks(null);
      setAnalyzeSource(null);
      setError(null);
      setImported(null);
    }
  }, [open]);

  // Load member list của dự án
  useEffect(() => {
    if (!open || !projectId) return;
    setMembersLoading(true);
    fetch(`/api/data/members?action=getMembersByProject&projectId=${encodeURIComponent(projectId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setMembers(
            data.map((m) => ({
              name: m.name ?? "",
              email: m.email ?? undefined,
              roleName: m.roleName ?? "",
            }))
          );
        } else if (Array.isArray(data?.members)) {
          setMembers(
            data.members.map((m: any) => ({
              name: m.name ?? "",
              email: m.email ?? undefined,
              roleName: m.roleName ?? "",
            }))
          );
        }
      })
      .catch(() => setMembers([]))
      .finally(() => setMembersLoading(false));
  }, [open, projectId]);

  const memberStrPreview = useMemo(() => {
    return members
      .map((m) => `${m.name}${m.email ? ` <${m.email}>` : ""}${m.roleName ? ` — ${m.roleName}` : ""}`)
      .join("\n");
  }, [members]);

  const handleAnalyze = useCallback(async () => {
    if (!text.trim()) {
      setError("Dán nội dung task list từ Excel vào trước");
      return;
    }
    setAnalyzing(true);
    setError(null);
    setTasks(null);
    setImported(null);
    try {
      const res = await fetch("/api/data/task-list-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "analyze",
          userId,
          projectId,
          text,
        }),
      });
      const data: AnalyzeResponse = await res.json();
      if (!res.ok || data.error || !data.ok) {
        setError(data.error || "Phân tích thất bại");
        return;
      }
      setTasks(Array.isArray(data.tasks) ? data.tasks : []);
      setAnalyzeSource(data.source ?? null);
    } catch (err: any) {
      setError(err?.message || "Lỗi khi phân tích");
    } finally {
      setAnalyzing(false);
    }
  }, [text, userId, projectId]);

  const changeTask = useCallback((idx: number, patch: Partial<DetectedTask>) => {
    setTasks((prev) => {
      if (!prev) return prev;
      return prev.map((t, i) => (i === idx ? { ...t, ...patch } : t));
    });
  }, []);

  const handleImport = useCallback(async () => {
    if (!tasks || tasks.length === 0 || !userId) return;
    setImporting(true);
    setError(null);
    try {
      const res = await fetch("/api/data/task-list-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "import",
          userId,
          projectId,
          tasks,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error || !data.ok) {
        setError(data.error || "Import thất bại");
        return;
      }
      setImported(data.created ?? 0);
      await invalidate(["tasks", "tasksByProject"]);
    } catch (err: any) {
      setError(err?.message || "Lỗi khi import");
    } finally {
      setImporting(false);
    }
  }, [tasks, userId, projectId, invalidate]);

  const taskCount = tasks?.length ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col bg-popover border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <ClipboardPaste className="w-4 h-4 text-emerald-500" />
            Import task list từ Excel
            <span className="text-[10px] font-normal text-muted-foreground ml-auto">
              {projectName}
            </span>
          </DialogTitle>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="absolute right-4 top-4 p-1 rounded-md hover:bg-muted text-muted-foreground cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </DialogHeader>

        <div className="flex flex-col gap-3 overflow-y-auto pr-1">
          {/* Member list (compact) */}
          <div className="flex items-start gap-2 rounded-lg border border-border/40 bg-background/40 px-2.5 py-1.5">
            <User className="w-3 h-3 mt-0.5 text-muted-foreground shrink-0" />
            <div className="min-w-0">
              <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">
                Member — LLM sẽ assign pic/support theo danh sách này
              </span>
              {membersLoading ? (
                <div className="text-[9px] text-muted-foreground/60">Đang tải...</div>
              ) : memberStrPreview ? (
                <div className="text-[9px] text-foreground/80 whitespace-pre-wrap line-clamp-2">
                  {memberStrPreview}
                </div>
              ) : (
                <div className="text-[9px] text-amber-600 dark:text-amber-400">
                  Chưa có member — thêm member vào dự án để LLM assign task
                </div>
              )}
            </div>
          </div>

          {/* Paste textarea */}
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground mb-1 block">
              Dán nội dung task list (copy từ Excel — giữ tab giữa các cột)
            </label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"VD bôi đen vùng task trong Excel rồi Ctrl+C → dán vào đây:\n\n1\tChuẩn bị\n1.1\tSizing\t\tFCI DatPT115\tPreSale HCM\t\tDone\n2.2\tMigration VM Onprem to Cloud\tGửi guide cài đặt\tFCI\t\t\tDone\n2.3\tCài đặt Agent backup lên VM\tCài agent backup lên VM onprem\tKH\t\t\tProcessing"}
              rows={7}
              className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-muted border border-border text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/50 resize-y font-mono"
            />
            <div className="flex items-center justify-between mt-1">
              <span className="text-[9px] text-muted-foreground/60">
                Hoặc dán văn bản thường mỗi dòng 1 task (số thứ tự 1.1, 2.3 được tự nhận diện)
              </span>
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={analyzing || !text.trim()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {analyzing ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Sparkles className="w-3 h-3" />
                )}
                Phân tích bằng AI
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-1.5 text-[10px] text-red-600 dark:text-red-400 bg-red-500/5 border border-red-500/20 rounded-lg px-2.5 py-1.5">
              <AlertTriangle className="w-3 h-3" />
              {error}
            </div>
          )}

          {imported !== null && (
            <div className="flex items-center gap-1.5 text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-2.5 py-1.5">
              <CheckCircle2 className="w-3 h-3" />
              Đã import {imported} task vào dự án {projectName}
            </div>
          )}

          {/* Preview kết quả */}
          {tasks !== null && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <ListPlus className="w-3 h-3" />
                  Đã detect <span className="font-bold text-foreground">{taskCount}</span> task
                  {analyzeSource === "llm" ? " (AI)" : analyzeSource === "fallback" ? " (theo cột — không có AI)" : ""}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setTasks(null);
                      setAnalyzeSource(null);
                    }}
                    className="px-2 py-1 rounded-lg text-[9px] font-medium text-muted-foreground hover:bg-muted cursor-pointer"
                  >
                    Phân tích lại
                  </button>
                  <button
                    type="button"
                    onClick={() => setTasks(tasks.map(() => ({ ...(tasks[0] ?? { title: "", phase: "Khác", pic: "", support: "" }), pic: "", support: "" })))}
                    className="px-2 py-1 rounded-lg text-[9px] font-medium text-muted-foreground hover:bg-muted cursor-pointer"
                  >
                    Xoá toàn bộ pic
                  </button>
                </div>
              </div>

              <div className="border border-border/50 rounded-lg overflow-hidden">
                <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
                  <table className="w-full text-left text-[10px] min-w-[680px]">
                    <thead className="sticky top-0 bg-muted/60 backdrop-blur text-muted-foreground">
                      <tr>
                        <th className="px-1.5 py-1.5 font-semibold w-28">Task</th>
                        <th className="px-1.5 py-1.5 font-semibold hidden md:table-cell w-44">Chi tiết</th>
                        <th className="px-1.5 py-1.5 font-semibold w-24">PIC</th>
                        <th className="px-1.5 py-1.5 font-semibold hidden lg:table-cell w-24">Support</th>
                        <th className="px-1.5 py-1.5 font-semibold w-16">Manday</th>
                        <th className="px-1.5 py-1.5 font-semibold w-16">Trạng thái</th>
                        <th className="px-1.5 py-1.5 w-8" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/30">
                      {tasks.map((t, idx) => (
                        <tr key={idx} className="hover:bg-muted/20">
                          <td className="px-1.5 py-1">
                            <input
                              type="text"
                              value={t.title}
                              onChange={(e) => changeTask(idx, { title: e.target.value })}
                              placeholder="Tên task"
                              className="w-full h-6 px-1.5 text-[10px] rounded bg-background/50 border border-border/50 outline-none focus:border-primary/40"
                            />
                          </td>
                          <td className="px-1.5 py-1 hidden md:table-cell">
                            <input
                              type="text"
                              value={t.details ?? ""}
                              onChange={(e) => changeTask(idx, { details: e.target.value })}
                              placeholder="Chi tiết"
                              className="w-full h-6 px-1.5 text-[10px] rounded bg-background/50 border border-border/50 outline-none focus:border-primary/40"
                            />
                          </td>
                          <td className="px-1.5 py-1">
                            <select
                              value={t.pic ?? ""}
                              onChange={(e) => changeTask(idx, { pic: e.target.value })}
                              className="w-full h-6 px-1 text-[10px] rounded bg-background/50 border border-border/50 outline-none focus:border-primary/40 cursor-pointer"
                            >
                              <option value="">—</option>
                              {members.map((m, mi) => (
                                <option key={mi} value={m.name}>
                                  {m.name} {m.roleName ? `(${m.roleName})` : ""}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-1.5 py-1 hidden lg:table-cell">
                            <select
                              value={t.support ?? ""}
                              onChange={(e) => changeTask(idx, { support: e.target.value })}
                              className="w-full h-6 px-1 text-[10px] rounded bg-background/50 border border-border/50 outline-none focus:border-primary/40 cursor-pointer"
                            >
                              <option value="">—</option>
                              {members.map((m, mi) => (
                                <option key={mi} value={m.name}>
                                  {m.name} {m.roleName ? `(${m.roleName})` : ""}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-1.5 py-1">
                            <input
                              type="number"
                              min={0}
                              value={t.manday ?? ""}
                              onChange={(e) => changeTask(idx, { manday: e.target.value ? Number(e.target.value) : undefined })}
                              placeholder="1"
                              className="w-14 h-6 px-1.5 text-[10px] rounded bg-background/50 border border-border/50 outline-none focus:border-primary/40"
                            />
                          </td>
                          <td className="px-1.5 py-1">
                            <select
                              value={t.status ?? ""}
                              onChange={(e) => changeTask(idx, { status: e.target.value })}
                              className="w-full h-6 px-1 text-[10px] rounded bg-background/50 border border-border/50 outline-none focus:border-primary/40 cursor-pointer"
                            >
                              <option value="">—</option>
                              <option value="todo">Chưa thực hiện</option>
                              <option value="processing">Đang xử lý</option>
                              <option value="pending">Chờ</option>
                              <option value="done">Đã xong</option>
                            </select>
                          </td>
                          <td className="px-1.5 py-1">
                            <button
                              type="button"
                              onClick={() => setTasks((prev) => (prev ? prev.filter((_, i) => i !== idx) : prev))}
                              className="px-1 rounded-md text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                              title="Xoá task"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 pt-3 border-t border-border/30 mt-2">
          <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground/70">
            <ShieldCheck className="w-3 h-3" />
            PIC/Support được assign theo member dự án — cột gốc khớp member sẽ giữ nguyên, thiếu thì AI gợi ý
          </div>
          <div className="flex items-center gap-2">
            <DialogClose
              render={
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-lg text-[10px] font-medium text-muted-foreground hover:bg-muted cursor-pointer"
                >
                  Đóng
                </button>
              }
            />
            <button
              type="button"
              onClick={handleImport}
              disabled={importing || !tasks || tasks.length === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[10px] font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {importing ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <ListPlus className="w-3 h-3" />
              )}
              {taskCount > 0 ? `Import ${taskCount} task vào dự án` : "Import task"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}