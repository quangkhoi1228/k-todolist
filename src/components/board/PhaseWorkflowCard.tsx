"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { Copy, Check, Send, Sparkles, MessageCircleQuestion, Target, Plus, X, Trash2, ChevronDown, Rocket, RefreshCw, ExternalLink, ListTodo, RotateCcw, Loader2 } from "lucide-react";
import type { WorkflowRow, WorkflowRequirement, WorkflowGroupRef } from "@/lib/repo/projectWorkflows";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const TeamsIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className={className}>
    <path fill="#5059C9" d="M37 15.5A7.5 7.5 0 1 0 22 15.5A7.5 7.5 0 1 0 37 15.5z"/>
    <path fill="#7B83EB" d="M12 24.5a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0-13 0z"/>
    <path fill="#5059C9" d="M38 36H24c0-4.4 3.6-8 8-8h2c4.4 0 8 3.6 8 8z"/>
    <path fill="#7B83EB" d="M26 36H10c0-4.4 3.6-8 8-8h2c4.4 0 8 3.6 8 8z"/>
    <path fill="#5059C9" d="M21 21h12v12H21z"/>
    <path fill="#FFF" d="M25 24h1.5v6h1.5v-6H29.5v-1.5h-4.5z"/>
  </svg>
);

const ZaloIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" className={className}>
    <path fill="#0068FF" d="M24 4C12.95 4 4 12.06 4 22c0 5.43 2.76 10.3 7.15 13.5l-2.03 6.32c-.31.97.77 1.79 1.63 1.27l7.35-4.43c1.86.38 3.83.59 5.9.59c11.05 0 20-8.06 20-18S35.05 4 24 4z"/>
    <path fill="#FFF" d="M15 28.5V26l4.5-5.5H15v-2.5h8v2.5L18.5 26h4.5v2.5h-8zm11-7c0-2 2-2 2-2s2 0 2 2v5s0 2-2 2s-2 0-2-2v-5zm2.5 5c0 .5-.5.5-.5.5s-.5 0-.5-.5v-5c0-.5.5-.5.5-.5s.5 0 .5.5v5zm4 2v-7h2.5v7h-2.5z"/>
  </svg>
);

/** Một dòng nhóm trong form thông tin sơ bộ (bản local, chưa lưu) */
interface PendingGroupRow {
  id: string;
  name: string;
  platform: "teams" | "zalo";
  type: "internal" | "customer";
}

// ─── Template constants ────────────────────────────────────
/** Xưng hô theo giới tính: "anh" | "chị" | "anh/chị" (chưa rõ) */
type SaleGender = "anh" | "chị" | "anh/chị";

/**
 * Mẫu tin nhắn chào Sale — nhận tên Sale + giới tính để xưng hô chính xác.
 * @param saleName Tên Sale (reporter ISD); bỏ trống → dùng "Sale"
 * @param gender   "anh" | "chị" | "anh/chị" (mặc định "anh/chị" khi chưa rõ)
 */
export const GREET_SALE_TEMPLATE = (
  saleName?: string | null,
  gender: SaleGender = "anh/chị",
  ticketId?: string | null
) => {
  const name = saleName?.trim() ? saleName.trim() : "Sale";
  const you = gender === "anh/chị" ? "anh/chị" : gender;
  const ticketPart = ticketId ? ` (https://servicedesk.fci.vn/browse/${ticketId})` : "";
  return `Chào ${you} ${name}, em Khôi PM CDC ạ. Em mới được giao phụ trách ticket này${ticketPart} ạ. Dự án mới nên em chưa có nhiều thông tin, nhờ ${you} bớt chút thời gian chia sẻ giúp em về yêu cầu, pre-sale phụ trách và add giúp em vào các nhóm nội bộ/khách hàng nhé ạ. Em cảm ơn ${you} nhiều!`;
};

/**
 * Bản tin nhắn thuần text (không link) — dùng prefill deep link Teams,
 * vì link ticket trong `message` param có thể bị Teams render thành văn bản thô.
 */
export const GREET_SALE_TEMPLATE_TEXT = (
  saleName?: string | null,
  gender: SaleGender = "anh/chị",
  ticketId?: string | null
) => {
  const name = saleName?.trim() ? saleName.trim() : "Sale";
  const you = gender === "anh/chị" ? "anh/chị" : gender;
  const ticketPart = ticketId ? ` (ticket ${ticketId})` : "";
  return `Chào ${you} ${name}, em Khôi PM CDC ạ. Em mới được giao phụ trách ticket này${ticketPart} ạ. Dự án mới nên em chưa có nhiều thông tin, nhờ ${you} bớt chút thời gian chia sẻ giúp em về yêu cầu, pre-sale phụ trách và add giúp em vào các nhóm nội bộ/khách hàng nhé ạ. Em cảm ơn ${you} nhiều!`;
};

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
  /** Tên Sale (reporter ISD) — dùng để xưng hô đúng giới tính trong tin nhắn chào */
  saleName?: string | null;
  /** Email Sale (reporter ISD) — nút deep link Teams mở chat 1:1 với đúng người */
  saleEmail?: string | null;
  workflow: WorkflowRow | null | undefined;
  loading?: boolean;
  onAction?: (step: string) => void;
  onUpdateWorkflow: (body: any) => Promise<any>;
  /** Cập nhật trạng thái bước; status null → xoá (trở về chưa xử lý) */
  onUpdateStep: (stepKey: string, status: "done" | "skipped" | null) => Promise<any>;
  onGenerateTasks: (items: Array<{ title: string; detail?: string; priority?: string }>, prefix?: string) => Promise<{ tasks?: any[] }>;
  onSwitchTab?: (tab: string) => void;
  /** Tải danh sách nhóm Teams/Zalo (thường là list_chats của automator) */
  fetchChatLists?: (platforms?: ("teams" | "zalo")[]) => Promise<Record<"teams" | "zalo", string[]>>;
  /** Lưu nhóm đã chọn vào dự án (teamsGroups) — không bắt buộc, nếu có sẽ tự động sync */
  onSaveGroups?: (groups: WorkflowGroupRef[]) => Promise<void>;
}

export function PhaseWorkflowCard({
  project,
  userId,
  saleName,
  saleEmail,
  workflow,
  loading,
  onUpdateWorkflow,
  onUpdateStep,
  onGenerateTasks,
  onSwitchTab,
  fetchChatLists,
  onSaveGroups,
}: PhaseWorkflowCardProps) {
  const [copied, setCopied] = useState(false);
  const [showPreinfo, setShowPreinfo] = useState(false);
  const [showQuestions, setShowQuestions] = useState(false);
  const [showRequirements, setShowRequirements] = useState(false);
  const [presale, setPresale] = useState("");
  // ─── Form chọn nhóm (kiểu "Thêm nhóm": nền tảng Teams/Zalo + dropdown gợi ý) ───
  const [groupRows, setGroupRows] = useState<PendingGroupRow[]>([]);
  const [chatOptions, setChatOptions] = useState<Record<"teams" | "zalo", string[]>>({ teams: [], zalo: [] });
  const [loadingChats, setLoadingChats] = useState(false);
  const [chatsError, setChatsError] = useState<string | null>(null);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [dropdownAnchor, setDropdownAnchor] = useState<{ top: number; left: number; width: number } | null>(null);
  const groupRowsRef = useRef<HTMLDivElement | null>(null);
  const [selectedQuestions, setSelectedQuestions] = useState<string[]>([]);
  const [reqTitle, setReqTitle] = useState("");
  const [reqDetail, setReqDetail] = useState("");
  const [reqs, setReqs] = useState<WorkflowRequirement[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taskToast, setTaskToast] = useState<string | null>(null);
  const taskToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Collapse từng bước: bước done sẽ auto collapse, bước đang làm mặc định mở ───
  const [collapsedSteps, setCollapsedSteps] = useState<Record<string, boolean>>({});

  // Bước được đánh dấu done (từ nút "Đã gửi"/"Đã lưu" hoặc "Bỏ qua") → collapse gọn lại
  const markStepCollapsed = (key: string) =>
    setCollapsedSteps((prev) => ({ ...prev, [key]: true }));

  /** Toggle done ↔ chưa done: done → xoá status (trở về chưa xử lý, mở lại step); chưa done → done + collapse */
  const toggleStepDone = async (key: string) => {
    const status = stepStatus(key);
    if (status) {
      await onUpdateStep(key, null);
    } else {
      await onUpdateStep(key, "done");
      markStepCollapsed(key);
    }
  };

  // ─── Thông tin Sale (từ ISD) + xưng hô theo giới tính ───
  /** Detect giới tính từ tên Việt Nam (giới hạn mẫu thường gặp, không gọi LLM ở client). */
  const detectGenderByName = (rawName?: string | null): SaleGender => {
    const name = (rawName || "").trim();
    if (!name) return "anh/chị";
    const lower = name.toLowerCase();

    // Quy tắc rõ ràng nhất: "Thị"/"Thi" ở giữa → nữ
    if (/\bth[ịi]\b/.test(lower) && !/\bth[ịi]ch\b/.test(lower)) return "chị";
    // Tên đệm rõ giới tính
    if (/\b(?:văn|hữu|đức|quang|minh|tuấn|hùng|long|nam|khánh|duy|hoàng)\b/.test(lower)) return "anh";
    if (/\b(?:thị|thu|hồng|ngọc|lan|hương|linh|ngân|trang|thảo|nhung|hằng|phương|mai|oanh|hà)\b/.test(lower)) return "chị";
    // Tên chính (từ cuối) thường gặp
    const firstName = (name.split(/\s+/).pop() || "").toLowerCase();
    if (firstName === "trang" || firstName === "lan" || firstName === "thảo" || firstName === "hương" || firstName === "ngân" || firstName === "nhung" || firstName === "oanh" || firstName === "hồng" || firstName === "mai" || firstName === "thu" || firstName === "linh" || firstName === "ngọc" || firstName === "hà" || firstName === "phương" || firstName === "hằng" || firstName === "minh") return "chị";
    if (firstName === "hùng" || firstName === "long" || firstName === "nam" || firstName === "tuấn" || firstName === "đức" || firstName === "quang" || firstName === "văn" || firstName === "hữu" || firstName === "duy" || firstName === "khánh" || firstName === "hoàng") return "anh";
    return "anh/chị";
  };

  // Lazy init từ saleName (đã có ISD data) + cập nhật khi ISD load muộn
  const [saleGender, setSaleGender] = useState<SaleGender>(() => detectGenderByName(saleName));

  useEffect(() => {
    setSaleGender(detectGenderByName(saleName));
  }, [saleName]);

  const greetMessage = GREET_SALE_TEMPLATE(saleName, saleGender, project.ticketId);
  const greetMessageText = GREET_SALE_TEMPLATE_TEXT(saleName, saleGender, project.ticketId);

  /** Deep link Teams mở chat 1:1 với Sale (users=<email>) + tự điền tin nhắn vào ô soạn thảo */
  const teamsDeepLink = saleEmail?.trim()
    ? `https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(saleEmail.trim())}&message=${encodeURIComponent(greetMessageText)}`
    : undefined;

  const phase = workflow?.phase ?? "init";
  const steps = (workflow?.steps ?? {}) as Record<string, string>;
  const stepStatus = (key: string) => steps[key] || null;

  // Load dữ liệu từ workflow khi mở
  useEffect(() => {
    if (!workflow) return;
    const wfId = (workflow as any)._id;
    if (wfId === undefined) return;
    if (workflow.initData) {
      setPresale(workflow.initData.presale || "");
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
    await navigator.clipboard.writeText(greetMessage);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const savePreinfo = async () => {
    const validRows = groupRows.filter((r) => r.name.trim());
    const toRef = (r: PendingGroupRow): WorkflowGroupRef => ({ name: r.name.trim(), platform: r.platform });
    const extGroups = validRows.filter((r) => r.type === "customer").map(toRef);
    const intGroups = validRows.filter((r) => r.type === "internal").map(toRef);
    if (!presale.trim() && validRows.length === 0) {
      setError("Vui lòng nhập ít nhất 1 thông tin sơ bộ.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const initData = {
        presale: presale.trim(),
        externalGroups: extGroups,
        internalGroups: intGroups,
      };
      await onUpdateWorkflow({
        action: "updateWorkflowData",
        projectId: project._id,
        userId,
        patch: { initData },
      });
      // Đồng bộ nhóm đã chọn vào dự án (teamsGroups) nếu parent cung cấp handler
      if (onSaveGroups && validRows.length > 0) {
        await onSaveGroups(validRows.map(toRef));
      }
      await onUpdateStep("input_preinfo", "done");
      setShowPreinfo(false);
      markStepCollapsed("input_preinfo");
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
      markStepCollapsed("send_kickoff_questions");
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

  // ─── Form chọn nhóm: state sync từ workflow + list chats + dropdown portal ───
  const groupRefs = useMemo(() => {
    const rows: PendingGroupRow[] = [];
    const push = (groups: unknown, platform: "teams" | "zalo", type: "internal" | "customer") => {
      if (!Array.isArray(groups)) return;
      for (const g of groups) {
        if (!g) continue;
        if (typeof g === "string") {
          const n = g.trim();
          if (n) rows.push({ id: crypto.randomUUID(), name: n, platform, type });
        } else if (typeof g === "object" && (g as any).name) {
          const n = String((g as any).name).trim();
          if (n) rows.push({ id: crypto.randomUUID(), name: n, platform: (g as any).platform ?? platform, type });
        }
      }
    };
    push(workflow?.initData?.externalGroups, "teams", "customer");
    push(workflow?.initData?.internalGroups, "teams", "internal");
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(workflow as any)?._id]);

  useEffect(() => {
    setGroupRows(groupRefs);
    setOpenDropdownId(null);
    setDropdownAnchor(null);
  }, [groupRefs]);

  const ensureChatOptions = useCallback(
    async (platforms?: ("teams" | "zalo")[]) => {
      if (!fetchChatLists) return;
      setLoadingChats(true);
      setChatsError(null);
      try {
        const result = await fetchChatLists(platforms);
        setChatOptions((prev) => ({
          teams: result.teams ?? prev.teams,
          zalo: result.zalo ?? prev.zalo,
        }));
      } catch (e: any) {
        setChatsError(e?.message || "Không tải được danh sách nhóm");
      } finally {
        setLoadingChats(false);
      }
    },
    [fetchChatLists]
  );

  const updateDropdownAnchor = useCallback((rowId: string) => {
    const input = document.querySelector(`[data-preinfo-group-input="${rowId}"]`) as HTMLElement | null;
    if (!input) return;
    const rect = input.getBoundingClientRect();
    setDropdownAnchor({ top: rect.bottom + 4, left: rect.left, width: rect.width });
  }, []);

  const addGroupRow = useCallback(
    (platform: "teams" | "zalo") => {
      const newId = crypto.randomUUID();
      setGroupRows((prev) => [...prev, { id: newId, name: "", platform, type: "customer" }]);
      setOpenDropdownId(newId);
      setDropdownAnchor(null);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => updateDropdownAnchor(newId));
      });
    },
    [updateDropdownAnchor]
  );

  // Khi mở form chọn nhóm lần đầu → tải sẵn danh sách chat
  useEffect(() => {
    if (showPreinfo && chatOptions.teams.length === 0 && chatOptions.zalo.length === 0) {
      ensureChatOptions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPreinfo]);

  const updateGroupRow = (id: string, patch: Partial<PendingGroupRow>) => {
    setGroupRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
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
      markStepCollapsed("input_requirements");
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
      <div className="flex items-center gap-2 text-sm text-muted-foreground px-4 py-4">
        <span className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        Đang tải workflow...
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-transparent to-transparent p-5 space-y-4 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Rocket className="w-5 h-5 text-primary" />
          <span className="text-base font-bold text-foreground uppercase tracking-wider">
            Quy trình dự án
          </span>
          <span
            className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
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
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <ListTodo className="w-4 h-4" />
            Task tracking
          </button>
        )}
      </div>

      {error && (
        <div className="text-sm text-rose-500 bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3 shadow-sm">
          {error}
        </div>
      )}

      {taskToast && (
        <div className="text-sm text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3 flex items-center gap-2 shadow-sm">
          <Check className="w-4 h-4 shrink-0" />
          {taskToast}
        </div>
      )}

      {/* ─── Phase Init ─────────────────────────────────────── */}
      {phase === "init" && (
        <div className="space-y-4">
          {/* Step 1: Greet sale */}
          <div
            className={`rounded-xl border p-4 transition-colors ${
              stepStatus("greet_sale")
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-border/60 bg-background/60 shadow-sm"
            }`}
          >
            <div
              className="flex items-center gap-2.5 cursor-pointer select-none"
              onClick={() => setCollapsedSteps((prev) => ({ ...prev, greet_sale: !prev.greet_sale }))}
              title={collapsedSteps.greet_sale ? "Mở rộng bước này" : "Thu gọn bước này"}
            >
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                  stepStatus("greet_sale")
                    ? "bg-emerald-500 text-white"
                    : "bg-primary/15 text-primary"
                }`}
              >
                {stepStatus("greet_sale") ? <Check className="w-3.5 h-3.5" /> : "1"}
              </span>
              <span className="text-sm font-semibold text-foreground flex-1">
                Gửi tin nhắn chào Sale
              </span>
              {stepStatus("greet_sale") === "done" ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleStepDone("greet_sale");
                  }}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10 transition-colors cursor-pointer"
                  title="Chưa gửi? Nhấn để quay lại trạng thái chưa xử lý"
                >
                  <RotateCcw className="w-3 h-3" />
                  Hoàn tác
                </button>
              ) : (
                stepStatus("greet_sale") === "skipped" && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleStepDone("greet_sale");
                    }}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10 transition-colors cursor-pointer"
                    title="Bỏ qua đã huỷ — nhấn để quay lại trạng thái chưa xử lý"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Hoàn tác
                  </button>
                )
              )}
              <ChevronDown
                className={`w-4 h-4 text-muted-foreground/60 transition-transform shrink-0 ${
                  collapsedSteps.greet_sale ? "" : "rotate-180"
                }`}
              />
            </div>
            {!collapsedSteps.greet_sale && (
              <>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed ml-[34px]">
                  Mẫu tin nhắn chào sale, nhờ cung cấp thông tin sơ bộ dự án.
                </p>
                <div className="mt-3 ml-[34px] rounded-lg bg-muted/50 border border-border/40 p-3 text-sm text-foreground/80 leading-relaxed max-h-32 overflow-y-auto">
                  {greetMessage}
                </div>
                <div className="flex flex-wrap gap-2 mt-3 ml-[34px]">
                  <button
                    type="button"
                    onClick={copyGreet}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer"
                  >
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {copied ? "Đã chép" : "Sao chép tin nhắn"}
                  </button>
                  {teamsDeepLink && (
                    <a
                      href={teamsDeepLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-500/30 hover:bg-sky-500/20 transition-colors cursor-pointer"
                      title={`Mở chat Teams với Sale: ${saleEmail} — tin nhắn được điền sẵn vào ô soạn thảo`}
                    >
                      <Send className="w-4 h-4" />
                      Gửi tin nhắn qua Teams
                    </a>
                  )}
                  {!stepStatus("greet_sale") && (
                    <button
                      type="button"
                      onClick={() => toggleStepDone("greet_sale")}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/25 transition-colors cursor-pointer"
                    >
                      <Check className="w-4 h-4" />
                      Đã gửi
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Step 2: Pre-info */}
          <div
            className={`rounded-xl border p-4 transition-colors ${
              stepStatus("input_preinfo")
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-border/60 bg-background/60 shadow-sm"
            }`}
          >
            <div
              className="flex items-center gap-2.5 cursor-pointer select-none"
              onClick={() => setCollapsedSteps((prev) => ({ ...prev, input_preinfo: !prev.input_preinfo }))}
              title={collapsedSteps.input_preinfo ? "Mở rộng bước này" : "Thu gọn bước này"}
            >
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                  stepStatus("input_preinfo")
                    ? "bg-emerald-500 text-white"
                    : "bg-primary/15 text-primary"
                }`}
              >
                {stepStatus("input_preinfo") ? <Check className="w-3.5 h-3.5" /> : "2"}
              </span>
              <span className="text-sm font-semibold text-foreground flex-1">
                Nhập thông tin sơ bộ
              </span>
              {stepStatus("input_preinfo") ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleStepDone("input_preinfo");
                  }}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10 transition-colors cursor-pointer"
                  title="Nhấn để quay lại trạng thái chưa xử lý"
                >
                  <RotateCcw className="w-3 h-3" />
                  Hoàn tác
                </button>
              ) : (
                <ChevronDown
                  className={`w-4 h-4 text-muted-foreground/60 transition-transform shrink-0 ${
                    collapsedSteps.input_preinfo ? "" : "rotate-180"
                  }`}
                />
              )}
            </div>
            {!collapsedSteps.input_preinfo && (
              <>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed ml-[34px]">
                  Nhập pre-sale phụ trách, các nhóm external và internal liên quan để làm đầu vào
                  cho giai đoạn kick-off.
                </p>
                {/* Hiển thị tóm tắt nhóm đã chọn (sau khi done) */}
                {stepStatus("input_preinfo") && (() => {
                  const summarize = (groups: unknown): string[] => {
                    if (!Array.isArray(groups)) return [];
                    return groups.map((g) => {
                      if (typeof g === "string") return g.trim();
                      if (g && typeof g === "object" && (g as any).name) return String((g as any).name).trim();
                      return "";
                    }).filter(Boolean);
                  };
                  const ext = summarize(workflow?.initData?.externalGroups);
                  const int = summarize(workflow?.initData?.internalGroups);
                  if (ext.length === 0 && int.length === 0 && !workflow?.initData?.presale) return null;
                  return (
                    <div className="ml-[34px] mt-3 rounded-lg bg-muted/50 border border-border/40 p-3 text-sm space-y-1.5">
                      {workflow?.initData?.presale && (
                        <p className="flex items-start gap-2 leading-relaxed">
                          <span className="text-primary mt-0.5 shrink-0">•</span>
                          <span><b className="font-medium">Pre-sale:</b> {workflow.initData.presale}</span>
                        </p>
                      )}
                      {ext.length > 0 && (
                        <p className="flex items-start gap-2 leading-relaxed">
                          <span className="text-primary mt-0.5 shrink-0">•</span>
                          <span><b className="font-medium">Nhóm khách hàng:</b> {ext.join(", ")}</span>
                        </p>
                      )}
                      {int.length > 0 && (
                        <p className="flex items-start gap-2 leading-relaxed">
                          <span className="text-primary mt-0.5 shrink-0">•</span>
                          <span><b className="font-medium">Nhóm nội bộ:</b> {int.join(", ")}</span>
                        </p>
                      )}
                    </div>
                  );
                })()}
                {!stepStatus("input_preinfo") && (
                  <div className="ml-[34px] mt-3">
                    <button
                      type="button"
                      onClick={() => setShowPreinfo(!showPreinfo)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-border/50 hover:bg-muted/50 transition-colors cursor-pointer"
                    >
                      <Target className="w-4 h-4" />
                      Nhập thông tin sơ bộ
                      <ChevronDown className={`w-4 h-4 transition-transform ${showPreinfo ? "rotate-180" : ""}`} />
                    </button>
                    {showPreinfo && (
                      <div className="mt-3 space-y-3">
                        <input
                          type="text"
                          value={presale}
                          onChange={(e) => setPresale(e.target.value)}
                          placeholder="Pre-sale phụ trách (tên / email)"
                          className="w-full h-10 px-3 py-2 text-sm rounded-lg bg-background/80 border border-border/50 text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all"
                        />

                        {/* Chọn nhóm — giống dialog "Thêm nhóm": nền tảng Teams/Zalo + dropdown gợi ý */}
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <label className="text-xs font-medium text-foreground/70">
                              Nhóm dự án (nội bộ / khách hàng)
                            </label>
                            <button
                              type="button"
                              onClick={() => ensureChatOptions()}
                              disabled={loadingChats}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50 cursor-pointer"
                            >
                              {loadingChats ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                              Tải danh sách nhóm (Teams + Zalo)
                            </button>
                          </div>
                          {chatsError && (
                            <p className="text-[11px] text-rose-500 bg-rose-500/10 border border-rose-500/20 rounded-lg px-2.5 py-1.5 mb-1.5">
                              {chatsError}
                            </p>
                          )}
                          <div
                            ref={groupRowsRef}
                            className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar pr-1"
                            onScroll={() => openDropdownId && updateDropdownAnchor(openDropdownId)}
                          >
                            {groupRows.map((row) => {
                              const options = row.platform === "zalo" ? chatOptions.zalo : chatOptions.teams;
                              const matches = options.filter((c) =>
                                c.toLowerCase().includes(row.name.toLowerCase())
                              );
                              return (
                                <div key={row.id} className="flex gap-2 items-start">
                                  <div className="w-[110px] shrink-0 space-y-1">
                                    <label className="text-[10px] font-medium text-foreground/60">Nền tảng</label>
                                    <Select
                                      value={row.platform}
                                      onValueChange={(value) => {
                                        const platform = value as "teams" | "zalo";
                                        updateGroupRow(row.id, { platform });
                                        setOpenDropdownId(row.id);
                                        updateDropdownAnchor(row.id);
                                      }}
                                    >
                                      <SelectTrigger className="w-full h-[30px] text-xs bg-background border border-border focus:ring-1 focus:ring-primary/50 shadow-none">
                                        <span className="flex flex-1 items-center gap-1.5 text-left truncate min-w-0">
                                          {row.platform === "teams" ? (
                                            <>
                                              <TeamsIcon className="w-4 h-4" />
                                              <span>Teams</span>
                                            </>
                                          ) : row.platform === "zalo" ? (
                                            <>
                                              <ZaloIcon className="w-4 h-4" />
                                              <span>Zalo</span>
                                            </>
                                          ) : (
                                            "Nền tảng"
                                          )}
                                        </span>
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="teams" className="text-xs">
                                          <div className="flex items-center gap-2">
                                            <TeamsIcon className="w-4 h-4" />
                                            <span>Teams</span>
                                          </div>
                                        </SelectItem>
                                        <SelectItem value="zalo" className="text-xs">
                                          <div className="flex items-center gap-2">
                                            <ZaloIcon className="w-4 h-4" />
                                            <span>Zalo</span>
                                          </div>
                                        </SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="w-[110px] shrink-0 space-y-1">
                                    <label className="text-[10px] font-medium text-foreground/60">Loại nhóm</label>
                                    <Select
                                      value={row.type}
                                      onValueChange={(value) => {
                                        updateGroupRow(row.id, { type: value as "internal" | "customer" });
                                      }}
                                    >
                                      <SelectTrigger className="w-full h-[30px] text-xs bg-background border border-border focus:ring-1 focus:ring-primary/50 shadow-none">
                                        <span className="flex flex-1 text-left truncate min-w-0">
                                          {row.type === "customer" ? "Khách hàng" : row.type === "internal" ? "Nội bộ" : "Loại nhóm"}
                                        </span>
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value="customer" className="text-xs">Khách hàng</SelectItem>
                                        <SelectItem value="internal" className="text-xs">Nội bộ</SelectItem>
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <div className="flex-1 space-y-1">
                                    <label className="text-[10px] font-medium text-foreground/60">Tên nhóm chat</label>
                                    <input
                                      type="text"
                                      data-preinfo-group-input={row.id}
                                      value={row.name}
                                      onChange={(e) => {
                                        const v = e.target.value;
                                        updateGroupRow(row.id, { name: v });
                                        setOpenDropdownId(row.id);
                                        updateDropdownAnchor(row.id);
                                      }}
                                      onFocus={() => {
                                        setOpenDropdownId(row.id);
                                        updateDropdownAnchor(row.id);
                                      }}
                                      onBlur={() => setTimeout(() => {
                                        setOpenDropdownId((cur) => (cur === row.id ? null : cur));
                                        setDropdownAnchor(null);
                                      }, 200)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          e.preventDefault();
                                          addGroupRow(row.platform);
                                        }
                                      }}
                                      placeholder={`Tên nhóm ${row.platform === "zalo" ? "Zalo" : "Teams"}...`}
                                      className="w-full px-2.5 py-1.5 rounded-md bg-background border border-border text-sm outline-none focus:border-primary/50"
                                    />
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setGroupRows((prev) => prev.filter((r) => r.id !== row.id));
                                      setOpenDropdownId((cur) => (cur === row.id ? null : cur));
                                      setDropdownAnchor(null);
                                    }}
                                    className="mt-5 p-1 text-muted-foreground/40 hover:text-rose-500 transition-colors shrink-0 cursor-pointer"
                                    title="Xoá dòng này"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                          {groupRows.length === 0 && (
                            <p className="text-[11px] text-muted-foreground/60">Chưa có nhóm nào — bấm &quot;Thêm nhóm&quot; để chọn nhóm Teams/Zalo.</p>
                          )}
                          <button
                            type="button"
                            onClick={() => addGroupRow("teams")}
                            className="mt-1.5 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" /> Thêm nhóm
                          </button>
                        </div>

                        {/* Dropdown gợi ý nhóm — portal ra body để thoát containing block */}
                        {openDropdownId && dropdownAnchor && (() => {
                          const activeRow = groupRows.find((r) => r.id === openDropdownId);
                          if (!activeRow) return null;
                          const options = activeRow.platform === "zalo" ? chatOptions.zalo : chatOptions.teams;
                          const matches = options.filter((c) =>
                            c.toLowerCase().includes(activeRow.name.toLowerCase())
                          );
                          return createPortal(
                            <div
                              className="fixed bg-background border border-border rounded-md shadow-lg max-h-40 overflow-y-auto z-[100] custom-scrollbar"
                              style={{ top: dropdownAnchor.top, left: dropdownAnchor.left, width: dropdownAnchor.width }}
                              onMouseDown={(e) => e.preventDefault() /* keep input focus while clicking list */}
                              onScroll={() => updateDropdownAnchor(openDropdownId)}
                            >
                              <div className="sticky top-0 bg-background/95 backdrop-blur px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border/40">
                                Nhóm {activeRow.platform === "zalo" ? "Zalo" : "Teams"} ({options.length})
                              </div>
                              {matches.length > 0 ? (
                                matches.map((chat, i) => (
                                  <div
                                    key={i}
                                    onClick={() => {
                                      updateGroupRow(activeRow.id, { name: chat });
                                      setOpenDropdownId(null);
                                      setDropdownAnchor(null);
                                    }}
                                    className="px-3 py-1.5 text-sm hover:bg-muted cursor-pointer flex items-center justify-between gap-2"
                                  >
                                    <span className="truncate">{chat}</span>
                                  </div>
                                ))
                              ) : options.length === 0 ? (
                                <div className="px-3 py-3 text-xs text-muted-foreground space-y-2">
                                  <div>Chưa có danh sách nhóm {activeRow.platform === "zalo" ? "Zalo" : "Teams"}.</div>
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); ensureChatOptions([activeRow.platform]); }}
                                    disabled={loadingChats}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer"
                                  >
                                    {loadingChats ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                                    Tải danh sách nhóm
                                  </button>
                                </div>
                              ) : (
                                <div className="px-3 py-3 text-xs text-muted-foreground space-y-1">
                                  <div>Không tìm thấy nhóm {activeRow.platform === "zalo" ? "Zalo" : "Teams"} nào khớp &quot;{activeRow.name}&quot;.</div>
                                  <div className="text-[10px] text-muted-foreground/70">
                                    Đổi Nền tảng sang {activeRow.platform === "zalo" ? "Teams" : "Zalo"} nếu nhóm bạn cần thuộc kênh kia, hoặc gõ tên chính xác để thêm trực tiếp.
                                  </div>
                                </div>
                              )}
                            </div>,
                            document.body
                          );
                        })()}

                        <div className="flex items-center justify-between pt-1">
                          <button
                            type="button"
                            onClick={savePreinfo}
                            disabled={saving}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50"
                          >
                            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                            Lưu thông tin
                          </button>
                          <button
                            type="button"
                            onClick={() => onUpdateStep("input_preinfo", "skipped")}
                            className="text-sm text-muted-foreground/60 hover:text-foreground transition-colors cursor-pointer px-3 py-2"
                          >
                            Bỏ qua
                          </button>
                        </div>
                      </div>
                    )}
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
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold bg-gradient-to-r from-sky-500 to-violet-500 text-white hover:opacity-90 transition-all cursor-pointer disabled:opacity-50 shadow-md"
              title="Chỉ khi cả 2 bước trên đều đã xử lý (done hoặc bỏ qua)"
            >
              <Rocket className="w-5 h-5" />
              Chuyển sang Kick-off
            </button>
          ) : (
            <p className="text-sm text-muted-foreground/80 flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 p-3 rounded-xl">
              <Sparkles className="w-5 h-5 text-amber-500 shrink-0" />
              Hoàn thành 2 bước trên để chuyển sang giai đoạn Kick-off.
            </p>
          )}
        </div>
      )}

      {/* ─── Phase Kick-off ─────────────────────────────────── */}
      {phase === "kickoff" && (
        <div className="space-y-4">
          {/* Step 1: Kickoff questions */}
          <div
            className={`rounded-xl border p-4 transition-colors ${
              stepStatus("send_kickoff_questions")
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-border/60 bg-background/60 shadow-sm"
            }`}
          >
            <div
              className="flex items-center gap-2.5 cursor-pointer select-none"
              onClick={() => setCollapsedSteps((prev) => ({ ...prev, send_kickoff_questions: !prev.send_kickoff_questions }))}
              title={collapsedSteps.send_kickoff_questions ? "Mở rộng bước này" : "Thu gọn bước này"}
            >
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                  stepStatus("send_kickoff_questions")
                    ? "bg-emerald-500 text-white"
                    : "bg-primary/15 text-primary"
                }`}
              >
                {stepStatus("send_kickoff_questions") ? <Check className="w-3.5 h-3.5" /> : "1"}
              </span>
              <span className="text-sm font-semibold text-foreground flex-1">
                Gửi câu hỏi cho Pre-sale / Sale
              </span>
              {stepStatus("send_kickoff_questions") ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleStepDone("send_kickoff_questions");
                  }}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10 transition-colors cursor-pointer"
                  title="Nhấn để quay lại trạng thái chưa xử lý"
                >
                  <RotateCcw className="w-3 h-3" />
                  Hoàn tác
                </button>
              ) : (
                <ChevronDown
                  className={`w-4 h-4 text-muted-foreground/60 transition-transform shrink-0 ${
                    collapsedSteps.send_kickoff_questions ? "" : "rotate-180"
                  }`}
                />
              )}
            </div>
            {!collapsedSteps.send_kickoff_questions && (
              <>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed ml-[34px]">
                  Gợi ý câu hỏi thu thập thông tin dự án từ Pre-sale và Sale trước khi triển khai.
                </p>
                {!stepStatus("send_kickoff_questions") && (
                  <div className="ml-[34px] mt-3">
                    <button
                      type="button"
                      onClick={() => setShowQuestions(!showQuestions)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-border/50 hover:bg-muted/50 transition-colors cursor-pointer"
                    >
                      <MessageCircleQuestion className="w-4 h-4" />
                      Chọn câu hỏi gửi
                      <ChevronDown className={`w-4 h-4 transition-transform ${showQuestions ? "rotate-180" : ""}`} />
                    </button>
                    {showQuestions && (
                      <div className="mt-3 space-y-2">
                        {KICKOFF_QUESTION_TEMPLATES.map((q) => {
                          const checked = selectedQuestions.includes(q.title);
                          return (
                            <button
                              key={q.id}
                              type="button"
                              onClick={() => toggleQuestion(q.title)}
                              className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left rounded-xl border transition-colors cursor-pointer ${
                                checked
                                  ? "border-primary/40 bg-primary/5"
                                  : "border-border/40 hover:bg-muted/40"
                              }`}
                            >
                              <span
                                className={`w-4 h-4 rounded-md border flex items-center justify-center shrink-0 mt-0.5 ${
                                  checked
                                    ? "bg-primary border-primary text-white"
                                    : "border-border bg-transparent"
                                }`}
                              >
                                {checked && <Check className="w-3 h-3" />}
                              </span>
                              <span className="text-sm text-foreground/90 leading-relaxed">{q.title}</span>
                            </button>
                          );
                        })}
                        <div className="flex items-center justify-between pt-2">
                          <button
                            type="button"
                            onClick={saveQuestions}
                            disabled={saving}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50"
                          >
                            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                            Lưu câu hỏi
                          </button>
                          <button
                            type="button"
                            onClick={() => onUpdateStep("send_kickoff_questions", "skipped")}
                            className="text-sm text-muted-foreground/60 hover:text-foreground transition-colors cursor-pointer px-3 py-2"
                          >
                            Bỏ qua
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {stepStatus("send_kickoff_questions") === "done" && (
                  <div className="mt-3 ml-[34px] space-y-1.5">
                    {(workflow?.kickoffQuestions || []).map((q, i) => (
                      <p key={i} className="text-sm text-muted-foreground/80 leading-relaxed flex items-start gap-2">
                        <span className="text-primary mt-1">•</span> {q}
                      </p>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Step 2: Input requirements */}
          <div
            className={`rounded-xl border p-4 transition-colors ${
              stepStatus("input_requirements")
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-border/60 bg-background/60 shadow-sm"
            }`}
          >
            <div
              className="flex items-center gap-2.5 cursor-pointer select-none"
              onClick={() => setCollapsedSteps((prev) => ({ ...prev, input_requirements: !prev.input_requirements }))}
              title={collapsedSteps.input_requirements ? "Mở rộng bước này" : "Thu gọn bước này"}
            >
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                  stepStatus("input_requirements")
                    ? "bg-emerald-500 text-white"
                    : "bg-primary/15 text-primary"
                }`}
              >
                {stepStatus("input_requirements") ? <Check className="w-3.5 h-3.5" /> : "2"}
              </span>
              <span className="text-sm font-semibold text-foreground flex-1">
                Nhập yêu cầu sơ bộ dự án
              </span>
              {stepStatus("input_requirements") ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleStepDone("input_requirements");
                  }}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10 transition-colors cursor-pointer"
                  title="Nhấn để quay lại trạng thái chưa xử lý"
                >
                  <RotateCcw className="w-3 h-3" />
                  Hoàn tác
                </button>
              ) : (
                <ChevronDown
                  className={`w-4 h-4 text-muted-foreground/60 transition-transform shrink-0 ${
                    collapsedSteps.input_requirements ? "" : "rotate-180"
                  }`}
                />
              )}
            </div>
            {!collapsedSteps.input_requirements && (
              <>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed ml-[34px]">
                  Yêu cầu sơ bộ là input của dự án — sau khi lưu, hệ thống tự sinh task tracking
                  cho từng yêu cầu.
                </p>
                {!stepStatus("input_requirements") && (
                  <div className="ml-[34px] mt-3">
                    <button
                      type="button"
                      onClick={() => setShowRequirements(!showRequirements)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-border/50 hover:bg-muted/50 transition-colors cursor-pointer"
                    >
                      <Target className="w-4 h-4" />
                      Nhập yêu cầu sơ bộ
                      <ChevronDown className={`w-4 h-4 transition-transform ${showRequirements ? "rotate-180" : ""}`} />
                    </button>
                    {showRequirements && (
                      <div className="mt-3 space-y-3">
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={reqTitle}
                            onChange={(e) => setReqTitle(e.target.value)}
                            placeholder="Tiêu đề yêu cầu (bắt buộc)"
                            className="flex-1 h-10 px-3 py-2 text-sm rounded-lg bg-background/80 border border-border/50 text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all"
                          />
                          <button
                            type="button"
                            onClick={addRequirement}
                            disabled={!reqTitle.trim()}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer disabled:opacity-40"
                          >
                            <Plus className="w-4 h-4" />
                            Thêm
                          </button>
                        </div>
                        <textarea
                          value={reqDetail}
                          onChange={(e) => setReqDetail(e.target.value)}
                          placeholder="Chi tiết / mô tả yêu cầu (không bắt buộc)"
                          rows={3}
                          className="w-full px-3 py-2 text-sm rounded-lg bg-background/80 border border-border/50 text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all resize-none"
                        />
                        {reqs.length > 0 && (
                          <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                            {reqs.map((r) => (
                              <div
                                key={r.id}
                                className="flex items-start gap-2.5 rounded-xl border border-border/40 bg-background/80 px-3 py-2.5 shadow-sm"
                              >
                                <span className="flex-1 text-sm text-foreground/90 leading-relaxed">
                                  <span className="font-medium block mb-0.5">{r.title}</span>
                                  {r.detail && (
                                    <span className="block text-muted-foreground/80">{r.detail}</span>
                                  )}
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setReqs((prev) => prev.filter((x) => x.id !== r.id))
                                  }
                                  className="p-1.5 rounded-md text-muted-foreground/50 hover:text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer shrink-0 mt-0.5"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="flex items-center justify-between pt-1">
                          <button
                            type="button"
                            onClick={saveRequirements}
                            disabled={saving || reqs.length === 0}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50"
                          >
                            {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                            Lưu & sinh task tracking
                          </button>
                          <button
                            type="button"
                            onClick={() => onUpdateStep("input_requirements", "skipped")}
                            className="text-sm text-muted-foreground/60 hover:text-foreground transition-colors cursor-pointer px-3 py-2"
                          >
                            Bỏ qua
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Generated tasks */}
          {(workflow?.taskIds || []).length > 0 && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <ListTodo className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold text-foreground">
                  Task tracking tự sinh ({workflow?.taskIds?.length})
                </span>
                <button
                  type="button"
                  onClick={() => onSwitchTab?.("history")}
                  className="ml-auto flex items-center gap-1.5 text-xs text-primary font-medium hover:underline transition-colors cursor-pointer"
                >
                  Xem chi tiết
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-sm text-muted-foreground/80 leading-relaxed">
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
