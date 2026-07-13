"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useAuth } from "@clerk/nextjs";
import { KanbanBoard } from "@/components/board/KanbanBoard";
import { NewTaskSheet } from "@/components/board/NewTaskSheet";

export default function BoardPage() {
  const { userId } = useAuth();
  
  // Assuming 'userId' from clerk is passed directly to your convex schema
  const tasks = useQuery(api.tasks.getTasks, userId ? { userId } : "skip");
  const projects = useQuery(api.projects.getProjects, userId ? { userId } : "skip");
  const updateTask = useMutation(api.tasks.updateTask);

  const [selectedProjectId, setSelectedProjectId] = useState<string>("all");

  const handleUpdateTask = (taskId: string, newStartDate: number) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    updateTask({ id: taskId as any, startDate: newStartDate });
  };

  const filteredTasks = useMemo(() => {
    if (!tasks) return [];
    if (selectedProjectId === "all") return tasks;
    if (selectedProjectId === "none") {
      return tasks.filter(t => !t.project || t.project === "none");
    }
    return tasks.filter(t => t.project === selectedProjectId);
  }, [tasks, selectedProjectId]);

  return (
    <div className="p-4 h-full flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-black tracking-tight text-foreground">Bảng Kanban</h2>
        <NewTaskSheet>
          <div role="button" className="inline-block px-3.5 py-1.5 bg-foreground text-background text-sm font-semibold rounded-lg hover:opacity-90 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 cursor-pointer">
            Thêm Công Việc
          </div>
        </NewTaskSheet>
      </div>
      
      <div className="flex-1 overflow-hidden">
        {tasks === undefined ? (
          <div className="text-neutral-400">Loading tasks...</div>
        ) : (
          <KanbanBoard 
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            tasks={filteredTasks as any} 
            onUpdateTask={handleUpdateTask} 
            projects={projects}
            selectedProjectId={selectedProjectId}
            setSelectedProjectId={setSelectedProjectId}
          />
        )}
      </div>
    </div>
  );
}
