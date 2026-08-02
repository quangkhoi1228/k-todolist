"use client";

import { useState, useMemo } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useUnresolvedSuggestionsByUser, useSuggestionMutations } from "@/hooks/useDomain";
import {
  Sparkles, X, CheckCircle2,
  MessageSquare, AlertTriangle, Clock, Users, ArrowUpRight
} from "lucide-react";

interface SuggestionsQuickViewProps {
  isOpen: boolean;
  onClose: () => void;
}

const TYPE_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  transfer_request: {
    label: "Bàn giao",
    color: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-500/30",
    icon: <Users className="w-3 h-3" />,
  },
  mention: {
    label: "Đề cập",
    color: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-500/30",
    icon: <MessageSquare className="w-3 h-3" />,
  },
  action_item: {
    label: "Hành động",
    color: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-500/30",
    icon: <CheckCircle2 className="w-3 h-3" />,
  },
  deadline: {
    label: "Hạn chót",
    color: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-500/30",
    icon: <Clock className="w-3 h-3" />,
  },
  warning: {
    label: "Cảnh báo",
    color: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-500/30",
    icon: <AlertTriangle className="w-3 h-3" />,
  },
  info: {
    label: "Thông tin",
    color: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-500/30",
    icon: <Sparkles className="w-3 h-3" />,
  },
};

export function SuggestionsQuickView({ isOpen, onClose }: SuggestionsQuickViewProps) {
  const { userId } = useAuth();
  const router = useRouter();
  const smx = useSuggestionMutations();
  const [filter, setFilter] = useState<string>("all");

  const { data: unresolvedSuggestionsData } = useUnresolvedSuggestionsByUser(userId);
  const unresolvedSuggestions = unresolvedSuggestionsData ?? [];

  const filteredSuggestions = useMemo(() => {
    if (filter === "all") return unresolvedSuggestions;
    return unresolvedSuggestions.filter((s) => s.type === filter);
  }, [unresolvedSuggestions, filter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: unresolvedSuggestions.length };
    for (const s of unresolvedSuggestions) {
      c[s.type] = (c[s.type] || 0) + 1;
    }
    return c;
  }, [unresolvedSuggestions]);

  if (!isOpen) return null;

  return (
    <div className="flex flex-col h-full bg-background/98 dark:bg-zinc-900/98 border-l border-border/50">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-border/40 dark:border-zinc-800 bg-gradient-to-r from-primary/5 to-transparent">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-500/5 flex items-center justify-center ring-2 ring-amber-500/20">
            <Sparkles className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <p className="text-sm font-bold text-foreground dark:text-zinc-100 leading-tight">Gợi ý hành động</p>
            <p className="text-[10px] text-muted-foreground dark:text-zinc-500">
              {unresolvedSuggestions.length} gợi ý chưa xử lý
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="w-7 h-7 rounded-lg hover:bg-destructive/10 dark:hover:bg-red-500/20 flex items-center justify-center cursor-pointer text-muted-foreground hover:text-destructive dark:text-zinc-400 dark:hover:text-red-400 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Filter tabs */}
      <div className="shrink-0 flex gap-1 px-3 py-2 overflow-x-auto border-b border-border/30">
        {[
          { key: "all", label: "Tất cả" },
          { key: "transfer_request", label: "Bàn giao" },
          { key: "mention", label: "Đề cập" },
          { key: "action_item", label: "Hành động" },
          { key: "deadline", label: "Hạn chót" },
          { key: "warning", label: "Cảnh báo" },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setFilter(tab.key)}
            className={`text-[10px] px-2.5 py-1 rounded-full border font-semibold transition-all cursor-pointer whitespace-nowrap ${
              filter === tab.key
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-muted/30 text-muted-foreground border-border/50 hover:bg-muted/50"
            }`}
          >
            {tab.label} {counts[tab.key] ? `(${counts[tab.key]})` : ""}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
        {filteredSuggestions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <CheckCircle2 className="w-10 h-10 text-emerald-500/30 mb-3" />
            <p className="text-xs font-medium text-muted-foreground/60">Không có gợi ý nào</p>
            <p className="text-[10px] text-muted-foreground/40 mt-1 max-w-[200px]">
              Agent sẽ tự động phân tích tin nhắn Teams và hiển thị gợi ý tại đây
            </p>
          </div>
        ) : (
          filteredSuggestions.map((s) => {
            const cfg = TYPE_CONFIG[s.type] || TYPE_CONFIG.info;
            return (
              <div
                key={s._id}
                className={`p-3 rounded-xl border transition-all cursor-pointer hover:shadow-sm ${
                  !s.isRead
                    ? "bg-primary/[0.03] border-primary/30"
                    : "bg-card/50 dark:bg-zinc-800/50 border-border/30 dark:border-zinc-700/50 hover:border-border/60"
                }`}
                onClick={() => {
                  if (!s.isRead) smx.markSuggestionAsRead(s._id);
                  // Navigate to the project detail page
                  if ((s as any).projectId) {
                    router.push(`/projects/${(s as any).projectId}`);
                  }
                }}
              >
                <div className="flex items-start gap-2">
                  <div className={`mt-0.5 w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${cfg?.color || "bg-muted"}`}>
                    {cfg?.icon || <Sparkles className="w-3 h-3" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {s.type && (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${cfg?.color || "bg-muted text-muted-foreground"}`}>
                          {cfg?.label || s.type}
                        </span>
                      )}
                      <span className="text-[11px] font-bold text-foreground dark:text-zinc-100 truncate flex-1">
                        {s.title}
                      </span>
                      {!s.isRead && (
                        <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground dark:text-zinc-400 mt-1 leading-relaxed line-clamp-3">
                      {s.description}
                    </p>
                    {(s.sourceSender || s.sourceChatName) && (
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
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
                    <div className="flex items-center gap-1.5 mt-2">
                      {s.actionLabel === "Sao chép tin nhắn" && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(s.description).then(() => {
                              e.currentTarget.textContent = "Đã sao chép!";
                              setTimeout(() => {
                                e.currentTarget.textContent = s.actionLabel || "";
                              }, 2000);
                            });
                          }}
                          className="text-[9px] px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-500/30 hover:bg-blue-500/20 transition-colors cursor-pointer"
                        >
                          {s.actionLabel}
                        </button>
                      )}
                      {!s.isResolved && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            smx.markSuggestionAsResolved(s._id);
                          }}
                          className="text-[9px] px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30 hover:bg-emerald-500/20 transition-colors cursor-pointer"
                        >
                          Đã xử lý
                        </button>
                      )}
                      <span className="text-[8px] text-muted-foreground/40 flex items-center gap-0.5 ml-auto">
                        Xem dự án <ArrowUpRight className="w-2.5 h-2.5" />
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
