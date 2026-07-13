"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useAuth } from "@clerk/nextjs";
import { KanbanBoard } from "@/components/board/KanbanBoard";
import { NewTaskSheet } from "@/components/board/NewTaskSheet";

export default function BoardPage() {
  const { userId } = useAuth();
  
  const tasks = useQuery(api.tasks.getTasks, userId ? { userId } : "skip");
  const projects = useQuery(api.projects.getProjects, userId ? { userId } : "skip");
  const updateTask = useMutation(api.tasks.updateTask);

  const handleUpdateTask = (taskId: string, newStartDate: number) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    updateTask({ id: taskId as any, startDate: newStartDate });
  };

  return (
    <div className="p-4 h-full flex flex-col gap-3">
      {/* Title bar with Add Task Button */}
      <div className="flex justify-between items-center shrink-0">
        <h2 className="text-lg font-bold tracking-tight text-foreground">Bảng Kanban</h2>
        <NewTaskSheet>
          <button className="px-3 py-1.5 bg-foreground text-background text-xs font-semibold rounded-lg hover:opacity-90 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 cursor-pointer shadow-sm">
            Thêm Công Việc
          </button>
        </NewTaskSheet>
      </div>
      
      <div className="flex-1 overflow-hidden">
        {tasks === undefined ? (
          <div className="text-neutral-400">Loading tasks...</div>
        ) : (
          <KanbanBoard 
            tasks={tasks} 
            onUpdateTask={handleUpdateTask} 
            projects={projects}
          />
        )}
      </div>
    </div>
  );
}
