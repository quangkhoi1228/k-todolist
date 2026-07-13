"use client";

import { useMemo, useState } from "react";
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors, closestCorners } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { Column } from "./Column";
import { TaskCard } from "./TaskCard";
import { getDays, formatDateStr } from "@/lib/date-utils";
import { startOfDay, addDays } from "date-fns";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Briefcase, Search, Circle, Clock, PauseCircle, CheckCircle2 } from "lucide-react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";

export interface Task {
  _id: string;
  title: string;
  estimatedTime: number;
  startDate: number;
  pic?: string;
  project?: string;
  status?: string;
  order?: number;
  isOverflowing?: boolean;
}

interface KanbanBoardProps {
  tasks: Task[];
  onUpdateTask: (taskId: string, newStartDate: number) => void;
  projects?: {
    _id: string;
    name: string;
    color?: string;
    userId: string;
  }[];
}

export function KanbanBoard({ 
  tasks, 
  onUpdateTask, 
  projects 
}: KanbanBoardProps) {
  const updateTaskOrders = useMutation(api.tasks.updateTaskOrders);
  const [baseDate, setBaseDate] = useState(() => startOfDay(new Date()));
  const days = useMemo(() => getDays(baseDate, 7), [baseDate]);
  
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  // Filtering states
  const [searchQuery, setSearchQuery] = useState("");
  const [filterProject, setFilterProject] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

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

  // Group tasks by date string
  const tasksByDate = useMemo(() => {
    const grouped: Record<string, Task[]> = {};
    days.forEach(day => grouped[formatDateStr(day)] = []);
    
    // Sort tasks by order
    const sortedTasks = [...filteredTasks].sort((a, b) => (a.order || 0) - (b.order || 0));

    sortedTasks.forEach(task => {
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

    // 1. Dragged to a different column (date)
    if (over.data.current?.type === "Column") {
      const targetDateStr = over.data.current.dateStr;
      const newStartDate = startOfDay(new Date(targetDateStr)).getTime();
      onUpdateTask(activeId as string, newStartDate);
      return;
    }

    // 2. Dragged over a task
    if (over.data.current?.type === "Task") {
      const overTask = over.data.current.task as Task;
      const targetDateStr = formatDateStr(startOfDay(new Date(overTask.startDate)));
      const newStartDate = startOfDay(new Date(targetDateStr)).getTime();

      const activeTaskData = active.data.current?.task as Task;
      const sourceDateStr = formatDateStr(startOfDay(new Date(activeTaskData.startDate)));

      const sourceList = [...(tasksByDate[sourceDateStr] || [])];
      const targetList = sourceDateStr === targetDateStr ? sourceList : [...(tasksByDate[targetDateStr] || [])];

      const activeIndex = sourceList.findIndex((t) => t._id === activeId);
      const overIndex = targetList.findIndex((t) => t._id === overId);

      if (sourceDateStr === targetDateStr) {
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
    <div className="flex flex-col h-full gap-4">
      {/* Unified Filter Bar with Date Navigation */}
      <div className="flex flex-col md:flex-row gap-3 items-center justify-between glass p-2 rounded-xl border border-border/60 shadow-md shrink-0">
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 w-full md:w-auto">
          {/* Date Navigation */}
          <div className="flex items-center gap-1 col-span-2 sm:col-auto shrink-0 justify-between sm:justify-start">
            <Button variant="outline" size="sm" className="h-8 px-2 rounded-lg border-border/60 hover:bg-muted/50 cursor-pointer text-xs flex-1 sm:flex-initial text-center" onClick={() => setBaseDate(d => addDays(d, -7))}>
              <ChevronLeft className="w-3.5 h-3.5 mr-0.5" /> Trước
            </Button>
            <Button variant="outline" size="sm" className="h-8 px-2 rounded-lg border-border/60 hover:bg-muted/50 font-medium cursor-pointer text-xs flex-1 sm:flex-initial text-center" onClick={() => setBaseDate(startOfDay(new Date()))}>
              <CalendarIcon className="w-3 h-3 mr-0.5" /> Hôm nay
            </Button>
            <Button variant="outline" size="sm" className="h-8 px-2 rounded-lg border-border/60 hover:bg-muted/50 cursor-pointer text-xs flex-1 sm:flex-initial text-center" onClick={() => setBaseDate(d => addDays(d, 7))}>
              Sau <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
            </Button>
          </div>

          <div className="h-5 w-[1px] bg-border/80 self-center hidden sm:block" />

          {/* Search Bar */}
          <div className="relative col-span-2 sm:w-52">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Tìm kiếm công việc..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-8 text-[11px] bg-background/50 border-border/60 rounded-lg w-full"
            />
          </div>

          {/* Project Filter */}
          <div className="col-span-1 sm:w-36">
            <Select value={filterProject} onValueChange={(val) => setFilterProject(val || "all")}>
              <SelectTrigger className="bg-background/50 hover:bg-background border-border/60 text-foreground h-8 px-2 rounded-lg text-[11px] font-medium focus-visible:ring-primary/50 cursor-pointer flex items-center gap-1 shadow-sm w-full">
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
          <div className="col-span-1 sm:w-36">
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
      </div>
      <DndContext 
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-3 overflow-x-auto pb-4 h-full">
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
      </div>
      
        <DragOverlay>
          {activeTask ? <TaskCard task={activeTask} /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
