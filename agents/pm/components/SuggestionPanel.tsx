"use client";

import { useState } from "react";
import { Lightbulb, X, ChevronRight, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { AgentSuggestion } from "../lib/types";

interface SuggestionPanelProps {
  extraSuggestions?: AgentSuggestion[];
  onAction?: (suggestion: AgentSuggestion) => void;
}

export function SuggestionPanel({ extraSuggestions = [], onAction }: SuggestionPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const allSuggestions = extraSuggestions.filter(
    (s) => !dismissedIds.has(s.id)
  );

  if (allSuggestions.length === 0) return null;

  const dismiss = (id: string) => {
    setDismissedIds((prev) => new Set(prev).add(id));
  };

  const typeStyles: Record<string, { bg: string; border: string; icon: React.ReactNode }> = {
    warning: { bg: "bg-amber-50", border: "border-amber-200", icon: <AlertTriangle className="w-4 h-4 text-amber-500" /> },
    success: { bg: "bg-emerald-50", border: "border-emerald-200", icon: <CheckCircle2 className="w-4 h-4 text-emerald-500" /> },
    info: { bg: "bg-blue-50", border: "border-blue-200", icon: <Info className="w-4 h-4 text-blue-500" /> },
    action: { bg: "bg-primary/[0.03]", border: "border-primary/20", icon: <Lightbulb className="w-4 h-4 text-primary" /> },
  };

  return (
    <>
      {/* FAB for panel */}
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="w-10 h-10 rounded-xl bg-white border border-gray-200 shadow-lg hover:shadow-xl hover:border-primary/30 transition-all cursor-pointer flex items-center justify-center group"
          title="Gợi ý"
        >
          <div className="relative">
            <Lightbulb className="w-5 h-5 text-primary/70 group-hover:text-primary transition-colors" />
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-amber-400" />
          </div>
        </button>
      )}

      {/* Panel */}
      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 top-0 h-full w-[380px] bg-white border-l border-gray-200 shadow-2xl z-50 flex flex-col overflow-hidden">
            <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-primary" />
                <p className="text-sm font-bold text-gray-800">Gợi ý từ Agent</p>
                <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">
                  {allSuggestions.length}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="w-7 h-7 rounded-lg hover:bg-gray-100 flex items-center justify-center cursor-pointer bg-transparent border-none"
              >
                <X className="w-4 h-4 text-gray-400" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {allSuggestions.map((s) => {
                const style = typeStyles[s.type] || typeStyles.info;
                return (
                  <div
                    key={s.id}
                    className={`${style.bg} border ${style.border} rounded-xl p-3`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="shrink-0 mt-0.5">{style.icon}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs font-bold text-gray-800">{s.title}</p>
                          <button
                            type="button"
                            onClick={() => dismiss(s.id)}
                            className="shrink-0 w-5 h-5 rounded hover:bg-black/5 flex items-center justify-center cursor-pointer bg-transparent border-none"
                          >
                            <X className="w-3 h-3 text-gray-400" />
                          </button>
                        </div>
                        <p className="text-[11px] text-gray-600 mt-1 leading-relaxed">
                          {s.description}
                        </p>
                        {s.actionLabel && (
                          <div className="flex items-center gap-2 mt-2">
                            <button
                              type="button"
                              onClick={() => onAction?.(s)}
                              className="text-[10px] font-semibold text-primary hover:text-primary/80 flex items-center gap-0.5 cursor-pointer bg-transparent border-none"
                            >
                              {s.actionLabel}
                              <ChevronRight className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => dismiss(s.id)}
                              className="text-[10px] text-gray-400 hover:text-gray-600 cursor-pointer bg-transparent border-none"
                            >
                              Bỏ qua
                            </button>
                          </div>
                        )}
                        {s.source && (
                          <p className="text-[9px] text-gray-400 mt-1.5">
                            Nguồn: {s.source}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}
