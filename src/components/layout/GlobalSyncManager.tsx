"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@clerk/nextjs";
import { useUserPreferences, usePreferenceMutations } from "@/hooks/useDomain";

export function GlobalSyncManager() {
  const { userId } = useAuth();
  const { data: prefs } = useUserPreferences(userId);
  const prefx = usePreferenceMutations();
  const isSyncingRef = useRef(false);
  const queuedRef = useRef(false);

  // Check sync-projects status. Returns true if a background sync is running.
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

  const startSync = async (): Promise<boolean> => {
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
    if (!userId || !prefs || !prefs.autoSyncInterval || prefs.autoSyncInterval <= 0) return;

    const intervalMs = prefs.autoSyncInterval! * 60 * 1000;

    const runSync = async () => {
      if (isSyncingRef.current) {
        // A sync is still running — remember we need one more after it finishes.
        queuedRef.current = true;
        return;
      }

      const lastSync = prefs.lastSyncTime || 0;
      const now = Date.now();
      if (now - lastSync < intervalMs) return;

      isSyncingRef.current = true;
      try {
        // Queue semantics: if the previous run is still going, wait for it to
        // finish before starting the queued one (do not stack parallel syncs —
        // the API lock file rejects them anyway).
        let waited = 0;
        while (await checkIfRunning() && waited < intervalMs) {
          await new Promise((r) => setTimeout(r, 15000));
          waited += 15000;
        }

        const ok = await startSync();
        if (ok) {
          await prefx.updateUserPreferences({
            userId,
            lastSyncTime: Date.now(),
          });
        } else {
          // Rejected (another sync already running or server error). Without
          // updating lastSyncTime we'd retry every 10s forever — treat this
          // attempt as done and let the next interval check trigger a new one.
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
        queuedRef.current = false;
      }
    };

    // Check immediately on mount, then every 10 seconds
    runSync();
    const intervalId = setInterval(runSync, 10000);
    return () => clearInterval(intervalId);
  }, [userId, prefs, prefx]);

  return null; // Hidden component
}
