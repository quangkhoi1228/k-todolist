"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@clerk/nextjs";
import { useUserPreferences, usePreferenceMutations } from "@/hooks/useDomain";

export function GlobalSyncManager() {
  const { userId } = useAuth();
  const { data: prefs } = useUserPreferences(userId);
  const prefx = usePreferenceMutations();
  const isSyncingRef = useRef(false);

  useEffect(() => {
    if (!userId || !prefs || !prefs.autoSyncInterval || prefs.autoSyncInterval <= 0) return;

    const checkAndSync = async () => {
      if (isSyncingRef.current) return;
      
      const intervalMs = prefs.autoSyncInterval! * 60 * 1000;
      const lastSync = prefs.lastSyncTime || 0;
      const now = Date.now();

      if (now - lastSync >= intervalMs) {
        isSyncingRef.current = true;
        try {
          const headless = localStorage.getItem("headlessMode") !== "false";
          const res = await fetch("/api/agents/sync-projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "start", headless })
          });
          
          const data = await res.json();
          if (res.ok && data.ok) {
            await prefx.updateUserPreferences({
              userId,
              lastSyncTime: Date.now()
            });
          }
        } catch (err) {
          console.error("[GlobalSyncManager] Auto-sync failed:", err);
        } finally {
          isSyncingRef.current = false;
        }
      }
    };

    // Check immediately on mount, then every 10 seconds
    checkAndSync();
    const intervalId = setInterval(checkAndSync, 10000);
    return () => clearInterval(intervalId);
  }, [userId, prefs, prefx]);

  return null; // Hidden component
}
