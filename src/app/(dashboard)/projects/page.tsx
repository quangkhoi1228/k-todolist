"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Briefcase, Plus, Archive, Copy, Trash2, Search, ChevronRight, Circle, GripVertical } from "lucide-react";
import type { Id } from "../../../../convex/_generated/dataModel";
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, useSortable, rectSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const STATUS_COLORS: Record<string, string> = {
  todo: "bg-neutral-500",
  processing: "bg-blue-500",
  pending: "bg-amber-500",
  done: "bg-emerald-500",
};

function SortableProjectCard({
  project,
  stats,
  progress,
  onClick,
  onClone,
  onCloneName,
  onCloneTarget,
  onArchive,
  onDelete,
}: {
  project: any;
  stats: { total: number; done: number; processing: number; todo: number };
  progress: number;
  onClick: () => void;
  onClone: (id: string, name: string) => void;
  onCloneName?: string;
  onCloneTarget?: string | null;
  onArchive: (id: string, archived: boolean) => void;
  onDelete: (id: string, name: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: project._id,
    data: { type: "Project", project },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group glass-panel rounded-xl border border-border/50 p-4 hover:border-primary/30 hover:shadow-md transition-all duration-200 cursor-pointer flex flex-col gap-3 ${isDragging ? "z-50 shadow-xl border-primary/40" : ""}`}
    >
      {/* Project Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1" onClick={onClick}>
          <div
            className="w-3 h-3 rounded-full shrink-0"
            style={{ backgroundColor: project.color || "#8b5cf6" }}
          />
          <h3 className="text-xs font-bold text-foreground truncate">{project.name}</h3>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <ChevronRight
            className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary transition-colors cursor-pointer"
            onClick={onClick}
          />
          <button
            type="button"
            className="p-0.5 rounded hover:bg-muted text-muted-foreground/40 hover:text-muted-foreground transition-colors cursor-grab active:cursor-grabbing touch-none"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      {stats.total > 0 && (
        <div className="space-y-1" onClick={onClick}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">Tiến độ</span>
            <span className="text-[10px] font-bold text-foreground">{progress}%</span>
          </div>
          <div className="h-1.5 bg-muted/40 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${progress}%`,
                backgroundColor: project.color || "#8b5cf6",
              }}
            />
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="flex items-center gap-2 flex-wrap" onClick={onClick}>
        <span className="text-[10px] text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded">
          Tổng: <strong className="text-foreground">{stats.total}</strong>
        </span>
        {stats.todo > 0 && (
          <span className="text-[10px] text-neutral-500 bg-neutral-500/5 px-1.5 py-0.5 rounded flex items-center gap-0.5">
            <Circle className="w-1.5 h-1.5" />
            {stats.todo}
          </span>
        )}
        {stats.processing > 0 && (
          <span className="text-[10px] text-blue-500 bg-blue-500/5 px-1.5 py-0.5 rounded flex items-center gap-0.5">
            <Circle className="w-1.5 h-1.5" />
            {stats.processing}
          </span>
        )}
        {stats.done > 0 && (
          <span className="text-[10px] text-emerald-500 bg-emerald-500/5 px-1.5 py-0.5 rounded flex items-center gap-0.5">
            <Circle className="w-1.5 h-1.5" />
            {stats.done}
          </span>
        )}
      </div>

      {/* Actions (visible on hover) */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity pt-1 border-t border-border/30">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-[9px] rounded-md px-1.5 cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            onClone(project._id, `${project.name} (Copy)`);
          }}
        >
          <Copy className="w-2.5 h-2.5 mr-0.5" />
          Nhân bản
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-[9px] rounded-md px-1.5 cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            onArchive(project._id, !project.archived);
          }}
        >
          <Archive className="w-2.5 h-2.5 mr-0.5" />
          {project.archived ? "Khôi phục" : "Lưu trữ"}
        </Button>
        {!project.archived && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[9px] rounded-md px-1.5 text-red-500 hover:text-red-600 hover:bg-red-500/10 cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(project._id, project.name);
            }}
          >
            <Trash2 className="w-2.5 h-2.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  const { userId } = useAuth();
  const router = useRouter();
  const projects = useQuery(api.projects.getProjects, userId ? { userId, includeArchived: true } : "skip");
  const tasks = useQuery(api.tasks.getTasks, userId ? { userId } : "skip");
  const createProject = useMutation(api.projects.createProject);
  const setProjectArchived = useMutation(api.projects.setProjectArchived);
  const deleteProject = useMutation(api.projects.deleteProject);
  const cloneProject = useMutation(api.projects.cloneProject);
  const updateProjectOrders = useMutation(api.projects.updateProjectOrders);

  const [searchQuery, setSearchQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [cloneTarget, setCloneTarget] = useState<string | null>(null);
  const [cloneName, setCloneName] = useState("");
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // Sort projects by order for display
  const sortedProjects = useMemo(
    () => (projects ?? []).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    [projects]
  );

  const filteredProjects = sortedProjects.filter((p) => {
    if (!!p.archived !== showArchived) return false;
    if (searchQuery) {
      return p.name.toLowerCase().includes(searchQuery.toLowerCase());
    }
    return true;
  });

  const getProjectStats = (projectId: string) => {
    const projectTasks = (tasks ?? []).filter((t) => t.project === projectId);
    const total = projectTasks.length;
    const done = projectTasks.filter((t) => t.status === "done").length;
    const processing = projectTasks.filter((t) => t.status === "processing").length;
    const todo = projectTasks.filter((t) => !t.status || t.status === "todo").length;
    return { total, done, processing, todo };
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim() || !userId) return;
    try {
      await createProject({ userId, name: newProjectName.trim() });
      setNewProjectName("");
      setIsCreating(false);
    } catch (err) {
      console.error(err);
    }
  };

  const handleClone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cloneTarget || !cloneName.trim() || !userId) return;
    try {
      await cloneProject({
        projectId: cloneTarget as Id<"projects">,
        userId,
        name: cloneName.trim(),
      });
      setCloneTarget(null);
      setCloneName("");
    } catch (err) {
      console.error(err);
    }
  };

  const handleArchive = async (id: string, archived: boolean) => {
    const action = archived ? "khôi phục" : "lưu trữ";
    if (!confirm(`Bạn có muốn ${action} dự án này?`)) return;
    try {
      await setProjectArchived({ id: id as Id<"projects">, archived });
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Xóa vĩnh viễn dự án "${name}"? Tất cả công việc và ghi chú liên quan sẽ bị xóa.`)) return;
    try {
      await deleteProject({ id: id as Id<"projects"> });
    } catch (err) {
      console.error(err);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragId(null);

    if (!over || active.id === over.id) return;

    const activeIndex = filteredProjects.findIndex((p) => p._id === active.id);
    const overIndex = filteredProjects.findIndex((p) => p._id === over.id);
    if (activeIndex === -1 || overIndex === -1) return;

    // Compute new order values based on the reordered list
    const reordered = [...filteredProjects];
    const [moved] = reordered.splice(activeIndex, 1);
    reordered.splice(overIndex, 0, moved);

    const updates = reordered.map((p, i) => ({
      id: p._id as any,
      order: i * 1000,
    }));
    updateProjectOrders({ updates });
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(event.active.id as string);
  };

  return (
    <div className="p-3 h-full min-h-0 flex flex-col gap-3">
      {/* Header */}
      <div className="flex flex-col gap-2 glass p-3 rounded-xl border border-border/60 shadow-md shrink-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Briefcase className="w-4 h-4 text-primary" />
            <h1 className="text-sm font-bold text-foreground">Quản lý dự án</h1>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
              <Input
                placeholder="Tìm dự án..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-7 h-7 text-[10px] bg-background/50 border-border/60 rounded-lg w-40"
              />
            </div>

            <Button
              variant={showArchived ? "default" : "outline"}
              size="sm"
              className="h-7 text-[10px] rounded-lg cursor-pointer"
              onClick={() => setShowArchived(!showArchived)}
            >
              <Archive className="w-3 h-3 mr-1" />
              {showArchived ? "Đang lưu trữ" : "Đang hoạt động"}
            </Button>

            {isCreating ? (
              <form onSubmit={handleCreate} className="flex items-center gap-1.5">
                <Input
                  placeholder="Tên dự án..."
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  autoFocus
                  className="h-7 text-[10px] bg-background/50 border-border/60 rounded-lg w-40"
                  required
                />
                <Button type="submit" size="sm" className="h-7 text-[10px] rounded-lg cursor-pointer">Tạo</Button>
                <Button type="button" variant="ghost" size="sm" className="h-7 text-[10px] rounded-lg cursor-pointer" onClick={() => setIsCreating(false)}>
                  Hủy
                </Button>
              </form>
            ) : (
              <Button
                size="sm"
                className="h-7 text-[10px] rounded-lg cursor-pointer"
                onClick={() => setIsCreating(true)}
              >
                <Plus className="w-3 h-3 mr-1" />
                Dự án mới
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Project Grid */}
      <div className="flex-1 min-h-0 overflow-auto">
        {projects === undefined ? (
          <div className="text-neutral-400 text-center py-12 text-xs">Đang tải...</div>
        ) : filteredProjects.length === 0 ? (
          <div className="text-center py-12">
            <Briefcase className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground">
              {showArchived ? "Không có dự án nào đang lưu trữ" : "Chưa có dự án nào"}
            </p>
            {!showArchived && (
              <Button
                size="sm"
                className="mt-3 h-7 text-[10px] rounded-lg cursor-pointer"
                onClick={() => setIsCreating(true)}
              >
                <Plus className="w-3 h-3 mr-1" />
                Tạo dự án đầu tiên
              </Button>
            )}
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={filteredProjects.map((p) => p._id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {filteredProjects.map((project) => {
                  const stats = getProjectStats(project._id);
                  const progress = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;

                  return (
                    <SortableProjectCard
                      key={project._id}
                      project={project}
                      stats={stats}
                      progress={progress}
                      onClick={() => router.push(`/projects/${project._id}`)}
                      onClone={(id, name) => {
                        setCloneTarget(id);
                        setCloneName(name);
                      }}
                      onArchive={handleArchive}
                      onDelete={handleDelete}
                    />
                  );
                })}
              </div>
            </SortableContext>
            <DragOverlay>
              {activeDragId ? (
                (() => {
                  const project = filteredProjects.find((p) => p._id === activeDragId);
                  if (!project) return null;
                  const stats = getProjectStats(project._id);
                  const progress = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;
                  return (
                    <div className="glass-panel rounded-xl border border-primary/40 p-4 shadow-2xl flex flex-col gap-3 rotate-2 scale-105 opacity-90">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: project.color || "#8b5cf6" }} />
                        <span className="text-xs font-bold">{project.name}</span>
                      </div>
                      {stats.total > 0 && (
                        <div className="text-[10px] text-muted-foreground">{stats.done}/{stats.total} hoàn thành</div>
                      )}
                    </div>
                  );
                })()
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      {/* Clone Dialog */}
      {cloneTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setCloneTarget(null)}>
          <div className="bg-card border border-border rounded-xl shadow-xl p-4 w-80" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleClone} className="flex flex-col gap-3">
              <div className="text-xs font-bold text-foreground">Nhân bản dự án</div>
              <div className="text-[10px] text-muted-foreground leading-normal">
                Sao chép toàn bộ công việc sang dự án mới ở trạng thái Chưa thực hiện và bỏ ngày.
              </div>
              <Input
                placeholder="Tên dự án mới..."
                value={cloneName}
                onChange={(e) => setCloneName(e.target.value)}
                autoFocus
                className="h-8 text-xs bg-background/50 border-border rounded-lg px-2"
                required
              />
              <div className="flex justify-end gap-1.5 pt-1.5 border-t border-border">
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs rounded-lg px-2.5 cursor-pointer" onClick={() => setCloneTarget(null)}>
                  Hủy
                </Button>
                <Button type="submit" size="sm" className="h-7 text-xs rounded-lg px-2.5 font-semibold cursor-pointer">
                  Nhân bản
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
