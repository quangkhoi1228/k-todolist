"use client";

import { useState, useCallback } from "react";
import {
  BrainCircuit, Layers, Scale, ShieldCheck, Loader2, Play,
  Users, MessageSquare, CheckCircle2, XCircle, ChevronDown,
  AlertTriangle, Sparkles, Clock,
} from "lucide-react";

interface ChatMessage {
  sender?: string;
  chatName?: string;
  content?: string;
  timestampMs?: number | string;
  platform?: "teams" | "zalo";
  groupType?: "customer" | "internal";
}

interface GroupFinding {
  chatName: string;
  groupType: string;
  platform: string;
  messageCount: number;
  findings: any[];
  status: "ok" | "failed";
}

interface DebateTrace {
  groups: GroupFinding[];
  synthesis?: {
    suggestions: any[];
    conflicts: any[];
    raw: string;
  };
  critic?: {
    inputSuggestions: any[];
    verified: any[];
    removed: any[];
    raw: string;
  };
}

interface DebateResult {
  ok: boolean;
  suggestions: any[];
  conflicts?: any[];
  debugInfo?: { stage1Ms: number; stage2Ms: number; stage3Ms: number; totalMs: number; groupCount: number };
  trace?: DebateTrace;
  error?: string;
}

interface DebatePipelineViewerProps {
  projectId: string;
  projectName: string;
  messages: ChatMessage[];
  projectContext?: string;
  userId?: string;
  onComplete?: () => void;
}

const GROUP_LABEL_COLOR: Record<string, string> = {
  "KHÁCH HÀNG": "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-200 dark:border-sky-500/30",
  "NỘI BỘ": "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-200 dark:border-violet-500/30",
  "CHƯA PHÂN LOẠI": "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-500/30",
};

const CONFIDENCE_COLOR: Record<string, string> = {
  high: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30",
  medium: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-500/30",
  low: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-500/30",
};

function SectionCard({ icon, title, subtitle, children, accent }: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-border/40 bg-card/50 dark:bg-zinc-800/50 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border/30 bg-gradient-to-r from-primary/5 to-transparent">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${accent}`}>{icon}</div>
        <div className="min-w-0">
          <p className="text-xs font-bold text-foreground dark:text-zinc-100 leading-tight">{title}</p>
          {subtitle && <p className="text-[10px] text-muted-foreground dark:text-zinc-500 leading-tight">{subtitle}</p>}
        </div>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function Collapsible({ title, count, children, defaultOpen = false }: {
  title: string;
  count: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-lg border border-border/30 bg-background/60 dark:bg-zinc-900/60">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left cursor-pointer"
      >
        <ChevronDown className={`w-3 h-3 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        <span className="text-[10px] font-semibold text-foreground dark:text-zinc-200 flex-1">{title}</span>
        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted/40 text-muted-foreground">{count}</span>
      </button>
      {open && <div className="px-2.5 pb-2.5 space-y-1.5">{children}</div>}
    </div>
  );
}

export function DebatePipelineViewer({ projectId, projectName, messages, projectContext, userId, onComplete }: DebatePipelineViewerProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DebateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<0 | 1 | 2 | 3>(0);

  const runDebate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setStage(1);
    try {
      const res = await fetch("/api/agents/analyse-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName,
          projectId,
          messages,
          projectContext: projectContext || "",
          userId,
          includeTrace: true,
        }),
      });
      const data: DebateResult = await res.json();
      if (!data.ok) {
        setError(data.error || "Lỗi khi phân tích");
        setResult(data);
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi mạng");
    } finally {
      setLoading(false);
      setStage(3);
      onComplete?.();
    }
  }, [projectName, projectId, messages, projectContext, userId, onComplete]);

  const trace = result?.trace;
  const debug = result?.debugInfo;
  const hasTrace = Boolean(trace && trace.groups.length > 0);

  return (
    <div className="space-y-3">
      {/* Header + trigger */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="text-sm font-bold text-foreground dark:text-zinc-100 flex items-center gap-1.5">
            <BrainCircuit className="w-4 h-4 text-purple-500" />
            Quy trình AI Debate
          </p>
          <p className="text-[10px] text-muted-foreground dark:text-zinc-500">
            Phân tích theo nhóm → tổng hợp chéo → kiểm duyệt chứng cứ
          </p>
        </div>
        <button
          type="button"
          onClick={runDebate}
          disabled={loading}
          className="inline-flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-200 dark:border-purple-500/30 hover:bg-purple-500/20 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
          {loading ? "Đang phân tích..." : "Chạy phân tích"}
        </button>
      </div>

      {/* Loading indicator */}
      {loading && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground bg-muted/20 rounded-lg px-3 py-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-500" />
          Đang chạy 3-stage debate...
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-[11px] text-red-600 dark:text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5" />
          {error}
        </div>
      )}

      {!result && !loading && !error && (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <Layers className="w-10 h-10 text-purple-500/30 mb-3" />
          <p className="text-xs font-medium text-muted-foreground/70">
            Chưa có kết quả. Bấm "Chạy phân tích" để xem quy trình debate.
          </p>
          <p className="text-[10px] text-muted-foreground/40 mt-1 max-w-[280px]">
            {messages.length} tin nhắn từ {new Set(messages.map((m) => m.chatName)).size} nhóm chat sẽ được phân tích
          </p>
        </div>
      )}

      {result && !loading && (
        <>
          {/* Timing summary */}
          {debug && (
            <div className="flex items-center gap-2 flex-wrap text-[10px] text-muted-foreground bg-muted/20 rounded-lg px-3 py-2">
              <Clock className="w-3 h-3" />
              <span>Stage 1: {debug.stage1Ms}ms</span>
              <span>·</span>
              <span>Stage 2: {debug.stage2Ms}ms</span>
              <span>·</span>
              <span>Stage 3: {debug.stage3Ms}ms</span>
              <span>·</span>
              <span>Tổng: {debug.totalMs}ms</span>
              <span>·</span>
              <span>{debug.groupCount} nhóm</span>
            </div>
          )}

          {hasTrace ? (
            <>
              {/* STAGE 1: Per-group */}
              <SectionCard
                icon={<Users className="w-3.5 h-3.5" />}
                title="Stage 1 — Phân tích theo nhóm"
                subtitle={`${trace!.groups.length} nhóm chạy song song`}
                accent="bg-sky-500/10 text-sky-600 dark:text-sky-400"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {trace!.groups.map((g) => (
                    <div key={g.chatName} className="rounded-lg border border-border/30 p-2.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${GROUP_LABEL_COLOR[g.groupType] || GROUP_LABEL_COLOR["CHƯA PHÂN LOẠI"]}`}>
                          {g.groupType}
                        </span>
                        <span className="text-[11px] font-bold text-foreground dark:text-zinc-100 truncate flex-1">{g.chatName}</span>
                        {g.status === "ok" ? (
                          <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                        ) : (
                          <XCircle className="w-3 h-3 text-red-500 shrink-0" />
                        )}
                      </div>
                      <p className="text-[9px] text-muted-foreground/60 mt-1">
                        {g.platform} · {g.messageCount} tin nhắn · {g.findings.length} findings
                      </p>
                      {g.findings.length > 0 && (
                        <Collapsible title="Chi tiết findings" count={g.findings.length}>
                          {g.findings.map((fd, i) => (
                            <div key={i} className="rounded border border-border/20 p-1.5">
                              <p className="text-[10px] font-semibold text-foreground dark:text-zinc-200">
                                {fd.title || fd.description?.slice(0, 60) || "Finding"}
                              </p>
                              {fd.description && (
                                <p className="text-[9px] text-muted-foreground dark:text-zinc-400 mt-0.5 line-clamp-2">{fd.description}</p>
                              )}
                              {fd.sourceMessage && (
                                <p className="text-[9px] text-muted-foreground/50 italic mt-0.5 line-clamp-2">"{fd.sourceMessage}"</p>
                              )}
                            </div>
                          ))}
                        </Collapsible>
                      )}
                    </div>
                  ))}
                </div>
              </SectionCard>

              {/* STAGE 2: Synthesis */}
              <SectionCard
                icon={<Scale className="w-3.5 h-3.5" />}
                title="Stage 2 — Tổng hợp chéo & mâu thuẫn"
                subtitle={
                  trace!.synthesis
                    ? `${trace!.synthesis.suggestions.length} gợi ý sơ bộ · ${trace!.synthesis.conflicts.length} mâu thuẫn`
                    : "Không có kết quả"
                }
                accent="bg-violet-500/10 text-violet-600 dark:text-violet-400"
              >
                {trace!.synthesis ? (
                  <div className="space-y-2">
                    {trace!.synthesis.conflicts.length > 0 && (
                      <div className="rounded-lg border border-red-300/40 bg-red-500/5 p-2.5 space-y-1.5">
                        <p className="text-[10px] font-bold text-red-600 dark:text-red-400 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> Mâu thuẫn phát hiện
                        </p>
                        {trace!.synthesis.conflicts.map((c, i) => (
                          <div key={i} className="text-[10px] text-muted-foreground dark:text-zinc-400">
                            <span className="font-semibold text-foreground dark:text-zinc-200">{c.description}</span>
                            <span className="text-muted-foreground/60"> ({c.group1} ↔ {c.group2})</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {trace!.synthesis.suggestions.length > 0 && (
                      <Collapsible title="Gợi ý sơ bộ (draft)" count={trace!.synthesis.suggestions.length} defaultOpen>
                        {trace!.synthesis.suggestions.map((s, i) => (
                          <div key={i} className="rounded border border-border/20 p-1.5">
                            <p className="text-[10px] font-semibold text-foreground dark:text-zinc-200">
                              {s.title || "Gợi ý"} <span className="text-[9px] font-normal text-muted-foreground/60">· {s.sourceChatName || ""}</span>
                            </p>
                          </div>
                        ))}
                      </Collapsible>
                    )}
                  </div>
                ) : (
                  <p className="text-[10px] text-muted-foreground/60">Stage 2 không trả kết quả (đã fallback).</p>
                )}
              </SectionCard>

              {/* STAGE 3: Critic */}
              <SectionCard
                icon={<ShieldCheck className="w-3.5 h-3.5" />}
                title="Stage 3 — Kiểm duyệt chứng cứ"
                subtitle={
                  trace!.critic
                    ? `${trace!.critic.verified.length} giữ lại · ${trace!.critic.removed.length} loại (hallucination)`
                    : "Không có kết quả"
                }
                accent="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              >
                {trace!.critic ? (
                  <div className="space-y-2">
                    {trace!.critic.removed.length > 0 && (
                      <div className="rounded-lg border border-red-300/40 bg-red-500/5 p-2.5">
                        <p className="text-[10px] font-bold text-red-600 dark:text-red-400 flex items-center gap-1">
                          <XCircle className="w-3 h-3" /> Loại bỏ {trace!.critic.removed.length} gợi ý (không đủ chứng cứ)
                        </p>
                        <div className="mt-1 space-y-0.5">
                          {trace!.critic.removed.map((s, i) => (
                            <p key={i} className="text-[9px] text-muted-foreground/60 line-through">{s.title || "Gợi ý"}</p>
                          ))}
                        </div>
                      </div>
                    )}
                    {trace!.critic.verified.length > 0 && (
                      <Collapsible title="Gợi ý đã xác minh" count={trace!.critic.verified.length} defaultOpen>
                        {trace!.critic.verified.map((s, i) => (
                          <div key={i} className="rounded border border-border/20 p-1.5">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${CONFIDENCE_COLOR[s.confidence] || CONFIDENCE_COLOR.medium}`}>
                                {s.confidence || "medium"}
                              </span>
                              <span className="text-[10px] font-semibold text-foreground dark:text-zinc-200">{s.title || "Gợi ý"}</span>
                            </div>
                            {s.sourceChatName && (
                              <p className="text-[9px] text-muted-foreground/60 mt-0.5">Nguồn: {s.sourceChatName}</p>
                            )}
                          </div>
                        ))}
                      </Collapsible>
                    )}
                  </div>
                ) : (
                  <p className="text-[10px] text-muted-foreground/60">Stage 3 không trả kết quả (đã fallback).</p>
                )}
              </SectionCard>
            </>
          ) : (
            /* No trace (e.g. fallback) — show final suggestions only */
            <SectionCard
              icon={<Sparkles className="w-3.5 h-3.5" />}
              title="Kết quả gợi ý"
              subtitle={`${result.suggestions.length} gợi ý`}
              accent="bg-amber-500/10 text-amber-600 dark:text-amber-400"
            >
              {result.suggestions.length === 0 ? (
                <p className="text-[10px] text-muted-foreground/60">Không có gợi ý nào.</p>
              ) : (
                <div className="space-y-1.5">
                  {result.suggestions.map((s, i) => (
                    <div key={i} className="rounded border border-border/20 p-2">
                      <p className="text-[11px] font-semibold text-foreground dark:text-zinc-200">{s.title || "Gợi ý"}</p>
                      {s.description && <p className="text-[10px] text-muted-foreground dark:text-zinc-400 mt-0.5 line-clamp-2">{s.description}</p>}
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          )}
        </>
      )}
    </div>
  );
}