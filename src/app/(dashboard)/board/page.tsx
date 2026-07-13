"use client";

import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useAuth } from "@clerk/nextjs";
import { KanbanBoard } from "@/components/board/KanbanBoard";
import { NewTaskSheet } from "@/components/board/NewTaskSheet";

export default function BoardPage() {
  const { userId } = useAuth();
  
  // Assuming 'userId' from clerk is passed directly to your convex schema
  const tasks = useQuery(api.tasks.getTasks, userId ? { userId } : "skip");
  const updateTask = useMutation(api.tasks.updateTask);

  const handleUpdateTask = (taskId: string, newStartDate: number) => {
    updateTask({ id: taskId as any, startDate: newStartDate });
  };

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="flex justify-between items-center mb-8">
        <h2 className="text-3xl font-black tracking-tight text-foreground">Bảng Kanban</h2>
        <NewTaskSheet>
          <div role="button" className="inline-block px-5 py-2.5 bg-foreground text-background font-semibold rounded-xl hover:opacity-90 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 cursor-pointer">
            Thêm Công Việc
          </div>
        </NewTaskSheet>
      </div>
      
      <div className="flex-1 overflow-hidden">
        {tasks === undefined ? (
          <div className="text-neutral-400">Loading tasks...</div>
        ) : (
          <KanbanBoard tasks={tasks as any} onUpdateTask={handleUpdateTask} />
        )}
      </div>
    </div>
  );
}
