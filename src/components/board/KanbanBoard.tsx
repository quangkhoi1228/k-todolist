"use client";

import { useMemo, useState } from "react";
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors, closestCorners, useDroppable } from "@dnd-kit/core";
import { arrayMove, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Column } from "./Column";
import { TaskCard } from "./TaskCard";
import { getDays, formatDateStr } from "@/lib/date-utils";
import { startOfDay, addDays } from "date-fns";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Briefcase, Search, Circle, Clock, PauseCircle, CheckCircle2, Plus } from "lucide-react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { NewTaskSheet } from "./NewTaskSheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@clerk/nextjs";

export interface Task {
  _id: string;
  title: string;
  estimatedTime: number;
  startDate: number;
  endDate?: number;
  pic?: string;
  project?: string;
  status?: string;
  order?: number;
  isOverflowing?: boolean;
}

interface SwimlaneCellProps {
  id: string;
  project: string;
  status: string;
  tasks: Task[];
}

function SwimlaneCell({ id, project, status, tasks }: SwimlaneCellProps) {
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { type: "SwimlaneCell", project, status },
  });

  const { userId } = useAuth();
  const createTask = useMutation(api.tasks.createTask);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [endDate, setEndDate] = useState("");
  const [priority, setPriority] = useState<"low" | "normal" | "high">("normal");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !userId) return;
    setIsSaving(true);
    try {
      const startVal = startOfDay(new Date()).getTime();
      await createTask({
        userId,
        title,
        estimatedTime: 1, // default 1 hour
        startDate: startVal,
        endDate: endDate ? new Date(endDate).getTime() : startVal + 24 * 3600 * 1000,
        project: project === "none" ? undefined : (project as any),
        status,
        priority,
      });
      setTitle("");
      setEndDate("");
      setPriority("normal");
      setOpen(false);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      ref={setNodeRef}
      className={`w-[290px] shrink-0 p-2 rounded-xl border transition-all duration-200 min-h-[100px] flex flex-col gap-1.5 relative group/cell ${
        isOver 
          ? "bg-primary/10 border-primary/40 shadow-sm" 
          : "bg-muted/10 border-border/30 hover:border-border/60"
      }`}
    >
      {/* Quick Add Button with Popover */}
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
                <Input
                  type="datetime-local"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="h-8 text-xs bg-background/50 border-border/60 rounded-lg px-2 cursor-pointer text-muted-foreground"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-muted-foreground">Độ ưu tiên</label>
                <div className="grid grid-cols-3 gap-1">
                  {[
                    { val: "low", label: "Thấp", color: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20" },
                    { val: "normal", label: "Trung bình", color: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20" },
                    { val: "high", label: "Cao", color: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20" },
                  ].map((prio) => (
                    <button
                      key={prio.val}
                      type="button"
                      onClick={() => setPriority(prio.val as any)}
                      className={`text-[10px] py-1 border rounded-lg font-medium transition-all ${
                        priority === prio.val 
                          ? `${prio.color} border-current ring-1 ring-current`
                          : "border-border/50 hover:bg-muted text-muted-foreground"
                      }`}
                    >
                      {prio.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-1.5 pt-1.5 border-t border-border/50">
                <Button 
                  type="button" 
                  variant="ghost" 
                  size="sm" 
                  className="h-7 text-xs rounded-lg px-2.5" 
                  onClick={() => setOpen(false)}
                >
                  Hủy
                </Button>
                <Button 
                  type="submit" 
                  size="sm" 
                  className="h-7 text-xs rounded-lg px-2.5 font-semibold"
                  disabled={isSaving}
                >
                  {isSaving ? "Đang lưu..." : "Tạo mới"}
                </Button>
              </div>
            </form>
          </PopoverContent>
        </Popover>
      </div>

      <SortableContext items={tasks.map((t) => t._id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-1.5 flex-1 justify-start pt-3">
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

function ProjectHeaderCell({ project, totalTasks }: { project: any; totalTasks: number }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: project._id,
    data: {
      type: "Project",
      project,
    },
    disabled: project._id === "none",
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(project._id === "none" ? {} : attributes)}
      {...(project._id === "none" ? {} : listeners)}
      className={`w-[48px] shrink-0 p-2 rounded-xl border border-border/80 bg-zinc-50 dark:bg-zinc-900 sticky left-0 z-20 flex flex-col justify-between items-center gap-2 shadow-sm relative overflow-hidden group ${
        project._id === "none" ? "" : "cursor-grab active:cursor-grabbing hover:border-primary/40 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      }`}
    >
      {/* Top accent color dot */}
      <div 
        className="w-2.5 h-2.5 rounded-full shrink-0 mt-1"
        style={{ backgroundColor: project.color || "#8b5cf6" }}
      />
      
      {/* Vertical name */}
      <span 
        className="text-[11px] font-bold text-foreground tracking-wide whitespace-nowrap text-center block select-none max-w-[120px] truncate"
        style={{ writingMode: 'vertical-lr', transform: 'rotate(180deg)' }}
        title={project.name}
      >
        {project.name}
      </span>
      
      {/* Count */}
      <span className="text-[10px] text-muted-foreground/80 font-bold bg-muted px-1.5 py-0.5 rounded-full select-none mb-1">
        {totalTasks}
      </span>
    </div>
  );
}

interface KanbanBoardProps {
  tasks: Task[];
  onUpdateTask: (taskId: string, updates: { startDate?: number; endDate?: number; status?: string; project?: string }) => void;
  projects?: {
    _id: string;
    name: string;
    color?: string;
    userId: string;
  }[];
  showFilters?: boolean;
}

export function KanbanBoard({ 
  tasks, 
  onUpdateTask, 
  projects,
  showFilters = false
}: KanbanBoardProps) {
  const updateTaskOrders = useMutation(api.tasks.updateTaskOrders);
  const updateProjectOrders = useMutation(api.projects.updateProjectOrders);
  const [baseDate, setBaseDate] = useState(() => startOfDay(new Date()));
  const days = useMemo(() => getDays(baseDate, 7), [baseDate]);
  
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [viewMode, setViewMode] = useState<"date" | "status">("status");

  // Filtering and sorting states
  const [searchQuery, setSearchQuery] = useState("");
  const [filterProject, setFilterProject] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"order" | "endDate" | "priority">("order");

  // Filter tasks
  const filteredTasks = useMemo(() => {
    return tasks.filter(task => {
      const matchesSearch = task.title.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = filterStatus === "all" || task.status === filterStatus;
      
      const taskProject = task.project || "none";
      const matchesProject = filterProject === "all" || taskProject === filterProject;
      
      return matchesSearch && matchesStatus && matchesProject;
    });
  }, [tasks, searchQuery, filterProject, filterStatus]);

  // Compute overdue tasks (uncompleted tasks with start date before today)
  const overdueTasks = useMemo(() => {
    const todayStart = startOfDay(new Date()).getTime();
    return filteredTasks.filter(task => {
      const isBeforeToday = startOfDay(new Date(task.startDate)).getTime() < todayStart;
      const isNotDone = task.status !== "done";
      return isBeforeToday && isNotDone;
    });
  }, [filteredTasks]);

  // Group tasks by date string (excluding overdue tasks)
  const tasksByDate = useMemo(() => {
    const grouped: Record<string, Task[]> = {};
    days.forEach(day => grouped[formatDateStr(day)] = []);
    
    // Sort tasks by order
    const sortedTasks = [...filteredTasks].sort((a, b) => (a.order || 0) - (b.order || 0));
    const todayStart = startOfDay(new Date()).getTime();

    sortedTasks.forEach(task => {
      // Exclude overdue tasks from regular columns
      const isBeforeToday = startOfDay(new Date(task.startDate)).getTime() < todayStart;
      const isNotDone = task.status !== "done";
      if (isBeforeToday && isNotDone) {
        return;
      }

      const taskDate = startOfDay(new Date(task.startDate));
      const dateStr = formatDateStr(taskDate);
      if (grouped[dateStr]) {
        grouped[dateStr].push(task);
      }
    });

    // Mark overflowing tasks
    Object.keys(grouped).forEach(dateStr => {
      const dayTasks = grouped[dateStr];
      const totalHours = dayTasks.reduce((sum, t) => sum + t.estimatedTime, 0);
      if (totalHours > 8) {
        grouped[dateStr] = dayTasks.map(t => ({ ...t, isOverflowing: true }));
      }
    });

    return grouped;
  }, [days, filteredTasks]);

  // Group tasks by project and status
  const projectsList = useMemo(() => {
    const list = projects ? [...projects] : [];
    return [...list, { _id: "none", name: "Không có dự án", color: "#64748b" }];
  }, [projects]);

  const tasksByProjectAndStatus = useMemo(() => {
    const grouped: Record<string, Record<string, Task[]>> = {};
    
    projectsList.forEach(p => {
      grouped[p._id] = {
        todo: [],
        processing: [],
        pending: [],
        done: [],
      };
    });
    
    const sortedTasks = [...filteredTasks].sort((a, b) => (a.order || 0) - (b.order || 0));
    
    sortedTasks.forEach(task => {
      const projId = task.project || "none";
      const status = task.status || "todo";
      const targetProjId = grouped[projId] ? projId : "none";
      
      if (grouped[targetProjId] && grouped[targetProjId][status]) {
        grouped[targetProjId][status].push(task);
      }
    });
    
    return grouped;
  }, [filteredTasks, projectsList]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  function handleDragStart(event: DragStartEvent) {
    if (event.active.data.current?.type === "Task") {
      setActiveTask(event.active.data.current.task);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id;
    const overId = over.id;

    // 1. Dragged to a different Swimlane Cell (Grid Cell)
    if (over.data.current?.type === "SwimlaneCell") {
      const targetProject = over.data.current.project;
      const targetStatus = over.data.current.status;
      
      const updates: { project?: string; status?: string } = {};
      if (targetProject === "none") {
        updates.project = undefined;
      } else {
        updates.project = targetProject;
      }
      updates.status = targetStatus;

      onUpdateTask(activeId as string, updates as any);
      return;
    }

    // Dragged to a different Column
    if (over.data.current?.type === "Column") {
      if (viewMode === "status") {
        const targetStatus = over.data.current.statusMode;
        if (targetStatus) {
          onUpdateTask(activeId as string, { status: targetStatus });
        }
        return;
      }
      
      const targetDateStr = over.data.current.dateStr;
      if (targetDateStr === "overdue") {
        return; // Cannot drag into overdue column directly
      }
      const newStartDate = startOfDay(new Date(targetDateStr)).getTime();
      onUpdateTask(activeId as string, { startDate: newStartDate });
      return;
    }

    // 2. Dragged over a task
    if (over.data.current?.type === "Task") {
      const overTask = over.data.current.task as Task;
      
      if (viewMode === "status") {
        const targetStatus = overTask.status || "todo";
        const targetProject = overTask.project;
        
        onUpdateTask(activeId as string, {
          status: targetStatus,
          project: targetProject === "none" ? undefined : targetProject,
        });
        return;
      }

      const targetDateStr = formatDateStr(startOfDay(new Date(overTask.startDate)));
      const newStartDate = startOfDay(new Date(targetDateStr)).getTime();

      const activeTaskData = active.data.current?.task as Task;
      const sourceDateStr = formatDateStr(startOfDay(new Date(activeTaskData.startDate)));

      const todayStart = startOfDay(new Date()).getTime();
      const isActiveOverdue = startOfDay(new Date(activeTaskData.startDate)).getTime() < todayStart && activeTaskData.status !== "done";

      const sourceList = isActiveOverdue ? [...overdueTasks] : [...(tasksByDate[sourceDateStr] || [])];
      const targetList = sourceDateStr === targetDateStr && !isActiveOverdue ? sourceList : [...(tasksByDate[targetDateStr] || [])];

      const activeIndex = sourceList.findIndex((t) => t._id === activeId);
      const overIndex = targetList.findIndex((t) => t._id === overId);

      if (sourceDateStr === targetDateStr && !isActiveOverdue) {
        // Reordering in same column
        const reordered = arrayMove(sourceList, activeIndex, overIndex);
        const updates = reordered.map((t, index) => ({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          id: t._id as any,
          order: index * 1000,
          startDate: newStartDate,
        }));
        updateTaskOrders({ updates });
      } else {
        // Moving between columns and placing in specific index
        targetList.splice(overIndex, 0, activeTaskData);
        const updates = targetList.map((t, index) => ({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          id: t._id as any,
          order: index * 1000,
          startDate: newStartDate,
        }));
        updateTaskOrders({ updates });
      }
    }
  }

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Date Navigation (Only visible in Workload View Mode) */}
      {viewMode === "date" && (
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="outline" size="sm" className="h-8 px-2 rounded-lg border-border/60 hover:bg-muted/50 cursor-pointer text-xs" onClick={() => setBaseDate(d => addDays(d, -7))}>
            <ChevronLeft className="w-3.5 h-3.5 mr-0.5" /> Trước
          </Button>
          <Button variant="outline" size="sm" className="h-8 px-2 rounded-lg border-border/60 hover:bg-muted/50 font-medium cursor-pointer text-xs" onClick={() => setBaseDate(startOfDay(new Date()))}>
            <CalendarIcon className="w-3 h-3 mr-0.5" /> Hôm nay
          </Button>
          <Button variant="outline" size="sm" className="h-8 px-2 rounded-lg border-border/60 hover:bg-muted/50 cursor-pointer text-xs" onClick={() => setBaseDate(d => addDays(d, 7))}>
            Sau <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
          </Button>
        </div>
      )}

      {/* Collapsible Filter Bar */}
      <div className={`${showFilters ? "flex" : "hidden"} md:flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between glass p-2 rounded-xl border border-border/60 shadow-md shrink-0`}>
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            {/* Search Bar */}
            <div className="relative w-full sm:w-52">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Tìm kiếm công việc..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-8 text-[11px] bg-background/50 border-border/60 rounded-lg w-full"
              />
            </div>

            {/* Project Filter */}
            <div className="w-full sm:w-auto sm:min-w-[9rem] sm:max-w-[15rem]">
              <Select value={filterProject} onValueChange={(val) => setFilterProject(val || "all")}>
                <SelectTrigger className="bg-background/50 hover:bg-background border-border/60 text-foreground h-8 px-2 rounded-lg text-[11px] font-medium focus-visible:ring-primary/50 cursor-pointer flex items-center gap-1 shadow-sm w-full truncate">
                  <Briefcase className="w-3 h-3 text-muted-foreground shrink-0" />
                  <SelectValue placeholder="Dự án: Tất cả">
                    {filterProject === "all"
                      ? "Dự án: Tất cả"
                      : filterProject === "none"
                        ? "Không có dự án"
                        : `Dự án: ${projects?.find((p) => p._id === filterProject)?.name || ""}`}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="bg-card/95 backdrop-blur-xl border-border">
                  <SelectItem value="all" className="text-[11px] cursor-pointer">Dự án: Tất cả</SelectItem>
                  <SelectItem value="none" className="text-[11px] cursor-pointer italic text-muted-foreground">Không có dự án</SelectItem>
                  {projects?.map((p) => (
                    <SelectItem key={p._id} value={p._id} className="text-[11px] cursor-pointer">
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Status Filter */}
            <div className="w-full sm:w-36">
              <Select value={filterStatus} onValueChange={(val) => setFilterStatus(val || "all")}>
                <SelectTrigger className="bg-background/50 hover:bg-background border-border/60 text-foreground h-8 px-2 rounded-lg text-[11px] font-medium focus-visible:ring-primary/50 cursor-pointer flex items-center gap-1 shadow-sm w-full">
                  <SelectValue placeholder="Trạng thái: Tất cả">
                    {filterStatus === "all" ? (
                      <span className="flex items-center gap-1">
                        <Circle className="w-3 h-3 text-muted-foreground" />
                        Trạng thái: Tất cả
                      </span>
                    ) : filterStatus === "todo" ? (
                      <span className="flex items-center gap-1 text-neutral-500">
                        <Circle className="w-3 h-3 text-neutral-400" />
                        Chưa thực hiện
                      </span>
                    ) : filterStatus === "processing" ? (
                      <span className="flex items-center gap-1 text-blue-500">
                        <Clock className="w-3 h-3 animate-pulse" />
                        Đang xử lý
                      </span>
                    ) : filterStatus === "pending" ? (
                      <span className="flex items-center gap-1 text-amber-500">
                        <PauseCircle className="w-3 h-3" />
                        Tạm dừng
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-emerald-500">
                        <CheckCircle2 className="w-3 h-3" />
                        Đã hoàn thành
                      </span>
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="bg-card/95 backdrop-blur-xl border-border">
                  <SelectItem value="all" className="text-[11px] cursor-pointer">
                    <span className="flex items-center gap-1">
                      <Circle className="w-3.5 h-3.5 text-muted-foreground" />
                      Trạng thái: Tất cả
                    </span>
                  </SelectItem>
                  <SelectItem value="todo" className="text-[11px] cursor-pointer">
                    <span className="flex items-center gap-1 text-neutral-500">
                      <Circle className="w-3.5 h-3.5 text-neutral-400" />
                      Chưa thực hiện
                    </span>
                  </SelectItem>
                  <SelectItem value="processing" className="text-[11px] cursor-pointer">
                    <span className="flex items-center gap-1 text-blue-500">
                      <Clock className="w-3.5 h-3.5" />
                      Đang xử lý
                    </span>
                  </SelectItem>
                  <SelectItem value="pending" className="text-[11px] cursor-pointer">
                    <span className="flex items-center gap-1 text-amber-500">
                      <PauseCircle className="w-3.5 h-3.5" />
                      Tạm dừng
                    </span>
                  </SelectItem>
                  <SelectItem value="done" className="text-[11px] cursor-pointer">
                    <span className="flex items-center gap-1 text-emerald-500">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Đã hoàn thành
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
        </div>

        {/* Toggle Switcher */}
        <div className="flex items-center bg-muted/40 border border-border/50 rounded-xl p-0.5 w-fit shadow-inner shrink-0 self-end md:self-auto">
          <Button
            variant={viewMode === "status" ? "default" : "ghost"}
            size="sm"
            className={`h-7 px-3 rounded-lg text-xs font-semibold transition-all duration-200 cursor-pointer ${
              viewMode === "status" 
                ? "bg-background text-foreground shadow-sm hover:bg-background" 
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setViewMode("status")}
          >
            Kanban
          </Button>
          <Button
            variant={viewMode === "date" ? "default" : "ghost"}
            size="sm"
            className={`h-7 px-3 rounded-lg text-xs font-semibold transition-all duration-200 cursor-pointer ${
              viewMode === "date" 
                ? "bg-background text-foreground shadow-sm hover:bg-background" 
                : "text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setViewMode("date")}
          >
            Workload
          </Button>
        </div>
      </div>

      <DndContext 
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className={`flex ${viewMode === "status" ? "flex-col" : "flex-row"} gap-3 overflow-x-auto pb-4 h-full`}>
          {viewMode === "status" ? (
            <div className="flex flex-col gap-3.5 min-w-max">
              {/* Status Headers row */}
              <div className="flex gap-3 shrink-0 min-w-max pb-1">
                {/* Empty corner cell */}
                <div className="w-[48px] shrink-0 sticky left-0 z-30 bg-background/95 backdrop-blur-md border-r border-border/85 flex items-center justify-center py-2 select-none">
                  <span 
                    className="text-[9px] font-black uppercase tracking-wider text-muted-foreground/80 whitespace-nowrap"
                    style={{ writingMode: 'vertical-lr', transform: 'rotate(180deg)' }}
                  >
                    Dự án
                  </span>
                </div>
                
                {/* Headers */}
                {[
                  { status: "todo", label: "Chưa thực hiện", colorClass: "text-neutral-500 bg-neutral-500/5 dark:bg-neutral-500/10 border-neutral-500/10 dark:border-neutral-500/20" },
                  { status: "processing", label: "Đang xử lý", colorClass: "text-blue-500 bg-blue-500/5 dark:bg-blue-500/10 border-blue-500/10 dark:border-blue-500/20" },
                  { status: "pending", label: "Tạm dừng", colorClass: "text-amber-500 bg-amber-500/5 dark:bg-amber-500/10 border-amber-500/10 dark:border-amber-500/20" },
                  { status: "done", label: "Đã hoàn thành", colorClass: "text-emerald-500 bg-emerald-500/5 dark:bg-emerald-500/10 border-emerald-500/10 dark:border-emerald-500/20" },
                ].map(col => (
                  <div 
                    key={col.status}
                    className={`w-[290px] shrink-0 p-2.5 rounded-xl border text-center font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 ${col.colorClass}`}
                  >
                    <span>{col.label}</span>
                  </div>
                ))}
              </div>

              {/* Swimlane rows */}
              {projectsList.map(p => {
                const projectTasks = tasksByProjectAndStatus[p._id] || { todo: [], processing: [], pending: [], done: [] };
                const totalProjTasks = projectTasks.todo.length + projectTasks.processing.length + projectTasks.pending.length + projectTasks.done.length;
                
                return (
                  <div key={p._id} className="flex gap-3 shrink-0 min-w-max items-stretch">
                    {/* Project Header Cell (Sticky Left, Narrow, Vertical text) */}
                    <div className="w-[48px] shrink-0 p-2 rounded-xl border border-border/80 bg-zinc-50 dark:bg-zinc-900 sticky left-0 z-20 flex flex-col justify-between items-center gap-2 shadow-sm relative overflow-hidden group">
                      {/* Top accent color dot */}
                      <div 
                        className="w-2.5 h-2.5 rounded-full shrink-0 mt-1"
                        style={{ backgroundColor: p.color || "#8b5cf6" }}
                      />
                      
                      {/* Vertical name */}
                      <span 
                        className="text-[11px] font-bold text-foreground tracking-wide whitespace-nowrap text-center block select-none max-w-[120px] truncate"
                        style={{ writingMode: 'vertical-lr', transform: 'rotate(180deg)' }}
                        title={p.name}
                      >
                        {p.name}
                      </span>
                      
                      {/* Count */}
                      <span className="text-[10px] text-muted-foreground/80 font-bold bg-muted px-1.5 py-0.5 rounded-full select-none mb-1">
                        {totalProjTasks}
                      </span>
                    </div>
                    
                    {/* Status cells */}
                    <SwimlaneCell id={`${p._id}::todo`} project={p._id} status="todo" tasks={projectTasks.todo} />
                    <SwimlaneCell id={`${p._id}::processing`} project={p._id} status="processing" tasks={projectTasks.processing} />
                    <SwimlaneCell id={`${p._id}::pending`} project={p._id} status="pending" tasks={projectTasks.pending} />
                    <SwimlaneCell id={`${p._id}::done`} project={p._id} status="done" tasks={projectTasks.done} />
                  </div>
                );
              })}
            </div>
          ) : (
            <>
              {/* Overdue Column */}
              {overdueTasks.length > 0 && (
                <Column
                  title="Tồn đọng"
                  isOverdue={true}
                  tasks={overdueTasks}
                  totalHours={0}
                />
              )}

              {days.map(day => {
                const dateStr = formatDateStr(day);
                const dayTasks = tasksByDate[dateStr] || [];
                const totalHours = dayTasks.reduce((sum, t) => sum + t.estimatedTime, 0);

                return (
                  <Column 
                    key={dateStr}
                    date={day} 
                    tasks={dayTasks} 
                    totalHours={totalHours} 
                  />
                );
              })}
            </>
          )}
        </div>
      
        <DragOverlay>
          {activeTask ? <TaskCard task={activeTask} hideProjectBadge={viewMode === "status"} hideStatusBadge={viewMode === "status"} /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
