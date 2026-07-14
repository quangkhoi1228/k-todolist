import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Pencil, CheckCircle2, Circle, Clock, PauseCircle, Check, X, Briefcase, Calendar, ArrowUp, ArrowDown, Minus } from "lucide-react";
import { format, startOfDay } from "date-fns";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useAuth } from "@clerk/nextjs";
import { NewTaskSheet, TaskData } from "./NewTaskSheet";
import { parseTimeToHours, formatHours } from "@/lib/time-utils";

interface Task extends TaskData {
  isOverflowing?: boolean;
}

const PriorityIndicator = ({ priority, compact = false }: { priority: string; compact?: boolean }) => {
  const activeColor = priority === "high"
    ? "bg-rose-500"
    : priority === "low"
      ? "bg-slate-400 dark:bg-slate-500"
      : "bg-indigo-500 dark:bg-indigo-400";
  const sizeClass = compact ? "h-4 w-4" : "h-5 w-5";
  const barClass = compact ? "w-2" : "w-2.5";
  return (
    <div className={`flex flex-col gap-[1px] justify-center items-center ${sizeClass} shrink-0 bg-muted/40 rounded border border-border/20`} title={`Độ ưu tiên: ${priority === "high" ? "Cao" : priority === "low" ? "Thấp" : "Trung bình"}`}>
      {priority === "high" ? (
        <>
          <div className={`h-[1.5px] ${barClass} ${activeColor} rounded-full`} />
          <div className={`h-[1.5px] ${barClass} ${activeColor} rounded-full`} />
          <div className={`h-[1.5px] ${barClass} ${activeColor} rounded-full`} />
        </>
      ) : priority === "normal" ? (
        <>
          <div className={`h-[1.5px] ${barClass} bg-muted-foreground/30 rounded-full`} />
          <div className={`h-[1.5px] ${barClass} ${activeColor} rounded-full`} />
          <div className={`h-[1.5px] ${barClass} ${activeColor} rounded-full`} />
        </>
      ) : (
        <>
          <div className={`h-[1.5px] ${barClass} bg-muted-foreground/30 rounded-full`} />
          <div className={`h-[1.5px] ${barClass} bg-muted-foreground/30 rounded-full`} />
          <div className={`h-[1.5px] ${barClass} ${activeColor} rounded-full`} />
        </>
      )}
    </div>
  );
};

function formatCompactDates(startDate?: number | null, endDate?: number | null) {
  if (!startDate && !endDate) return null;
  if (startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const sameDay = format(start, "yyyy-MM-dd") === format(end, "yyyy-MM-dd");
    if (sameDay) {
      return `${format(start, "dd/MM")} ${format(end, "HH:mm")}`;
    }
    return `${format(start, "dd/MM")}–${format(end, "dd/MM HH:mm")}`;
  }
  if (startDate) return format(new Date(startDate), "dd/MM/yyyy");
  return format(new Date(endDate!), "dd/MM HH:mm");
}

export function TaskCard({ task, hideProjectBadge = false, hideStatusBadge = false }: { task: Task; hideProjectBadge?: boolean; hideStatusBadge?: boolean }) {
  const { userId } = useAuth();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isQuickEditing, setIsQuickEditing] = useState(false);
  const [quickTitle, setQuickTitle] = useState(task.title);
  const [quickTime, setQuickTime] = useState(formatHours(task.estimatedTime));

  const [isTimeEditing, setIsTimeEditing] = useState(false);
  const [tempTime, setTempTime] = useState(formatHours(task.estimatedTime));
  const [isTitleEditing, setIsTitleEditing] = useState(false);
  const [tempTitle, setTempTitle] = useState(task.title);
  const [isDateEditing, setIsDateEditing] = useState(false);
  const [tempStartDate, setTempStartDate] = useState("");
  const [tempEndDate, setTempEndDate] = useState("");

  const updateTask = useMutation(api.tasks.updateTask);
  const projects = useQuery(api.projects.getProjects, userId ? { userId } : "skip");

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task._id, data: { type: "Task", task }, disabled: isQuickEditing || isDateEditing || isTitleEditing || isTimeEditing });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleUpdateStatus = async (newStatus: string) => {
    await updateTask({
      id: task._id as any,
      status: newStatus,
    });
  };


  const handleSaveQuickEdit = async () => {
    await updateTask({
      id: task._id as any,
      title: quickTitle,
      estimatedTime: parseTimeToHours(quickTime),
    });
    setIsQuickEditing(false);
  };

  const handleCancelQuickEdit = () => {
    setQuickTitle(task.title);
    setQuickTime(formatHours(task.estimatedTime));
    setIsQuickEditing(false);
  };

  const handleSaveTime = async () => {
    const parsed = parseTimeToHours(tempTime);
    await updateTask({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      id: task._id as any,
      estimatedTime: parsed || 0.25,
    });
    setIsTimeEditing(false);
  };

  const handleSaveTitle = async () => {
    if (tempTitle.trim() && tempTitle !== task.title) {
      await updateTask({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        id: task._id as any,
        title: tempTitle.trim(),
      });
    }
    setIsTitleEditing(false);
  };

  const handleStartDateEditing = () => {
    setTempStartDate(task.startDate ? format(new Date(task.startDate), "yyyy-MM-dd") : "");
    setTempEndDate(
      task.endDate
        ? format(new Date(task.endDate), "yyyy-MM-dd'T'HH:mm")
        : task.startDate
          ? format(new Date(task.startDate), "yyyy-MM-dd'T'17:30")
          : ""
    );
    setIsDateEditing(true);
  };

  const handleSaveDates = async () => {
    const startTimestamp = tempStartDate ? startOfDay(new Date(tempStartDate)).getTime() : null;
    const endTimestamp = tempEndDate ? new Date(tempEndDate).getTime() : null;
    await updateTask({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      id: task._id as any,
      startDate: startTimestamp,
      endDate: endTimestamp,
    });
    setIsDateEditing(false);
  };

  const handleCancelDateEdit = () => {
    setIsDateEditing(false);
  };

  const isDone = task.status === "done";
  const isCompact = hideProjectBadge && hideStatusBadge;
  
  // Resolve project name from ID
  const projectName = task.project && task.project !== "none" 
    ? projects?.find(p => p._id === task.project)?.name || "Unknown Project"
    : null;

  return (
    <>
      <div ref={setNodeRef} style={style} className={`${isCompact ? "mb-1" : "mb-2.5"} touch-none group/task relative hover:z-10`}>
        <Card 
          {...(isQuickEditing || isDateEditing ? {} : attributes)} 
          {...(isQuickEditing || isDateEditing ? {} : listeners)} 
          className={`
            bg-card border-border ${isCompact ? "shadow-sm border" : "shadow-[0_8px_30px_rgb(0,0,0,0.12)] border-[1.5px]"} group-hover/task:border-primary/50 ${isCompact ? "" : "group-hover/task:shadow-[0_8px_30px_rgba(var(--primary),0.15)]"} transition-all duration-300 
            ${task.isOverflowing ? 'border-destructive shadow-[0_0_15px_rgba(239,68,68,0.15)] group-hover/task:border-destructive' : isCompact ? 'group-hover/task:shadow-md' : 'group-hover/task:shadow-lg group-hover/task:-translate-y-0.5'}
            ${isDone ? 'opacity-60 grayscale-[0.5]' : ''}
            ${isQuickEditing || isTitleEditing || isDateEditing ? 'ring-2 ring-primary border-primary' : ''}
          `}
        >
          {isCompact ? (
            <div className="px-1.5 py-1 flex flex-col gap-0.5 relative">
              {/* Title — wrap full text */}
              <div className="pr-5 min-w-0">
                {isTitleEditing ? (
                  <Input
                    value={tempTitle}
                    onChange={(e) => setTempTitle(e.target.value)}
                    onBlur={handleSaveTitle}
                    onPointerDown={(e) => e.stopPropagation()}
                    autoFocus
                    className="h-5 text-[11px] font-semibold bg-background w-full px-1.5 py-0 rounded"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveTitle();
                      if (e.key === "Escape") {
                        setIsTitleEditing(false);
                        setTempTitle(task.title);
                      }
                    }}
                  />
                ) : (
                  <h4
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setTempTitle(task.title);
                      setIsTitleEditing(true);
                    }}
                    className={`text-[11px] font-semibold leading-snug break-words cursor-text select-none ${isDone ? "text-muted-foreground line-through" : "text-foreground"}`}
                    title="Double click để sửa tên"
                  >
                    {task.title}
                  </h4>
                )}
              </div>

              {/* Meta — always one row */}
              {!isTitleEditing && (
                isDateEditing ? (
                  <div className="flex items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
                    <Input
                      type="date"
                      value={tempStartDate}
                      onChange={(e) => {
                        setTempStartDate(e.target.value);
                        if (e.target.value && tempEndDate && new Date(e.target.value) > new Date(tempEndDate)) {
                          setTempEndDate(`${e.target.value}T17:30`);
                        }
                      }}
                      onClick={(e) => { try { e.currentTarget.showPicker(); } catch { /* unsupported */ } }}
                      autoFocus
                      className="h-5 text-[9px] bg-background px-1 py-0 rounded flex-1 min-w-0"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveDates();
                        if (e.key === "Escape") handleCancelDateEdit();
                      }}
                    />
                    {tempStartDate && (
                      <button type="button" onClick={() => setTempStartDate("")} className="p-0.5 rounded text-muted-foreground hover:text-destructive shrink-0" title="Xóa ngày bắt đầu">
                        <X className="w-2.5 h-2.5" />
                      </button>
                    )}
                    <Input
                      type="datetime-local"
                      value={tempEndDate}
                      onChange={(e) => setTempEndDate(e.target.value)}
                      onClick={(e) => { try { e.currentTarget.showPicker(); } catch { /* unsupported */ } }}
                      className="h-5 text-[9px] bg-background px-1 py-0 rounded flex-1 min-w-0"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveDates();
                        if (e.key === "Escape") handleCancelDateEdit();
                      }}
                    />
                    {tempEndDate && (
                      <button type="button" onClick={() => setTempEndDate("")} className="p-0.5 rounded text-muted-foreground hover:text-destructive shrink-0" title="Xóa ngày kết thúc">
                        <X className="w-2.5 h-2.5" />
                      </button>
                    )}
                    <button type="button" onClick={handleSaveDates} className="p-0.5 rounded bg-emerald-500/20 text-emerald-500 hover:bg-emerald-500/40 shrink-0" title="Lưu">
                      <Check className="w-3 h-3" />
                    </button>
                    <button type="button" onClick={handleCancelDateEdit} className="p-0.5 rounded bg-destructive/20 text-destructive hover:bg-destructive/40 shrink-0" title="Hủy">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 flex-nowrap overflow-hidden">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStartDateEditing();
                      }}
                      onPointerDown={(e) => e.stopPropagation()}
                      className="flex items-center gap-0.5 text-[9px] text-muted-foreground/80 bg-muted/30 border border-border/40 py-0 px-1 rounded hover:bg-muted/50 hover:border-primary/30 transition-colors cursor-pointer shrink-0 whitespace-nowrap"
                      title="Click để sửa nhanh ngày"
                    >
                      <Calendar className="w-2.5 h-2.5 shrink-0" />
                      <span>{formatCompactDates(task.startDate, task.endDate) ?? "Ngày"}</span>
                    </button>

                    {isTimeEditing ? (
                      <Input
                        type="text"
                        value={tempTime}
                        onChange={(e) => setTempTime(e.target.value)}
                        onBlur={handleSaveTime}
                        onPointerDown={(e) => e.stopPropagation()}
                        autoFocus
                        className="h-5 w-10 text-[9px] px-0.5 bg-background text-center font-semibold rounded shrink-0"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveTime();
                          if (e.key === "Escape") {
                            setIsTimeEditing(false);
                            setTempTime(formatHours(task.estimatedTime));
                          }
                        }}
                      />
                    ) : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setTempTime(formatHours(task.estimatedTime));
                          setIsTimeEditing(true);
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        className="focus:outline-none cursor-pointer shrink-0"
                        title="Click để sửa nhanh thời gian"
                      >
                        <Badge variant="outline" className={`${task.isOverflowing ? "text-destructive border-destructive bg-destructive/10" : "text-muted-foreground border-border bg-muted/30"} text-[9px] py-0 px-1 h-5 flex items-center gap-0.5 hover:bg-muted/50 transition-colors`}>
                          <Clock className="w-2.5 h-2.5" />
                          {formatHours(task.estimatedTime)}
                        </Badge>
                      </button>
                    )}

                    {task.priority && <PriorityIndicator priority={task.priority} compact />}
                  </div>
                )
              )}
            </div>
          ) : (
          <div className="px-2.5 py-1.5 flex flex-col gap-1.5 relative">
            {projectName && !hideProjectBadge && (
              <div className="flex flex-wrap gap-1">
                <Badge variant="outline" className="text-[9px] font-semibold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20 py-0 px-1.5 flex items-center gap-1 rounded-md h-5">
                  <Briefcase className="w-2.5 h-2.5" />
                  {projectName}
                </Badge>
              </div>
            )}
            
            <div className="w-full">
              {isTitleEditing ? (
                <Input 
                  value={tempTitle}
                  onChange={(e) => setTempTitle(e.target.value)}
                  onBlur={handleSaveTitle}
                  onPointerDown={(e) => e.stopPropagation()}
                  autoFocus
                  className="h-7 text-xs font-semibold bg-background w-full px-2 py-0.5 rounded-md"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveTitle();
                    if (e.key === 'Escape') {
                      setIsTitleEditing(false);
                      setTempTitle(task.title);
                    }
                  }}
                />
              ) : isQuickEditing ? (
                <Input 
                  value={quickTitle}
                  onChange={(e) => setQuickTitle(e.target.value)}
                  className="h-7 text-xs font-semibold bg-background w-full px-2 py-0.5 rounded-md"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveQuickEdit();
                    if (e.key === 'Escape') handleCancelQuickEdit();
                  }}
                />
              ) : (
                <h4 
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setTempTitle(task.title);
                    setIsTitleEditing(true);
                  }}
                  className={`text-sm font-semibold leading-tight w-full cursor-text select-none ${isDone ? 'text-muted-foreground line-through' : 'text-foreground'}`}
                  title="Double click để sửa tên"
                >
                  {task.title}
                </h4>
              )}
            </div>

            {!isTitleEditing && !isQuickEditing && (
              isDateEditing ? (
                <div
                  className="flex flex-col gap-1"
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center gap-1">
                    <Input
                      type="date"
                      value={tempStartDate}
                      onChange={(e) => {
                        setTempStartDate(e.target.value);
                        if (e.target.value && tempEndDate && new Date(e.target.value) > new Date(tempEndDate)) {
                          setTempEndDate(`${e.target.value}T17:30`);
                        }
                      }}
                      onClick={(e) => { try { e.currentTarget.showPicker(); } catch { /* unsupported */ } }}
                      autoFocus
                      className="h-6 text-[10px] bg-background px-1.5 py-0 rounded-md flex-1 min-w-0"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveDates();
                        if (e.key === "Escape") handleCancelDateEdit();
                      }}
                    />
                    {tempStartDate && (
                      <button
                        type="button"
                        onClick={() => setTempStartDate("")}
                        className="p-0.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        title="Xóa ngày bắt đầu"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Input
                      type="datetime-local"
                      value={tempEndDate}
                      onChange={(e) => setTempEndDate(e.target.value)}
                      onClick={(e) => { try { e.currentTarget.showPicker(); } catch { /* unsupported */ } }}
                      className="h-6 text-[10px] bg-background px-1 py-0 rounded-md flex-1 min-w-0"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSaveDates();
                        if (e.key === "Escape") handleCancelDateEdit();
                      }}
                    />
                    {tempEndDate && (
                      <button
                        type="button"
                        onClick={() => setTempEndDate("")}
                        className="p-0.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        title="Xóa ngày kết thúc"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-1 justify-end">
                    <button
                      type="button"
                      onClick={handleSaveDates}
                      className="p-0.5 rounded bg-emerald-500/20 text-emerald-500 hover:bg-emerald-500/40"
                      title="Lưu"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelDateEdit}
                      className="p-0.5 rounded bg-destructive/20 text-destructive hover:bg-destructive/40"
                      title="Hủy"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStartDateEditing();
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground/80 bg-black/10 dark:bg-black/20 border border-white/5 py-0.5 px-1.5 rounded-md w-fit hover:bg-black/15 dark:hover:bg-black/30 hover:border-primary/30 transition-colors cursor-pointer"
                  title="Click để sửa nhanh ngày"
                >
                  <Calendar className="w-2.5 h-2.5 text-muted-foreground" />
                  {task.startDate || task.endDate ? (
                    <>
                      {task.startDate && <span>{format(new Date(task.startDate), "dd/MM/yyyy")}</span>}
                      {task.startDate && task.endDate && <span className="text-muted-foreground/50">—</span>}
                      {task.endDate && <span>{format(new Date(task.endDate), "dd/MM/yyyy HH:mm")}</span>}
                    </>
                  ) : (
                    <span className="text-muted-foreground/60 italic">Thêm ngày</span>
                  )}
                </button>
              )
            )}
            
            <div className="flex justify-between items-center w-full pt-0.5">
              <div className="flex items-center gap-1.5">
                {isQuickEditing ? (
                  <div className="flex items-center gap-1">
                    <Input 
                      type="text"
                      value={quickTime}
                      onChange={(e) => setQuickTime(e.target.value)}
                      onBlur={() => {
                        const parsed = parseTimeToHours(quickTime);
                        setQuickTime(formatHours(parsed || 0.25));
                      }}
                      className="h-6 w-20 text-xs px-1.5 bg-background text-center font-semibold rounded-md"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveQuickEdit();
                        if (e.key === 'Escape') handleCancelQuickEdit();
                      }}
                    />
                  </div>
                ) : isTimeEditing ? (
                  <div className="flex items-center">
                    <Input 
                      type="text"
                      value={tempTime}
                      onChange={(e) => setTempTime(e.target.value)}
                      onBlur={handleSaveTime}
                      onPointerDown={(e) => e.stopPropagation()}
                      autoFocus
                      className="h-6 w-16 text-xs px-1 bg-background text-center font-semibold rounded-md"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveTime();
                        if (e.key === 'Escape') {
                          setIsTimeEditing(false);
                          setTempTime(formatHours(task.estimatedTime));
                        }
                      }}
                    />
                  </div>
                ) : (
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setTempTime(formatHours(task.estimatedTime));
                      setIsTimeEditing(true);
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="focus:outline-none cursor-pointer"
                    title="Click để sửa nhanh thời gian"
                  >
                    <Badge variant="outline" className={`${task.isOverflowing ? 'text-destructive border-destructive bg-destructive/10' : 'text-muted-foreground border-border bg-muted/30'} text-[10px] py-0.5 px-2 flex items-center gap-1 hover:bg-muted/50 transition-colors`}>
                      <Clock className="w-3 h-3" />
                      {formatHours(task.estimatedTime)}
                    </Badge>
                  </button>
                )}
                
                {!isQuickEditing && task.priority && (
                  <PriorityIndicator priority={task.priority} />
                )}
                
                {!isQuickEditing && !hideStatusBadge && (
                  <DropdownMenu>
                    <DropdownMenuTrigger 
                      className="focus:outline-none cursor-pointer"
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      {task.status === "todo" && (
                        <Badge variant="outline" className="text-neutral-500 border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800/40 text-[10px] py-0.5 px-2 flex items-center gap-1 hover:bg-neutral-200 dark:hover:bg-neutral-800 transition-colors">
                          <Circle className="w-3 h-3 text-neutral-400" />
                          Chưa thực hiện
                        </Badge>
                      )}
                      {task.status === "processing" && (
                        <Badge variant="outline" className="text-blue-500 border-blue-500/30 bg-blue-500/10 text-[10px] py-0.5 px-2 flex items-center gap-1 hover:bg-blue-500/20 transition-colors">
                          <Clock className="w-3 h-3 animate-pulse" />
                          Đang xử lý
                        </Badge>
                      )}
                      {task.status === "pending" && (
                        <Badge variant="outline" className="text-amber-500 border-amber-500/30 bg-amber-500/10 text-[10px] py-0.5 px-2 flex items-center gap-1 hover:bg-amber-500/20 transition-colors">
                          <PauseCircle className="w-3 h-3" />
                          Tạm dừng
                        </Badge>
                      )}
                      {task.status === "done" && (
                        <Badge variant="outline" className="text-emerald-500 border-emerald-500/30 bg-emerald-500/10 text-[10px] py-0.5 px-2 flex items-center gap-1 hover:bg-emerald-500/20 transition-colors">
                          <CheckCircle2 className="w-3 h-3" />
                          Đã hoàn thành
                        </Badge>
                      )}
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-48 bg-card/95 backdrop-blur-xl border-border shadow-xl">
                      <DropdownMenuItem onClick={() => handleUpdateStatus("todo")} className="cursor-pointer font-medium">
                        <Circle className="w-4 h-4 mr-2 text-muted-foreground" />
                        Chưa thực hiện
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleUpdateStatus("processing")} className="cursor-pointer font-medium text-blue-500 focus:text-blue-500">
                        <Clock className="w-4 h-4 mr-2" />
                        Đang xử lý
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleUpdateStatus("pending")} className="cursor-pointer font-medium text-amber-500 focus:text-amber-500">
                        <PauseCircle className="w-4 h-4 mr-2" />
                        Tạm dừng
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleUpdateStatus("done")} className="cursor-pointer font-medium text-emerald-500 focus:text-emerald-500">
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        Đã hoàn thành
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              
              {task.pic && !isQuickEditing && (
                <div className="flex items-center gap-1.5 bg-muted/50 px-2 py-0.5 rounded-full border border-border">
                  <div className="w-4 h-4 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center text-[8px] font-bold text-primary">
                    {task.pic.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-[10px] font-medium text-muted-foreground">{task.pic}</span>
                </div>
              )}
              
              {isQuickEditing && (
                <div className="flex items-center gap-1">
                  <button onClick={handleSaveQuickEdit} className="p-1 rounded bg-emerald-500/20 text-emerald-500 hover:bg-emerald-500/40">
                    <Check className="w-4 h-4" />
                  </button>
                  <button onClick={handleCancelQuickEdit} className="p-1 rounded bg-destructive/20 text-destructive hover:bg-destructive/40">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
          )}
        </Card>

        {/* Edit Button */}
        {!isQuickEditing && (
          <div className={`absolute ${isCompact ? "top-0.5 right-0.5" : "top-1 right-1"} opacity-0 group-hover/task:opacity-100 transition-opacity z-20`}>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                setIsEditOpen(true);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="p-1 rounded-md bg-background/80 hover:bg-muted border border-border/50 text-muted-foreground hover:text-foreground transition-colors cursor-pointer shadow-sm"
              title="Sửa chi tiết"
            >
              <Pencil className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>

      <NewTaskSheet 
        open={isEditOpen} 
        onOpenChange={setIsEditOpen} 
        editTask={task}
      />
    </>
  );
}
