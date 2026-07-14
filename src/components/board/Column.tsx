import { Plus } from "lucide-react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { format, isToday } from "date-fns";
import { vi } from "date-fns/locale";
import { TaskCard } from "./TaskCard";
import { NewTaskSheet } from "./NewTaskSheet";
import { Badge } from "@/components/ui/badge";

import { TaskData } from "./NewTaskSheet";

interface Task extends TaskData {
  isOverflowing?: boolean;
}

interface ColumnProps {
  date?: Date;
  title?: string;
  isOverdue?: boolean;
  statusMode?: "todo" | "processing" | "pending" | "done";
  tasks: Task[];
  totalHours: number;
}

export function Column({ date, tasks, totalHours, isOverdue, title, statusMode }: ColumnProps) {
  const droppableId = statusMode ? statusMode : (date ? format(date, "yyyy-MM-dd") : "overdue");
  const { setNodeRef, isOver } = useDroppable({
    id: droppableId,
    data: { type: "Column", dateStr: droppableId, statusMode },
  });

  const isTodayColumn = date ? isToday(date) : false;
  const isOverflow = !isOverdue && !statusMode && totalHours > 8;

  const statusStyles = {
    todo: 'bg-neutral-500/5 border-neutral-500/30 dark:border-neutral-500/20 shadow-sm',
    processing: 'bg-blue-500/5 border-blue-500/30 shadow-[0_0_20px_rgba(59,130,246,0.08)]',
    pending: 'bg-amber-500/5 border-amber-500/30 shadow-[0_0_20px_rgba(245,158,11,0.08)]',
    done: 'bg-emerald-500/5 border-emerald-500/30 shadow-[0_0_20px_rgba(16,185,129,0.08)]',
  };

  const statusHeaderStyles = {
    todo: 'border-neutral-500/20 bg-neutral-500/10 text-neutral-500',
    processing: 'border-blue-500/20 bg-blue-500/10 text-blue-500',
    pending: 'border-amber-500/20 bg-amber-500/10 text-amber-500',
    done: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-500',
  };

  const statusTextStyles = {
    todo: 'text-neutral-600 dark:text-neutral-400',
    processing: 'text-blue-600 dark:text-blue-500',
    pending: 'text-amber-600 dark:text-amber-500',
    done: 'text-emerald-600 dark:text-emerald-500',
  };

  return (
    <div className={`flex flex-col w-[345px] shrink-0 h-full min-h-0 rounded-2xl border transition-all duration-300 group ${
      statusMode
        ? statusStyles[statusMode]
        : isOverdue
          ? 'bg-amber-500/5 dark:bg-amber-500/5 border-amber-500/30 shadow-[0_0_20px_rgba(245,158,11,0.08)]'
          : isOverflow 
            ? 'bg-destructive/10 border-destructive/30 glow-red' 
            : isTodayColumn 
              ? 'bg-primary/5 dark:bg-primary/5 border-primary/40 shadow-[0_0_20px_rgba(139,92,246,0.12)]' 
              : 'glass-panel border-border/50'
    }`}>
      <div className={`p-3 py-2.5 border-b flex justify-between items-center rounded-t-2xl relative shrink-0 ${
        statusMode
          ? statusHeaderStyles[statusMode]
          : isOverdue
            ? 'border-amber-500/20 bg-amber-500/10'
            : isOverflow 
              ? 'border-destructive/20 bg-destructive/10' 
              : isTodayColumn 
                ? 'border-primary/20 bg-primary/10' 
                : 'border-border/50 bg-muted/20'
      }`}>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <h3 className={`text-sm font-bold tracking-tight capitalize ${
              statusMode
                ? statusTextStyles[statusMode]
                : isOverdue 
                  ? 'text-amber-600 dark:text-amber-500' 
                  : isOverflow 
                    ? 'text-destructive' 
                    : 'text-foreground'
            }`}>
              {title || (date ? format(date, "EEEE", { locale: vi }) : "")}
            </h3>
            {isOverdue && (
              <Badge className="text-[9px] bg-amber-500 text-white font-bold px-1.5 py-0 rounded-md h-4 flex items-center leading-none">Trễ hạn</Badge>
            )}
            {isTodayColumn && (
              <Badge className="text-[9px] bg-primary text-primary-foreground font-bold px-1.5 py-0 rounded-md h-4 flex items-center leading-none">Hôm nay</Badge>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">
            {statusMode
              ? `Các công việc ${title?.toLowerCase()}`
              : isOverdue 
                ? 'Các công việc chưa hoàn thành trước hôm nay' 
                : date 
                  ? format(date, "dd MMM, yyyy", { locale: vi }) 
                  : ""}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {!isOverdue && !statusMode && date && (
            <NewTaskSheet defaultDate={date}>
              <div role="button" className="w-5 h-5 rounded-full bg-primary/10 hover:bg-primary/30 flex items-center justify-center text-primary border border-primary/20 opacity-0 group-hover:opacity-100 transition-all duration-300 scale-90 group-hover:scale-100 cursor-pointer">
                <Plus className="w-3.5 h-3.5" />
              </div>
            </NewTaskSheet>
          )}
          <div className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
            statusMode
              ? 'bg-background/80 border border-current'
              : isOverdue 
                ? 'text-amber-600 dark:text-amber-500 bg-amber-500/10 border border-amber-500/20' 
                : isOverflow 
                  ? 'text-destructive bg-destructive/10 border border-destructive/30' 
                  : 'text-primary bg-primary/10 border border-primary/20'
          }`}>
            {isOverdue ? `${tasks.length} task` : statusMode ? `${tasks.length} task` : `${totalHours} / 8h`}
          </div>
        </div>
      </div>
      
      <div
        ref={setNodeRef}
        className={`flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-3 transition-colors ${isOver ? "bg-white/5" : ""}`}
      >
        <div className="min-h-[150px] pt-1.5 pb-1.5 px-0.5">
          <SortableContext items={tasks.map((t) => t._id)} strategy={verticalListSortingStrategy}>
            {tasks.map((task) => (
              <TaskCard key={task._id} task={task} />
            ))}
          </SortableContext>
        </div>
      </div>
    </div>
  );
}
