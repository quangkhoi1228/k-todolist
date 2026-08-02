"use client";

import { useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, FolderPlus, Folder, Pencil, Check, X, Archive, ArchiveRestore, RotateCcw, AlertTriangle } from "lucide-react";
import { useProjects, useProjectMutations } from "@/hooks/useDomain";

export function ManageProjectsDialog({ children }: { children: React.ReactNode }) {
  const { userId } = useAuth();
  const pm = useProjectMutations();
  const [open, setOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [tab, setTab] = useState<"active" | "archived" | "trash">("active");
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const { data: projects } = useProjects(userId, { includeArchived: true, includeTrashed: true });

  const activeProjects = useMemo(
    () => (projects ?? []).filter((p) => !p.archived && !p.deletedAt).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [projects]
  );
  const archivedProjects = useMemo(
    () => (projects ?? []).filter((p) => p.archived && !p.deletedAt).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [projects]
  );
  const trashedProjects = useMemo(
    () => (projects ?? []).filter((p) => p.deletedAt).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0)),
    [projects]
  );
  const visibleProjects = tab === "active" ? activeProjects : tab === "archived" ? archivedProjects : trashedProjects;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !newProjectName.trim()) return;
    
    await pm.createProject({
      userId,
      name: newProjectName.trim(),
    });
    setNewProjectName("");
    setTab("active");
  };

  const handleSaveEdit = async (id: string) => {
    if (!editingName.trim()) return;
    await pm.updateProject({ id, name: editingName.trim() });
    setEditingId(null);
    setEditingName("");
  };

  const startEdit = (id: string, name: string) => {
    setEditingId(id);
    setEditingName(name);
  };

  const handleArchive = async (id: string) => {
    await pm.setProjectArchived(id, true);
  };

  const handleUnarchive = async (id: string) => {
    await pm.setProjectArchived(id, false);
  };

  const handleSoftDelete = async (id: string) => {
    if (confirm("Đưa dự án vào thùng rác? Bạn có thể khôi phục sau.")) {
      await pm.softDeleteProject(id);
    }
  };

  const handleRestore = async (id: string) => {
    await pm.restoreProject(id);
  };

  const handlePermanentDelete = async (id: string) => {
    if (confirm("Xóa vĩnh viễn dự án này? Tất cả công việc và ghi chú liên quan sẽ bị xóa. Hành động này KHÔNG THỂ hoàn tác!")) {
      await pm.deleteProject(id);
    }
  };

  const handleEmptyTrash = async () => {
    if (confirm("Dọn sạch thùng rác? Tất cả dự án trong thùng rác sẽ bị xóa vĩnh viễn.")) {
      for (const p of trashedProjects) {
        await pm.deleteProject(p._id);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <Folder className="w-5 h-5 text-primary" />
            Quản lý Dự án
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 pt-4">
          <form onSubmit={handleCreate} className="flex items-center gap-2">
            <Input
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="Tên dự án mới..."
              className="bg-muted/50 border-border"
            />
            <Button type="submit" size="icon" disabled={!newProjectName.trim()} className="shrink-0">
              <FolderPlus className="w-4 h-4" />
            </Button>
          </form>

          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-muted/40 border border-border/50">
            <button
              type="button"
              onClick={() => setTab("active")}
              className={`flex-1 h-7 text-[11px] font-semibold rounded-md transition-colors cursor-pointer ${
                tab === "active" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Đang dùng ({activeProjects.length})
            </button>
            <button
              type="button"
              onClick={() => setTab("archived")}
              className={`flex-1 h-7 text-[11px] font-semibold rounded-md transition-colors cursor-pointer ${
                tab === "archived" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Đã lưu trữ ({archivedProjects.length})
            </button>
            <button
              type="button"
              onClick={() => setTab("trash")}
              className={`flex-1 h-7 text-[11px] font-semibold rounded-md transition-colors cursor-pointer ${
                tab === "trash" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              🗑 Thùng rác ({trashedProjects.length})
            </button>
          </div>

          <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
            {!projects && <div className="text-sm text-muted-foreground text-center py-4">Đang tải...</div>}
            {projects && visibleProjects.length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-8 bg-muted/20 rounded-xl border border-dashed border-border">
                {tab === "active" ? "Chưa có dự án nào" : tab === "archived" ? "Chưa có dự án đã lưu trữ" : "Thùng rác trống"}
              </div>
            )}

            {/* Trash tab UI */}
            {tab === "trash" && trashedProjects.length > 0 && (
              <div className="flex justify-end mb-2">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-6 text-[10px] text-red-500 hover:text-red-600 hover:bg-red-500/10 cursor-pointer"
                  onClick={handleEmptyTrash}
                >
                  <Trash2 className="w-3 h-3 mr-1" />
                  Dọn sạch
                </Button>
              </div>
            )}

            {visibleProjects.map((project) => (
              <div key={project._id} className="flex items-center justify-between p-3 rounded-xl border border-border bg-muted/20 hover:bg-muted/40 transition-colors">
                {tab === "trash" ? (
                  <>
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                      <div className="min-w-0">
                        <span className="font-medium text-sm">{project.name}</span>
                        <p className="text-[10px] text-muted-foreground">
                          Đã xóa {project.deletedAt ? new Date(project.deletedAt).toLocaleDateString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10 cursor-pointer"
                        onClick={() => handleRestore(project._id)}
                        title="Khôi phục"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                        onClick={() => handlePermanentDelete(project._id)}
                        title="Xóa vĩnh viễn"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </>
                ) : editingId === project._id ? (
                  <div className="flex items-center gap-1.5 flex-1 mr-2">
                    <Input 
                      value={editingName} 
                      onChange={(e) => setEditingName(e.target.value)} 
                      className="h-8 text-xs bg-background"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveEdit(project._id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                    />
                    <Button size="icon" className="h-8 w-8 shrink-0 cursor-pointer" onClick={() => handleSaveEdit(project._id)}>
                      <Check className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 text-muted-foreground cursor-pointer" onClick={() => setEditingId(null)}>
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <span className={`font-medium text-sm ${tab === "archived" ? "text-muted-foreground" : ""}`}>
                      {project.name}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer"
                        onClick={() => startEdit(project._id, project.name)}
                        title="Đổi tên"
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      {tab === "active" ? (
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-muted-foreground hover:text-amber-600 hover:bg-amber-500/10 cursor-pointer"
                          onClick={() => handleArchive(project._id)}
                          title="Lưu trữ dự án"
                        >
                          <Archive className="w-4 h-4" />
                        </Button>
                      ) : (
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10 cursor-pointer"
                          onClick={() => handleUnarchive(project._id)}
                          title="Khôi phục dự án"
                        >
                          <ArchiveRestore className="w-4 h-4" />
                        </Button>
                      )}
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                        onClick={() => handleSoftDelete(project._id)}
                        title="Xoá dự án"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
