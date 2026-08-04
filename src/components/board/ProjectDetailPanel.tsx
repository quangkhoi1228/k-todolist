"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { ListTodo, FileText, BarChart3, Copy, Check, StickyNote, Plus, ChevronRight, Trash2, X, MessageSquare, Users, Loader2, Quote, Sparkles, ImageIcon, Mail, Download, CheckCircle2, XCircle, ExternalLink, Save, AlertTriangle, Edit3, Search, Send, BrainCircuit, Target, ChevronDown, ListPlus, MessagesSquare } from "lucide-react";
import { EmailComposeDialog } from "./EmailComposeDialog";
import { format } from "date-fns";
import { WysiwygEditor } from "./WysiwygEditor";
import type { Doc } from "@/lib/types";
import {
  useSuggestionsByProject,
  useSuggestionMutations,
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
  useTaskMutations,
} from "@/hooks/useDomain";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { IsdFlowDiagram } from "./IsdFlowDiagram";

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
  };
  tab?: "info" | "notes" | "summary" | "history" | "chats" | "suggestions" | "emails" | "members";
  onTabChange?: (tab: "info" | "notes" | "summary" | "history" | "chats" | "suggestions" | "emails" | "members") => void;
}

const STATUS_LABELS: Record<string, { label: string; color: string; short: string }> = {
  todo: { label: "Chưa thực hiện", color: "text-neutral-500", short: "Todo" },
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
        onClick={() => { window.open(validSrc, '_blank'); onClick?.(); }}
      />
    );
  }

  // Always try the original URL first (CDN might still serve it).
  // If it fails, fall back to the proxy which will attempt server-side
  // fetch with stored auth cookies to get a fresh token.
  const shouldProxy = useProxy;
  const currentSrc = shouldProxy ? proxyImageUrl(validSrc) : validSrc;

  console.log(`[ChatImage] Rendering: ${currentSrc.slice(0, 100)} (shouldProxy=${shouldProxy}, failedProxy=${failedProxy})`);

  const handleClick = useCallback(() => {
    // Open via proxy if original was blocked, else use original URL
    const url = (shouldProxy || failedProxy) ? proxyImageUrl(validSrc) : validSrc;
    window.open(url, '_blank');
    onClick?.();
  }, [validSrc, useProxy, failedProxy, onClick]);

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
  onUpdate: (id: string, data: { roleId?: string | null; roleName?: string }) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [editRoleId, setEditRoleId] = useState(member.roleId || "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [removing, setRemoving] = useState(false);

  const handleSaveRole = async () => {
    const selectedRole = roles.find((r) => r._id === editRoleId);
    await onUpdate(member._id, {
      roleId: editRoleId || (undefined as any),
      roleName: selectedRole?.name || "Chưa phân công",
    });
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
    <div className="flex items-center gap-2.5 p-2.5 rounded-xl border border-border/30 bg-card/50 hover:bg-muted/10 transition-colors group">
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

      {/* Info */}
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
        </div>
        {member.email && (
          <p className="text-[9px] text-muted-foreground/70 truncate">{member.email}</p>
        )}
      </div>

      {/* Role */}
      {editing ? (
        <div className="flex items-center gap-1 shrink-0">
          <select
            value={editRoleId}
            onChange={(e) => setEditRoleId(e.target.value)}
            className="h-6 px-1.5 text-[9px] rounded-lg bg-muted border border-border/50 text-foreground outline-none max-w-[100px]"
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
              setEditing(true);
            }}
            className="p-1 rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-muted/30 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
            title="Đổi vai trò"
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

export function ProjectDetailPanel({ project, tab: propTab, onTabChange: propOnTabChange }: ProjectDetailPanelProps) {
  const { userId } = useAuth();
  const [localTab, setLocalTab] = useState<"info" | "notes" | "summary" | "history" | "chats" | "suggestions" | "emails" | "members">("info");
  const tab = propTab ?? localTab;
  const handleTabChange = propOnTabChange ?? setLocalTab;

// ─── Chats State ───────────────────────────────────
  const [activeTeamsGroups, setActiveTeamsGroups] = useState<{name: string, type: "internal" | "customer", platform?: string, url?: string}[]>((project as any).teamsGroups || []);
  const [isGroupManagerOpen, setIsGroupManagerOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupType, setNewGroupType] = useState<"internal" | "customer">("customer");
  const [newGroupPlatform, setNewGroupPlatform] = useState<"teams" | "zalo">("teams");
  const [selectedChatGroup, setSelectedChatGroup] = useState<string>("");
  const [fetchingChats, setFetchingChats] = useState(false);
  const [availableTeamsChats, setAvailableTeamsChats] = useState<{name: string; scrapedAt?: number}[]>([]);
  const [availableZaloChats, setAvailableZaloChats] = useState<{name: string; scrapedAt?: number}[]>([]);
  const [lastListedAt, setLastListedAt] = useState<{teams: number | null; zalo: number | null}>({teams: null, zalo: null});
  const [isSyncing, setIsSyncing] = useState(false);
  const [clearGroup, setClearGroup] = useState<string | null>(null); // group currently being cleared
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [chatSearch, setChatSearch] = useState("");

  // ─── Zalo send state ─────────────────────────
  const [sendMessage, setSendMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [lastSent, setLastSent] = useState<{ ok: boolean; chatName: string; dryRun: boolean; at: number } | null>(null);

  // ─── Sync chat groups & selection when project changes ─────
  useEffect(() => {
    const groups = ((project as any).teamsGroups || []) as {name: string; type: "internal" | "customer"; platform?: string; url?: string}[];
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
    setNewGroupName("");
  }, [project._id]);

  // ─── Suggestions State ────────────────────────
  const { data: projectSuggestions } = useSuggestionsByProject(project._id ?? null);
  const smx = useSuggestionMutations();
  const tmx = useTaskMutations();
  const cmx = useChatMutations();
  const gmx = useGroupMutations();
  const [expandedSuggestionId, setExpandedSuggestionId] = useState<string | null>(null);
  const [channelMenuId, setChannelMenuId] = useState<string | null>(null);
  const [addingTaskId, setAddingTaskId] = useState<string | null>(null);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [taskAddedId, setTaskAddedId] = useState<string | null>(null);
  const [sendingChannelId, setSendingChannelId] = useState<string | null>(null);
  const [sendChannelError, setSendChannelError] = useState<string | null>(null);
  const [sendChannelOk, setSendChannelOk] = useState<string | null>(null);

  // ─── Members State ────────────────────────
  const { data: projectMembers } = useMembersByProject(project._id ?? null);
  const { data: projectRolesList } = useRoles(userId);
  const mmx = useMemberMutations();

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
  const [analysingSuggestions, setAnalysingSuggestions] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const projectChatsRef = useRef<any[]>([]);
  // We'll update the ref from the projectChats data below via another effect

  const runSuggestionAnalysis = useCallback(async () => {
    if (!project._id || !userId) return;
    setAnalysingSuggestions(true);
    setSuggestionsError(null);
    try {
      const messages = projectChatsRef.current;
      const res = await fetch("/api/agents/analyse-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName: project?.name || "",
          projectId: project._id,
          messages,
        }),
      });
      if (!res.ok) throw new Error("Failed to analyse suggestions");
      const data = await res.json();
      if (data.ok && data.suggestions && data.suggestions.length > 0) {
        await smx.addSuggestionsBatch({
          projectId: project._id,
          userId,
          suggestions: data.suggestions.map((s: any) => ({
            type: s.type || "info",
            title: s.title || "Gợi ý",
            description: s.description || "",
            sourceMessage: s.sourceMessage || undefined,
            sourceSender: s.sourceSender || undefined,
            sourceChatName: s.sourceChatName || undefined,
            sourceTimestamp: s.sourceTimestamp || undefined,
            actionLabel: s.actionLabel || undefined,
            actionUrl: s.actionUrl || undefined,
            suggestionData:
              s.input || s.reasoning || s.expectedOutcome
                ? JSON.stringify({
                    input: s.input,
                    reasoning: s.reasoning,
                    expectedOutcome: s.expectedOutcome,
                  })
                : undefined,
          })),
        });
      }
    } catch (err) {
      console.error("[Suggestions] Error:", err);
      setSuggestionsError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setAnalysingSuggestions(false);
    }
  }, [project._id, project?.name, userId, smx]);

  // Thêm suggestion vào tasklist của project
  const handleAddSuggestionTask = useCallback(async (s: any) => {
    if (addingTaskId) return;
    setAddingTaskId(s._id);
    setTaskError(null);
    setTaskAddedId(null);
    try {
      let priority: string | undefined;
      try {
        if (s.suggestionData) {
          const parsed = JSON.parse(s.suggestionData);
          priority = parsed?.priority;
        }
      } catch { /* ignore */ }
      await tmx.createTask({
        userId,
        title: s.title,
        estimatedTime: 0,
        notes: s.description,
        project: project._id,
        status: "todo",
        priority: priority === "high" ? "high" : priority === "low" ? "low" : "normal",
      });
      setTaskAddedId(s._id);
    } catch (err) {
      console.error("[Suggestions] Add task failed:", err);
      setTaskError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setAddingTaskId(null);
    }
  }, [addingTaskId, tmx, userId, project._id]);

  // Gửi tin nhắn tới kênh (Teams hoặc Zalo) liên quan của project
  const handleSendSuggestionToChannel = useCallback(async (s: any, channel: { name: string; platform?: string }) => {
    const endpoint = channel.platform === "zalo" ? "/api/agents/zalo-send" : "/api/agents/teams-send";
    setSendingChannelId(s._id);
    setSendChannelError(null);
    setSendChannelOk(null);
    setChannelMenuId(null);
    const message = `[Gợi ý từ PM Agent] ${s.title}\n${s.description}`;
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          chatName: channel.name,
          message,
          dryRun: false,
        }),
      });
      const data = await res.json().catch(() => ({ ok: false, error: "Invalid JSON response" }));
      if (data.ok) {
        setSendChannelOk(`${channel.name} (${channel.platform === "zalo" ? "Zalo" : "Teams"})`);
      } else {
        setSendChannelError(data.error || "Không gửi được tin nhắn.");
      }
    } catch (err) {
      console.error("[Suggestions] Send to channel failed:", err);
      setSendChannelError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSendingChannelId(null);
    }
  }, []);

  // Danh sách kênh nhắn cho suggestion — từ teamsGroups của project
  const getSuggestionChannels = useCallback((s: any): Array<{ name: string; platform: string; tag: string }> => {
    const channels: Array<{ name: string; platform: string; tag: string }> = [];
    for (const g of activeTeamsGroups || []) {
      if (!g?.name) continue;
      channels.push({
        name: g.name,
        platform: g.platform || "teams",
        tag: g.type === "internal" ? "Nội bộ" : "KH",
      });
    }
    if (s.sourceChatName && !channels.some((c) => c.name === s.sourceChatName)) {
      channels.unshift({ name: s.sourceChatName, platform: "teams", tag: "Nguồn" });
    }
    return channels;
  }, [activeTeamsGroups]);

  // Auto-analyse when switching to suggestions tab — but ONLY ONCE per project
  // visit. Without the ref guard, an empty projectSuggestions list + failed LLM
  // analysis re-triggers this effect forever (state flips → re-render → effect
  // re-runs → infinite loop → page flickers continuously).
  const analysisAttemptedRef = useRef<string | null>(null);
  useEffect(() => {
    if (tab !== "suggestions") return;
    if (projectSuggestions && projectSuggestions.length > 0) {
      analysisAttemptedRef.current = project._id;
      return;
    }
    if (analysisAttemptedRef.current === project._id) return;
    if (analysingSuggestions) return;
    analysisAttemptedRef.current = project._id;
    runSuggestionAnalysis();
  }, [tab, projectSuggestions, analysingSuggestions, runSuggestionAnalysis, project._id]);

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
  });
  const [isClearing, setIsClearing] = useState(false);

  // Fetch emails for this project
  const { data: projectEmailsData } = useEmails(userId, { projectId: project._id });
  const projectEmails = projectEmailsData ?? [];

  // Keep ref in sync for suggestions analysis
  useEffect(() => {
    projectChatsRef.current = projectChats || [];
  }, [projectChats]);

  const fetchChats = async () => {
    if (!userId) return;
    setFetchingChats(true);
    try {
      const [teamsRes, zaloRes] = await Promise.all([
        fetch("/api/agents/teams-automator", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list_chats" }),
        }),
        fetch("/api/agents/zalo-automator", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list_chats" }),
        }),
      ]);
      if (teamsRes.ok) {
        const data = await teamsRes.json();
        const chatNames: string[] = data.chats || [];
        setAvailableTeamsChats(chatNames.map((n: string) => ({ name: n, scrapedAt: Date.now() })));
        // Save teams groups
        await gmx.syncGroups({
          userId,
          platform: "teams",
          groups: chatNames.map((n: string) => ({ name: n })),
        }).catch(console.error);
        setLastListedAt((prev: any) => ({ ...prev, teams: Date.now() }));
      }
      if (zaloRes.ok) {
        const data = await zaloRes.json();
        const chatNames: string[] = data.chats || [];
        setAvailableZaloChats(chatNames.map((n: string) => ({ name: n, scrapedAt: Date.now() })));
        // Save zalo groups
        await gmx.syncGroups({
          userId,
          platform: "zalo",
          groups: chatNames.map((n: string) => ({ name: n })),
        }).catch(console.error);
        setLastListedAt((prev: any) => ({ ...prev, zalo: Date.now() }));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setFetchingChats(false);
    }
  };

  // Load saved chat groups from Convex on mount
  useEffect(() => {
    if (userId) {
      if (savedTeamsChats.length > 0) {
        setAvailableTeamsChats(
          savedTeamsChats.map((g: any) => ({ name: g.name, scrapedAt: g.scrapedAt }))
        );
        setLastListedAt((prev: any) => ({
          ...prev,
          teams: Math.max(...savedTeamsChats.map((g: any) => g.scrapedAt || 0)),
        }));
      }
      if (savedZaloChats.length > 0) {
        setAvailableZaloChats(
          savedZaloChats.map((g: any) => ({ name: g.name, scrapedAt: g.scrapedAt }))
        );
        setLastListedAt((prev: any) => ({
          ...prev,
          zalo: Math.max(...savedZaloChats.map((g: any) => g.scrapedAt || 0)),
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
    if (!newGroupName.trim()) return;
    // Prevent adding duplicate group names
    if (activeTeamsGroups.some(g => g.name === newGroupName.trim())) {
      setNewGroupName("");
      setIsDropdownOpen(false);
      setIsGroupManagerOpen(false);
      return;
    }
    const newGroups = [...activeTeamsGroups, { name: newGroupName.trim(), type: newGroupType, platform: newGroupPlatform }];
    setActiveTeamsGroups(newGroups);
    setNewGroupName("");
    setIsDropdownOpen(false);
    setIsGroupManagerOpen(false); // Close modal on success
    
    await pm.updateProject({
      id: project._id,
      teamsGroups: newGroups,
    });

    // Tự động đồng bộ chat cho nhóm vừa thêm
    const newChatName = newGroupName.trim();
    const headless = localStorage.getItem("headlessMode") !== "false";
    fetch("/api/agents/sync-single-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: project._id,
        chatName: newChatName,
        platform: newGroupPlatform,
        headless,
      }),
    }).catch(console.error);
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

  const handleSendZalo = useCallback(async (chatName: string, message: string) => {
    if (!chatName || !message.trim()) return;
    if (sending) return;
    setSending(true);
    setSendError(null);
    setLastSent(null);
    try {
      const res = await fetch("/api/agents/zalo-send", {
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
        setSendError(data.error || "Không gửi được tin nhắn.");
      }
    } catch (err) {
      console.error("Send Zalo failed:", err);
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
          Chats ({projectChats?.length || 0})
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
          Gợi ý ({projectSuggestions?.filter(s => !s.isRead)?.length || 0})
        </button>
        <button
          type="button"
          onClick={() => handleTabChange("summary")}
          className={`px-3 py-1.5 text-[11px] font-semibold rounded-t-lg transition-all cursor-pointer flex items-center gap-1 ${
            tab === "summary"
              ? "bg-background text-foreground border border-border/60 border-b-background -mb-px shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
          }`}
        >
          <BarChart3 className="w-3 h-3" />
          Summary
        </button>
        <button
          type="button"
          onClick={() => handleTabChange("history")}
          className={`px-3 py-1.5 text-[11px] font-semibold rounded-t-lg transition-all cursor-pointer flex items-center gap-1 ${
            tab === "history"
              ? "bg-background text-foreground border border-border/60 border-b-background -mb-px shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
          }`}
        >
          <ListTodo className="w-3 h-3" />
          Lịch sử ({projectTasks.length})
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
      </div>

      {/* Tab Content */}
      <div className={`p-3 ${tab === "chats" ? "flex-1 min-h-0 flex flex-col" : ""}`}>
        {tab === "info" ? (
          <div className="space-y-1.5">
            {/* ISD Configuration — compact */}
            <div className="flex items-center gap-1.5 px-1.5 py-1 rounded-lg bg-card/20">
              <input
                type="text"
                placeholder="ISD Ticket ID"
                defaultValue={(project as any).ticketId || ""}
                onBlur={async (e) => {
                  const val = e.target.value.trim() || undefined;
                  if (val !== ((project as any).ticketId || undefined)) {
                    await pm.updateProject({ id: project._id, ticketId: val });
                  }
                }}
                onKeyDown={async (e) => {
                  if (e.key === "Enter") {
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                className="flex-1 h-6 text-[10px] bg-background/50 border border-border/50 rounded-md px-1.5 outline-none focus:border-primary/50 transition-colors placeholder:text-muted-foreground/40"
              />
              {(project as any).ticketId && (
                <a
                  href={`https://servicedesk.fci.vn/browse/${(project as any).ticketId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-muted-foreground hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                >
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
              {(project as any).ticketId && (project as any).isdStatus && (
                <span className="shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20">
                  {(project as any).isdStatus}
                </span>
              )}
            </div>

            {/* WYSIWYG Editor — compact */}
            <div className="relative min-h-[180px] border border-border/50 rounded-lg overflow-hidden">
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

            {/* Quick actions */}
            <div className="flex items-center gap-2">
              <EmailComposeDialog
                projectId={project._id as any}
                defaultSubject={`[${project.name}] `}
                trigger={
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-medium text-muted-foreground hover:text-primary hover:bg-primary/10 border border-border/40 hover:border-primary/30 transition-all cursor-pointer"
                  >
                    <Mail className="w-3 h-3" />
                    Gửi Email
                  </button>
                }
              />
            </div>
          </div>
        ) : tab === "notes" ? (
          /* Notes Tab — project notes from notes table */
          <div className="space-y-2 max-h-[440px] overflow-y-auto pr-1">
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
          <div className="space-y-3 max-h-[440px] overflow-y-auto pr-1">
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
        ) : tab === "history" ? (
          /* History Tab — timeline view */
          <div className="space-y-3 max-h-[440px] overflow-y-auto pr-1">
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
          <div className="flex gap-3 h-full min-h-0">
            {/* ── LEFT COLUMN: Chat List & Management ── */}
            <div className="w-56 shrink-0 flex flex-col gap-2 overflow-y-auto custom-scrollbar pr-1">
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
                  <DialogContent className="sm:max-w-md bg-card border-border">
                    <DialogHeader>
                      <DialogTitle className="text-lg font-bold flex items-center gap-2">
                        <MessageSquare className="w-5 h-5 text-primary" />
                        Thêm nhóm Chat mới
                      </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="flex gap-3">
                        <div className="flex-1 space-y-1.5">
                          <label className="text-sm font-medium text-foreground/80">Nền tảng</label>
                          <select
                            value={newGroupPlatform}
                            onChange={(e) => setNewGroupPlatform(e.target.value as "teams" | "zalo")}
                            className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary/50"
                          >
                            <option value="teams">Microsoft Teams</option>
                            <option value="zalo">Zalo Web</option>
                          </select>
                        </div>
                        <div className="flex-1 space-y-1.5">
                          <label className="text-sm font-medium text-foreground/80">Loại nhóm</label>
                          <select
                            value={newGroupType}
                            onChange={(e) => setNewGroupType(e.target.value as "internal" | "customer")}
                            className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary/50"
                          >
                            <option value="customer">Khách hàng</option>
                            <option value="internal">Nội bộ</option>
                          </select>
                        </div>
                      </div>
                      
                      <div className="space-y-1.5 relative">
                        <label className="text-sm font-medium text-foreground/80">Tên nhóm chat</label>
                        <input
                          type="text"
                          value={newGroupName}
                          onChange={(e) => { setNewGroupName(e.target.value); setIsDropdownOpen(true); }}
                          placeholder="Nhập tên chính xác của nhóm chat..."
                          className="w-full px-3 py-2 rounded-md bg-background border border-border text-sm outline-none focus:border-primary/50"
                          onFocus={() => setIsDropdownOpen(true)}
                          onBlur={() => setTimeout(() => setIsDropdownOpen(false), 200)}
                          onKeyDown={(e) => { if (e.key === "Enter") handleAddGroup(); }}
                        />
                        {isDropdownOpen && (newGroupPlatform === "zalo" ? availableZaloChats : availableTeamsChats).length > 0 && (
                          <div className="absolute top-full left-0 w-full mt-1 bg-background border border-border rounded-md shadow-lg max-h-48 overflow-y-auto z-50">
                            {(newGroupPlatform === "zalo" ? availableZaloChats : availableTeamsChats)
                              .filter((c: any) => c.name.toLowerCase().includes(newGroupName.toLowerCase()))
                              .map((chat: any, i: number) => (
                                <div key={i} onClick={() => { setNewGroupName(chat.name); setIsDropdownOpen(false); }} className="px-3 py-2 text-sm hover:bg-muted cursor-pointer flex items-center justify-between gap-2">
                                  <span className="truncate">{chat.name}</span>
                                  {chat.scrapedAt && (
                                    <span className="text-[9px] text-muted-foreground/50 shrink-0">
                                      {new Date(chat.scrapedAt).toLocaleDateString("vi-VN", { hour: "2-digit", minute: "2-digit" })}
                                    </span>
                                  )}
                                </div>
                              ))}
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground">Bạn có thể gõ một phần tên để tìm kiếm nếu đã lấy danh sách chat.</p>
                      </div>

                      <div className="flex justify-end gap-2 pt-2">
                        <button
                          type="button"
                          onClick={() => setIsGroupManagerOpen(false)}
                          className="px-4 py-2 text-sm font-medium rounded-md hover:bg-muted transition-colors"
                        >
                          Hủy
                        </button>
                        <button
                          type="button"
                          onClick={handleAddGroup}
                          disabled={!newGroupName.trim()}
                          className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
                        >
                          Thêm nhóm
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
                      className={`flex-1 text-left px-2.5 py-1.5 text-[11px] font-medium rounded-lg transition-all flex items-center gap-2 truncate ${
                        selectedChatGroup === group.name
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        group.type === "customer" ? "bg-orange-500" : "bg-blue-500"
                      }`} />
                      <span className="truncate">{group.name}</span>
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
                    {group.url && (
                      <a
                        href={group.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="p-1 text-muted-foreground/30 hover:text-primary opacity-0 group-hover:opacity-100 transition-all shrink-0"
                        title={`Mở "${group.name}" trong browser`}
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={async () => {
                        if (isSyncing) return;
                        setIsSyncing(true);
                        try {
                          // Clear old messages for this group only
                          await cmx.clearProjectMessages(project._id, group.name);
                          // Start sync for this specific group
                          await fetch("/api/agents/sync-single-chat", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              projectId: project._id,
                              chatName: group.name,
                              platform: group.platform || "teams",
                              headless: localStorage.getItem("headlessMode") !== "false",
                            }),
                          });
                        } catch (err) {
                          console.error("Sync failed:", err);
                        } finally {
                          setIsSyncing(false);
                        }
                      }}
                      disabled={isSyncing}
                      className="p-1 text-muted-foreground/30 hover:text-primary opacity-0 group-hover:opacity-100 transition-all shrink-0"
                      title="Đồng bộ nhóm này (xóa cũ + lấy mới)"
                    >
                      {isSyncing ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : "🔄"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveGroup(idx)}
                      className="p-1 text-muted-foreground/30 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all shrink-0"
                      title="Xóa nhóm"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                {activeTeamsGroups.length === 0 && (
                  <div className="text-[11px] text-muted-foreground italic px-1 py-2">
                    Chưa có nhóm nào
                  </div>
                )}
              </div>
              
              {/* Group Manager has been moved to a Dialog above */}
              
              {/* Sync buttons — each group has its own sync on hover */}
              <div className="flex items-center gap-1.5 pt-2 border-t border-border/30">
                <button
                  type="button"
                  onClick={() => fetchChats()}
                  disabled={fetchingChats}
                  className={`flex-1 text-[9px] px-1.5 py-1 rounded border transition-all flex items-center justify-center gap-1 cursor-pointer ${
                    fetchingChats
                      ? "bg-muted text-muted-foreground border-border/50"
                      : "bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-500/30 hover:bg-purple-500/20"
                  }`}
                >
                  {fetchingChats ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : "🔄"}
                  <span>Tải nhóm</span>
                </button>
              </div>
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
                      syncLogs.map((log: any) => {
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
                  {projectChats?.filter((m: any) => m.chatName === selectedChatGroup)?.length || 0
                  } tin nhắn
                </span>
                <div className="relative ml-auto w-40">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/60 pointer-events-none" />
                  <input
                    type="text"
                    value={chatSearch}
                    onChange={(e) => setChatSearch(e.target.value)}
                    placeholder="Tìm tin nhắn..."
                    className="w-full pl-7 pr-6 py-1 text-[11px] rounded-lg bg-muted/50 border border-border/50 outline-none focus:border-primary/40 placeholder:text-muted-foreground/40"
                  />
                  {chatSearch && (
                    <button
                      type="button"
                      onClick={() => setChatSearch("")}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground transition-colors"
                      title="Xoá tìm kiếm"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
                <div className="ml-auto flex items-center gap-1">
                  {selectedChatGroup && (() => {
                    const group = activeTeamsGroups.find(g => g.name === selectedChatGroup);
                    const isZalo = group?.platform === "zalo";
                    // Use the captured deep link when available; fall back to the platform homepage
                    const appUrl = group?.url || (isZalo ? "https://chat.zalo.me/" : "https://teams.microsoft.com/");
                    const platformName = isZalo ? "Zalo" : "Teams";
                    return (
                      <a
                        href={appUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={group?.url ? `Mở "${selectedChatGroup}" trên ${platformName}` : `Mở trang ${platformName}`}
                        className="p-1.5 mr-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors flex items-center justify-center"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    );
                  })()}
                  <button
                    type="button"
                    onClick={async () => {
                      if (!selectedChatGroup) return;
                      if (!window.confirm(`Xóa dữ liệu chat của nhóm "${selectedChatGroup}" và đồng bộ lại?`)) return;
                      setIsClearing(true);
                      try {
                        await cmx.clearProjectMessages(project._id, selectedChatGroup);
                        // Trigger a re-sync for this specific group
                        fetch("/api/agents/sync-single-chat", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            projectId: project._id,
                            chatName: selectedChatGroup,
                            platform: activeTeamsGroups.find(g => g.name === selectedChatGroup)?.platform || "teams",
                            headless: localStorage.getItem("headlessMode") !== "false",
                          }),
                        }).catch(console.error);
                      } catch (err) {
                        console.error("Failed to clear messages:", err);
                      } finally {
                        setIsClearing(false);
                      }
                    }}
                    disabled={isClearing || !selectedChatGroup}
                    className="text-[9px] px-1.5 py-1 rounded border transition-all flex items-center gap-1 cursor-pointer bg-red-500/10 text-red-600 dark:text-red-400 border-red-200 dark:border-red-500/30 hover:bg-red-500/20 disabled:opacity-50"
                    title={selectedChatGroup ? `Xóa dữ liệu chat của "${selectedChatGroup}" và đồng bộ lại` : "Chọn nhóm chat trước"}
                  >
                    {isClearing ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Trash2 className="w-2.5 h-2.5" />}
                    <span className="hidden sm:inline">Xóa & đ.bộ lại</span>
                  </button>
                </div>
              </div>
              
              {/* Messages Area */}
              <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar flex flex-col pb-4 pr-2">
              {projectChats?.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
                  <span className="text-[12px]">Chưa có tin nhắn nào.</span>
                </div>
              ) : (
                (() => {
                  const q = chatSearch.trim().toLowerCase();
                  let chatMessages = projectChats.filter((m: any) => m.chatName === selectedChatGroup);
                  if (q) {
                    chatMessages = chatMessages.filter((m: any) =>
                      (m.sender || "").toLowerCase().includes(q) ||
                      (m.content || "").toLowerCase().includes(q) ||
                      (m.timestamp || "").toLowerCase().includes(q)
                    );
                  }
                  if (chatMessages.length === 0) {
                    return (
                      <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
                        <Search className="w-5 h-5 mb-2 opacity-30" />
                        <span className="text-[12px]">
                          {q ? `Không tìm thấy tin nhắn nào khớp "${chatSearch.trim()}"` : "Chưa có tin nhắn nào."}
                        </span>
                      </div>
                    );
                  }
                  return chatMessages.map((msg: any, idx: number) => {
                    const prev = idx > 0 ? chatMessages[idx - 1] : undefined;
                    const next = idx < chatMessages.length - 1 ? chatMessages[idx + 1] : undefined;
                    
                    const isFirstInGroup = !prev || prev.sender !== msg.sender;
                    const isLastInGroup = !next || next.sender !== msg.sender;
                    
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
                        {/* Avatar */}
                        {isFirstInGroup ? (
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
                  });
                })()
              )}
            </div>
            {/* ── Zalo Send Composer ── */}
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
                          if (selectedChatGroup && sendMessage.trim()) handleSendZalo(selectedChatGroup, sendMessage);
                        }
                      }}
                      placeholder={
                        !selectedChatGroup
                          ? "Chọn một nhóm chat để gửi tin nhắn..."
                          : isZaloChat
                            ? "Soạn tin nhắn, nhấn Enter để gửi tới Zalo..."
                            : "Chỉ nhóm Zalo mới có thể gửi tin từ đây..."
                      }
                      disabled={!selectedChatGroup || !isZaloChat || sending}
                      rows={2}
                      maxLength={2000}
                      className="w-full text-[12px] resize-none rounded-lg bg-muted/50 border border-border/50 outline-none focus:border-primary/40 placeholder:text-muted-foreground/40 px-3 py-2 disabled:opacity-50"
                    />
                    <button
                      type="button"
                      onClick={() => { const g = sendGroup; if (g && sendMessage) handleSendZalo(g.name, sendMessage); }}
                      disabled={!selectedChatGroup || !sendMessage.trim() || sending || !isZaloChat}
                      className="self-end p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                      title={isZaloChat ? "Gửi tin nhắn Zalo" : "Chỉ hỗ trợ gửi trên nhóm Zalo"}
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
          <div className="flex flex-col gap-2 max-h-[500px] overflow-y-auto custom-scrollbar">
            {/* Header */}
            <div className="flex items-center justify-between shrink-0 border-b border-border/40 pb-2 mb-1">
              <div className="flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-primary" />
                <span className="text-[12px] font-semibold text-foreground/90">
                  Gợi ý hành động
                </span>
                <span className="text-[10px] text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded-full">
                  {projectSuggestions?.length || 0}
                </span>
              </div>
              <button
                type="button"
                onClick={runSuggestionAnalysis}
                disabled={analysingSuggestions}
                className={`text-[10px] px-2 py-1 rounded border transition-all flex items-center gap-1 cursor-pointer ${
                  analysingSuggestions
                    ? "bg-muted text-muted-foreground border-border/50"
                    : "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20"
                }`}
              >
                {analysingSuggestions ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                Phân tích
              </button>
            </div>

            {/* Error */}
            {suggestionsError && (
              <div className="p-2 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-[11px] text-red-700 dark:text-red-300">
                {suggestionsError}
              </div>
            )}

            {/* Suggestions List */}
            {projectSuggestions && projectSuggestions.length > 0 ? (
              <div className="space-y-1.5 pr-1">
                {projectSuggestions.map((s) => (
                  <div
                    key={s._id}
                    className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
                      s.isResolved
                        ? "bg-muted/20 border-border/20 opacity-60"
                        : !s.isRead
                          ? "bg-primary/5 border-primary/30 shadow-sm"
                          : s.type === "warning"
                            ? "bg-red-50/60 dark:bg-red-500/10 border-red-200 dark:border-red-500/30"
                            : s.type === "transfer_request"
                              ? "bg-blue-50/60 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/30"
                              : s.type === "mention"
                                ? "bg-amber-50/60 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/30"
                                : s.type === "deadline"
                                  ? "bg-orange-50/60 dark:bg-orange-500/10 border-orange-200 dark:border-orange-500/30"
                                  : s.type === "action_item"
                                    ? "bg-purple-50/60 dark:bg-purple-500/10 border-purple-200 dark:border-purple-500/30"
                                    : "bg-card/50 border-border/30"
                    }`}
                    onClick={() => {
                      if (!s.isRead) smx.markSuggestionAsRead(s._id);
                      setExpandedSuggestionId(expandedSuggestionId === s._id ? null : s._id);
                    }}
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex flex-col items-center gap-0.5 mt-0.5 shrink-0">
                        <div className={`w-2 h-2 rounded-full ${
                          !s.isRead ? "bg-primary animate-pulse" : "bg-muted-foreground/30"
                        }`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${
                            s.type === "warning" ? "bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300"
                              : s.type === "transfer_request" ? "bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300"
                              : s.type === "mention" ? "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300"
                              : s.type === "deadline" ? "bg-orange-100 dark:bg-orange-500/20 text-orange-700 dark:text-orange-300"
                              : s.type === "action_item" ? "bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300"
                              : "bg-slate-100 dark:bg-slate-500/20 text-slate-700 dark:text-slate-300"
                          }`}>
                            {s.type === "transfer_request" ? "Bàn giao"
                              : s.type === "mention" ? "Đề cập"
                              : s.type === "action_item" ? "Hành động"
                              : s.type === "deadline" ? "Hạn chót"
                              : s.type === "warning" ? "Cảnh báo"
                              : "Thông tin"}
                          </span>
                          <span className="text-[11px] font-semibold text-foreground">{s.title}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{s.description}</p>

                        {/* Source info */}
                        {(s.sourceSender || s.sourceChatName) && (
                          <div className="flex items-center gap-2 mt-1.5">
                            {s.sourceSender && (
                              <span className="text-[9px] text-muted-foreground/60 bg-muted/40 px-1.5 py-0.5 rounded">
                                {s.sourceSender}
                              </span>
                            )}
                            {s.sourceChatName && (
                              <span className="text-[9px] text-muted-foreground/60 bg-muted/40 px-1.5 py-0.5 rounded">
                                {s.sourceChatName}
                              </span>
                            )}
                          </div>
                        )}

                        {/* Reason details (input / reasoning / expected outcome) */}
                        {(() => {
                          let reason: { input?: string; reasoning?: string; expectedOutcome?: string } = {};
                          try {
                            if (s.suggestionData) {
                              const parsed = JSON.parse(s.suggestionData);
                              reason = {
                                input: parsed?.input,
                                reasoning: parsed?.reasoning,
                                expectedOutcome: parsed?.expectedOutcome,
                              };
                            }
                          } catch { /* ignore malformed data */ }
                          const hasReason = Boolean(reason.input || reason.reasoning || reason.expectedOutcome);
                          const expanded = expandedSuggestionId === s._id;
                          return (
                            <div className="mt-1.5">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedSuggestionId(expanded ? null : s._id);
                                }}
                                className={`inline-flex items-center gap-1 text-[9px] px-2 py-0.5 rounded-md border transition-colors cursor-pointer ${
                                  expanded
                                    ? "bg-primary/10 text-primary border-primary/30"
                                    : "bg-muted/30 text-muted-foreground border-border/40 hover:bg-muted/50 hover:text-foreground"
                                }`}
                              >
                                <BrainCircuit className="w-2.5 h-2.5" />
                                {expanded ? "Thu gọn" : "Xem nguyên nhân"}
                                <ChevronDown className={`w-2.5 h-2.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
                              </button>
                              {expanded && (
                                <div className="mt-1.5 space-y-1.5 rounded-lg border border-border/30 bg-background/60 dark:bg-zinc-900/60 p-2">
                                  {reason.input && (
                                    <div className="flex gap-1.5">
                                      <Quote className="w-3 h-3 text-blue-500 shrink-0 mt-0.5" />
                                      <div className="min-w-0">
                                        <p className="text-[8px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wide">Input</p>
                                        <p className="text-[10px] text-muted-foreground dark:text-zinc-400 leading-relaxed whitespace-pre-wrap">{reason.input}</p>
                                      </div>
                                    </div>
                                  )}
                                  {reason.reasoning && (
                                    <div className="flex gap-1.5">
                                      <BrainCircuit className="w-3 h-3 text-purple-500 shrink-0 mt-0.5" />
                                      <div className="min-w-0">
                                        <p className="text-[8px] font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wide">Suy luận</p>
                                        <p className="text-[10px] text-muted-foreground dark:text-zinc-400 leading-relaxed whitespace-pre-wrap">{reason.reasoning}</p>
                                      </div>
                                    </div>
                                  )}
                                  {reason.expectedOutcome && (
                                    <div className="flex gap-1.5">
                                      <Target className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />
                                      <div className="min-w-0">
                                        <p className="text-[8px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">Kết quả mong muốn</p>
                                        <p className="text-[10px] text-muted-foreground dark:text-zinc-400 leading-relaxed whitespace-pre-wrap">{reason.expectedOutcome}</p>
                                      </div>
                                    </div>
                                  )}
                                  {!hasReason && s.sourceMessage && (
                                    <div className="flex gap-1.5">
                                      <Quote className="w-3 h-3 text-blue-500 shrink-0 mt-0.5" />
                                      <div className="min-w-0">
                                        <p className="text-[8px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wide">Tin nhắn gốc</p>
                                        <p className="text-[10px] text-muted-foreground dark:text-zinc-400 leading-relaxed whitespace-pre-wrap">{s.sourceMessage}</p>
                                      </div>
                                    </div>
                                  )}
                                  {!hasReason && !s.sourceMessage && (
                                    <div className="flex gap-1.5">
                                      <Quote className="w-3 h-3 text-blue-500 shrink-0 mt-0.5" />
                                      <div className="min-w-0">
                                        <p className="text-[8px] font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wide">Nguyên nhân</p>
                                        <p className="text-[10px] text-muted-foreground dark:text-zinc-400 leading-relaxed whitespace-pre-wrap">{s.description}</p>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {/* Actions */}
                        <div className="flex items-center gap-1.5 mt-2">
                          {!s.isRead && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                smx.markSuggestionAsRead(s._id);
                              }}
                              className="text-[9px] px-2 py-1 rounded-md bg-muted text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
                            >
                              Đã đọc
                            </button>
                          )}
                          {!s.isResolved && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                smx.markSuggestionAsResolved(s._id);
                              }}
                              className="text-[9px] px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30 hover:bg-emerald-500/20 transition-colors cursor-pointer"
                            >
                              Đã xử lý
                            </button>
                          )}
                          {s.actionLabel && s.actionUrl && (
                            <a
                              href={s.actionUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[9px] px-2 py-1 rounded-md bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors cursor-pointer"
                            >
                              {s.actionLabel}
                            </a>
                          )}
                          {/* Thêm vào tasklist */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAddSuggestionTask(s);
                            }}
                            disabled={addingTaskId !== null}
                            className="text-[9px] px-2 py-1 rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30 hover:bg-indigo-500/20 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
                            title="Thêm gợi ý này vào danh sách công việc"
                          >
                            {addingTaskId === s._id ? (
                              <><Loader2 className="w-2.5 h-2.5 animate-spin" /> Đang thêm...</>
                            ) : taskAddedId === s._id ? (
                              <><CheckCircle2 className="w-2.5 h-2.5" /> Đã thêm task</>
                            ) : (
                              <><ListPlus className="w-2.5 h-2.5" /> Thêm task</>
                            )}
                          </button>
                          {/* Nhắn tới kênh (Teams/Zalo) */}
                          <div className="relative inline-flex">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setChannelMenuId(channelMenuId === s._id ? null : s._id);
                              }}
                              disabled={sendingChannelId !== null}
                              className="text-[9px] px-2 py-1 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-500/30 hover:bg-blue-500/20 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
                              title="Gửi tin nhắn tới kênh nội bộ Teams/Zalo liên quan"
                            >
                              {sendingChannelId === s._id ? (
                                <><Loader2 className="w-2.5 h-2.5 animate-spin" /> Đang gửi...</>
                              ) : (
                                <><MessagesSquare className="w-2.5 h-2.5" /> Nhắn kênh</>
                              )}
                            </button>
                            {channelMenuId === s._id && (
                              <div
                                className="absolute bottom-full right-0 mb-1 w-56 rounded-xl border border-border/60 bg-background dark:bg-zinc-900 shadow-xl z-50 p-1 text-left"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <p className="px-2 py-1 text-[9px] font-semibold text-muted-foreground/60 uppercase">
                                  Chọn kênh gửi
                                </p>
                                {getSuggestionChannels(s).length === 0 && (
                                  <p className="px-2 py-1.5 text-[10px] text-muted-foreground/50">
                                    Không có kênh liên quan
                                  </p>
                                )}
                                {getSuggestionChannels(s).map((ch) => (
                                  <button
                                    key={ch.name + ch.platform}
                                    type="button"
                                    onClick={() => handleSendSuggestionToChannel(s, ch)}
                                    disabled={sendingChannelId !== null}
                                    className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted/60 transition-colors cursor-pointer text-[11px] text-foreground disabled:opacity-50"
                                  >
                                    <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-semibold ${
                                      ch.platform === "zalo"
                                        ? "bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-500/30"
                                        : "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-500/30"
                                    }`}>
                                      {ch.platform === "zalo" ? "Zalo" : "Teams"}
                                    </span>
                                    <span className="flex-1 truncate">{ch.name}</span>
                                    <span className="text-[8px] text-muted-foreground/50 shrink-0">{ch.tag}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          {/* Kết quả gửi / lỗi */}
                          {(sendChannelError || sendChannelOk || taskError) && (
                            <span className={`text-[9px] ml-1 flex items-center gap-1 ${
                              (sendChannelError || taskError) ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
                            }`}>
                              {sendChannelError || taskError
                                ? <AlertTriangle className="w-2.5 h-2.5" />
                                : <CheckCircle2 className="w-2.5 h-2.5" />}
                              {sendChannelError || taskError || `Đã gửi tới "${sendChannelOk}"`}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-center p-4">
                {analysingSuggestions ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin text-primary/60 mb-2" />
                    <span className="text-[11px]">Đang phân tích tin nhắn...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5 text-muted-foreground/30 mb-2" />
                    <span className="text-[11px]">Chưa có gợi ý nào</span>
                    <span className="text-[10px] text-muted-foreground/50 mt-1">
                      Nhấn "Phân tích" để AI gợi ý hành động từ tin nhắn Teams
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
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
                  projectId={project._id as any}
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
