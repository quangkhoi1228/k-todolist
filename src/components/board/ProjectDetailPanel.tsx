"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { ListTodo, FileText, BarChart3, Copy, Check, StickyNote, Plus, ChevronRight, Trash2, X, MessageSquare, Users, Loader2, Quote, Sparkles, ImageIcon, Mail, Download, CheckCircle2, XCircle, ExternalLink, Save, AlertTriangle, Edit3, Search, Send, BrainCircuit, ChevronDown, ListPlus, FileSpreadsheet, RefreshCcw, RefreshCw, MoreHorizontal, History, ShieldCheck } from "lucide-react";
import { EmailComposeDialog } from "./EmailComposeDialog";
import { SowImportDialog } from "./SowImportDialog";
import { format } from "date-fns";
import { WysiwygEditor } from "./WysiwygEditor";
import type { Doc } from "@/lib/types";
import { CAPABILITY_CATALOG, resolveMemberCapabilities, type RoleCapability } from "@/lib/roleCapabilities";
import type { SummaryData } from "@/lib/repo/projectSummaries";
import {
  useChatMutations,
  useGroupMutations,
  useMembersByProject,
  useMemberMutations,
  useRoles,
  useScrapedGroups,
  useTasksByProject,
  useNotesByProject,
  useMessagesByProject,
  useLogs,
  useEmails,
  useProjectMutations,
  useNoteMutations,
  useUploadFile,
  useProjectSummaries,
  useProjectSummaryMutations,
  useProjectWorkflow,
  useProjectWorkflowMutations,
  useIsdByProject,
} from "@/hooks/useDomain";
import { useInvalidate } from "@/hooks/useData";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { IsdFlowDiagram } from "./IsdFlowDiagram";
import { PhaseWorkflowCard } from "./PhaseWorkflowCard";

// ─── Entity shapes (dữ liệu từ API — vì hooks trả any[] nên khai báo tại đây) ───
interface ChatMessage {
  _id?: string;
  chatName?: string;
  sender?: string | null;
  content?: string | null;
  isMine?: boolean;
  timestampMs?: number | string | null;
  timestamp?: number | string | null;
}

const DEFAULT_NOTES = `<h2>Thông tin chung</h2>
<p>Mô tả tổng quan về dự án, mục tiêu, phạm vi...</p>
<h2>Link liên quan</h2>
<ul>
  <li><a href="https://example.com">Tên link - https://example.com</a></li>
</ul>
<h2>Ghi chú</h2>
<p>Các ghi chú, lưu ý, thông tin bổ sung...</p>
`;

interface ProjectDetailPanelProps {
  project: {
    _id: string;
    name: string;
    color?: string;
    notes?: string | null;
    archived?: boolean | null;
    deletedAt?: number | null;
    teamsGroups?: Array<{ name: string; type: "internal" | "customer"; platform?: "teams" | "zalo" | string; url?: string }>;
  };
  tab?: "info" | "notes" | "summary" | "history" | "chats" | "suggestions" | "emails" | "members" | "summaries";
  onTabChange?: (tab: "info" | "notes" | "summary" | "history" | "chats" | "suggestions" | "emails" | "members" | "summaries") => void;
}

const STATUS_LABELS: Record<string, { label: string; color: string; short: string }> = {  todo: { label: "Chưa thực hiện", color: "text-neutral-500", short: "Todo" },
  processing: { label: "Đang xử lý", color: "text-blue-500", short: "Đang XL" },
  pending: { label: "Tạm dừng", color: "text-amber-500", short: "Tạm dừng" },
  done: { label: "Đã hoàn thành", color: "text-emerald-500", short: "Done" },
};

const PRIORITY_CONFIG: Record<string, { label: string; class: string }> = {
  high: { label: "Cao", class: "bg-rose-500/10 text-rose-600 dark:text-rose-400" },
  normal: { label: "TB", class: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400" },
  low: { label: "Thấp", class: "bg-slate-500/10 text-slate-600 dark:text-slate-400" },
};

function StatusBadge({ status }: { status?: string }) {
  const s = STATUS_LABELS[status || "todo"] || STATUS_LABELS["todo"];
  return (
    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${s.color} bg-current/5`}>
      {s.short}
    </span>
  );
}

/** Split message text into runs, turning URLs into clickable links */
function LinkifyText({ text, isMine }: { text: string, isMine?: boolean }) {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("http://") || part.startsWith("https://")) {
          return (
            <a
              key={i}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className={`underline underline-offset-2 font-medium break-all ${isMine ? "text-inherit opacity-90 hover:opacity-100" : "text-primary hover:text-primary/80"}`}
            >
              {part}
            </a>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function PriorityBadge({ priority }: { priority?: string }) {
  if (!priority || priority === "normal") return null;
  const p = PRIORITY_CONFIG[priority];
  if (!p) return null;
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${p.class}`}>
      {p.label}
    </span>
  );
}

/** Build proxy URL for Teams/Zalo CDN images */
function proxyImageUrl(src: string): string {
  if (src.startsWith("blob:") || src.startsWith("data:") || src.startsWith("storage:")) return src;
  return `/api/proxy-image?url=${encodeURIComponent(src)}`;
}

/** Từ deep link Teams/Zalo → { platform, name } để lưu làm tên nhóm.
 *  Nếu không nhận diện được → trả null (giữ nguyên, để backend báo lỗi). */
function deriveGroupFromUrl(url: string): { platform: "teams" | "zalo"; name: string } | null {
  const trimmed = url.trim();
  try {
    const u = new URL(trimmed);
    if (/zalo/i.test(u.hostname)) {
      const hashMatch = u.hash.match(/#\/g\/([\w-]+)/);
      const pathMatch = u.pathname.match(/\/g\/([\w-]+)/);
      const id = hashMatch?.[1] || pathMatch?.[1];
      if (id) return { platform: "zalo", name: `[Zalo] ${id}` };
      return null;
    }
    if (/teams\.(microsoft|live)\.com/i.test(u.hostname)) {
      const m = trimmed.match(/19:[%a-zA-Z0-9._-]+@thread\.(v2|unq\.gbl\.thread\.2)/);
      if (m) return { platform: "teams", name: `[Teams] ${m[0].replace(/%3a/gi, ":")}` };
      return null;
    }
  } catch { /* not a valid URL */ }
  return null;
}

function isTeamsOrZaloUrl(src: string): boolean {
  // data: and storage: URLs are rendered directly, no proxy needed
  if (src.startsWith('data:') || src.startsWith('storage:')) return false;
  try {
    const hostname = new URL(src).hostname.toLowerCase();
    return (
      hostname.includes("microsoft") ||
      hostname.includes("sharepoint") ||
      hostname.includes("akamaized") ||
      hostname.includes("office.net") ||
      hostname.includes("cloud.microsoft") ||
      hostname.includes("zdn.vn") ||
      hostname.includes("zalo") ||
      hostname.includes("teams")
    );
  } catch {
    return false;
  }
}

/** Image with fallback for expired auth tokens (Teams/Zalo CDN URLs) */
function ChatImage({ src, alt, className, onClick }: { src: string; alt: string; className?: string; onClick?: () => void }) {
  const [useProxy, setUseProxy] = useState(false);
  const [failedProxy, setFailedProxy] = useState(false);

  // Skip rendering for truly invalid URLs
  const validSrc = src.startsWith('//') ? 'https:' + src : src;
  // Accept http, https, data:, Convex storage:, and our own /api/data/files/ URLs
  const isDataUrl = validSrc.startsWith("data:");
  const isStorageUrl = validSrc.startsWith("storage:");
  const isLocalFileUrl = validSrc.startsWith("/api/data/files/") || validSrc.startsWith("/api/files/");
  const isHttp = validSrc.startsWith("http://") || validSrc.startsWith("https://");
  const isValidUrl = isHttp || isDataUrl || isStorageUrl || isLocalFileUrl;

  const handleClick = useCallback(() => {
    // Open via proxy if original was blocked, else use original URL
    const url = (useProxy || failedProxy) ? proxyImageUrl(validSrc) : validSrc;
    window.open(url, '_blank');
    onClick?.();
  }, [validSrc, useProxy, failedProxy, onClick]);

  if (!isValidUrl) {
    console.warn(`[ChatImage] Invalid URL skipped: "${src}"`);
    return null;
  }

  // Data URLs, storage: URLs, and local file URLs render directly (no proxy needed)
  if (isDataUrl || isStorageUrl || isLocalFileUrl) {
    return (
      <img
        src={validSrc}
        alt={alt}
        className={className}
        loading="lazy"
        onClick={handleClick}
      />
    );
  }

  // Always try the original URL first (CDN might still serve it).
  // If it fails, fall back to the proxy which will attempt server-side
  // fetch with stored auth cookies to get a fresh token.
  const currentSrc = useProxy ? proxyImageUrl(validSrc) : validSrc;

  if (failedProxy) {
    return (
      <a
        href={proxyImageUrl(validSrc)}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground bg-muted/30 hover:bg-muted/50 transition-colors rounded-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <Download className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">Tải ảnh ({validSrc.slice(0, 35)}...)</span>
      </a>
    );
  }

  return (
    <img
      src={currentSrc}
      alt={alt}
      className={className}
      loading="lazy"
      onClick={handleClick}
      onError={() => {
        console.warn(`[ChatImage] onError for: ${currentSrc.slice(0, 100)}`);
        if (!useProxy) {
          // Direct load failed — retry through proxy
          setUseProxy(true);
        } else {
          // Proxy also failed — show download link
          setFailedProxy(true);
        }
      }}
    />
  );
}

/**
 * Compute a diff-like description of what changed on a task update.
 * Since we only have the current snapshot, we show key fields with
 * their current values as a meaningful "timeline entry".
 */
function TaskTimelineEntry({ task }: { task: Doc<"tasks"> }) {

  return (
    <div className="group flex items-start gap-3 p-2.5 rounded-xl border transition-all hover:shadow-sm border-border/30 hover:border-border/50 bg-muted/[0.02] hover:bg-muted/[0.04]">
      {/* Timeline dot */}
      <div className="flex flex-col items-center gap-0.5 shrink-0">
        <div
          className={`w-2.5 h-2.5 rounded-full mt-1.5 ring-4 ring-background ${
            task.status === "done"
              ? "bg-emerald-500 shadow-[0_0_6px_rgba(52,211,153,0.5)]"
              : task.status === "processing"
                ? "bg-blue-500 shadow-[0_0_6px_rgba(96,165,250,0.5)]"
                : task.status === "pending"
                  ? "bg-amber-500 shadow-[0_0_6px_rgba(251,191,36,0.5)]"
                  : "bg-neutral-400"
          }`}
        />
        <div className="w-px flex-1 min-h-[20px] bg-border/20" />
      </div>

      <div className="flex-1 min-w-0 pb-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <p className="text-xs font-medium text-foreground">{task.title}</p>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
          <StatusBadge status={task.status} />
          {task.priority && task.priority !== "normal" && (
            <PriorityBadge priority={task.priority} />
          )}
        </div>

        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
          {task.endDate && (
            <span className="text-[9px] text-muted-foreground/60 flex items-center gap-1">
              <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Hạn: {format(new Date(task.endDate), "dd/MM/yyyy HH:mm")}
            </span>
          )}
          <span className="text-[9px] text-muted-foreground/40 flex items-center gap-1">
            <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {format(new Date(task._creationTime), "dd/MM/yyyy HH:mm")}
          </span>
        </div>
      </div>
    </div>
  );
}

interface NoteItemProps {
  note: Doc<"notes">;
  depth: number;
  childNotes: Doc<"notes">[];
  getChildNotes: (parentId: string) => Doc<"notes">[];
  expandedNotes: Set<string>;
  toggleNoteExpand: (noteId: string) => void;
  editingNoteId: string | null;
  editingNoteTitle: string;
  editingNoteContent: string;
  setEditingNoteTitle: (v: string) => void;
  setEditingNoteContent: (v: string) => void;
  startEditNote: (note: Doc<"notes">) => void;
  cancelEditNote: () => void;
  handleDeleteNote: (noteId: string) => void;
  allNotes: Doc<"notes">[];
}

function NoteItem({
  note,
  depth,
  childNotes,
  getChildNotes,
  expandedNotes,
  toggleNoteExpand,
  editingNoteId,
  editingNoteTitle,
  editingNoteContent,
  setEditingNoteTitle,
  setEditingNoteContent,
  startEditNote,
  cancelEditNote,
  handleDeleteNote,
  allNotes,
}: NoteItemProps) {
  const isEditing = editingNoteId === note._id;
  const isExpanded = expandedNotes.has(note._id);
  const hasChildren = childNotes.length > 0;
  const contentPreview = note.content
    ? note.content.replace(/<[^>]+>/g, "").trim().slice(0, 120)
    : "";

  return (
    <div>
      <div
        className={`group flex items-start gap-1.5 p-2 rounded-lg border transition-all ${
          isEditing
            ? "border-primary/40 bg-primary/5"
            : "border-transparent hover:border-border/40 hover:bg-muted/20"
        }`}
        style={{ marginLeft: depth * 16 }}
      >
        {/* Expand toggle */}
        <button
          type="button"
          onClick={() => toggleNoteExpand(note._id)}
          className={`shrink-0 mt-0.5 p-0.5 rounded transition-colors cursor-pointer ${
            hasChildren
              ? "text-muted-foreground hover:text-foreground"
              : "text-transparent pointer-events-none"
          }`}
        >
          <ChevronRight
            className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-90" : ""}`}
          />
        </button>

        {/* Note content */}
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <div className="space-y-2">
              <input
                type="text"
                value={editingNoteTitle}
                onChange={(e) => setEditingNoteTitle(e.target.value)}
                className="w-full text-xs font-semibold bg-transparent border-none outline-none text-foreground"
                autoFocus
              />
              <div className="min-h-[120px] border border-border/50 rounded-md overflow-hidden">
                <WysiwygEditor
                  content={editingNoteContent}
                  onChange={setEditingNoteContent}
                  placeholder="Viết nội dung ghi chú..."
                />
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => { cancelEditNote(); }}
                  className="text-[10px] px-2 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                >
                  Đóng
                </button>
              </div>
            </div>
          ) : (
            <div
              className="cursor-pointer"
              onClick={() => startEditNote(note)}
            >
              <p className="text-xs font-semibold text-foreground truncate">
                {note.icon || ""} {note.title}
              </p>
              {contentPreview && (
                <p className="text-[10px] text-muted-foreground/70 truncate mt-0.5">
                  {contentPreview}
                </p>
              )}
              <p className="text-[9px] text-muted-foreground/40 mt-0.5">
                {format(new Date(note._creationTime), "dd/MM/yyyy HH:mm")}
              </p>
            </div>
          )}
        </div>

        {/* Actions */}
        {!isEditing && (
          <div className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={() => startEditNote(note)}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
              title="Chỉnh sửa"
            >
              <FileText className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={() => handleDeleteNote(note._id)}
              className="p-1 rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
              title="Xóa"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      {/* Children */}
      {isExpanded && hasChildren && (
        <div className="space-y-0.5">
          {childNotes.map((child) => {
            const grandchildren = getChildNotes(child._id);
            return (
              <NoteItem
                key={child._id}
                note={child}
                depth={depth + 1}
                childNotes={grandchildren}
                getChildNotes={getChildNotes}
                expandedNotes={expandedNotes}
                toggleNoteExpand={toggleNoteExpand}
                editingNoteId={editingNoteId}
                editingNoteTitle={editingNoteTitle}
                editingNoteContent={editingNoteContent}
                setEditingNoteTitle={setEditingNoteTitle}
                setEditingNoteContent={setEditingNoteContent}
                startEditNote={startEditNote}
                cancelEditNote={cancelEditNote}
                handleDeleteNote={handleDeleteNote}
                allNotes={allNotes}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Member Card Component ───────────────────────────
function MemberCard({
  member,
  roles,
  roleColor,
  onUpdate,
  onRemove,
}: {
  member: Doc<"projectMembers">;
  roles: Doc<"projectRoles">[];
  roleColor?: string;
  onUpdate: (id: string, data: { roleId?: string | null; roleName?: string; permissions?: RoleCapability[] | null }) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [editRoleId, setEditRoleId] = useState(member.roleId || "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [editPermissions, setEditPermissions] = useState<RoleCapability[] | null>(null);

  const memberRole = roles.find((r) => r._id === member.roleId);
  const resolvedCaps = memberRole
    ? resolveMemberCapabilities(memberRole, member.permissions)
    : CAPABILITY_CATALOG.map((c) => ({ ...c, enabled: false }));
  const hasPermissionOverride = Array.isArray(member.permissions) && member.permissions.length > 0;
  const enabledCaps = resolvedCaps.filter((c) => c.enabled);

  const handleSaveRole = async () => {
    const selectedRole = roles.find((r) => r._id === editRoleId);
    const patch: { roleId?: string | null; roleName?: string; permissions?: RoleCapability[] | null } = {
      roleId: editRoleId || null,
      roleName: selectedRole?.name || "Chưa phân công",
    };
    // Permissions cá nhân chỉ giữ khi member có ghi đè (không phụ thuộc role được chọn)
    if (editPermissions !== null || hasPermissionOverride) {
      patch.permissions = editPermissions !== null ? editPermissions : member.permissions;
    }
    await onUpdate(member._id, patch);
    setEditing(false);
  };

  const handleRemove = async () => {
    setRemoving(true);
    await onRemove(member._id);
  };

  const initials = member.name
    .split(" ")
    .map((w: string) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const avatarColor = roleColor || "#6b7280";

  return (
    <div className="flex items-start gap-2.5 p-2.5 rounded-xl border border-border/30 bg-card/50 hover:bg-muted/10 transition-colors group">
      {/* Avatar */}
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0"
        style={{
          backgroundColor: avatarColor + "20",
          color: avatarColor,
        }}
      >
        {initials}
      </div>

      {/* Info + functions */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-foreground truncate">
            {member.name}
          </span>
          {member.source === "isd" && (
            <span className="text-[8px] px-1 py-0.5 rounded-full bg-primary/10 text-primary font-medium shrink-0">
              ISD
            </span>
          )}
          {hasPermissionOverride && (
            <span
              className="text-[8px] px-1 py-0.5 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400 font-medium shrink-0"
              title="Member này có chức năng riêng ghi đè lên role"
            >
              Ghi đè
            </span>
          )}
        </div>
        {member.email && (
          <p className="text-[9px] text-muted-foreground/70 truncate">{member.email}</p>
        )}

        {/* Chức năng member thực hiện được (từ role + ghi đè member) */}
        {!editing && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {enabledCaps.length > 0 ? (
              enabledCaps.slice(0, 4).map((c) => (
                <span
                  key={c.key}
                  className="text-[8px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200/40 dark:border-emerald-500/20"
                >
                  {c.label}
                </span>
              ))
            ) : (
              <span className="text-[8px] text-muted-foreground/50">
                Chưa có chức năng nào
              </span>
            )}
            {enabledCaps.length > 4 && (
              <span className="text-[8px] text-muted-foreground/60 px-1">+{enabledCaps.length - 4} nữa</span>
            )}
          </div>
        )}

        {/* Editor permissions cá nhân */}
        {editing && editPermissions !== null && editRoleId && (
          <div className="mt-2 space-y-0.5 rounded-lg border border-border/40 bg-background/60 p-1.5 max-h-32 overflow-y-auto">
            <p className="text-[8px] font-semibold text-muted-foreground mb-1 flex items-center gap-1">
              <ShieldCheck className="w-2.5 h-2.5" />
              Chức năng riêng của member (bỏ trống = theo role)
            </p>
            {CAPABILITY_CATALOG.map((c) => {
              const item = editPermissions.find((p) => p.key === c.key);
              const enabled = item?.enabled ?? false;
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() =>
                    setEditPermissions((prev) =>
                      (prev || []).map((p) =>
                        p.key === c.key ? { ...p, enabled: !enabled } : p
                      )
                    )
                  }
                  className={`w-full flex items-center gap-1.5 px-1.5 py-0.5 text-left transition-colors cursor-pointer rounded ${
                    enabled ? "bg-primary/5" : "hover:bg-muted/40"
                  }`}
                >
                  <span
                    className={`w-2.5 h-2.5 rounded border flex items-center justify-center shrink-0 ${
                      enabled
                        ? "bg-emerald-500 border-emerald-500 text-white"
                        : "border-border bg-transparent"
                    }`}
                  >
                    {enabled && (
                      <svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4">
                        <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  <span className={`text-[8px] ${enabled ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                    {c.label}
                  </span>
                </button>
              );
            })}
            <div className="flex items-center justify-between pt-1 border-t border-border/30 mt-1">
              {hasPermissionOverride || editPermissions.some((p) => p.enabled) ? (
                <button
                  type="button"
                  onClick={() =>
                    setEditPermissions(
                      CAPABILITY_CATALOG.map((c) => ({ ...c, enabled: false }))
                    )
                  }
                  className="text-[8px] text-muted-foreground hover:text-foreground px-1 py-0.5 cursor-pointer"
                >
                  Xoá ghi đè (theo role)
                </button>
              ) : (
                <span />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Role */}
      {editing ? (
        <div className="flex items-center gap-1 shrink-0">
          <select
            value={editRoleId}
            onChange={(e) => {
              const rid = e.target.value;
              setEditRoleId(rid);
              if (rid) {
                // Prefill permissions từ role được chọn (chỉ làm base, user có thể chỉnh)
                const role = roles.find((r) => r._id === rid);
                const base = role
                  ? resolveMemberCapabilities(role, null).map((c) => ({ ...c }))
                  : CAPABILITY_CATALOG.map((c) => ({ ...c, enabled: false }));
                setEditPermissions(base);
              }
            }}
            className="h-6 px-1.5 text-[9px] rounded-lg bg-muted border border-border/50 text-foreground outline-none max-w-[110px]"
            autoFocus
          >
            <option value="">Chưa phân công</option>
            {roles.map((r) => (
              <option key={r._id} value={r._id}>
                {r.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleSaveRole}
            className="p-1 rounded-md text-emerald-500 hover:bg-emerald-500/10 transition-colors cursor-pointer"
          >
            <Save className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="p-1 rounded-md text-muted-foreground hover:bg-muted/30 transition-colors cursor-pointer"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1 shrink-0">
          <span
            className="text-[9px] font-medium px-1.5 py-0.5 rounded-full shrink-0"
            style={{
              backgroundColor: avatarColor + "15",
              color: avatarColor,
            }}
          >
            {member.roleName || "Chưa phân công"}
          </span>
          <button
            type="button"
            onClick={() => {
              setEditRoleId(member.roleId || "");
              setEditPermissions(
                Array.isArray(member.permissions) && member.permissions.length > 0
                  ? member.permissions.map((p: RoleCapability) => ({ ...p }))
                  : (memberRole
                      ? resolveMemberCapabilities(memberRole, null).map((c) => ({ ...c }))
                      : CAPABILITY_CATALOG.map((c) => ({ ...c, enabled: false })))
              );
              setEditing(true);
            }}
            className="p-1 rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-muted/30 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
            title="Sửa vai trò / chức năng"
          >
            <Edit3 className="w-3 h-3" />
          </button>
          {confirmDelete ? (
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={handleRemove}
                disabled={removing}
                className="p-1 rounded-md text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer"
                title="Xác nhận xoá"
              >
                {removing ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <AlertTriangle className="w-3 h-3" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="p-1 rounded-md text-muted-foreground hover:bg-muted/30 transition-colors cursor-pointer"
                title="Huỷ"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="p-1 rounded-md text-muted-foreground/40 hover:text-rose-500 hover:bg-rose-500/10 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
              title="Xoá member"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Summary Content View — render bản tóm tắt dự án từ summaryData ────────
function SummaryContentView({
  data,
  latest,
  expanded = false,
  handleDeleteSummary,
}: {
  data: SummaryData;
  latest: { _id?: string } | null;
  expanded?: boolean;
  handleDeleteSummary?: (id: string) => void;
}) {
  const basic = (data?.basic || {}) as Record<string, unknown>;
  const status = (data?.status || {}) as Record<string, unknown>;
  const nextActions = (data?.nextActions || []) as Array<Record<string, unknown>>;
  const unresolved = (data?.unresolvedActions || []) as Array<Record<string, unknown>>;
  const internal = (data?.members?.internal || []) as Array<Record<string, unknown>>;
  const customer = (data?.members?.customer || []) as Array<Record<string, unknown>>;
  const recent = (data?.recentActivity || []) as Array<Record<string, unknown>>;
  const compact = !expanded;

  // Ep kiểu truy cập field — dữ liệu từ JSONB (có thể thiếu field)
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const num = (v: unknown): number => (typeof v === "number" ? v : 0);
  const bool = (v: unknown): boolean => !!v;

  return (
    <div className="px-3 py-2.5 space-y-2">
      {/* Thông tin cơ bản */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
        <div className="col-span-2">
          <span className="text-muted-foreground">Dự án: </span>
          <span className="font-semibold text-foreground">{str(basic.name) || "—"}</span>
        </div>
        {str(basic.ticketId) && (
          <div><span className="text-muted-foreground">Ticket: </span><span className="font-medium">{str(basic.ticketId)}</span></div>
        )}
        {str(basic.isdStatus) && (
          <div><span className="text-muted-foreground">Trạng thái ISD: </span><span className="font-medium">{str(basic.isdStatus)}</span></div>
        )}
        {str(basic.priority) && (
          <div><span className="text-muted-foreground">Ưu tiên: </span><span className="font-medium">{str(basic.priority)}</span></div>
        )}
        {str(basic.assignee) && (
          <div><span className="text-muted-foreground">Assignee: </span><span className="font-medium">{str(basic.assignee)}</span></div>
        )}
        {str(basic.summary) && (
          <div className="col-span-2 text-muted-foreground/80 italic line-clamp-2">{str(basic.summary).slice(0, 200)}</div>
        )}
      </div>

      {/* Hiện trạng */}
      <div className="bg-muted/30 rounded-lg px-2.5 py-2 flex items-center gap-3 text-[10px]">
        <div>
          <span className="text-muted-foreground">Tiến độ: </span>
          <span className="font-semibold text-foreground">
            {num((status.taskStats as Record<string, unknown> | undefined)?.done)}/{num((status.taskStats as Record<string, unknown> | undefined)?.total)} ({num(status.donePct)}%)
          </span>
        </div>
        {num(status.overdue) > 0 && (
          <div className="text-amber-500 font-medium">⚠ {num(status.overdue)} task quá hạn</div>
        )}
        {str(status.currentStep) && (
          <div className="text-muted-foreground ml-auto">Workflow: <span className="font-medium text-foreground">{str(status.currentStep)}</span></div>
        )}
        {compact && num(status.overdueTasksCount) > 0 && (
          <div className="ml-auto text-amber-500/80">
            {(status.overdueTasks as Array<Record<string, unknown>> | undefined)?.map((t, i: number) => (
              <div key={i}>• {str(t.title)}</div>
            ))}
          </div>
        )}
      </div>

      {/* Next actions */}
      {nextActions.length > 0 && (
        <div>
          <h5 className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Next actions</h5>
          <div className="space-y-0.5">
            {nextActions.slice(0, compact ? 4 : 10).map((t, i: number) => (
              <div key={i} className="flex items-center gap-1.5 text-[10px]">
                <span className={`shrink-0 text-[8px] px-1 py-px rounded ${
                  bool(t.overdue) ? "bg-rose-500/10 text-rose-500" : "bg-muted text-muted-foreground"
                }`}>{bool(t.overdue) ? "Quá hạn" : str(t.status) || "todo"}</span>
                <span className="text-foreground/90 truncate">{str(t.title)}</span>
                {str(t.pic) && <span className="text-muted-foreground/60 shrink-0">({str(t.pic)})</span>}
                {num(t.endDate) > 0 && <span className="text-muted-foreground/50 ml-auto shrink-0">{format(new Date(num(t.endDate)), "dd/MM")}</span>}
              </div>
            ))}
            {compact && nextActions.length > 4 && <div className="text-[9px] text-muted-foreground/60">+{nextActions.length - 4} nữa...</div>}
          </div>
        </div>
      )}

      {/* Gợi ý chưa xử lý */}
      {unresolved.length > 0 && (
        <div>
          <h5 className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Gợi ý chưa xử lý</h5>
          <div className="space-y-0.5">
            {unresolved.slice(0, compact ? 3 : 8).map((u, i: number) => (
              <div key={i} className="flex items-center gap-1.5 text-[10px]">
                <AlertTriangle className="w-2.5 h-2.5 text-amber-500 shrink-0" />
                <span className="text-foreground/90 truncate">{str(u.title)}</span>
                {str(u.sourceChatName) && <span className="text-muted-foreground/50 shrink-0">({str(u.sourceChatName)})</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Members */}
      <div className="grid grid-cols-2 gap-2 text-[10px]">
        <div className="bg-blue-500/5 border border-blue-500/10 rounded-lg px-2 py-1.5">
          <div className="text-[9px] font-semibold text-blue-500 uppercase tracking-wide mb-0.5">Nội bộ ({internal.length})</div>
          {internal.length === 0 ? (
            <div className="text-muted-foreground/50">chưa có</div>
          ) : (
            internal.slice(0, compact ? 3 : 8).map((m, i: number) => (
              <div key={i} className="truncate">{str(m.name)}{str(m.role) ? <span className="text-muted-foreground/60"> ({str(m.role)})</span> : null}</div>
            ))
          )}
        </div>
        <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-lg px-2 py-1.5">
          <div className="text-[9px] font-semibold text-emerald-500 uppercase tracking-wide mb-0.5">Khách hàng ({customer.length})</div>
          {customer.length === 0 ? (
            <div className="text-muted-foreground/50">chưa có</div>
          ) : (
            customer.slice(0, compact ? 3 : 8).map((m, i: number) => (
              <div key={i} className="truncate">{str(m.name)}{str(m.role) ? <span className="text-muted-foreground/60"> ({str(m.role)})</span> : null}</div>
            ))
          )}
        </div>
      </div>

      {/* Hoạt động gần đây */}
      {recent.length > 0 && (
        <div>
          <h5 className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Hoạt động gần đây</h5>
          <div className="space-y-0.5 max-h-[70px] overflow-hidden">
            {recent.slice(0, compact ? 3 : 6).map((m, i: number) => (
              <div key={i} className="flex items-start gap-1.5 text-[10px]">
                <span className={`shrink-0 text-[8px] px-1 py-px rounded ${bool(m.isMine) ? "bg-blue-500/10 text-blue-500" : "bg-muted text-muted-foreground"}`}>
                  {bool(m.isMine) ? "Me" : (str(m.sender) || "?").slice(0, 12)}
                </span>
                <span className="text-foreground/80 truncate">{str(m.content)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {handleDeleteSummary && latest?._id && (
        <button
          type="button"
          onClick={() => handleDeleteSummary(latest._id as string)}
          className="flex items-center gap-1 text-[9px] text-muted-foreground/60 hover:text-rose-500"
        >
          <Trash2 className="w-2.5 h-2.5" /> Xoá version này
        </button>
      )}
    </div>
  );
}

export function ProjectDetailPanel({ project, tab: propTab, onTabChange: propOnTabChange }: ProjectDetailPanelProps) {
  const { userId } = useAuth();
  const [localTab, setLocalTab] = useState<"info" | "notes" | "summary" | "history" | "chats" | "suggestions" | "emails" | "members" | "summaries">("info");
  const tab = propTab ?? localTab;
  const handleTabChange = propOnTabChange ?? setLocalTab;
  const searchParams = useSearchParams();
  const [sowImportOpen, setSowImportOpen] = useState(false);

  // Nếu được điều hướng tới từ suggestion "Thêm nhóm" (query ?tab=chats&addGroup=1)
  // → tự chuyển tab Chats và mở dialog quản lý nhóm
  useEffect(() => {
    if (searchParams.get("addGroup") !== "1") return;
    handleTabChange("chats");
    setIsGroupManagerOpen(true);
  }, [searchParams]);

// ─── Chats State ───────────────────────────────────
  const [activeTeamsGroups, setActiveTeamsGroups] = useState<{name: string, type: "internal" | "customer", platform?: string, url?: string}[]>(project.teamsGroups || []);
  const [isGroupManagerOpen, setIsGroupManagerOpen] = useState(false);
  // Danh sách nhóm đang được nhập trong dialog — cho phép thêm nhiều nhóm Teams/Zalo cùng lúc
  const [pendingGroups, setPendingGroups] = useState<{id: string; name: string; type: "internal" | "customer"; platform: "teams" | "zalo"}[]>([]);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  // Vị trí (viewport) của ô tên nhóm đang mở dropdown — dùng cho dropdown position:fixed
  // để thoát khỏi container overflow-y-auto (trước đây dropdown bị clip, không hiện)
  const [dropdownAnchor, setDropdownAnchor] = useState<{ top: number; left: number; width: number } | null>(null);
  const updateDropdownAnchor = useCallback((rowId: string) => {
    const input = document.querySelector<HTMLInputElement>(`[data-dropdown-row="${rowId}"]`);
    if (!input) { setDropdownAnchor(null); return; }
    const r = input.getBoundingClientRect();
    setDropdownAnchor({ top: r.bottom + 4, left: r.left, width: r.width });
  }, []);
  const [selectedChatGroup, setSelectedChatGroup] = useState<string>("");
  const [fetchingChats, setFetchingChats] = useState(false);
  const [chatFetchError, setChatFetchError] = useState<string | null>(null);
  const [availableTeamsChats, setAvailableTeamsChats] = useState<{name: string; scrapedAt?: number}[]>([]);
  const [availableZaloChats, setAvailableZaloChats] = useState<{name: string; scrapedAt?: number}[]>([]);
  const [lastListedAt, setLastListedAt] = useState<{teams: number | null; zalo: number | null}>({teams: null, zalo: null});
  const [syncErrors, setSyncErrors] = useState<Record<string, string>>({});
  const [clearGroup, setClearGroup] = useState<string | null>(null); // group currently being cleared
  const [chatSearch, setChatSearch] = useState("");

  // ─── Chat send state (Zalo + Teams) ─────────────────
  const [sendMessage, setSendMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [lastSent, setLastSent] = useState<{ ok: boolean; chatName: string; dryRun: boolean; at: number } | null>(null);

  // ─── Sync chat groups & selection when project changes ─────
  useEffect(() => {
    const groups = (project.teamsGroups || []) as {name: string; type: "internal" | "customer"; platform?: string; url?: string}[];
    // Deduplicate by name to prevent duplicates
    const seen = new Set<string>();
    const deduped = groups.filter(g => {
      const key = g.name;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    setActiveTeamsGroups(deduped);
    setSelectedChatGroup("all");
    setPendingGroups([]);
  }, [project._id]);

  // Khi mở dialog: tự động thêm dòng nhập đầu tiên + mở dropdown gợi ý + focus ô tên
  useEffect(() => {
    if (isGroupManagerOpen && pendingGroups.length === 0) {
      const newId = crypto.randomUUID();
      setPendingGroups([{ id: newId, name: "", type: "customer", platform: "teams" }]);
      setOpenDropdownId(newId);
      setDropdownAnchor(null);
      const t = setTimeout(() => {
        const input = document.querySelector<HTMLInputElement>('[role=dialog] input');
        input?.focus();
        updateDropdownAnchor(newId);
      }, 200);
      return () => clearTimeout(t);
    }
  }, [isGroupManagerOpen, updateDropdownAnchor]);

  // ─── Members State ────────────────────────
  const cmx = useChatMutations();
  const gmx = useGroupMutations();
  const { data: projectMembers } = useMembersByProject(project._id ?? null);
  const { data: projectRolesList } = useRoles(userId);
  const mmx = useMemberMutations();

  // ─── Project Summaries State (bản tóm tắt dự án theo version) ─────
  const { data: summaries, isLoading: summariesLoading, mutate: mutateSummaries } = useProjectSummaries(project._id ?? null);
  const ssmx = useProjectSummaryMutations();
  const [summarySaving, setSummarySaving] = useState(false);
  const [selectedSummaryId, setSelectedSummaryId] = useState<string | null>(null);
  const [summaryMarkdown, setSummaryMarkdown] = useState(false);

  // ─── Project Workflow State (init → kick-off) ─────
  const { data: workflow, isLoading: workflowLoading } = useProjectWorkflow(project._id ?? null);
  const wfmx = useProjectWorkflowMutations();
  // Thông tin Sale (reporter ISD) — dùng cho tin nhắn chào + deep link Teams
  const { data: isdData } = useIsdByProject(project._id ?? null);
  const isdSaleName = isdData?.reporter || isdData?.requester || isdData?.creator || "";
  const isdSaleEmail = isdData?.reporterEmail || isdData?.requesterEmail || isdData?.creatorEmail || "";

  // ─── Members UI State ─────────────────────
  const [showAddMember, setShowAddMember] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [newMemberRoleId, setNewMemberRoleId] = useState<string | null>(null);

  // Load saved chat groups
  const { data: savedTeamsChatsData } = useScrapedGroups(userId, "teams");
  const { data: savedZaloChatsData } = useScrapedGroups(userId, "zalo");
  const savedTeamsChats = savedTeamsChatsData ?? [];
  const savedZaloChats = savedZaloChatsData ?? [];

  const [editorContent, setEditorContent] = useState(() => {
    if (!project.notes) return DEFAULT_NOTES;
    try {
      const parsed = JSON.parse(project.notes);
      if (parsed && typeof parsed === "object" && parsed.ticketId) {
        let resourceTicketsLinks = "";
        if (parsed.resourceTicketIds && parsed.resourceTicketIds.length > 0) {
          resourceTicketsLinks = `\n<h2>Tài nguyên triển khai ISD</h2>\n<ul>\n` + parsed.resourceTicketIds.map((id: string) => {
            const match = id.match(/ISD-\d+/i);
            let url, display;
            if (match) {
              const extractedId = match[0].toUpperCase();
              url = `https://servicedesk.fci.vn/browse/${extractedId}`;
              display = extractedId;
            } else {
              url = id.startsWith('http') ? id : `https://servicedesk.fci.vn/browse/${id}`;
              display = id;
            }
            return `  <li><a href="${url}">${display}</a></li>`;
          }).join('\n') + `\n</ul>`;
        }
        return `<h2>Thông tin chung</h2>
<p><strong>Mô tả:</strong> ${parsed.description || "Không có"}</p>
<p><strong>Người tạo:</strong> ${parsed.creator || parsed.reporter || ""} ${parsed.creatorEmail || parsed.reporterEmail ? "(" + (parsed.creatorEmail || parsed.reporterEmail) + ")" : ""}</p>
<p><strong>Người phụ trách:</strong> ${parsed.assignee || ""} ${parsed.assigneeEmail ? "(" + parsed.assigneeEmail + ")" : ""}</p>
<p><strong>Trạng thái:</strong> ${parsed.status || ""}</p>
<p><strong>Độ ưu tiên:</strong> ${parsed.priority || ""}</p>

<h2>Link liên quan</h2>
<ul>
  <li><a href="${parsed.ticketUrl || `https://servicedesk.fci.vn/browse/${parsed.ticketId}`}">Ticket gốc (${parsed.ticketId})</a></li>
</ul>
${resourceTicketsLinks}

<h2>Ghi chú</h2>
<p>Các ghi chú, lưu ý, thông tin bổ sung...</p>`;
      }
    } catch {
      // not json, return as is
    }
    return project.notes;
  });

  const [copied, setCopied] = useState(false);

  const pm = useProjectMutations();
  const uploadFile = useUploadFile();

  // Auto-save with debounce
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hasUserEditedRef = useRef(false);

  const doSave = useCallback(async (content: string) => {
    if (!userId) return;
    try {
      await pm.updateProjectDetail(project._id, content || undefined);
    } catch (err) {
      console.error(err);
    } finally {
      hasUserEditedRef.current = false;
    }
  }, [userId, project._id, pm]);

  // Debounced auto-save when editorContent changes
  useEffect(() => {
    if (!hasUserEditedRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      doSave(editorContent);
    }, 800);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [editorContent, doSave]);

  // Fetch tasks for history
  const { data: projectTasksData } = useTasksByProject(project._id ?? null);
  const projectTasks = projectTasksData ?? [];

  // Fetch notes for this project
  const { data: projectNotesData } = useNotesByProject(project._id ?? null);
  const projectNotes = projectNotesData ?? [];

  // Fetch chats for this project — get up to 200 newest per chat group
  const chatGroupNames = useMemo(
    () => activeTeamsGroups.map((g) => g.name),
    [activeTeamsGroups]
  );
  const { data: projectChatsData } = useMessagesByProject(project._id ?? null, chatGroupNames);
  const projectChats = projectChatsData ?? [];

  const [showSyncLogs, setShowSyncLogs] = useState(false);
  // Fetch sync logs for this project — refresh only while the logs panel
  // is actually visible (prevents constant 5s polling → page flicker).
  const { data: syncLogs } = useLogs(project._id ?? null, 50, {
    refreshInterval: showSyncLogs ? 5000 : 0,
    userId,
  });
  const [isClearing, setIsClearing] = useState(false);

  // Fetch emails for this project
  const { data: projectEmailsData } = useEmails(userId, { projectId: project._id });
  const projectEmails = projectEmailsData ?? [];

  const fetchChats = async (platform?: "teams" | "zalo") => {
    if (!userId) return;
    setFetchingChats(true);
    setChatFetchError(null);
    try {
      const platforms = platform ? [platform] : (["teams", "zalo"] as const);
      await Promise.all(platforms.map(async (p) => {
        const res = await fetch(`/api/agents/${p}-automator`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list_chats" }),
        });
        const data = await res.json().catch(() => ({}));
        // Script có thể trả HTTP 200 nhưng ok:false (vd Chrome thật CDP chưa mở
        // → connectOverCDP fail) — phải check data.ok, không chỉ res.ok, nếu
        // không UI sẽ set danh sách rỗng và nuốt lỗi im lặng.
        if (!data.ok) {
          const errMsg = data.error
            ? String(data.error).slice(0, 300)
            : `HTTP ${res.status}`;
          throw new Error(`[${p === "teams" ? "Teams" : "Zalo"}] ${errMsg}`);
        }
        const chatNames: string[] = data.chats || [];
        if (p === "teams") {
          setAvailableTeamsChats(chatNames.map((n: string) => ({ name: n, scrapedAt: Date.now() })));
        } else {
          setAvailableZaloChats(chatNames.map((n: string) => ({ name: n, scrapedAt: Date.now() })));
        }
        // Save groups
        await gmx.syncGroups({
          userId,
          platform: p,
          groups: chatNames.map((n: string) => ({ name: n })),
        }).catch(console.error);
        setLastListedAt((prev) => ({ ...prev, [p]: Date.now() }));
      }));
    } catch (e) {
      console.error(e);
      setChatFetchError(e instanceof Error ? e.message : "Lỗi tải danh sách nhóm");
    } finally {
      setFetchingChats(false);
    }
  };

  // Load saved chat groups from Convex on mount
  useEffect(() => {
    if (userId) {
      if (savedTeamsChats.length > 0) {
        setAvailableTeamsChats(
          savedTeamsChats.map((g) => ({ name: g.name, scrapedAt: g.scrapedAt }))
        );
        setLastListedAt((prev) => ({
          ...prev,
          teams: Math.max(...savedTeamsChats.map((g) => g.scrapedAt || 0)),
        }));
      }
      if (savedZaloChats.length > 0) {
        setAvailableZaloChats(
          savedZaloChats.map((g) => ({ name: g.name, scrapedAt: g.scrapedAt }))
        );
        setLastListedAt((prev) => ({
          ...prev,
          zalo: Math.max(...savedZaloChats.map((g) => g.scrapedAt || 0)),
        }));
      }
    }
  }, [userId, savedTeamsChats.length, savedZaloChats.length]);

  // Auto-select first group when none selected
  useEffect(() => {
    if (!selectedChatGroup && activeTeamsGroups.length > 0) {
      setSelectedChatGroup(activeTeamsGroups[0].name);
    }
  }, [activeTeamsGroups, selectedChatGroup]);

  const handleAddGroup = async () => {
    const valid = pendingGroups.filter((g) => g.name.trim() !== "");
    if (valid.length === 0) return;

    // Chuyển URL deep link (Teams/Zalo) dán vào ô tên → thêm platform + tên/ID nhận diện.
    // Không lưu URL làm tên nhóm (gây lỗi sync "Không tìm thấy chat").
    const normalized = valid.map((g) => {
      let name = g.name.trim();
      let platform = g.platform;
      if (/^https?:\/\//i.test(name)) {
        const derived = deriveGroupFromUrl(name);
        if (derived) {
          platform = derived.platform;
          name = derived.name;
        }
      }
      return { ...g, name, platform };
    });

    const names = new Set(activeTeamsGroups.map((g) => g.name));
    // Bỏ qua nhóm trùng tên với nhóm đã có
    const newPending = normalized.filter((g) => !names.has(g.name));
    const skipped = valid.length - newPending.length;
    if (newPending.length === 0) {
      setPendingGroups([]);
      setIsGroupManagerOpen(false);
      return;
    }
    const newGroups = [
      ...activeTeamsGroups,
      ...newPending.map((g) => ({ name: g.name, type: g.type, platform: g.platform })),
    ];
    setActiveTeamsGroups(newGroups);
    setPendingGroups([]);
    setOpenDropdownId(null);
    setDropdownAnchor(null);
    setIsGroupManagerOpen(false); // Close modal on success

    await pm.updateProject({
      id: project._id,
      teamsGroups: newGroups,
    });

    // Tự động đồng bộ chat cho từng nhóm vừa thêm (hiện animation trạng thái trên UI)
    newPending.forEach((g) => {
      syncChat(g.name, g.platform);
    });
  };

  const handleRemoveGroup = async (idx: number) => {
    const removedName = activeTeamsGroups[idx]?.name;
    if (!window.confirm(`Bạn có chắc muốn xóa nhóm "${removedName}"?`)) return;

    const newGroups = [...activeTeamsGroups];
    newGroups.splice(idx, 1);
    setActiveTeamsGroups(newGroups);
    
    // If the removed group was selected, switch to first remaining group
    if (selectedChatGroup === removedName) {
      setSelectedChatGroup(newGroups.length > 0 ? newGroups[0].name : "");
    }
    
    await pm.updateProject({
      id: project._id,
      teamsGroups: newGroups,
    });
  };

  // Thêm một dòng nhập nhóm mới vào dialog (Enter ở dòng cuối / nút "Thêm dòng")
  const addPendingRow = (platform: "teams" | "zalo") => {
    const newId = crypto.randomUUID();
    setPendingGroups((prev) => [...prev, {
      id: newId,
      name: "",
      type: "customer",
      platform,
    }]);
    setOpenDropdownId(newId);
    setDropdownAnchor(null);
    // Đợi row render xong rồi mới đo vị trí input để gắn dropdown fixed
    requestAnimationFrame(() => {
      requestAnimationFrame(() => updateDropdownAnchor(newId));
    });
  };

  // Thêm nhanh 1 nhóm đã sync (từ DB scrapedGroups) vào dự án
  const quickAddGroup = async (name: string, platform: "teams" | "zalo") => {
    if (!name.trim()) return;
    if (activeTeamsGroups.some((g) => g.name === name.trim())) return; // trùng — bỏ qua
    if (!window.confirm(`Bạn có chắc muốn thêm nhóm "${name}" vào dự án này không?`)) return;
    const newGroups = [
      ...activeTeamsGroups,
      { name: name.trim(), type: "customer" as const, platform },
    ];
    setActiveTeamsGroups(newGroups);
    await pm.updateProject({
      id: project._id,
      teamsGroups: newGroups,
    });
    syncChat(name.trim(), platform);
  };

  // ─── Sync helper: gọi sync-single-chat cho 1 nhóm + hiển thị animation trạng thái ───
  const invalidateRef = useRef<((patterns: string[]) => Promise<unknown>) | null>(null);
  invalidateRef.current = useInvalidate();
  const invalidateAfterSync = useCallback(() => {
    invalidateRef.current?.(["chats:", "suggestions:", "logs:"]);
  }, []);

  // Các nhóm đang nằm trong queue sync (đang chạy hoặc chờ) — hiện spinner
  // thật cho đến khi task xong, không phụ thuộc response của route enqueue.
  const [queuedSyncGroups, setQueuedSyncGroups] = useState<Set<string>>(new Set());
  const queuedSyncGroupsRef = useRef(queuedSyncGroups);
  const syncStateRef = useRef<{ pending: Set<string>; lastQueueWasRunning: boolean }>({
    pending: new Set(),
    lastQueueWasRunning: false,
  });

  useEffect(() => {
    if (!project?._id) return;
    let disposed = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/agents/sync-project-chats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "status" }),
        });
        const data = await res.json();
        if (disposed || !data.ok) return;

        const st = syncStateRef.current;
        const running = !!data.running;
        // 2 worker (Teams + Zalo) có thể chạy song song — gộp cả currentTasks
        // (plural, mới) và currentTask (singular, backward-compat) để hiển
        // thị spinner cho đúng từng nhóm ở CẢ 2 platform.
        type CurTask = { projectId?: string; chatName?: string; platform?: string };
        const curTaskList = (Array.isArray((data as any).currentTasks) ? (data as any).currentTasks as CurTask[] : []) as CurTask[];
        const curSingle = data.currentTask ? [data.currentTask as CurTask] : [];
        const currents = curTaskList.concat(curSingle);

        if (running) {
          st.lastQueueWasRunning = true;
          // Nhóm của project này đang chạy → hiện spinner cho đúng nhóm đó
          const busy = new Set<string>();
          for (const cur of currents) {
            if (cur?.projectId === project._id && cur.chatName) {
              busy.add(cur.chatName);
            }
          }
          if (busy.size > 0) {
            const prev = queuedSyncGroupsRef.current;
            if (prev.size !== busy.size || Array.from(busy).some(n => !prev.has(n))) {
              queuedSyncGroupsRef.current = busy;
              setQueuedSyncGroups(busy);
            }
          }
          return;
        }

        // Queue hết việc — dọn spinner còn sót (kể cả từ lần mount trước) + invalidate
        if (st.pending.size > 0 || queuedSyncGroupsRef.current.size > 0 || st.lastQueueWasRunning) {
          st.pending.clear();
          st.lastQueueWasRunning = false;
          queuedSyncGroupsRef.current = new Set();
          setQueuedSyncGroups(new Set());
          invalidateAfterSync();
        }
      } catch { /* network error — bỏ qua */ }
    };
    void tick();
    const intervalId = setInterval(tick, 2500);
    return () => {
      disposed = true;
      clearInterval(intervalId);
    };
  }, [project?._id, invalidateAfterSync]);

  // Nhóm có spinner: do chính tay bấm sync (pending) hoặc đang thực sự được queue chạy
  const syncingGroups = useMemo(() => {
    return new Set([...syncStateRef.current.pending, ...queuedSyncGroups]);
  }, [queuedSyncGroups]);

  const syncChat = useCallback(async (name: string, platform: string, mode?: "incremental" | "full") => {
    if (!project?._id || syncStateRef.current.pending.has(name)) return;
    setSyncErrors((prev) => { const n = { ...prev }; delete n[name]; return n; });
    syncStateRef.current.pending.add(name);
    setQueuedSyncGroups((prev) => new Set(prev));
    try {
      const res = await fetch("/api/agents/sync-single-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project._id,
          chatName: name,
          platform,
          syncMode: mode ?? "incremental",
          headless: localStorage.getItem("headlessMode") !== "false",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        const errMsg = data.error || `HTTP ${res.status}`;
        setSyncErrors((prev) => ({ ...prev, [name]: errMsg }));
        console.error(`Sync "${name}" failed:`, errMsg);
        syncStateRef.current.pending.delete(name);
      }
    } catch (err) {
      setSyncErrors((prev) => ({ ...prev, [name]: err instanceof Error ? err.message : "Lỗi không xác định" }));
      console.error(`Sync "${name}" failed:`, err);
      syncStateRef.current.pending.delete(name);
    }
    // KHÔNG xoá spinner ở đây — giữ cho tới khi queue báo task xong (poll ở trên)
  }, [project?._id]);

  const [autoReloadIntervalConfig, setAutoReloadIntervalConfig] = useState(120);

  useEffect(() => {
    const saved = localStorage.getItem("projectChatReloadInterval");
    if (saved !== null) {
      setAutoReloadIntervalConfig(Number(saved));
    }
    const handleConfigChange = (e: Event) => {
      setAutoReloadIntervalConfig((e as CustomEvent).detail);
    };
    window.addEventListener("projectChatReloadIntervalChanged", handleConfigChange);
    return () => window.removeEventListener("projectChatReloadIntervalChanged", handleConfigChange);
  }, []);

  const [autoReloadCountdown, setAutoReloadCountdown] = useState(120);

  const handleReloadChat = useCallback(() => {
    if (!selectedChatGroup || syncingGroups.has(selectedChatGroup)) return;
    const group = activeTeamsGroups.find((g) => g.name === selectedChatGroup);
    // 1. Refetch messages ngay lập tức từ DB (SWR invalidate)
    invalidateAfterSync();
    // 2. Enqueue sync incremental cho nhóm đang mở để lấy tin mới (nếu chưa đang sync)
    if (group) {
      syncChat(group.name, group.platform || "teams", "incremental");
    }
    setAutoReloadCountdown(autoReloadIntervalConfig > 0 ? autoReloadIntervalConfig : 120);
  }, [selectedChatGroup, activeTeamsGroups, syncingGroups, syncChat, invalidateAfterSync, autoReloadIntervalConfig]);

  // ─── Auto-reload nhóm chat mỗi 2 phút ───
  const activeTeamsGroupsRef = useRef(activeTeamsGroups);
  useEffect(() => {
    activeTeamsGroupsRef.current = activeTeamsGroups;
  }, [activeTeamsGroups]);

  useEffect(() => {
    if (!project?._id || autoReloadIntervalConfig === 0) return;
    // Không auto-reload/sync khi project đã archive hoặc xoá
    if (project.archived || project.deletedAt) return;

    setAutoReloadCountdown(autoReloadIntervalConfig);
    const intervalId = setInterval(() => {
      setAutoReloadCountdown((prev) => {
        if (prev <= 1) {
          activeTeamsGroupsRef.current.forEach((group) => {
            syncChat(group.name, group.platform || "teams", "incremental");
          });
          return autoReloadIntervalConfig;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(intervalId);
  }, [project?._id, syncChat, autoReloadIntervalConfig]);

  // ─── Auto-scroll xuống cuối (tin mới nhất) khi vào nhóm chat ───
  // Messages sort theo timestampMs tăng dần → tin mới nhất nằm cuối container.
  // Scroll lặp lại vài lần (raf + timeout) vì ảnh trong tin nhắn (data URL /
  // HTTP) load sau khi render làm scrollHeight tăng lên — chỉ scroll 1 lần sẽ
  // dừng cách đáy vài trăm px.
  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  // Nhóm đã được auto-scroll lần đầu sau khi data về (tránh scroll giật khi
  // sync thêm tin mới vào nhóm đang xem — user tự quyết định xem tin mới).
  const messagesScrolledRef = useRef<string | null>(null);

  // Chọn nhóm chat mới → đánh dấu chưa scroll + scroll xuống cuối ngay (data
  // thường đã có sẵn trong projectChats); nếu data chưa về thì effect dưới
  // sẽ scroll bổ sung khi tin nhắn tải xong.
  // Lưu ý: deps phải gồm cả `tab` — khi chuyển từ tab khác sang tab Chats,
  // container messages vừa mount (ref trước đó null) nên effect không chạy
  // được; thêm `tab` để effect chạy lại đúng lúc container đã có.
  useEffect(() => {
    if (!selectedChatGroup) return;
    messagesScrolledRef.current = null;
    const el = messagesScrollRef.current;
    if (!el) return;
    const scrollToBottom = () => {
      el.scrollTop = el.scrollHeight;
    };
    scrollToBottom();
    const raf = requestAnimationFrame(scrollToBottom);
    const t1 = setTimeout(scrollToBottom, 250);
    const t2 = setTimeout(scrollToBottom, 800);
    const t3 = setTimeout(scrollToBottom, 1500);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [selectedChatGroup, tab]);

  // Tin nhắn tải về muộn (SWR fetch) hoặc queue sync xong → nếu user chưa tự
  // scroll lên (vẫn đang ở/near đáy) thì scroll xuống cuối để hiển thị tin mới
  // nhất; đánh dấu đã scroll lần đầu cho nhóm để tránh scroll giật khi user
  // chủ động cuộn lên đọc tin cũ.
  useEffect(() => {
    if (!selectedChatGroup) return;
    const el = messagesScrollRef.current;
    if (!el) return;
    const hasMsgs = (projectChats || []).some((m) => m.chatName === selectedChatGroup);
    if (!hasMsgs) return;
    // Lần đầu có data cho nhóm này → scroll xuống cuối
    if (messagesScrolledRef.current !== selectedChatGroup) {
      messagesScrolledRef.current = selectedChatGroup;
      el.scrollTop = el.scrollHeight;
      const t = setTimeout(() => {
        el.scrollTop = el.scrollHeight;
      }, 300);
      return () => clearTimeout(t);
    }
    // Đã scroll lần đầu → chỉ auto-scroll tiếp nếu user vẫn đang ở/near đáy
    // (không giật khi user đã cuộn lên đọc tin cũ).
    const atBottom = Math.abs(el.scrollTop - (el.scrollHeight - el.clientHeight)) < 80;
    if (atBottom) {
      const t = setTimeout(() => {
        el.scrollTop = el.scrollHeight;
      }, 150);
      return () => clearTimeout(t);
    }
  }, [selectedChatGroup, projectChats, tab]);

  const nmx = useNoteMutations();

  // Notes tab state
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteContent, setEditingNoteContent] = useState("");
  const [editingNoteTitle, setEditingNoteTitle] = useState("");
  const [creatingNote, setCreatingNote] = useState(false);
  const [newNoteTitle, setNewNoteTitle] = useState("");
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  const noteDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Sort notes: root notes first, then children nested
  const noteTree = useMemo(() => {
    const roots = projectNotes
      .filter((n) => !n.parentNoteId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return roots;
  }, [projectNotes]);

  const getChildNotes = useCallback(
    (parentId: string) => {
      return projectNotes
        .filter((n) => n.parentNoteId === parentId)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    },
    [projectNotes]
  );

  const toggleNoteExpand = (noteId: string) => {
    setExpandedNotes((prev) => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  };

  const handleCreateNote = async () => {
    if (!newNoteTitle.trim() || !userId) return;
    try {
      await nmx.createNote({
        userId,
        title: newNoteTitle.trim(),
        projectId: project._id,
      });
      setNewNoteTitle("");
      setCreatingNote(false);
    } catch (err) {
      console.error(err);
    }
  };

  const startEditNote = (note: Doc<"notes">) => {
    setEditingNoteId(note._id);
    setEditingNoteTitle(note.title);
    setEditingNoteContent(note.content || "");
  };

  const cancelEditNote = () => {
    setEditingNoteId(null);
    setEditingNoteTitle("");
    setEditingNoteContent("");
  };

  const saveNote = useCallback(async () => {
    if (!editingNoteId) return;
    try {
      await nmx.updateNote(editingNoteId, {
        title: editingNoteTitle,
        content: editingNoteContent || undefined,
      });
    } catch (err) {
      console.error(err);
    }
  }, [editingNoteId, editingNoteTitle, editingNoteContent, nmx]);

  // Auto-save note content with debounce
  useEffect(() => {
    if (!editingNoteId) return;
    if (noteDebounceRef.current) clearTimeout(noteDebounceRef.current);
    noteDebounceRef.current = setTimeout(() => {
      saveNote();
    }, 800);
    return () => {
      if (noteDebounceRef.current) clearTimeout(noteDebounceRef.current);
    };
  }, [editingNoteContent, editingNoteTitle, editingNoteId, saveNote]);

  const handleDeleteNote = async (noteId: string) => {
    try {
      await nmx.deleteNote(noteId);
      if (editingNoteId === noteId) cancelEditNote();
    } catch (err) {
      console.error(err);
    }
  };

  // Sort by creation time descending (newest first) for timeline
  const timelineTasks = useMemo(() => {
    return [...projectTasks].sort((a, b) => b._creationTime - a._creationTime);
  }, [projectTasks]);

  const stats = useMemo(() => {
    const total = projectTasks.length;
    const done = projectTasks.filter((t) => t.status === "done").length;
    const processing = projectTasks.filter((t) => t.status === "processing").length;
    const pending = projectTasks.filter((t) => t.status === "pending").length;
    const todo = projectTasks.filter((t) => !t.status || t.status === "todo").length;
    return { total, done, processing, pending, todo };
  }, [projectTasks]);

  // Summary: only done tasks grouped by date
  const summaryEntries = useMemo(() => {
    const doneTasks = projectTasks.filter((t) => t.status === "done");
    const groups: Map<string, Doc<"tasks">[]> = new Map();

    for (const task of doneTasks) {
      const date = task.endDate
        ? format(new Date(task.endDate), "dd/MM")
        : format(new Date(task._creationTime), "dd/MM");
      const existing = groups.get(date) || [];
      existing.push(task);
      groups.set(date, existing);
    }

    // Sort by date (parsing dd/MM -> MM/dd for comparison)
    const sorted = Array.from(groups.entries()).sort(([a], [b]) => {
      const [da, ma] = a.split("/").map(Number);
      const [db, mb] = b.split("/").map(Number);
      // Treat undefined year as 2026
      return new Date(2026, ma! - 1, da).getTime() - new Date(2026, mb! - 1, db).getTime();
    });

    return sorted;
  }, [projectTasks]);

  // Next actions: todo + processing tasks
  const nextActions = useMemo(() => {
    const active = projectTasks.filter(
      (t) => !t.status || t.status === "todo" || t.status === "processing"
    );

    // Split into items with and without date
    const withDate = active.filter((t) => t.endDate);
    const withoutDate = active.filter((t) => !t.endDate);

    // Sort withDate by endDate ascending
    withDate.sort((a, b) => (a.endDate || 0) - (b.endDate || 0));

    // From withoutDate, pick at most 1 with highest priority, then newest
    const priorityOrder: Record<string, number> = { high: 0, normal: 1, low: 2 };
    withoutDate.sort((a, b) => {
      const pa = priorityOrder[a.priority || "normal"] ?? 1;
      const pb = priorityOrder[b.priority || "normal"] ?? 1;
      if (pa !== pb) return pa - pb;
      return (b._creationTime || 0) - (a._creationTime || 0);
    });

    return [...withDate, ...(withoutDate.length > 0 ? [withoutDate[0]] : [])];
  }, [projectTasks]);

  // Generate JIRA-friendly markdown summary for copying
  const summaryText = useMemo(() => {
    const lines: string[] = [];
    lines.push("h2. Summary");
    lines.push("");

    // Stats
    lines.push(`h3. Tổng quan tiến độ`);
    lines.push(`* Tổng số: *${stats.total}* (Hoàn thành: ${stats.done}, Đang XL: ${stats.processing}, Tạm dừng: ${stats.pending}, Chưa TH: ${stats.todo})`);
    lines.push("");

    // Completed tasks
    lines.push("h3. Công việc đã hoàn thành");
    if (summaryEntries.length === 0) {
      lines.push("Chưa có công việc nào được hoàn thành");
    } else {
      for (const [date, tasks] of summaryEntries) {
        lines.push(`*${date}* (${tasks.length} việc):`);
        for (const task of tasks) {
          lines.push(`- [Done] ${task.title}`);
        }
        lines.push("");
      }
    }

    // Next actions
    lines.push("h3. Công việc tiếp theo");
    if (nextActions.length === 0) {
      lines.push("Đợi thêm yêu cầu mới từ sales");
    } else {
      for (const task of nextActions) {
        const sl = STATUS_LABELS[task.status || "todo"]?.short || "Todo";
        const priority = task.priority && task.priority !== "normal" ? ` [${PRIORITY_CONFIG[task.priority]?.label || task.priority}]` : "";
        const deadline = task.endDate ? ` (Hạn: ${format(new Date(task.endDate), "dd/MM")})` : "";
        lines.push(`- [${sl}]${priority} ${task.title}${deadline}`);
      }
    }

    return lines.join("\n");
  }, [summaryEntries, nextActions, stats]);

  // ─── Project Summaries handlers ─────────────────────────
  const handleSaveSummary = useCallback(async () => {
    if (!userId || summarySaving) return;
    setSummarySaving(true);
    try {
      await ssmx.generateSummary({ projectId: project._id, userId, trigger: "manual" });
      await mutateSummaries();
    } catch (err) {
      console.error("[Summary] Save version error:", err);
    } finally {
      setSummarySaving(false);
    }
  }, [userId, summarySaving, project._id, ssmx, mutateSummaries]);

  const handleDeleteSummary = useCallback(async (id: string) => {
    if (!confirm("Xoá bản tóm tắt này?")) return;
    try {
      await ssmx.deleteSummary({ id });
      await mutateSummaries();
      if (selectedSummaryId === id) setSelectedSummaryId(null);
    } catch (err) {
      console.error("[Summary] Delete version error:", err);
    }
  }, [ssmx, mutateSummaries, selectedSummaryId]);

  const handleImageUpload = useCallback(async (file: File): Promise<string> => {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const dataUrl = reader.result as string;
          const name = file.name;
          const res = await fetch("/api/data/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              userId,
              dataUrl,
              name,
              mimeType: file.type || undefined,
            }),
          });
          if (!res.ok) {
            const errText = await res.text();
            console.error("Upload failed:", res.status, errText);
            throw new Error("Upload failed");
          }
          const data = await res.json();
          if (!data.url) throw new Error("Failed to get image URL");
          resolve(data.url);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsDataURL(file);
    });
  }, [userId]);

  const handleCopySummary = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(summaryText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = summaryText;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [summaryText]);

  const handleSendChat = useCallback(async (chatName: string, platform: string, message: string) => {
    if (!chatName || !message.trim()) return;
    if (sending) return;
    setSending(true);
    setSendError(null);
    setLastSent(null);
    try {
      const isZalo = platform === "zalo";
      const res = await fetch(isZalo ? "/api/agents/zalo-send" : "/api/agents/teams-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          chatName,
          message: message.trim(),
          dryRun: false,
        }),
      });
      const data = await res.json().catch(() => ({ ok: false, error: "Invalid JSON response" }));
      if (data.ok) {
        setSendMessage("");
        setLastSent({ ok: true, chatName, dryRun: !!data.dryRun, at: Date.now() });
      } else {
        setSendError(data.error || `Không gửi được tin nhắn ${isZalo ? "Zalo" : "Teams"}.`);
      }
    } catch (err) {
      console.error("Send chat failed:", err);
      setSendError("Lỗi khi gửi tin nhắn: " + (err instanceof Error ? err.message : "unknown error"));
    } finally {
      setSending(false);
    }
  }, [sending]);

  return (
    <div className={`border border-border/50 rounded-xl bg-card/50 backdrop-blur-sm shadow-inner ${tab === "chats" ? "h-full flex flex-col" : "overflow-hidden"}`}>
      {/* Tabs */}
      <div className="flex items-center gap-1 px-2 pt-2 pb-0 border-b border-border/30">
        <button
          type="button"
          onClick={() => handleTabChange("info")}
          className={`px-3 py-1.5 text-[11px] font-semibold rounded-t-lg transition-all cursor-pointer flex items-center gap-1 ${
            tab === "info"
              ? "bg-background text-foreground border border-border/60 border-b-background -mb-px shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
          }`}
        >
          <FileText className="w-3 h-3" />
          Thông tin dự án
        </button>
        <button
          type="button"
          onClick={() => handleTabChange("chats")}
          className={`px-3 py-1.5 text-[11px] font-semibold rounded-t-lg transition-all cursor-pointer flex items-center gap-1 ${
            tab === "chats"
              ? "bg-background text-foreground border border-border/60 border-b-background -mb-px shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
          }`}
        >
          <MessageSquare className="w-3 h-3" />
          Chats ({activeTeamsGroups.length || 0})
        </button>
        <button
          type="button"
          onClick={() => handleTabChange("suggestions")}
          className={`px-3 py-1.5 text-[11px] font-semibold rounded-t-lg transition-all cursor-pointer flex items-center gap-1 ${
            tab === "suggestions"
              ? "bg-background text-foreground border border-border/60 border-b-background -mb-px shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
          }`}
        >
          <Sparkles className="w-3 h-3" />
          Gợi ý
        </button>
        <button
          type="button"
          onClick={() => handleTabChange("notes")}
          className={`px-3 py-1.5 text-[11px] font-semibold rounded-t-lg transition-all cursor-pointer flex items-center gap-1 ${
            tab === "notes"
              ? "bg-background text-foreground border border-border/60 border-b-background -mb-px shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
          }`}
        >
          <StickyNote className="w-3 h-3" />
          Ghi chú ({projectNotes.length})
        </button>
        <button
          type="button"
          onClick={() => handleTabChange("emails")}
          className={`px-3 py-1.5 text-[11px] font-semibold rounded-t-lg transition-all cursor-pointer flex items-center gap-1 ${
            tab === "emails"
              ? "bg-background text-foreground border border-border/60 border-b-background -mb-px shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
          }`}
        >
          <Mail className="w-3 h-3" />
          Email ({projectEmails?.length || 0})
        </button>
        <button
          type="button"
          onClick={() => handleTabChange("members")}
          className={`px-3 py-1.5 text-[11px] font-semibold rounded-t-lg transition-all cursor-pointer flex items-center gap-1 ${
            tab === "members"
              ? "bg-background text-foreground border border-border/60 border-b-background -mb-px shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
          }`}
        >
          <Users className="w-3 h-3" />
          Members ({projectMembers?.length || 0})
        </button>
        <button
          type="button"
          onClick={() => handleTabChange("summaries")}
          className={`px-3 py-1.5 text-[11px] font-semibold rounded-t-lg transition-all cursor-pointer flex items-center gap-1 ${
            tab === "summaries"
              ? "bg-background text-foreground border border-border/60 border-b-background -mb-px shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
          }`}
        >
          <Save className="w-3 h-3" />
          Tóm tắt {summaries && summaries.length > 0 ? `(${summaries.length})` : ""}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger
            className={`px-3 py-1.5 text-[11px] font-semibold rounded-t-lg transition-all cursor-pointer flex items-center gap-1 ${
              ["summary", "history"].includes(tab)
                ? "bg-background text-foreground border border-border/60 border-b-background -mb-px shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
            }`}
          >
            <ListPlus className="w-3 h-3" />
            Khác <ChevronDown className="w-3 h-3 opacity-50" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48 text-[11px]">
            <DropdownMenuItem onClick={() => handleTabChange("summary")} className="cursor-pointer gap-2">
              <BarChart3 className="w-3 h-3" />
              Summary JIRA
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleTabChange("history")} className="cursor-pointer gap-2">
              <ListTodo className="w-3 h-3" />
              Lịch sử ({projectTasks.length})
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Tab Content */}
      <div className={`p-3 ${tab === "chats" ? "flex-1 min-h-0 flex flex-col" : ""}`}>
        {tab === "info" ? (
          <div className="space-y-1.5">
            {/* WYSIWYG Editor — compact */}
            <div className="relative min-h-[120px] max-h-[250px] overflow-y-auto border border-border/50 rounded-lg">
              <WysiwygEditor
                key={project._id}
                content={editorContent}
                onChange={(html) => {
                  hasUserEditedRef.current = true;
                  setEditorContent(html);
                }}
                onImageUpload={handleImageUpload}
              />
            </div>
          </div>
        ) : tab === "notes" ? (
          /* Notes Tab — project notes from notes table */
          <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1">
            {/* Add Note Button */}
            {creatingNote ? (
              <div className="flex items-center gap-2 p-2 border border-primary/30 rounded-lg bg-primary/5">
                <input
                  type="text"
                  placeholder="Tiêu đề ghi chú..."
                  value={newNoteTitle}
                  onChange={(e) => setNewNoteTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateNote();
                    if (e.key === "Escape") {
                      setCreatingNote(false);
                      setNewNoteTitle("");
                    }
                  }}
                  autoFocus
                  className="flex-1 text-xs bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground"
                />
                <button
                  type="button"
                  onClick={handleCreateNote}
                  disabled={!newNoteTitle.trim()}
                  className="text-[10px] px-2 py-1 rounded-md bg-primary text-primary-foreground font-medium disabled:opacity-40 cursor-pointer hover:bg-primary/90 transition-colors"
                >
                  Tạo
                </button>
                <button
                  type="button"
                  onClick={() => { setCreatingNote(false); setNewNoteTitle(""); }}
                  className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setCreatingNote(true)}
                className="w-full flex items-center justify-center gap-1.5 p-2 text-[11px] text-muted-foreground hover:text-foreground border border-dashed border-border/60 hover:border-primary/40 rounded-lg hover:bg-primary/5 transition-all cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                Thêm ghi chú mới
              </button>
            )}

            {/* Notes List */}
            {noteTree.length === 0 && !creatingNote ? (
              <div className="text-center py-8 text-[11px] text-muted-foreground italic">
                Chưa có ghi chú nào cho dự án này
              </div>
            ) : (
              <div className="space-y-1">
                {noteTree.map((note) => (
                  <NoteItem
                    key={note._id}
                    note={note}
                    depth={0}
                    childNotes={getChildNotes(note._id)}
                    getChildNotes={getChildNotes}
                    expandedNotes={expandedNotes}
                    toggleNoteExpand={toggleNoteExpand}
                    editingNoteId={editingNoteId}
                    editingNoteTitle={editingNoteTitle}
                    editingNoteContent={editingNoteContent}
                    setEditingNoteTitle={setEditingNoteTitle}
                    setEditingNoteContent={setEditingNoteContent}
                    startEditNote={startEditNote}
                    cancelEditNote={cancelEditNote}
                    handleDeleteNote={handleDeleteNote}
                    allNotes={projectNotes}
                  />
                ))}
              </div>
            )}
          </div>
        ) : tab === "summary" ? (
          /* Summary Tab — JIRA-ready copy */
          <div className="space-y-3 max-h-[250px] overflow-y-auto pr-1">
            {/* Copy header */}
            <div className="flex items-center justify-between bg-gradient-to-br from-primary/5 to-primary/[0.02] border border-primary/20 rounded-xl px-3 py-2.5">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-primary" />
                <span className="text-[11px] font-semibold text-foreground">
                  Báo cáo — {project.name}
                </span>
              </div>
              <button
                type="button"
                onClick={handleCopySummary}
                className="flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-all cursor-pointer shadow-sm"
                title="Copy JIRA summary"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                {copied ? "Đã copy!" : "Copy to JIRA"}
              </button>
            </div>

            {/* JIRA markup preview */}
            <div className="relative">
              <div className="absolute top-2 left-2 px-1.5 py-0.5 bg-muted/80 text-[9px] font-mono text-muted-foreground rounded">
                JIRA Markup
              </div>
              <div
                className="bg-[#1e1e1e] text-[12px] font-mono leading-relaxed rounded-xl p-3 pt-7 select-all whitespace-pre-wrap overflow-x-auto border border-border/30 cursor-text"
                onClick={() => {
                  const ta = document.createElement("textarea");
                  ta.value = summaryText;
                  document.body.appendChild(ta);
                  ta.select();
                  document.execCommand("copy");
                  document.body.removeChild(ta);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {summaryText.split("\n").map((line, i) => {
                  if (line.startsWith("h2.")) {
                    return (
                      <span key={i} className="block text-[14px] font-bold text-blue-400 mt-1 first:mt-0">
                        {line.replace("h2.", "").trim()}
                        {"\n"}
                      </span>
                    );
                  }
                  if (line.startsWith("h3.")) {
                    return (
                      <span key={i} className="block text-[13px] font-semibold text-amber-400 mt-2">
                        {line.replace("h3.", "").trim()}
                        {"\n"}
                      </span>
                    );
                  }
                  if (line.startsWith("*") && line.endsWith("*)")) {
                    const match = line.match(/^\* (.+)/);
                    return (
                      <span key={i} className="block text-gray-300">
                        <span className="text-gray-500"># </span>{match?.[1] || line}
                        {"\n"}
                      </span>
                    );
                  }
                  if (line.startsWith("*") && line.includes("* (")) {
                    return (
                      <span key={i} className="block text-emerald-400">
                        <span className="text-gray-500">## </span>{line}
                        {"\n"}
                      </span>
                    );
                  }
                  if (line.startsWith("- [") || line.startsWith("- *")) {
                    return (
                      <span key={i} className="block text-gray-300 ml-2">
                        <span className="text-gray-600">-</span> {line.replace(/^- /, "")}
                        {"\n"}
                      </span>
                    );
                  }
                  if (line.trim() === "") {
                    return <span key={i}>{"\n"}</span>;
                  }
                  return (
                    <span key={i} className="block text-gray-400 italic">
                      {line}
                      {"\n"}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* Hint */}
            <p className="text-[9px] text-muted-foreground/50 text-center">
              Click vào preview để copy nhanh, hoặc dùng nút Copy to JIRA
            </p>
          </div>
        ) : tab === "summaries" ? (
          /* Tóm tắt dự án — bản tóm tắt theo version (auto từ AI + manual) */
          <div className="space-y-3 max-h-[250px] overflow-y-auto pr-1">
            {/* Header + nút Lưu version */}
            <div className="flex items-center gap-2 bg-gradient-to-br from-primary/5 to-primary/[0.02] border border-primary/20 rounded-xl px-3 py-2.5">
              <Save className="w-3.5 h-3.5 text-primary" />
              <div className="flex-1 min-w-0">
                <h3 className="text-xs font-semibold text-foreground">Tóm tắt dự án</h3>
                <p className="text-[9px] text-muted-foreground">
                  {summaries?.length
                    ? `${summaries.length} version — cập nhật tự động khi có biến động đáng chú ý`
                    : "Chưa có bản tóm tắt nào — AI sẽ tạo khi có tin mới quan trọng"}
                </p>
              </div>
              <button
                type="button"
                onClick={handleSaveSummary}
                disabled={summarySaving || !userId}
                className="flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                {summarySaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                Lưu version
              </button>
            </div>

            {summariesLoading && !summaries ? (
              <div className="flex items-center justify-center py-6 text-muted-foreground text-[11px] gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Đang tải...
              </div>
            ) : !summaries || summaries.length === 0 ? (
              <div className="text-center py-8 px-4 border border-dashed border-border/40 rounded-xl">
                <BrainCircuit className="w-6 h-6 mx-auto mb-2 text-muted-foreground/40" />
                <p className="text-[11px] text-muted-foreground">
                  Bấm <span className="font-semibold text-foreground">Lưu version</span> để tạo bản tóm tắt đầu tiên
                </p>
                <p className="text-[9px] text-muted-foreground/60 mt-1">
                  Hoặc đợi AI tự tạo sau khi sync chat có tin mới quan trọng
                </p>
              </div>
            ) : (
              <>
                {/* Bản mới nhất */}
                {(() => {
                  const latest = summaries[0];
                  const data = latest?.summaryData || {};
                  return (
                    <div className="border border-border/40 rounded-xl overflow-hidden bg-card/60">
                      <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b border-border/30">
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary">v{latest.version}</span>
                        <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${
                          latest.trigger === "manual" ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        }`}>
                          {latest.trigger === "manual" ? "Tay" : "Tự động"}
                        </span>
                        <span className="text-[9px] text-muted-foreground">
                          {latest.createdAt ? format(new Date(latest.createdAt), "dd/MM HH:mm") : ""}
                        </span>
                        <div className="flex-1" />
                        <button
                          type="button"
                          onClick={() => setSummaryMarkdown(!summaryMarkdown)}
                          className="text-[9px] font-medium text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                        >
                          {summaryMarkdown ? "Xem tiêu đề" : "Xem markdown"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedSummaryId(selectedSummaryId === latest._id ? null : latest._id)}
                          className="text-[9px] font-medium text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                        >
                          {selectedSummaryId === latest._id ? "Thu gọn" : "Chi tiết"}
                        </button>
                      </div>
                      {summaryMarkdown ? (
                        <pre className="whitespace-pre-wrap text-[10px] leading-relaxed text-foreground/80 px-3 py-2.5 max-h-[180px] overflow-y-auto font-mono">
                          {latest.summaryText || "—"}
                        </pre>
                      ) : (
                        <SummaryContentView data={data} latest={latest} expanded={selectedSummaryId === latest._id} handleDeleteSummary={handleDeleteSummary} />
                      )}
                    </div>
                  );
                })()}

                {/* Lịch sử version */}
                {summaries.length > 1 && (
                  <div className="border border-border/30 rounded-xl overflow-hidden">
                    <div className="px-3 py-1.5 bg-muted/30 border-b border-border/20 flex items-center gap-1.5">
                      <History className="w-3 h-3 text-muted-foreground" />
                      <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Lịch sử version</h4>
                    </div>
                    <div className="divide-y divide-border/20">
                      {summaries.slice(1).map((v) => (
                        <details key={v._id} className="group">
                          <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/30 text-left">
                            <ChevronRight className="w-3 h-3 text-muted-foreground group-open:rotate-90 transition-transform" />
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">v{v.version}</span>
                            <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                              v.trigger === "manual" ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            }`}>{v.trigger === "manual" ? "Tay" : "Tự động"}</span>
                            <span className="text-[9px] text-muted-foreground ml-auto">
                              {v.createdAt ? format(new Date(v.createdAt), "dd/MM HH:mm") : ""}
                            </span>
                          </summary>
                          <div className="px-3 pb-3">
                            <SummaryContentView data={v.summaryData || {}} latest={v} expanded={selectedSummaryId === v._id} handleDeleteSummary={handleDeleteSummary} />
                          </div>
                        </details>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        ) : tab === "history" ? (
          /* History Tab — timeline view */
          <div className="space-y-3 max-h-[250px] overflow-y-auto pr-1">
            {/* Stats card */}
            <div className="bg-gradient-to-br from-card to-muted/30 border border-border/50 rounded-xl p-3 shadow-sm">
              <div className="flex items-center justify-between mb-2.5">
                <h3 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <ListTodo className="w-3.5 h-3.5 text-primary" />
                  Lịch sử công việc
                </h3>
              </div>
              <div className="grid grid-cols-5 gap-2">
                <div className="flex flex-col items-center p-2 rounded-lg bg-background/60 border border-border/30">
                  <span className="text-sm font-bold text-foreground">{stats.total}</span>
                  <span className="text-[9px] text-muted-foreground mt-0.5">Tổng</span>
                </div>
                <div className="flex flex-col items-center p-2 rounded-lg bg-neutral-500/5 border border-neutral-500/15">
                  <span className="text-sm font-bold text-neutral-500">{stats.todo}</span>
                  <span className="text-[9px] text-neutral-500/70 mt-0.5">Chưa TH</span>
                </div>
                <div className="flex flex-col items-center p-2 rounded-lg bg-blue-500/5 border border-blue-500/15">
                  <span className="text-sm font-bold text-blue-500">{stats.processing}</span>
                  <span className="text-[9px] text-blue-500/70 mt-0.5">Đang XL</span>
                </div>
                <div className="flex flex-col items-center p-2 rounded-lg bg-amber-500/5 border border-amber-500/15">
                  <span className="text-sm font-bold text-amber-500">{stats.pending}</span>
                  <span className="text-[9px] text-amber-500/70 mt-0.5">Tạm dừng</span>
                </div>
                <div className="flex flex-col items-center p-2 rounded-lg bg-emerald-500/5 border border-emerald-500/15">
                  <span className="text-sm font-bold text-emerald-500">{stats.done}</span>
                  <span className="text-[9px] text-emerald-500/70 mt-0.5">Done</span>
                </div>
              </div>
            </div>

            {/* Timeline task list */}
            <div className="space-y-1">
              {timelineTasks.length === 0 ? (
                <div className="text-center py-10 text-[11px] text-muted-foreground italic bg-muted/20 rounded-xl border border-dashed border-border/40">
                  Chưa có công việc nào trong dự án này
                </div>
              ) : (
                timelineTasks.map((task, idx) => {
                  // Group by date
                  const taskDate = format(new Date(task._creationTime), "dd/MM/yyyy");
                  const prevDate =
                    idx > 0
                      ? format(new Date(timelineTasks[idx - 1]._creationTime), "dd/MM/yyyy")
                      : null;
                  const showDateHeader = !prevDate || prevDate !== taskDate;

                  return (
                    <div key={task._id}>
                      {showDateHeader && (
                        <div className="flex items-center gap-2 pt-2 pb-1.5">
                          <div className="h-px flex-1 bg-border/20" />
                          <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">
                            {taskDate}
                          </span>
                          <div className="h-px flex-1 bg-border/20" />
                        </div>
                      )}
                      <TaskTimelineEntry task={task} />
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ) : tab === "chats" ? (
          <div className="flex gap-2 h-full min-h-0">
            {/* ── LEFT COLUMN: Chat List & Management ── */}
            <div className="w-56 shrink-0 flex flex-col gap-1.5 overflow-y-auto custom-scrollbar pr-1">
              {/* Header */}
              <div className="flex items-center justify-between shrink-0">
                <span className="text-[12px] font-semibold text-foreground/90 flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5" />
                  Danh sách nhóm
                </span>
                <Dialog open={isGroupManagerOpen} onOpenChange={setIsGroupManagerOpen}>
                  <DialogTrigger
                    className="p-1 hover:bg-muted rounded text-muted-foreground transition-colors"
                    title="Thêm nhóm"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-xl bg-card border-border">
                    <DialogHeader>
                      <DialogTitle className="text-lg font-bold flex items-center gap-2">
                        <MessageSquare className="w-5 h-5 text-primary" />
                        Thêm nhóm Chat mới
                      </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <p className="text-sm text-muted-foreground">
                        Thêm nhiều nhóm cùng lúc — mỗi dòng chọn nền tảng (Teams/Zalo) và loại nhóm (Khách hàng/Nội bộ).
                      </p>

                      <div
                        className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar pr-1"
                        onScroll={() => openDropdownId && updateDropdownAnchor(openDropdownId)}
                      >
                        {pendingGroups.map((row) => {
                          const chatList = row.platform === "zalo" ? availableZaloChats : availableTeamsChats;
                          const matches = chatList.filter((c) =>
                            c.name.toLowerCase().includes(row.name.toLowerCase())
                          );
                          return (
                            <div key={row.id} className="flex gap-2 items-start">
                              <div className="w-28 shrink-0 space-y-1">
                                <label className="text-xs font-medium text-foreground/70">Nền tảng</label>
                                <select
                                  value={row.platform}
                                  onChange={(e) => {
                                    setPendingGroups((prev) =>
                                      prev.map((r) =>
                                        r.id === row.id ? { ...r, platform: e.target.value as "teams" | "zalo" } : r
                                      )
                                    );
                                    setOpenDropdownId(row.id);
                                    updateDropdownAnchor(row.id);
                                  }}
                                  className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:border-primary/50"
                                >
                                  <option value="teams">Teams</option>
                                  <option value="zalo">Zalo</option>
                                </select>
                              </div>
                              <div className="w-24 shrink-0 space-y-1">
                                <label className="text-xs font-medium text-foreground/70">Loại nhóm</label>
                                <select
                                  value={row.type}
                                  onChange={(e) => {
                                    setPendingGroups((prev) =>
                                      prev.map((r) =>
                                        r.id === row.id ? { ...r, type: e.target.value as "internal" | "customer" } : r
                                      )
                                    );
                                  }}
                                  className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:border-primary/50"
                                >
                                  <option value="customer">Khách hàng</option>
                                  <option value="internal">Nội bộ</option>
                                </select>
                              </div>
                              <div className="flex-1 space-y-1">
                                <label className="text-xs font-medium text-foreground/70">Tên nhóm chat</label>
                                <input
                                  type="text"
                                  data-dropdown-row={row.id}
                                  value={row.name}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setPendingGroups((prev) =>
                                      prev.map((r) =>
                                        r.id === row.id ? { ...r, name: v } : r
                                      )
                                    );
                                    setOpenDropdownId(row.id);
                                    updateDropdownAnchor(row.id);
                                  }}
                                  placeholder={`Tên nhóm ${row.platform === "zalo" ? "Zalo" : "Teams"}...`}
                                  className="w-full px-2.5 py-1.5 rounded-md bg-background border border-border text-sm outline-none focus:border-primary/50"
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
                                      addPendingRow(row.platform);
                                    }
                                  }}
                                />
                                {/^https?:\/\//i.test(row.name.trim()) && (() => {
                                  const derived = deriveGroupFromUrl(row.name.trim());
                                  return (
                                    <div className="text-[10px] leading-snug px-0.5">
                                      {derived ? (
                                        <span className="text-emerald-600 dark:text-emerald-400">
                                          Tự nhận diện: nhóm {derived.platform === "zalo" ? "Zalo" : "Teams"} ({derived.name})
                                        </span>
                                      ) : (
                                        <span className="text-amber-600 dark:text-amber-400">
                                          Link này không nhận diện được — vui lòng gõ tên nhóm chính xác (không dùng link)
                                        </span>
                                      )}
                                    </div>
                                  );
                                })()}
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setPendingGroups((prev) => prev.filter((r) => r.id !== row.id));
                                  setOpenDropdownId((cur) => (cur === row.id ? null : cur));
                                  setDropdownAnchor(null);
                                }}
                                className="mt-5 p-1 text-muted-foreground/40 hover:text-rose-500 transition-colors shrink-0"
                                title="Xoá dòng này"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          );
                        })}
                      </div>

                      {openDropdownId && dropdownAnchor && (() => {
                        const activeRow = pendingGroups.find((r) => r.id === openDropdownId);
                        if (!activeRow) return null;
                        const chatList = activeRow.platform === "zalo" ? availableZaloChats : availableTeamsChats;
                        const matches = chatList.filter((c) =>
                          c.name.toLowerCase().includes(activeRow.name.toLowerCase())
                        );
                        // Portal ra document.body để thoát khỏi containing block của Radix Dialog
                        // (position:fixed bên trong dialog bị tính sai vị trí khi dialog có transform/zoom)
                        return createPortal(
                          <div
                            className="fixed bg-background border border-border rounded-md shadow-lg max-h-40 overflow-y-auto z-[100] custom-scrollbar"
                            style={{ top: dropdownAnchor.top, left: dropdownAnchor.left, width: dropdownAnchor.width }}
                            onMouseDown={(e) => e.preventDefault() /* keep input focus while clicking list */}
                            onScroll={() => updateDropdownAnchor(openDropdownId)}
                          >
                            <div className="sticky top-0 bg-background/95 backdrop-blur px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border/40">
                              Nhóm {activeRow.platform === "zalo" ? "Zalo" : "Teams"} ({chatList.length})
                            </div>
                            {matches.length > 0 ? (
                              matches.map((chat, i: number) => (
                                <div
                                  key={i}
                                  onClick={() => {
                                    setPendingGroups((prev) =>
                                      prev.map((r) =>
                                        r.id === activeRow.id ? { ...r, name: chat.name } : r
                                      )
                                    );
                                    setOpenDropdownId(null);
                                    setDropdownAnchor(null);
                                  }}
                                  className="px-3 py-1.5 text-sm hover:bg-muted cursor-pointer flex items-center justify-between gap-2"
                                >
                                  <span className="truncate">{chat.name}</span>
                                  {chat.scrapedAt && (
                                    <span className="text-[9px] text-muted-foreground/50 shrink-0">
                                      {new Date(chat.scrapedAt).toLocaleDateString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                                    </span>
                                  )}
                                </div>
                              ))
                            ) : chatList.length === 0 ? (
                              <div className="px-3 py-3 text-xs text-muted-foreground space-y-2">
                                <div>Chưa có danh sách nhóm {activeRow.platform === "zalo" ? "Zalo" : "Teams"}.</div>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); fetchChats(activeRow.platform); }}
                                  disabled={fetchingChats}
                                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                                >
                                  {fetchingChats ? <Loader2 className="w-3 h-3 animate-spin" /> : "🔄"}
                                  Tải danh sách nhóm
                                </button>
                              </div>
                            ) : (
                              <div className="px-3 py-3 text-xs text-muted-foreground space-y-1">
                                <div>
                                  Không tìm thấy nhóm {activeRow.platform === "zalo" ? "Zalo" : "Teams"} nào khớp &quot;{activeRow.name}&quot;.
                                </div>
                                <div className="text-[10px] text-muted-foreground/70">
                                  Đổi Nền tảng sang {activeRow.platform === "zalo" ? "Teams" : "Zalo"} nếu nhóm bạn cần thuộc kênh kia, hoặc gõ tên chính xác để thêm trực tiếp.
                                </div>
                              </div>
                            )}
                          </div>,
                          document.body
                        );
                      })()}

                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => addPendingRow("teams")}
                          className="px-3 py-1.5 text-xs font-medium rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors inline-flex items-center gap-1"
                        >
                          <Plus className="w-3 h-3" /> Thêm dòng
                        </button>
                        <button
                          type="button"
                          onClick={() => fetchChats()}
                          disabled={fetchingChats}
                          className="px-3 py-1.5 text-xs font-medium rounded-md bg-purple-500/10 text-purple-700 dark:text-purple-300 hover:bg-purple-500/20 transition-colors inline-flex items-center gap-1 disabled:opacity-50"
                        >
                          {fetchingChats ? <Loader2 className="w-3 h-3 animate-spin" /> : "🔄"}
                          Tải danh sách nhóm (Teams + Zalo)
                        </button>
                      </div>

                      <div className="flex justify-end gap-2 pt-2 border-t border-border/40">
                        <button
                          type="button"
                          onClick={() => {
                            setPendingGroups([]);
                            setOpenDropdownId(null);
                            setDropdownAnchor(null);
                            setIsGroupManagerOpen(false);
                          }}
                          className="px-4 py-2 text-sm font-medium rounded-md hover:bg-muted transition-colors"
                        >
                          Hủy
                        </button>
                        <button
                          type="button"
                          onClick={handleAddGroup}
                          disabled={pendingGroups.every((g) => g.name.trim() === "")}
                          className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
                        >
                          Thêm {pendingGroups.filter((g) => g.name.trim() !== "").length} nhóm
                        </button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
              
              {/* Group List */}
              <div className="space-y-0.5">
                {activeTeamsGroups.map((group, idx) => (
                  <div key={idx} className="group flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => setSelectedChatGroup(group.name)}
                      className={`flex-1 text-left px-2 py-1.5 text-[11px] font-medium rounded-md transition-all flex items-center gap-1.5 min-w-0 border-l-2 ${
                        selectedChatGroup === group.name
                          ? "bg-primary/10 text-primary border-primary shadow-sm"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border-transparent"
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        group.type === "customer" ? "bg-orange-500" : "bg-blue-500"
                      }`} />
                      <span className="truncate flex-1 min-w-0">{group.name}</span>
                      {syncingGroups.has(group.name) && (
                        <Loader2 className="w-2.5 h-2.5 animate-spin text-primary shrink-0" />
                      )}
                      {syncErrors[group.name] && (
                        <span
                          className="text-[7px] px-1 py-0.5 rounded font-medium shrink-0 bg-red-500/10 text-red-600 dark:text-red-400"
                          title={syncErrors[group.name]}
                        >
                          Lỗi
                        </span>
                      )}
                      <span className={`text-[7px] px-1 py-0.5 rounded font-bold shrink-0 ${
                        (group.platform || "teams") === "zalo"
                          ? "bg-blue-600/10 text-blue-700 dark:text-blue-300"
                          : "bg-violet-500/10 text-violet-600 dark:text-violet-400"
                      }`}>
                        {(group.platform || "teams") === "zalo" ? "Zalo" : "Teams"}
                      </span>
                      <span className={`text-[8px] px-1 py-0.5 rounded font-medium shrink-0 ${
                        group.type === "customer" 
                          ? "bg-orange-500/10 text-orange-600 dark:text-orange-400" 
                          : "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                      }`}>
                        {group.type === "customer" ? "KH" : "NB"}
                      </span>
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger className="p-1 text-muted-foreground/30 hover:text-primary opacity-0 group-hover:opacity-100 transition-all shrink-0">
                        <MoreHorizontal className="w-3.5 h-3.5" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48 text-[11px]">
                        {group.url && (
                          <DropdownMenuItem onClick={() => window.open(group.url, '_blank')} className="cursor-pointer gap-2">
                            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                            Mở trong browser
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => syncChat(group.name, group.platform || "teams")} disabled={syncingGroups.has(group.name)} className="cursor-pointer gap-2">
                          {syncingGroups.has(group.name) ? <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" /> : <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />}
                          Đồng bộ mới nhất
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => syncChat(group.name, group.platform || "teams", "full")} disabled={syncingGroups.has(group.name)} className="cursor-pointer gap-2">
                          <RefreshCcw className="w-3.5 h-3.5 text-muted-foreground" />
                          Đồng bộ toàn bộ
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleRemoveGroup(idx)} className="cursor-pointer gap-2 text-red-500 focus:text-red-600 focus:bg-red-50 dark:focus:bg-red-950/50">
                          <X className="w-3.5 h-3.5" />
                          Xóa khỏi dự án
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
                {activeTeamsGroups.length === 0 && (
                  <div className="text-[11px] text-muted-foreground italic px-1 py-2">
                    Chưa có nhóm nào
                  </div>
                )}
              </div>

              {/* Nhóm đã sync từ Teams/Zalo (lưu trong DB scrapedGroups) — chọn nhanh để thêm vào dự án */}
              {(savedTeamsChats.length > 0 || savedZaloChats.length > 0) && (
                <div className="pt-2 border-t border-border/30">
                  <div className="flex items-center justify-between px-1 mb-1 mt-2">
                    <span className="text-[11px] font-semibold text-foreground/80 flex items-center gap-1.5">
                      <Download className="w-3 h-3 text-muted-foreground" />
                      Nhóm đã sync ({savedTeamsChats.length + savedZaloChats.length})
                    </span>
                  </div>
                  <div className="space-y-0.5 max-h-40 overflow-y-auto custom-scrollbar pr-1">
                    {savedTeamsChats.map((g) => {
                      const isAdded = activeTeamsGroups.some((ag) => ag.name === g.name);
                      return (
                        <div key={`t-${g._id ?? g.name}`} className="group flex items-center gap-1 pr-1.5">
                          <button
                            type="button"
                            disabled={isAdded}
                            onClick={() => quickAddGroup(g.name, "teams")}
                            className={`flex-1 text-left px-2 py-1.5 text-[11px] rounded-md transition-all flex items-center gap-1.5 min-w-0 ${
                              isAdded
                                ? "text-muted-foreground/40 cursor-default"
                                : "text-muted-foreground hover:text-foreground hover:bg-muted/50 cursor-pointer"
                            }`}
                            title={isAdded ? "Đã có trong dự án" : `Thêm "${g.name}" vào dự án`}
                          >
                            <span className="w-1 h-1 rounded-full shrink-0 bg-muted-foreground/30" />
                            <span className="truncate flex-1 min-w-0">{g.name}</span>
                            <span className="text-[7px] px-1 py-0.5 rounded font-bold shrink-0 bg-violet-500/10 text-violet-600 dark:text-violet-400">Teams</span>
                          </button>
                          <button
                            type="button"
                            disabled={isAdded}
                            onClick={() => quickAddGroup(g.name, "teams")}
                            className={`shrink-0 p-1 rounded-md transition-all ${
                              isAdded
                                ? "text-emerald-500/60 cursor-default"
                                : "text-muted-foreground/40 opacity-0 group-hover:opacity-100 hover:text-primary hover:bg-muted/50 cursor-pointer"
                            }`}
                            title={isAdded ? "Đã thêm" : "Thêm vào dự án"}
                          >
                            {isAdded ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                          </button>
                        </div>
                      );
                    })}
                    {savedZaloChats.map((g) => {
                      const isAdded = activeTeamsGroups.some((ag) => ag.name === g.name);
                      return (
                        <div key={`z-${g._id ?? g.name}`} className="group flex items-center gap-1 pr-1.5">
                          <button
                            type="button"
                            disabled={isAdded}
                            onClick={() => quickAddGroup(g.name, "zalo")}
                            className={`flex-1 text-left px-2 py-1.5 text-[11px] rounded-md transition-all flex items-center gap-1.5 min-w-0 ${
                              isAdded
                                ? "text-muted-foreground/40 cursor-default"
                                : "text-muted-foreground hover:text-foreground hover:bg-muted/50 cursor-pointer"
                            }`}
                            title={isAdded ? "Đã có trong dự án" : `Thêm "${g.name}" vào dự án`}
                          >
                            <span className="w-1 h-1 rounded-full shrink-0 bg-muted-foreground/30" />
                            <span className="truncate flex-1 min-w-0">{g.name}</span>
                            <span className="text-[7px] px-1 py-0.5 rounded font-bold shrink-0 bg-blue-600/10 text-blue-700 dark:text-blue-300">Zalo</span>
                          </button>
                          <button
                            type="button"
                            disabled={isAdded}
                            onClick={() => quickAddGroup(g.name, "zalo")}
                            className={`shrink-0 p-1 rounded-md transition-all ${
                              isAdded
                                ? "text-emerald-500/60 cursor-default"
                                : "text-muted-foreground/40 opacity-0 group-hover:opacity-100 hover:text-primary hover:bg-muted/50 cursor-pointer"
                            }`}
                            title={isAdded ? "Đã thêm" : "Thêm vào dự án"}
                          >
                            {isAdded ? <Check className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <div className="text-[8px] text-muted-foreground/40 px-1 pt-1">
                    Nhóm đã lưu trong DB sau khi tải danh sách. Click + để thêm vào dự án.
                  </div>
                </div>
              )}
              
              {/* Sync buttons — each group has its own sync on hover */}
              <div className="flex items-center gap-1.5 pt-2 border-t border-border/30 px-1">
                <button
                  type="button"
                  onClick={() => fetchChats()}
                  disabled={fetchingChats}
                  className={`w-full h-7 px-2.5 text-xs font-medium rounded-md transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    fetchingChats
                      ? "bg-muted text-muted-foreground border-border/50 disabled:cursor-not-allowed disabled:opacity-50"
                      : "bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 hover:shadow-sm"
                  }`}
                >
                  {fetchingChats ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  <span>Tải nhóm</span>
                </button>
              </div>
              {chatFetchError && (
                <div className="mt-1 px-1">
                  <div className="text-[9px] text-red-600 dark:text-red-400 bg-red-500/5 border border-red-500/20 rounded-md px-2 py-1.5 leading-snug">
                    {chatFetchError}
                    <div className="mt-0.5 text-red-500/80">
                      Mẹo: mở Chrome thật CDP (port 9222) trước khi tải — xem PROJECT_STATUS.md mục CDP mode.
                    </div>
                  </div>
                </div>
              )}
              {(lastListedAt.teams || lastListedAt.zalo) && (
                <div className="text-[8px] text-muted-foreground/50 px-1 flex items-center gap-2">
                  {lastListedAt.teams && (
                    <span>Teams: {new Date(lastListedAt.teams).toLocaleDateString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}</span>
                  )}
                  {lastListedAt.zalo && (
                    <span>Zalo: {new Date(lastListedAt.zalo).toLocaleDateString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}</span>
                  )}
                </div>
              )}

              {/* Sync Logs Toggle */}
              <div className="pt-1 border-t border-border/30">
                <button
                  type="button"
                  onClick={() => setShowSyncLogs(!showSyncLogs)}
                  className={`w-full text-left px-2.5 py-1.5 text-[10px] font-medium rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                    showSyncLogs
                      ? "bg-muted/50 text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                  }`}
                >
                  <FileText className="w-3 h-3" />
                  <span>Nhật ký đồng bộ</span>
                  <span className="ml-auto text-[9px] text-muted-foreground/60">{syncLogs?.length || 0}</span>
                </button>
                {showSyncLogs && (
                  <div className="mt-1 space-y-0.5 max-h-32 overflow-y-auto custom-scrollbar">
                    {syncLogs && syncLogs.length > 0 ? (
                      syncLogs.map((log) => {
                        const logIcon = log.type === "sync_start" ? "▶️"
                          : log.type === "sync_end" ? "✅"
                          : log.type === "sync_error" ? "❌"
                          : "📌";
                        const logColor = log.type === "sync_error" ? "text-red-600 dark:text-red-400"
                          : log.type === "sync_end" ? "text-emerald-600 dark:text-emerald-400"
                          : "text-muted-foreground";
                        return (
                          <div key={log._id} className={`flex items-start gap-1 px-1.5 py-1 text-[9px] ${logColor} leading-tight`}>
                            <span className="shrink-0">{logIcon}</span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate">{log.message}</p>
                              <p className="text-[8px] text-muted-foreground/50">
                                {new Date(log.createdAt).toLocaleString("vi-VN", {
                                  hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit",
                                })}
                              </p>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="px-1.5 py-1 text-[9px] text-muted-foreground italic">
                        Chưa có nhật ký đồng bộ
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            
            {/* Divider */}
            <div className="w-px bg-border/40 shrink-0" />
            
            {/* ── RIGHT COLUMN: Chat Messages ── */}
            <div className="flex-1 min-w-0 flex flex-col gap-2 pr-1">
              {/* Chat header */}
              <div className="shrink-0 flex items-center gap-2 pb-2 border-b border-border/30">
                <MessageSquare className="w-3.5 h-3.5 text-primary" />
                <span className="text-[12px] font-semibold text-foreground/90">
                  {selectedChatGroup || "Chọn nhóm chat"}
                </span>
                <span className="text-[10px] text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded-full">
                  {projectChats?.filter((m) => m.chatName === selectedChatGroup)?.length || 0
                  } tin nhắn
                </span>

                {selectedChatGroup && syncErrors[selectedChatGroup] && !syncingGroups.has(selectedChatGroup) && (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-medium text-red-600 dark:text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded-full"
                    title={syncErrors[selectedChatGroup]}
                  >
                    <AlertTriangle className="w-2.5 h-2.5" />
                    Lỗi đồng bộ
                  </span>
                )}
                <div className="ml-auto flex items-center gap-1.5">
                  <div className="relative w-48 shrink-0 mr-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
                    <input
                      type="text"
                      value={chatSearch}
                      onChange={(e) => setChatSearch(e.target.value)}
                      placeholder="Tìm kiếm..."
                      className="w-full pl-8 pr-7 py-1 h-7 text-xs rounded-md bg-muted/40 border border-border/40 focus:bg-background focus:border-primary/40 focus:ring-1 focus:ring-primary/20 transition-all outline-none placeholder:text-muted-foreground/50"
                    />
                    {chatSearch && (
                      <button
                        type="button"
                        onClick={() => setChatSearch("")}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground/60 hover:text-foreground hover:bg-muted/50 rounded transition-colors"
                        title="Xoá tìm kiếm"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleReloadChat}
                    disabled={syncingGroups.has(selectedChatGroup)}
                    className="h-7 px-2.5 text-xs font-medium rounded-md transition-all flex items-center gap-1.5 cursor-pointer bg-primary/10 text-primary hover:bg-primary/20 hover:shadow-sm border border-primary/20 disabled:opacity-50 disabled:cursor-not-allowed"
                    title={syncingGroups.has(selectedChatGroup)
                      ? `Đang tải lại tin nhắn của "${selectedChatGroup}" từ Teams/Zalo...`
                      : `Tải lại tin nhắn của "${selectedChatGroup}" từ Teams/Zalo`}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${syncingGroups.has(selectedChatGroup) ? "animate-[spin_2s_linear_infinite]" : ""}`} />
                    <span>
                      {syncingGroups.has(selectedChatGroup) 
                        ? "Đang tải..." 
                        : autoReloadIntervalConfig > 0 
                          ? `Tải lại (${Math.floor(autoReloadCountdown / 60)}:${(autoReloadCountdown % 60).toString().padStart(2, "0")})`
                          : "Tải lại"}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!selectedChatGroup) return;
                      if (!window.confirm(`Xóa dữ liệu chat của nhóm "${selectedChatGroup}" và đồng bộ lại?`)) return;
                      setIsClearing(true);
                      try {
                        await cmx.clearProjectMessages(project._id, selectedChatGroup);
                        // Trigger a re-sync for this specific group
                        syncChat(selectedChatGroup, activeTeamsGroups.find(g => g.name === selectedChatGroup)?.platform || "teams");
                      } catch (err) {
                        console.error("Failed to clear messages:", err);
                      } finally {
                        setIsClearing(false);
                      }
                    }}
                    disabled={isClearing || !selectedChatGroup || syncingGroups.has(selectedChatGroup)}
                    className="h-7 px-2.5 text-xs font-medium rounded-md transition-all flex items-center gap-1.5 cursor-pointer text-muted-foreground hover:text-red-600 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                    title={selectedChatGroup ? `Xóa dữ liệu chat của "${selectedChatGroup}" và đồng bộ lại` : "Chọn nhóm chat trước"}
                  >
                    {isClearing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    <span>Xóa & đ.bộ</span>
                  </button>
                </div>
              </div>
              
              {/* Messages Area */}
              <div ref={messagesScrollRef} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar flex flex-col pb-4 pr-2">
              {selectedChatGroup && syncingGroups.has(selectedChatGroup) && (
                <div className="shrink-0 mb-2 px-3 py-2 rounded-lg border border-primary/20 bg-primary/5 flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0" />
                  <span className="text-[11px] font-medium text-primary">
                    Đang đồng bộ chat &quot;{selectedChatGroup}&quot; — đang mở Teams/Zalo để lấy tin nhắn mới...
                  </span>
                </div>
              )}
              {(!projectChats || projectChats.length === 0) ? (
                selectedChatGroup && syncingGroups.has(selectedChatGroup) ? (
                  <div className="flex flex-col gap-3 pt-2 px-1">
                    <div className="flex justify-start"><div className="w-48 h-10 rounded-xl rounded-bl-none bg-muted/40 animate-pulse" /></div>
                    <div className="flex justify-end"><div className="w-56 h-14 rounded-xl rounded-br-none bg-primary/10 animate-pulse" /></div>
                    <div className="flex justify-start"><div className="w-32 h-10 rounded-xl rounded-bl-none bg-muted/40 animate-pulse" /></div>
                    <div className="flex justify-start"><div className="w-64 h-16 rounded-xl rounded-bl-none bg-muted/40 animate-pulse" /></div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
                    <span className="text-[12px]">Chưa có tin nhắn nào.</span>
                  </div>
                )
              ) : (
                (() => {
                  const q = chatSearch.trim().toLowerCase();
                  let chatMessages = projectChats.filter((m) => m.chatName === selectedChatGroup);
                  if (q) {
                    chatMessages = chatMessages.filter((m) =>
                      (m.sender || "").toLowerCase().includes(q) ||
                      (m.content || "").toLowerCase().includes(q) ||
                      (m.timestamp || "").toLowerCase().includes(q)
                    );
                  }
                  if (chatMessages.length === 0) {
                    if (syncingGroups.has(selectedChatGroup)) {
                      return (
                        <div className="flex flex-col gap-3 pt-2 px-1">
                          <div className="flex justify-start"><div className="w-48 h-10 rounded-xl rounded-bl-none bg-muted/40 animate-pulse" /></div>
                          <div className="flex justify-end"><div className="w-56 h-14 rounded-xl rounded-br-none bg-primary/10 animate-pulse" /></div>
                          <div className="flex justify-start"><div className="w-32 h-10 rounded-xl rounded-bl-none bg-muted/40 animate-pulse" /></div>
                          <div className="flex justify-start"><div className="w-64 h-16 rounded-xl rounded-bl-none bg-muted/40 animate-pulse" /></div>
                        </div>
                      );
                    }
                    return (
                      <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
                        <Search className="w-5 h-5 mb-2 opacity-30" />
                        <span className="text-[12px]">
                          {q ? `Không tìm thấy tin nhắn nào khớp "${chatSearch.trim()}"` : "Chưa có tin nhắn nào."}
                        </span>
                      </div>
                    );
                  }
                  return (
                    <>
                      {chatMessages.map((msg, idx: number) => {
                    const prev = idx > 0 ? chatMessages[idx - 1] : undefined;
                    const next = idx < chatMessages.length - 1 ? chatMessages[idx + 1] : undefined;
                    
                    const getMsgTs = (m: ChatMessage | undefined) => {
                      if (!m) return 0;
                      if (m.timestampMs !== undefined && m.timestampMs !== null) return Number(m.timestampMs);
                      const t = Number(m.timestamp);
                      if (!isNaN(t) && t > 1000000000000) return t;
                      const d = new Date(Number(m.timestamp));
                      if (!isNaN(d.getTime())) return d.getTime();
                      return 0;
                    };

                    const msgTs = getMsgTs(msg);
                    const prevTs = getMsgTs(prev);
                    const nextTs = getMsgTs(next);
                    
                    const isFirstInGroup = !prev || prev.sender !== msg.sender || (msgTs - prevTs > 5 * 60 * 1000);
                    const isLastInGroup = !next || next.sender !== msg.sender || (nextTs - msgTs > 5 * 60 * 1000);
                    
                    const isAgent = msg.sender.includes("Antigravity") || msg.sender.includes("Bot") || msg.sender.toLowerCase().includes("trợ lý");
                    // Own messages (extracted from Teams/Zalo): "Me"/"Tôi" sender or isMine flag
                    const isMine = !!msg.isMine || msg.sender === "Me" || msg.sender === "Tôi" || msg.sender === "Tui" || msg.sender === "Bạn";
                    
                    // Parse timestamp safely
                    let timeStr = msg.timestamp;
                    const timestampNum = Number(msg.timestamp);
                    if (!isNaN(timestampNum) && timestampNum > 1000000000000) {
                      timeStr = new Date(timestampNum).toLocaleString("vi-VN", {
                        hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit",
                      });
                    } else {
                      const d = new Date(msg.timestamp);
                      if (!isNaN(d.getTime())) {
                        timeStr = d.toLocaleString("vi-VN", {
                          hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit",
                        });
                      }
                    }

                    // Format quotes in content
                    let quoteSender = null;
                    let quoteContent = null;
                    let mainText = msg.content;

                    // New Zalo format: content starts with "> Sender: quoted text\n..."
                    if (msg.content.startsWith('> ')) {
                      const newlineIdx = msg.content.indexOf('\n');
                      if (newlineIdx > 2) {
                        const quoteLine = msg.content.substring(2, newlineIdx).trim();
                        // Parse "Sender: quoted content"
                        const colonIdx = quoteLine.indexOf(':');
                        if (colonIdx > 0) {
                          quoteSender = quoteLine.substring(0, colonIdx).trim();
                          quoteContent = quoteLine.substring(colonIdx + 1).trim();
                          mainText = msg.content.substring(newlineIdx + 1).trim();
                        } else {
                          quoteSender = "Trích dẫn";
                          quoteContent = quoteLine;
                          mainText = msg.content.substring(newlineIdx + 1).trim();
                        }
                      }
                    } else {
                      // Old format (Teams-style): parse "Sender (date): msg" or "\n> " prefix
                      const quoteMatch = msg.content.match(/^([a-zA-Z0-9\.\s_-]+?)\s?(\d{1,2}\/\d{1,2}\/\d{4}\s\d{1,2}:\d{2}\s[AP]M):?\s*([\s\S]*)$/i);
                      if (quoteMatch) {
                        quoteSender = quoteMatch[1].trim();
                        // Legacy squished format (old extractor): header + quoted
                        // text + reply text run together with no separators. Show
                        // the whole remainder as the quoted content — after a
                        // re-sync the new extractor splits them correctly.
                        quoteContent = quoteMatch[3].trim();
                        mainText = "";
                      } else if (msg.content.includes('\n> ')) {
                        const parts = msg.content.split('\n> ');
                        if (parts.length > 1) {
                          const quotePart = parts[1].replace(':', '').trim();
                          const colonIdx = quotePart.indexOf(':');
                          if (colonIdx > 0) {
                            quoteSender = quotePart.substring(0, colonIdx).trim();
                            quoteContent = quotePart.substring(colonIdx + 1).trim();
                          } else {
                            quoteSender = "Trích dẫn";
                            quoteContent = quotePart;
                          }
                          mainText = parts.slice(2).join('\n> ').trim() || parts[0].trim();
                        }
                      }
                    }

                    // Remove trailing Zalo/Teams reaction icons (emoji + optional number)
                    mainText = mainText.replace(/(?:(?:👍|❤️|😆|😲|😢|😡|🙏|👏)\s*\d*\s*)+$/u, '').trim();
                    
                    // Remove trailing Teams text-based reactions (e.g., "Khoi Tran Quang1 Heart reaction." or "1 Like reaction.")
                    mainText = mainText.replace(/(?:\s*[a-zA-ZÀ-ỹ\s]{0,50}\d+\s+(?:Heart|Like|Laugh|Sad|Surprised|Angry)\s+reactions?\.?)+$/i, '').trim();
                    
                    const paddingClass = isFirstInGroup ? (isLastInGroup ? "py-1.5" : "pt-2 pb-0.5") : (isLastInGroup ? "pt-0.5 pb-2" : "py-0.5");
                    
                    const bubbleRadius = isMine
                      ? `rounded-2xl ${!isFirstInGroup ? 'rounded-tr-[4px]' : ''} ${!isLastInGroup ? 'rounded-br-[4px]' : ''}`
                      : `rounded-2xl ${!isFirstInGroup ? 'rounded-tl-[4px]' : ''} ${!isLastInGroup ? 'rounded-bl-[4px]' : ''}`;

                    return (
                      <div key={msg._id} className={`flex gap-2.5 group ${paddingClass} ${isMine ? "flex-row-reverse" : ""}`}>
                        {/* Avatar — tin của mình không hiển thị avatar, chỉ giữ khoảng trống */}
                        {isFirstInGroup && !isMine ? (
                          <img 
                            src={msg.senderAvatar 
                              ? (msg.senderAvatar.startsWith("http") ? proxyImageUrl(msg.senderAvatar) : msg.senderAvatar) 
                              : `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(msg.sender)}&radius=50`
                            } 
                            className="w-8 h-8 rounded-full shrink-0 mt-1 shadow-sm border border-border/20 bg-muted object-cover" 
                            alt={msg.sender}
                            onError={(e) => {
                              const target = e.currentTarget;
                              if (!target.dataset.fallback) {
                                target.dataset.fallback = "true";
                                target.src = `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(msg.sender)}&radius=50`;
                              }
                            }}
                          />
                        ) : (
                          <div className="w-8 shrink-0" />
                        )}
                        
                        {/* Message Content */}
                        <div className={`flex flex-col w-full max-w-[85%] ${isMine ? "items-end" : ""}`}>
                          {/* Name & Time — only show for the first message in a group */}
                          {isFirstInGroup && (
                            <div className={`flex items-baseline gap-2 mb-1 pl-1 flex-wrap ${isMine ? "flex-row-reverse pl-0 pr-1" : ""}`}>
                              <span className="text-[12px] font-semibold text-foreground/80">{msg.sender}</span>
                              <span className="text-[10px] text-muted-foreground/70 font-medium">{timeStr}</span>
                              {msg.platform && msg.platform !== "teams" && (
                                <span className={`text-[8px] font-bold px-1 py-0.5 rounded shrink-0 ${
                                  msg.platform === "zalo"
                                    ? "bg-blue-600/10 text-blue-700 dark:text-blue-300"
                                    : "bg-violet-500/10 text-violet-600 dark:text-violet-400"
                                }`}>
                                  {msg.platform === "zalo" ? "Zalo" : "Teams"}
                                </span>
                              )}
                              <span className="text-[9px] text-muted-foreground/70 bg-muted/60 px-1.5 py-0.5 rounded-sm truncate max-w-[150px]" title={msg.chatName}>
                                {msg.chatName}
                              </span>
                            </div>
                          )}
                          
                          {/* Bubble — only render when there is actual text.
                              Image-only messages (no caption) should not show
                              an empty colored bubble box. */}
                          {(mainText || quoteContent) && (
                            <div className={`text-[13px] leading-relaxed whitespace-pre-wrap break-words px-3.5 py-2.5 shadow-sm w-fit ${bubbleRadius} ${
                              isAgent 
                                ? "bg-primary text-primary-foreground border border-primary/20" 
                                : isMine
                                  ? "bg-blue-600 text-white border border-blue-500/20"
                                  : "bg-card text-card-foreground border border-border/50"
                            } ${!isFirstInGroup ? "mt-0.5" : "mt-1"}`}>
                              {quoteSender ? (
                                <div className="flex flex-col mb-1.5">
                                  <div className={`px-2.5 py-1.5 border-l-[3px] rounded-r-md text-[11.5px] flex flex-col gap-0.5 ${isMine ? "bg-white/20 border-white/40" : "bg-foreground/5 border-primary/40"}`}>
                                    <span className="font-bold flex items-center gap-1.5 opacity-90"><Quote className="w-3 h-3 opacity-50"/> {quoteSender}</span>
                                    {quoteContent && <span className="opacity-80 line-clamp-3 leading-relaxed mt-0.5"><LinkifyText text={quoteContent} isMine={isMine} /></span>}
                                  </div>
                                  <div className="mt-1.5">
                                    <LinkifyText text={mainText} isMine={isMine} />
                                  </div>
                                </div>
                              ) : (
                                <LinkifyText text={mainText} isMine={isMine} />
                              )}
                              {/* Images */}
                              {(msg.images ? (() => {
                                try {
                                  const parsed = typeof msg.images === 'string' ? JSON.parse(msg.images) : msg.images;
                                  if (!Array.isArray(parsed)) return [];
                                  return parsed.filter((s: unknown): s is string =>
                                    typeof s === 'string' &&
                                    s.length > 0 &&
                                    (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('data:') || s.startsWith('storage:') || s.startsWith('/api/data/files/') || s.startsWith('/api/files/'))
                                  );
                                } catch { return []; }
                              })() : []).map((imgSrc: string, imgIdx: number) => (
                                <div key={imgIdx} className="mt-2 rounded-lg overflow-hidden border border-border/30">
                                  <ChatImage
                                    src={imgSrc}
                                    alt={`Image ${imgIdx + 1}`}
                                    className="max-w-full h-auto rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
                                  />
                                </div>
                              ))}
                            </div>
                          )}
                          {/* Image-only message (no caption text) — images outside bubble */}
                          {!(mainText || quoteContent) && (() => {
                            try {
                              const parsed = typeof msg.images === 'string' ? JSON.parse(msg.images) : msg.images;
                              if (!Array.isArray(parsed)) return [];
                              return parsed.filter((s: unknown): s is string =>
                                typeof s === 'string' &&
                                s.length > 0 &&
                                (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('data:') || s.startsWith('storage:') || s.startsWith('/api/data/files/') || s.startsWith('/api/files/'))
                              );
                            } catch { return []; }
                          })().map((imgSrc: string, imgIdx: number) => (
                            <div key={imgIdx} className={`${isMine ? "bg-blue-600/10" : "bg-card"} p-1.5 rounded-2xl border border-border/50 shadow-sm ${!isFirstInGroup ? "mt-0.5" : "mt-1"}`}>
                              <ChatImage
                                src={imgSrc}
                                alt={`Image ${imgIdx + 1}`}
                                className="max-w-full h-auto rounded-xl cursor-pointer hover:opacity-90 transition-opacity"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {syncingGroups.has(selectedChatGroup) && (
                    <div className="flex justify-start mt-4 px-2 pb-4">
                      <div className="bg-muted/40 text-muted-foreground rounded-xl rounded-bl-none px-4 py-2.5 flex items-center gap-2 w-fit">
                        <span className="text-[11px] font-medium">Đang tải thêm...</span>
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                      </div>
                    </div>
                  )}
                  </>
                  );
                })()
              )}
            </div>
            {/* ── Chat Send Composer (Zalo + Teams) ── */}
            {(() => {
              const sendGroup = activeTeamsGroups.find(g => g.name === selectedChatGroup);
              const isZaloChat = sendGroup?.platform === "zalo";
              return (
                <div className="shrink-0 border-t border-border/30 pt-2 pb-1">
                  <div className="flex items-center gap-2">
                    <textarea
                      value={sendMessage}
                      onChange={(e) => setSendMessage(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          if (selectedChatGroup && sendMessage.trim() && sendGroup) handleSendChat(sendGroup.name, sendGroup.platform || "teams", sendMessage);
                        }
                      }}
                      placeholder={
                        !selectedChatGroup
                          ? "Chọn một nhóm chat để gửi tin nhắn..."
                          : `Soạn tin nhắn, nhấn Enter để gửi tới ${isZaloChat ? "Zalo" : "Teams"}...`
                      }
                      disabled={!selectedChatGroup || !sendGroup || sending}
                      rows={2}
                      maxLength={2000}
                      className="w-full text-[12px] resize-none rounded-lg bg-muted/50 border border-border/50 outline-none focus:border-primary/40 placeholder:text-muted-foreground/40 px-3 py-2 disabled:opacity-50"
                    />
                    <button
                      type="button"
                      onClick={() => { if (sendGroup && sendMessage) handleSendChat(sendGroup.name, sendGroup.platform || "teams", sendMessage); }}
                      disabled={!selectedChatGroup || !sendMessage.trim() || sending || !sendGroup}
                      className="self-end p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                      title={`Gửi tin nhắn ${isZaloChat ? "Zalo" : "Teams"}`}
                    >
                      {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    </button>
                  </div>
                  {(sendError || (lastSent && lastSent.chatName === selectedChatGroup)) && (
                    <div className={`mt-1.5 text-[11px] ${sendError ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"} flex items-center gap-1`}>
                      {sendError ? <AlertTriangle className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
                      <span>
                        {sendError
                          ? sendError
                          : lastSent!.ok
                            ? `Đã gửi thành công tới "${lastSent!.chatName}".`
                            : `Đã gửi thành công tới "${lastSent!.chatName}" (dry-run).`}
                      </span>
                    </div>
                  )}
                </div>
              );
            })()}
            </div>
          </div>
        ) : tab === "suggestions" ? (
          <PhaseWorkflowCard
            project={{
              _id: project._id,
              name: project.name,
              ticketId: (project as any).ticketId ?? undefined,
            }}
            userId={userId ?? undefined}
            saleName={isdSaleName || undefined}
            saleEmail={isdSaleEmail || undefined}
            workflow={workflow}
            loading={workflowLoading}
            onUpdateWorkflow={wfmx.updateWorkflowPhase ? (body) => (body.phase ? wfmx.updateWorkflowPhase(body) : wfmx.updateWorkflowData(body)) : wfmx.updateWorkflowData}
            onUpdateStep={(stepKey, status) =>
              wfmx.updateWorkflowStep({ projectId: project._id, userId, stepKey, status: status ?? null })
            }
            onGenerateTasks={(items, prefix) =>
              wfmx.generateTrackingTasks({ projectId: project._id, userId, items, prefix })
            }
            onSwitchTab={(t) => handleTabChange(t as any)}
          />
        ) : tab === "emails" ? (
          /* Emails Tab */
          <div className="space-y-2 max-h-[440px] overflow-y-auto pr-1">
            {/* Email stats */}
            <div className="bg-gradient-to-br from-card to-muted/30 border border-border/50 rounded-xl p-3 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-primary" />
                  Email từ dự án này
                </h3>
                <EmailComposeDialog
                  projectId={project._id}
                  defaultSubject={`[${project.name}] `}
                  trigger={
                    <button
                      type="button"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-all cursor-pointer shadow-sm"
                    >
                      <Mail className="w-3.5 h-3.5" />
                      Gửi Email
                    </button>
                  }
                />
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3">
                <div className="flex flex-col items-center p-2 rounded-lg bg-background/60 border border-border/30">
                  <span className="text-sm font-bold text-foreground">{projectEmails.length}</span>
                  <span className="text-[9px] text-muted-foreground mt-0.5">Tổng</span>
                </div>
                <div className="flex flex-col items-center p-2 rounded-lg bg-emerald-500/5 border border-emerald-500/15">
                  <span className="text-sm font-bold text-emerald-500">{projectEmails.filter(e => e.status === "sent").length}</span>
                  <span className="text-[9px] text-emerald-500/70 mt-0.5">Đã gửi</span>
                </div>
                <div className="flex flex-col items-center p-2 rounded-lg bg-rose-500/5 border border-rose-500/15">
                  <span className="text-sm font-bold text-rose-500">{projectEmails.filter(e => e.status === "failed").length}</span>
                  <span className="text-[9px] text-rose-500/70 mt-0.5">Lỗi</span>
                </div>
              </div>
            </div>

            {/* Email list */}
            {projectEmails.length > 0 ? (
              <div className="space-y-1">
                {projectEmails.map((email) => {
                  const statusCfg =
                    email.status === "sent"
                      ? { icon: CheckCircle2, label: "Đã gửi", class: "text-emerald-500 bg-emerald-500/10" }
                      : email.status === "failed"
                        ? { icon: XCircle, label: "Thất bại", class: "text-rose-500 bg-rose-500/10" }
                        : { icon: Loader2, label: "Đang gửi", class: "text-amber-500 bg-amber-500/10" };
                  const StatusIcon = statusCfg.icon;
                  return (
                    <div
                      key={email._id}
                      className="p-3 rounded-xl border border-border/30 bg-card/50 hover:bg-muted/20 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-1">
                            <StatusIcon className={`w-3 h-3 shrink-0 ${statusCfg.class.split(" ")[0]} ${email.status === "sending" ? "animate-spin" : ""}`} />
                            <span className="text-[12px] font-semibold text-foreground truncate">
                              {email.subject || "(Không tiêu đề)"}
                            </span>
                          </div>
                          <p className="text-[10px] text-muted-foreground truncate">
                            To: {email.to.join(", ")}
                          </p>
                          {email.cc && email.cc.length > 0 && (
                            <p className="text-[10px] text-muted-foreground/70 truncate">
                              CC: {email.cc.join(", ")}
                            </p>
                          )}
                          <p className="text-[9px] text-muted-foreground/50 mt-1">
                            {format(new Date(email.sentAt), "dd/MM/yyyy HH:mm")}
                          </p>
                        </div>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-medium shrink-0 ${statusCfg.class}`}>
                          {statusCfg.label}
                        </span>
                      </div>
                      {email.errorMessage && (
                        <p className="text-[10px] text-rose-500 mt-1.5 pt-1.5 border-t border-border/20">
                          {email.errorMessage}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-center p-4">
                <Mail className="w-6 h-6 text-muted-foreground/30 mb-2" />
                <span className="text-[11px]">Chưa có email nào cho dự án này</span>
                <span className="text-[10px] text-muted-foreground/50 mt-1">
                  Soạn email mới từ nút ở trên
                </span>
              </div>
            )}
          </div>
        ) : tab === "members" ? (
          /* Members Tab */
          <div className="space-y-2 max-h-[440px] overflow-y-auto pr-1">
            {/* Header with add button */}
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-primary" />
                Thành viên dự án
              </h3>
              <button
                type="button"
                onClick={() => {
                  setShowAddMember(!showAddMember);
                  setNewMemberName("");
                  setNewMemberEmail("");
                  setNewMemberRoleId(null);
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-all cursor-pointer shadow-sm"
              >
                <Plus className="w-3 h-3" />
                Thêm member
              </button>
            </div>

            {/* Add member form */}
            {showAddMember && (
              <div className="p-3 rounded-xl border border-primary/30 bg-primary/5 shadow-sm">
                <div className="flex flex-col gap-2">
                  <input
                    type="text"
                    value={newMemberName}
                    onChange={(e) => setNewMemberName(e.target.value)}
                    placeholder="Tên thành viên"
                    className="h-7 px-2 text-[10px] rounded-lg bg-background/80 border border-border/50 text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/50"
                  />
                  <input
                    type="email"
                    value={newMemberEmail}
                    onChange={(e) => setNewMemberEmail(e.target.value)}
                    placeholder="Email (không bắt buộc)"
                    className="h-7 px-2 text-[10px] rounded-lg bg-background/80 border border-border/50 text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/50"
                  />
                  <select
                    value={newMemberRoleId || ""}
                    onChange={(e) => setNewMemberRoleId(e.target.value || null)}
                    className="h-7 px-2 text-[10px] rounded-lg bg-background/80 border border-border/50 text-foreground outline-none focus:border-primary/50"
                  >
                    <option value="">Chọn vai trò...</option>
                    {(projectRolesList || []).map((role) => (
                      <option key={role._id} value={role._id}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-1.5 justify-end mt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddMember(false);
                        setNewMemberName("");
                        setNewMemberEmail("");
                        setNewMemberRoleId(null);
                      }}
                      className="px-2.5 py-1 rounded-lg text-[10px] font-medium text-muted-foreground hover:text-foreground border border-border/50 hover:bg-muted/30 transition-all cursor-pointer"
                    >
                      Hủy
                    </button>
                    <button
                      type="button"
                      disabled={!newMemberName.trim()}
                      onClick={async () => {
                        if (!newMemberName.trim() || !projectRolesList) return;
                        const selectedRole = newMemberRoleId
                          ? projectRolesList.find((r) => r._id === newMemberRoleId)
                          : null;
                        await mmx.addMember({
                          projectId: project._id,
                          userId: userId!,
                          name: newMemberName.trim(),
                          email: newMemberEmail.trim() || undefined,
                          roleId: newMemberRoleId || undefined,
                          roleName: selectedRole?.name || "Chưa phân công",
                          source: "manual",
                        });
                        setNewMemberName("");
                        setNewMemberEmail("");
                        setNewMemberRoleId(null);
                        setShowAddMember(false);
                      }}
                      className="px-2.5 py-1 rounded-lg text-[10px] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-all cursor-pointer disabled:opacity-40"
                    >
                      <Save className="w-3 h-3 inline mr-0.5" />
                      Lưu
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Members list */}
            {!projectMembers ? (
              <div className="flex items-center justify-center h-32">
                <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              </div>
            ) : projectMembers.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-center p-4">
                <Users className="w-6 h-6 text-muted-foreground/30 mb-2" />
                <span className="text-[11px]">Chưa có thành viên nào</span>
                <span className="text-[10px] text-muted-foreground/50 mt-1">
                  Thêm member từ nút ở trên
                </span>
              </div>
            ) : (
              <div className="space-y-1">
                {projectMembers.map((member) => {
                  const memberRoleColor = member.roleId
                    ? (projectRolesList || []).find((r) => r._id === member.roleId)?.color
                    : undefined;

                  return (
                    <MemberCard
                      key={member._id}
                      member={member}
                      roles={projectRolesList || []}
                      roleColor={memberRoleColor}
                      onUpdate={async (id, data) => {
                        await mmx.updateMember(id, data);
                      }}
                      onRemove={async (id) => {
                        await mmx.removeMember(id);
                      }}
                    />
                  );
                })}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
