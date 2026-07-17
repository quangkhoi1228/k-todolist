"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useAuth } from "@clerk/nextjs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { startOfDay, format, addDays } from "date-fns";
import { Plus, Minus, X, Search, Link, Unlink, Circle, Clock, CheckCircle2, PauseCircle } from "lucide-react";
import { parseTimeToHours, formatHours } from "@/lib/time-utils";
import { DatePickerPopover } from "@/components/ui/DatePickerPopover";
import type { Id } from "../../../convex/_generated/dataModel";

export interface TaskData {
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

interface NewTaskSheetProps {
  children?: React.ReactNode;
  defaultDate?: Date;
  defaultProject?: string;
  defaultStatus?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  editTask?: TaskData;
}

export function NewTaskSheet({ children, defaultDate, defaultProject, defaultStatus, open: controlledOpen, onOpenChange, editTask }: NewTaskSheetProps) {
  const { userId } = useAuth();
  const createTask = useMutation(api.tasks.createTask);
  const updateTask = useMutation(api.tasks.updateTask);
  const deleteTask = useMutation(api.tasks.deleteTask);
  const projects = useQuery(api.projects.getProjects, userId ? { userId, includeArchived: true } : "skip");
  const createProject = useMutation(api.projects.createProject);
  const [internalOpen, setInternalOpen] = useState(false);

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? onOpenChange! : setInternalOpen;

  const [title, setTitle] = useState(editTask?.title || "");
  const [estimatedTime, setEstimatedTime] = useState(
    editTask?.estimatedTime ? formatHours(editTask.estimatedTime) : "1h"
  );
  const [startDate, setStartDate] = useState(
    editTask?.startDate 
      ? format(new Date(editTask.startDate), "yyyy-MM-dd") 
      : defaultDate 
        ? format(defaultDate, "yyyy-MM-dd") 
        : format(new Date(), "yyyy-MM-dd")
  );
  const [endDate, setEndDate] = useState(
    editTask?.endDate 
      ? format(new Date(editTask.endDate), "yyyy-MM-dd'T'HH:mm") 
      : editTask?.startDate 
        ? format(new Date(editTask.startDate), "yyyy-MM-dd'T'17:30")
        : defaultDate 
          ? format(defaultDate, "yyyy-MM-dd'T'17:30") 
          : format(new Date(), "yyyy-MM-dd'T'17:30")
  );
  const [pic, setPic] = useState(editTask?.pic || "");
  const [project, setProject] = useState(editTask?.project || defaultProject || "");
  const [status, setStatus] = useState(editTask?.status || defaultStatus || "todo");
  const [priority, setPriority] = useState(editTask?.priority || "normal");

  const [projectSearch, setProjectSearch] = useState("");
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Dependency state
  const [dependencySearch, setDependencySearch] = useState("");
  const [isDependencyDropdownOpen, setIsDependencyDropdownOpen] = useState(false);
  const dependencyDropdownRef = useRef<HTMLDivElement>(null);
  const taskDependencies = useQuery(
    api.tasks.getTaskDependencies,
    editTask ? { taskId: editTask._id as Id<"tasks"> } : "skip"
  );
  const createDependency = useMutation(api.tasks.createDependency);
  const deleteDependency = useMutation(api.tasks.deleteDependency);
  const allTasks = useQuery(api.tasks.getTasks, userId ? { userId } : "skip");

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (project && project !== "none") {
      const selectedProj = projects?.find((p) => p._id === project);
      if (selectedProj) {
        setProjectSearch(selectedProj.name);
        return;
      }
    }
    setProjectSearch("");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [project, projects]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsProjectDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dependencyDropdownRef.current && !dependencyDropdownRef.current.contains(event.target as Node)) {
        setIsDependencyDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Compute predecessor task ids for quick lookup
  const predecessorIds = useMemo(() => {
    if (!taskDependencies) return new Set<string>();
    return new Set(taskDependencies.map((d) => d.dependsOnTaskId));
  }, [taskDependencies]);

  // Tasks available to add as dependency (exclude self, exclude already added)
  const availableDepTasks = useMemo(() => {
    if (!allTasks || !editTask) return [];
    return allTasks.filter((t) => {
      if (t._id === editTask._id) return false;
      if (predecessorIds.has(t._id)) return false;
      return t.title.toLowerCase().includes(dependencySearch.toLowerCase());
    });
  }, [allTasks, editTask, predecessorIds, dependencySearch]);

  // Resolve predecessor task details from IDs
  const predecessorTasks = useMemo(() => {
    if (!taskDependencies || !allTasks) return [];
    return taskDependencies
      .map((dep) => allTasks.find((t) => t._id === dep.dependsOnTaskId))
      .filter(Boolean);
  }, [taskDependencies, allTasks]);

  // Track if form has been loaded from editTask to prevent reset on re-fetch
  const isFormLoaded = useRef(false);

  useEffect(() => {
    if (open) {
      // Only reload form fields from editTask on initial open, not when editTask ref changes
      if (!isFormLoaded.current) {
        if (editTask) {
          setTitle(editTask.title);
          setEstimatedTime(formatHours(editTask.estimatedTime));
          setStartDate(editTask.startDate ? format(new Date(editTask.startDate), "yyyy-MM-dd") : "");
          setEndDate(editTask.endDate ? format(new Date(editTask.endDate), "yyyy-MM-dd'T'HH:mm") : "");
          setPic(editTask.pic || "");
          setProject(editTask.project || "");
          setStatus(editTask.status || "todo");
          setPriority(editTask.priority || "normal");
        } else {
          setTitle("");
          setEstimatedTime("1h");
          setStartDate(
            defaultDate 
              ? format(defaultDate, "yyyy-MM-dd") 
              : format(new Date(), "yyyy-MM-dd")
          );
          setEndDate(
            defaultDate 
              ? format(defaultDate, "yyyy-MM-dd'T'17:30") 
              : format(new Date(), "yyyy-MM-dd'T'17:30")
          );
          setPic("");
          setProject(defaultProject || "");
          setStatus(defaultStatus || "todo");
          setPriority("normal");
        }
        isFormLoaded.current = true;
      }
    } else {
      // Reset loaded flag when dialog closes
      isFormLoaded.current = false;
    }
  }, [open]);

  const handleDelete = async () => {
    if (!editTask) return;
    const confirmDelete = window.confirm("Bạn có chắc chắn muốn xóa công việc này?");
    if (!confirmDelete) return;

    await deleteTask({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      id: editTask._id as any,
    });
    setOpen(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;

    const parsedHours = parseTimeToHours(estimatedTime);
    const startTimestamp = startDate ? startOfDay(new Date(startDate)).getTime() : null;
    const endTimestamp = endDate ? new Date(endDate).getTime() : null;

    if (editTask) {
      await updateTask({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        id: editTask._id as any,
        title,
        estimatedTime: parsedHours,
        startDate: startTimestamp,
        endDate: endTimestamp,
        pic: pic || undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        project: project && project !== "none" ? (project as any) : undefined,
        status: status,
        priority: priority,
      });
    } else {
      await createTask({
        userId,
        title,
        estimatedTime: parsedHours,
        startDate: startTimestamp,
        endDate: endTimestamp,
        pic: pic || undefined,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        project: project && project !== "none" ? (project as any) : undefined,
        status: status,
        priority: priority,
        order: Date.now(), // default order is current timestamp to place at end
      });
    }

    setOpen(false);
    if (!editTask) {
      setTitle("");
      setEstimatedTime("1h");
      setProject("");
      setStatus("todo");
      setPriority("normal");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children && <DialogTrigger render={children as React.ReactElement} />}
      <DialogContent className="bg-card text-foreground border border-border w-full sm:max-w-[500px] shadow-2xl p-6 overflow-y-auto max-h-[90vh]">
        <DialogHeader className="mb-4">
          <DialogTitle className="text-lg font-bold tracking-tight">
            {editTask ? "Sửa Công Việc" : "Thêm Công Việc Mới"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="title" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Tên Công Việc</Label>
            <Textarea 
              id="title" 
              value={title} 
              onChange={(e) => {
                setTitle(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${e.target.scrollHeight}px`;
              }} 
              className="bg-muted/50 border-border text-foreground min-h-[60px] p-3 rounded-lg focus-visible:ring-primary/50 resize-none overflow-hidden text-sm w-full"
              placeholder="Ví dụ: Thiết kế giao diện"
              required 
            />
          </div>

          <div className="flex flex-col sm:flex-row gap-4 w-full">
            <div className="space-y-1.5 sm:flex-1 w-full">
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Ngày bắt đầu</Label>
              <DatePickerPopover
                date={startDate ? startOfDay(new Date(startDate)).getTime() : null}
                onDateChange={(ts) => {
                  const newStartStr = ts ? format(new Date(ts), "yyyy-MM-dd") : "";
                  setStartDate(newStartStr);
                  if (newStartStr && endDate && new Date(newStartStr) > new Date(endDate)) {
                    setEndDate(`${newStartStr}T17:30`);
                  }
                }}
                label="Ngày bắt đầu"
                allowClear={true}
                quickDates={[
                  { label: "Hôm nay", getDate: () => new Date() },
                  { label: "Ngày mai", getDate: () => addDays(new Date(), 1) },
                ]}
                placeholder="Chọn ngày bắt đầu"
                className="w-full"
              >
                <div className="flex items-center justify-between w-full bg-muted/50 border border-border rounded-lg px-3 py-2 h-10 text-sm hover:bg-muted/80 transition-colors">
                  <span className={startDate ? "text-foreground" : "text-muted-foreground"}>
                    {startDate
                      ? (() => {
                          const d = new Date(startDate);
                          const today = new Date();
                          const tomorrow = addDays(today, 1);
                          if (format(d, "yyyy-MM-dd") === format(today, "yyyy-MM-dd")) return "Hôm nay";
                          if (format(d, "yyyy-MM-dd") === format(tomorrow, "yyyy-MM-dd")) return "Ngày mai";
                          return format(d, "dd/MM/yyyy");
                        })()
                      : "Chọn ngày"}
                  </span>
                  <div className="flex items-center gap-1">
                    {startDate && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setStartDate("");
                        }}
                        className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-destructive cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </DatePickerPopover>
            </div>

            <div className="space-y-1.5 sm:flex-1 w-full">
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Ngày kết thúc</Label>
              <DatePickerPopover
                date={endDate ? new Date(endDate).getTime() : null}
                onDateChange={(ts) => {
                  setEndDate(ts ? format(new Date(ts), "yyyy-MM-dd'T'HH:mm") : "");
                }}
                showTime={true}
                label="Hạn chót"
                allowClear={true}
                placeholder="Chọn hạn chót"
                className="w-full"
              >
                <div className="flex items-center justify-between w-full bg-muted/50 border border-border rounded-lg px-3 py-2 h-10 text-sm hover:bg-muted/80 transition-colors">
                  <span className={endDate ? "text-foreground" : "text-muted-foreground"}>
                    {endDate
                      ? format(new Date(endDate), "dd/MM/yyyy HH:mm")
                      : "Chọn ngày kết thúc"}
                  </span>
                  <div className="flex items-center gap-1">
                    {endDate && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEndDate("");
                        }}
                        className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-destructive cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </DatePickerPopover>
            </div>
          </div>

          <div className="space-y-1.5 w-full">
            <Label htmlFor="estimatedTime" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Thời gian dự kiến</Label>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-10 w-10 shrink-0 rounded-lg border-border bg-muted/20 hover:bg-muted/50"
                onClick={() => {
                  const currentHours = parseTimeToHours(estimatedTime);
                  const val = currentHours - 0.25;
                  setEstimatedTime(formatHours(Math.max(0.25, val)));
                }}
              >
                <Minus className="w-4 h-4 text-muted-foreground" />
              </Button>
              <Input 
                id="estimatedTime" 
                type="text" 
                value={estimatedTime} 
                onChange={(e) => setEstimatedTime(e.target.value)} 
                onBlur={() => {
                  const parsed = parseTimeToHours(estimatedTime);
                  setEstimatedTime(formatHours(parsed || 0.25));
                }}
                className="bg-muted/50 border-border text-foreground h-10 px-2 rounded-lg focus-visible:ring-primary/50 text-center font-semibold text-sm flex-1"
                required 
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-10 w-10 shrink-0 rounded-lg border-border bg-muted/20 hover:bg-muted/50"
                onClick={() => {
                  const currentHours = parseTimeToHours(estimatedTime);
                  const val = currentHours + 0.25;
                  setEstimatedTime(formatHours(val));
                }}
              >
                <Plus className="w-4 h-4 text-muted-foreground" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-1 pt-2">
              {[
                { label: "15p", value: 0.25 },
                { label: "30p", value: 0.5 },
                { label: "45p", value: 0.75 },
                { label: "1h", value: 1 },
                { label: "2h", value: 2 },
                { label: "4h", value: 4 },
              ].map((preset) => {
                const isActive = parseTimeToHours(estimatedTime) === preset.value;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setEstimatedTime(formatHours(preset.value))}
                    className={`text-[10px] px-2 py-0.5 rounded-full border transition-all duration-200 cursor-pointer ${
                      isActive
                        ? "bg-primary/20 text-primary border-primary/40 font-semibold"
                        : "bg-muted/40 text-muted-foreground border-border/50 hover:bg-muted/80 hover:text-foreground"
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5 relative select-none" ref={dropdownRef}>
            <Label htmlFor="project" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Dự án / Nhóm việc</Label>
            <div className="relative">
              <Input
                id="project"
                type="text"
                placeholder="Tìm hoặc nhập dự án mới..."
                value={projectSearch}
                onChange={(e) => {
                  setProjectSearch(e.target.value);
                  setIsProjectDropdownOpen(true);
                  if (!e.target.value) {
                    setProject("none");
                  }
                }}
                onFocus={() => setIsProjectDropdownOpen(true)}
                className="bg-muted/50 border-border text-foreground h-10 px-3 pr-8 rounded-lg focus-visible:ring-primary/50 text-sm w-full"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="m6 9 6 6 6-6"/></svg>
              </div>
            </div>

            {isProjectDropdownOpen && (
              <div className="absolute z-50 left-0 right-0 mt-1 bg-popover border border-border rounded-xl shadow-xl max-h-[160px] overflow-y-auto p-1.5 space-y-0.5 scrollbar-thin">
                <button
                  type="button"
                  onClick={() => {
                    setProject("none");
                    setProjectSearch("");
                    setIsProjectDropdownOpen(false);
                  }}
                  className="w-full text-left px-2.5 py-1.5 text-xs font-medium text-muted-foreground italic rounded-lg hover:bg-muted/50 hover:text-foreground transition-colors cursor-pointer"
                >
                  Không có dự án
                </button>

                {projects
                  ?.filter((p) =>
                    p.name.toLowerCase().includes(projectSearch.toLowerCase())
                  )
                  .map((p) => (
                    <button
                      key={p._id}
                      type="button"
                      onClick={() => {
                        setProject(p._id);
                        setProjectSearch(p.name);
                        setIsProjectDropdownOpen(false);
                      }}
                      className={`w-full text-left px-2.5 py-1.5 text-xs font-medium rounded-lg hover:bg-muted/50 transition-colors cursor-pointer flex justify-between items-center ${
                        project === p._id ? "bg-primary/10 text-primary font-semibold" : "text-foreground"
                      }`}
                    >
                      <span className="truncate pr-2">{p.name}</span>
                      {project === p._id && (
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 shrink-0"><path d="M20 6 9 17l-5-5"/></svg>
                      )}
                    </button>
                  ))}

                {projectSearch.trim() &&
                  !projects?.some((p) => p.name.toLowerCase() === projectSearch.trim().toLowerCase()) && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (!userId) return;
                        const newId = await createProject({
                          userId,
                          name: projectSearch.trim(),
                        });
                        setProject(newId);
                        setProjectSearch(projectSearch.trim());
                        setIsProjectDropdownOpen(false);
                      }}
                      className="w-full text-left px-2.5 py-1.5 text-xs font-bold text-primary bg-primary/10 rounded-lg hover:bg-primary/20 transition-colors cursor-pointer border border-primary/20"
                    >
                      + Tạo dự án mới: &quot;{projectSearch.trim()}&quot;
                    </button>
                  )}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pic" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Người phụ trách (Tùy chọn)</Label>
            <Input 
              id="pic" 
              value={pic} 
              onChange={(e) => setPic(e.target.value)} 
              className="bg-muted/50 border-border text-foreground h-10 px-3 rounded-lg focus-visible:ring-primary/50 text-sm w-full"
              placeholder="Nhập tên người phụ trách"
            />
          </div>

          {/* Dependency Section — only shows when editing */}
          {editTask && (
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Phụ thuộc</Label>
              
              {/* List of current predecessor tasks */}
              <div className="space-y-1.5">
                {predecessorTasks.length === 0 ? (
                  <div className="text-[11px] text-muted-foreground/60 italic px-1">
                    Chưa có công việc phụ thuộc
                  </div>
                ) : (
                  predecessorTasks.map((predTask) => {
                    if (!predTask) return null;
                    const predStatus = predTask.status || "todo";
                    const predDone = predStatus === "done";
                    return (
                      <div
                        key={predTask._id}
                        className="flex items-center justify-between gap-2 bg-muted/40 border border-border/60 rounded-lg px-3 py-1.5"
                      >
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            predDone ? "bg-emerald-500" : predStatus === "processing" ? "bg-blue-500" : predStatus === "pending" ? "bg-amber-500" : "bg-neutral-500"
                          }`} />
                          <span className="text-[11px] font-medium truncate">{predTask.title}</span>
                          <span className={`text-[9px] shrink-0 ${
                            predDone ? "text-emerald-500" : "text-muted-foreground"
                          }`}>
                            {predDone ? "Da hoan thanh" : predStatus === "processing" ? "Dang xu ly" : predStatus === "pending" ? "Tam dung" : "Chua thuc hien"}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            const dep = taskDependencies?.find(
                              (d) => d.dependsOnTaskId === predTask._id
                            );
                            if (dep) {
                              await deleteDependency({ id: dep._id as Id<"taskDependencies"> });
                            }
                          }}
                          className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors shrink-0 cursor-pointer"
                          title="Xóa phụ thuộc"
                        >
                          <Unlink className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Add dependency button */}
              <div className="relative" ref={dependencyDropdownRef}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsDependencyDropdownOpen(!isDependencyDropdownOpen)}
                  className="w-full h-8 text-xs justify-start gap-2 border-dashed border-border/70 bg-muted/20 hover:bg-muted/40 rounded-lg cursor-pointer"
                >
                  <Link className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">Thêm công việc phụ thuộc</span>
                </Button>

                {isDependencyDropdownOpen && (
                  <div className="absolute z-50 left-0 right-0 mt-1 bg-popover border border-border rounded-xl shadow-xl max-h-[200px] overflow-y-auto p-1.5 space-y-0.5 scrollbar-thin">
                    <div className="relative px-1 pb-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                      <Input
                        placeholder="Tìm công việc..."
                        value={dependencySearch}
                        onChange={(e) => setDependencySearch(e.target.value)}
                        className="pl-7 h-7 text-[10px] bg-background/50 border-border/60 rounded-lg w-full"
                      />
                    </div>
                    {availableDepTasks.length === 0 ? (
                      <div className="text-center py-3 text-[10px] text-muted-foreground/60 italic">
                        Không tìm thấy công việc
                      </div>
                    ) : (
                      availableDepTasks.map((t) => {
                        const depStatus = t.status || "todo";
                        const statusLabel = depStatus === "done" ? "Da hoan thanh" : depStatus === "processing" ? "Dang xu ly" : depStatus === "pending" ? "Tam dung" : "Chua thuc hien";
                        return (
                          <button
                            key={t._id}
                            type="button"
                            onClick={async () => {
                              if (!userId) return;
                              try {
                                await createDependency({
                                  userId,
                                  taskId: editTask!._id as Id<"tasks">,
                                  dependsOnTaskId: t._id as Id<"tasks">,
                                });
                                setIsDependencyDropdownOpen(false);
                                setDependencySearch("");
                              } catch (err: any) {
                                alert(err.message || "Không thể thêm phụ thuộc");
                              }
                            }}
                            className="w-full text-left px-2.5 py-1.5 text-xs font-medium rounded-lg hover:bg-muted/50 transition-colors cursor-pointer flex items-center justify-between gap-2"
                          >
                            <span className="truncate">{t.title}</span>
                            <span className={`text-[9px] shrink-0 ${
                              depStatus === "done" ? "text-emerald-500" :
                              depStatus === "processing" ? "text-blue-500" :
                              depStatus === "pending" ? "text-amber-500" :
                              "text-neutral-500"
                            }`}>
                              {statusLabel}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Status */}
          <div className="space-y-2">
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Trạng thái</Label>
            <div className="flex flex-wrap gap-2 pt-1">
              {[
                { value: "todo", label: "Chưa thực hiện", activeClass: "bg-neutral-500/10 text-neutral-400 border-neutral-500/30" },
                { value: "processing", label: "Đang xử lý", activeClass: "bg-blue-500/10 text-blue-400 border-blue-500/30" },
                { value: "pending", label: "Tạm dừng", activeClass: "bg-amber-500/10 text-amber-400 border-amber-500/30" },
                { value: "done", label: "Đã hoàn thành", activeClass: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
              ].map((item) => {
                const isActive = status === item.value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setStatus(item.value)}
                    className={`text-xs px-3.5 py-1.5 rounded-lg border transition-all duration-200 cursor-pointer font-medium hover:opacity-95 flex-1 text-center ${
                      isActive
                        ? `${item.activeClass} font-semibold ring-1 ring-primary/20`
                        : "bg-muted/40 text-muted-foreground border-border/50 hover:bg-muted/80 hover:text-foreground"
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Độ ưu tiên</Label>
            <div className="flex flex-wrap gap-2 pt-1">
              {[
                { value: "low", label: "Thấp", activeClass: "bg-slate-500/10 text-slate-400 border-slate-500/30" },
                { value: "normal", label: "Trung bình", activeClass: "bg-indigo-500/10 text-indigo-400 border-indigo-500/30" },
                { value: "high", label: "Cao", activeClass: "bg-rose-500/10 text-rose-400 border-rose-500/30" },
              ].map((item) => {
                const isActive = priority === item.value;
                return (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setPriority(item.value)}
                    className={`text-xs px-3.5 py-1.5 rounded-lg border transition-all duration-200 cursor-pointer font-medium hover:opacity-95 flex-1 text-center ${
                      isActive
                        ? `${item.activeClass} font-semibold ring-1 ring-primary/20`
                        : "bg-muted/40 text-muted-foreground border-border/50 hover:bg-muted/80 hover:text-foreground"
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="pt-2 flex gap-2">
            {editTask && (
              <Button
                type="button"
                variant="destructive"
                onClick={handleDelete}
                className="flex-1 h-10 font-bold text-sm rounded-lg shadow-md transition-all hover:-translate-y-0.5 cursor-pointer"
              >
                Xóa Công Việc
              </Button>
            )}
            <Button 
              type="submit" 
              className="flex-[2] h-10 font-bold text-sm rounded-lg shadow-md shadow-primary/10 hover:shadow-primary/25 transition-all hover:-translate-y-0.5 cursor-pointer"
            >
              {editTask ? "Lưu Thay Đổi" : "Tạo Công Việc"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
