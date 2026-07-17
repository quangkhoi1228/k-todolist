"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useAuth } from "@clerk/nextjs";
import {
  FileText,
  ChevronRight,
  ChevronDown,
  Plus,
  MoreHorizontal,
  Trash2,
  Pencil,
  Check,
  X,
  FolderOpen,
  FilePlus,
  Folder,
} from "lucide-react";
import type { Doc } from "../../../convex/_generated/dataModel";

interface NoteTreeProps {
  selectedNoteId: string | null;
  onSelectNote: (noteId: string) => void;
}

type Note = Doc<"notes">;

function NoteIcon({ note }: { note: Note }) {
  const hasChildren = false; // computed below
  return (
    <span className="text-xs shrink-0">{note.icon || "📝"}</span>
  );
}

function TreeNode({
  note,
  allNotes,
  depth,
  selectedNoteId,
  onSelect,
  collapsed,
  onToggleCollapse,
  onAddChild,
  onRename,
  onDelete,
  editingId,
  editingTitle,
  setEditingId,
  setEditingTitle,
  onSaveTitle,
}: {
  note: Note;
  allNotes: Note[];
  depth: number;
  selectedNoteId: string | null;
  onSelect: (id: string) => void;
  collapsed: Set<string>;
  onToggleCollapse: (id: string) => void;
  onAddChild: (parentId: string) => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
  editingId: string | null;
  editingTitle: string;
  setEditingId: (id: string | null) => void;
  setEditingTitle: (title: string) => void;
  onSaveTitle: () => void;
}) {
  const children = useMemo(
    () => allNotes.filter((n) => n.parentNoteId === note._id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [allNotes, note._id]
  );
  const isCollapsed = collapsed.has(note._id);
  const isSelected = selectedNoteId === note._id;
  const isEditing = editingId === note._id;

  return (
    <div>
      <div
        className={`group flex items-center gap-1 px-2 py-1.5 rounded-lg cursor-pointer transition-all text-xs ${
          isSelected
            ? "bg-primary/15 text-primary font-semibold"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
        }`}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => {
          if (!isEditing) onSelect(note._id);
        }}
      >
        {/* Expand/collapse toggle */}
        {children.length > 0 ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse(note._id);
            }}
            className="p-0.5 rounded hover:bg-muted cursor-pointer shrink-0"
          >
            {isCollapsed ? (
              <ChevronRight className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}

        <NoteIcon note={note} />

        {isEditing ? (
          <div className="flex items-center gap-1 flex-1 min-w-0">
            <input
              value={editingTitle}
              onChange={(e) => setEditingTitle(e.target.value)}
              className="flex-1 min-w-0 bg-background border border-border rounded px-1 py-0.5 text-xs outline-none focus:ring-1 focus:ring-primary"
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") onSaveTitle();
                if (e.key === "Escape") setEditingId(null);
              }}
            />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSaveTitle();
              }}
              className="p-0.5 text-primary hover:text-primary/80 cursor-pointer"
            >
              <Check className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setEditingId(null);
              }}
              className="p-0.5 text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ) : (
          <>
            <span className="truncate flex-1">{note.title}</span>

            {/* Actions on hover */}
            <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onAddChild(note._id);
                }}
                className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                title="Thêm note con"
              >
                <Plus className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRename(note._id);
                }}
                className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
                title="Đổi tên"
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(note._id);
                }}
                className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-destructive cursor-pointer"
                title="Xoá"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </>
        )}
      </div>

      {/* Children */}
      {!isCollapsed && children.length > 0 && (
        <div>
          {children.map((child) => (
            <TreeNode
              key={child._id}
              note={child}
              allNotes={allNotes}
              depth={depth + 1}
              selectedNoteId={selectedNoteId}
              onSelect={onSelect}
              collapsed={collapsed}
              onToggleCollapse={onToggleCollapse}
              onAddChild={onAddChild}
              onRename={onRename}
              onDelete={onDelete}
              editingId={editingId}
              editingTitle={editingTitle}
              setEditingId={setEditingId}
              setEditingTitle={setEditingTitle}
              onSaveTitle={onSaveTitle}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function NoteTree({ selectedNoteId, onSelectNote }: NoteTreeProps) {
  const { userId } = useAuth();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [projectFilter, setProjectFilter] = useState<string | null>(null); // null = all, "unassigned" or projectId

  const allNotes = useQuery(api.notes.getNotes, userId ? { userId } : "skip");
  const projects = useQuery(api.projects.getProjects, userId ? { userId, includeArchived: true } : "skip");

  const createNote = useMutation(api.notes.createNote);
  const updateNote = useMutation(api.notes.updateNote);
  const deleteNoteMut = useMutation(api.notes.deleteNote);

  // Organize notes: root notes sorted by order
  const rootNotes = useMemo(
    () =>
      (allNotes ?? [])
        .filter((n) => !n.parentNoteId)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [allNotes]
  );

  // Group root notes by project
  const { projectNotes, unassignedNotes } = useMemo(() => {
    const byProject: Record<string, Note[]> = {};
    const unassigned: Note[] = [];
    for (const note of rootNotes) {
      if (note.projectId) {
        if (!byProject[note.projectId]) byProject[note.projectId] = [];
        byProject[note.projectId].push(note);
      } else {
        unassigned.push(note);
      }
    }
    return { projectNotes: byProject, unassignedNotes: unassigned };
  }, [rootNotes]);

  const getProjectName = useCallback(
    (projectId: string) => {
      return projects?.find((p) => p._id === projectId)?.name || "Không xác định";
    },
    [projects]
  );

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleAddChild = useCallback(
    async (parentId: string) => {
      if (!userId) return;
      const parent = allNotes?.find((n) => n._id === parentId);
      const newId = await createNote({
        userId,
        title: "Note mới",
        content: "",
        parentNoteId: parentId as any,
        projectId: parent?.projectId,
      });
      // Auto-expand parent
      setCollapsed((prev) => {
        const next = new Set(prev);
        next.delete(parentId);
        return next;
      });
      // Start editing the new note
      setEditingId(newId);
      setEditingTitle("Note mới");
      onSelectNote(newId);
    },
    [userId, allNotes, createNote, onSelectNote]
  );

  const handleCreateRootNote = useCallback(
    async (projectId?: string) => {
      if (!userId) return;
      const newId = await createNote({
        userId,
        title: "Note mới",
        content: "",
        projectId: projectId as any,
      });
      setEditingId(newId);
      setEditingTitle("Note mới");
      onSelectNote(newId);
    },
    [userId, createNote, onSelectNote]
  );

  const handleRename = useCallback((id: string) => {
    const note = allNotes?.find((n) => n._id === id);
    if (note) {
      setEditingId(id);
      setEditingTitle(note.title);
    }
  }, [allNotes]);

  const handleSaveTitle = useCallback(async () => {
    if (editingId && editingTitle.trim()) {
      await updateNote({ id: editingId as any, title: editingTitle.trim() });
    }
    setEditingId(null);
    setEditingTitle("");
  }, [editingId, editingTitle, updateNote]);

  const handleDelete = useCallback(
    async (id: string) => {
      if (confirm("Xoá note này và tất cả note con?")) {
        await deleteNoteMut({ id: id as any });
        if (selectedNoteId === id) {
          onSelectNote("");
        }
      }
    },
    [deleteNoteMut, selectedNoteId, onSelectNote]
  );

  // Filter notes if a project filter is active
  const filteredRootNotes = useMemo(() => {
    if (projectFilter === null) return rootNotes;
    if (projectFilter === "unassigned") return unassignedNotes;
    return projectNotes[projectFilter] || [];
  }, [rootNotes, unassignedNotes, projectNotes, projectFilter]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-border/50">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xs font-bold text-foreground uppercase tracking-wider flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-primary" />
            Ghi chú
          </h2>
          <button
            type="button"
            onClick={() => handleCreateRootNote()}
            className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            title="Tạo note mới"
          >
            <FilePlus className="w-4 h-4" />
          </button>
        </div>

        {/* Project filter pills */}
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => setProjectFilter(null)}
            className={`text-[10px] px-2 py-0.5 rounded-full transition-colors cursor-pointer ${
              projectFilter === null
                ? "bg-primary/15 text-primary font-semibold"
                : "bg-muted/40 text-muted-foreground hover:text-foreground"
            }`}
          >
            Tất cả
          </button>
          <button
            type="button"
            onClick={() => setProjectFilter("unassigned")}
            className={`text-[10px] px-2 py-0.5 rounded-full transition-colors cursor-pointer ${
              projectFilter === "unassigned"
                ? "bg-primary/15 text-primary font-semibold"
                : "bg-muted/40 text-muted-foreground hover:text-foreground"
            }`}
          >
            Không gán
          </button>
          {projects?.map((p) => (
            <button
              key={p._id}
              type="button"
              onClick={() => setProjectFilter(p._id)}
              className={`text-[10px] px-2 py-0.5 rounded-full transition-colors cursor-pointer ${
                projectFilter === p._id
                  ? "bg-primary/15 text-primary font-semibold"
                  : "bg-muted/40 text-muted-foreground hover:text-foreground"
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1 px-1.5 space-y-0.5">
        {!allNotes && (
          <div className="text-xs text-center text-muted-foreground py-8">Đang tải...</div>
        )}
        {allNotes && filteredRootNotes.length === 0 && (
          <div className="text-center py-8">
            <FileText className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground mb-3">Chưa có ghi chú nào</p>
            <button
              type="button"
              onClick={() => handleCreateRootNote()}
              className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer font-medium"
            >
              <Plus className="w-3 h-3" />
              Tạo note mới
            </button>
          </div>
        )}

        {/* Notes grouped by project */}
        {projectFilter === null && (
          <>
            {projects?.map((project) => {
              const projectRoots = projectNotes[project._id];
              if (!projectRoots || projectRoots.length === 0) return null;
              return (
                <div key={project._id} className="mb-2">
                  <div className="flex items-center gap-1 px-2 py-1">
                    <Folder className="w-3 h-3 text-muted-foreground" />
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex-1">
                      {project.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCreateRootNote(project._id)}
                      className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer opacity-0 hover:opacity-100 transition-opacity"
                      title="Thêm note vào dự án"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                  {projectRoots.map((note) => (
                    <TreeNode
                      key={note._id}
                      note={note}
                      allNotes={allNotes}
                      depth={0}
                      selectedNoteId={selectedNoteId}
                      onSelect={onSelectNote}
                      collapsed={collapsed}
                      onToggleCollapse={toggleCollapse}
                      onAddChild={handleAddChild}
                      onRename={handleRename}
                      onDelete={handleDelete}
                      editingId={editingId}
                      editingTitle={editingTitle}
                      setEditingId={setEditingId}
                      setEditingTitle={setEditingTitle}
                      onSaveTitle={handleSaveTitle}
                    />
                  ))}
                </div>
              );
            })}

            {unassignedNotes.length > 0 && (
              <div>
                <div className="flex items-center gap-1 px-2 py-1">
                  <FileText className="w-3 h-3 text-muted-foreground" />
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Không gán
                  </span>
                </div>
                {unassignedNotes.map((note) => (
                  <TreeNode
                    key={note._id}
                    note={note}
                    allNotes={allNotes}
                    depth={0}
                    selectedNoteId={selectedNoteId}
                    onSelect={onSelectNote}
                    collapsed={collapsed}
                    onToggleCollapse={toggleCollapse}
                    onAddChild={handleAddChild}
                    onRename={handleRename}
                    onDelete={handleDelete}
                    editingId={editingId}
                    editingTitle={editingTitle}
                    setEditingId={setEditingId}
                    setEditingTitle={setEditingTitle}
                    onSaveTitle={handleSaveTitle}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* When a specific filter is active, just show those roots */}
        {projectFilter !== null &&
          filteredRootNotes.map((note) => (
            <TreeNode
              key={note._id}
              note={note}
              allNotes={allNotes || []}
              depth={0}
              selectedNoteId={selectedNoteId}
              onSelect={onSelectNote}
              collapsed={collapsed}
              onToggleCollapse={toggleCollapse}
              onAddChild={handleAddChild}
              onRename={handleRename}
              onDelete={handleDelete}
              editingId={editingId}
              editingTitle={editingTitle}
              setEditingId={setEditingId}
              setEditingTitle={setEditingTitle}
              onSaveTitle={handleSaveTitle}
            />
          ))}
      </div>
    </div>
  );
}
