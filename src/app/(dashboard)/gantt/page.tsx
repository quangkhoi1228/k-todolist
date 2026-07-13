"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useAuth } from "@clerk/nextjs";
import { Gantt, Task as GanttTask, ViewMode } from "gantt-task-react";
import "gantt-task-react/dist/index.css";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { addDays } from "date-fns";

export default function GanttPage() {
  const { userId } = useAuth();
  const tasks = useQuery(api.tasks.getTasks, userId ? { userId } : "skip");
  const [view, setView] = useState<ViewMode>(ViewMode.Day);

  const ganttTasks: GanttTask[] = (tasks || []).map((task) => ({
    start: new Date(task.startDate),
    end: new Date(task.endDate > task.startDate ? task.endDate : addDays(new Date(task.startDate), 1)), // ensure end is after start for display
    name: task.title,
    id: task._id,
    type: "task",
    progress: task.status === "done" ? 100 : task.status === "processing" ? 50 : 0,
    isDisabled: false,
    styles: { progressColor: '#4ade80', progressSelectedColor: '#22c55e' },
  }));

  return (
    <div className="p-4 h-full flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-black tracking-tight text-foreground">Biểu đồ Gantt</h2>
        <div className="space-x-2 bg-black/20 p-1 rounded-xl border border-white/5">
          <Button variant={view === ViewMode.Day ? "default" : "ghost"} className={view === ViewMode.Day ? 'rounded-lg shadow-sm' : 'rounded-lg text-neutral-400 hover:text-white'} onClick={() => setView(ViewMode.Day)}>Day</Button>
          <Button variant={view === ViewMode.Week ? "default" : "ghost"} className={view === ViewMode.Week ? 'rounded-lg shadow-sm' : 'rounded-lg text-neutral-400 hover:text-white'} onClick={() => setView(ViewMode.Week)}>Week</Button>
          <Button variant={view === ViewMode.Month ? "default" : "ghost"} className={view === ViewMode.Month ? 'rounded-lg shadow-sm' : 'rounded-lg text-neutral-400 hover:text-white'} onClick={() => setView(ViewMode.Month)}>Month</Button>
        </div>
      </div>

      <div className="flex-1 glass-panel rounded-2xl overflow-hidden p-4">
        {tasks === undefined ? (
          <div className="text-neutral-500 text-center py-12">Loading Gantt Chart...</div>
        ) : ganttTasks.length > 0 ? (
          <Gantt
            tasks={ganttTasks}
            viewMode={view}
            listCellWidth="155px"
            columnWidth={60}
          />
        ) : (
          <div className="text-neutral-500 text-center py-12">No tasks to display. Add tasks in the Board view.</div>
        )}
      </div>
    </div>
  );
}
