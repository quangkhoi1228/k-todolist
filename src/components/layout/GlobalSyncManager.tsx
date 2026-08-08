"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import { useUserPreferences, usePreferenceMutations } from "@/hooks/useDomain";

/**
 * Auto-sync chat messages:
 * - Khi đang mở trang `/projects/[id]`: sync NHANH chỉ project đó mỗi 1 phút
 *   (chỉ các nhóm đã add qua UI — script sync-project-chats.ts).
 * - Khi không mở project nào: sync tất cả project theo autoSyncInterval
 *   (setting trong /omni, mặc định 0 = tắt).
 */
export function GlobalSyncManager() {
  const { userId } = useAuth();
  const pathname = usePathname();
  const { data: prefs } = useUserPreferences(userId);
  const prefx = usePreferenceMutations();
  const isSyncingRef = useRef(false);

  // Trích projectId từ URL `/projects/123?tab=chats`
  const projectMatch = pathname?.match(/\/projects\/(\d+)/);
  const activeProjectId = projectMatch ? projectMatch[1] : null;

  const checkIfRunning = async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/agents/sync-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status" }),
      });
      const data = await res.json();
      return !!(data && data.running);
    } catch {
      return false;
    }
  };

  const startSyncProject = async (projectId: string): Promise<boolean> => {
    const headless = localStorage.getItem("headlessMode") !== "false";
    // Server-side route tự chặn khi sync khác đang chạy (lock file chung).
    const res = await fetch("/api/agents/sync-project-chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, headless }),
    });
    const data = await res.json();
    return !!(res.ok && data.ok);
  };

  const startSyncAll = async (): Promise<boolean> => {
    const headless = localStorage.getItem("headlessMode") !== "false";
    const res = await fetch("/api/agents/sync-projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start", headless }),
    });
    const data = await res.json();
    return !!(res.ok && data.ok);
  };

  useEffect(() => {
    if (!userId) return;

    // ─── Trường hợp 1: đang mở 1 project → sync project đó mỗi phút ───
    if (activeProjectId) {
      const runProjectSync = async () => {
        if (isSyncingRef.current) return; // vòng lặp trước chưa xong — bỏ qua, vòng 60s sau sẽ chạy
        isSyncingRef.current = true;
        try {
          // Chờ sync khác xong rồi mới bắt đầu (không xếp chồng, chung Chrome profile)
          let waited = 0;
          while (await checkIfRunning() && waited < 60_000) {
            await new Promise((r) => setTimeout(r, 10_000));
            waited += 10_000;
          }
          const ok = await startSyncProject(activeProjectId);
          if (!ok) console.warn("[GlobalSyncManager] Project sync start rejected (sync khác đang chạy?)");
        } catch (err) {
          console.error("[GlobalSyncManager] Project auto-sync failed:", err);
        } finally {
          isSyncingRef.current = false;
        }
      };

      // Chạy ngay khi mở project, sau đó mỗi 60s
      runProjectSync();
      const intervalId = setInterval(runProjectSync, 60_000);
      return () => clearInterval(intervalId);
    }

    // ─── Trường hợp 2: không mở project → sync all theo autoSyncInterval ───
    if (!prefs || !prefs.autoSyncInterval || prefs.autoSyncInterval <= 0) return;

    const intervalMs = prefs.autoSyncInterval! * 60 * 1000;

    const runSync = async () => {
      if (isSyncingRef.current) return; // vòng lặp trước chưa xong — bỏ qua, check 10s sau sẽ chạy lại

      const lastSync = prefs.lastSyncTime || 0;
      const now = Date.now();
      if (now - lastSync < intervalMs) return;

      isSyncingRef.current = true;
      try {
        let waited = 0;
        while (await checkIfRunning() && waited < intervalMs) {
          await new Promise((r) => setTimeout(r, 15000));
          waited += 15000;
        }

        const ok = await startSyncAll();
        if (ok) {
          await prefx.updateUserPreferences({
            userId,
            lastSyncTime: Date.now(),
          });
        } else {
          console.warn("[GlobalSyncManager] Sync start rejected — will retry at next interval");
          await prefx.updateUserPreferences({
            userId,
            lastSyncTime: Date.now(),
          });
        }
      } catch (err) {
        console.error("[GlobalSyncManager] Auto-sync failed:", err);
      } finally {
        isSyncingRef.current = false;
      }
    };

    // Check immediately on mount, then every 10 seconds
    runSync();
    const intervalId = setInterval(runSync, 10000);
    return () => clearInterval(intervalId);
  }, [userId, activeProjectId, prefs, prefx]);

  return null; // Hidden component
}
