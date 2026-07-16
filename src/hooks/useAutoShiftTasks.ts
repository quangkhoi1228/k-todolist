import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useEffect, useRef } from "react";
import { startOfDay } from "date-fns";

export function useAutoShiftTasks(tasks: any[] | undefined) {
  const updateTask = useMutation(api.tasks.updateTask);
  // Track tasks that we have already shifted in this session to prevent duplicate updates
  // while waiting for Convex database state to sync back to the client.
  const shiftedIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!tasks) return;

    const todayStart = startOfDay(new Date()).getTime();

    tasks.forEach((task) => {
      // If task is in 'processing' status, has an end date, and that end date is in the past
      if (
        task.status === "processing" &&
        task.endDate &&
        startOfDay(new Date(task.endDate)).getTime() < todayStart &&
        !shiftedIds.current.has(task._id)
      ) {
        // Mark it as shifted immediately to avoid sending duplicate mutations
        shiftedIds.current.add(task._id);

        const existingEnd = new Date(task.endDate);
        const today = new Date();
        const newEndDate = new Date(
          today.getFullYear(),
          today.getMonth(),
          today.getDate(),
          existingEnd.getHours(),
          existingEnd.getMinutes(),
          0,
          0
        ).getTime();

        const newStartDate = todayStart;

        console.log(`[AutoShift] Shifting processing task "${task.title}" to today.`);
        
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        updateTask({
          id: task._id as any,
          startDate: newStartDate,
          endDate: newEndDate,
        }).catch((err) => {
          console.error(`Failed to auto-shift task "${task.title}":`, err);
          // Remove from set to allow retrying if it failed
          shiftedIds.current.delete(task._id);
        });
      }
    });
  }, [tasks, updateTask]);
}
