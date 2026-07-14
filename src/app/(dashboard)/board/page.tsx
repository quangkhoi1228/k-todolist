"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useAuth } from "@clerk/nextjs";
import { KanbanBoard } from "@/components/board/KanbanBoard";

export default function BoardPage() {
  const { userId } = useAuth();
  
  const tasks = useQuery(api.tasks.getTasks, userId ? { userId } : "skip");
  const projects = useQuery(api.projects.getProjects, userId ? { userId } : "skip");
  const updateTask = useMutation(api.tasks.updateTask);

  const handleUpdateTask = (taskId: string, updates: { startDate?: number; endDate?: number; status?: string; project?: string }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    updateTask({ id: taskId as any, ...(updates as any) });
  };

  return (
    <div className="p-3 h-full flex flex-col gap-2">
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
