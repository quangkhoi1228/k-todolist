"use client";

import { useAuth } from "@clerk/nextjs";
import { KanbanBoard } from "@/components/board/KanbanBoard";
import { useAutoShiftTasks } from "@/hooks/useAutoShiftTasks";
import { useTasks, useProjects, useTaskMutations } from "@/hooks/useDomain";

export default function BoardPage() {
  const { userId } = useAuth();

  const { data: tasks } = useTasks(userId);
  const { data: projects } = useProjects(userId);

  // Automatically shift overdue processing tasks to today
  useAutoShiftTasks(tasks);

  const tm = useTaskMutations();

  const handleUpdateTask = (taskId: string, updates: { startDate?: number; endDate?: number; status?: string; project?: string }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tm.updateTask(taskId, updates as any);
  };

  return (
    <div className="p-3 h-full min-h-0 flex flex-col gap-2">
      <div className="flex-1 min-h-0 overflow-hidden">
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