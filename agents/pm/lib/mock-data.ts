/**
 * Utility functions for generating notifications from task data
 */

import type { AppNotification, DeployTask } from "./types";

/**
 * Generate notifications from deadline monitoring
 */
export function generateDeadlineNotifications(tasks: DeployTask[]): AppNotification[] {
  const notis: AppNotification[] = [];
  const now = Date.now();

  for (const task of tasks) {
    if (task.status === "done") continue;
    if (!task.dueDate) continue;

    const due = new Date(task.dueDate).getTime();
    const diffDays = Math.ceil((due - now) / (1000 * 60 * 60 * 24));

    if (task.priority === "high" && diffDays <= 2 && diffDays > 0) {
      notis.push({
        id: `noti_deadline_${task.id}`,
        type: "deadline",
        title: `Task đến hạn: ${task.title}`,
        body: `Còn ${diffDays} ngày. PIC: ${task.assignee}. Hãy nhắc nhở.`,
        read: false,
        createdAt: now,
      });
    }

    if (task.priority === "high" && diffDays <= 0) {
      notis.push({
        id: `noti_overdue_${task.id}`,
        type: "warning",
        title: `Task quá hạn: ${task.title}`,
        body: `Đã quá hạn. PIC: ${task.assignee}. Cần xử lý gấp.`,
        read: false,
        createdAt: now,
      });
    }
  }

  return notis;
}
