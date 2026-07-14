"use client";

import { useEffect, useMemo, useState } from "react";
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors, closestCorners, useDroppable } from "@dnd-kit/core";
import { arrayMove, SortableContext, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Column } from "./Column";
import { TaskCard } from "./TaskCard";
import { getDays, formatDateStr } from "@/lib/date-utils";
import { startOfDay, addDays, format } from "date-fns";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Briefcase, Search, Circle, Clock, PauseCircle, CheckCircle2, Plus, SlidersHorizontal, Copy, Archive, Eye, EyeOff } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { NewTaskSheet } from "./NewTaskSheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@clerk/nextjs";

const KANBAN_COLUMN_WIDTH = 320;

export interface Task {
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
  const [endDate, setEndDate] = useState(() => format(new Date(), "yyyy-MM-dd'T'17:30"));
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
      setEndDate(format(new Date(), "yyyy-MM-dd'T'17:30"));
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
      className={`shrink-0 p-1.5 rounded-xl border transition-all duration-200 min-h-[80px] flex flex-col gap-1 relative group/cell ${
        isOver 
          ? "bg-primary/10 border-primary/40 shadow-sm" 
          : "bg-muted/10 border-border/30 hover:border-border/60"
      }`}
      style={{ width: KANBAN_COLUMN_WIDTH }}
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
                  onClick={(e) => { try { e.currentTarget.showPicker(); } catch (err) {} }}
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

function ProjectHeaderCell({ project, totalTasks }: { project: any; totalTasks: number }) {
  const { userId } = useAuth();
  const createProject = useMutation(api.projects.createProject);
  const cloneProject = useMutation(api.projects.cloneProject);
  const [newProjectName, setNewProjectName] = useState("");
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [cloneProjectName, setCloneProjectName] = useState("");
  const [isClonePopoverOpen, setIsClonePopoverOpen] = useState(false);

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

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim() || !userId) return;
    try {
      await createProject({
        userId,
        name: newProjectName.trim(),
      });
      setNewProjectName("");
      setIsPopoverOpen(false);
    } catch (err) {
      console.error(err);
    }
  };

  const handleOpenCloneChange = (open: boolean) => {
    setIsClonePopoverOpen(open);
    if (open) {
      setCloneProjectName(`${project.name} (Copy)`);
    }
  };

  const handleCloneProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cloneProjectName.trim() || !userId) return;
    try {
      await cloneProject({
        projectId: project._id,
        userId,
        name: cloneProjectName.trim(),
      });
      setIsClonePopoverOpen(false);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(project._id === "none" ? {} : attributes)}
      {...(project._id === "none" ? {} : listeners)}
      className={`w-[48px] shrink-0 p-1.5 rounded-lg border border-border/80 bg-zinc-50 dark:bg-zinc-900 sticky left-0 z-20 flex flex-col justify-between items-center gap-1.5 shadow-sm relative overflow-hidden group ${
        project._id === "none" ? "" : "cursor-grab active:cursor-grabbing hover:border-primary/40 hover:bg-zinc-100 dark:hover:bg-zinc-800"
      }`}
    >
      {/* Top accent color dot */}
      <div 
        className="w-1.5 h-1.5 rounded-full shrink-0 mt-0.5"
        style={{ backgroundColor: project.color || (project._id === "none" ? "#64748b" : "#8b5cf6") }}
      />
      
      {/* Vertical name */}
      <span 
        className="text-[10px] font-bold text-foreground tracking-wide whitespace-nowrap text-center block select-none max-w-[80px] truncate"
        style={{ writingMode: 'vertical-lr', transform: 'rotate(180deg)' }}
        title={project.name}
      >
        {project.name}
      </span>
      
      {/* Bottom Area: Count & Optional Add/Clone Button */}
      <div className="flex flex-col items-center gap-1 w-full shrink-0">
        <span className="text-[9px] text-muted-foreground/80 font-bold bg-muted px-1 py-0.5 rounded leading-none">
          {totalTasks}
        </span>
        
        {project._id === "none" ? (
          <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
            <PopoverTrigger
              className="h-5 w-5 p-0 rounded hover:bg-primary/10 hover:text-primary transition-colors cursor-pointer shrink-0 mt-0.5 flex items-center justify-center border border-transparent hover:border-primary/20 bg-transparent text-muted-foreground hover:text-foreground"
              title="Thêm dự án nhanh"
            >
              <Plus className="w-3 h-3 text-primary" />
            </PopoverTrigger>
            <PopoverContent side="right" align="end" className="w-64 bg-card/98 backdrop-blur-xl border border-border p-3 shadow-xl rounded-xl z-50">
              <form onSubmit={handleCreateProject} className="flex flex-col gap-2.5">
                <div className="text-xs font-bold text-foreground">Tạo nhanh dự án</div>
                <Input
                  placeholder="Tên dự án mới..."
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  autoFocus
                  className="h-8 text-xs bg-background/50 border-border rounded-lg px-2"
                  required
                />
                <div className="flex justify-end gap-1.5 pt-1.5 border-t border-border">
                  <Button type="submit" size="sm" className="h-7 text-xs rounded-lg px-2.5 font-semibold cursor-pointer">
                    Tạo mới
                  </Button>
                </div>
              </form>
            </PopoverContent>
          </Popover>
        ) : (
          <Popover open={isClonePopoverOpen} onOpenChange={handleOpenCloneChange}>
            <PopoverTrigger
              className="h-5 w-5 p-0 rounded hover:bg-primary/10 hover:text-primary transition-colors cursor-pointer shrink-0 mt-0.5 flex items-center justify-center border border-transparent bg-transparent text-muted-foreground/60 hover:text-primary"
              title="Nhân bản dự án"
              onClick={(e) => e.stopPropagation()}
            >
              <Copy className="w-3 h-3" />
            </PopoverTrigger>
            <PopoverContent side="right" align="end" className="w-64 bg-card/98 backdrop-blur-xl border border-border p-3 shadow-xl rounded-xl z-50" onClick={(e) => e.stopPropagation()}>
              <form onSubmit={handleCloneProject} className="flex flex-col gap-2.5">
                <div className="text-xs font-bold text-foreground">Nhân bản dự án</div>
                <div className="text-[10px] text-muted-foreground leading-normal">
                  Sao chép toàn bộ công việc sang dự án mới ở trạng thái Chưa thực hiện.
                </div>
                <Input
                  placeholder="Tên dự án mới..."
                  value={cloneProjectName}
                  onChange={(e) => setCloneProjectName(e.target.value)}
                  autoFocus
                  className="h-8 text-xs bg-background/50 border-border rounded-lg px-2"
                  required
                />
                <div className="flex justify-end gap-1.5 pt-1.5 border-t border-border">
                  <Button type="submit" size="sm" className="h-7 text-xs rounded-lg px-2.5 font-semibold cursor-pointer">
                    Nhân bản
                  </Button>
                </div>
              </form>
            </PopoverContent>
          </Popover>
        )}
      </div>
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
    order?: number;
  }[];
  showFilters?: boolean;
}

export function KanbanBoard({ 
  tasks, 
  onUpdateTask, 
  projects,
  showFilters = false
}: KanbanBoardProps) {
  const { userId } = useAuth();
  const updateTaskOrders = useMutation(api.tasks.updateTaskOrders);
  const updateProjectOrders = useMutation(api.projects.updateProjectOrders);
  const createProject = useMutation(api.projects.createProject);
  const updatePreferences = useMutation(api.userPreferences.updateUserPreferences);
  const userPreferences = useQuery(api.userPreferences.getUserPreferences, userId ? { userId } : "skip");
  
  const [baseDate, setBaseDate] = useState(() => startOfDay(new Date()));
  const days = useMemo(() => getDays(baseDate, 7), [baseDate]);
  
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [viewMode, setViewMode] = useState<"date" | "status">("status");

  // Filtering and sorting states
  const [searchQuery, setSearchQuery] = useState("");
  const [filterProject, setFilterProject] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"order" | "endDate" | "priority">("endDate");
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  
  const [hideDoneTasks, setHideDoneTasks] = useState(false);

  useEffect(() => {
    if (userPreferences !== undefined) {
      setHideDoneTasks(userPreferences.hideDoneTasks);
    }
  }, [userPreferences]);

  const handleHideDoneTasksChange = (value: boolean) => {
    setHideDoneTasks(value);
    if (userId) {
      void updatePreferences({ userId, hideDoneTasks: value });
    }
  };

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim() || !userId) return;
    try {
      await createProject({
        userId,
        name: newProjectName.trim(),
      });
      setNewProjectName("");
      setIsPopoverOpen(false);
    } catch (err) {
      console.error(err);
    }
  };

  // Filter tasks
  const filteredTasks = useMemo(() => {
    return tasks.filter(task => {
      if (hideDoneTasks && task.status === "done") return false;
      const matchesSearch = task.title.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = filterStatus === "all" || task.status === filterStatus;
      
      const taskProject = task.project || "none";
      const matchesProject = filterProject === "all" || taskProject === filterProject;
      
      return matchesSearch && matchesStatus && matchesProject;
    });
  }, [tasks, searchQuery, filterProject, filterStatus, hideDoneTasks]);

  // Compute overdue tasks (uncompleted tasks with start date before today)
  const overdueTasks = useMemo(() => {
    const todayStart = startOfDay(new Date()).getTime();
    return filteredTasks.filter(task => {
      if (!task.startDate) return false;
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
      const isBeforeToday = task.startDate ? startOfDay(new Date(task.startDate)).getTime() < todayStart : false;
      const isNotDone = task.status !== "done";
      if (isBeforeToday && isNotDone) {
        return;
      }

      if (!task.startDate) return;
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
    list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
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
    
    const sortedTasks = [...filteredTasks].sort((a, b) => {
      if (sortBy === "endDate") {
        const aVal = a.endDate ? Math.floor(a.endDate / 60000) * 60000 : Infinity;
        const bVal = b.endDate ? Math.floor(b.endDate / 60000) * 60000 : Infinity;
        if (aVal !== bVal) {
          return aVal - bVal;
        }
        // If end dates are equal, sort by priority (high priority first)
        const prioWeight = { high: 3, normal: 2, low: 1 };
        const aPrio = prioWeight[a.priority as "high" | "normal" | "low"] || 0;
        const bPrio = prioWeight[b.priority as "high" | "normal" | "low"] || 0;
        return bPrio - aPrio;
      }
      if (sortBy === "priority") {
        const prioWeight = { high: 3, normal: 2, low: 1 };
        const aVal = prioWeight[a.priority as "high" | "normal" | "low"] || 0;
        const bVal = prioWeight[b.priority as "high" | "normal" | "low"] || 0;
        if (aVal !== bVal) {
          return bVal - aVal;
        }
        // If priorities are equal, sub-sort by endDate (soonest first)
        const aDate = a.endDate || Infinity;
        const bDate = b.endDate || Infinity;
        return aDate - bDate;
      }
      return (a.order ?? 0) - (b.order ?? 0);
    });
    
    console.log("DEBUG SORTED TASKS:", sortBy, sortedTasks.map(t => ({ title: t.title, endDate: t.endDate, priority: t.priority })));
    
    sortedTasks.forEach(task => {
      const projId = task.project || "none";
      const status = task.status || "todo";
      const targetProjId = grouped[projId] ? projId : "none";
      
      if (grouped[targetProjId] && grouped[targetProjId][status]) {
        grouped[targetProjId][status].push(task);
      }
    });
    
    return grouped;
  }, [filteredTasks, projectsList, sortBy]);

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

    // Dragged a Project row
    if (active.data.current?.type === "Project") {
      const activeProjId = active.id;
      const overProjId = over.id;
      
      if (activeProjId !== overProjId && overProjId !== "none" && activeProjId !== "none") {
        const realProjects = projects ? [...projects] : [];
        realProjects.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        
        const activeIndex = realProjects.findIndex(p => p._id === activeProjId);
        const overIndex = realProjects.findIndex(p => p._id === overProjId);
        
        if (activeIndex !== -1 && overIndex !== -1) {
          const reordered = arrayMove(realProjects, activeIndex, overIndex);
          const updates = reordered.map((p, index) => ({
            id: p._id as any,
            order: index * 1000,
          }));
          updateProjectOrders({ updates });
        }
      }
      return;
    }

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

      const targetDateStr = formatDateStr(startOfDay(new Date(overTask.startDate || Date.now())));
      const newStartDate = startOfDay(new Date(targetDateStr)).getTime();

      const activeTaskData = active.data.current?.task as Task;
      const sourceDateStr = formatDateStr(startOfDay(new Date(activeTaskData.startDate || Date.now())));

      const todayStart = startOfDay(new Date()).getTime();
      const isActiveOverdue = activeTaskData.startDate ? startOfDay(new Date(activeTaskData.startDate)).getTime() < todayStart && activeTaskData.status !== "done" : false;

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
    <div className="flex flex-col h-full min-h-0 gap-3">
      {/* Combined Single-Row Header & Filter Bar */}
      <div className="flex flex-col gap-2 glass p-2 rounded-xl border border-border/60 shadow-md shrink-0 w-full">
        {/* Main Row */}
        <div className="flex items-center justify-between gap-2 w-full">
          {/* Left section: Title + Toggle button */}
          <div className="flex items-center gap-1.5 shrink-0">
            <h2 className="text-xs font-bold uppercase tracking-widest text-foreground/80 shrink-0 select-none w-[180px] text-left flex items-center pl-2">
              {viewMode === "status" ? "Kanban" : "Workload"}
            </h2>
            <Button 
              variant="outline" 
              size="sm" 
              className="md:hidden h-7 w-7 p-0 rounded-lg border-border/60 text-muted-foreground hover:text-foreground cursor-pointer"
              onClick={() => setShowMobileFilters(!showMobileFilters)}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
            </Button>
          </div>

          {/* Desktop Filters (Hidden on mobile, inline on desktop) */}
          <div className="hidden md:flex items-center gap-1.5 flex-1">
            {/* Date Navigation (Only visible in Workload View Mode) */}
            {viewMode === "date" && (
              <div className="flex items-center gap-0.5 shrink-0">
                <Button variant="outline" size="sm" className="h-7 w-7 p-0 rounded-lg border-border/60 hover:bg-muted/50 cursor-pointer" onClick={() => setBaseDate(d => addDays(d, -7))}>
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
                <Button variant="outline" size="sm" className="h-7 px-2 rounded-lg border-border/60 hover:bg-muted/50 font-medium cursor-pointer text-[10px]" onClick={() => setBaseDate(startOfDay(new Date()))}>
                  Hôm nay
                </Button>
                <Button variant="outline" size="sm" className="h-7 w-7 p-0 rounded-lg border-border/60 hover:bg-muted/50 cursor-pointer" onClick={() => setBaseDate(d => addDays(d, 7))}>
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            )}

            {/* Search Bar */}
            <div className="relative w-full sm:w-44">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
              <Input
                placeholder="Tìm kiếm..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-7 h-7 text-[10px] bg-background/50 border-border/60 rounded-lg w-full"
              />
            </div>

            {/* Project Filter */}
            <div className="w-full sm:w-auto sm:min-w-[7.5rem] sm:max-w-[11rem]">
              <Select value={filterProject} onValueChange={(val) => setFilterProject(val || "all")}>
                <SelectTrigger className="bg-background/50 hover:bg-background border-border/60 text-foreground h-7 px-1.5 rounded-lg text-[10px] font-medium focus-visible:ring-primary/50 cursor-pointer flex items-center gap-1 shadow-sm w-full truncate">
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
                  <SelectItem value="all" className="text-[10px] cursor-pointer">Dự án: Tất cả</SelectItem>
                  <SelectItem value="none" className="text-[10px] cursor-pointer italic text-muted-foreground">Không có dự án</SelectItem>
                  {projects?.map((p) => (
                    <SelectItem key={p._id} value={p._id} className="text-[10px] cursor-pointer">
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Status Filter */}
            <div className="w-full sm:w-28">
              <Select value={filterStatus} onValueChange={(val) => setFilterStatus(val || "all")}>
                <SelectTrigger className="bg-background/50 hover:bg-background border-border/60 text-foreground h-7 px-1.5 rounded-lg text-[10px] font-medium focus-visible:ring-primary/50 cursor-pointer flex items-center gap-1 shadow-sm w-full">
                  <SelectValue placeholder="Trạng thái: Tất cả">
                    {filterStatus === "all" ? (
                      <span className="flex items-center gap-1">
                        <Circle className="w-2.5 h-2.5 text-muted-foreground" />
                        Trạng thái: Tất cả
                      </span>
                    ) : filterStatus === "todo" ? (
                      <span className="flex items-center gap-1 text-neutral-500">
                        <Circle className="w-2.5 h-2.5 text-neutral-400" />
                        Chưa thực hiện
                      </span>
                    ) : filterStatus === "processing" ? (
                      <span className="flex items-center gap-1 text-blue-500">
                        <Clock className="w-2.5 h-2.5 animate-pulse" />
                        Đang xử lý
                      </span>
                    ) : filterStatus === "pending" ? (
                      <span className="flex items-center gap-1 text-amber-500">
                        <PauseCircle className="w-2.5 h-2.5" />
                        Tạm dừng
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-emerald-500">
                        <CheckCircle2 className="w-2.5 h-2.5" />
                        Đã hoàn thành
                      </span>
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="bg-card/95 backdrop-blur-xl border-border">
                  <SelectItem value="all" className="text-[10px] cursor-pointer">
                    <span className="flex items-center gap-1">
                      <Circle className="w-3 h-3 text-muted-foreground" />
                      Trạng thái: Tất cả
                    </span>
                  </SelectItem>
                  <SelectItem value="todo" className="text-[10px] cursor-pointer">
                    <span className="flex items-center gap-1 text-neutral-500">
                      <Circle className="w-3 h-3 text-neutral-400" />
                      Chưa thực hiện
                    </span>
                  </SelectItem>
                  <SelectItem value="processing" className="text-[10px] cursor-pointer">
                    <span className="flex items-center gap-1 text-blue-500">
                      <Clock className="w-3 h-3" />
                      Đang xử lý
                    </span>
                  </SelectItem>
                  <SelectItem value="pending" className="text-[10px] cursor-pointer">
                    <span className="flex items-center gap-1 text-amber-500">
                      <PauseCircle className="w-3 h-3" />
                      Tạm dừng
                    </span>
                  </SelectItem>
                  <SelectItem value="done" className="text-[10px] cursor-pointer">
                    <span className="flex items-center gap-1 text-emerald-500">
                      <CheckCircle2 className="w-3 h-3" />
                      Đã hoàn thành
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Sort Select */}
            {viewMode === "status" && (
              <div className="w-full sm:w-28">
                <Select value={sortBy} onValueChange={(val) => setSortBy(val as any)}>
                  <SelectTrigger className="bg-background/50 hover:bg-background border-border/60 text-foreground h-7 px-1.5 rounded-lg text-[10px] font-medium focus-visible:ring-primary/50 cursor-pointer flex items-center gap-1 shadow-sm w-full">
                    <SelectValue placeholder="Sắp xếp: Mặc định">
                      {sortBy === "order" ? "Sắp xếp: Mặc định" : sortBy === "endDate" ? "Sắp xếp: Hạn chót" : "Sắp xếp: Độ ưu tiên"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="bg-card/95 backdrop-blur-xl border-border">
                    <SelectItem value="order" className="text-[10px] cursor-pointer">Sắp xếp: Mặc định</SelectItem>
                    <SelectItem value="endDate" className="text-[10px] cursor-pointer">Sắp xếp: Hạn chót</SelectItem>
                    <SelectItem value="priority" className="text-[10px] cursor-pointer">Sắp xếp: Độ ưu tiên</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Right Section: Toggle Switcher & Add Actions */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Toggle Switcher */}
            <div className="flex items-center bg-muted/40 border border-border/50 rounded-xl p-0.5 w-fit shadow-inner">
              <Button
                variant={viewMode === "status" ? "default" : "ghost"}
                size="sm"
                className={`h-6 px-2 rounded-lg text-[10px] font-semibold transition-all duration-200 cursor-pointer ${
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
                className={`h-6 px-2 rounded-lg text-[10px] font-semibold transition-all duration-200 cursor-pointer ${
                  viewMode === "date" 
                    ? "bg-background text-foreground shadow-sm hover:bg-background" 
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => setViewMode("date")}
              >
                Workload
              </Button>
            </div>

            {/* Popover Thêm Dự Án */}
            <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
              <PopoverTrigger className="px-2 h-7 bg-background border border-border text-foreground hover:bg-muted/50 text-[10px] font-semibold rounded-lg hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 cursor-pointer shadow-sm flex items-center gap-1">
                <Plus className="w-3 h-3 text-primary" /> Dự Án
              </PopoverTrigger>
              <PopoverContent className="w-64 bg-card/98 backdrop-blur-xl border border-border p-3 shadow-xl rounded-xl z-50">
                <form onSubmit={handleCreateProject} className="flex flex-col gap-2.5">
                  <div className="text-xs font-bold text-foreground">Tạo nhanh dự án</div>
                  <Input
                    placeholder="Tên dự án mới..."
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    autoFocus
                    className="h-8 text-xs bg-background/50 border-border rounded-lg px-2"
                    required
                  />
                  <div className="flex justify-end gap-1.5 pt-1.5 border-t border-border">
                    <Button type="submit" size="sm" className="h-7 text-xs rounded-lg px-2.5 font-semibold cursor-pointer">
                      Tạo mới
                    </Button>
                  </div>
                </form>
              </PopoverContent>
            </Popover>

            {/* NewTaskSheet Thêm Công Việc */}
            <NewTaskSheet>
              <button className="px-2 h-7 bg-foreground text-background text-[10px] font-semibold rounded-lg hover:opacity-90 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 cursor-pointer shadow-sm flex items-center gap-1">
                <Plus className="w-3 h-3" /> Công Việc
              </button>
            </NewTaskSheet>
          </div>
        </div>

        {/* Mobile Collapsible Filters Row */}
        {showMobileFilters && (
          <div className="md:hidden flex flex-col gap-2 pt-2 border-t border-border/40 w-full">
            {/* Date Navigation (Only visible in Workload View Mode) */}
            {viewMode === "date" && (
              <div className="flex items-center gap-1 w-full justify-between">
                <span className="text-[10px] text-muted-foreground">Thời gian:</span>
                <div className="flex items-center gap-0.5">
                  <Button variant="outline" size="sm" className="h-7 w-7 p-0 rounded-lg border-border/60 hover:bg-muted/50 cursor-pointer" onClick={() => setBaseDate(d => addDays(d, -7))}>
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 px-3 rounded-lg border-border/60 hover:bg-muted/50 font-medium cursor-pointer text-[10px]" onClick={() => setBaseDate(startOfDay(new Date()))}>
                    Hôm nay
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 w-7 p-0 rounded-lg border-border/60 hover:bg-muted/50 cursor-pointer" onClick={() => setBaseDate(d => addDays(d, 7))}>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            )}

            {/* Search Bar */}
            <div className="relative w-full">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
              <Input
                placeholder="Tìm kiếm..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-7 h-7 text-[10px] bg-background/50 border-border/60 rounded-lg w-full"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              {/* Project Filter */}
              <div className="w-full">
                <Select value={filterProject} onValueChange={(val) => setFilterProject(val || "all")}>
                  <SelectTrigger className="bg-background/50 hover:bg-background border-border/60 text-foreground h-7 px-1.5 rounded-lg text-[10px] font-medium focus-visible:ring-primary/50 cursor-pointer flex items-center gap-1 shadow-sm w-full truncate">
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
                    <SelectItem value="all" className="text-[10px] cursor-pointer">Dự án: Tất cả</SelectItem>
                    <SelectItem value="none" className="text-[10px] cursor-pointer italic text-muted-foreground">Không có dự án</SelectItem>
                    {projects?.map((p) => (
                      <SelectItem key={p._id} value={p._id} className="text-[10px] cursor-pointer">
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Status Filter */}
              <div className="w-full">
                <Select value={filterStatus} onValueChange={(val) => setFilterStatus(val || "all")}>
                  <SelectTrigger className="bg-background/50 hover:bg-background border-border/60 text-foreground h-7 px-1.5 rounded-lg text-[10px] font-medium focus-visible:ring-primary/50 cursor-pointer flex items-center gap-1 shadow-sm w-full">
                    <SelectValue placeholder="Trạng thái: Tất cả">
                      {filterStatus === "all" ? (
                        <span className="flex items-center gap-1">
                          <Circle className="w-2.5 h-2.5 text-muted-foreground" />
                          Trạng thái: Tất cả
                        </span>
                      ) : filterStatus === "todo" ? (
                        <span className="flex items-center gap-1 text-neutral-500">
                          <Circle className="w-2.5 h-2.5 text-neutral-400" />
                          Chưa thực hiện
                        </span>
                      ) : filterStatus === "processing" ? (
                        <span className="flex items-center gap-1 text-blue-500">
                          <Clock className="w-2.5 h-2.5 animate-pulse" />
                          Đang xử lý
                        </span>
                      ) : filterStatus === "pending" ? (
                        <span className="flex items-center gap-1 text-amber-500">
                          <PauseCircle className="w-2.5 h-2.5" />
                          Tạm dừng
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-emerald-500">
                          <CheckCircle2 className="w-2.5 h-2.5" />
                          Đã hoàn thành
                        </span>
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="bg-card/95 backdrop-blur-xl border-border">
                    <SelectItem value="all" className="text-[10px] cursor-pointer">
                      <span className="flex items-center gap-1">
                        <Circle className="w-3 h-3 text-muted-foreground" />
                        Trạng thái: Tất cả
                      </span>
                    </SelectItem>
                    <SelectItem value="todo" className="text-[10px] cursor-pointer">
                      <span className="flex items-center gap-1 text-neutral-500">
                        <Circle className="w-3 h-3 text-neutral-400" />
                        Chưa thực hiện
                      </span>
                    </SelectItem>
                    <SelectItem value="processing" className="text-[10px] cursor-pointer">
                      <span className="flex items-center gap-1 text-blue-500">
                        <Clock className="w-3 h-3" />
                        Đang xử lý
                      </span>
                    </SelectItem>
                    <SelectItem value="pending" className="text-[10px] cursor-pointer">
                      <span className="flex items-center gap-1 text-amber-500">
                        <PauseCircle className="w-3 h-3" />
                        Tạm dừng
                      </span>
                    </SelectItem>
                    <SelectItem value="done" className="text-[10px] cursor-pointer">
                      <span className="flex items-center gap-1 text-emerald-500">
                        <CheckCircle2 className="w-3 h-3" />
                        Đã hoàn thành
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Sort Select */}
            {viewMode === "status" && (
              <div className="w-full">
                <Select value={sortBy} onValueChange={(val) => setSortBy(val as any)}>
                  <SelectTrigger className="bg-background/50 hover:bg-background border-border/60 text-foreground h-7 px-1.5 rounded-lg text-[10px] font-medium focus-visible:ring-primary/50 cursor-pointer flex items-center gap-1 shadow-sm w-full">
                    <SelectValue placeholder="Sắp xếp: Mặc định">
                      {sortBy === "order" ? "Sắp xếp: Mặc định" : sortBy === "endDate" ? "Sắp xếp: Hạn chót" : "Sắp xếp: Độ ưu tiên"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent className="bg-card/95 backdrop-blur-xl border-border">
                    <SelectItem value="order" className="text-[10px] cursor-pointer">Sắp xếp: Mặc định</SelectItem>
                    <SelectItem value="endDate" className="text-[10px] cursor-pointer">Sắp xếp: Hạn chót</SelectItem>
                    <SelectItem value="priority" className="text-[10px] cursor-pointer">Sắp xếp: Độ ưu tiên</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}
      </div>

      <DndContext 
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className={`flex-1 min-h-0 overflow-auto pb-4 ${viewMode === "status" ? "" : "flex flex-row gap-3"}`}>
          {viewMode === "status" ? (
            <div className="flex flex-col gap-3.5 min-w-max">
              {/* Status Headers row — sticky when scrolling vertically */}
              <div className="flex gap-3 shrink-0 min-w-max pb-0.5 sticky top-0 z-40 bg-background/95 backdrop-blur-md pt-0.5 -mt-0.5">
                {/* Empty corner cell */}
                <div className="w-[48px] shrink-0 sticky left-0 z-50 bg-background/95 backdrop-blur-md border-r border-border/85 flex items-center justify-center py-1 select-none">
                  <span 
                    className="text-[8px] font-black uppercase tracking-wider text-muted-foreground/80 whitespace-nowrap"
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
                    className={`shrink-0 py-1 px-2 rounded-lg border font-bold text-[10px] uppercase tracking-wider flex items-center justify-between gap-1 shadow-sm ${col.colorClass}`}
                    style={{ width: KANBAN_COLUMN_WIDTH }}
                  >
                    {col.status === "done" ? (
                      <div className="w-5 shrink-0" />
                    ) : (
                      <div className="w-1 shrink-0" />
                    )}
                    
                    <span className="flex-1 text-center">{col.label}</span>
                    
                    {col.status === "done" ? (
                      <button
                        type="button"
                        className="w-5 h-5 flex items-center justify-center rounded hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 transition-colors cursor-pointer shrink-0"
                        title={hideDoneTasks ? "Hiện công việc đã xong" : "Ẩn công việc đã xong"}
                        onClick={() => handleHideDoneTasksChange(!hideDoneTasks)}
                      >
                        {hideDoneTasks ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      </button>
                    ) : (
                      <div className="w-1 shrink-0" />
                    )}
                  </div>
                ))}
              </div>

              {/* Swimlane rows */}
              <SortableContext items={projectsList.map((p) => p._id)} strategy={verticalListSortingStrategy}>
                {projectsList.map(p => {
                  const projectTasks = tasksByProjectAndStatus[p._id] || { todo: [], processing: [], pending: [], done: [] };
                  const totalProjTasks = projectTasks.todo.length + projectTasks.processing.length + projectTasks.pending.length + projectTasks.done.length;
                  
                  return (
                    <div key={p._id} className="flex gap-3 shrink-0 min-w-max items-stretch">
                      {/* Project Header Cell */}
                      <ProjectHeaderCell project={p} totalTasks={totalProjTasks} />
                      
                      {/* Status cells */}
                      <SwimlaneCell id={`${p._id}::todo`} project={p._id} status="todo" tasks={projectTasks.todo} />
                      <SwimlaneCell id={`${p._id}::processing`} project={p._id} status="processing" tasks={projectTasks.processing} />
                      <SwimlaneCell id={`${p._id}::pending`} project={p._id} status="pending" tasks={projectTasks.pending} />
                      <SwimlaneCell id={`${p._id}::done`} project={p._id} status="done" tasks={projectTasks.done} />
                    </div>
                  );
                })}
              </SortableContext>
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
