"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useAuth } from "@clerk/nextjs";
import { FileText, Plus, ChevronRight, Trash2, X, StickyNote, Users, Save, ListTodo, Check, FileSpreadsheet } from "lucide-react";
import { format } from "date-fns";
import { WysiwygEditor } from "./WysiwygEditor";
import { TaskListImportPanel } from "./TaskListImportPanel";
import type { Doc } from "@/lib/types";
import { CAPABILITY_CATALOG, resolveMemberCapabilities, type RoleCapability } from "@/lib/roleCapabilities";
import {
  useMembersByProject,
  useMemberMutations,
  useRoles,
  useTasksByProject,
  useNotesByProject,
  useNoteMutations,
  useProjectMutations,
  useUploadFile,
} from "@/hooks/useDomain";

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
  };
  tab?: "info" | "notes" | "members" | "import-tasks";
  onTabChange?: (tab: "info" | "notes" | "members" | "import-tasks") => void;
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

// ─── NoteItem ────────────────────────────────────────────────

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
    <div className="border border-border/30 rounded-xl bg-card/40 hover:bg-muted/10 transition-colors">
      <div className="flex items-start gap-2 p-2">
        {/* Expand/collapse */}
        <button
          type="button"
          onClick={() => toggleNoteExpand(note._id)}
          className={`mt-0.5 p-0.5 rounded shrink-0 transition-all cursor-pointer ${
            hasChildren ? "opacity-100 hover:bg-muted/50" : "opacity-0"
          }`}
        >
          <ChevronRight className={`w-3 h-3 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`} />
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <div className="space-y-1.5">
              <input
                type="text"
                value={editingNoteTitle}
                onChange={(e) => setEditingNoteTitle(e.target.value)}
                className="w-full text-xs font-semibold bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground"
                placeholder="Tiêu đề..."
                autoFocus
              />
              <textarea
                value={editingNoteContent}
                onChange={(e) => setEditingNoteContent(e.target.value)}
                className="w-full text-[10px] bg-muted/30 border border-border/40 rounded-lg p-1.5 min-h-[60px] outline-none text-foreground placeholder:text-muted-foreground resize-none"
                placeholder="Nội dung..."
              />
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={cancelEditNote}
                  className="text-[10px] px-2 py-1 rounded-md text-muted-foreground hover:text-foreground border border-border/40 hover:bg-muted/30 transition-colors cursor-pointer"
                >
                  Huỷ
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-foreground truncate">{note.title}</span>
                <span className="text-[9px] text-muted-foreground/50 ml-auto shrink-0">
                  {note.createdAt ? format(new Date(note.createdAt), "dd/MM") : ""}
                </span>
              </div>
              {contentPreview && (
                <p className="text-[9px] text-muted-foreground/70 mt-0.5 line-clamp-2 leading-relaxed">
                  {contentPreview}
                </p>
              )}
              <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={() => startEditNote(note)}
                  className="text-[9px] px-1.5 py-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
                >
                  Sửa
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteNote(note._id)}
                  className="text-[9px] px-1.5 py-0.5 rounded text-red-500 hover:text-red-600 hover:bg-red-500/10 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-2.5 h-2.5" />
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Children */}
      {isExpanded && hasChildren && (
        <div className="pl-4 pb-1 space-y-1">
          {childNotes.map((child) => (
            <NoteItem
              key={child._id}
              note={child}
              depth={depth + 1}
              childNotes={getChildNotes(child._id)}
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
          ))}
        </div>
      )}
    </div>
  );
}

// ─── MemberCard ──────────────────────────────────────────────

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
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0"
        style={{ backgroundColor: avatarColor + "20", color: avatarColor }}
      >
        {initials}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-foreground truncate">{member.name}</span>
          {hasPermissionOverride && (
            <span className="text-[8px] px-1 py-0.5 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400 font-medium shrink-0">
              Ghi đè
            </span>
          )}
        </div>
        {member.email && (
          <p className="text-[9px] text-muted-foreground/70 truncate">{member.email}</p>
        )}

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
              <span className="text-[8px] text-muted-foreground/50">Chưa có chức năng nào</span>
            )}
            {enabledCaps.length > 4 && (
              <span className="text-[8px] text-muted-foreground/60 px-1">+{enabledCaps.length - 4} nữa</span>
            )}
          </div>
        )}

        {editing && editPermissions !== null && editRoleId && (
          <div className="mt-2 space-y-0.5 rounded-lg border border-border/40 bg-background/60 p-1.5 max-h-32 overflow-y-auto">
            <p className="text-[8px] font-semibold text-muted-foreground mb-1 flex items-center gap-1">
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
                      (prev || []).map((p) => (p.key === c.key ? { ...p, enabled: !enabled } : p))
                    )
                  }
                  className={`w-full flex items-center gap-1.5 px-1.5 py-0.5 text-left transition-colors cursor-pointer rounded ${
                    enabled ? "bg-primary/5" : "hover:bg-muted/40"
                  }`}
                >
                  <span
                    className={`w-2.5 h-2.5 rounded border flex items-center justify-center shrink-0 ${
                      enabled ? "bg-emerald-500 border-emerald-500 text-white" : "border-border bg-transparent"
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
          </div>
        )}

        {editing ? (
          <div className="flex items-center gap-1 mt-2">
            <select
              value={editRoleId}
              onChange={(e) => {
                const newRoleId = e.target.value;
                setEditRoleId(newRoleId);
                if (newRoleId) {
                  const role = roles.find((r) => r._id === newRoleId);
                  const defaultCaps = role ? resolveMemberCapabilities(role, null) : [];
                  setEditPermissions(
                    CAPABILITY_CATALOG.map((c) => {
                      const existing = Array.isArray(member.permissions)
                        ? member.permissions.find((p: any) => p.key === c.key)
                        : undefined;
                      if (existing !== undefined) return existing;
                      const roleDefault = defaultCaps.find((dc) => dc.key === c.key);
                      return { ...c, enabled: roleDefault?.enabled ?? false };
                    })
                  );
                } else {
                  setEditPermissions(CAPABILITY_CATALOG.map((c) => ({ ...c, enabled: false })));
                }
              }}
              className="flex-1 h-6 text-[10px] rounded-lg bg-background/80 border border-border/50 text-foreground outline-none focus:border-primary/50 px-1"
            >
              <option value="">Chọn vai trò...</option>
              {roles.map((role) => (
                <option key={role._id} value={role._id}>
                  {role.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleSaveRole}
              className="px-2 py-1 text-[9px] rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer shrink-0"
            >
              <Save className="w-2.5 h-2.5" />
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="px-2 py-1 text-[9px] rounded-md text-muted-foreground hover:text-foreground border border-border/40 hover:bg-muted/30 transition-colors cursor-pointer shrink-0"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={() => {
                setEditRoleId(member.roleId || "");
                setEditPermissions(
                  Array.isArray(member.permissions) && member.permissions.length > 0
                    ? CAPABILITY_CATALOG.map((c) => {
                        const existing = member.permissions.find((p: any) => p.key === c.key);
                        return existing ?? { ...c, enabled: false };
                      })
                    : null
                );
                setEditing(true);
              }}
              className="text-[9px] px-1.5 py-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
            >
              Sửa
            </button>
            {confirmDelete ? (
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-red-500">Xoá?</span>
                <button
                  type="button"
                  onClick={handleRemove}
                  disabled={removing}
                  className="text-[9px] px-1.5 py-0.5 rounded bg-red-500 text-white hover:bg-red-600 transition-colors cursor-pointer disabled:opacity-50"
                >
                  {removing ? "..." : "Có"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="text-[9px] px-1.5 py-0.5 rounded text-muted-foreground hover:text-foreground border border-border/40 hover:bg-muted/30 transition-colors cursor-pointer"
                >
                  Không
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="text-[9px] px-1.5 py-0.5 rounded text-red-500 hover:text-red-600 hover:bg-red-500/10 transition-colors cursor-pointer"
              >
                <Trash2 className="w-2.5 h-2.5" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────

export function ProjectDetailPanel({ project, tab: propTab, onTabChange: propOnTabChange }: ProjectDetailPanelProps) {
  const { userId } = useAuth();
  const [localTab, setLocalTab] = useState<"info" | "notes" | "members" | "import-tasks">("info");
  const tab = propTab ?? localTab;
  const handleTabChange = propOnTabChange ?? setLocalTab;

  // ─── Data hooks ──────────────────────────────────────
  const { data: projectTasksData } = useTasksByProject(project._id ?? null);
  const projectTasks = projectTasksData ?? [];

  const { data: projectNotesData } = useNotesByProject(project._id ?? null);
  const projectNotes = projectNotesData ?? [];

  const { data: projectMembers } = useMembersByProject(project._id ?? null);
  const { data: projectRolesList } = useRoles(userId);
  const mmx = useMemberMutations();

  const nmx = useNoteMutations();
  const pm = useProjectMutations();
  const uploadFile = useUploadFile();

  // ─── Editor state ────────────────────────────────────
  const [editorContent, setEditorContent] = useState(() => {
    if (!project.notes) return DEFAULT_NOTES;
    return project.notes;
  });

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

  useEffect(() => {
    if (!hasUserEditedRef.current) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSave(editorContent), 800);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [editorContent, doSave]);

  // ─── Notes state ─────────────────────────────────────
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteContent, setEditingNoteContent] = useState("");
  const [editingNoteTitle, setEditingNoteTitle] = useState("");
  const [creatingNote, setCreatingNote] = useState(false);
  const [newNoteTitle, setNewNoteTitle] = useState("");
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());
  const noteDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const noteTree = useMemo(() => {
    return projectNotes
      .filter((n) => !n.parentNoteId)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
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
      await nmx.createNote({ userId, title: newNoteTitle.trim(), projectId: project._id });
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

  useEffect(() => {
    if (!editingNoteId) return;
    if (noteDebounceRef.current) clearTimeout(noteDebounceRef.current);
    noteDebounceRef.current = setTimeout(() => saveNote(), 800);
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

  // ─── Members state ───────────────────────────────────
  const [showAddMember, setShowAddMember] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");
  const [newMemberEmail, setNewMemberEmail] = useState("");
  const [newMemberRoleId, setNewMemberRoleId] = useState<string | null>(null);

  // ─── Image upload ────────────────────────────────────
  const handleImageUpload = useCallback(async (file: File): Promise<string> => {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const dataUrl = reader.result as string;
          const res = await fetch("/api/data/files", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              userId,
              dataUrl,
              name: file.name,
              mimeType: file.type || undefined,
            }),
          });
          if (!res.ok) throw new Error("Upload failed");
          const data = await res.json();
          if (!data.url) throw new Error("Failed to get image URL");
          resolve(data.url);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error("FileReader failed"));
      reader.readAsDataURL(file);
    });
  }, [userId]);

  // ─── Stats ───────────────────────────────────────────
  const stats = useMemo(() => {
    const total = projectTasks.length;
    const done = projectTasks.filter((t) => t.status === "done").length;
    const processing = projectTasks.filter((t) => t.status === "processing").length;
    const pending = projectTasks.filter((t) => t.status === "pending").length;
    const todo = projectTasks.filter((t) => !t.status || t.status === "todo").length;
    return { total, done, processing, pending, todo };
  }, [projectTasks]);

  // ─── Render ──────────────────────────────────────────
  return (
    <div className="border border-border/50 rounded-xl bg-card/50 backdrop-blur-sm shadow-inner overflow-hidden">
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
          onClick={() => handleTabChange("members")}
          className={`px-3 py-1.5 text-[11px] font-semibold rounded-t-lg transition-all cursor-pointer flex items-center gap-1 ${
            tab === "members"
              ? "bg-background text-foreground border border-border/60 border-b-background -mb-px shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
          }`}
        >
          <Users className="w-3 h-3" />
          Thành viên ({projectMembers?.length ?? 0})
        </button>
        <button
          type="button"
          onClick={() => handleTabChange("import-tasks")}
          className={`px-3 py-1.5 text-[11px] font-semibold rounded-t-lg transition-all cursor-pointer flex items-center gap-1 ${
            tab === "import-tasks"
              ? "bg-background text-foreground border border-border/60 border-b-background -mb-px shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
          }`}
        >
          <FileSpreadsheet className="w-3 h-3" />
          Import task
        </button>
      </div>

      {/* Tab Content */}
      <div className={`p-3 ${tab === "import-tasks" ? "flex-1 min-h-0 flex flex-col" : ""}`}>
        {tab === "info" ? (
          <div className="space-y-1.5">
            {/* Stats summary */}
            <div className="flex items-center gap-3 p-2 rounded-lg bg-muted/20 border border-border/30">
              <span className="text-[10px] text-muted-foreground">
                Tổng: <strong className="text-foreground">{stats.total}</strong>
              </span>
              <span className="text-[10px] text-muted-foreground">
                Đã xong: <strong className="text-emerald-500">{stats.done}</strong>
              </span>
              <span className="text-[10px] text-muted-foreground">
                Đang XL: <strong className="text-blue-500">{stats.processing}</strong>
              </span>
              <span className="text-[10px] text-muted-foreground">
                Tạm dừng: <strong className="text-amber-500">{stats.pending}</strong>
              </span>
              <span className="text-[10px] text-muted-foreground">
                Chưa TH: <strong className="text-neutral-500">{stats.todo}</strong>
              </span>
            </div>

            {/* WYSIWYG Editor */}
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

            {/* Import task list */}
            <button
              type="button"
              onClick={() => handleTabChange("import-tasks")}
              className="w-full flex items-center justify-center gap-1.5 p-2 text-[11px] text-muted-foreground hover:text-foreground border border-dashed border-border/60 hover:border-emerald-500/40 rounded-lg hover:bg-emerald-500/5 transition-all cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />
              Import task list từ Excel (dán nội dung)
            </button>
          </div>
        ) : tab === "import-tasks" ? (
          <div className="flex-1 h-full min-h-0">
            <TaskListImportPanel
              onClose={() => handleTabChange("info")}
              projectId={project._id}
              projectName={project.name}
            />
          </div>
        ) : tab === "notes" ? (
          <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1">
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
        ) : tab === "members" ? (
          <div className="space-y-2 max-h-[440px] overflow-y-auto pr-1">
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
                    {(projectRolesList || []).map((role: any) => (
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
                          ? projectRolesList.find((r: any) => r._id === newMemberRoleId)
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

            {!projectMembers ? (
              <div className="flex items-center justify-center h-32">
                <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              </div>
            ) : projectMembers.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-center p-4">
                <Users className="w-6 h-6 text-muted-foreground/30 mb-2" />
                <span className="text-[11px]">Chưa có thành viên nào</span>
                <span className="text-[10px] text-muted-foreground/50 mt-1">Thêm member từ nút ở trên</span>
              </div>
            ) : (
              <div className="space-y-1">
                {projectMembers.map((member: any) => {
                  const memberRoleColor = member.roleId
                    ? (projectRolesList || []).find((r: any) => r._id === member.roleId)?.color
                    : undefined;
                  return (
                    <MemberCard
                      key={member._id}
                      member={member}
                      roles={projectRolesList || []}
                      roleColor={memberRoleColor}
                      onUpdate={async (id, data) => { await mmx.updateMember(id, data); }}
                      onRemove={async (id) => { await mmx.removeMember(id); }}
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