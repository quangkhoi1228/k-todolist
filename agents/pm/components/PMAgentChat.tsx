"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Bot, User, Info, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import type { ChatMessage, AgentSuggestion } from "../lib/types";

interface PMAgentChatProps {
  messages: ChatMessage[];
  onSend: (content: string) => Promise<void>;
  suggestions?: AgentSuggestion[];
  onSuggestionAction?: (suggestion: AgentSuggestion) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function PMAgentChat({
  messages,
  onSend,
  suggestions = [],
  onSuggestionAction,
  disabled = false,
  placeholder = "Nhập tin nhắn...",
}: PMAgentChatProps) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || sending || disabled) return;
    setSending(true);
    try {
      await onSend(input.trim());
      setInput("");
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const getRoleIcon = (role: string) => {
    switch (role) {
      case "agent":
        return <Bot className="w-4 h-4" />;
      case "user":
        return <User className="w-4 h-4" />;
      case "system":
        return <Info className="w-3.5 h-3.5" />;
      default:
        return <User className="w-4 h-4" />;
    }
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case "agent":
        return "bg-primary/10 border-primary/20";
      case "user":
        return "bg-muted/30 border-border/40";
      case "system":
        return "bg-amber-500/5 border-amber-500/15";
      default:
        return "bg-muted/30 border-border/40";
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-2 px-1">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-12">
            <Bot className="w-10 h-10 text-muted-foreground/30 mb-3" />
            <p className="text-xs text-muted-foreground/60">Bat dau phien lam viec voi PM Agent</p>
            <p className="text-[10px] text-muted-foreground/40 mt-1">Nhap tin nhan o ben duoi</p>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg._id}
              className={`flex items-start gap-2 p-2.5 rounded-xl border ${getRoleColor(msg.role)}`}
            >
              <div className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${
                msg.role === "agent" ? "bg-primary/15 text-primary" :
                msg.role === "user" ? "bg-muted text-muted-foreground" :
                "bg-amber-500/10 text-amber-500"
              }`}>
                {getRoleIcon(msg.role)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-[10px] font-bold text-foreground">
                    {msg.role === "agent" ? "PM Agent" : msg.role === "user" ? "Tôi" : "Hệ thống"}
                  </span>
                  <span className="text-[9px] text-muted-foreground/50">
                    {new Date(msg.createdAt).toLocaleString("vi-VN")}
                  </span>
                </div>
                <div className="text-[11px] text-foreground/90 leading-relaxed whitespace-pre-wrap">
                  {renderMessageContent(msg.content)}
                </div>
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="shrink-0 flex flex-wrap gap-1.5 px-1 py-2 border-t border-border/30">
          {suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onSuggestionAction?.(s)}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-medium border transition-all cursor-pointer ${
                s.type === "warning"
                  ? "bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400 hover:bg-amber-500/15"
                  : s.type === "success"
                    ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/15"
                    : "bg-primary/5 border-primary/15 text-primary hover:bg-primary/10"
              }`}
            >
              {s.type === "warning" ? <AlertTriangle className="w-3 h-3" /> : s.type === "success" ? <CheckCircle2 className="w-3 h-3" /> : <Info className="w-3 h-3" />}
              <span>{s.title}</span>
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="shrink-0 flex items-center gap-1.5 p-1.5 border-t border-border/30">
        <Input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || sending}
          className="flex-1 h-8 text-xs bg-background/50 border-border/60 rounded-lg"
        />
        <Button
          size="sm"
          onClick={handleSend}
          disabled={!input.trim() || sending || disabled}
          className="h-8 w-8 p-0 rounded-lg cursor-pointer shrink-0"
        >
          {sending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Send className="w-3.5 h-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
}

function renderMessageContent(content: string): React.ReactNode {
  // Simple markdown-like rendering for bold text
  const parts = content.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="font-bold text-foreground">{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}
