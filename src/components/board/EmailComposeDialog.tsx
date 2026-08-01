"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useAuth } from "@clerk/nextjs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { WysiwygEditor } from "./WysiwygEditor";
import {
  Mail,
  X,
  Paperclip,
  Send,
  Loader2,
  ChevronDown,
  AlertTriangle,
  CheckCircle2,
  ArrowUpCircle,
  ArrowDownCircle,
  Minus,
} from "lucide-react";
import type { Id } from "../../../convex/_generated/dataModel";

// ─── Types ──────────────────────────────────────────────────

interface EmailComposeDialogProps {
  /** Pre-filled recipients */
  defaultTo?: string[];
  /** Pre-filled CC */
  defaultCc?: string[];
  /** Pre-filled subject */
  defaultSubject?: string;
  /** Pre-filled body (HTML) */
  defaultBody?: string;
  /** Associated project ID */
  projectId?: Id<"projects">;
  /** Custom trigger element */
  trigger?: React.ReactNode;
  /** Callback when email is sent */
  onSent?: () => void;
  /** Control open state externally */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

// ─── Email Tag Input ────────────────────────────────────────

export function EmailTagInput({
  label,
  emails,
  onChange,
  placeholder,
  userId,
}: {
  label: string;
  emails: string[];
  onChange: (emails: string[]) => void;
  placeholder?: string;
  userId?: string | null;
}) {
  const [inputValue, setInputValue] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestionIdx, setSelectedSuggestionIdx] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const knownRecipients = useQuery(
    api.knownRecipients.search,
    userId && inputValue.trim().length >= 1
      ? { userId, query: inputValue, limit: 10 }
      : "skip"
  );

  const suggestions = knownRecipients ?? [];

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const addEmail = useCallback(
    (email: string) => {
      const trimmed = email.trim().toLowerCase();
      if (trimmed && trimmed.includes("@") && !emails.includes(trimmed)) {
        onChange([...emails, trimmed]);
      }
      setInputValue("");
      setShowSuggestions(false);
      setSelectedSuggestionIdx(-1);
    },
    [emails, onChange]
  );

  const removeEmail = useCallback(
    (email: string) => {
      onChange(emails.filter((e) => e !== email));
    },
    [onChange]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedSuggestionIdx((prev) =>
          prev < suggestions.length - 1 ? prev + 1 : 0
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedSuggestionIdx((prev) =>
          prev > 0 ? prev - 1 : suggestions.length - 1
        );
        return;
      }
      if (e.key === "Enter" && selectedSuggestionIdx >= 0) {
        e.preventDefault();
        addEmail(suggestions[selectedSuggestionIdx].email);
        return;
      }
      if (e.key === "Escape") {
        setShowSuggestions(false);
        setSelectedSuggestionIdx(-1);
        return;
      }
    }

    if ((e.key === "Enter" || e.key === "Tab" || e.key === ",") && inputValue.trim()) {
      e.preventDefault();
      addEmail(inputValue);
    } else if (e.key === "Backspace" && !inputValue && emails.length > 0) {
      removeEmail(emails[emails.length - 1]);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedText = e.clipboardData.getData("text");
    const newEmails = pastedText
      .split(/[,;\s\n]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s && s.includes("@"));
    if (newEmails.length > 0) {
      const unique = [...new Set([...emails, ...newEmails])];
      onChange(unique);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    setShowSuggestions(true);
    setSelectedSuggestionIdx(-1);
  };

  const handleFocus = () => {
    if (inputValue.trim().length >= 1) {
      setShowSuggestions(true);
    }
  };

  return (
    <div className="flex items-start gap-2 relative" ref={containerRef}>
      <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide min-w-[28px] pt-2 select-none">
        {label}
      </label>
      <div
        className="flex-1 flex flex-wrap gap-1 min-h-[36px] p-1.5 rounded-lg border border-border/60 bg-background/50 focus-within:ring-2 focus-within:ring-primary/30 focus-within:border-primary/50 transition-all cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        {emails.map((email) => (
          <span
            key={email}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 text-primary text-[11px] font-medium"
          >
            {email}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeEmail(email);
              }}
              className="hover:text-destructive transition-colors cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="email"
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onFocus={handleFocus}
          onBlur={() => {
            setTimeout(() => {
              if (inputValue.trim()) addEmail(inputValue);
            }, 150);
          }}
          placeholder={emails.length === 0 ? placeholder || "email@example.com" : ""}
          className="flex-1 min-w-[120px] bg-transparent text-[12px] text-foreground placeholder:text-muted-foreground/50 outline-none border-0 p-1"
        />
      </div>

      {/* Autocomplete dropdown */}
      {showSuggestions && suggestions.length > 0 && (
        <div className="absolute left-[36px] right-0 top-full mt-1 z-50 bg-popover border border-border rounded-xl shadow-xl overflow-hidden">
          <div className="py-1 max-h-[200px] overflow-y-auto">
            {suggestions.map((recipient, idx) => {
              const isAlreadyAdded = emails.includes(recipient.email);
              return (
                <button
                  key={recipient.email}
                  type="button"
                  disabled={isAlreadyAdded}
                  onClick={() => {
                    if (!isAlreadyAdded) addEmail(recipient.email);
                  }}
                  className={`w-full text-left px-3 py-2 text-[12px] transition-colors cursor-pointer flex items-center justify-between gap-2 ${
                    idx === selectedSuggestionIdx
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-muted text-foreground"
                  } ${isAlreadyAdded ? "opacity-40 cursor-not-allowed" : ""}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <span className="text-[10px] font-bold text-primary">
                        {(recipient.name || recipient.email)[0].toUpperCase()}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[12px] font-medium truncate">
                        {recipient.name || recipient.email}
                      </div>
                      {recipient.name && (
                        <div className="text-[10px] text-muted-foreground truncate">
                          {recipient.email}
                        </div>
                      )}
                    </div>
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {recipient.useCount > 1 ? `${recipient.useCount} lần` : ""}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Email Compose Dialog ───────────────────────────────────

export function EmailComposeDialog({
  defaultTo = [],
  defaultCc = [],
  defaultSubject = "",
  defaultBody = "",
  projectId,
  trigger,
  onSent,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: EmailComposeDialogProps) {
  const { userId } = useAuth();
  const createEmailLog = useMutation(api.emails.createEmailLog);
  const updateEmailStatus = useMutation(api.emails.updateEmailStatus);
  const saveRecipients = useMutation(api.knownRecipients.saveRecipients);

  // State
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled
    ? (v: boolean) => controlledOnOpenChange?.(v)
    : setInternalOpen;

  const [to, setTo] = useState<string[]>(defaultTo);
  const [cc, setCc] = useState<string[]>(defaultCc);
  const [bcc, setBcc] = useState<string[]>([]);
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);
  const [importance, setImportance] = useState<"low" | "normal" | "high">("normal");
  const [attachments, setAttachments] = useState<File[]>([]);
  const [showCcBcc, setShowCcBcc] = useState(defaultCc.length > 0);

  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [editorHeight, setEditorHeight] = useState(250);
  const [minEditorHeight] = useState(120);
  const [maxEditorHeight] = useState(600);
  const editorResizeRef = useRef(false);
  const editorStartYRef = useRef(0);
  const editorStartHeightRef = useRef(0);

  const handleEditorResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    editorResizeRef.current = true;
    editorStartYRef.current = e.clientY;
    editorStartHeightRef.current = editorHeight;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }, [editorHeight]);

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!editorResizeRef.current) return;
      const diff = e.clientY - editorStartYRef.current;
      const newHeight = Math.max(minEditorHeight, Math.min(maxEditorHeight, editorStartHeightRef.current + diff));
      setEditorHeight(newHeight);
    };
    const handleUp = () => {
      if (editorResizeRef.current) {
        editorResizeRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
    return () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };
  }, [minEditorHeight, maxEditorHeight]);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTo(defaultTo);
      setCc(defaultCc);
      setBcc([]);
      setSubject(defaultSubject);
      setBody(defaultBody);
      setImportance("normal");
      setAttachments([]);
      setSendResult(null);
      setShowCcBcc(defaultCc.length > 0);
    }
  }, [open, defaultTo, defaultCc, defaultSubject, defaultBody]);

  // Handle file selection
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setAttachments((prev) => [...prev, ...Array.from(e.target.files!)]);
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  // Send email
  const handleSend = async () => {
    if (!userId || to.length === 0 || !subject.trim()) return;

    setSending(true);
    setSendResult(null);

    try {
      // 1. Create email log in Convex
      const emailId = await createEmailLog({
        userId,
        to,
        cc: cc.length > 0 ? cc : undefined,
        bcc: bcc.length > 0 ? bcc : undefined,
        subject,
        body: body || "<p></p>",
        attachmentNames:
          attachments.length > 0
            ? attachments.map((f) => f.name)
            : undefined,
        importance: importance !== "normal" ? importance : undefined,
        projectId: projectId || undefined,
      });

      // 2. Call API to send via Playwright
      const response = await fetch("/api/agents/outlook-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          to,
          cc: cc.length > 0 ? cc : undefined,
          bcc: bcc.length > 0 ? bcc : undefined,
          subject,
          body: body || "<p></p>",
          importance,
          headless: true,
        }),
      });

      const result = await response.json();

      if (result.ok) {
        await updateEmailStatus({ id: emailId, status: "sent" });
        // Save all recipients to known list
        await saveRecipients({ userId, emails: [...to, ...cc, ...bcc] });
        setSendResult({
          ok: true,
          message: "Email đã được gửi thành công!",
        });
        onSent?.();

        // Close dialog after 2 seconds
        setTimeout(() => {
          setOpen(false);
        }, 2000);
      } else {
        await updateEmailStatus({
          id: emailId,
          status: "failed",
          errorMessage: result.error,
        });
        setSendResult({
          ok: false,
          message: result.error || "Không thể gửi email.",
        });
      }
    } catch (err) {
      setSendResult({
        ok: false,
        message:
          err instanceof Error ? err.message : "Lỗi không xác định.",
      });
    } finally {
      setSending(false);
    }
  };

  const importanceConfig = {
    low: {
      icon: ArrowDownCircle,
      label: "Thấp",
      class: "text-blue-500",
    },
    normal: {
      icon: Minus,
      label: "Bình thường",
      class: "text-muted-foreground",
    },
    high: {
      icon: ArrowUpCircle,
      label: "Cao",
      class: "text-rose-500",
    },
  };

  const currentImportance = importanceConfig[importance];
  const ImportanceIcon = currentImportance.icon;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger &&
        React.cloneElement(
          trigger as React.ReactElement<{ onClick?: React.MouseEventHandler }>,
          {
            onClick: (e: React.MouseEvent) => {
              setOpen(true);
              (
                trigger as React.ReactElement<{
                  onClick?: React.MouseEventHandler;
                }>
              ).props.onClick?.(e);
            },
          }
        )}

      <DialogContent
        className="sm:max-w-2xl max-h-[90vh] overflow-y-auto"
        showCloseButton={!sending}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary/10">
              <Mail className="w-4 h-4 text-primary" />
            </div>
            Soạn Email
            <span className="text-[10px] font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded-full ml-1">
              via Outlook
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* Result banner */}
        {sendResult && (
          <div
            className={`flex items-center gap-2 p-3 rounded-lg text-[12px] font-medium ${
              sendResult.ok
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-destructive/10 text-destructive"
            }`}
          >
            {sendResult.ok ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            )}
            {sendResult.message}
          </div>
        )}

        <div className="space-y-3">
          {/* To */}
          <EmailTagInput
            label="To"
            emails={to}
            onChange={setTo}
            placeholder="Nhập email người nhận..."
            userId={userId}
          />

          {/* CC/BCC toggle */}
          <div className="flex justify-end -mt-1">
            <button
              type="button"
              onClick={() => setShowCcBcc(!showCcBcc)}
              className="text-[10px] text-muted-foreground hover:text-primary transition-colors cursor-pointer"
            >
              {showCcBcc ? "Ẩn CC/BCC" : "Hiện CC/BCC"}
            </button>
          </div>

          {/* CC */}
          {showCcBcc && (
            <>
              <EmailTagInput
                label="CC"
                emails={cc}
                onChange={setCc}
                placeholder="CC..."
                userId={userId}
              />
              <EmailTagInput
                label="BCC"
                emails={bcc}
                onChange={setBcc}
                placeholder="BCC..."
                userId={userId}
              />
            </>
          )}

          {/* Subject */}
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide min-w-[28px] select-none">
              Sub
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Tiêu đề email..."
              className="flex-1 px-3 py-2 rounded-lg border border-border/60 bg-background/50 text-[12px] text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
            />
          </div>

          {/* Body — WysiwygEditor with resize handle */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide select-none px-0.5">
              Nội dung
            </label>
            <div
              className="border border-border/60 rounded-lg overflow-hidden"
              style={{ height: editorHeight }}
            >
              <WysiwygEditor
                content={body}
                onChange={setBody}
                placeholder="Nhập nội dung email..."
              />
            </div>
            {/* Vertical resize handle */}
            <div
              className="h-[5px] -mt-0.5 cursor-row-resize relative group"
              onMouseDown={handleEditorResizeStart}
            >
              <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 w-10 h-[3px] rounded-full group-hover:bg-primary/40 group-active:bg-primary/60 transition-colors" />
            </div>
          </div>

          {/* Attachments */}
          {attachments.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide select-none px-0.5">
                Đính kèm ({attachments.length})
              </label>
              <div className="flex flex-wrap gap-1.5">
                {attachments.map((file, i) => (
                  <div
                    key={`${file.name}-${i}`}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/50 border border-border/40 text-[11px]"
                  >
                    <Paperclip className="w-3 h-3 text-muted-foreground" />
                    <span className="max-w-[150px] truncate">
                      {file.name}
                    </span>
                    <span className="text-muted-foreground">
                      ({(file.size / 1024).toFixed(0)}KB)
                    </span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(i)}
                      className="hover:text-destructive transition-colors cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bottom bar */}
          <div className="flex items-center justify-between pt-2 border-t border-border/40">
            <div className="flex items-center gap-1.5">
              {/* Attach button */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={sending}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-all cursor-pointer disabled:opacity-50"
                title="Đính kèm file"
              >
                <Paperclip className="w-3.5 h-3.5" />
                Đính kèm
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileSelect}
                className="hidden"
              />

              {/* Importance */}
              <div className="relative group">
                <button
                  type="button"
                  className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-all cursor-pointer hover:bg-muted ${currentImportance.class}`}
                  title="Mức độ quan trọng"
                >
                  <ImportanceIcon className="w-3.5 h-3.5" />
                  <ChevronDown className="w-3 h-3" />
                </button>
                <div className="absolute bottom-full left-0 mb-1 hidden group-hover:block bg-popover border border-border rounded-lg shadow-lg p-1 min-w-[140px] z-50">
                  {(["low", "normal", "high"] as const).map((level) => {
                    const cfg = importanceConfig[level];
                    const Icon = cfg.icon;
                    return (
                      <button
                        key={level}
                        type="button"
                        onClick={() => setImportance(level)}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors cursor-pointer hover:bg-muted ${
                          importance === level ? "bg-primary/10 text-primary" : cfg.class
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {cfg.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Send button */}
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || to.length === 0 || !subject.trim()}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-primary text-primary-foreground text-[12px] font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow-md cursor-pointer"
            >
              {sending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Đang gửi...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Gửi Email
                </>
              )}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
