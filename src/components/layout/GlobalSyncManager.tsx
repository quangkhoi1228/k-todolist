"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@clerk/nextjs";

/**
 * Auto-sync qua queue tập trung (server-side, `sync-queue.ts`):
 * - Đang mở `/projects/[id]`: mỗi 2 phút enqueue job sync project đó
 *   (các nhóm đã add, incremental). Job này được ưu tiên trong queue.
 * - Sync-all định kỳ do SERVER đảm nhiệm (bộ lập lịch trong next-server),
 *   interval = `autoSyncInterval` trong trang Omni (mặc định 30 phút).
 *   Client KHÔNG tự gọi sync-all nữa — server tự serialize.
 */
export function GlobalSyncManager() {
  const { userId } = useAuth();
  const pathname = usePathname();
  const lastEnqueuedRef = useRef<Record<string, number>>({});
  const isPollingRef = useRef(false);

  // Trích projectId từ URL `/projects/123?tab=chats`
  const projectMatch = pathname?.match(/\/projects\/(\d+)/);
  const activeProjectId = projectMatch ? projectMatch[1] : null;

  useEffect(() => {
    if (!userId) return;

    // Báo server project đang xem (để queue ưu tiên job project này)
    void announceProject(activeProjectId);

    // Chỉ sync project khi đang xem project
    if (!activeProjectId) return;

    const runProjectSync = () => {
      if (isPollingRef.current) return;
      isPollingRef.current = true;
      void (async () => {
        try {
          // Không auto-sync project đã archive / đã xoá
          let archived = false;
          try {
            const projRes = await fetch(
              `/api/data/projects?action=getProject&id=${encodeURIComponent(activeProjectId)}`
            );
            const projData = await projRes.json();
            archived = !!(projData && (projData.archived || projData.deletedAt));
          } catch { /* nếu không lấy được thì vẫn sync */ }
          if (archived) return;

          // Mỗi 2 phút enqueue 1 lần (server queue gom/ưu tiên job này)
          const last = lastEnqueuedRef.current[`p:${activeProjectId}`] || 0;
          if (Date.now() - last < 120_000) return;
          lastEnqueuedRef.current[`p:${activeProjectId}`] = Date.now();

          const res = await fetch("/api/agents/sync-project-chats", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId: activeProjectId }),
          });
          const data = await res.json();
          if (!data.ok) {
            console.warn("[GlobalSyncManager] Project sync rejected:", data.error || "");
          }
        } catch (err) {
          console.error("[GlobalSyncManager] Project sync failed:", err);
        } finally {
          isPollingRef.current = false;
        }
      })();
    };

    runProjectSync();
    const intervalId = setInterval(runProjectSync, 120_000);
    return () => clearInterval(intervalId);
  }, [userId, activeProjectId]);

  return null; // Hidden component
}

// Announce cho server biết project đang xem (để queue ưu tiên)
async function announceProject(projectId: string | null) {
  try {
    const body = projectId
      ? { action: "setActiveProject", projectId }
      : { action: "clearActiveProject" };
    await fetch("/api/agents/sync-project-chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch { /* ignore */ }
}