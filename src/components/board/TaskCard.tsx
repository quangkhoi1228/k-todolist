import { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { MoreHorizontal, Pencil, Trash2, CheckCircle2, Circle, Clock, PauseCircle, Check, X, Zap } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useAuth } from "@clerk/nextjs";
import { NewTaskSheet, TaskData } from "./NewTaskSheet";

interface Task extends TaskData {
  isOverflowing?: boolean;
}

export function TaskCard({ task }: { task: Task }) {
  const { userId } = useAuth();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isQuickEditing, setIsQuickEditing] = useState(false);
  const [quickTitle, setQuickTitle] = useState(task.title);
  const [quickTime, setQuickTime] = useState(task.estimatedTime.toString());

  const updateTask = useMutation(api.tasks.updateTask);
  const deleteTask = useMutation(api.tasks.deleteTask);
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

  const handleDelete = async () => {
    await deleteTask({ id: task._id as any });
  };

  const handleSaveQuickEdit = async () => {
    await updateTask({
      id: task._id as any,
      title: quickTitle,
      estimatedTime: parseFloat(quickTime),
    });
    setIsQuickEditing(false);
  };

  const handleCancelQuickEdit = () => {
    setQuickTitle(task.title);
    setQuickTime(task.estimatedTime.toString());
    setIsQuickEditing(false);
  };

  const isDone = task.status === "done";
  
  // Resolve project name from ID
  const projectName = task.project && task.project !== "none" 
    ? projects?.find(p => p._id === task.project)?.name || "Unknown Project"
    : null;

  return (
    <>
      <div ref={setNodeRef} style={style} className="mb-4 touch-none group/task relative">
        <Card 
          {...(isQuickEditing ? {} : attributes)} 
          {...(isQuickEditing ? {} : listeners)} 
          className={`
            bg-card border-border shadow-[0_8px_30px_rgb(0,0,0,0.12)] border-[1.5px] group-hover/task:border-primary/50 group-hover/task:shadow-[0_8px_30px_rgba(var(--primary),0.15)] transition-all duration-300 
            ${task.isOverflowing ? 'border-destructive shadow-[0_0_15px_rgba(239,68,68,0.15)] group-hover/task:border-destructive' : 'group-hover/task:shadow-lg group-hover/task:-translate-y-0.5'}
            ${isDone ? 'opacity-60 grayscale-[0.5]' : ''}
            ${isQuickEditing ? 'ring-2 ring-primary border-primary' : ''}
          `}
        >
          <CardHeader className="p-4 pb-2 flex flex-col items-start space-y-2">
            {projectName && (
              <Badge variant="secondary" className="text-[10px] font-semibold bg-primary/10 text-primary border-primary/20">
                {projectName}
              </Badge>
            )}
            
            {isQuickEditing ? (
              <Input 
                value={quickTitle}
                onChange={(e) => setQuickTitle(e.target.value)}
                className="h-8 text-sm font-semibold bg-background"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveQuickEdit();
                  if (e.key === 'Escape') handleCancelQuickEdit();
                }}
              />
            ) : (
              <CardTitle className={`text-sm font-semibold leading-tight pr-6 w-full ${isDone ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                {task.title}
              </CardTitle>
            )}
          </CardHeader>
          
          <CardContent className="p-4 pt-1 flex justify-between items-center">
            <div className="flex items-center gap-2">
              {isQuickEditing ? (
                <div className="flex items-center gap-1">
                  <Input 
                    type="number"
                    step="0.5"
                    min="0.5"
                    value={quickTime}
                    onChange={(e) => setQuickTime(e.target.value)}
                    className="h-6 w-16 text-xs px-2 bg-background"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveQuickEdit();
                      if (e.key === 'Escape') handleCancelQuickEdit();
                    }}
                  />
                  <span className="text-xs text-muted-foreground">h</span>
                </div>
              ) : (
                <Badge variant="outline" className={task.isOverflowing ? 'text-destructive border-destructive bg-destructive/10' : 'text-muted-foreground border-border bg-muted/30'}>
                  {task.estimatedTime}h
                </Badge>
              )}
              
              {task.status === "processing" && (
                <Badge variant="outline" className="text-blue-500 border-blue-500/30 bg-blue-500/10 text-[10px]">Processing</Badge>
              )}
              {task.status === "pending" && (
                <Badge variant="outline" className="text-amber-500 border-amber-500/30 bg-amber-500/10 text-[10px]">Pending</Badge>
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
          </CardContent>
        </Card>

        {/* Action Menu */}
        {!isQuickEditing && (
          <div className="absolute top-2 right-2 opacity-0 group-hover/task:opacity-100 transition-opacity">
            <DropdownMenu>
              <DropdownMenuTrigger 
                className="p-1.5 rounded-md hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="w-4 h-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 bg-card/95 backdrop-blur-xl border-border shadow-xl">
                <DropdownMenuItem onClick={() => {
                  setQuickTitle(task.title);
                  setQuickTime(task.estimatedTime.toString());
                  setIsQuickEditing(true);
                }} className="cursor-pointer font-medium text-foreground">
                  <Zap className="w-4 h-4 mr-2 text-amber-500" />
                  Sửa nhanh
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-border/50" />
                
                <DropdownMenuItem onClick={() => handleUpdateStatus("todo")} className="cursor-pointer font-medium">
                  <Circle className="w-4 h-4 mr-2 text-muted-foreground" />
                  To do
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleUpdateStatus("processing")} className="cursor-pointer font-medium text-blue-500 focus:text-blue-500">
                  <Clock className="w-4 h-4 mr-2" />
                  Processing
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleUpdateStatus("pending")} className="cursor-pointer font-medium text-amber-500 focus:text-amber-500">
                  <PauseCircle className="w-4 h-4 mr-2" />
                  Pending
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleUpdateStatus("done")} className="cursor-pointer font-medium text-emerald-500 focus:text-emerald-500">
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Done
                </DropdownMenuItem>
                
                <DropdownMenuSeparator className="bg-border/50" />
                <DropdownMenuItem onClick={() => setIsEditOpen(true)} className="cursor-pointer font-medium text-foreground">
                  <Pencil className="w-4 h-4 mr-2" />
                  Sửa chi tiết
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleDelete} className="cursor-pointer font-medium text-destructive focus:text-destructive focus:bg-destructive/10">
                  <Trash2 className="w-4 h-4 mr-2" />
                  Xóa công việc
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
