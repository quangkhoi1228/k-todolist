"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { useInvalidate } from "@/hooks/useData";
import { useTaskMutations } from "@/hooks/useDomain";
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

interface TaskListImportPanelProps {
  onClose: () => void;
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

/** Timestamp (ms) → "yyyy-MM-dd" cho input type=date (giờ địa phương). */
function fmtDate(ts?: number | null): string {
  if (!ts || isNaN(Number(ts))) return "";
  const d = new Date(Number(ts));
  if (isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** "yyyy-MM-dd" (từ input date) → timestamp (ms) giờ địa phương. */
function parseDateInput(value: string): number | undefined {
  if (!value) return undefined;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  const dt = new Date(y, m - 1, d);
  return isNaN(dt.getTime()) ? undefined : dt.getTime();
}

function normNameForMatch(n: string) {
  return n.toLowerCase().replace(/\s+/g, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function TaskListImportPanel({
  onClose,
  projectId,
  projectName,
}: TaskListImportPanelProps) {
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

  useEffect(() => {
    if (!projectId) return;
    setMembersLoading(true);
    fetch(`/api/data/members?action=getMembersByProject&projectId=${encodeURIComponent(projectId)}`)
      .then((r) => r.json())
      .then((data) => {
        const raw: MemberRow[] = Array.isArray(data)
          ? data.map((m) => ({
              name: m.name ?? "",
              email: m.email ?? undefined,
              roleName: m.roleName ?? "",
            }))
          : Array.isArray(data?.members)
            ? data.members.map((m: any) => ({
                name: m.name ?? "",
                email: m.email ?? undefined,
                roleName: m.roleName ?? "",
              }))
            : [];
        // Đảm bảo luôn có placeholder "Khách hàng" cho task của khách
        const hasCustomer = raw.some((m) => normNameForMatch(m.name) === "khachhang");
        setMembers(hasCustomer ? raw : [{ name: "Khách hàng", email: undefined, roleName: "" }, ...raw]);
      })
      .catch(() => setMembers([]))
      .finally(() => setMembersLoading(false));
  }, [projectId]);

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

  // Sinh ID phân cấp (1, 1.1, 1.2, 2, 2.1, ...) cho từng task — chỉ hiển thị, không lưu DB.
  const taskIds = useMemo(() => {
    const ids: string[] = [];
    // counters[i] = số task con ở cấp i đã đếm (reset cấp con khi cấp cha tăng)
    const counters: number[] = [];
    for (const t of tasks ?? []) {
      const level = t.path ? t.path.split(" / ").length - 1 : 0;
      // Tăng counter ở cấp hiện tại, reset các cấp sâu hơn
      counters[level] = (counters[level] ?? 0) + 1;
      counters.length = level + 1;
      ids.push(counters.slice(0, level + 1).join("."));
    }
    return ids;
  }, [tasks]);

  return (
    <div className="flex flex-col h-full bg-background/50 rounded-xl border border-border/40 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 bg-card/50">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
            <ClipboardPaste className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground">Import task list từ Excel</h3>
            <p className="text-xs text-muted-foreground">
              {projectName}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-muted text-muted-foreground transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex flex-col gap-4 p-4 flex-1 min-h-0 overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 shrink-0">
            {/* Paste textarea */}
            <div className="col-span-1 lg:col-span-2 flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold text-foreground flex items-center gap-2">
                  Dữ liệu từ Excel
                  <span className="text-xs font-normal text-muted-foreground">
                    (Copy & dán trực tiếp vào đây)
                  </span>
                </label>
              </div>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={"VD bôi đen vùng task trong Excel rồi Ctrl+C → dán vào đây:\n\n1\tChuẩn bị\n1.1\tSizing\t\tFCI DatPT115\tPreSale HCM\t\tDone"}
                rows={5}
                className="w-full flex-1 px-4 py-3 text-sm rounded-xl bg-background border border-border/60 text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all resize-none font-mono leading-relaxed shadow-sm"
              />
              <div className="flex items-center justify-between mt-3">
                <span className="text-[11px] text-muted-foreground">
                  Hỗ trợ định dạng có tab giữa các cột, hoặc văn bản thường mỗi dòng 1 task
                </span>
                <button
                  type="button"
                  onClick={handleAnalyze}
                  disabled={analyzing || !text.trim()}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-500 hover:bg-emerald-600 text-white shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {analyzing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  Phân tích bằng AI
                </button>
              </div>
            </div>

            {/* Member list (compact) */}
            <div className="col-span-1 flex flex-col bg-muted/20 border border-border/40 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="p-1.5 rounded-md bg-blue-500/10 text-blue-500">
                  <User className="w-4 h-4" />
                </div>
                <h4 className="text-sm font-semibold text-foreground">Danh sách Member</h4>
              </div>
              <p className="text-[11px] text-muted-foreground mb-3 leading-relaxed">
                AI sẽ tự động match PIC/Support vào danh sách này. Từ khoá "KH" sẽ thành Khách hàng.
              </p>
              <div className="flex-1 min-h-[80px] overflow-y-auto bg-background/50 border border-border/40 rounded-lg p-3 text-xs shadow-inner">
                {membersLoading ? (
                  <div className="text-muted-foreground flex items-center justify-center h-full">Đang tải...</div>
                ) : memberStrPreview ? (
                  <div className="text-foreground/80 whitespace-pre-wrap leading-relaxed">
                    {memberStrPreview}
                  </div>
                ) : (
                  <div className="text-amber-600 dark:text-amber-400">
                    Chưa có member — hãy thêm member vào dự án.
                  </div>
                )}
              </div>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 shrink-0">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              {error}
            </div>
          )}

          {imported !== null && (
            <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3 shrink-0">
              <CheckCircle2 className="w-5 h-5 shrink-0" />
              Đã import {imported} task vào dự án thành công.
            </div>
          )}

          {/* Preview kết quả */}
          {tasks !== null && (
            <div className="flex flex-col flex-1 min-h-0 bg-background rounded-xl border border-border/60 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 bg-muted/10 shrink-0">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <div className="p-1 rounded-md bg-primary/10 text-primary">
                    <ListPlus className="w-4 h-4" />
                  </div>
                  <span>
                    Đã nhận diện <strong className="text-foreground">{taskCount}</strong> task
                  </span>
                  {analyzeSource === "llm" ? (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold border border-emerald-500/20">AI</span>
                  ) : analyzeSource === "fallback" ? (
                    <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[10px] font-semibold border border-blue-500/20">Cơ bản</span>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setTasks(null);
                      setAnalyzeSource(null);
                    }}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                  >
                    Làm lại
                  </button>
                  <button
                    type="button"
                    onClick={() => setTasks(tasks.map(() => ({ ...(tasks[0] ?? { title: "", phase: "Khác", pic: "", support: "" }), pic: "", support: "" })))}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium text-rose-600 hover:bg-rose-500/10 transition-colors cursor-pointer"
                  >
                    Xoá toàn bộ PIC
                  </button>
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-auto">
                <table className="w-full text-left text-xs min-w-[1000px]">
                  <thead className="sticky top-0 bg-muted/90 backdrop-blur-md text-muted-foreground z-10 shadow-sm ring-1 ring-border/50">
                    <tr>
                      <th className="px-3 py-2.5 font-semibold w-16 text-center">ID</th>
                      <th className="px-3 py-2.5 font-semibold w-56">Task</th>
                      <th className="px-3 py-2.5 font-semibold hidden md:table-cell w-56">Chi tiết</th>
                      <th className="px-3 py-2.5 font-semibold w-32">PIC</th>
                      <th className="px-3 py-2.5 font-semibold hidden lg:table-cell w-32">Support</th>
                      <th className="px-3 py-2.5 font-semibold w-20">Manday</th>
                      <th className="px-3 py-2.5 font-semibold w-36">Bắt đầu</th>
                      <th className="px-3 py-2.5 font-semibold w-36">Kết thúc</th>
                      <th className="px-3 py-2.5 font-semibold w-32">Trạng thái</th>
                      <th className="px-3 py-2.5 w-10" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {tasks.map((t, idx) => {
                      const level = t.path ? t.path.split(" / ").length - 1 : 0;
                      const taskId = taskIds[idx] ?? String(idx + 1);
                      const isGroup = level === 0;
                      const isSubGroup = level === 1;

                      const rowBg = isGroup
                        ? "bg-indigo-500/5 hover:bg-indigo-500/10"
                        : isSubGroup
                          ? "bg-slate-500/5 hover:bg-slate-500/10 dark:bg-slate-400/5"
                          : "hover:bg-muted/30";
                      
                      const rowBorder = isGroup
                        ? "border-l-2 border-indigo-500/50"
                        : isSubGroup
                          ? "border-l-2 border-slate-500/30 dark:border-slate-400/30"
                          : "border-l-2 border-transparent";

                      return (
                      <tr key={idx} className={`${rowBg} ${rowBorder} transition-colors group`}>
                        <td className={`px-3 py-1.5 text-[10px] font-mono select-none text-center ${
                          isGroup ? "font-bold text-indigo-600 dark:text-indigo-400" : "font-medium text-muted-foreground/70"
                        }`}>
                          {taskId}
                        </td>
                        <td className="px-3 py-1.5" style={{ paddingLeft: `${12 + level * 20}px` }}>
                          <input
                            type="text"
                            value={t.title}
                            onChange={(e) => changeTask(idx, { title: e.target.value })}
                            placeholder="Tên task"
                            className={`w-full h-8 px-2.5 text-xs rounded-md bg-background border border-border/60 hover:border-border focus:border-primary focus:ring-1 focus:ring-primary/20 outline-none transition-all shadow-sm ${
                              isGroup ? "font-bold text-foreground" : isSubGroup ? "font-semibold text-foreground/90" : "font-medium text-foreground"
                            }`}
                          />
                        </td>
                        <td className="px-3 py-1.5 hidden md:table-cell">
                          <input
                            type="text"
                            value={t.details ?? ""}
                            onChange={(e) => changeTask(idx, { details: e.target.value })}
                            placeholder="Chi tiết"
                            className="w-full h-8 px-2.5 text-xs rounded-md bg-background border border-border/60 hover:border-border focus:border-primary focus:ring-1 focus:ring-primary/20 outline-none transition-all shadow-sm text-foreground"
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <select
                            value={t.pic ?? ""}
                            onChange={(e) => changeTask(idx, { pic: e.target.value })}
                            className="w-full h-8 px-2.5 text-xs rounded-md bg-background border border-border/60 hover:border-border focus:border-primary focus:ring-1 focus:ring-primary/20 outline-none transition-all shadow-sm text-foreground cursor-pointer"
                          >
                            <option value="">—</option>
                            {members.map((m, mi) => (
                              <option key={mi} value={m.name}>
                                {m.name} {m.roleName ? `(${m.roleName})` : ""}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-1.5 hidden lg:table-cell">
                          <select
                            value={t.support ?? ""}
                            onChange={(e) => changeTask(idx, { support: e.target.value })}
                            className="w-full h-8 px-2.5 text-xs rounded-md bg-background border border-border/60 hover:border-border focus:border-primary focus:ring-1 focus:ring-primary/20 outline-none transition-all shadow-sm text-foreground cursor-pointer"
                          >
                            <option value="">—</option>
                            {members.map((m, mi) => (
                              <option key={mi} value={m.name}>
                                {m.name} {m.roleName ? `(${m.roleName})` : ""}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-3 py-1.5">
                          <input
                            type="number"
                            min={0}
                            value={t.manday ?? ""}
                            onChange={(e) => changeTask(idx, { manday: e.target.value ? Number(e.target.value) : undefined })}
                            placeholder="1"
                            className="w-full h-8 px-2.5 text-xs rounded-md bg-background border border-border/60 hover:border-border focus:border-primary focus:ring-1 focus:ring-primary/20 outline-none transition-all shadow-sm text-foreground text-center"
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <input
                            type="date"
                            value={fmtDate(t.startDate)}
                            onChange={(e) => changeTask(idx, { startDate: e.target.value ? parseDateInput(e.target.value) : undefined })}
                            className="w-full h-8 px-2 text-[11px] rounded-md bg-background border border-border/60 hover:border-border focus:border-primary focus:ring-1 focus:ring-primary/20 outline-none transition-all shadow-sm text-foreground"
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <input
                            type="date"
                            value={fmtDate(t.endDate)}
                            onChange={(e) => changeTask(idx, { endDate: e.target.value ? parseDateInput(e.target.value) : undefined })}
                            className="w-full h-8 px-2 text-[11px] rounded-md bg-background border border-border/60 hover:border-border focus:border-primary focus:ring-1 focus:ring-primary/20 outline-none transition-all shadow-sm text-foreground"
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <select
                            value={t.status ?? ""}
                            onChange={(e) => changeTask(idx, { status: e.target.value })}
                            className="w-full h-8 px-2 text-[11px] rounded-md bg-background border border-border/60 hover:border-border focus:border-primary focus:ring-1 focus:ring-primary/20 outline-none transition-all shadow-sm text-foreground cursor-pointer"
                          >
                            <option value="">—</option>
                            <option value="todo">Chưa thực hiện</option>
                            <option value="processing">Đang xử lý</option>
                            <option value="pending">Chờ</option>
                            <option value="done">Đã xong</option>
                          </select>
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          <button
                            type="button"
                            onClick={() => setTasks((prev) => (prev ? prev.filter((_, i) => i !== idx) : prev))}
                            className="p-1.5 rounded-md text-rose-500 hover:bg-rose-500/10 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Xoá task"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );})}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 p-4 border-t border-border/40 bg-card/50 mt-auto shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            PIC/Support được assign tự động theo member dự án nếu thiếu.
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
            >
              Đóng
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={importing || !tasks || tasks.length === 0}
              className="inline-flex items-center gap-1.5 px-5 py-2 rounded-lg text-xs font-bold bg-primary text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer"
            >
              {importing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ListPlus className="w-4 h-4" />
              )}
              {taskCount > 0 ? `Import ${taskCount} task` : "Import task"}
            </button>
          </div>
        </div>
    </div>
  );
}