"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useAuth } from "@clerk/nextjs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { NewTaskDialog } from "@/components/board/NewTaskDialog";

export default function ListPage() {
  const { userId } = useAuth();
  
  const tasks = useQuery(api.tasks.getTasks, userId ? { userId } : "skip");

  // Basic implementation to highlight overflowing tasks
  const processedTasks = (tasks || []).slice().sort((a, b) => a.startDate - b.startDate);
  const dailyHours: Record<string, number> = {};

  const tasksWithOverflow = processedTasks.map(task => {
    const dateStr = format(new Date(task.startDate), "yyyy-MM-dd");
    if (!dailyHours[dateStr]) dailyHours[dateStr] = 0;
    dailyHours[dateStr] += task.estimatedTime;
    
    return {
      ...task,
      isOverflowing: dailyHours[dateStr] > 8
    };
  });

  return (
    <div className="p-6 h-full flex flex-col">
      <div className="flex justify-between items-center mb-8">
        <h2 className="text-3xl font-black tracking-tight text-white">List View</h2>
        <NewTaskDialog>
          <button className="px-5 py-2.5 bg-white text-black font-semibold rounded-xl hover:bg-neutral-200 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300">
            Add Task
          </button>
        </NewTaskDialog>
      </div>

      <div className="flex-1 overflow-hidden glass-panel rounded-2xl">
        {tasks === undefined ? (
          <div className="p-8 text-center text-neutral-400">Loading tasks...</div>
        ) : (
          <Table>
            <TableHeader className="bg-black/40">
              <TableRow className="border-white/5 hover:bg-transparent">
                <TableHead className="text-neutral-400 font-medium">Title</TableHead>
                <TableHead className="text-neutral-400 font-medium">Date</TableHead>
                <TableHead className="text-neutral-400 font-medium text-right">Est. Time</TableHead>
                <TableHead className="text-neutral-400 font-medium">PIC</TableHead>
                <TableHead className="text-neutral-400 font-medium">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasksWithOverflow.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-neutral-500 py-12">
                    No tasks found.
                  </TableCell>
                </TableRow>
              ) : (
                tasksWithOverflow.map(task => (
                  <TableRow key={task._id} className="border-white/5 hover:bg-white/5 transition-colors group">
                    <TableCell className="font-semibold text-neutral-200 group-hover:text-white transition-colors">{task.title}</TableCell>
                    <TableCell className="text-neutral-400 group-hover:text-neutral-300 transition-colors">{format(new Date(task.startDate), "MMM d, yyyy")}</TableCell>
                    <TableCell className="text-right">
                      <Badge variant="outline" className={task.isOverflowing ? 'text-red-300 border-red-500/30 bg-red-950/30' : 'text-neutral-400 border-white/10 bg-black/20'}>
                        {task.estimatedTime}h
                      </Badge>
                    </TableCell>
                    <TableCell className="text-neutral-400">
                      {task.pic ? (
                        <div className="inline-flex items-center gap-1.5 bg-black/30 px-2 py-0.5 rounded-full border border-white/5">
                          <div className="w-5 h-5 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center text-[9px] font-bold text-primary">
                            {task.pic.charAt(0).toUpperCase()}
                          </div>
                          <span className="text-xs font-medium text-neutral-300">{task.pic}</span>
                        </div>
                      ) : "-"}
                    </TableCell>
                    <TableCell>
                      {task.status === "done" ? (
                        <Badge className="bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-500/30">Done</Badge>
                      ) : (
                        <Badge className="bg-primary/20 text-primary hover:bg-primary/30 border border-primary/30">Todo</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
