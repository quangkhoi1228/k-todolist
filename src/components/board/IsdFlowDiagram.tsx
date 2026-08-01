"use client";

import { CheckCircle2, Clock, Loader2, XCircle, ExternalLink, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * All possible states in the Cloud Project Deployment workflow on Jira Service Desk.
 * Based on https://servicedesk.fci.vn
 */
interface DeploymentState {
  id: string;
  label: string;
  labelVn: string;
  description: string;
  /** Keywords to match against raw ISD status (case-insensitive, partial match) */
  matchKeywords: string[];
  /** Position row in the diagram (0-based) */
  row: number;
  /** Position column in the diagram */
  col: number;
}

const DEPLOYMENT_STATES: DeploymentState[] = [
  {
    id: "open",
    label: "Open",
    labelVn: "Tạo ticket",
    description: "Sale tạo ticket triển khai theo template",
    matchKeywords: ["open", "create", "tạo", "new"],
    row: 0,
    col: 0,
  },
  {
    id: "waiting_for_pm",
    label: "Waiting for PM",
    labelVn: "Chờ PM",
    description: "Chờ PM tiếp nhận ticket (SLA: 1 giờ)",
    matchKeywords: ["waiting for pm", "waiting pm", "chờ pm", "pm assignment"],
    row: 0,
    col: 1,
  },
  {
    id: "kickoff",
    label: "Kickoff",
    labelVn: "Kickoff",
    description: "PM tổ chức kickoff với Presale, KT, Sale",
    matchKeywords: ["kickoff", "kick-off", "kick off"],
    row: 0,
    col: 2,
  },
  {
    id: "draft_sow",
    label: "Draft SOW",
    labelVn: "Soạn SOW",
    description: "Presale cung cấp SOW draft, PM hoàn thiện",
    matchKeywords: ["draft", "sow", "technical sow", "draft sow", "soạn sow"],
    row: 0,
    col: 3,
  },
  {
    id: "customer_review",
    label: "Customer Review",
    labelVn: "KH Review",
    description: "PM gửi SOW cho KH review scope & timeline",
    matchKeywords: ["customer review", "customer", "review sow", "kh review"],
    row: 0,
    col: 4,
  },
  {
    id: "in_progress",
    label: "In Progress",
    labelVn: "Đang triển khai",
    description: "KT triển khai các task theo yêu cầu",
    matchKeywords: ["in progress", "task in progress", "đang triển khai", "progress"],
    row: 1,
    col: 0,
  },
  {
    id: "verification",
    label: "Verification",
    labelVn: "KH xác nhận",
    description: "PM bàn giao cho KH: SOW, Topology, tài liệu",
    matchKeywords: ["verification", "customer verification", "verify", "xác nhận", "kh verification"],
    row: 1,
    col: 1,
  },
  {
    id: "ho_customer_ops",
    label: "HO to Customer",
    labelVn: "Bàn giao KH",
    description: "PM bàn giao thông tin cho Operations và KH",
    matchKeywords: ["ho to customer", "ho to operations", "handover", "bàn giao"],
    row: 1,
    col: 2,
  },
  {
    id: "tl_review",
    label: "TL Review",
    labelVn: "TL duyệt worklog",
    description: "Team Lead review worklog (SLA: 8 giờ)",
    matchKeywords: ["tl review", "team lead", "review worklog", "worklog review"],
    row: 1,
    col: 3,
  },
  {
    id: "finalize_manday",
    label: "Finalize Manday",
    labelVn: "Tổng hợp manday",
    description: "PM kiểm tra tổng manday, gửi Sale duyệt",
    matchKeywords: ["finalize", "manday", "pm finalize", "tổng hợp manday"],
    row: 2,
    col: 0,
  },
  {
    id: "sale_review",
    label: "Sale Review",
    labelVn: "Sale duyệt",
    description: "Sale Approve/Decline kết quả (SLA: 24 giờ)",
    matchKeywords: ["sale review", "sale confirmation", "sale duyệt", "sale approve", "sale"],
    row: 2,
    col: 1,
  },
  {
    id: "ho_ops",
    label: "HO to Ops",
    labelVn: "Bàn giao Ops",
    description: "PM bàn giao thông tin đến team vận hành",
    matchKeywords: ["pm ho", "ho to operations final", "bàn giao operations"],
    row: 2,
    col: 2,
  },
  {
    id: "closed",
    label: "Closed",
    labelVn: "Đã đóng",
    description: "Ticket đã đóng thành công",
    matchKeywords: ["closed", "done", "hoàn thành", "đã đóng", "resolve", "resolved"],
    row: 2,
    col: 3,
  },
  {
    id: "suspended",
    label: "Suspended",
    labelVn: "Tạm dừng / Hủy",
    description: "Ticket bị suspend/cancel — cần Sale duyệt (SLA: 8 giờ)",
    matchKeywords: ["suspend", "cancel", "suspended", "cancelled", "tạm dừng", "hủy"],
    row: 3,
    col: 3,
  },
];

/** Used to connect states in the diagram */
interface Connection {
  from: string;
  to: string;
  variant: "arrow" | "dashed" | "branch";
}

const CONNECTIONS: Connection[] = [
  // Row 0 — main path
  { from: "open", to: "waiting_for_pm", variant: "arrow" },
  { from: "waiting_for_pm", to: "kickoff", variant: "arrow" },
  { from: "kickoff", to: "draft_sow", variant: "arrow" },
  { from: "draft_sow", to: "customer_review", variant: "arrow" },
  { from: "customer_review", to: "in_progress", variant: "arrow" },
  // Row 1
  { from: "in_progress", to: "verification", variant: "arrow" },
  { from: "verification", to: "ho_customer_ops", variant: "arrow" },
  { from: "ho_customer_ops", to: "tl_review", variant: "arrow" },
  // Row 2
  { from: "tl_review", to: "finalize_manday", variant: "arrow" },
  { from: "finalize_manday", to: "sale_review", variant: "arrow" },
  { from: "sale_review", to: "ho_ops", variant: "arrow" },
  { from: "ho_ops", to: "closed", variant: "arrow" },
  // Can cancel from most states
  { from: "open", to: "suspended", variant: "dashed" },
  { from: "in_progress", to: "suspended", variant: "dashed" },
  // Loop back from sale_review if declined
  { from: "sale_review", to: "finalize_manday", variant: "branch" },
];

/** Match a raw ISD status to a deployment state ID */
function matchState(rawStatus: string | undefined | null): DeploymentState | undefined {
  if (!rawStatus) return undefined;
  const status = rawStatus.toLowerCase().trim();
  for (const state of DEPLOYMENT_STATES) {
    for (const kw of state.matchKeywords) {
      if (status.includes(kw)) return state;
    }
  }
  return undefined;
}

function getStateIcon(stateId: string, isCurrent: boolean, status: string | undefined | null) {
  if (!status) return <Clock className="w-3.5 h-3.5 text-muted-foreground" />;
  if (!isCurrent) return <CheckCircle2 className="w-3.5 h-3.5 text-muted-foreground/30" />;
  if (stateId === "suspended") return <XCircle className="w-3.5 h-3.5 text-red-500" />;
  if (stateId === "closed") return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />;
  return <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin" />;
}

function getStateColor(
  stateId: string,
  isCurrent: boolean,
  isPast: boolean
): string {
  if (!isCurrent && !isPast) return "border-border/20 bg-card/30 opacity-40";
  if (isPast) return "border-emerald-500/30 bg-emerald-500/5";
  if (stateId === "suspended") return "border-red-400/50 bg-red-500/10";
  if (stateId === "closed") return "border-emerald-500/60 bg-emerald-500/15";
  return "border-blue-400/50 bg-blue-500/10 ring-1 ring-blue-400/30";
}

export function IsdFlowDiagram({
  ticketId,
  isdStatus,
}: {
  ticketId?: string | null;
  isdStatus?: string | null;
}) {
  const currentState = matchState(isdStatus);
  const currentId = currentState?.id;
  const currentIdx = currentId
    ? DEPLOYMENT_STATES.findIndex((s) => s.id === currentId)
    : -1;

  // Group states by row for rendering
  const rows = DEPLOYMENT_STATES.reduce<DeploymentState[][]>((acc, s) => {
    if (!acc[s.row]) acc[s.row] = [];
    acc[s.row].push(s);
    return acc;
  }, []);

  return (
    <div className="rounded-xl border border-border/50 bg-card/40 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-blue-500" />
          <span className="text-xs font-semibold text-foreground/80 uppercase tracking-wider">
            Deployment Flow
          </span>
        </div>
        {ticketId && (
          <a
            href={`https://servicedesk.fci.vn/browse/${ticketId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
          >
            <ExternalLink className="w-3 h-3" />
            {ticketId}
          </a>
        )}
      </div>

      {/* Current status badge */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground font-medium">Trạng thái:</span>
        {isdStatus ? (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-[12px] font-semibold px-2.5 py-1 rounded-full border",
              currentId === "closed"
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20"
                : currentId === "suspended"
                  ? "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/20"
                  : "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20"
            )}
          >
            {currentState ? currentState.labelVn : isdStatus}
          </span>
        ) : (
          <span className="text-[12px] text-muted-foreground/50 italic">Chưa có dữ liệu</span>
        )}
      </div>

      {/* Flow diagram */}
      <div className="relative overflow-x-auto pb-2">
        <div className="min-w-[640px] space-y-1">
          {rows.map((rowStates, rowIdx) => (
            <div key={rowIdx} className="flex items-center gap-0">
              {rowStates.map((state, stateIdx) => {
                const isCurrent = state.id === currentId;
                const isPast = currentIdx >= 0 && DEPLOYMENT_STATES.indexOf(state) < currentIdx;

                return (
                  <div key={state.id} className="flex items-center relative group">
                    {/* State node */}
                    <div
                      className={cn(
                        "relative flex flex-col items-center gap-1 px-2.5 py-2 rounded-lg border transition-all cursor-default min-w-[100px]",
                        getStateColor(state.id, isCurrent, isPast)
                      )}
                      title={`${state.label}: ${state.description}`}
                    >
                      <div className="flex items-center gap-1.5">
                        {getStateIcon(state.id, !!currentState && isCurrent, isdStatus)}
                        <span
                          className={cn(
                            "text-[11px] font-semibold whitespace-nowrap leading-tight",
                            isCurrent || isPast ? "text-foreground/90" : "text-muted-foreground/40"
                          )}
                        >
                          {state.label}
                        </span>
                      </div>
                      <span
                        className={cn(
                          "text-[9px] whitespace-nowrap leading-tight",
                          isCurrent || isPast ? "text-muted-foreground/70" : "text-muted-foreground/20"
                        )}
                      >
                        {state.labelVn}
                      </span>
                    </div>

                    {/* Arrow to next state in same row */}
                    {stateIdx < rowStates.length - 1 && (
                      <div className="flex items-center shrink-0 mx-0.5">
                        <ArrowRight
                          className={cn(
                            "w-3.5 h-3.5",
                            currentIdx >= 0 && DEPLOYMENT_STATES.indexOf(state) < currentIdx
                              ? "text-emerald-500/50"
                              : "text-muted-foreground/20"
                          )}
                        />
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Vertical connector between rows */}
              {rowIdx < rows.length - 1 && (
                <div className="flex items-center justify-center w-full ml-2">
                  <svg className="w-full h-4" viewBox="0 0 200 16" preserveAspectRatio="none">
                    <path
                      d="M 100 0 Q 100 8, 100 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeDasharray="3 3"
                      className="text-muted-foreground/20"
                    />
                  </svg>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Tooltip / note */}
      <p className="text-[9px] text-muted-foreground/40 leading-relaxed">
        Dựa trên quy trình triển khai Cloud Project —{" "}
        <a
          href="https://wiki.fci.vn/display/CDC/3.3.1+Cloud+Project"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-muted-foreground/60"
        >
          Wiki 3.3.1
        </a>
      </p>
    </div>
  );
}
