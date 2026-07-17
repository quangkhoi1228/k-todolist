"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { useAuth } from "@clerk/nextjs";
import { useRouter, useParams } from "next/navigation";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  Plus,
  Search,
  Circle,
  Clock,
  PauseCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight as ChevronRightIcon,
} from "lucide-react";
import { TaskCard } from "@/components/board/TaskCard";
import { ProjectDetailPanel } from "@/components/board/ProjectDetailPanel";
import { NewTaskSheet } from "@/components/board/NewTaskSheet";
import { DatePickerPopover } from "@/components/ui/DatePickerPopover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useSortable, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
  DndContext,
  closestCorners,
  pointerWithin,
  rectIntersection,
  useDroppable,
  type CollisionDetection,
  type DroppableContainer,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { startOfDay, format } from "date-fns";
import type { Id } from "../../../../../convex/_generated/dataModel";

type BoardColumn = "todo" | "processing" | "dueToday" | "done";

interface Task {
  _id: string;
  title: string;
  estimatedTime: number;
  startDate?: number | null;
  endDate?: number | null;
  pic?: string;
  project?: string;
  status?: string;
  order?: number;
  priority?: string;
  isOverflowing?: boolean;
}

function isDueToday(task: { endDate?: number | null; status?: string }, todayStart = startOfDay(new Date()).getTime()) {
  if (!task.endDate || task.status === "done") return false;
  return startOfDay(new Date(task.endDate)).getTime() === todayStart;
}

function getBoardColumn(task: { endDate?: number | null; status?: string }): BoardColumn {
  if (isDueToday(task)) return "dueToday";
  const status = task.status || "todo";
  if (status === "pending") return "todo";
  if (status === "processing" || status === "done" || status === "todo") return status;
  return "todo";
}

const COLUMN_WIDTH = 280;

const COLUMNS: { status: BoardColumn; label: string; colorClass: string; icon: React.ReactNode }[] = [
  { status: "todo", label: "Chưa thực hiện", colorClass: "text-neutral-500 bg-neutral-500/5 border-neutral-500/10", icon: <Circle className="w-2.5 h-2.5" /> },
  { status: "processing", label: "Đang xử lý", colorClass: "text-blue-500 bg-blue-500/5 border-blue-500/10", icon: <Clock className="w-2.5 h-2.5 animate-pulse" /> },
  { status: "dueToday", label: "Đến hạn", colorClass: "text-amber-500 bg-amber-500/5 border-amber-500/10", icon: <PauseCircle className="w-2.5 h-2.5" /> },
  { status: "done", label: "Đã hoàn thành", colorClass: "text-emerald-500 bg-emerald-500/5 border-emerald-500/10", icon: <CheckCircle2 className="w-2.5 h-2.5" /> },
];

function ColumnCell({ id, status, tasks, projectId }: { id: string; status: BoardColumn; tasks: Task[]; projectId: string }) {
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { type: "SwimlaneCell", project: projectId, status },
  });

  const { userId } = useAuth();
  const createTask = useMutation(api.tasks.createTask);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [endDate, setEndDate] = useState<number>(() => {
    const d = new Date();
    d.setHours(17, 30, 0, 0);
    return d.getTime();
  });
  const [priority, setPriority] = useState<"low" | "normal" | "high">("normal");

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !userId) return;
    try {
      const startVal = startOfDay(new Date()).getTime();
      await createTask({
        userId,
        title,
        estimatedTime: 1,
        startDate: startVal,
        endDate: status === "dueToday" ? new Date(startOfDay(new Date()).setHours(17, 30, 0, 0)).getTime() : endDate,
        project: projectId as Id<"projects">,
        status: status === "dueToday" ? "todo" : status,
        priority,
      });
      setTitle("");
      setOpen(false);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div
      ref={setNodeRef}
      className={`shrink-0 p-1.5 rounded-xl border transition-all duration-200 min-h-[120px] flex flex-col gap-1 relative group/cell ${
        isOver ? "bg-primary/10 border-primary/40 shadow-sm" : "bg-muted/10 border-border/30 hover:border-border/60"
      }`}
      style={{ width: COLUMN_WIDTH }}
    >
      <div className="absolute top-1 right-1 opacity-0 group-hover/cell:opacity-100 transition-opacity z-10">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger className="p-1 rounded-md bg-background/80 hover:bg-muted border border-border/50 text-muted-foreground hover:text-foreground transition-colors cursor-pointer shadow-sm">
            <Plus className="w-3.5 h-3.5" />
          </PopoverTrigger>
          <PopoverContent className="w-72 bg-card/98 backdrop-blur-xl border border-border/80 p-3 shadow-xl rounded-xl z-50">
            <form onSubmit={handleSave} className="flex flex-col gap-2.5">
              <div className="text-xs font-bold text-foreground">Tạo nhanh công việc</div>
              <Input
                placeholder="Tên công việc..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
                className="h-8 text-xs bg-background/50 border-border/60 rounded-lg px-2"
                required
              />
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-muted-foreground">Hạn chót</label>
                {status === "dueToday" ? (
                  <div className="h-8 text-xs bg-amber-500/10 border border-amber-500/20 rounded-lg px-2 flex items-center text-amber-600 dark:text-amber-400 font-medium">
                    Hôm nay
                  </div>
                ) : (
                  <DatePickerPopover
                    date={endDate}
                    onDateChange={(ts) => setEndDate(ts || Date.now())}
                    showTime={true}
                    placeholder="Chọn hạn chót"
                    side="bottom"
                    align="start"
                  >
                    <div className="flex items-center justify-between w-full h-8 text-xs bg-background/50 border border-border/60 rounded-lg px-2 cursor-pointer text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors">
                      <span>{endDate ? format(new Date(endDate), "dd/MM HH:mm") : "Chọn hạn chót"}</span>
                    </div>
                  </DatePickerPopover>
                )}
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-muted-foreground">Độ ưu tiên</label>
                <div className="grid grid-cols-3 gap-1">
                  {[
                    { val: "low", label: "Thấp", color: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20" },
                    { val: "normal", label: "TB", color: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20" },
                    { val: "high", label: "Cao", color: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20" },
                  ].map((prio) => (
                    <button
                      key={prio.val}
                      type="button"
                      onClick={() => setPriority(prio.val as any)}
                      className={`text-[10px] py-1 border rounded-lg font-medium transition-all ${
                        priority === prio.val ? `${prio.color} border-current ring-1 ring-current` : "border-border/50 hover:bg-muted text-muted-foreground"
                      }`}
                    >
                      {prio.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-1.5 pt-1.5 border-t border-border/50">
                <Button type="button" variant="ghost" size="sm" className="h-7 text-xs rounded-lg px-2.5 cursor-pointer" onClick={() => setOpen(false)}>
                  Hủy
                </Button>
                <Button type="submit" size="sm" className="h-7 text-xs rounded-lg px-2.5 font-semibold cursor-pointer">
                  Tạo mới
                </Button>
              </div>
            </form>
          </PopoverContent>
        </Popover>
      </div>

      <SortableContext items={tasks.map((t) => t._id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-1 flex-1 justify-start pt-2">
          {tasks.map((task) => (
            <TaskCard key={task._id} task={task} hideProjectBadge={true} hideStatusBadge={true} />
          ))}
          {tasks.length === 0 && (
            <div className="flex-1 flex items-center justify-center text-[10px] text-muted-foreground/30 italic py-6 select-none">
              Kéo thả vào đây
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  );
}

export default function ProjectDetailPage() {
  const { id } = useParams();
  const { userId } = useAuth();
  const router = useRouter();

  const projects = useQuery(api.projects.getProjects, userId ? { userId, includeArchived: true } : "skip");
  const allTasks = useQuery(api.tasks.getTasks, userId ? { userId } : "skip");
  const updateTask = useMutation(api.tasks.updateTask);
  const updateTaskOrders = useMutation(api.tasks.updateTaskOrders);

  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"order" | "endDate" | "priority">("order");
  const [showDetail, setShowDetail] = useState(true);
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const project = useMemo(() => {
    return projects?.find((p) => p._id === id);
  }, [projects, id]);

  const projectTasks = useMemo(() => {
    if (!allTasks || !id) return [];
    return allTasks.filter((t) => t.project === id);
  }, [allTasks, id]);

  const filteredTasks = useMemo(() => {
    return projectTasks.filter((t) => {
      if (searchQuery) {
        return t.title.toLowerCase().includes(searchQuery.toLowerCase());
      }
      return true;
    });
  }, [projectTasks, searchQuery]);

  const tasksByColumn = useMemo(() => {
    const grouped: Record<BoardColumn, Task[]> = { todo: [], processing: [], dueToday: [], done: [] };
    const sorted = [...filteredTasks].sort((a, b) => {
      if (sortBy === "endDate") {
        const aVal = a.endDate ? Math.floor(a.endDate / 60000) * 60000 : Infinity;
        const bVal = b.endDate ? Math.floor(b.endDate / 60000) * 60000 : Infinity;
        if (aVal !== bVal) return aVal - bVal;
        const prioWeight = { high: 3, normal: 2, low: 1 };
        return (prioWeight[b.priority as keyof typeof prioWeight] || 0) - (prioWeight[a.priority as keyof typeof prioWeight] || 0);
      }
      if (sortBy === "priority") {
        const prioWeight = { high: 3, normal: 2, low: 1 };
        const aVal = prioWeight[a.priority as keyof typeof prioWeight] || 0;
        const bVal = prioWeight[b.priority as keyof typeof prioWeight] || 0;
        if (aVal !== bVal) return bVal - aVal;
        return (a.endDate || Infinity) - (b.endDate || Infinity);
      }
      return (a.order ?? 0) - (b.order ?? 0);
    });

    sorted.forEach((task) => {
      const col = getBoardColumn(task);
      grouped[col].push(task);
    });
    return grouped;
  }, [filteredTasks, sortBy]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  function handleDragStart(event: DragStartEvent) {
    if (event.active.data.current?.type === "Task") {
      setActiveTask(event.active.data.current.task);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveTask(null);
    if (!over) return;

    const activeId = active.id;
    const overId = over.id;

    if (over.data.current?.type === "SwimlaneCell") {
      const targetColumn = over.data.current.status as BoardColumn;
      const activeTaskData = active.data.current?.task as Task;
      const sourceColumn = getBoardColumn(activeTaskData);

      if (sourceColumn === targetColumn) return;

      const targetList = [...(tasksByColumn[targetColumn] || [])].filter((t) => t._id !== activeId);
      targetList.push(activeTaskData);

      const moveFields: { status?: string; endDate?: number } = {};
      if (targetColumn === "done") {
        moveFields.status = "done";
      } else if (targetColumn === "dueToday") {
        moveFields.endDate = new Date(startOfDay(new Date()).setHours(17, 30, 0, 0)).getTime();
        if (activeTaskData.status === "done") moveFields.status = "todo";
      } else {
        moveFields.status = targetColumn;
      }

      const updates = targetList.map((t, index) => ({
        id: t._id as Id<"tasks">,
        order: index * 1000,
        ...(t._id === activeId ? moveFields : {}),
      }));

      void updateTaskOrders({ updates });
      return;
    }

    if (over.data.current?.type === "Task") {
      const overTask = over.data.current.task as Task;
      const activeTaskData = active.data.current?.task as Task;
      const targetColumn = getBoardColumn(overTask);
      const sourceColumn = getBoardColumn(activeTaskData);
      const sameCell = sourceColumn === targetColumn;

      if (sameCell && activeId === overId) return;

      const sourceList = [...(tasksByColumn[sourceColumn] || [])];
      const targetList = sameCell ? sourceList : [...(tasksByColumn[targetColumn] || [])];

      const activeIndex = sourceList.findIndex((t) => t._id === activeId);
      const overIndex = targetList.findIndex((t) => t._id === overId);
      if (activeIndex === -1 || overIndex === -1) return;

      if (sameCell) {
        const reordered = arrayMove(sourceList, activeIndex, overIndex);
        void updateTaskOrders({
          updates: reordered.map((t, index) => ({ id: t._id as Id<"tasks">, order: index * 1000 })),
        });
      } else {
        const moveFields: { status?: string; endDate?: number } = {};
        if (targetColumn === "done") {
          moveFields.status = "done";
        } else if (targetColumn === "dueToday") {
          moveFields.endDate = new Date(startOfDay(new Date()).setHours(17, 30, 0, 0)).getTime();
          if (activeTaskData.status === "done") moveFields.status = "todo";
        } else {
          moveFields.status = targetColumn;
        }

        const nextTarget = targetList.filter((t) => t._id !== activeId);
        nextTarget.splice(overIndex, 0, activeTaskData);

        const updates = nextTarget.map((t, index) => ({
          id: t._id as Id<"tasks">,
          order: index * 1000,
          ...(t._id === activeId ? moveFields : {}),
        }));

        const nextSource = sourceList.filter((t) => t._id !== activeId);
        for (const [index, srcTask] of nextSource.entries()) {
          updates.push({ id: srcTask._id as Id<"tasks">, order: index * 1000 });
        }

        void updateTaskOrders({ updates });
      }
    }
  }

  if (projects === undefined) {
    return (
      <div className="p-3 h-full flex items-center justify-center">
        <div className="text-neutral-400 text-xs">Đang tải...</div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-3 h-full flex flex-col items-center justify-center gap-3">
        <div className="text-neutral-400 text-xs">Không tìm thấy dự án</div>
        <Button variant="outline" size="sm" className="h-7 text-[10px] rounded-lg cursor-pointer" onClick={() => router.push("/projects")}>
          <ArrowLeft className="w-3 h-3 mr-1" />
          Quay lại
        </Button>
      </div>
    );
  }

  const stats = {
    total: projectTasks.length,
    todo: projectTasks.filter((t) => !t.status || t.status === "todo").length,
    processing: projectTasks.filter((t) => t.status === "processing").length,
    dueToday: projectTasks.filter((t) => isDueToday(t)).length,
    done: projectTasks.filter((t) => t.status === "done").length,
  };

  return (
    <div className="p-3 h-full min-h-0 flex flex-col gap-2">
      {/* Header Bar */}
      <div className="glass p-3 rounded-xl border border-border/60 shadow-md shrink-0">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 rounded-lg cursor-pointer shrink-0"
              onClick={() => router.push("/projects")}
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: project.color || "#8b5cf6" }}
            />
            <h1 className="text-sm font-bold text-foreground truncate">{project.name}</h1>

            <div className="flex items-center gap-1.5 ml-2">
              <span className="text-[10px] text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded">
                Tổng: <strong className="text-foreground">{stats.total}</strong>
              </span>
              <span className="text-[10px] text-neutral-500 bg-neutral-500/5 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                <Circle className="w-1.5 h-1.5" /> {stats.todo}
              </span>
              <span className="text-[10px] text-blue-500 bg-blue-500/5 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                <Clock className="w-1.5 h-1.5" /> {stats.processing}
              </span>
              <span className="text-[10px] text-amber-500 bg-amber-500/5 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                <PauseCircle className="w-1.5 h-1.5" /> {stats.dueToday}
              </span>
              <span className="text-[10px] text-emerald-500 bg-emerald-500/5 px-1.5 py-0.5 rounded flex items-center gap-0.5">
                <CheckCircle2 className="w-1.5 h-1.5" /> {stats.done}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
              <Input
                placeholder="Tìm công việc..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-6 h-7 text-[10px] bg-background/50 border-border/60 rounded-lg w-36"
              />
            </div>

            {/* Sort */}
            <Select value={sortBy} onValueChange={(val) => setSortBy(val as typeof sortBy)}>
              <SelectTrigger className="bg-background/50 hover:bg-background border-border/60 text-foreground h-7 px-1.5 rounded-lg text-[10px] font-medium cursor-pointer w-32">
                <SelectValue>
                  {sortBy === "order" ? "Sắp xếp: Mặc định" : sortBy === "endDate" ? "Sắp xếp: Hạn chót" : "Sắp xếp: Ưu tiên"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="bg-card/95 backdrop-blur-xl border-border">
                <SelectItem value="order" className="text-[10px] cursor-pointer">Mặc định</SelectItem>
                <SelectItem value="endDate" className="text-[10px] cursor-pointer">Hạn chót</SelectItem>
                <SelectItem value="priority" className="text-[10px] cursor-pointer">Độ ưu tiên</SelectItem>
              </SelectContent>
            </Select>

            {/* Toggle Detail */}
            <Button
              variant={showDetail ? "default" : "outline"}
              size="sm"
              className="h-7 text-[10px] rounded-lg cursor-pointer"
              onClick={() => setShowDetail(!showDetail)}
            >
              {showDetail ? <ChevronDown className="w-3 h-3 mr-1" /> : <ChevronRightIcon className="w-3 h-3 mr-1" />}
              Chi tiết
            </Button>

            {/* Add Task */}
            <NewTaskSheet>
              <button className="px-2 h-7 bg-foreground text-background text-[10px] font-semibold rounded-lg hover:opacity-90 cursor-pointer shadow-sm flex items-center gap-1">
                <Plus className="w-3 h-3" /> Công Việc
              </button>
            </NewTaskSheet>
          </div>
        </div>
      </div>

      {/* Detail Panel */}
      {showDetail && (
        <div className="shrink-0">
          <ProjectDetailPanel project={project} />
        </div>
      )}

      {/* Kanban Board */}
      <div className="flex-1 min-h-0 overflow-auto">
        <DndContext
          sensors={sensors}
          collisionDetection={kanbanCollisionDetection}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-3 min-w-max pb-4">
            {COLUMNS.map((col) => (
              <div key={col.status} className="flex flex-col gap-2 shrink-0" style={{ width: COLUMN_WIDTH }}>
                <div
                  className={`shrink-0 py-1.5 px-2 rounded-lg border font-bold text-[10px] uppercase tracking-wider flex items-center gap-1.5 shadow-sm ${col.colorClass}`}
                >
                  {col.icon}
                  <span>{col.label}</span>
                  <span className="ml-auto text-[9px] font-normal opacity-70">
                    {tasksByColumn[col.status].length}
                  </span>
                </div>
                <ColumnCell
                  id={`${id}::${col.status}`}
                  status={col.status}
                  tasks={tasksByColumn[col.status]}
                  projectId={id as string}
                />
              </div>
            ))}
          </div>

          <DragOverlay>
            {activeTask ? <TaskCard task={activeTask} hideProjectBadge={true} hideStatusBadge={true} /> : null}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}

const kanbanCollisionDetection: CollisionDetection = (args) => {
  const activeType = args.active.data.current?.type as string | undefined;
  const droppableContainers = args.droppableContainers.filter((container: DroppableContainer) => {
    const type = container.data.current?.type as string | undefined;
    if (activeType === "Task") return type === "Task" || type === "SwimlaneCell";
    return true;
  });
  const filteredArgs = { ...args, droppableContainers };
  const pointerCollisions = pointerWithin(filteredArgs);
  if (pointerCollisions.length > 0) {
    const taskCollision = pointerCollisions.find((c) => {
      const container = droppableContainers.find((ct) => ct.id === c.id);
      return container?.data.current?.type === "Task";
    });
    if (taskCollision) return [taskCollision];
    return pointerCollisions;
  }
  const intersections = rectIntersection(filteredArgs);
  if (intersections.length > 0) return intersections;
  return closestCorners(filteredArgs);
};
