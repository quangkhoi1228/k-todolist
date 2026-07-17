"use client";

import { useState, useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { NoteTree } from "@/components/notes/NoteTree";
import { NoteEditor } from "@/components/notes/NoteEditor";
import { FileText, PanelLeftClose, PanelLeft } from "lucide-react";

export default function NotesPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Use local state for immediate reactivity when switching notes
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(
    () => searchParams.get("noteId") || null
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Sync local state to URL when it changes
  const handleSelectNote = useCallback(
    (id: string | null) => {
      setSelectedNoteId(id);
      const params = new URLSearchParams(searchParams.toString());
      if (id) {
        params.set("noteId", id);
      } else {
        params.delete("noteId");
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams]
  );

  return (
    <div className="flex h-full min-h-0">
      {/* Sidebar - Note Tree */}
      <div
        className={`${
          sidebarOpen ? "w-72" : "w-0"
        } transition-all duration-300 ease-in-out overflow-hidden shrink-0 border-r border-border/50 bg-card/30`}
      >
        {sidebarOpen && (
          <NoteTree
            selectedNoteId={selectedNoteId}
            onSelectNote={handleSelectNote}
          />
        )}
      </div>

      {/* Toggle button */}
      <button
        type="button"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="absolute left-0 top-1/2 -translate-y-1/2 z-10 p-1 rounded-r-lg bg-muted/80 hover:bg-muted border border-border/50 border-l-0 text-muted-foreground hover:text-foreground transition-colors cursor-pointer shadow-sm"
      >
        {sidebarOpen ? (
          <PanelLeftClose className="w-3.5 h-3.5" />
        ) : (
          <PanelLeft className="w-3.5 h-3.5" />
        )}
      </button>

      {/* Main Content */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {selectedNoteId ? (
          <NoteEditor noteId={selectedNoteId} />
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center max-w-sm">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <FileText className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-lg font-bold text-foreground mb-2">Ghi chú</h2>
              <p className="text-sm text-muted-foreground mb-6">
                Chọn một ghi chú từ danh sách bên trái hoặc tạo ghi chú mới để bắt đầu.
              </p>
              <p className="text-xs text-muted-foreground/60">
                Ghi chú có thể được tổ chức theo cấu trúc cây và gán vào dự án.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
