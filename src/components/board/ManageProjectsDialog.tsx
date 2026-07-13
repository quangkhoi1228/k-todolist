"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useAuth } from "@clerk/nextjs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2, FolderPlus, Folder } from "lucide-react";

export function ManageProjectsDialog({ children }: { children: React.ReactNode }) {
  const { userId } = useAuth();
  const [open, setOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  
  const projects = useQuery(api.projects.getProjects, userId ? { userId } : "skip");
  const createProject = useMutation(api.projects.createProject);
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

  const handleDelete = async (id: string) => {
    if (confirm("Bạn có chắc chắn muốn xoá dự án này? (Các công việc thuộc dự án này sẽ không bị xoá, nhưng sẽ mất liên kết dự án)")) {
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
                <span className="font-medium text-sm">{project.name}</span>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  onClick={() => handleDelete(project._id)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
