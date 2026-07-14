"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useAuth } from "@clerk/nextjs";
import { KanbanBoard } from "@/components/board/KanbanBoard";
import { NewTaskSheet } from "@/components/board/NewTaskSheet";
import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";

export default function BoardPage() {
  const { userId } = useAuth();
  
  const tasks = useQuery(api.tasks.getTasks, userId ? { userId } : "skip");
  const projects = useQuery(api.projects.getProjects, userId ? { userId } : "skip");
  const updateTask = useMutation(api.tasks.updateTask);

  const [showFilters, setShowFilters] = useState(false);

  const handleUpdateTask = (taskId: string, updates: { startDate?: number; endDate?: number; status?: string; project?: string }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    updateTask({ id: taskId as any, ...(updates as any) });
  };

  return (
    <div className="p-4 h-full flex flex-col gap-3">
      {/* Title bar with Buttons */}
      <div className="flex justify-between items-center shrink-0">
        <h2 className="text-lg font-bold tracking-tight text-foreground">Bảng Kanban</h2>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setShowFilters(!showFilters)} 
            className={`md:hidden px-3 py-1.5 border border-border rounded-lg text-xs font-semibold flex items-center gap-1.5 hover:bg-muted/50 transition-colors cursor-pointer ${
              showFilters ? "bg-primary/10 text-primary border-primary/30 font-bold" : "bg-background text-foreground"
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            Lọc
          </button>
          <NewTaskSheet>
            <button className="px-3 py-1.5 bg-foreground text-background text-xs font-semibold rounded-lg hover:opacity-90 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 cursor-pointer shadow-sm">
              Thêm Công Việc
            </button>
          </NewTaskSheet>
        </div>
      </div>
      
      <div className="flex-1 overflow-hidden">
        {tasks === undefined ? (
          <div className="text-neutral-400">Loading tasks...</div>
        ) : (
          <KanbanBoard 
            tasks={tasks} 
            onUpdateTask={handleUpdateTask} 
            projects={projects}
            showFilters={showFilters}
          />
        )}
      </div>
    </div>
  );
}
