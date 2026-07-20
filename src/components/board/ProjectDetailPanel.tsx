"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useAuth } from "@clerk/nextjs";
import { ListTodo, FileText, BarChart3, Copy, Check, StickyNote, Plus, ChevronRight, Trash2, X } from "lucide-react";
import { format } from "date-fns";
import type { Doc } from "../../../convex/_generated/dataModel";
import { WysiwygEditor } from "./WysiwygEditor";

const DEFAULT_NOTES = `## Thông tin chung

Mô tả tổng quan về dự án, mục tiêu, phạm vi...

## Link liên quan

- Tên link - https://example.com

## Ghi chú

Các ghi chú, lưu ý, thông tin bổ sung...
`;

interface ProjectDetailPanelProps {
  project: {
    _id: string;
    name: string;
    color?: string;
    notes?: string | null;
  };
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

export function ProjectDetailPanel({ project }: ProjectDetailPanelProps) {
  const { userId } = useAuth();
  const [tab, setTab] = useState<"info" | "notes" | "summary" | "history">("info");
  const [editorContent, setEditorContent] = useState(project.notes || DEFAULT_NOTES);

  const [copied, setCopied] = useState(false);

  const updateProjectDetail = useMutation(api.projects.updateProjectDetail);
  const generateUploadUrl = useMutation(api.storage.generateUploadUrl);
  const getImageUrl = useMutation(api.storage.getImageUrl);

  // Auto-save with debounce
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const doSave = useCallback(async (content: string) => {
    if (!userId) return;
    try {
      await updateProjectDetail({
        id: project._id as any,
        notes: content || undefined,
      });
    } catch (err) {
      console.error(err);
    }
  }, [userId, project._id, updateProjectDetail]);

  // Debounced auto-save when editorContent changes
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      doSave(editorContent);
    }, 800);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [editorContent, doSave]);

  // Fetch tasks for history
  const projectTasks =
    useQuery(api.tasks.getTasksByProject, { projectId: project._id as any }) ?? [];

  // Fetch notes for this project
  const projectNotes =
    useQuery(api.notes.getNotesByProject, { projectId: project._id as any }) ?? [];

  const createNote = useMutation(api.notes.createNote);
  const updateNote = useMutation(api.notes.updateNote);
  const deleteNote = useMutation(api.notes.deleteNote);

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
      await createNote({
        userId,
        title: newNoteTitle.trim(),
        projectId: project._id as any,
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
      await updateNote({
        id: editingNoteId as any,
        title: editingNoteTitle,
        content: editingNoteContent || undefined,
      });
    } catch (err) {
      console.error(err);
    }
  }, [editingNoteId, editingNoteTitle, editingNoteContent, updateNote]);

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
      await deleteNote({ id: noteId as any });
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
    const uploadUrl = await generateUploadUrl();
    const result = await fetch(uploadUrl, {
      method: "POST",
      body: file,
    });
    if (!result.ok) {
      const errorText = await result.text();
      console.error("Upload failed:", result.status, errorText);
      throw new Error("Upload failed");
    }
    const { storageId } = await result.json();
    const url = await getImageUrl({ storageId });
    if (!url) throw new Error("Failed to get image URL");
    return url;
  }, [generateUploadUrl, getImageUrl]);

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

  return (
    <div className="border border-border/50 rounded-xl bg-card/50 backdrop-blur-sm overflow-hidden shadow-inner">
      {/* Tabs */}
      <div className="flex items-center gap-1 px-2 pt-2 pb-0 border-b border-border/30">
        <button
          type="button"
          onClick={() => setTab("info")}
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
          onClick={() => setTab("summary")}
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
          onClick={() => setTab("history")}
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
          onClick={() => setTab("notes")}
          className={`px-3 py-1.5 text-[11px] font-semibold rounded-t-lg transition-all cursor-pointer flex items-center gap-1 ${
            tab === "notes"
              ? "bg-background text-foreground border border-border/60 border-b-background -mb-px shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
          }`}
        >
          <StickyNote className="w-3 h-3" />
          Ghi chú ({projectNotes.length})
        </button>
      </div>

      {/* Tab Content */}
      <div className="p-3">
        {tab === "info" ? (
          <div className="space-y-2">
            {/* WYSIWYG Editor */}
            <div className="relative min-h-[240px] border border-border/50 rounded-lg overflow-hidden">
              <WysiwygEditor
                key={project._id}
                content={editorContent}
                onChange={(html) => setEditorContent(html)}
                onImageUpload={handleImageUpload}
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
        ) : (
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
        )}
      </div>
    </div>
  );
}
