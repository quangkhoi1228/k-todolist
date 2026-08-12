"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { Copy, Check, Send, Sparkles, Target, Plus, X, Trash2, ChevronDown, Rocket, RefreshCw, ExternalLink, ListTodo, RotateCcw, Loader2, FileText, FileSpreadsheet, Wand2, ListPlus, CheckCircle2, ScanSearch } from "lucide-react";
import type { WorkflowRow, WorkflowRequirement, WorkflowGroupRef, WorkflowSowPlan } from "@/lib/repo/projectWorkflows";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmailComposeDialog } from "./EmailComposeDialog";

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

/**
 * Mẫu tin nhắn hỏi yêu cầu sơ bộ dự án — fill sẵn vào textarea, user có thể sửa.
 * Nhờ Pre-sale/Sale cung cấp scope, topology, next actions, target timeline.
 * Xưng hô riêng từng người theo giới tính, Pre-sale đứng trước Sale.
 * @param presaleName  Tên Pre-sale (bỏ trống → không nhắc)
 * @param saleName     Tên Sale (bỏ trống → không nhắc)
 * @param presaleGender "anh" | "chị" | "anh/chị" cho Pre-sale
 * @param saleGender    "anh" | "chị" | "anh/chị" cho Sale
 * @param ticketId     Mã ticket ISD (bỏ trống → không kèm link)
 */
export const PREINFO_QUESTION_TEMPLATE = (
  presaleName?: string | null,
  saleName?: string | null,
  presaleGender: SaleGender = "anh/chị",
  saleGender: SaleGender = "anh/chị",
  ticketId?: string | null
) => {
  const recipients: string[] = [];
  if (presaleName?.trim()) {
    const you = presaleGender === "anh/chị" ? "anh/chị" : presaleGender;
    recipients.push(`${you} ${presaleName.trim()}`);
  }
  if (saleName?.trim()) {
    const you = saleGender === "anh/chị" ? "anh/chị" : saleGender;
    recipients.push(`${you} ${saleName.trim()}`);
  }
  const greeting = recipients.length > 0 ? `Chào ${recipients.join(", ")} ơi` : "Chào anh/chị";
  const ticketPart = ticketId
    ? ` (https://servicedesk.fci.vn/browse/${ticketId})`
    : "";
  return `${greeting}, em Khôi PM mới nhận ticket${ticketPart} ạ. Dự án mới triển khai, nhờ anh/chị hỗ trợ em một số thông tin sơ bộ ạ:

- Scope: Hạng mục chính, mục tiêu, yêu cầu bắt buộc.
- Topology/Hạ tầng: Sơ đồ mạng, kiến trúc và môi trường triển khai.
- Next actions: Các việc cần làm, PIC và nội dung cần hỗ trợ.
- Timeline: Dự kiến kick-off, bàn giao và các mốc quan trọng.

Em cảm ơn anh/chị ạ!`;
};

export const REQUIREMENT_INPUT_HINT =
  "Nhập yêu cầu sơ bộ dự án (mỗi dòng 1 yêu cầu, bắt buộc có tiêu đề). Sau khi lưu, hệ thống tự sinh task tracking tương ứng.";

interface PhaseWorkflowCardProps {
  project: { _id: string; name: string; ticketId?: string | null };
  userId?: string;
  /** Tên Sale (member role "Sale") — dùng để xưng hô đúng giới tính trong tin nhắn chào */
  saleName?: string | null;
  /** Email Sale (member role "Sale") — nút deep link Teams mở chat 1:1 với đúng người */
  saleEmail?: string | null;
  /** Tên Pre-sale (member role "Pre-sale") — dùng để xưng hô trong câu hỏi scope */
  presaleName?: string | null;
  /** Email Pre-sale (member role "Pre-sale") */
  presaleMemberEmail?: string | null;
  /** Mô tả/nội dung dự án (notes) — dùng để auto-detect template SoW (migration/security/waf) */
  projectDescription?: string;
  workflow: WorkflowRow | null | undefined;
  loading?: boolean;
  onAction?: (step: string) => void;
  onUpdateWorkflow: (body: any) => Promise<any>;
  /** Cập nhật trạng thái bước; status null → xoá (trở về chưa xử lý) */
  onUpdateStep: (stepKey: string, status: "done" | "skipped" | null) => Promise<any>;
  onGenerateTasks: (items: Array<{ title: string; detail?: string; priority?: string }>, prefix?: string) => Promise<{ tasks?: any[] }>;
  /** Tạo task list từ SoW template (giữ phase/pic/support/manday) */
  onGenerateSowTasks: (items: Array<{ title: string }>) => Promise<{ tasks?: any[] }>;
  onSwitchTab?: (tab: string) => void;
  /** Tải danh sách nhóm Teams/Zalo (thường là list_chats của automator) */
  fetchChatLists?: (platforms?: ("teams" | "zalo")[]) => Promise<Record<"teams" | "zalo", string[]>>;
  /** Lưu nhóm đã chọn vào dự án (teamsGroups) — không bắt buộc, nếu có sẽ tự động sync */
  onSaveGroups?: (groups: WorkflowGroupRef[]) => Promise<void>;
  /** Task của project — dùng để detect "task đều xong" → gợi ý đóng dự án */
  projectTasks?: Array<{ _id?: string; status?: string | null; title?: string }>;
  /** Tin nhắn đã sync của các nhóm — dùng để detect KH confirm trong nhóm khách hàng */
  projectChats?: Array<{ chatName?: string; sender?: string | null; content?: string | null; timestampMs?: number | string | null }>;
  /** Nhóm chat của dự án (kèm type internal/customer) — xác định nhóm khách hàng */
  projectGroups?: Array<{ name: string; type?: "internal" | "customer" | string; platform?: string }>;
  /** Thêm member vào dự án (vd: Pre-sale tìm được từ Teams) — trả về member đã thêm */
  onAddMember?: (args: {
    projectId: string;
    userId: string;
    name: string;
    email?: string;
    roleName: string;
    source: string;
    roleId?: number | string;
  }) => Promise<any>;
}

export function PhaseWorkflowCard({
  project,
  userId,
  saleName,
  saleEmail,
  presaleName,
  presaleMemberEmail,
  projectDescription,
  workflow,
  loading,
  onUpdateWorkflow,
  onUpdateStep,
  onGenerateTasks,
  onGenerateSowTasks,
  onSwitchTab,
  fetchChatLists,
  onSaveGroups,
  projectTasks,
  projectChats,
  projectGroups,
  onAddMember,
}: PhaseWorkflowCardProps) {
  const [copied, setCopied] = useState(false);
  const [showPreinfo, setShowPreinfo] = useState(false);
  const [showRequirements, setShowRequirements] = useState(false);
  const [presale, setPresale] = useState("");
  // ─── Search Pre-sale trên Teams theo email ───
  const [presaleEmail, setPresaleEmail] = useState("");
  const [presaleSearching, setPresaleSearching] = useState(false);
  const [presaleResults, setPresaleResults] = useState<Array<{ name: string; email?: string; alias?: string; raw?: string }>>([]);
  const [presaleSearchError, setPresaleSearchError] = useState<string | null>(null);
  const presaleSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Query email đầy đủ user gõ — fallback lưu email khi Teams không trả email trong suggestion */
  const presaleQueryRef = useRef("");
  // ─── Form chọn nhóm (kiểu "Thêm nhóm": nền tảng Teams/Zalo + dropdown gợi ý) ───
  const [groupRows, setGroupRows] = useState<PendingGroupRow[]>([]);
  const [chatOptions, setChatOptions] = useState<Record<"teams" | "zalo", string[]>>({ teams: [], zalo: [] });
  const [loadingChats, setLoadingChats] = useState(false);
  const [chatsError, setChatsError] = useState<string | null>(null);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [dropdownAnchor, setDropdownAnchor] = useState<{ top: number; left: number; width: number } | null>(null);
  const groupRowsRef = useRef<HTMLDivElement | null>(null);
  const [questionText, setQuestionText] = useState("");
  /** Đánh dấu đã fill template — không ghi đè nội dung user đang soạn */
  const questionTextRef = useRef("");
  // ─── Gửi câu hỏi yêu cầu sơ bộ qua nhóm Teams ───
  const [questionTargetGroup, setQuestionTargetGroup] = useState<string>("");
  const [questionSendOpen, setQuestionSendOpen] = useState(false);
  const [questionSending, setQuestionSending] = useState(false);
  const [questionSendError, setQuestionSendError] = useState<string | null>(null);
  const [questionSendOk, setQuestionSendOk] = useState<string | null>(null);
  const [reqs, setReqs] = useState<WorkflowRequirement[]>([]);
  const [freeText, setFreeText] = useState("");
  // ─── LLM sinh scope từ yêu cầu sơ bộ ───
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ─── Phase SoW planning: template đề xuất + task list output ───
  const [sowTemplates, setSowTemplates] = useState<any[]>([]);
  const [detectedTemplateId, setDetectedTemplateId] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [selectedSowTemplateId, setSelectedSowTemplateId] = useState<string | null>(null);
  const [sowExpanded, setSowExpanded] = useState(false);
  const [creatingSow, setCreatingSow] = useState(false);
  const [sowPlan, setSowPlan] = useState<WorkflowSowPlan | null>(null);
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

  // ─── Thông tin Sale (từ member) + xưng hô theo giới tính ───
  /** Detect giới tính từ tên Việt Nam (giới hạn mẫu thường gặp, không gọi LLM ở client). */
  // ─── Dự đoán giới tính bằng LLM (thay cho pattern hard-code) ───
  const genderCacheRef = useRef<Record<string, SaleGender>>({});
  const [saleGender, setSaleGender] = useState<SaleGender>("anh/chị");
  const [presaleGender, setPresaleGender] = useState<SaleGender>("anh/chị");

  // Gọi LLM 1 lần cho cả saleName + presaleName, cache kết quả theo tên
  useEffect(() => {
    const names = [saleName, presaleName]
      .map((n) => String(n ?? "").trim())
      .filter((n) => n && !genderCacheRef.current[n]);
    if (names.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/data/detect-gender", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, names }),
        });
        if (!res.ok) return;
        const data = await res.json();
        const genders: Record<string, SaleGender> = data?.genders || {};
        if (cancelled) return;
        for (const n of names) {
          if (genders[n]) genderCacheRef.current[n] = genders[n];
        }
        if (saleName && genderCacheRef.current[String(saleName).trim()]) {
          setSaleGender(genderCacheRef.current[String(saleName).trim()]);
        }
        if (presaleName && genderCacheRef.current[String(presaleName).trim()]) {
          setPresaleGender(genderCacheRef.current[String(presaleName).trim()]);
        }
      } catch (e) {
        // Lỗi → giữ "anh/chị" mặc định
        console.error("[GenderDetect] error:", e);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saleName, presaleName]);

  // Pre-sale từ member có thể load sau workflow → cập nhật input khi member đến muộn
  useEffect(() => {
    if (!presaleName) return;
    // Chỉ ghi đè khi user chưa tự nhập (input rỗng hoặc vẫn là giá trị cũ từ initData/member)
    if (!presale.trim() || presale === workflow?.initData?.presale) {
      setPresale(presaleName);
      setPresaleEmail(presaleMemberEmail || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presaleName, presaleMemberEmail]);

  const greetMessage = GREET_SALE_TEMPLATE(saleName, saleGender, project.ticketId);
  const greetMessageText = GREET_SALE_TEMPLATE_TEXT(saleName, saleGender, project.ticketId);

  // ─── Mẫu email bàn giao cho khách hàng (trước khi đóng dự án) ───
  /** Nội dung email bàn giao theo mẫu (dùng chung cho subject + body) */
  const handoverEmailSubject = (projectName: string, ticketId?: string | null) => {
    const base = `Bàn giao sau khi hoàn tất triển khai dự án ${projectName.trim() || "FPT Cloud"}`;
    return ticketId ? `${base} (${ticketId})` : base;
  };
  const handoverEmailBody = (projectName: string, ticketId?: string | null) => {
    const proj = projectName.trim() || "dự án";
    const idPart = ticketId ? ` ${ticketId}` : "";
    return (
      `<p>Kính gửi anh/chị,</p>` +
      `<p>Bên em xin gửi anh/chị các thông tin bàn giao sau khi hoàn tất triển khai${idPart} của dự án ${proj}. Nội dung đính kèm bao gồm:</p>` +
      `<ul>` +
      `<li>Thông tin dự án: Scope, Timeline, Nhân sự, Topology</li>` +
      `<li>Hướng dẫn sử dụng (Firewall/thiết bị triển khai)</li>` +
      `<li>Quy trình hỗ trợ kỹ thuật</li>` +
      `</ul>` +
      `<p>Thay mặt đội ngũ FPT Cloud, em xin chân thành cảm ơn anh/chị và team đã luôn phối hợp, đồng hành và hỗ trợ xuyên suốt quá trình triển khai để dự án được hoàn thành thành công.</p>` +
      `<p>Kính chúc anh/chị nhiều sức khỏe và mong sẽ tiếp tục có cơ hội đồng hành cùng quý công ty trong các dự án sắp tới.</p>` +
      `<p>Trân trọng,<br/>Team ${proj}</p>`
    );
  };

  // ─── Gợi ý đóng dự án: task đều xong HOẶC KH confirm trong nhóm khách hàng ───
  const allTasksDone = useMemo(() => {
    if (!projectTasks || projectTasks.length === 0) return false;
    return projectTasks.every((t) => !t.status || t.status === "done");
  }, [projectTasks]);

  const customerGroups = useMemo(
    () => (projectGroups || []).filter((g) => g.type === "customer"),
    [projectGroups]
  );

  const customerConfirm = useMemo(() => {
    if (!projectChats || projectChats.length === 0) return false;
    // Chỉ xét tin nhắn trong nhóm khách hàng (type customer)
    const customerNames = new Set(customerGroups.map((g) => g.name));
    const msgs = projectChats.filter((m) => m.chatName && customerNames.has(m.chatName));
    if (msgs.length === 0) return false;
    // Tin mới nhất (sắp xếp theo timestampMs tăng dần → lấy phần tử cuối)
    const sorted = [...msgs].sort((a, b) => {
      const at = a.timestampMs !== undefined && a.timestampMs !== null ? Number(a.timestampMs) : 0;
      const bt = b.timestampMs !== undefined && b.timestampMs !== null ? Number(b.timestampMs) : 0;
      return at - bt;
    });
    const latest = sorted[sorted.length - 1];
    const text = `${latest.content || ""} ${latest.sender || ""}`.toLowerCase();
    // Keyword confirm triển khai xong (VN/EN)
    const confirmKeywords = [
      "triển khai xong", "trien khai xong", "hoàn tất", "hoan tat", "hoàn thành", "hoan thanh",
      "nghiệm thu", "nghiem thu", "bàn giao", "ban giao", "chấp nhận", "chap nhan",
      "done", "accept", "accepted", "confirm", "confirmed", "complete", "completed",
      "ok", "okay", "xong rồi" , "xong roi", "đã xong", "da xong",
    ];
    return confirmKeywords.some((kw) => text.includes(kw));
  }, [projectChats, customerGroups]);

  // Có gợi ý đóng dự án: phase đang sow + (task đều xong hoặc KH confirm)
  // (đặt sau khi `phase` được khai báo bên dưới)

  // ─── State mở email bàn giao ───
  const [handoverOpen, setHandoverOpen] = useState(false);

  const closeProject = async () => {
    setSaving(true);
    setError(null);
    try {
      await onUpdateWorkflow({
        action: "updateWorkflowPhase",
        projectId: project._id,
        userId,
        phase: "closed",
      });
      showToast("Đã chuyển dự án sang trạng thái Đóng dự án.");
    } catch (e: any) {
      setError(e?.message || "Đóng dự án thất bại");
    } finally {
      setSaving(false);
    }
  };

  /** Deep link Teams mở chat 1:1 với Sale (users=<email>) + tự điền tin nhắn vào ô soạn thảo */
  const teamsDeepLink = saleEmail?.trim()
    ? `https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(saleEmail.trim())}&message=${encodeURIComponent(greetMessageText)}`
    : undefined;

  const phase = workflow?.phase ?? "init";
  const steps = (workflow?.steps ?? {}) as Record<string, string>;
  const stepStatus = (key: string) => steps[key] || null;

  // Có gợi ý đóng dự án: phase đang sow + (task đều xong hoặc KH confirm)
  const canCloseProject = phase === "sow" && (allTasksDone || customerConfirm);

  // Load dữ liệu từ workflow khi mở
  useEffect(() => {
    if (!workflow) return;
    const wfId = (workflow as any)._id;
    if (wfId === undefined) return;
    // Reset trạng thái câu hỏi mỗi lần đổi project — tránh giữ text project cũ
    questionTextRef.current = "";
    setPresale(workflow.initData?.presale || presaleName || "");
    setPresaleEmail(workflow.initData?.presaleEmail || presaleMemberEmail || "");
    if (Array.isArray(workflow.kickoffQuestions)) {
      setQuestionText(workflow.kickoffQuestions.join("\n"));
      questionTextRef.current = workflow.kickoffQuestions.join("\n");
    } else if (!questionTextRef.current) {
      // Chưa có câu hỏi nào lưu → fill sẵn template (user có thể sửa).
      // Xưng hô đúng giới tính detect từ tên Pre-sale + Sale (LLM); kèm ticket link nếu có.
      const presaleFromInit = workflow.initData?.presale || "";
      const presaleResolved = presaleFromInit || presaleName || "";
      const template = PREINFO_QUESTION_TEMPLATE(
        presaleResolved,
        saleName,
        presaleGender,
        saleGender,
        project.ticketId
      );
      setQuestionText(template);
      questionTextRef.current = template;
    }
    if (Array.isArray(workflow.requirements) && workflow.requirements.length > 0) {
      setReqs(workflow.requirements);
    }
    if (workflow.sowPlan) {
      setSowPlan(workflow.sowPlan);
      setSelectedSowTemplateId(workflow.sowPlan.templateId ? String(workflow.sowPlan.templateId) : null);
    }
  }, [(workflow as any)?._id, saleGender, presaleGender]);

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
        presaleEmail: presaleEmail.trim() || undefined,
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
      // Lưu Pre-sale vào member dự án (role "Pre-sale") — email lấy từ Teams search (nếu có)
      if (onAddMember && presale.trim()) {
        try {
          await onAddMember({
            projectId: project._id,
            userId: userId || "",
            name: presale.trim(),
            email: presaleEmail.trim() || undefined,
            roleName: "Pre-sale",
            source: "teams-search",
          });
        } catch (e2: any) {
          console.error("Add presale member failed:", e2);
        }
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

  // ─── Search Pre-sale trên Teams theo email (debounce 700ms) ───
  const searchPresaleOnTeams = useCallback(
    async (query: string) => {
      const q = query.trim();
      if (!q || q.toLowerCase() === presaleEmail.trim().toLowerCase()) return;
      setPresaleSearching(true);
      setPresaleSearchError(null);
      try {
        const res = await fetch("/api/agents/teams-automator", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "search_person", query: q }),
        });
        const data = await res.json();
        if (data?.ok && data?.suggestions?.length > 0) {
          setPresaleResults(data.suggestions);
        } else if (data?.ok && data?.name) {
          setPresaleResults([{ name: data.name, email: data.email }]);
        } else {
          setPresaleResults([]);
          setPresaleSearchError(data?.error || `Không tìm thấy "${q}" trên Teams.`);
        }
      } catch (e: any) {
        setPresaleResults([]);
        setPresaleSearchError(e?.message || "Lỗi tìm kiếm Pre-sale trên Teams.");
      } finally {
        setPresaleSearching(false);
      }
    },
    [presaleEmail]
  );

  const handlePresaleInputChange = (value: string) => {
    setPresale(value);
    setPresaleEmail("");
    // Lưu query hiện tại — fallback email khi Teams không trả email trong suggestion
    presaleQueryRef.current = /^[\w.+-]+@[\w-]+\.[\w.]+$/.test(value.trim()) ? value.trim() : "";
    // Debounce search Teams theo email/tên
    if (presaleSearchTimer.current) clearTimeout(presaleSearchTimer.current);
    if (!value.trim()) {
      setPresaleResults([]);
      setPresaleSearchError(null);
      return;
    }
    presaleSearchTimer.current = setTimeout(() => {
      searchPresaleOnTeams(value);
    }, 700);
  };

  const selectPresale = (s: { name: string; email?: string }) => {
    setPresale(s.name);
    // Nếu suggestion không kèm email nhưng query là email đầy đủ → dùng chính query làm email
    setPresaleEmail(s.email || presaleQueryRef.current || "");
    setPresaleResults([]);
    setPresaleSearchError(null);
    if (presaleSearchTimer.current) clearTimeout(presaleSearchTimer.current);
  };

  // Dọn timer khi unmount
  useEffect(() => () => {
    if (presaleSearchTimer.current) clearTimeout(presaleSearchTimer.current);
  }, []);

  const saveQuestions = async () => {
    const text = questionText.trim();
    if (!text) {
      setError("Nhập nội dung cần hỏi Pre-sale/Sale trước khi lưu.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onUpdateWorkflow({
        action: "updateWorkflowData",
        projectId: project._id,
        userId,
        patch: { kickoffQuestions: [text] },
      });
      await onUpdateStep("send_kickoff_questions", "done");
      markStepCollapsed("send_kickoff_questions");
      showToast("Đã lưu nội dung hỏi Pre-sale/Sale. Dùng nút Gửi tin nhắn ở tab Chats để trao đổi.");
    } catch (e: any) {
      setError(e?.message || "Lưu thất bại");
    } finally {
      setSaving(false);
    }
  };

  // Tin nhắn scope đã xưng hô tên người nhận trực tiếp (vd: "Chào chị A, anh B ơi...") — không cần thêm prefix tên nữa
  const buildTaggedQuestion = (raw: string): string => raw.trim();

  /** Gửi câu hỏi qua nhóm Teams (gửi thật) — chạy ẩn nếu config headlessMode đang bật */
  const sendQuestionToTeamsGroup = async () => {
    const raw = questionText.trim();
    const group = questionTargetGroup.trim();
    if (!raw) {
      setQuestionSendError("Nhập nội dung câu hỏi trước khi gửi.");
      return;
    }
    if (!group) {
      setQuestionSendError("Chọn nhóm Teams cần gửi.");
      return;
    }
    setQuestionSending(true);
    setQuestionSendError(null);
    setQuestionSendOk(null);
    try {
      // Tag tên Pre-sale/Sale vào tin nhắn gửi qua nhóm
      const text = buildTaggedQuestion(raw);
      // Theo config headless của app (Omni): bật headless → chạy ẩn, tắt → mở browser thấy được
      const headless = localStorage.getItem("headlessMode") !== "false";
      const res = await fetch("/api/agents/teams-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          chatName: group,
          message: text,
          dryRun: false,
          headless,
        }),
      });
      const data = await res.json().catch(() => ({ ok: false, error: "Invalid JSON response" }));
      if (data.ok) {
        setQuestionSendOk(`Đã gửi câu hỏi vào nhóm "${group}".`);
        setQuestionSendOpen(false);
      } else {
        setQuestionSendError(data.error || `Không gửi được vào nhóm "${group}".`);
      }
    } catch (e: any) {
      setQuestionSendError(e?.message || "Lỗi khi gửi qua Teams.");
    } finally {
      setQuestionSending(false);
    }
  };

  /** Dán văn bản tự do → tách từng dòng thành 1 yêu cầu (bỏ dòng trống, bỏ bullet/number prefix) */
  const parseFreeText = (text: string) => {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) return;
    setReqs((prev) => [
      ...prev,
      ...lines.map((l, i) => ({
        id: `${Date.now()}-${i}`,
        title: l.length > 120 ? l.slice(0, 120) + "…" : l,
        detail: l.length > 120 ? l : undefined,
        priority: "normal" as const,
      })),
    ]);
    setFreeText("");
  };

  // ─── LLM sinh scope từ yêu cầu sơ bộ (paste text từ Pre-sale) ───
  const runAnalysis = async (text: string) => {
    const t = text.trim();
    if (!t || analyzing) return;
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      const res = await fetch("/api/data/preinfo-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, text: t }),
      });
      const data = await res.json().catch(() => ({ error: "Phản hồi không hợp lệ từ server." }));
      if (!res.ok || !data?.analysis) {
        setAnalysisError(data?.error || "Không phân tích được yêu cầu. Vui lòng thử lại.");
        return;
      }
      const a = data.analysis;
      const scope = Array.isArray(a.scope) ? a.scope : [];
      const nextActions = Array.isArray(a.nextActions) ? a.nextActions : [];
      const items = [...scope, ...nextActions].filter((s) => s && String(s).trim());
      if (items.length === 0) {
        setAnalysisError("AI không sinh được scope từ nội dung này. Vui lòng bổ sung thêm thông tin.");
        return;
      }
      setReqs((prev) => [
        ...prev,
        ...items.map((s, i) => {
          const title = String(s).trim();
          return {
            id: `${Date.now()}-scope-${i}`,
            title: title.length > 120 ? title.slice(0, 120) + "…" : title,
            detail: title.length > 120 ? title : undefined,
            priority: "normal" as const,
          };
        }),
      ]);
      showToast(`AI đã sinh ${items.length} hạng mục scope vào danh sách yêu cầu.`);
      setFreeText("");
    } catch (e: any) {
      setAnalysisError(e?.message || "Lỗi kết nối khi phân tích yêu cầu.");
    } finally {
      setAnalyzing(false);
    }
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
      const patch: any = { requirements: reqs };
      await onUpdateWorkflow({
        action: "updateWorkflowData",
        projectId: project._id,
        userId,
        patch,
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

  const moveToSow = async () => {
    setSaving(true);
    setError(null);
    try {
      // Giữ nguyên trạng thái skipped của bước đã bỏ qua, chỉ đánh dấu done cho bước chưa có trạng thái
      const nextSteps: Record<string, string> = { ...steps };
      for (const k of ["send_kickoff_questions", "input_requirements"] as const) {
        if (!nextSteps[k]) nextSteps[k] = "done";
      }
      await onUpdateWorkflow({
        action: "updateWorkflowPhase",
        projectId: project._id,
        userId,
        phase: "sow",
        patch: { steps: nextSteps },
      });
      // Tự detect template theo scope dự án khi vào phase sow
      setSowExpanded(true);
      showToast("Đã chuyển dự án sang SoW planning.");
    } catch (e: any) {
      setError(e?.message || "Chuyển phase thất bại");
    } finally {
      setSaving(false);
    }
  };

  // ─── Phase SoW planning: tải templates + auto-detect theo scope dự án ───
  const detectSowTemplate = useCallback(async () => {
    setDetecting(true);
    setError(null);
    try {
      // 1. Lấy danh sách templates của user
      const res = await fetch(`/api/data/task-templates?action=getTaskTemplates&userId=${encodeURIComponent(userId || "")}&includeInactive=true`);
      const data = await res.json();
      const list = Array.isArray(data) ? data : [];
      setSowTemplates(list.filter((t: any) => t.items && t.items.length > 0));

      // 2. Auto-detect: scope từ project name + description + requirements
      const scopeText = [
        project.name,
        projectDescription || "",
        ...(reqs || []).map((r) => r.title),
      ].join(" ");
      const detRes = await fetch(`/api/data/task-templates?action=detectTemplateForProject&userId=${encodeURIComponent(userId || "")}&text=${encodeURIComponent(scopeText)}`);
      const det = await detRes.json();
      if (det && det.id) {
        setDetectedTemplateId(String(det.id));
        // Nếu chưa chọn template nào → mặc định chọn template detect được
        setSelectedSowTemplateId((prev) => prev || String(det.id));
      } else {
        setDetectedTemplateId(null);
      }
    } catch (e: any) {
      setError(e?.message || "Lỗi tải template SoW");
    } finally {
      setDetecting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.name, projectDescription, reqs, userId]);

  // Khi vào phase sow (chưa có sowPlan) → tự detect template migration
  useEffect(() => {
    if (phase === "sow" && !sowPlan) {
      detectSowTemplate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, (workflow as any)?._id]);

  const createSowTasks = async () => {
    setCreatingSow(true);
    setError(null);
    try {
      const template = sowTemplates.find((t) => String(t.id) === selectedSowTemplateId);
      if (!template) {
        setError("Chưa chọn template SoW.");
        return;
      }
      const items = template.items || [];
      // Tạo task thật từ template
      const res = await onGenerateSowTasks(items);
      const taskIds = (res?.tasks || []).map((t: any) => Number(t?.id)).filter(Boolean);
      // Lưu sowPlan vào workflow
      const plan: WorkflowSowPlan = {
        templateId: template.id,
        templateName: template.name,
        templateCategory: template.category,
        items,
        taskIds,
      };
      setSowPlan(plan);
      await onUpdateWorkflow({
        action: "updateWorkflowData",
        projectId: project._id,
        userId,
        patch: { sowPlan: plan },
      });
      await onUpdateStep("sow_planning", "done");
      markStepCollapsed("sow_planning");
      showToast(`Đã tạo ${taskIds.length} task từ template "${template.name}".`);
    } catch (e: any) {
      setError(e?.message || "Tạo task SoW thất bại");
    } finally {
      setCreatingSow(false);
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
                : phase === "sow"
                  ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                  : phase === "closed"
                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                    : "bg-sky-500/15 text-sky-600 dark:text-sky-400"
            }`}
          >
            {phase === "kickoff" ? "Kick-off" : phase === "sow" ? "SoW planning" : phase === "closed" ? "Đóng dự án" : "Init"}
          </span>
        </div>
        {(phase === "kickoff" || phase === "sow") && (
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
                  const presaleInitName = workflow?.initData?.presale || presaleName || "";
                  const presaleInitEmail = workflow?.initData?.presaleEmail || presaleMemberEmail || "";
                  if (ext.length === 0 && int.length === 0 && !presaleInitName) return null;
                  return (
                    <div className="ml-[34px] mt-3 rounded-lg bg-muted/50 border border-border/40 p-3 text-sm space-y-1.5">
                      {presaleInitName && (
                        <p className="flex items-start gap-2 leading-relaxed">
                          <span className="text-primary mt-0.5 shrink-0">•</span>
                          <span><b className="font-medium">Pre-sale:</b> {presaleInitName}{presaleInitEmail ? <span className="text-muted-foreground"> ({presaleInitEmail})</span> : null}</span>
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
                        <div className="relative">
                      <input
                        type="text"
                        value={presale}
                        onChange={(e) => handlePresaleInputChange(e.target.value)}
                        placeholder="Pre-sale phụ trách (tên / email — tự tìm trên Teams)"
                        className="w-full h-10 px-3 py-2 text-sm rounded-lg bg-background/80 border border-border/50 text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all pr-9"
                      />
                      {presaleSearching && (
                        <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground absolute right-3 top-1/2 -translate-y-1/2" />
                      )}
                      {/* Kết quả tìm kiếm Teams */}
                      {!presaleSearching && presaleResults.length > 0 && (
                        <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-popover border border-border rounded-xl shadow-xl overflow-hidden">
                          <div className="py-1 max-h-52 overflow-y-auto">
                            {presaleResults.map((s, idx) => (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => selectPresale(s)}
                                className="w-full text-left px-3 py-2 text-[12px] transition-colors cursor-pointer hover:bg-muted flex items-center justify-between gap-2"
                              >
                                <div className="min-w-0">
                                  <div className="text-[12px] font-medium truncate">{s.name}</div>
                                  {s.email && (
                                    <div className="text-[10px] text-muted-foreground truncate">{s.email}</div>
                                  )}
                                </div>
                                {s.alias && (
                                  <span className="text-[10px] text-muted-foreground shrink-0">({s.alias})</span>
                                )}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {presaleSearchError && (
                        <p className="text-[11px] text-rose-500 bg-rose-500/10 border border-rose-500/20 rounded-lg px-2.5 py-1.5 mt-1.5">
                          {presaleSearchError}
                        </p>
                      )}
                      {presaleEmail && (
                        <p className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1 mt-1.5">
                          <Check className="w-3 h-3" />
                          <span className="truncate">Pre-sale từ Teams: {presale} ({presaleEmail}) — sẽ lưu vào member dự án</span>
                        </p>
                      )}
                    </div>

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
                Gửi câu hỏi lấy yêu cầu sơ bộ
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
                  Nhập câu hỏi lấy yêu cầu sơ bộ dự án (nội dung đã có sẵn, có thể chỉnh sửa) rồi
                  gửi qua nhóm Teams trong dự án, hoặc đánh dấu hoàn thành.
                </p>
                {!stepStatus("send_kickoff_questions") && (
                  <div className="ml-[34px] mt-3">
                    <textarea
                      value={questionText}
                      onChange={(e) => setQuestionText(e.target.value)}
                      rows={5}
                      placeholder="VD: Nhờ anh/chị hỗ trợ em các thông tin sơ bộ: scope (hạng mục chính, mục tiêu), topology/hạ tầng (sơ đồ mạng, kiến trúc, môi trường triển khai), next actions (việc cần làm, PIC, nội dung cần hỗ trợ) và timeline (kick-off, bàn giao, các mốc quan trọng) ạ."
                      className="w-full px-3 py-2.5 text-sm rounded-xl bg-background/80 border border-border/50 text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all resize-y"
                    />
                    {questionSendOk && (
                      <p className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1 mt-1.5">
                        <Check className="w-3 h-3" /> {questionSendOk}
                      </p>
                    )}
                    {questionSendError && (
                      <p className="text-[11px] text-rose-500 bg-rose-500/10 border border-rose-500/20 rounded-lg px-2.5 py-1.5 mt-1.5">
                        {questionSendError}
                      </p>
                    )}
                    {/* Nút gửi qua nhóm Teams: dropdown chọn nhóm trong dự án */}
                    <div className="flex flex-wrap items-center gap-2 pt-2.5">
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setQuestionSendOpen((v) => !v)}
                          disabled={questionSending}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-border/50 hover:bg-muted/50 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          <Send className="w-4 h-4" />
                          {questionTargetGroup ? `Gửi tới: ${questionTargetGroup}` : "Chọn nhóm Teams để gửi"}
                          <ChevronDown className={`w-4 h-4 transition-transform ${questionSendOpen ? "rotate-180" : ""}`} />
                        </button>
                        {questionSendOpen && (
                          <div className="absolute z-30 left-0 top-full mt-1.5 w-72 max-h-56 overflow-y-auto rounded-xl border border-border/50 bg-popover shadow-lg p-1.5">
                            {(projectGroups || []).filter((g) => !g.platform || g.platform === "teams").length === 0 ? (
                              <p className="text-xs text-muted-foreground px-2 py-2">
                                Chưa có nhóm Teams nào trong dự án. Vào "Thông tin sơ bộ" để thêm nhóm.
                              </p>
                            ) : (
                              (projectGroups || [])
                                .filter((g) => !g.platform || g.platform === "teams")
                                .map((g) => (
                                  <button
                                    key={g.name}
                                    type="button"
                                    onClick={() => {
                                      setQuestionTargetGroup(g.name);
                                      setQuestionSendOpen(false);
                                      setQuestionSendError(null);
                                    }}
                                    className={`w-full flex items-start gap-2 px-2.5 py-2 text-left text-sm rounded-lg transition-colors cursor-pointer ${
                                      questionTargetGroup === g.name
                                        ? "bg-primary/10 text-primary"
                                        : "hover:bg-muted/50"
                                    }`}
                                  >
                                    <TeamsIcon className="w-4 h-4 shrink-0 mt-0.5" />
                                    <span className="flex-1 min-w-0">
                                      <span className="block truncate font-medium">{g.name}</span>
                                      <span className="block text-[11px] text-muted-foreground">
                                        {g.type === "internal" ? "Nội bộ" : "Khách hàng"}
                                      </span>
                                    </span>
                                    {questionTargetGroup === g.name && <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
                                  </button>
                                ))
                            )}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={sendQuestionToTeamsGroup}
                        disabled={questionSending}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-sky-600 text-white hover:bg-sky-700 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {questionSending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                        Gửi qua Teams
                      </button>
                      <div className="flex-1" />
                      <button
                        type="button"
                        onClick={saveQuestions}
                        disabled={saving}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        Hoàn thành
                      </button>
                      <button
                        type="button"
                        onClick={() => onUpdateStep("send_kickoff_questions", "skipped")}
                        className="text-sm text-muted-foreground/60 hover:text-foreground transition-colors cursor-pointer px-2 py-2"
                      >
                        Bỏ qua
                      </button>
                    </div>
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
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground/70 flex items-center gap-1.5">
                            <ScanSearch className="w-3.5 h-3.5" />
                            Dán yêu cầu sơ bộ từ Pre-sale (email / tin nhắn) — AI tự sinh scope thành danh sách yêu cầu:
                          </p>
                          <textarea
                            value={freeText}
                            onChange={(e) => setFreeText(e.target.value)}
                            placeholder={"Ví dụ:\nDự án migrate toàn bộ hệ thống từ A lên Cloud FPT, gồm 10 server web + DB. KH yêu cầu chuyển domain cũ, cấu hình firewall mới. Cần họp kickoff trong tuần, chốt SOW trước 20/08. Pre-sale phụ trách: anh Nam."}
                            rows={5}
                            className="w-full px-3 py-2 text-sm rounded-lg bg-background/80 border border-border/50 text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 transition-all resize-none"
                          />
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs text-muted-foreground/60 mr-auto">
                              {analyzing
                                ? "Đang sinh scope bằng AI..."
                                : freeText.trim()
                                  ? "Sẵn sàng sinh scope"
                                  : "Chưa có nội dung"}
                            </span>
                            <button
                              type="button"
                              onClick={() => runAnalysis(freeText)}
                              disabled={!freeText.trim() || analyzing}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 transition-colors cursor-pointer disabled:opacity-40"
                              title="LLM sinh scope và đổ thẳng vào danh sách yêu cầu"
                            >
                              {analyzing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                              Sinh scope bằng AI
                            </button>
                            <button
                              type="button"
                              onClick={() => parseFreeText(freeText)}
                              disabled={!freeText.trim()}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border/50 hover:bg-muted/50 transition-colors cursor-pointer disabled:opacity-40"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              Thêm theo từng dòng
                            </button>
                          </div>

                          {analysisError && (
                            <p className="text-xs text-rose-500 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
                              {analysisError}
                            </p>
                          )}
                        </div>
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

          {/* Transition to Sow planning */}
          {stepStatus("send_kickoff_questions") && stepStatus("input_requirements") ? (
            <button
              type="button"
              onClick={moveToSow}
              disabled={saving}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold bg-gradient-to-r from-violet-500 to-amber-500 text-white hover:opacity-90 transition-all cursor-pointer disabled:opacity-50 shadow-md"
              title="Chỉ khi cả 2 bước trên đều đã xử lý (done hoặc bỏ qua)"
            >
              <Rocket className="w-5 h-5" />
              Chuyển sang SoW planning
            </button>
          ) : (
            <p className="text-[11px] text-muted-foreground/60 text-center">
              Hoàn thành 2 bước trên để chuyển sang giai đoạn SoW planning.
            </p>
          )}
        </div>
      )}

      {/* ─── Phase Sow (SoW planning) ───────────────────────── */}
      {phase === "sow" && (
        <div className="space-y-4">
          {/* Step 1: Sow planning */}
          <div
            className={`rounded-xl border p-4 transition-colors ${
              stepStatus("sow_planning")
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-border/60 bg-background/60 shadow-sm"
            }`}
          >
            <div
              className="flex items-center gap-2.5 cursor-pointer select-none"
              onClick={() => setCollapsedSteps((prev) => ({ ...prev, sow_planning: !prev.sow_planning }))}
              title={collapsedSteps.sow_planning ? "Mở rộng bước này" : "Thu gọn bước này"}
            >
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                  stepStatus("sow_planning")
                    ? "bg-emerald-500 text-white"
                    : "bg-primary/15 text-primary"
                }`}
              >
                {stepStatus("sow_planning") ? <Check className="w-3.5 h-3.5" /> : "1"}
              </span>
              <span className="text-sm font-semibold text-foreground flex-1">
                SoW planning — chốt task list
              </span>
              {stepStatus("sow_planning") ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleStepDone("sow_planning");
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
                    collapsedSteps.sow_planning ? "" : "rotate-180"
                  }`}
                />
              )}
            </div>
            {!collapsedSteps.sow_planning && (
              <>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed ml-[34px]">
                  Output của phase này là task list chi tiết. Hệ thống tự đề xuất khung template
                  theo scope dự án (migration / triển khai hạ tầng) — bạn có thể chọn template
                  khác hoặc import file SOW.
                </p>
                {!stepStatus("sow_planning") && (
                  <div className="ml-[34px] mt-3 space-y-3">
                    {/* Đang detect */}
                    {detecting && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Đang tự nhận diện template theo scope dự án...
                      </div>
                    )}

                    {/* Danh sách templates */}
                    {!detecting && sowTemplates.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                          <Wand2 className="w-3.5 h-3.5" />
                          Chọn khung template (hệ thống đề xuất bản phù hợp nhất):
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {sowTemplates.map((t) => (
                            <button
                              key={t.id}
                              type="button"
                              onClick={() => setSelectedSowTemplateId(String(t.id))}
                              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
                                selectedSowTemplateId === String(t.id)
                                  ? "border-amber-500/60 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                                  : "border-border/50 hover:border-primary/30 text-muted-foreground hover:text-foreground"
                              }`}
                            >
                              {t.name}
                              <span className="ml-1 text-[10px] text-muted-foreground/70">({t.items?.length} tasks)</span>
                              {detectedTemplateId === String(t.id) && (
                                <span className="ml-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                                  · đề xuất
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                        {!detectedTemplateId && (
                          <p className="text-[11px] text-muted-foreground/70">
                            Chưa nhận diện được loại dự án (scope không rõ migration/security) —
                            tự chọn template phù hợp bên trên.
                          </p>
                        )}
                      </div>
                    )}

                    {/* Preview selected template */}
                    {!detecting && selectedSowTemplateId && !sowPlan && (() => {
                      const tmpl = sowTemplates.find((t) => String(t.id) === selectedSowTemplateId);
                      if (!tmpl) return null;
                      const items = (tmpl.items || []).filter((it: any) => !it.isGroup);
                      const groupCount = (tmpl.items || []).length - items.length;
                      return (
                        <div className="rounded-xl border border-border/50 bg-background/60 p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <FileSpreadsheet className="w-4 h-4 text-amber-500" />
                            <span className="text-sm font-semibold text-foreground">{tmpl.name}</span>
                            <span className="px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 text-[10px] font-semibold">
                              {tmpl.category}
                            </span>
                            <span className="text-[11px] text-muted-foreground ml-auto">
                              {items.length} tasks {groupCount > 0 && `(+${groupCount} nhóm)`}
                            </span>
                          </div>
                          <div className="border border-border/40 rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                            <table className="w-full text-left text-[11px]">
                              <thead className="sticky top-0 bg-muted/60 backdrop-blur text-muted-foreground">
                                <tr>
                                  <th className="px-2 py-1.5 font-semibold">Phase</th>
                                  <th className="px-2 py-1.5 font-semibold">Task</th>
                                  <th className="px-2 py-1.5 font-semibold hidden sm:table-cell">Chi tiết</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-border/30">
                                {items.slice(0, 12).map((it: any, idx: number) => (
                                  <tr key={idx} className="hover:bg-muted/20">
                                    <td className="px-2 py-1 text-muted-foreground whitespace-nowrap">{it.phase}</td>
                                    <td className="px-2 py-1 font-medium">{it.title}</td>
                                    <td className="px-2 py-1 text-muted-foreground hidden sm:table-cell truncate max-w-[240px]" title={it.details}>
                                      {it.details || ""}
                                    </td>
                                  </tr>
                                ))}
                                {items.length > 12 && (
                                  <tr>
                                    <td colSpan={3} className="px-2 py-1.5 text-muted-foreground/70 text-center">
                                      ... còn {items.length - 12} tasks nữa
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                          <div className="flex items-center justify-between pt-3">
                            <button
                              type="button"
                              onClick={createSowTasks}
                              disabled={creatingSow}
                              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:opacity-90 transition-all cursor-pointer disabled:opacity-50 shadow-sm"
                            >
                              {creatingSow ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ListPlus className="w-4 h-4" />}
                              Tạo {items.length} task list từ template
                            </button>
                            <button
                              type="button"
                              onClick={() => onUpdateStep("sow_planning", "skipped")}
                              className="text-sm text-muted-foreground/60 hover:text-foreground transition-colors cursor-pointer px-3 py-2"
                            >
                              Bỏ qua
                            </button>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Không có template */}
                    {!detecting && sowTemplates.length === 0 && (
                      <p className="text-sm text-muted-foreground/80">
                        Chưa có template nào. Hãy import file SOW (.xlsx) từ tab Thông tin dự án
                        để tạo khung task list mẫu.
                      </p>
                    )}
                  </div>
                )}
                {stepStatus("sow_planning") === "done" && sowPlan && (
                  <div className="mt-3 ml-[34px] space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      <span className="font-medium text-foreground">Đã chốt task list: {sowPlan.templateName}</span>
                      <span className="text-xs text-muted-foreground">
                        ({sowPlan.items?.filter((it) => !it.isGroup).length || 0} tasks)
                      </span>
                    </div>
                    <div className="space-y-1">
                      {(sowPlan.items || []).filter((it: any) => !it.isGroup).map((it: any, i: number) => (
                        <p key={i} className="text-sm text-muted-foreground/80 leading-relaxed flex items-start gap-2">
                          <span className="text-amber-500 mt-1">•</span>
                          <span>
                            {it.phase ? <span className="text-muted-foreground/60">[{it.phase}] </span> : null}
                            {it.title}
                            {it.pic ? <span className="text-[11px] text-muted-foreground/70"> — PIC: {it.pic}</span> : null}
                          </span>
                        </p>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => onSwitchTab?.("history")}
                      className="inline-flex items-center gap-1.5 text-xs text-primary font-medium hover:underline transition-colors cursor-pointer"
                    >
                      Xem task list trong Lịch sử / Tasks
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
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

          {/* ─── Gợi ý đóng dự án: task đều xong HOẶC KH confirm trong nhóm khách hàng ─── */}
          {canCloseProject && (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <span className="text-sm font-semibold text-foreground">
                  Sẵn sàng đóng dự án
                </span>
              </div>
              <p className="text-sm text-muted-foreground/80 leading-relaxed mb-3">
                {allTasksDone && customerConfirm
                  ? "Tất cả task đã hoàn thành và khách hàng đã xác nhận triển khai xong trong nhóm khách hàng."
                  : allTasksDone
                    ? "Tất cả task của dự án đã hoàn thành."
                    : "Khách hàng đã xác nhận triển khai xong trong nhóm khách hàng."}{" "}
                Trước khi đóng dự án, hãy gửi email bàn giao cho khách hàng.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <EmailComposeDialog
                  projectId={project._id}
                  defaultSubject={handoverEmailSubject(project.name, project.ticketId)}
                  defaultBody={handoverEmailBody(project.name, project.ticketId)}
                  open={handoverOpen}
                  onOpenChange={setHandoverOpen}
                  trigger={
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-emerald-500 to-teal-500 text-white hover:opacity-90 transition-all cursor-pointer shadow-sm"
                    >
                      <Send className="w-4 h-4" />
                      Gửi email bàn giao cho khách hàng
                    </button>
                  }
                />
                <button
                  type="button"
                  onClick={closeProject}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-gradient-to-r from-rose-500 to-red-500 text-white hover:opacity-90 transition-all cursor-pointer disabled:opacity-50 shadow-sm"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Đóng dự án
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Phase Closed (đóng dự án) ─────────────────────── */}
      {phase === "closed" && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            <span className="text-sm font-semibold text-foreground">
              Dự án đã đóng
            </span>
          </div>
          <p className="text-sm text-muted-foreground/80 leading-relaxed">
            Dự án đã được chuyển sang trạng thái đóng. Nếu cần mở lại, hãy chuyển
            phase về SoW planning.
          </p>
          <button
            type="button"
            onClick={() => {
              onUpdateWorkflow({
                action: "updateWorkflowPhase",
                projectId: project._id,
                userId,
                phase: "sow",
              });
            }}
            className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Mở lại dự án
          </button>
        </div>
      )}
    </div>
  );
}
