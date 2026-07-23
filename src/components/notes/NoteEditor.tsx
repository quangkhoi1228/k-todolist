"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useAuth } from "@clerk/nextjs";
import { WysiwygEditor } from "@/components/board/WysiwygEditor";
import {
  Trash2,
  Folder,
  Link,
  Globe,
  Check,
  ChevronDown,
  Share2,
  Copy,
  X,
  ExternalLink,
} from "lucide-react";
import type { Doc } from "../../../convex/_generated/dataModel";

interface NoteEditorProps {
  noteId: string;
}

type Note = Doc<"notes">;

export function NoteEditor({ noteId }: NoteEditorProps) {
  const { userId } = useAuth();
  const note = useQuery(api.notes.getNote, { id: noteId as any });
  const projects = useQuery(api.notes.getNotes, userId ? { userId } : "skip");

  const allProjects = useQuery(api.projects.getProjects, userId ? { userId, includeArchived: true } : "skip");

  const updateNote = useMutation(api.notes.updateNote);
  const deleteNoteMut = useMutation(api.notes.deleteNote);
  const moveNoteToProject = useMutation(api.notes.moveNoteToProject);
  const generateShareSlug = useMutation(api.notes.generateShareSlug);
  const removeShareSlug = useMutation(api.notes.removeShareSlug);
  const generateUploadUrl = useMutation(api.storage.generateUploadUrl);
  const getImageUrl = useMutation(api.storage.getImageUrl);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const shareMenuRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [contentVersion, setContentVersion] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Tracks which note the editor contentVersion corresponds to.
  // Only bump contentVersion on actual note switch, not on every refetch after save.
  const prevNoteIdForVersionRef = useRef<string | null>(null);

  // Keep stale note data to avoid flash when switching notes
  const staleNoteRef = useRef<Doc<"notes"> | null>(null);
  const [staleNoteId, setStaleNoteId] = useState(noteId);

  // When noteId changes: cancel pending save, capture stale data
  useEffect(() => {
    if (noteId !== staleNoteId) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (note) {
        staleNoteRef.current = note;
      }
      setStaleNoteId(noteId);
    }
  }, [noteId]); // eslint-disable-line react-hooks/exhaustive-deps

  // When note data arrives: update title/content.
  // Only bump contentVersion (forcing editor re-creation) when actually switching to a different note,
  // not on every refetch after save — otherwise focus is lost and in-flight image uploads break.
  useEffect(() => {
    if (note) {
      staleNoteRef.current = null;
      setTitle(note.title || "");
      setContent(note.content || "");

      if (prevNoteIdForVersionRef.current !== note._id) {
        prevNoteIdForVersionRef.current = note._id;
        setContentVersion((v) => v + 1);
      }
    }
  }, [note]);

  // Determine display data: prefer fresh note, fall back to stale data during transition
  const displayNote = note || staleNoteRef.current;

  const doSave = useCallback(
    async (newTitle: string, newContent: string) => {
      if (!userId) return;
      setSaving(true);
      try {
        await updateNote({
          id: noteId as any,
          title: newTitle,
          content: newContent,
        });
        setLastSaved(new Date());
      } catch (err) {
        console.error("Failed to save note:", err);
      } finally {
        setSaving(false);
      }
    },
    [userId, noteId, updateNote]
  );

  // Debounced save on content change
  useEffect(() => {
    if (!displayNote) return;
    if (title === displayNote.title && content === displayNote.content) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      doSave(title, content);
    }, 800);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [title, content, displayNote, doSave]);

  const handleDelete = useCallback(async () => {
    if (confirm("Xoá note này và tất cả note con?")) {
      await deleteNoteMut({ id: noteId as any });
    }
  }, [noteId, deleteNoteMut]);

  const handleMoveToProject = useCallback(
    async (projectId: string | null) => {
      await moveNoteToProject({
        noteId: noteId as any,
        projectId: projectId as any,
      });
      setProjectMenuOpen(false);
    },
    [noteId, moveNoteToProject]
  );

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

  const handleGenerateShareSlug = useCallback(async () => {
    const slug = await generateShareSlug({ noteId: noteId as any });
    return slug;
  }, [noteId, generateShareSlug]);

  const handleRemoveShareSlug = useCallback(async () => {
    await removeShareSlug({ noteId: noteId as any });
  }, [noteId, removeShareSlug]);

  const handleCopyShareLink = useCallback(
    async (slug: string) => {
      const url = `${window.location.origin}/notes/share/${slug}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    },
    []
  );

  // Close menus on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (projectMenuRef.current && !projectMenuRef.current.contains(e.target as Node)) {
        setProjectMenuOpen(false);
      }
      if (shareMenuRef.current && !shareMenuRef.current.contains(e.target as Node)) {
        setShareMenuOpen(false);
      }
    };
    if (projectMenuOpen || shareMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [projectMenuOpen, shareMenuOpen]);

  // Show loading only on initial load when no stale data exists
  if (!displayNote) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin mx-auto mb-3" />
          <p className="text-xs text-muted-foreground">Đang tải...</p>
        </div>
      </div>
    );
  }

  const currentProject = allProjects?.find((p) => p._id === displayNote.projectId);
  const isLoading = !note && staleNoteRef.current;

  return (
    <div className="flex flex-col h-full">
      {/* Header toolbar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/50 bg-muted/10 shrink-0">
        <div className="flex-1 min-w-0">
          <div className="relative">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-transparent text-lg font-bold text-foreground outline-none placeholder:text-muted-foreground/40"
              placeholder="Tiêu đề ghi chú..."
            />
            {isLoading && (
              <div className="absolute right-0 top-1/2 -translate-y-1/2">
                <span className="w-3.5 h-3.5 block border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Project assignment */}
          <div className="relative" ref={projectMenuRef}>
            <button
              type="button"
              onClick={() => setProjectMenuOpen(!projectMenuOpen)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-muted/40 hover:bg-muted border border-border/50 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              <Folder className="w-3.5 h-3.5" />
              <span className="truncate max-w-[120px]">
                {currentProject ? currentProject.name : "Không gán"}
              </span>
              <ChevronDown className="w-3 h-3" />
            </button>

            {projectMenuOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 min-w-[180px] bg-popover border border-border rounded-xl shadow-xl p-1.5">
                <button
                  type="button"
                  onClick={() => handleMoveToProject(null)}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer flex items-center gap-2 ${
                    !displayNote.projectId
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  }`}
                >
                  <Globe className="w-3.5 h-3.5" />
                  Không gán
                  {!displayNote.projectId && <Check className="w-3 h-3 ml-auto" />}
                </button>
                <div className="h-px bg-border/50 my-1" />
                {allProjects?.map((p) => (
                  <button
                    key={p._id}
                    type="button"
                    onClick={() => handleMoveToProject(p._id)}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer flex items-center gap-2 ${
                      displayNote.projectId === p._id
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    }`}
                  >
                    <Folder className="w-3.5 h-3.5" />
                    {p.name}
                    {displayNote.projectId === p._id && <Check className="w-3 h-3 ml-auto" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Save status */}
          <div className="text-[10px] text-muted-foreground px-2">
            {saving ? (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                Đang lưu...
              </span>
            ) : lastSaved ? (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                Đã lưu
              </span>
            ) : null}
          </div>

          <div className="relative" ref={shareMenuRef}>
            <button
              type="button"
              onClick={() => setShareMenuOpen(!shareMenuOpen)}
              className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              title="Chia sẻ note"
            >
              <Share2 className="w-4 h-4" />
            </button>

            {shareMenuOpen && (
              <div
                className="absolute right-0 top-full mt-1 z-50 min-w-[260px] bg-popover border border-border rounded-xl shadow-xl p-3"
              >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-foreground">Chia sẻ ghi chú</span>
                <button
                  type="button"
                  onClick={() => setShareMenuOpen(false)}
                  className="p-0.5 rounded hover:bg-muted text-muted-foreground cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>

              {displayNote.shareSlug ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-muted/50 border border-border/50 text-xs text-foreground break-all">
                    <ExternalLink className="w-3 h-3 shrink-0 text-primary" />
                    <span className="truncate">{`/notes/share/${displayNote.shareSlug}`}</span>
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleCopyShareLink(displayNote.shareSlug!)}
                      className="flex-1 flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer"
                    >
                      {copied ? (
                        <>
                          <Check className="w-3 h-3" />
                          Đã sao chép!
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          Sao chép link
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await handleRemoveShareSlug();
                      }}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors cursor-pointer"
                    >
                      Hủy link
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-[11px] text-muted-foreground">
                    Tạo liên kết để bất kỳ ai cũng có thể xem ghi chú này.
                  </p>
                  <button
                    type="button"
                    onClick={async () => {
                      await handleGenerateShareSlug();
                    }}
                    className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer"
                  >
                    <Share2 className="w-3 h-3" />
                    Tạo link chia sẻ
                  </button>
                </div>
              )}
            </div>
            )}
          </div>

          <button
            type="button"
            onClick={handleDelete}
            className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors cursor-pointer"
            title="Xoá note"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Editor content */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-5xl mx-auto">
          <div className="border border-border/50 rounded-xl overflow-hidden bg-card/30" key={`${noteId}-${contentVersion}`}>
            <WysiwygEditor
              content={content}
              onChange={(md) => setContent(md)}
              placeholder="Bắt đầu viết..."
              onImageUpload={handleImageUpload}
            />
          </div>

          {/* Note metadata */}
          <div className="mt-4 p-3 rounded-xl bg-muted/20 border border-border/30">
            <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
              <span>
                Tạo: {new Date(displayNote._creationTime).toLocaleDateString("vi-VN", {
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              {displayNote.parentNoteId && (
                <span className="flex items-center gap-1">
                  <Link className="w-3 h-3" />
                  Note con
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
