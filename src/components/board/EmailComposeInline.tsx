"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { EmailTagInput } from "./EmailComposeDialog";
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
import { useEmailMutations } from "@/hooks/useDomain";

// ─── Types ──────────────────────────────────────────────────

interface EmailComposeInlineProps {
  /** Pre-filled recipients */
  defaultTo?: string[];
  /** Pre-filled CC */
  defaultCc?: string[];
  /** Pre-filled subject */
  defaultSubject?: string;
  /** Pre-filled body (HTML) */
  defaultBody?: string;
  /** Associated project ID */
  projectId?: string;
  /** Callback when email is sent */
  onSent?: () => void;
  /** Called when the user closes/cancels compose */
  onClose?: () => void;
}

// ─── Email Compose Inline ───────────────────────────────────

export function EmailComposeInline({
  defaultTo = [],
  defaultCc = [],
  defaultSubject = "",
  defaultBody = "",
  projectId,
  onSent,
  onClose,
}: EmailComposeInlineProps) {
  const { userId } = useAuth();
  const emx = useEmailMutations();
  const createEmailLog = emx.createEmailLog;
  const updateEmailStatus = emx.updateEmailStatus;
  const saveRecipients = emx.saveRecipients;

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
  const [maxEditorHeight] = useState(800);
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

  // Global mouse events for editor resize
  const editorMouseMoveRef = useRef((e: MouseEvent) => {
    if (!editorResizeRef.current) return;
    const diff = e.clientY - editorStartYRef.current;
    const newHeight = Math.max(minEditorHeight, Math.min(maxEditorHeight, editorStartHeightRef.current + diff));
    setEditorHeight(newHeight);
  });
  const editorMouseUpRef = useRef(() => {
    if (editorResizeRef.current) {
      editorResizeRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
  });

  useEffect(() => {
    const handleMove = (e: MouseEvent) => editorMouseMoveRef.current(e);
    const handleUp = () => editorMouseUpRef.current();
    document.addEventListener("mousemove", handleMove);
    document.addEventListener("mouseup", handleUp);
    return () => {
      document.removeEventListener("mousemove", handleMove);
      document.removeEventListener("mouseup", handleUp);
    };
  }, []);

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
        await updateEmailStatus(emailId, "sent");
        // Save all recipients to known list for autocomplete
        await saveRecipients(userId, [...to, ...cc, ...bcc]);
        setSendResult({
          ok: true,
          message: "Email đã được gửi thành công!",
        });
        onSent?.();

        setTimeout(() => {
          onClose?.();
        }, 2000);
      } else {
        await updateEmailStatus(emailId, "failed", result.error);
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
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-border/40 bg-background/60">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-primary/10">
            <Mail className="w-4 h-4 text-primary" />
          </div>
          <span className="text-sm font-bold text-foreground">Soạn Email</span>
          <span className="text-[10px] font-normal text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
            via Outlook
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all cursor-pointer"
          title="Đóng"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Result banner */}
      {sendResult && (
        <div
          className={`shrink-0 flex items-center gap-2 mx-5 mt-3 p-3 rounded-lg text-[12px] font-medium ${
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

      {/* Form body */}
      <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
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
      </div>

      {/* Bottom bar */}
      <div className="shrink-0 flex items-center justify-between px-5 py-3 border-t border-border/40 bg-background/50">
        <div className="flex items-center gap-1.5">
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
  );
}
