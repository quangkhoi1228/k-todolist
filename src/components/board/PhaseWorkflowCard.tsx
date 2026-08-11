"use client";

import { useState, useEffect, useRef } from "react";
import { Copy, Check, Send, Sparkles, MessageCircleQuestion, Target, Plus, X, Trash2, ChevronDown, Rocket, RefreshCw, ExternalLink, ListTodo } from "lucide-react";
import type { WorkflowRow, WorkflowRequirement } from "@/lib/repo/projectWorkflows";

// ─── Template constants ────────────────────────────────────
export const GREET_SALE_TEMPLATE = (ticketId?: string | null) =>
  `Chào anh/chị Sale ơi, em Khôi PM mới nhận ticket này${
    ticketId ? ` (https://servicedesk.fci.vn/browse/${ticketId})` : ""
  }. Vì đây là dự án mới nên em đang cần sync thông tin từ anh/chị về yêu cầu và phạm vi dự án để chuẩn bị triển khai cho đúng. Nhờ anh/chị giúp em thêm các thông tin sơ bộ: pre-sale phụ trách, nhóm nội bộ và nhóm khách hàng liên quan nhé ạ.`;

export const KICKOFF_QUESTION_TEMPLATES: Array<{ id: string; title: string }> = [
  {
    id: "scope",
    title:
      "Anh/chị cho em hỏi về phạm vi dự án: các hạng mục chính cần triển khai, mục tiêu dự án và yêu cầu bắt buộc (nếu có) là gì ạ?",
  },
  {
    id: "timeline",
    title: "Dự án có timeline dự kiến không ạ (ngày kick-off, ngày bàn giao, các mốc quan trọng)?",
  },
  {
    id: "tech",
    title: "Về mặt kỹ thuật: dự án dùng nền tảng/hạ tầng nào, team nội bộ đã có sẵn nhân sự hay cần phân bổ mới ạ?",
  },
  {
    id: "members",
    title: "Anh/chị giúp em xác nhận danh sách liên quan: Pre-sale, khách hàng, và các bên ngoài tham gia dự án ạ?",
  },
];

export const REQUIREMENT_INPUT_HINT =
  "Nhập yêu cầu sơ bộ dự án (mỗi dòng 1 yêu cầu, bắt buộc có tiêu đề). Sau khi lưu, hệ thống tự sinh task tracking tương ứng.";

interface PhaseWorkflowCardProps {
  project: { _id: string; name: string; ticketId?: string | null };
  userId?: string;
  workflow: WorkflowRow | null | undefined;
  loading?: boolean;
  onAction?: (step: string) => void;
  onUpdateWorkflow: (body: any) => Promise<any>;
  onUpdateStep: (stepKey: string, status: "done" | "skipped") => Promise<any>;
  onGenerateTasks: (items: Array<{ title: string; detail?: string; priority?: string }>, prefix?: string) => Promise<{ tasks?: any[] }>;
  onSwitchTab?: (tab: string) => void;
}

export function PhaseWorkflowCard({
  project,
  userId,
  workflow,
  loading,
  onUpdateWorkflow,
  onUpdateStep,
  onGenerateTasks,
  onSwitchTab,
}: PhaseWorkflowCardProps) {
  const [copied, setCopied] = useState(false);
  const [showPreinfo, setShowPreinfo] = useState(false);
  const [showQuestions, setShowQuestions] = useState(false);
  const [showRequirements, setShowRequirements] = useState(false);
  const [presale, setPresale] = useState("");
  const [externalGroups, setExternalGroups] = useState("");
  const [internalGroups, setInternalGroups] = useState("");
  const [selectedQuestions, setSelectedQuestions] = useState<string[]>([]);
  const [reqTitle, setReqTitle] = useState("");
  const [reqDetail, setReqDetail] = useState("");
  const [reqs, setReqs] = useState<WorkflowRequirement[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taskToast, setTaskToast] = useState<string | null>(null);
  const taskToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const phase = workflow?.phase ?? "init";
  const steps = (workflow?.steps ?? {}) as Record<string, string>;

  // Load dữ liệu từ workflow khi mở
  useEffect(() => {
    if (!workflow) return;
    const wfId = (workflow as any)._id;
    if (wfId === undefined) return;
    if (workflow.initData) {
      setPresale(workflow.initData.presale || "");
      setExternalGroups((workflow.initData.externalGroups || []).join("\n"));
      setInternalGroups((workflow.initData.internalGroups || []).join("\n"));
    }
    if (Array.isArray(workflow.kickoffQuestions)) {
      setSelectedQuestions(workflow.kickoffQuestions);
    }
    if (Array.isArray(workflow.requirements) && workflow.requirements.length > 0) {
      setReqs(workflow.requirements);
    }
  }, [(workflow as any)?._id]);

  useEffect(() => () => {
    if (taskToastTimer.current) clearTimeout(taskToastTimer.current);
  }, []);

  const showToast = (msg: string) => {
    setTaskToast(msg);
    if (taskToastTimer.current) clearTimeout(taskToastTimer.current);
    taskToastTimer.current = setTimeout(() => setTaskToast(null), 5000);
  };

  const copyGreet = async () => {
    await navigator.clipboard.writeText(GREET_SALE_TEMPLATE(project.ticketId));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const savePreinfo = async () => {
    if (!presale.trim() && !externalGroups.trim() && !internalGroups.trim()) {
      setError("Vui lòng nhập ít nhất 1 thông tin sơ bộ.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const initData = {
        presale: presale.trim(),
        externalGroups: externalGroups.split("\n").map((s) => s.trim()).filter(Boolean),
        internalGroups: internalGroups.split("\n").map((s) => s.trim()).filter(Boolean),
      };
      await onUpdateWorkflow({
        action: "updateWorkflowData",
        projectId: project._id,
        userId,
        patch: { initData },
      });
      await onUpdateStep("input_preinfo", "done");
      setShowPreinfo(false);
      showToast("Đã lưu thông tin sơ bộ. Bạn có thể chuyển sang Kick-off khi sẵn sàng.");
    } catch (e: any) {
      setError(e?.message || "Lưu thất bại");
    } finally {
      setSaving(false);
    }
  };

  const toggleQuestion = (id: string) => {
    setSelectedQuestions((prev) =>
      prev.includes(id) ? prev.filter((q) => q !== id) : [...prev, id]
    );
  };

  const saveQuestions = async () => {
    if (selectedQuestions.length === 0) {
      setError("Chọn ít nhất 1 câu hỏi để gửi cho Pre-sale/Sale.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onUpdateWorkflow({
        action: "updateWorkflowData",
        projectId: project._id,
        userId,
        patch: { kickoffQuestions: selectedQuestions },
      });
      await onUpdateStep("send_kickoff_questions", "done");
      setShowQuestions(false);
      showToast("Đã lưu câu hỏi kick-off. Dùng nút Gửi tin nhắn ở tab Chats để trao đổi với Pre-sale/Sale.");
    } catch (e: any) {
      setError(e?.message || "Lưu thất bại");
    } finally {
      setSaving(false);
    }
  };

  const addRequirement = () => {
    if (!reqTitle.trim()) return;
    setReqs((prev) => [
      ...prev,
      {
        id: `${Date.now()}`,
        title: reqTitle.trim(),
        detail: reqDetail.trim() || undefined,
        priority: "normal",
      },
    ]);
    setReqTitle("");
    setReqDetail("");
  };

  const saveRequirements = async () => {
    if (reqs.length === 0) {
      setError("Thêm ít nhất 1 yêu cầu sơ bộ.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onUpdateWorkflow({
        action: "updateWorkflowData",
        projectId: project._id,
        userId,
        patch: { requirements: reqs },
      });
      await onUpdateStep("input_requirements", "done");
      setShowRequirements(false);
      // Tự sinh task tracking từ yêu cầu
      const res = await onGenerateTasks(
        reqs.map((r) => ({ title: r.title, detail: r.detail, priority: r.priority })),
        "[Kickoff]"
      );
      const taskIds = (res?.tasks || []).map((t: any) => Number(t?.id)).filter(Boolean);
      if (taskIds.length > 0) {
        await onUpdateWorkflow({
          action: "updateWorkflowData",
          projectId: project._id,
          userId,
          patch: { taskIds },
        });
      }
      showToast(`Đã lưu yêu cầu sơ bộ và tự sinh ${taskIds.length} task tracking.`);
    } catch (e: any) {
      setError(e?.message || "Lưu thất bại");
    } finally {
      setSaving(false);
    }
  };

  const moveToKickoff = async () => {
    setSaving(true);
    setError(null);
    try {
      // Giữ nguyên trạng thái skipped của bước đã bỏ qua, chỉ đánh dấu done cho bước chưa có trạng thái
      const nextSteps: Record<string, string> = { ...steps };
      for (const k of ["greet_sale", "input_preinfo"] as const) {
        if (!nextSteps[k]) nextSteps[k] = "done";
      }
      await onUpdateWorkflow({
        action: "updateWorkflowPhase",
        projectId: project._id,
        userId,
        phase: "kickoff",
        patch: { steps: nextSteps },
      });
      showToast("Đã chuyển dự án sang Kick-off.");
    } catch (e: any) {
      setError(e?.message || "Chuyển phase thất bại");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground px-1 py-2">
        <span className="w-3.5 h-3.5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        Đang tải workflow...
      </div>
    );
  }

  const stepStatus = (key: string) => steps[key] || null;

  return (
    <div className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 via-transparent to-transparent p-2.5 space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Rocket className="w-3.5 h-3.5 text-primary" />
          <span className="text-[11px] font-bold text-foreground uppercase tracking-wide">
            Quy trình dự án
          </span>
          <span
            className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
              phase === "kickoff"
                ? "bg-violet-500/15 text-violet-600 dark:text-violet-400"
                : "bg-sky-500/15 text-sky-600 dark:text-sky-400"
            }`}
          >
            {phase === "kickoff" ? "Kick-off" : "Init"}
          </span>
        </div>
        {phase === "kickoff" && (
          <button
            type="button"
            onClick={() => onSwitchTab?.("history")}
            className="flex items-center gap-1 text-[9px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <ListTodo className="w-3 h-3" />
            Task tracking
          </button>
        )}
      </div>

      {error && (
        <div className="text-[10px] text-rose-500 bg-rose-500/10 border border-rose-500/20 rounded-lg px-2 py-1.5">
          {error}
        </div>
      )}

      {taskToast && (
        <div className="text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-2 py-1.5 flex items-center gap-1.5">
          <Check className="w-3 h-3 shrink-0" />
          {taskToast}
        </div>
      )}

      {/* ─── Phase Init ─────────────────────────────────────── */}
      {phase === "init" && (
        <div className="space-y-1.5">
          {/* Step 1: Greet sale */}
          <div
            className={`rounded-lg border p-2 ${
              stepStatus("greet_sale")
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-border/40 bg-background/60"
            }`}
          >
            <div className="flex items-center gap-1.5">
              <span
                className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${
                  stepStatus("greet_sale")
                    ? "bg-emerald-500 text-white"
                    : "bg-primary/15 text-primary"
                }`}
              >
                {stepStatus("greet_sale") ? <Check className="w-2.5 h-2.5" /> : "1"}
              </span>
              <span className="text-[10px] font-semibold text-foreground flex-1">
                Gửi tin nhắn chào Sale
              </span>
              {stepStatus("greet_sale") === "done" && (
                <span className="text-[8px] text-emerald-500 font-medium">Đã gửi</span>
              )}
            </div>
            <p className="text-[9px] text-muted-foreground mt-1 leading-relaxed">
              Mẫu tin nhắn chào sale, nhờ cung cấp thông tin sơ bộ dự án.
            </p>
            <div className="mt-1.5 rounded-md bg-muted/50 border border-border/30 p-1.5 text-[9px] text-foreground/80 leading-relaxed max-h-16 overflow-y-auto">
              {GREET_SALE_TEMPLATE(project.ticketId)}
            </div>
            <div className="flex gap-1.5 mt-1.5">
              <button
                type="button"
                onClick={copyGreet}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer"
              >
                {copied ? <Check className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
                {copied ? "Đã chép" : "Sao chép tin nhắn"}
              </button>
              <button
                type="button"
                onClick={() => onSwitchTab?.("chats")}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-medium border border-border/50 hover:bg-muted/30 transition-colors cursor-pointer"
              >
                <Send className="w-2.5 h-2.5" />
                Đến tab Chats
              </button>
              {!stepStatus("greet_sale") && (
                <button
                  type="button"
                  onClick={() => onUpdateStep("greet_sale", "done")}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-medium bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/25 transition-colors cursor-pointer"
                >
                  <Check className="w-2.5 h-2.5" />
                  Đã gửi
                </button>
              )}
            </div>
          </div>

          {/* Step 2: Pre-info */}
          <div
            className={`rounded-lg border p-2 ${
              stepStatus("input_preinfo")
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-border/40 bg-background/60"
            }`}
          >
            <div className="flex items-center gap-1.5">
              <span
                className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${
                  stepStatus("input_preinfo")
                    ? "bg-emerald-500 text-white"
                    : "bg-primary/15 text-primary"
                }`}
              >
                {stepStatus("input_preinfo") ? <Check className="w-2.5 h-2.5" /> : "2"}
              </span>
              <span className="text-[10px] font-semibold text-foreground flex-1">
                Nhập thông tin sơ bộ
              </span>
              {stepStatus("input_preinfo") === "done" && (
                <span className="text-[8px] text-emerald-500 font-medium">Đã lưu</span>
              )}
            </div>
            <p className="text-[9px] text-muted-foreground mt-1 leading-relaxed">
              Nhập pre-sale phụ trách, các nhóm external và internal liên quan để làm đầu vào
              cho giai đoạn kick-off.
            </p>
            {!stepStatus("input_preinfo") && (
              <>
                <button
                  type="button"
                  onClick={() => setShowPreinfo(!showPreinfo)}
                  className="mt-1.5 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-medium border border-border/50 hover:bg-muted/30 transition-colors cursor-pointer"
                >
                  <Target className="w-2.5 h-2.5" />
                  Nhập thông tin sơ bộ
                  <ChevronDown className={`w-2.5 h-2.5 transition-transform ${showPreinfo ? "rotate-180" : ""}`} />
                </button>
                {showPreinfo && (
                  <div className="mt-1.5 space-y-1.5">
                    <input
                      type="text"
                      value={presale}
                      onChange={(e) => setPresale(e.target.value)}
                      placeholder="Pre-sale phụ trách (tên / email)"
                      className="w-full h-6.5 px-2 py-1 text-[9px] rounded-md bg-background/80 border border-border/50 text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/50"
                    />
                    <textarea
                      value={externalGroups}
                      onChange={(e) => setExternalGroups(e.target.value)}
                      placeholder={"Nhóm external (khách hàng) — mỗi dòng 1 nhóm"}
                      rows={2}
                      className="w-full px-2 py-1 text-[9px] rounded-md bg-background/80 border border-border/50 text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/50 resize-none"
                    />
                    <textarea
                      value={internalGroups}
                      onChange={(e) => setInternalGroups(e.target.value)}
                      placeholder={"Nhóm internal (nội bộ) — mỗi dòng 1 nhóm"}
                      rows={2}
                      className="w-full px-2 py-1 text-[9px] rounded-md bg-background/80 border border-border/50 text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/50 resize-none"
                    />
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={savePreinfo}
                        disabled={saving}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[9px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {saving ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : <Check className="w-2.5 h-2.5" />}
                        Lưu thông tin
                      </button>
                      <button
                        type="button"
                        onClick={() => onUpdateStep("input_preinfo", "skipped")}
                        className="text-[9px] text-muted-foreground/60 hover:text-foreground transition-colors cursor-pointer"
                      >
                        Bỏ qua
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Transition to kickoff */}
          {stepStatus("greet_sale") && stepStatus("input_preinfo") ? (
            <button
              type="button"
              onClick={moveToKickoff}
              disabled={saving}
              className="w-full inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] font-bold bg-gradient-to-r from-sky-500 to-violet-500 text-white hover:opacity-90 transition-all cursor-pointer disabled:opacity-50 shadow-sm"
              title="Chỉ khi cả 2 bước trên đều đã xử lý (done hoặc bỏ qua)"
            >
              <Rocket className="w-3 h-3" />
              Chuyển sang Kick-off
            </button>
          ) : (
            <p className="text-[9px] text-muted-foreground/70 flex items-center gap-1">
              <Sparkles className="w-2.5 h-2.5 text-amber-500" />
              Hoàn thành 2 bước trên để chuyển sang giai đoạn Kick-off.
            </p>
          )}
        </div>
      )}

      {/* ─── Phase Kick-off ─────────────────────────────────── */}
      {phase === "kickoff" && (
        <div className="space-y-1.5">
          {/* Step 1: Kickoff questions */}
          <div
            className={`rounded-lg border p-2 ${
              stepStatus("send_kickoff_questions")
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-border/40 bg-background/60"
            }`}
          >
            <div className="flex items-center gap-1.5">
              <span
                className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${
                  stepStatus("send_kickoff_questions")
                    ? "bg-emerald-500 text-white"
                    : "bg-primary/15 text-primary"
                }`}
              >
                {stepStatus("send_kickoff_questions") ? <Check className="w-2.5 h-2.5" /> : "1"}
              </span>
              <span className="text-[10px] font-semibold text-foreground flex-1">
                Gửi câu hỏi cho Pre-sale / Sale
              </span>
              {stepStatus("send_kickoff_questions") === "done" && (
                <span className="text-[8px] text-emerald-500 font-medium">Đã lưu</span>
              )}
            </div>
            <p className="text-[9px] text-muted-foreground mt-1 leading-relaxed">
              Gợi ý câu hỏi thu thập thông tin dự án từ Pre-sale và Sale trước khi triển khai.
            </p>
            {!stepStatus("send_kickoff_questions") && (
              <>
                <button
                  type="button"
                  onClick={() => setShowQuestions(!showQuestions)}
                  className="mt-1.5 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-medium border border-border/50 hover:bg-muted/30 transition-colors cursor-pointer"
                >
                  <MessageCircleQuestion className="w-2.5 h-2.5" />
                  Chọn câu hỏi gửi
                  <ChevronDown className={`w-2.5 h-2.5 transition-transform ${showQuestions ? "rotate-180" : ""}`} />
                </button>
                {showQuestions && (
                  <div className="mt-1.5 space-y-1">
                    {KICKOFF_QUESTION_TEMPLATES.map((q) => {
                      const checked = selectedQuestions.includes(q.title);
                      return (
                        <button
                          key={q.id}
                          type="button"
                          onClick={() => toggleQuestion(q.title)}
                          className={`w-full flex items-start gap-1.5 px-1.5 py-1 text-left rounded-md border transition-colors cursor-pointer ${
                            checked
                              ? "border-primary/40 bg-primary/5"
                              : "border-border/30 hover:bg-muted/30"
                          }`}
                        >
                          <span
                            className={`w-3 h-3 rounded border flex items-center justify-center shrink-0 mt-px ${
                              checked
                                ? "bg-primary border-primary text-white"
                                : "border-border bg-transparent"
                            }`}
                          >
                            {checked && <Check className="w-2 h-2" />}
                          </span>
                          <span className="text-[9px] text-foreground/80 leading-relaxed">{q.title}</span>
                        </button>
                      );
                    })}
                    <div className="flex items-center justify-between pt-1">
                      <button
                        type="button"
                        onClick={saveQuestions}
                        disabled={saving}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[9px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {saving ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : <Check className="w-2.5 h-2.5" />}
                        Lưu câu hỏi
                      </button>
                      <button
                        type="button"
                        onClick={() => onUpdateStep("send_kickoff_questions", "skipped")}
                        className="text-[9px] text-muted-foreground/60 hover:text-foreground transition-colors cursor-pointer"
                      >
                        Bỏ qua
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
            {stepStatus("send_kickoff_questions") === "done" && (
              <div className="mt-1.5 space-y-0.5">
                {(workflow?.kickoffQuestions || []).map((q, i) => (
                  <p key={i} className="text-[9px] text-muted-foreground/80 leading-relaxed">
                    • {q}
                  </p>
                ))}
              </div>
            )}
          </div>

          {/* Step 2: Input requirements */}
          <div
            className={`rounded-lg border p-2 ${
              stepStatus("input_requirements")
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-border/40 bg-background/60"
            }`}
          >
            <div className="flex items-center gap-1.5">
              <span
                className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${
                  stepStatus("input_requirements")
                    ? "bg-emerald-500 text-white"
                    : "bg-primary/15 text-primary"
                }`}
              >
                {stepStatus("input_requirements") ? <Check className="w-2.5 h-2.5" /> : "2"}
              </span>
              <span className="text-[10px] font-semibold text-foreground flex-1">
                Nhập yêu cầu sơ bộ dự án
              </span>
              {stepStatus("input_requirements") === "done" && (
                <span className="text-[8px] text-emerald-500 font-medium">Đã lưu</span>
              )}
            </div>
            <p className="text-[9px] text-muted-foreground mt-1 leading-relaxed">
              Yêu cầu sơ bộ là input của dự án — sau khi lưu, hệ thống tự sinh task tracking
              cho từng yêu cầu.
            </p>
            {!stepStatus("input_requirements") && (
              <>
                <button
                  type="button"
                  onClick={() => setShowRequirements(!showRequirements)}
                  className="mt-1.5 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-medium border border-border/50 hover:bg-muted/30 transition-colors cursor-pointer"
                >
                  <Target className="w-2.5 h-2.5" />
                  Nhập yêu cầu sơ bộ
                  <ChevronDown className={`w-2.5 h-2.5 transition-transform ${showRequirements ? "rotate-180" : ""}`} />
                </button>
                {showRequirements && (
                  <div className="mt-1.5 space-y-1.5">
                    <div className="flex gap-1">
                      <input
                        type="text"
                        value={reqTitle}
                        onChange={(e) => setReqTitle(e.target.value)}
                        placeholder="Tiêu đề yêu cầu (bắt buộc)"
                        className="flex-1 h-6.5 px-2 py-1 text-[9px] rounded-md bg-background/80 border border-border/50 text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/50"
                      />
                      <button
                        type="button"
                        onClick={addRequirement}
                        disabled={!reqTitle.trim()}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[9px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer disabled:opacity-40"
                      >
                        <Plus className="w-2.5 h-2.5" />
                        Thêm
                      </button>
                    </div>
                    <textarea
                      value={reqDetail}
                      onChange={(e) => setReqDetail(e.target.value)}
                      placeholder="Chi tiết / mô tả yêu cầu (không bắt buộc)"
                      rows={2}
                      className="w-full px-2 py-1 text-[9px] rounded-md bg-background/80 border border-border/50 text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/50 resize-none"
                    />
                    {reqs.length > 0 && (
                      <div className="space-y-0.5 max-h-24 overflow-y-auto">
                        {reqs.map((r) => (
                          <div
                            key={r.id}
                            className="flex items-start gap-1.5 rounded-md border border-border/30 bg-background/60 px-1.5 py-1"
                          >
                            <span className="flex-1 text-[9px] text-foreground/90 leading-snug">
                              {r.title}
                              {r.detail && (
                                <span className="block text-muted-foreground/70">{r.detail}</span>
                              )}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setReqs((prev) => prev.filter((x) => x.id !== r.id))
                              }
                              className="p-0.5 rounded text-muted-foreground/50 hover:text-rose-500 transition-colors cursor-pointer shrink-0"
                            >
                              <Trash2 className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={saveRequirements}
                        disabled={saving || reqs.length === 0}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[9px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {saving ? <RefreshCw className="w-2.5 h-2.5 animate-spin" /> : <Check className="w-2.5 h-2.5" />}
                        Lưu & sinh task tracking
                      </button>
                      <button
                        type="button"
                        onClick={() => onUpdateStep("input_requirements", "skipped")}
                        className="text-[9px] text-muted-foreground/60 hover:text-foreground transition-colors cursor-pointer"
                      >
                        Bỏ qua
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Generated tasks */}
          {(workflow?.taskIds || []).length > 0 && (
            <div className="rounded-lg border border-border/40 bg-background/60 p-2">
              <div className="flex items-center gap-1.5 mb-1">
                <ListTodo className="w-3 h-3 text-primary" />
                <span className="text-[9px] font-semibold text-foreground">
                  Task tracking tự sinh ({workflow?.taskIds?.length})
                </span>
                <button
                  type="button"
                  onClick={() => onSwitchTab?.("history")}
                  className="ml-auto flex items-center gap-0.5 text-[8px] text-primary hover:underline transition-colors cursor-pointer"
                >
                  Xem
                  <ExternalLink className="w-2 h-2" />
                </button>
              </div>
              <p className="text-[8px] text-muted-foreground/60 leading-relaxed">
                Output của các task này chính là input của dự án — cập nhật kết quả trong tab
                Lịch sử / Tasks.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
