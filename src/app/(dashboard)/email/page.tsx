"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useAuth } from "@clerk/nextjs";
import { EmailComposeInline } from "@/components/board/EmailComposeInline";
import type { Doc } from "../../../../convex/_generated/dataModel";
import {
  Mail,
  Plus,
  CheckCircle2,
  XCircle,
  Loader2,
  Send,
  Trash2,
  RefreshCw,
  Search,
  Edit3,
  FolderKanban,
} from "lucide-react";
import { format } from "date-fns";

const STATUS_CONFIG: Record<
  string,
  { icon: typeof CheckCircle2; label: string; class: string }
> = {
  sending: {
    icon: Loader2,
    label: "Đang gửi",
    class: "text-amber-500 bg-amber-500/10",
  },
  sent: {
    icon: CheckCircle2,
    label: "Đã gửi",
    class: "text-emerald-500 bg-emerald-500/10",
  },
  failed: {
    icon: XCircle,
    label: "Thất bại",
    class: "text-rose-500 bg-rose-500/10",
  },
};

export default function EmailPage() {
  const { userId } = useAuth();
  const projects = useQuery(api.projects.getProjects, userId ? { userId } : "skip");

  const [filterProjectId, setFilterProjectId] = useState<string | undefined>(undefined);
  const emails = useQuery(
    api.emails.getByUser,
    userId
      ? { userId, projectId: filterProjectId as any }
      : "skip"
  );
  const deleteEmail = useMutation(api.emails.deleteEmail);

  const [composing, setComposing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const [healthStatus, setHealthStatus] = useState<{
    checking: boolean;
    ok?: boolean;
    error?: string;
  }>({ checking: false });
  const [projectFilterOpen, setProjectFilterOpen] = useState(false);

  const checkHealth = async () => {
    setHealthStatus({ checking: true });
    try {
      const res = await fetch("/api/agents/outlook-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "health" }),
      });
      const data = await res.json();
      setHealthStatus({ checking: false, ok: data.ok, error: data.error });
    } catch (err) {
      setHealthStatus({
        checking: false,
        ok: false,
        error: err instanceof Error ? err.message : "Network error",
      });
    }
  };

  const filteredEmails = emails?.filter((email) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      email.subject.toLowerCase().includes(q) ||
      email.to.some((t) => t.toLowerCase().includes(q))
    );
  });

  const selectedEmailData = emails?.find((e) => e._id === selectedEmail);

  const [listWidth, setListWidth] = useState(380);
  const [minListWidth] = useState(260);
  const [maxListWidth] = useState(800);
  const resizingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = listWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [listWidth]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizingRef.current) return;
      const diff = e.clientX - startXRef.current;
      const newWidth = Math.max(minListWidth, Math.min(maxListWidth, startWidthRef.current + diff));
      setListWidth(newWidth);
    };
    const handleMouseUp = () => {
      if (resizingRef.current) {
        resizingRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [minListWidth, maxListWidth]);

  const handleStartCompose = () => {
    setSelectedEmail(null);
    setComposing(true);
  };

  const handleCloseCompose = () => {
    setComposing(false);
  };

  const handleSelectEmail = (id: string) => {
    setComposing(false);
    setSelectedEmail(id);
  };

  const selectedProject = projects?.find((p) => p._id === filterProjectId);

  const rightPanelContent = composing ? (
    <EmailComposeInline
      onClose={handleCloseCompose}
      onSent={handleCloseCompose}
      projectId={filterProjectId as any}
    />
  ) : selectedEmailData ? (
    <EmailDetail
      email={selectedEmailData}
      onDelete={async () => {
        await deleteEmail({ id: selectedEmailData._id });
        setSelectedEmail(null);
      }}
    />
  ) : (
    <div className="flex flex-col items-center justify-center h-full text-center px-8">
      <div className="p-4 rounded-2xl bg-muted/30 mb-4">
        <Send className="w-10 h-10 text-muted-foreground/30" />
      </div>
      <p className="text-[13px] font-medium text-muted-foreground mb-1">
        Chọn email để xem chi tiết
      </p>
      <p className="text-[11px] text-muted-foreground/70 max-w-[240px]">
        Hoặc soạn email mới bằng nút ở góc phải trên
      </p>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 py-4 border-b border-border/40 bg-background/60 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-primary/10 shadow-sm">
              <Mail className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground tracking-tight">
                Email
              </h1>
              <p className="text-[11px] text-muted-foreground">
                Gửi email từ tài khoản Outlook
              </p>
            </div>

            {/* Project filter */}
            <div className="relative ml-4">
              <button
                onClick={() => setProjectFilterOpen(!projectFilterOpen)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted transition-all cursor-pointer"
              >
                <FolderKanban className="w-3.5 h-3.5" />
                {selectedProject ? selectedProject.name : "Tất cả dự án"}
              </button>

              {projectFilterOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setProjectFilterOpen(false)} />
                  <div className="absolute left-0 top-full mt-1 z-50 bg-popover border border-border rounded-xl shadow-xl overflow-hidden min-w-[200px]">
                    <div className="py-1 max-h-[280px] overflow-y-auto">
                      <button
                        onClick={() => { setFilterProjectId(undefined); setProjectFilterOpen(false); }}
                        className={`w-full text-left px-3 py-2 text-[12px] transition-colors hover:bg-muted flex items-center gap-2 ${
                          !filterProjectId ? "bg-primary/10 text-primary font-medium" : "text-foreground"
                        }`}
                      >
                        <Mail className="w-3.5 h-3.5" />
                        Tất cả dự án
                      </button>
                      {projects?.map((p) => (
                        <button
                          key={p._id}
                          onClick={() => { setFilterProjectId(p._id); setProjectFilterOpen(false); }}
                          className={`w-full text-left px-3 py-2 text-[12px] transition-colors hover:bg-muted flex items-center gap-2 ${
                            filterProjectId === p._id ? "bg-primary/10 text-primary font-medium" : "text-foreground"
                          }`}
                        >
                          <div
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: p.color || "#8b5cf6" }}
                          />
                          <span className="truncate">{p.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Health check */}
            <button
              onClick={checkHealth}
              disabled={healthStatus.checking}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-all cursor-pointer ${
                healthStatus.ok === true
                  ? "border-emerald-500/30 text-emerald-600 bg-emerald-500/5"
                  : healthStatus.ok === false
                    ? "border-rose-500/30 text-rose-600 bg-rose-500/5"
                    : "border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
              title="Kiểm tra kết nối Outlook"
            >
              {healthStatus.checking ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              {healthStatus.ok === true
                ? "Outlook OK"
                : healthStatus.ok === false
                  ? "Lỗi kết nối"
                  : "Kiểm tra"}
            </button>

            {/* Compose */}
            <button
              onClick={handleStartCompose}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-semibold transition-all shadow-sm hover:shadow-md cursor-pointer ${
                composing
                  ? "bg-primary/10 text-primary border border-primary/30"
                  : "bg-primary text-primary-foreground hover:bg-primary/90"
              }`}
            >
              {composing ? <Edit3 className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {composing ? "Đang soạn" : "Soạn Email"}
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Email list — resizable */}
        <div
          className="border-r border-border/40 flex flex-col overflow-hidden shrink-0"
          style={{ width: listWidth }}
        >
          {/* Search */}
          <div className="p-3 border-b border-border/30">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm email..."
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-border/50 bg-muted/30 text-[12px] placeholder:text-muted-foreground/50 outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition-all"
              />
            </div>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {!emails ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : filteredEmails && filteredEmails.length > 0 ? (
              filteredEmails.map((email) => {
                const statusCfg = STATUS_CONFIG[email.status] || STATUS_CONFIG.sent;
                const StatusIcon = statusCfg.icon;
                const isSelected = selectedEmail === email._id;

                return (
                  <button
                    key={email._id}
                    onClick={() => handleSelectEmail(email._id)}
                    className={`w-full text-left px-4 py-3 border-b border-border/20 transition-all cursor-pointer ${
                      isSelected
                        ? "bg-primary/5 border-l-2 border-l-primary"
                        : "hover:bg-muted/30"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <StatusIcon
                            className={`w-3 h-3 shrink-0 ${statusCfg.class.split(" ")[0]} ${
                              email.status === "sending" ? "animate-spin" : ""
                            }`}
                          />
                          <span className="text-[12px] font-semibold text-foreground truncate">
                            {email.subject || "(Không tiêu đề)"}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground truncate">
                          To: {email.to.join(", ")}
                        </p>
                      </div>
                      <span className="text-[10px] text-muted-foreground/70 whitespace-nowrap shrink-0">
                        {format(new Date(email.sentAt), "dd/MM HH:mm")}
                      </span>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                <div className="p-3 rounded-2xl bg-muted/50 mb-3">
                  <Mail className="w-8 h-8 text-muted-foreground/50" />
                </div>
                <p className="text-[13px] font-medium text-muted-foreground mb-1">
                  Chưa có email nào
                </p>
                <p className="text-[11px] text-muted-foreground/70">
                  {filterProjectId ? "Dự án này chưa có email nào" : 'Click "Soạn Email" để bắt đầu'}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Resize handle */}
        <div
          className="w-[5px] shrink-0 cursor-col-resize relative group z-10 -ml-[1px]"
          onMouseDown={handleMouseDown}
        >
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[3px] group-hover:bg-primary/40 group-active:bg-primary/60 transition-colors rounded-full" />
        </div>

        {/* Right panel: compose or detail */}
        <div className="flex-1 overflow-hidden bg-muted/10">
          {rightPanelContent}
        </div>
      </div>
    </div>
  );
}

// ─── Email Detail Component ──────────────────────────────────

const STATUS_CONFIG_EMAIL: Record<
  string,
  { icon: typeof CheckCircle2; label: string; class: string }
> = {
  sending: {
    icon: Loader2,
    label: "Đang gửi",
    class: "text-amber-500 bg-amber-500/10",
  },
  sent: {
    icon: CheckCircle2,
    label: "Đã gửi",
    class: "text-emerald-500 bg-emerald-500/10",
  },
  failed: {
    icon: XCircle,
    label: "Thất bại",
    class: "text-rose-500 bg-rose-500/10",
  },
};

function EmailDetail({
  email,
  onDelete,
}: {
  email: Doc<"sentEmails">;
  onDelete: () => Promise<void>;
}) {
  return (
    <div className="flex-1 overflow-y-auto h-full">
      <div className="p-6">
        {/* Email header */}
        <div className="mb-6">
          <div className="flex items-start justify-between mb-3">
            <h2 className="text-base font-bold text-foreground">
              {email.subject || "(Không tiêu đề)"}
            </h2>
            <div className="flex items-center gap-2">
              {(() => {
                const cfg =
                  STATUS_CONFIG_EMAIL[email.status] ||
                  STATUS_CONFIG_EMAIL.sent;
                const Icon = cfg.icon;
                return (
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold ${cfg.class}`}
                  >
                    <Icon
                      className={`w-3 h-3 ${email.status === "sending" ? "animate-spin" : ""}`}
                    />
                    {cfg.label}
                  </span>
                );
              })()}
              <button
                onClick={onDelete}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all cursor-pointer"
                title="Xóa"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="space-y-1.5 text-[11px]">
            <div className="flex gap-2">
              <span className="font-semibold text-muted-foreground min-w-[32px]">
                To:
              </span>
              <span className="text-foreground">
                {email.to.join(", ")}
              </span>
            </div>
            {email.cc && email.cc.length > 0 && (
              <div className="flex gap-2">
                <span className="font-semibold text-muted-foreground min-w-[32px]">
                  CC:
                </span>
                <span className="text-foreground">
                  {email.cc.join(", ")}
                </span>
              </div>
            )}
            <div className="flex gap-2">
              <span className="font-semibold text-muted-foreground min-w-[32px]">
                Lúc:
              </span>
              <span className="text-foreground">
                {format(
                  new Date(email.sentAt),
                  "dd/MM/yyyy HH:mm:ss"
                )}
              </span>
            </div>
            {email.importance &&
              email.importance !== "normal" && (
                <div className="flex gap-2">
                  <span className="font-semibold text-muted-foreground min-w-[32px]">
                    Ưu tiên:
                  </span>
                  <span
                    className={
                      email.importance === "high"
                        ? "text-rose-500 font-semibold"
                        : "text-blue-500"
                    }
                  >
                    {email.importance === "high"
                      ? "Cao"
                      : "Thấp"}
                  </span>
                </div>
              )}
            {email.attachmentNames &&
              email.attachmentNames.length > 0 && (
                <div className="flex gap-2">
                  <span className="font-semibold text-muted-foreground min-w-[32px]">
                    File:
                  </span>
                  <span className="text-foreground">
                    {email.attachmentNames.join(", ")}
                  </span>
                </div>
              )}
          </div>

          {email.errorMessage && (
            <div className="mt-3 p-2.5 rounded-lg bg-destructive/10 text-destructive text-[11px]">
              <strong>Lỗi:</strong> {email.errorMessage}
            </div>
          )}
        </div>

        {/* Email body */}
        <div className="bg-background rounded-xl border border-border/40 p-5 shadow-sm">
          <div
            className="prose prose-sm dark:prose-invert max-w-none text-[13px]"
            dangerouslySetInnerHTML={{
              __html: email.body,
            }}
          />
        </div>
      </div>
    </div>
  );
}
