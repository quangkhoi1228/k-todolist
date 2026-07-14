import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Pencil, CheckCircle2, Circle, Clock, PauseCircle, Check, X, Briefcase, Calendar } from "lucide-react";
import { format } from "date-fns";
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

export function TaskCard({ task }: { task: Task }) {
  const { userId } = useAuth();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isQuickEditing, setIsQuickEditing] = useState(false);
  const [quickTitle, setQuickTitle] = useState(task.title);
  const [quickTime, setQuickTime] = useState(formatHours(task.estimatedTime));

  const [isTimeEditing, setIsTimeEditing] = useState(false);
  const [tempTime, setTempTime] = useState(formatHours(task.estimatedTime));
  const [isTitleEditing, setIsTitleEditing] = useState(false);
  const [tempTitle, setTempTitle] = useState(task.title);

  const updateTask = useMutation(api.tasks.updateTask);
  const projects = useQuery(api.projects.getProjects, userId ? { userId } : "skip");

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task._id, data: { type: "Task", task }, disabled: isQuickEditing });

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

  const isDone = task.status === "done";
  
  // Resolve project name from ID
  const projectName = task.project && task.project !== "none" 
    ? projects?.find(p => p._id === task.project)?.name || "Unknown Project"
    : null;

  return (
    <>
      <div ref={setNodeRef} style={style} className="mb-2.5 touch-none group/task relative hover:z-10">
        <Card 
          {...(isQuickEditing ? {} : attributes)} 
          {...(isQuickEditing ? {} : listeners)} 
          className={`
            bg-card border-border shadow-[0_8px_30px_rgb(0,0,0,0.12)] border-[1.5px] group-hover/task:border-primary/50 group-hover/task:shadow-[0_8px_30px_rgba(var(--primary),0.15)] transition-all duration-300 
            ${task.isOverflowing ? 'border-destructive shadow-[0_0_15px_rgba(239,68,68,0.15)] group-hover/task:border-destructive' : 'group-hover/task:shadow-lg group-hover/task:-translate-y-0.5'}
            ${isDone ? 'opacity-60 grayscale-[0.5]' : ''}
            ${isQuickEditing || isTitleEditing ? 'ring-2 ring-primary border-primary' : ''}
          `}
        >
          <div className="p-2.5 flex flex-col gap-2 relative">
            {projectName && (
              <div className="flex">
                <Badge variant="outline" className="text-[10px] font-semibold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20 py-0.5 px-2 flex items-center gap-1 rounded-md">
                  <Briefcase className="w-3 h-3" />
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
                  className={`text-sm font-semibold leading-tight pr-6 w-full cursor-text select-none ${isDone ? 'text-muted-foreground line-through' : 'text-foreground'}`}
                  title="Double click để sửa tên"
                >
                  {task.title}
                </h4>
              )}
            </div>

            {!isTitleEditing && !isQuickEditing && (
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground/80 bg-black/10 dark:bg-black/20 border border-white/5 py-0.5 px-1.5 rounded-md w-fit select-none">
                <Calendar className="w-2.5 h-2.5 text-muted-foreground" />
                <span>{format(new Date(task.startDate), "dd/MM/yyyy")}</span>
                <span className="text-muted-foreground/50">—</span>
                <span>
                  {task.endDate 
                    ? format(new Date(task.endDate), "dd/MM/yyyy HH:mm") 
                    : format(new Date(task.startDate), "dd/MM/yyyy")}
                </span>
              </div>
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
                
                {!isQuickEditing && (
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
        </Card>

        {/* Edit Button */}
        {!isQuickEditing && (
          <div className="absolute top-2 right-2 opacity-0 group-hover/task:opacity-100 transition-opacity">
            <button 
              onClick={(e) => {
                e.stopPropagation();
                setIsEditOpen(true);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="p-1.5 rounded-md hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              title="Sửa chi tiết"
            >
              <Pencil className="w-3.5 h-3.5" />
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
