"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useAuth } from "@clerk/nextjs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, FolderPlus, Folder, Pencil, Check, X, Archive, ArchiveRestore } from "lucide-react";

export function ManageProjectsDialog({ children }: { children: React.ReactNode }) {
  const { userId } = useAuth();
  const [open, setOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [tab, setTab] = useState<"active" | "archived">("active");
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const projects = useQuery(
    api.projects.getProjects,
    userId ? { userId, includeArchived: true } : "skip"
  );
  const createProject = useMutation(api.projects.createProject);
  const updateProject = useMutation(api.projects.updateProject);
  const setProjectArchived = useMutation(api.projects.setProjectArchived);
  const deleteProject = useMutation(api.projects.deleteProject);

  const activeProjects = useMemo(
    () => (projects ?? []).filter((p) => !p.archived).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [projects]
  );
  const archivedProjects = useMemo(
    () => (projects ?? []).filter((p) => p.archived).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [projects]
  );
  const visibleProjects = tab === "active" ? activeProjects : archivedProjects;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !newProjectName.trim()) return;
    
    await createProject({
      userId,
      name: newProjectName.trim(),
    });
    setNewProjectName("");
    setTab("active");
  };

  const handleSaveEdit = async (id: string) => {
    if (!editingName.trim()) return;
    await updateProject({ id: id as any, name: editingName.trim() });
    setEditingId(null);
    setEditingName("");
  };

  const startEdit = (id: string, name: string) => {
    setEditingId(id);
    setEditingName(name);
  };

  const handleArchive = async (id: string) => {
    await setProjectArchived({ id: id as any, archived: true });
  };

  const handleUnarchive = async (id: string) => {
    await setProjectArchived({ id: id as any, archived: false });
  };

  const handleDelete = async (id: string) => {
    if (confirm("Cảnh báo: Bạn có chắc chắn muốn xoá dự án này? TẤT CẢ các công việc liên quan thuộc dự án này cũng sẽ bị xoá vĩnh viễn và không thể khôi phục!")) {
      await deleteProject({ id: id as any });
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
          </div>

          <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
            {!projects && <div className="text-sm text-muted-foreground text-center py-4">Đang tải...</div>}
            {projects && visibleProjects.length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-8 bg-muted/20 rounded-xl border border-dashed border-border">
                {tab === "active" ? "Chưa có dự án nào" : "Chưa có dự án đã lưu trữ"}
              </div>
            )}
            {visibleProjects.map((project) => (
              <div key={project._id} className="flex items-center justify-between p-3 rounded-xl border border-border bg-muted/20 hover:bg-muted/40 transition-colors">
                {editingId === project._id ? (
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
                        onClick={() => handleDelete(project._id)}
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
