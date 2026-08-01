"use client";

import { useState, useEffect } from "react";
import { Bell, X, AlertTriangle, CalendarClock, Info, MessageSquare } from "lucide-react";
import type { AppNotification } from "../lib/types";
import { generateDeadlineNotifications } from "../lib/mock-data";
import type { DeployTask } from "../lib/types";

interface NotificationBadgeProps {
  tasks?: DeployTask[];
}

const typeIcons: Record<string, React.ReactNode> = {
  warning: <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />,
  deadline: <CalendarClock className="w-3.5 h-3.5 text-red-500" />,
  info: <Info className="w-3.5 h-3.5 text-blue-500" />,
  mention: <MessageSquare className="w-3.5 h-3.5 text-primary" />,
};

export function NotificationBadge({ tasks = [] }: NotificationBadgeProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  useEffect(() => {
    const taskNotis = generateDeadlineNotifications(tasks);
    setNotifications(taskNotis);
  }, [tasks]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markRead = (id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  };

  const markAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="relative w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center cursor-pointer transition-colors"
      >
        <Bell className="w-4 h-4 text-gray-500" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 text-white text-[8px] font-bold flex items-center justify-center shadow-sm">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-80 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
              <p className="text-xs font-bold text-gray-800">Thông báo</p>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={markAllRead}
                    className="text-[10px] text-primary hover:text-primary/80 cursor-pointer bg-transparent border-none"
                  >
                    Đọc tất cả
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="w-5 h-5 flex items-center justify-center cursor-pointer text-gray-400 hover:text-gray-600 bg-transparent border-none"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>

            <div className="max-h-[320px] overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="p-6 text-center text-xs text-gray-400">Không có thông báo</div>
              ) : (
                <div className="py-1">
                  {notifications.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => markRead(n.id)}
                      className={`w-full text-left px-3 py-2.5 hover:bg-gray-50 transition-colors cursor-pointer border-b border-gray-50 last:border-none ${
                        !n.read ? "bg-primary/[0.02]" : ""
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <div className="shrink-0 mt-0.5">
                          {typeIcons[n.type] || <Info className="w-3.5 h-3.5 text-blue-500" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className={`text-[11px] ${!n.read ? "font-bold text-gray-800" : "font-medium text-gray-600"}`}>
                              {n.title}
                            </p>
                            {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
                          </div>
                          <p className="text-[10px] text-gray-400 mt-0.5 line-clamp-2">{n.body}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
