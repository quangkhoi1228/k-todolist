"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useAuth } from "@clerk/nextjs";
import { Gantt, Task as GanttTask, ViewMode } from "gantt-task-react";
import "gantt-task-react/dist/index.css";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { addDays } from "date-fns";
import { NewTaskSheet, TaskData } from "@/components/board/NewTaskSheet";
import { Id } from "../../../../convex/_generated/dataModel";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Briefcase, Circle, Search, Clock, PauseCircle, CheckCircle2, SlidersHorizontal, Plus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAutoShiftTasks } from "@/hooks/useAutoShiftTasks";

export default function GanttPage() {
  const { userId } = useAuth();
  const tasks = useQuery(api.tasks.getTasks, userId ? { userId } : "skip");
  const projects = useQuery(api.projects.getProjects, userId ? { userId } : "skip");

  // Automatically shift overdue processing tasks to today
  useAutoShiftTasks(tasks);

  const updateTask = useMutation(api.tasks.updateTask);
  const createProject = useMutation(api.projects.createProject);

  const [view, setView] = useState<ViewMode>(ViewMode.Day);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<TaskData | undefined>(undefined);

  // Filtering states
  const [showFilters, setShowFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterProject, setFilterProject] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  // Project creation states
  const [newProjectName, setNewProjectName] = useState("");
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);

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

  const getTaskColors = (status: string) => {
    switch (status) {
      case "done":
        return {
          backgroundColor: "rgba(16, 185, 129, 0.15)",
          backgroundSelectedColor: "rgba(16, 185, 129, 0.25)",
          progressColor: "#10b981",
          progressSelectedColor: "#059669",
        };
      case "processing":
        return {
          backgroundColor: "rgba(59, 130, 246, 0.15)",
          backgroundSelectedColor: "rgba(59, 130, 246, 0.25)",
          progressColor: "#3b82f6",
          progressSelectedColor: "#2563eb",
        };
      case "pending":
        return {
          backgroundColor: "rgba(245, 158, 11, 0.15)",
          backgroundSelectedColor: "rgba(245, 158, 11, 0.25)",
          progressColor: "#f59e0b",
          progressSelectedColor: "#d97706",
        };
      default: // todo
        return {
          backgroundColor: "rgba(168, 85, 247, 0.15)",
          backgroundSelectedColor: "rgba(168, 85, 247, 0.25)",
          progressColor: "#a855f7",
          progressSelectedColor: "#9333ea",
        };
    }
  };

  // Filter tasks
  const filteredTasks = useMemo(() => {
    const activeProjectIds = new Set((projects ?? []).map((p) => p._id));
    return (tasks || []).filter(task => {
      if (task.project && task.project !== "none" && projects && !activeProjectIds.has(task.project)) {
        return false;
      }
      const matchesSearch = task.title.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = filterStatus === "all" || task.status === filterStatus;
      
      const taskProject = task.project || "none";
      const matchesProject = filterProject === "all" || taskProject === filterProject;
      
      return matchesSearch && matchesStatus && matchesProject;
    });
  }, [tasks, projects, searchQuery, filterProject, filterStatus]);

  const ganttTasks: GanttTask[] = useMemo(() => {
    return filteredTasks
      .filter((task) => task.startDate && task.endDate)
      .map((task) => ({
        start: new Date(task.startDate!),
        end: new Date(task.endDate! > task.startDate! ? task.endDate! : addDays(new Date(task.startDate!), 1).getTime()), // ensure end is after start for display
        name: task.title,
        id: task._id,
        type: "task",
        progress: task.status === "done" ? 100 : task.status === "processing" ? 50 : 0,
        isDisabled: false,
        styles: getTaskColors(task.status || "todo"),
      }));
  }, [filteredTasks]);

  const handleDateChange = async (task: GanttTask) => {
    try {
      await updateTask({
        id: task.id as Id<"tasks">,
        startDate: task.start.getTime(),
        endDate: task.end.getTime(),
      });
    } catch (error) {
      console.error("Failed to update task dates", error);
    }
  };

  const handleDoubleClick = (task: GanttTask) => {
    const originalTask = tasks?.find((t) => t._id === task.id);
    if (originalTask) {
      setSelectedTask(originalTask);
      setIsEditOpen(true);
    }
  };

  return (
    <div className="p-3 h-full min-h-0 flex flex-col gap-2">
      {/* Combined Single-Row Header & Filter Bar */}
      <div className="flex flex-col gap-2 glass p-2 rounded-xl border border-border/60 shadow-md shrink-0 w-full">
        {/* Main Row */}
        <div className="flex items-center justify-between gap-2 w-full">
          {/* Left section: Title + Toggle button */}
          <div className="flex items-center gap-1.5 shrink-0">
            <h2 className="text-xs font-bold uppercase tracking-widest text-foreground/80 shrink-0 select-none w-[180px] text-left flex items-center pl-2">
              Gantt
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
          </div>

          {/* Right Section: Switcher & Add Actions */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* View Mode controls (Always rendered) */}
            <div className="flex gap-1 bg-black/20 p-1 rounded-xl border border-white/5 w-full md:w-auto shrink-0 justify-center">
              <Button variant={view === ViewMode.Day ? "default" : "ghost"} className={`h-6 px-2 text-[10px] ${view === ViewMode.Day ? 'rounded-lg shadow-sm' : 'rounded-lg text-neutral-400 hover:text-white'}`} onClick={() => setView(ViewMode.Day)}>Day</Button>
              <Button variant={view === ViewMode.Week ? "default" : "ghost"} className={`h-6 px-2 text-[10px] ${view === ViewMode.Week ? 'rounded-lg shadow-sm' : 'rounded-lg text-neutral-400 hover:text-white'}`} onClick={() => setView(ViewMode.Week)}>Week</Button>
              <Button variant={view === ViewMode.Month ? "default" : "ghost"} className={`h-6 px-2 text-[10px] ${view === ViewMode.Month ? 'rounded-lg shadow-sm' : 'rounded-lg text-neutral-400 hover:text-white'}`} onClick={() => setView(ViewMode.Month)}>Month</Button>
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
          </div>
        )}
      </div>

      {/* Gantt Body */}
      <div className="flex-1 min-h-0 glass-panel rounded-2xl overflow-hidden p-4">
        {tasks === undefined ? (
          <div className="text-neutral-500 text-center py-12 text-xs">Loading Gantt Chart...</div>
        ) : ganttTasks.length > 0 ? (
          <div className="h-full w-full custom-gantt-container">
            <Gantt
              tasks={ganttTasks}
              viewMode={view}
              listCellWidth="155px"
              columnWidth={60}
              onDateChange={handleDateChange}
              onDoubleClick={handleDoubleClick}
              todayColor="rgba(168, 85, 247, 0.1)"
              arrowColor="var(--border)"
            />
          </div>
        ) : (
          <div className="text-neutral-500 text-center py-12 text-xs">Không tìm thấy công việc nào phù hợp.</div>
        )}
      </div>

      {selectedTask && (
        <NewTaskSheet
          open={isEditOpen}
          onOpenChange={setIsEditOpen}
          editTask={selectedTask}
        />
      )}
    </div>
  );
}
