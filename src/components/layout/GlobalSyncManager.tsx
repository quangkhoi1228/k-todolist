"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@clerk/nextjs";
import { useUserPreferences, usePreferenceMutations } from "@/hooks/useDomain";

export function GlobalSyncManager() {
  const { userId } = useAuth();
  const { data: prefs } = useUserPreferences(userId);
  const prefx = usePreferenceMutations();
  const isSyncingRef = useRef(false);
  const isHealthCheckingRef = useRef(false);

  // Auto Healthcheck (Every 1 hour)
  useEffect(() => {
    if (!userId) return;

    const performHealthCheck = async () => {
      if (isHealthCheckingRef.current) return;
      
      const lastCheck = parseInt(localStorage.getItem("lastHealthCheckTime") || "0", 10);
      const now = Date.now();
      const ONE_HOUR = 60 * 60 * 1000;

      if (now - lastCheck >= ONE_HOUR) {
        isHealthCheckingRef.current = true;
        try {
          console.log("[GlobalSyncManager] Running hourly healthcheck...");
          const [teamsRes, zaloRes] = await Promise.all([
            fetch("/api/agents/teams-automator", { method: "POST", body: JSON.stringify({ action: "healthcheck" }) }),
            fetch("/api/agents/zalo-automator", { method: "POST", body: JSON.stringify({ action: "healthcheck" }) })
          ]);
          // Persist health status so OmniPage can pick it up
          try {
            const teamsData = await teamsRes.json();
            localStorage.setItem("healthStatus_teams", teamsData.status || "error");
          } catch { /* ignore parse errors */ }
          try {
            const zaloData = await zaloRes.json();
            localStorage.setItem("healthStatus_zalo", zaloData.status || "error");
          } catch { /* ignore parse errors */ }
          localStorage.setItem("lastHealthCheckTime", Date.now().toString());
        } catch (err) {
          console.error("[GlobalSyncManager] Hourly healthcheck failed:", err);
        } finally {
          isHealthCheckingRef.current = false;
        }
      }
    };

    performHealthCheck();
    const intervalId = setInterval(performHealthCheck, 60000); // Check every minute if 1 hour has passed
    return () => clearInterval(intervalId);
  }, [userId]);

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
