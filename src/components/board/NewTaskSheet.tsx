"use client";

import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useAuth } from "@clerk/nextjs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { startOfDay, format, addDays } from "date-fns";
import { Plus, Minus } from "lucide-react";
import { parseTimeToHours, formatHours } from "@/lib/time-utils";

export interface TaskData {
  _id: string;
  title: string;
  estimatedTime: number;
  startDate: number;
  endDate?: number;
  pic?: string;
  project?: string;
  status?: string;
  order?: number;
}

interface NewTaskSheetProps {
  children?: React.ReactNode;
  defaultDate?: Date;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  editTask?: TaskData;
}

export function NewTaskSheet({ children, defaultDate, open: controlledOpen, onOpenChange, editTask }: NewTaskSheetProps) {
  const { userId } = useAuth();
  const createTask = useMutation(api.tasks.createTask);
  const updateTask = useMutation(api.tasks.updateTask);
  const deleteTask = useMutation(api.tasks.deleteTask);
  const projects = useQuery(api.projects.getProjects, userId ? { userId } : "skip");
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
        ? format(new Date(editTask.startDate), "yyyy-MM-dd'T'18:00")
        : defaultDate 
          ? format(defaultDate, "yyyy-MM-dd'T'18:00") 
          : format(new Date(), "yyyy-MM-dd'T'18:00")
  );
  const [pic, setPic] = useState(editTask?.pic || "");
  const [project, setProject] = useState(editTask?.project || "");
  const [status, setStatus] = useState(editTask?.status || "todo");

  const [projectSearch, setProjectSearch] = useState("");
  const [isProjectDropdownOpen, setIsProjectDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
    if (open) {
      /* eslint-disable react-hooks/set-state-in-effect */
      if (editTask) {
        setTitle(editTask.title);
        setEstimatedTime(formatHours(editTask.estimatedTime));
        setStartDate(format(new Date(editTask.startDate), "yyyy-MM-dd"));
        setEndDate(format(new Date(editTask.endDate || editTask.startDate), "yyyy-MM-dd'T'HH:mm"));
        setPic(editTask.pic || "");
        setProject(editTask.project || "");
        setStatus(editTask.status || "todo");
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
            ? format(defaultDate, "yyyy-MM-dd'T'18:00") 
            : format(new Date(), "yyyy-MM-dd'T'18:00")
        );
        setPic("");
        setProject("");
        setStatus("todo");
      }
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [editTask, open, defaultDate]);

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
    const startTimestamp = startOfDay(new Date(startDate)).getTime();
    const endTimestamp = new Date(endDate || startDate).getTime();

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
        order: Date.now(), // default order is current timestamp to place at end
      });
    }

    setOpen(false);
    if (!editTask) {
      setTitle("");
      setEstimatedTime("1h");
      setProject("");
      setStatus("todo");
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
              <Label htmlFor="startDate" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Ngày bắt đầu</Label>
              <Input 
                id="startDate" 
                type="date" 
                value={startDate} 
                onChange={(e) => {
                  setStartDate(e.target.value);
                  if (endDate && new Date(e.target.value) > new Date(endDate)) {
                    setEndDate(`${e.target.value}T18:00`);
                  }
                }} 
                className="bg-muted/50 border-border text-foreground block w-full h-10 px-3 rounded-lg focus-visible:ring-primary/50 text-sm"
                required 
              />
              <div className="flex gap-1.5 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    const todayStr = format(new Date(), "yyyy-MM-dd");
                    setStartDate(todayStr);
                    if (endDate && new Date(todayStr) > new Date(endDate)) {
                      setEndDate(`${todayStr}T18:00`);
                    }
                  }}
                  className={`text-[10px] px-2.5 py-0.5 rounded-full border transition-all duration-200 cursor-pointer ${
                    startDate === format(new Date(), "yyyy-MM-dd")
                      ? "bg-primary/20 text-primary border-primary/40 font-semibold"
                      : "bg-muted/40 text-muted-foreground border-border/50 hover:bg-muted/80 hover:text-foreground"
                  }`}
                >
                  Hôm nay
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const tomorrowStr = format(addDays(new Date(), 1), "yyyy-MM-dd");
                    setStartDate(tomorrowStr);
                    if (endDate && new Date(tomorrowStr) > new Date(endDate)) {
                      setEndDate(`${tomorrowStr}T18:00`);
                    }
                  }}
                  className={`text-[10px] px-2.5 py-0.5 rounded-full border transition-all duration-200 cursor-pointer ${
                    startDate === format(addDays(new Date(), 1), "yyyy-MM-dd")
                      ? "bg-primary/20 text-primary border-primary/40 font-semibold"
                      : "bg-muted/40 text-muted-foreground border-border/50 hover:bg-muted/80 hover:text-foreground"
                  }`}
                >
                  Ngày mai
                </button>
              </div>
            </div>

            <div className="space-y-1.5 sm:flex-1 w-full">
              <Label htmlFor="endDate" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Ngày kết thúc</Label>
              <Input 
                id="endDate" 
                type="datetime-local" 
                value={endDate} 
                onChange={(e) => setEndDate(e.target.value)} 
                className="bg-muted/50 border-border text-foreground block w-full h-10 px-3 rounded-lg focus-visible:ring-primary/50 text-sm"
                required 
              />
              <div className="flex gap-1.5 pt-2">
                <button
                  type="button"
                  onClick={() => setEndDate(`${startDate}T18:00`)}
                  className={`text-[10px] px-2.5 py-0.5 rounded-full border transition-all duration-200 cursor-pointer ${
                    endDate === `${startDate}T18:00`
                      ? "bg-primary/20 text-primary border-primary/40 font-semibold"
                      : "bg-muted/40 text-muted-foreground border-border/50 hover:bg-muted/80 hover:text-foreground"
                  }`}
                >
                  Bằng ngày bắt đầu
                </button>
              </div>
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
