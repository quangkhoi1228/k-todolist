import { Plus } from "lucide-react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { format, isToday } from "date-fns";
import { vi } from "date-fns/locale";
import { TaskCard } from "./TaskCard";
import { ScrollArea } from "@/components/ui/scroll-area";
import { NewTaskSheet } from "./NewTaskSheet";
import { Badge } from "@/components/ui/badge";

import { TaskData } from "./NewTaskSheet";

interface Task extends TaskData {
  isOverflowing?: boolean;
}

interface ColumnProps {
  date: Date;
  tasks: Task[];
  totalHours: number;
}

export function Column({ date, tasks, totalHours }: ColumnProps) {
  const dateStr = format(date, "yyyy-MM-dd");
  const { setNodeRef, isOver } = useDroppable({
    id: dateStr,
    data: { type: "Column", dateStr },
  });

  const isTodayColumn = isToday(date);
  const isOverflow = totalHours > 8;

  return (
    <div className={`flex flex-col w-[345px] shrink-0 rounded-2xl border transition-all duration-300 group ${
      isOverflow 
        ? 'bg-destructive/10 border-destructive/30 glow-red' 
        : isTodayColumn 
          ? 'bg-primary/5 dark:bg-primary/5 border-primary/40 shadow-[0_0_20px_rgba(139,92,246,0.12)]' 
          : 'glass-panel border-border/50'
    }`}>
      <div className={`p-3 py-2.5 border-b flex justify-between items-center rounded-t-2xl relative ${
        isOverflow 
          ? 'border-destructive/20 bg-destructive/10' 
          : isTodayColumn 
            ? 'border-primary/20 bg-primary/10' 
            : 'border-border/50 bg-muted/20'
      }`}>
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <h3 className={`text-sm font-bold tracking-tight capitalize ${isOverflow ? 'text-destructive' : 'text-foreground'}`}>{format(date, "EEEE", { locale: vi })}</h3>
            {isTodayColumn && (
              <Badge className="text-[9px] bg-primary text-primary-foreground font-bold px-1.5 py-0 rounded-md h-4 flex items-center leading-none">Hôm nay</Badge>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">{format(date, "dd MMM, yyyy", { locale: vi })}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <NewTaskSheet defaultDate={date}>
            <div role="button" className="w-5 h-5 rounded-full bg-primary/10 hover:bg-primary/30 flex items-center justify-center text-primary border border-primary/20 opacity-0 group-hover:opacity-100 transition-all duration-300 scale-90 group-hover:scale-100 cursor-pointer">
              <Plus className="w-3.5 h-3.5" />
            </div>
          </NewTaskSheet>
          <div className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isOverflow ? 'text-destructive bg-destructive/10 border border-destructive/30' : 'text-primary bg-primary/10 border border-primary/20'}`}>
            {totalHours} / 8h
          </div>
        </div>
      </div>
      
      <ScrollArea className={`flex-1 p-3 transition-colors ${isOver ? 'bg-white/5' : ''}`}>
        <div ref={setNodeRef} className="min-h-[150px] pt-1.5 pb-1.5 px-0.5">
          <SortableContext items={tasks.map((t) => t._id)} strategy={verticalListSortingStrategy}>
            {tasks.map((task) => (
              <TaskCard key={task._id} task={task} />
            ))}
          </SortableContext>
        </div>
      </ScrollArea>
    </div>
  );
}
