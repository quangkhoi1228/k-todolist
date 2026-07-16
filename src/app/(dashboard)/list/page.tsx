"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { useAuth } from "@clerk/nextjs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { NewTaskSheet } from "@/components/board/NewTaskSheet";
import { formatHours, parseTimeToHours } from "@/lib/time-utils";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  MoreHorizontal, 
  Pencil, 
  Trash2, 
  Circle, 
  Clock, 
  PauseCircle, 
  CheckCircle2, 
  Briefcase,
  Search,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  SlidersHorizontal,
  Plus
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useAutoShiftTasks } from "@/hooks/useAutoShiftTasks";

export default function ListPage() {
  const { userId } = useAuth();
  
  const tasks = useQuery(api.tasks.getTasks, userId ? { userId } : "skip");
  const projects = useQuery(api.projects.getProjects, userId ? { userId } : "skip");

  // Automatically shift overdue processing tasks to today
  useAutoShiftTasks(tasks);

  const updateTask = useMutation(api.tasks.updateTask);
  const deleteTask = useMutation(api.tasks.deleteTask);
  const createProject = useMutation(api.projects.createProject);

  const [editOpen, setEditOpen] = useState<Record<string, boolean>>({});
  
  // Inline quick editing states
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [tempTitle, setTempTitle] = useState("");

  const [editingTimeId, setEditingTimeId] = useState<string | null>(null);
  const [tempTime, setTempTime] = useState("");

  const [editingDateId, setEditingDateId] = useState<string | null>(null);
  const [tempDate, setTempDate] = useState("");

  const [editingEndDateId, setEditingEndDateId] = useState<string | null>(null);
  const [tempEndDate, setTempEndDate] = useState("");

  // Filtering states
  const [showFilters, setShowFilters] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterProject, setFilterProject] = useState<string>("all");
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

  // Sorting states
  const [sortField, setSortField] = useState<"title" | "project" | "startDate" | "endDate" | "estimatedTime" | "status" | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const handleUpdateStatus = async (taskId: string, newStatus: string) => {
    await updateTask({
      id: taskId as Id<"tasks">,
      status: newStatus,
    });
  };

  const handleDelete = async (taskId: string) => {
    const confirmDelete = window.confirm("Bạn có chắc chắn muốn xóa công việc này?");
    if (!confirmDelete) return;
    await deleteTask({ id: taskId as Id<"tasks"> });
  };

  const handleSaveTitle = async (taskId: string) => {
    if (tempTitle.trim()) {
      await updateTask({
        id: taskId as Id<"tasks">,
        title: tempTitle.trim(),
      });
    }
    setEditingTitleId(null);
  };

  const handleSaveTime = async (taskId: string) => {
    const parsed = parseTimeToHours(tempTime);
    await updateTask({
      id: taskId as Id<"tasks">,
      estimatedTime: parsed || 0.25,
    });
    setEditingTimeId(null);
  };

  const handleSaveDate = async (taskId: string) => {
    await updateTask({
      id: taskId as Id<"tasks">,
      startDate: tempDate ? new Date(tempDate).getTime() : null,
    });
    setEditingDateId(null);
  };

  const handleSaveEndDate = async (taskId: string) => {
    await updateTask({
      id: taskId as Id<"tasks">,
      endDate: tempEndDate ? new Date(tempEndDate).getTime() : null,
    });
    setEditingEndDateId(null);
  };

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      if (sortDirection === "asc") {
        setSortDirection("desc");
      } else {
        setSortField(null); // Reset sort
      }
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const renderSortIcon = (field: typeof sortField) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 inline text-muted-foreground/30 group-hover:text-muted-foreground/70 transition-colors" />;
    return sortDirection === "asc" 
      ? <ArrowUp className="w-3 h-3 ml-1 inline text-primary" />
      : <ArrowDown className="w-3 h-3 ml-1 inline text-primary" />;
  };

  // Basic implementation to highlight overflowing tasks
  const processedTasks = (tasks || []).slice().sort((a, b) => (a.startDate || 0) - (b.startDate || 0));
  const dailyHours: Record<string, number> = {};

  const tasksWithOverflow = processedTasks.map(task => {
    if (!task.startDate) {
      return {
        ...task,
        isOverflowing: false
      };
    }
    const dateStr = format(new Date(task.startDate), "yyyy-MM-dd");
    if (!dailyHours[dateStr]) dailyHours[dateStr] = 0;
    dailyHours[dateStr] += task.estimatedTime;
    
    return {
      ...task,
      isOverflowing: dailyHours[dateStr] > 8
    };
  });

  // Filter tasks
  const activeProjectIds = new Set((projects ?? []).map((p) => p._id));
  const filteredTasks = tasksWithOverflow.filter(task => {
    if (task.project && task.project !== "none" && projects && !activeProjectIds.has(task.project)) {
      return false;
    }
    const matchesSearch = task.title.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = filterStatus === "all" || task.status === filterStatus;
    
    const taskProject = task.project || "none";
    const matchesProject = filterProject === "all" || taskProject === filterProject;
    
    return matchesSearch && matchesStatus && matchesProject;
  });

  // Sort tasks
  const sortedTasks = [...filteredTasks].sort((a, b) => {
    if (!sortField) return 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let aValue: any = a[sortField];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let bValue: any = b[sortField];

    // Custom resolving for special fields
    if (sortField === "project") {
      const aProj = a.project && a.project !== "none" ? projects?.find(p => p._id === a.project)?.name || "" : "";
      const bProj = b.project && b.project !== "none" ? projects?.find(p => p._id === b.project)?.name || "" : "";
      aValue = aProj.toLowerCase();
      bValue = bProj.toLowerCase();
    } else if (sortField === "title") {
      aValue = (aValue || "").toLowerCase();
      bValue = (bValue || "").toLowerCase();
    } else if (sortField === "status") {
      const statusOrder: Record<string, number> = { todo: 1, processing: 2, pending: 3, done: 4 };
      aValue = statusOrder[aValue || "todo"] || 0;
      bValue = statusOrder[bValue || "todo"] || 0;
    }

    if (aValue < bValue) return sortDirection === "asc" ? -1 : 1;
    if (aValue > bValue) return sortDirection === "asc" ? 1 : -1;
    return 0;
  });

  return (
    <div className="p-3 h-full min-h-0 flex flex-col gap-2">
      {/* Combined Single-Row Header & Filter Bar */}
      <div className="flex flex-col gap-2 glass p-2 rounded-xl border border-border/60 shadow-md shrink-0 w-full">
        {/* Main Row */}
        <div className="flex items-center justify-between gap-2 w-full">
          {/* Left section: Title + Toggle button */}
          <div className="flex items-center gap-1.5 shrink-0">
            <h2 className="text-xs font-bold uppercase tracking-widest text-foreground/80 shrink-0 select-none w-[180px] text-left flex items-center pl-2">
              Danh sách
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

          {/* Right Section: Add Actions */}
          <div className="flex items-center gap-1.5 shrink-0">
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

      {/* Tasks Table */}
      <div className="flex-1 min-h-0 overflow-hidden glass-panel rounded-2xl">
        {tasks === undefined ? (
          <div className="p-8 text-center text-neutral-400">Loading tasks...</div>
        ) : (
          <div className="h-full overflow-auto">
            <Table>
              <TableHeader className="bg-black/40 sticky top-0 z-10">
                <TableRow className="border-white/5 hover:bg-transparent">
                  <TableHead 
                    className="text-neutral-400 font-bold text-[10px] uppercase tracking-wider cursor-pointer hover:bg-white/5 select-none transition-colors group py-2"
                    onClick={() => handleSort("title")}
                  >
                    <div className="flex items-center">
                      Công việc
                      {renderSortIcon("title")}
                    </div>
                  </TableHead>
                  <TableHead 
                    className="text-neutral-400 font-bold text-[10px] uppercase tracking-wider cursor-pointer hover:bg-white/5 select-none transition-colors group py-2"
                    onClick={() => handleSort("project")}
                  >
                    <div className="flex items-center">
                      Dự án
                      {renderSortIcon("project")}
                    </div>
                  </TableHead>
                  <TableHead 
                    className="text-neutral-400 font-bold text-[10px] uppercase tracking-wider cursor-pointer hover:bg-white/5 select-none transition-colors group py-2"
                    onClick={() => handleSort("startDate")}
                  >
                    <div className="flex items-center">
                      Ngày bắt đầu
                      {renderSortIcon("startDate")}
                    </div>
                  </TableHead>
                  <TableHead 
                    className="text-neutral-400 font-bold text-[10px] uppercase tracking-wider cursor-pointer hover:bg-white/5 select-none transition-colors group py-2"
                    onClick={() => handleSort("endDate")}
                  >
                    <div className="flex items-center">
                      Ngày kết thúc
                      {renderSortIcon("endDate")}
                    </div>
                  </TableHead>
                  <TableHead 
                    className="text-neutral-400 font-bold text-[10px] uppercase tracking-wider cursor-pointer hover:bg-white/5 select-none transition-colors group text-right py-2"
                    onClick={() => handleSort("estimatedTime")}
                  >
                    <div className="flex items-center justify-end">
                      Thời gian dự kiến
                      {renderSortIcon("estimatedTime")}
                    </div>
                  </TableHead>
                  <TableHead className="text-neutral-400 font-bold text-[10px] uppercase tracking-wider py-2">Người phụ trách</TableHead>
                  <TableHead 
                    className="text-neutral-400 font-bold text-[10px] uppercase tracking-wider cursor-pointer hover:bg-white/5 select-none transition-colors group py-2"
                    onClick={() => handleSort("status")}
                  >
                    <div className="flex items-center">
                      Trạng thái
                      {renderSortIcon("status")}
                    </div>
                  </TableHead>
                  <TableHead className="text-neutral-400 font-bold text-[10px] uppercase tracking-wider text-right py-2">Thao tác</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedTasks.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-neutral-500 py-12 text-xs">
                      Không tìm thấy công việc nào phù hợp.
                    </TableCell>
                  </TableRow>
                ) : (
                  sortedTasks.map(task => {
                    const projectName = task.project && task.project !== "none"
                      ? projects?.find(p => p._id === task.project)?.name || "Unknown Project"
                      : null;

                    return (
                      <TableRow key={task._id} className="border-white/5 hover:bg-white/5 transition-colors group">
                        <TableCell className="font-semibold text-neutral-200 group-hover:text-white transition-colors">
                          <div className="flex flex-col gap-1 w-full max-w-md">
                            {editingTitleId === task._id ? (
                              <Input
                                value={tempTitle}
                                onChange={(e) => setTempTitle(e.target.value)}
                                onBlur={() => handleSaveTitle(task._id)}
                                autoFocus
                                className="h-6 text-[11px] bg-background px-1.5 py-0.5 rounded-md w-full"
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSaveTitle(task._id);
                                  if (e.key === 'Escape') setEditingTitleId(null);
                                }}
                              />
                            ) : (
                              <span
                                className="cursor-text select-none hover:underline text-xs"
                                title="Nhấp đúp để sửa nhanh tên công việc"
                                onDoubleClick={() => {
                                  setEditingTitleId(task._id);
                                  setTempTitle(task.title);
                                }}
                              >
                                {task.title}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-neutral-400 text-xs">
                          {projectName ? (
                            <div className="flex">
                              <Badge variant="outline" className="text-[8px] font-semibold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20 py-0 px-1.5 flex items-center gap-0.5 rounded-md w-fit">
                                <Briefcase className="w-2.5 h-2.5" />
                                {projectName}
                              </Badge>
                            </div>
                          ) : (
                            "-"
                          )}
                        </TableCell>
                        <TableCell className="text-neutral-400 group-hover:text-neutral-300 text-xs transition-colors">
                          {editingDateId === task._id ? (
                            <Input
                              type="date"
                              value={tempDate}
                              onChange={(e) => setTempDate(e.target.value)}
                              onBlur={() => handleSaveDate(task._id)}
                              autoFocus
                              className="h-6 text-[11px] bg-background px-1.5 py-0.5 rounded-md w-32"
                              onClick={(e) => { try { e.currentTarget.showPicker(); } catch (err) {} }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveDate(task._id);
                                if (e.key === 'Escape') setEditingDateId(null);
                              }}
                            />
                          ) : (
                            <span
                              className="cursor-text select-none hover:underline text-xs"
                              title="Nhấp đúp để sửa nhanh ngày bắt đầu"
                              onDoubleClick={() => {
                                setEditingDateId(task._id);
                                setTempDate(task.startDate ? format(new Date(task.startDate), "yyyy-MM-dd") : "");
                              }}
                            >
                              {task.startDate ? format(new Date(task.startDate), "dd/MM/yyyy") : "-"}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-neutral-400 group-hover:text-neutral-300 text-xs transition-colors">
                          {editingEndDateId === task._id ? (
                            <Input
                              type="datetime-local"
                              value={tempEndDate}
                              onChange={(e) => setTempEndDate(e.target.value)}
                              onBlur={() => handleSaveEndDate(task._id)}
                              autoFocus
                              className="h-6 text-[10px] bg-background px-1 py-0.5 rounded-md w-40"
                              onClick={(e) => { try { e.currentTarget.showPicker(); } catch (err) {} }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveEndDate(task._id);
                                if (e.key === 'Escape') setEditingEndDateId(null);
                              }}
                            />
                          ) : (
                            <span
                              className="cursor-text select-none hover:underline text-xs"
                              title="Nhấp đúp để sửa nhanh ngày kết thúc"
                              onDoubleClick={() => {
                                setEditingEndDateId(task._id);
                                setTempEndDate(task.endDate ? format(new Date(task.endDate), "yyyy-MM-dd'T'HH:mm") : (task.startDate ? format(new Date(task.startDate), "yyyy-MM-dd'T'17:30") : ""));
                              }}
                            >
                              {task.endDate ? format(new Date(task.endDate), "dd/MM/yyyy HH:mm") : "-"}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          {editingTimeId === task._id ? (
                            <Input
                              value={tempTime}
                              onChange={(e) => setTempTime(e.target.value)}
                              onBlur={() => handleSaveTime(task._id)}
                              autoFocus
                              className="h-5 w-12 text-[10px] px-1 bg-background text-center rounded-md ml-auto"
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveTime(task._id);
                                if (e.key === 'Escape') setEditingTimeId(null);
                              }}
                            />
                          ) : (
                            <button
                              onClick={() => {
                                setEditingTimeId(task._id);
                                setTempTime(formatHours(task.estimatedTime));
                              }}
                              className="focus:outline-none cursor-pointer"
                              title="Nhấp để sửa nhanh thời gian dự kiến"
                            >
                              <Badge variant="outline" className={task.isOverflowing ? 'text-red-300 border-red-500/30 bg-red-950/30 text-[9px] py-0 px-1.5' : 'text-neutral-400 border-white/10 bg-black/20 hover:bg-white/5 transition-colors text-[9px] py-0 px-1.5'}>
                                {formatHours(task.estimatedTime)}
                              </Badge>
                            </button>
                          )}
                        </TableCell>
                        <TableCell className="text-neutral-400 text-xs">
                          {task.pic ? (
                            <div className="inline-flex items-center gap-1.5 bg-black/30 px-1.5 py-0 rounded-full border border-white/5">
                              <div className="w-4 h-4 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center text-[8px] font-bold text-primary">
                                {task.pic.charAt(0).toUpperCase()}
                              </div>
                              <span className="text-[10px] font-medium text-neutral-300">{task.pic}</span>
                            </div>
                          ) : "-"}
                        </TableCell>
                        <TableCell className="text-xs">
                          <DropdownMenu>
                            <DropdownMenuTrigger className="focus:outline-none cursor-pointer">
                              {task.status === "todo" && (
                                <Badge variant="outline" className="text-neutral-500 border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800/40 text-[9px] py-0 px-1.5 flex items-center gap-1 hover:bg-neutral-200 dark:hover:bg-neutral-800 transition-colors">
                                  <Circle className="w-2.5 h-2.5 text-neutral-400" />
                                  Chưa thực hiện
                                </Badge>
                              )}
                              {task.status === "processing" && (
                                <Badge variant="outline" className="text-blue-500 border-blue-500/30 bg-blue-500/10 text-[9px] py-0 px-1.5 flex items-center gap-1 hover:bg-blue-500/20 transition-colors">
                                  <Clock className="w-2.5 h-2.5 animate-pulse" />
                                  Đang xử lý
                                </Badge>
                              )}
                              {task.status === "pending" && (
                                <Badge variant="outline" className="text-amber-500 border-amber-500/30 bg-amber-500/10 text-[9px] py-0 px-1.5 flex items-center gap-1 hover:bg-amber-500/20 transition-colors">
                                  <PauseCircle className="w-2.5 h-2.5" />
                                  Tạm dừng
                                </Badge>
                              )}
                              {task.status === "done" && (
                                <Badge variant="outline" className="text-emerald-500 border-emerald-500/30 bg-emerald-500/10 text-[9px] py-0 px-1.5 flex items-center gap-1 hover:bg-emerald-500/20 transition-colors">
                                  <CheckCircle2 className="w-2.5 h-2.5" />
                                  Đã hoàn thành
                                </Badge>
                              )}
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="w-48 bg-card/95 backdrop-blur-xl border-border shadow-xl">
                               <DropdownMenuItem onClick={() => handleUpdateStatus(task._id, "todo")} className="cursor-pointer font-medium text-xs">
                                <Circle className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
                                Chưa thực hiện
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleUpdateStatus(task._id, "processing")} className="cursor-pointer font-medium text-xs text-blue-500 focus:text-blue-500">
                                <Clock className="w-3.5 h-3.5 mr-2" />
                                Đang xử lý
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleUpdateStatus(task._id, "pending")} className="cursor-pointer font-medium text-xs text-amber-500 focus:text-amber-500">
                                <PauseCircle className="w-3.5 h-3.5 mr-2" />
                                Tạm dừng
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleUpdateStatus(task._id, "done")} className="cursor-pointer font-medium text-xs text-emerald-500 focus:text-emerald-500">
                                <CheckCircle2 className="w-3.5 h-3.5 mr-2" />
                                Đã hoàn thành
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          <DropdownMenu>
                            <DropdownMenuTrigger className="focus:outline-none cursor-pointer p-1 rounded hover:bg-white/10 text-neutral-400 hover:text-white transition-colors">
                              <MoreHorizontal className="w-3.5 h-3.5" />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48 bg-card/95 backdrop-blur-xl border-border shadow-xl">
                              <NewTaskSheet 
                                open={editOpen[task._id]} 
                                onOpenChange={(open) => setEditOpen(prev => ({ ...prev, [task._id]: open }))} 
                                editTask={task}
                              >
                                <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="cursor-pointer font-medium text-xs text-foreground">
                                  <Pencil className="w-4 h-4 mr-2" />
                                  Sửa chi tiết
                                </DropdownMenuItem>
                              </NewTaskSheet>
                              <DropdownMenuSeparator className="bg-border/50" />
                              <DropdownMenuItem onClick={() => handleDelete(task._id)} className="cursor-pointer font-medium text-xs text-destructive focus:text-destructive focus:bg-destructive/10">
                                <Trash2 className="w-4 h-4 mr-2" />
                                Xóa công việc
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
