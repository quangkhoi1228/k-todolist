"use client";

import { useMemo, useState } from "react";
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors, closestCorners } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { Column } from "./Column";
import { TaskCard } from "./TaskCard";
import { getDays, formatDateStr } from "@/lib/date-utils";
import { startOfDay, addDays } from "date-fns";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";

export interface Task {
  _id: string;
  title: string;
  estimatedTime: number;
  startDate: number;
  pic?: string;
  project?: string;
  status?: string;
  order?: number;
  isOverflowing?: boolean;
}

export function KanbanBoard({ tasks, onUpdateTask }: { tasks: Task[], onUpdateTask: (taskId: string, newStartDate: number) => void }) {
  const updateTaskOrders = useMutation(api.tasks.updateTaskOrders);
  const [baseDate, setBaseDate] = useState(() => startOfDay(new Date()));
  const days = useMemo(() => getDays(baseDate, 7), [baseDate]);
  
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  // Group tasks by date string
  const tasksByDate = useMemo(() => {
    const grouped: Record<string, Task[]> = {};
    days.forEach(day => grouped[formatDateStr(day)] = []);
    
    // Sort tasks by order
    const sortedTasks = [...tasks].sort((a, b) => (a.order || 0) - (b.order || 0));

    sortedTasks.forEach(task => {
      const taskDate = startOfDay(new Date(task.startDate));
      const dateStr = formatDateStr(taskDate);
      if (grouped[dateStr]) {
        grouped[dateStr].push(task);
      }
    });

    // Mark overflowing tasks
    Object.keys(grouped).forEach(dateStr => {
      let cumulativeHours = 0;
      grouped[dateStr].forEach(task => {
        cumulativeHours += task.estimatedTime;
        if (cumulativeHours > 8) {
          task.isOverflowing = true;
        } else {
          task.isOverflowing = false;
        }
      });
    });

    return grouped;
  }, [tasks, days]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  function handleDragStart(event: DragStartEvent) {
    const { active } = event;
    const task = tasks.find(t => t._id === active.id);
    if (task) setActiveTask(task);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveTask(null);
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeTask = tasks.find(t => t._id === activeId);
    if (!activeTask) return;

    const overData = over.data.current;
    
    let newStartDate = activeTask.startDate;
    let targetList: Task[] = [];
    
    if (overData?.type === "Column") {
      newStartDate = startOfDay(new Date(overData.dateStr)).getTime();
      targetList = [...(tasksByDate[overData.dateStr] || [])];
      
      // Moving to a new column, place at the end
      if (activeTask.startDate !== newStartDate) {
        // Remove from old, add to new at end
        targetList.push(activeTask);
      } else {
        // Dropped on the same column but not on a task, do nothing or move to end
        return;
      }
    } else if (overData?.type === "Task") {
      const overTask = overData.task as Task;
      newStartDate = startOfDay(new Date(overTask.startDate)).getTime();
      const dateStr = formatDateStr(startOfDay(new Date(newStartDate)));
      targetList = [...(tasksByDate[dateStr] || [])];

      if (activeTask.startDate !== newStartDate) {
        // Insert into the new list at the specific index
        const overIndex = targetList.findIndex(t => t._id === overTask._id);
        targetList.splice(overIndex, 0, activeTask);
      } else {
        // Reordering within the same list
        if (activeId !== overId) {
          const oldIndex = targetList.findIndex(t => t._id === activeId);
          const newIndex = targetList.findIndex(t => t._id === overId);
          targetList = arrayMove(targetList, oldIndex, newIndex);
        } else {
          return; // No change
        }
      }
    } else {
      return;
    }

    // Assign new orders to the target list to preserve the visual order
    const updates = targetList.map((t, index) => ({
      id: t._id as any,
      order: index * 1000, // Space them out
      startDate: newStartDate,
    }));

    // Optimistically UI will be sluggish if we just fire mutation and wait for Convex,
    // but Convex provides very fast updates so it is usually unnoticeable.
    // If it is, we should use useOptimistic.
    updateTaskOrders({ updates });
  }

  return (
    <div className="flex flex-col h-full gap-4">
      <div className="flex items-center gap-2 shrink-0">
        <Button variant="outline" size="sm" onClick={() => setBaseDate(d => addDays(d, -7))}>
          <ChevronLeft className="w-4 h-4 mr-1" /> Trước
        </Button>
        <Button variant="outline" size="sm" onClick={() => setBaseDate(startOfDay(new Date()))}>
          <CalendarIcon className="w-4 h-4 mr-1" /> Hôm nay
        </Button>
        <Button variant="outline" size="sm" onClick={() => setBaseDate(d => addDays(d, 7))}>
          Sau <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
      <DndContext 
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto pb-4 h-full">
        {days.map(day => {
          const dateStr = formatDateStr(day);
          const dayTasks = tasksByDate[dateStr] || [];
          const totalHours = dayTasks.reduce((sum, t) => sum + t.estimatedTime, 0);

          return (
            <Column 
              key={dateStr}
              date={day} 
              tasks={dayTasks} 
              totalHours={totalHours} 
            />
          );
        })}
      </div>
      
        <DragOverlay>
          {activeTask ? <TaskCard task={activeTask} /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
