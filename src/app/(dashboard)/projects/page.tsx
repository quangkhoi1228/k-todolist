"use client";

import { useProjects, useTasks, useProjectMutations, useTaskMutations } from "@/hooks/useDomain";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Briefcase, Plus, Archive, Copy, Trash2, Search, ChevronRight, Circle, GripVertical, RotateCcw, AlertTriangle, ExternalLink, Loader2 } from "lucide-react";
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, useSortable, rectSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Id } from "@/lib/types";

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
  onRestore,
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
  onRestore?: (id: string) => void;
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

  const projectColor = project.color || "#8b5cf6";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group bg-card/60 dark:bg-zinc-900/60 backdrop-blur-md rounded-xl border border-border/50 shadow-xs hover:border-primary/40 hover:bg-card/90 dark:hover:bg-zinc-900/90 hover:shadow-md transition-all duration-200 cursor-pointer flex items-center justify-between gap-4 px-4 py-3 relative overflow-hidden ${isDragging ? "z-50 shadow-2xl border-primary/60 scale-[1.005]" : ""}`}
    >
      {/* Left Color Accent Bar */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 opacity-80 group-hover:opacity-100 transition-opacity"
        style={{ backgroundColor: projectColor }}
      />

      {/* Left: Indicator + Project Name + Task Count */}
      <div className="flex items-center gap-3 min-w-0 flex-1 pl-1" onClick={onClick}>
        <div
          className="w-3 h-3 rounded-full shrink-0 ring-2 ring-background shadow-xs"
          style={{ backgroundColor: projectColor }}
        />
        <h3 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors truncate">
          {project.name}
        </h3>
        <span className="text-[11px] text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full font-medium shrink-0">
          {stats.total} việc
        </span>
      </div>

      {/* Middle: Progress Bar & Status Badges (Visible on medium+ screens) */}
      <div className="hidden md:flex items-center gap-4 shrink-0" onClick={onClick}>
        {/* Progress */}
        {stats.total > 0 && (
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-24 lg:w-32 bg-muted/60 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${progress}%`,
                  backgroundColor: projectColor,
                }}
              />
            </div>
            <span className="text-xs font-semibold text-foreground/80 w-8 text-right">{progress}%</span>
          </div>
        )}

        {/* Status tags */}
        <div className="flex items-center gap-1.5">
          {stats.todo > 0 && (
            <span className="text-[11px] text-neutral-600 dark:text-neutral-400 bg-neutral-500/10 px-2 py-0.5 rounded-md flex items-center gap-1 font-medium">
              <Circle className="w-1.5 h-1.5 fill-neutral-500 text-neutral-500" />
              {stats.todo} chưa làm
            </span>
          )}
          {stats.processing > 0 && (
            <span className="text-[11px] text-blue-600 dark:text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-md flex items-center gap-1 font-medium">
              <Circle className="w-1.5 h-1.5 fill-blue-500 text-blue-500" />
              {stats.processing} đang làm
            </span>
          )}
          {stats.done > 0 && (
            <span className="text-[11px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md flex items-center gap-1 font-medium">
              <Circle className="w-1.5 h-1.5 fill-emerald-500 text-emerald-500" />
              {stats.done} xong
            </span>
          )}
        </div>
      </div>

      {/* Right: Action Buttons, Chevron, Grip */}
      <div className="flex items-center gap-1 shrink-0">
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {onRestore && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs rounded-lg px-2 cursor-pointer text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10"
              onClick={(e) => {
                e.stopPropagation();
                onRestore(project._id);
              }}
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1" />
              Khôi phục
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs rounded-lg px-2 cursor-pointer hover:bg-muted"
            onClick={(e) => {
              e.stopPropagation();
              onClone(project._id, `${project.name} (Copy)`);
            }}
          >
            <Copy className="w-3.5 h-3.5 mr-1" />
            Nhân bản
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs rounded-lg px-2 cursor-pointer hover:bg-muted"
            onClick={(e) => {
              e.stopPropagation();
              onArchive(project._id, !project.archived);
            }}
          >
            <Archive className="w-3.5 h-3.5 mr-1" />
            {project.archived ? "Khôi phục" : "Lưu trữ"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs rounded-lg px-2 text-red-500 hover:text-red-600 hover:bg-red-500/10 cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(project._id, project.name);
            }}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>

        <div
          className="p-1 rounded-lg text-muted-foreground/40 group-hover:text-primary transition-colors cursor-pointer"
          onClick={onClick}
        >
          <ChevronRight className="w-4 h-4" />
        </div>

        <button
          type="button"
          className="p-1 rounded-lg hover:bg-muted text-muted-foreground/40 hover:text-muted-foreground transition-colors cursor-grab active:cursor-grabbing touch-none"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  const { userId } = useAuth();
  const router = useRouter();
  const { data: projects, mutate: mutateProjects } = useProjects(userId, {
    includeArchived: true,
    includeTrashed: true,
  });
  const { data: tasks } = useTasks(userId);
  const pm = useProjectMutations();
  const tm = useTaskMutations();

  const [searchQuery, setSearchQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
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

  const trashedProjects = useMemo(
    () => sortedProjects.filter((p) => p.deletedAt),
    [sortedProjects]
  );

  const activeOrArchivedProjects = useMemo(
    () => sortedProjects.filter((p) => !p.deletedAt),
    [sortedProjects]
  );

  const filteredProjects = activeOrArchivedProjects.filter((p) => {
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
      await pm.createProject({ userId, name: newProjectName.trim() });
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
      await pm.cloneProject(cloneTarget, userId, cloneName.trim());
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
      await pm.setProjectArchived(id, archived);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Đưa dự án "${name}" vào thùng rác? Bạn có thể khôi phục sau.`)) return;
    try {
      await pm.softDeleteProject(id);
      setShowTrash(true);
    } catch (err) {
      console.error(err);
    }
  };

  const handleRestore = async (id: string) => {
    try {
      await pm.restoreProject(id);
    } catch (err) {
      console.error(err);
    }
  };

  const handlePermanentDelete = async (id: string, name: string) => {
    if (!confirm(`Xóa vĩnh viễn dự án "${name}"? Tất cả công việc và ghi chú liên quan sẽ bị xóa. Hành động này KHÔNG THỂ hoàn tác.`)) return;
    try {
      await pm.deleteProject(id);
    } catch (err) {
      console.error(err);
    }
  };

  const handlePermanentDeleteAll = async () => {
    if (!confirm(`Xóa vĩnh viễn TẤT CẢ dự án trong thùng rác? Hành động này KHÔNG THỂ hoàn tác.`)) return;
    try {
      for (const p of trashedProjects) {
        await pm.deleteProject(p._id);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleEmptyTrash = async () => {
    if (!confirm(`Dọn sạch thùng rác? Tất cả dự án trong thùng rác sẽ bị xóa vĩnh viễn.`)) return;
    await handlePermanentDeleteAll();
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
    pm.updateProjectOrders(updates);
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(event.active.id as string);
  };

  // Show trash view
  if (showTrash) {
    return (
      <div className="p-3 h-full min-h-0 flex flex-col gap-3">
        {/* Header */}
        <div className="flex flex-col gap-2 bg-card/50 dark:bg-zinc-900/50 backdrop-blur-md p-3 rounded-[1.25rem] border border-border/40 shadow-sm shrink-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-red-400" />
              <h1 className="text-sm font-bold text-foreground">Thùng rác</h1>
              <span className="text-[10px] text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded-full">
                {trashedProjects.length} dự án
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[10px] rounded-lg cursor-pointer text-red-500 hover:text-red-600 hover:bg-red-500/10"
                onClick={handleEmptyTrash}
                disabled={trashedProjects.length === 0}
              >
                <Trash2 className="w-3 h-3 mr-1" />
                Dọn sạch
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[10px] rounded-lg cursor-pointer"
                onClick={() => setShowTrash(false)}
              >
                <Archive className="w-3 h-3 mr-1" />
                Quay lại
              </Button>
            </div>
          </div>
        </div>

        {/* Trash List */}
        <div className="flex-1 min-h-0 overflow-auto">
          {trashedProjects.length === 0 ? (
            <div className="text-center py-12">
              <Trash2 className="w-10 h-10 mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground">Thùng rác trống</p>
            </div>
          ) : (
            <div className="space-y-2">
              {trashedProjects.map((project) => {
                const stats = getProjectStats(project._id);
                const progress = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0;

                return (
                  <div
                    key={project._id}
                    className="group bg-card/60 dark:bg-zinc-900/60 backdrop-blur-md rounded-xl border border-border/50 shadow-xs px-4 py-3 hover:border-red-300 dark:hover:border-red-500/30 hover:shadow-md transition-all duration-200 flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer" onClick={() => router.push(`/projects/${project._id}`)}>
                      <div className="w-8 h-8 rounded-lg bg-red-100 dark:bg-red-500/10 flex items-center justify-center shrink-0">
                        <AlertTriangle className="w-4 h-4 text-red-500" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold text-foreground truncate">{project.name}</h3>
                          {progress > 0 && (
                            <span className="text-xs font-semibold text-muted-foreground">({progress}%)</span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          Đã xóa {project.deletedAt ? new Date(project.deletedAt).toLocaleDateString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs rounded-lg px-2.5 cursor-pointer text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10"
                        onClick={() => handleRestore(project._id)}
                      >
                        <RotateCcw className="w-3.5 h-3.5 mr-1" />
                        Khôi phục
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs rounded-lg px-2 text-red-500 hover:text-red-600 hover:bg-red-500/10 cursor-pointer"
                        onClick={() => handlePermanentDelete(project._id, project.name)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-3 h-full min-h-0 flex flex-col gap-3">
      {/* Header */}
      <div className="flex flex-col gap-2 bg-card/50 dark:bg-zinc-900/50 backdrop-blur-md p-3 rounded-[1.25rem] border border-border/40 shadow-sm shrink-0">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Briefcase className="w-4 h-4 text-primary" />
            <h1 className="text-sm font-bold text-foreground">Quản lý dự án</h1>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Tìm dự án..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 min-h-8 h-auto py-1.5 text-[11px] bg-card/50 dark:bg-zinc-900/50 backdrop-blur-md border-border/40 rounded-xl w-40 shadow-sm hover:border-border/60 focus-visible:ring-primary/30 transition-all duration-300"
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

            {trashedProjects.length > 0 && (
              <Button
                variant={showTrash ? "destructive" : "ghost"}
                size="sm"
                className="h-7 text-[10px] rounded-lg cursor-pointer relative"
                onClick={() => setShowTrash(!showTrash)}
              >
                <Trash2 className="w-3 h-3 mr-1" />
                Thùng rác
                <span className="ml-1 px-1.5 py-0.2 bg-red-500/20 text-red-500 rounded-full text-[9px] font-bold">
                  {trashedProjects.length > 9 ? "9+" : trashedProjects.length}
                </span>
              </Button>
            )}

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

      {/* Project List (1 project per row) */}
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
              <div className="flex flex-col gap-2">
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
                  const projectColor = project.color || "#8b5cf6";
                  return (
                    <div className="bg-card/95 dark:bg-zinc-900/95 backdrop-blur-md rounded-xl border border-primary/50 px-4 py-3 shadow-2xl flex items-center justify-between gap-4 rotate-[0.5deg] scale-[1.01] opacity-95">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: projectColor }} />
                        <span className="text-sm font-semibold text-foreground truncate">{project.name}</span>
                        <span className="text-[11px] text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full font-medium">
                          {stats.total} việc
                        </span>
                      </div>
                      {stats.total > 0 && (
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 bg-muted/60 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${progress}%`,
                                backgroundColor: projectColor,
                              }}
                            />
                          </div>
                          <span className="text-xs font-semibold text-foreground/80">{progress}%</span>
                        </div>
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
