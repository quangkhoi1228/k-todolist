"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useAuth } from "@clerk/nextjs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, FolderPlus, Folder, Pencil, Check, X } from "lucide-react";

export function ManageProjectsDialog({ children }: { children: React.ReactNode }) {
  const { userId } = useAuth();
  const [open, setOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const projects = useQuery(api.projects.getProjects, userId ? { userId } : "skip");
  const createProject = useMutation(api.projects.createProject);
  const updateProject = useMutation(api.projects.updateProject);
  const deleteProject = useMutation(api.projects.deleteProject);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !newProjectName.trim()) return;
    
    await createProject({
      userId,
      name: newProjectName.trim(),
    });
    setNewProjectName("");
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
        
        <div className="space-y-6 pt-4">
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

          <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
            {!projects && <div className="text-sm text-muted-foreground text-center py-4">Đang tải...</div>}
            {projects?.length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-8 bg-muted/20 rounded-xl border border-dashed border-border">
                Chưa có dự án nào
              </div>
            )}
            {projects?.map((project) => (
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
                    <span className="font-medium text-sm">{project.name}</span>
                    <div className="flex items-center gap-1">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer"
                        onClick={() => startEdit(project._id, project.name)}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                        onClick={() => handleDelete(project._id)}
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
