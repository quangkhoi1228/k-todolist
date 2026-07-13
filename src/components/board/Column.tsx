import { Plus } from "lucide-react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { format } from "date-fns";
import { vi } from "date-fns/locale";
import { TaskCard } from "./TaskCard";
import { ScrollArea } from "@/components/ui/scroll-area";
import { NewTaskSheet } from "./NewTaskSheet";

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

  const isOverflow = totalHours > 8;

  return (
    <div className={`flex flex-col w-[432px] shrink-0 rounded-2xl border transition-colors duration-300 group ${isOverflow ? 'bg-destructive/10 border-destructive/30 glow-red' : 'glass-panel'} `}>
      <div className={`p-4 border-b flex justify-between items-center rounded-t-2xl relative ${isOverflow ? 'border-destructive/20 bg-destructive/10' : 'border-border/50 bg-muted/20'}`}>
        <div>
          <h3 className={`font-bold tracking-tight capitalize ${isOverflow ? 'text-destructive' : 'text-foreground'}`}>{format(date, "EEEE", { locale: vi })}</h3>
          <p className="text-xs text-muted-foreground">{format(date, "dd MMM, yyyy", { locale: vi })}</p>
        </div>
        <div className="flex items-center gap-2">
          <NewTaskSheet defaultDate={date}>
            <div role="button" className="w-6 h-6 rounded-full bg-primary/10 hover:bg-primary/30 flex items-center justify-center text-primary border border-primary/20 opacity-0 group-hover:opacity-100 transition-all duration-300 scale-90 group-hover:scale-100 cursor-pointer">
              <Plus className="w-4 h-4" />
            </div>
          </NewTaskSheet>
          <div className={`text-xs font-black px-2.5 py-1 rounded-full ${isOverflow ? 'text-destructive bg-destructive/10 border border-destructive/30' : 'text-primary bg-primary/10 border border-primary/20'}`}>
            {totalHours} / 8h
          </div>
        </div>
      </div>
      
      <ScrollArea className={`flex-1 p-4 transition-colors ${isOver ? 'bg-white/5' : ''}`}>
        <div ref={setNodeRef} className="min-h-[150px]">
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
