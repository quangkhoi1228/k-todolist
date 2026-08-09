"use client";

import { useState, useEffect, type ReactNode } from "react";
import { useAuth } from "@clerk/nextjs";
import { useUserPreferences, usePreferenceMutations, usePaginatedLogs } from "@/hooks/useDomain";
import { Layers, Loader2, LogIn, RefreshCcw, Settings, Clock, Activity, AlertCircle, CheckCircle2, Info, CheckCircle, XCircle, MessageSquare, ListOrdered } from "lucide-react";
import { format } from "date-fns";

// Queue đồng bộ — shape trả về từ /api/agents/sync-projects (getSyncQueueStatus)
type QueueJobInfo = {
  id: string;
  label: string;
  type: "project" | "all" | "single";
  projectId?: string;
  chats: number;
  chatTasks?: { projectId?: string; chatName: string; platform: string; syncMode: string }[];
};
type CurrentJobTaskInfo = {
  id: string;
  projectId: string;
  chatName: string;
  platform: string;
  syncMode: string;
  status: "pending" | "running" | "done" | "skipped";
};
type SyncQueueInfo = {
  running: boolean;
  queueLength: number;
  currentJob: { id: string; label: string; type: string; projectId?: string } | null;
  currentTask: { projectId: string; chatName: string; platform: string } | null;
  activeProjectId: string | null;
  jobStartTime: number | null;
  taskIndexInJob: number;
  currentJobTasks: CurrentJobTaskInfo[];
  queuedJobs: QueueJobInfo[];
  progress: { total: number; done: number; currentChat?: string; currentProjectId?: string; platform?: string; message?: string } | null;
};

export default function OmniPage() {
  const { userId } = useAuth();
  
  // Data hooks
  const { data: prefs } = useUserPreferences(userId);
  const pm2 = usePreferenceMutations();
  const { results: logs, status: logsStatus, loadMore: loadMoreLogs } = usePaginatedLogs(userId, 20);
  
  // Local state — start with defaults, restore from localStorage on client
  const [teamsStatus, setTeamsStatus] = useState<{ running: boolean; pid?: number; health?: string }>({ running: false });
  const [zaloStatus, setZaloStatus] = useState<{ running: boolean; pid?: number; health?: string }>({ running: false });
  const [headlessMode, setHeadlessMode] = useState(true); // default headless
  const [projectChatReloadInterval, setProjectChatReloadInterval] = useState(120);
  const [lastHealthRun, setLastHealthRun] = useState<number | null>(null);

  // Hydrate from localStorage after mount to avoid hydration mismatch
  useEffect(() => {
    const savedTeams = localStorage.getItem("healthStatus_teams");
    const savedZalo = localStorage.getItem("healthStatus_zalo");
    const savedHeadless = localStorage.getItem("headlessMode");
    const savedProjectChatReload = localStorage.getItem("projectChatReloadInterval");
    if (savedTeams) setTeamsStatus({ running: false, health: savedTeams });
    if (savedZalo) setZaloStatus({ running: false, health: savedZalo });
    if (savedHeadless !== null) setHeadlessMode(savedHeadless === "true");
    if (savedProjectChatReload) setProjectChatReloadInterval(Number(savedProjectChatReload));

    const savedTeamsChats = localStorage.getItem("chatList_teams");
    const savedZaloChats = localStorage.getItem("chatList_zalo");
    if (savedTeamsChats) setTeamsChats(JSON.parse(savedTeamsChats));
    if (savedZaloChats) setZaloChats(JSON.parse(savedZaloChats));

    // Load latest server-side hourly healthcheck status
    fetch("/api/agents/health-status")
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && data.teams?.status) {
          setTeamsStatus((p) => ({ ...p, health: data.teams.status }));
        }
        if (data.ok && data.zalo?.status) {
          setZaloStatus((p) => ({ ...p, health: data.zalo.status }));
        }
        if (data.ok && data.lastRunAt) {
          setLastHealthRun(data.lastRunAt);
        }
      })
      .catch(() => { /* ignore */ });
  }, []);
  const [syncStatus, setSyncStatus] = useState<{ running: boolean; progress?: { total: number; done: number; currentChat?: string; platform?: string; message?: string } | null }>({ running: false });
  const [syncQueue, setSyncQueue] = useState<SyncQueueInfo | null>(null);
  const [loadingAction, setLoadingAction] = useState<"teams" | "zalo" | "sync" | "health-teams" | "health-zalo" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Group list state
  const [teamsChats, setTeamsChats] = useState<string[]>([]);
  const [zaloChats, setZaloChats] = useState<string[]>([]);
  const [fetchingChats, setFetchingChats] = useState(false);
  const [chatListTab, setChatListTab] = useState<"teams" | "zalo">("teams");
  const [chatListSearch, setChatListSearch] = useState("");

  // Time-based re-render for countdown
  const [, setTick] = useState(0);

  // Polling for process status
  useEffect(() => {
    checkProcessStatus();
    const interval = setInterval(checkProcessStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  // Timer for countdown
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  const checkProcessStatus = async () => {
    try {
      const [teamsRes, zaloRes, syncRes] = await Promise.all([
        fetch("/api/agents/teams-automator", { method: "POST", body: JSON.stringify({ action: "status" }) }),
        fetch("/api/agents/zalo-automator", { method: "POST", body: JSON.stringify({ action: "status" }) }),
        fetch("/api/agents/sync-projects", { method: "POST", body: JSON.stringify({ action: "status" }) })
      ]);
      if (teamsRes.ok) {
        const data = await teamsRes.json();
        setTeamsStatus(prev => ({ ...prev, ...data }));
      }
      if (zaloRes.ok) {
        const data = await zaloRes.json();
        setZaloStatus(prev => ({ ...prev, ...data }));
      }
      if (syncRes.ok) {
        const data = await syncRes.json();
        setSyncStatus(prev => ({ ...prev, ...data }));
        setSyncQueue(data);
      }
    } catch (err) {
      console.error("Failed to check status:", err);
    }
  };

  const checkHealth = async (platform: "teams" | "zalo") => {
    try {
      setLoadingAction(`health-${platform}`);
      setError(null);
      const endpoint = platform === "teams" ? "/api/agents/teams-automator" : "/api/agents/zalo-automator";
      
      // Reset health status to checking
      if (platform === "teams") setTeamsStatus(p => ({ ...p, health: "checking" }));
      else setZaloStatus(p => ({ ...p, health: "checking" }));
      
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "healthcheck", headless: headlessMode }),
      });
      const data = await res.json();
      
      if (!data.ok) {
        setError(data.error || "Failed to check health");
      }
      
      const status = data.status || "error";
      localStorage.setItem(`healthStatus_${platform}`, status);
      if (platform === "teams") setTeamsStatus(p => ({ ...p, health: status }));
      else setZaloStatus(p => ({ ...p, health: status }));
    } catch (err: any) {
      setError(err.message);
      localStorage.setItem(`healthStatus_${platform}`, "error");
      if (platform === "teams") setTeamsStatus(p => ({ ...p, health: "error" }));
      else setZaloStatus(p => ({ ...p, health: "error" }));
    } finally {
      setLoadingAction(null);
    }
  };

  const handleLogin = async (platform: "teams" | "zalo") => {
    try {
      setLoadingAction(platform);
      setError(null);
      const endpoint = platform === "teams" ? "/api/agents/teams-automator" : "/api/agents/zalo-automator";
      // Đăng nhập LUÔN mở browser hiện ra (headfull + keepOpen) để user thấy QR/đăng nhập,
      // không phụ thuộc toggle headless (chỉ ảnh hưởng sync tự động)
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ headless: false, keepOpen: true, useRealChrome: true }),
      });
      const data = await res.json();
      if (!data.ok) setError(data.error || "Có lỗi xảy ra khi bật trình duyệt.");
      else await checkProcessStatus();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleManualSync = async () => {
    try {
      setLoadingAction("sync");
      setError(null);
      const res = await fetch("/api/agents/sync-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", headless: headlessMode })
      });
      const data = await res.json();
      if (!data.ok) setError(data.error || "Không thể chạy đồng bộ.");
      else {
        if (userId) {
          await pm2.updateUserPreferences({ userId, lastSyncTime: Date.now() });
        }
        await checkProcessStatus();
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleIntervalChange = async (val: number) => {
    if (userId) {
      await pm2.updateUserPreferences({ userId, autoSyncInterval: val });
    }
  };

  // ─── Chat List ──────────────────────────────────
  const fetchChats = async () => {
    setFetchingChats(true);
    try {
      const [teamsRes, zaloRes] = await Promise.all([
        fetch("/api/agents/teams-automator", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list_chats", headless: headlessMode }),
        }),
        fetch("/api/agents/zalo-automator", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "list_chats", headless: headlessMode }),
        }),
      ]);
      if (teamsRes.ok) {
        const data = await teamsRes.json();
        if (data.chats) {
          setTeamsChats(data.chats);
          localStorage.setItem("chatList_teams", JSON.stringify(data.chats));
        }
      }
      if (zaloRes.ok) {
        const data = await zaloRes.json();
        if (data.chats) {
          setZaloChats(data.chats);
          localStorage.setItem("chatList_zalo", JSON.stringify(data.chats));
        }
      }
    } catch (e) {
      console.error("[OmniPage] Failed to fetch chat lists:", e);
    } finally {
      setFetchingChats(false);
    }
  };

  // Auto-fetch chat lists on mount if no cache
  useEffect(() => {
    const hasCache = localStorage.getItem("chatList_teams") || localStorage.getItem("chatList_zalo");
    if (!hasCache && !fetchingChats && teamsChats.length === 0 && zaloChats.length === 0) {
      fetchChats();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Calculate next sync
  const lastSyncTime = prefs?.lastSyncTime || 0;
  const autoSyncInterval = prefs?.autoSyncInterval || 0;
  let nextSyncStr = "Không hẹn giờ";
  
  if (autoSyncInterval > 0) {
    const nextTime = lastSyncTime + autoSyncInterval * 60 * 1000;
    const diff = nextTime - Date.now();
    if (diff <= 0) {
      nextSyncStr = "Đang chuẩn bị quét...";
    } else {
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      nextSyncStr = `${m} phút ${s} giây`;
    }
  }

  const getLogIcon = (type: string) => {
    if (type.includes("error")) return <AlertCircle className="w-4 h-4 text-red-500" />;
    if (type.includes("start")) return <Activity className="w-4 h-4 text-blue-500" />;
    if (type.includes("end") || type.includes("success")) return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
    return <Info className="w-4 h-4 text-muted-foreground" />;
  };

  const renderHealthBadge = (health?: string) => {
    if (health === "checking") return <span className="flex items-center gap-1.5 text-xs text-yellow-600 bg-yellow-100 dark:bg-yellow-900/30 dark:text-yellow-400 px-2.5 py-0.5 rounded-full"><Loader2 className="w-3 h-3 animate-spin" /> Kiểm tra...</span>;
    if (health === "connected") return <span className="flex items-center gap-1.5 text-xs text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400 px-2.5 py-0.5 rounded-full"><CheckCircle className="w-3 h-3" /> Đã kết nối</span>;
    if (health === "unauthorized") return <span className="flex items-center gap-1.5 text-xs text-red-600 bg-red-100 dark:bg-red-900/30 dark:text-red-400 px-2.5 py-0.5 rounded-full"><XCircle className="w-3 h-3" /> Cần đăng nhập</span>;
    if (health === "busy") return <span className="flex items-center gap-1.5 text-xs text-sky-600 bg-sky-100 dark:bg-sky-900/30 dark:text-sky-400 px-2.5 py-0.5 rounded-full"><Loader2 className="w-3 h-3" /> Đang bận (sync chạy)</span>;
    if (health === "error") return <span className="flex items-center gap-1.5 text-xs text-red-600 bg-red-100 dark:bg-red-900/30 dark:text-red-400 px-2.5 py-0.5 rounded-full"><AlertCircle className="w-3 h-3" /> Lỗi</span>;
    return <span className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-2.5 py-0.5 rounded-full">Chưa kiểm tra</span>;
  };

  const JOB_TYPE_LABEL: Record<string, { label: string; cls: string }> = {
    project: { label: "Project", cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20" },
    all: { label: "Tất cả", cls: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20" },
    single: { label: "1 nhóm", cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" },
  };
  const QueueJobBadge = ({ type }: { type: string }) => {
    const t = JOB_TYPE_LABEL[type] || { label: type, cls: "bg-muted text-muted-foreground border-border" };
    return (
      <span className={`text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full border shrink-0 ${t.cls}`}>
        {t.label}
      </span>
    );
  };

  // Hiển thị 1 task (1 nhóm chat) kèm trạng thái
  const STATUS_META: Record<string, { icon: ReactNode; text: string; cls: string }> = {
    pending: { icon: <Clock className="w-3 h-3 text-muted-foreground/60" />, text: "Chờ", cls: "text-muted-foreground/70" },
    running: { icon: <Loader2 className="w-3 h-3 text-blue-500 animate-spin" />, text: "Đang sync", cls: "text-blue-600 dark:text-blue-400 font-medium" },
    done: { icon: <CheckCircle2 className="w-3 h-3 text-emerald-500" />, text: "Xong", cls: "text-emerald-600 dark:text-emerald-400" },
    skipped: { icon: <AlertCircle className="w-3 h-3 text-red-400" />, text: "Bỏ qua", cls: "text-red-500/80" },
  };
  const TaskItem = ({ task, showProject }: { task: CurrentJobTaskInfo; showProject?: boolean }) => {
    const meta = STATUS_META[task.status] || STATUS_META.pending;
    return (
      <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-muted/20 text-[11px]">
        <span className="shrink-0">{meta.icon}</span>
        <span className={`flex-1 min-w-0 truncate ${meta.cls}`}>
          {task.chatName}
          <span className="text-muted-foreground/60 font-normal"> · {task.platform} · {task.syncMode}</span>
          {showProject && task.projectId && (
            <span className="text-muted-foreground/50 font-normal"> · P{task.projectId}</span>
          )}
        </span>
        <span className={`text-[9px] shrink-0 ${meta.cls}`}>{meta.text}</span>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* Header */}
      <div className="h-16 flex items-center px-6 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-600 dark:text-blue-400">
            <Layers className="w-4 h-4" />
          </div>
          <h1 className="text-xl font-bold">Omni Platform</h1>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 lg:p-6 space-y-4 lg:space-y-6">
        {error && (
          <div className="p-4 rounded-xl bg-red-500/10 text-red-600 dark:text-red-400 text-sm border border-red-500/20">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] 2xl:grid-cols-[1fr_500px] gap-4 lg:gap-6">
          {/* Left Column */}
          <div className="space-y-4 lg:space-y-6">
            
            {/* Connections */}
            <section className="space-y-2">
              <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <Settings className="w-4 h-4" /> Trạng thái Kết nối
                <div className="ml-auto flex items-center gap-2">
                  {/* Headless toggle */}
                  <label className="flex items-center gap-1.5 cursor-pointer select-none" title={headlessMode ? "Đang chạy ẩn (headless)" : "Hiện trình duyệt (headfull)"}>
                    <span className="text-[10px] font-medium text-muted-foreground/70">{headlessMode ? "🤖 Ẩn" : "🖥️ Hiện"}</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={!headlessMode}
                      onClick={() => {
                        const newVal = !headlessMode;
                        setHeadlessMode(newVal);
                        localStorage.setItem("headlessMode", String(newVal));
                      }}
                      className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
                        !headlessMode ? "bg-blue-500" : "bg-muted-foreground/30"
                      }`}
                    >
                      <span
                        className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                          !headlessMode ? "translate-x-3.5" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                  </label>
                </div>
              </h2>
              <p className="text-[11px] text-muted-foreground/70 flex items-center gap-1.5">
                <Activity className="w-3 h-3" />
                Tự động kiểm tra mỗi giờ
                {lastHealthRun && (
                  <span className="text-muted-foreground/50">· lần cuối: {format(lastHealthRun, "HH:mm:ss dd/MM")}</span>
                )}
              </p>
              <div className="p-1.5 rounded-2xl border border-border bg-card shadow-sm flex flex-col divide-y divide-border/50">
                {/* Teams Row */}
                <div className="p-2 flex items-center justify-between gap-3 transition-all hover:bg-muted/30">
                  <div className="flex items-center gap-3">
                    <img src="/teams.svg" alt="Microsoft Teams" className="w-8 h-8 shrink-0 object-contain drop-shadow-sm" />
                    <div className="min-w-0">
                      <h3 className="font-semibold text-[13px] flex items-center gap-1.5 text-foreground leading-tight">
                        Microsoft Teams
                        {teamsStatus.running && (
                          <span className="flex h-1.5 w-1.5 relative shrink-0">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                          </span>
                        )}
                      </h3>
                      <div className="mt-1">
                        {renderHealthBadge(teamsStatus.health)}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => checkHealth("teams")}
                      disabled={teamsStatus.health === "checking" || teamsStatus.running || loadingAction === "health-teams"}
                      className="px-2.5 py-1.5 text-[11px] font-medium rounded-lg border border-border bg-background hover:bg-muted transition-colors disabled:opacity-50"
                    >
                      {loadingAction === "health-teams" ? "..." : "Check"}
                    </button>
                    <button
                      onClick={() => handleLogin("teams")}
                      disabled={teamsStatus.running || loadingAction === "teams"}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-lg bg-[#5B5FC7]/10 text-[#5B5FC7] hover:bg-[#5B5FC7]/20 transition-colors disabled:opacity-50"
                    >
                      {loadingAction === "teams" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogIn className="w-3.5 h-3.5" />}
                      <span className="hidden sm:inline">Đăng nhập</span>
                    </button>
                  </div>
                </div>

                {/* Zalo Row */}
                <div className="p-2 flex items-center justify-between gap-3 transition-all hover:bg-muted/30">
                  <div className="flex items-center gap-3">
                    <img src="/zalo.svg" alt="Zalo Web" className="w-8 h-8 shrink-0 object-contain drop-shadow-sm" />
                    <div className="min-w-0">
                      <h3 className="font-semibold text-[13px] flex items-center gap-1.5 text-foreground leading-tight">
                        Zalo Web
                        {zaloStatus.running && (
                          <span className="flex h-1.5 w-1.5 relative shrink-0">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                          </span>
                        )}
                      </h3>
                      <div className="mt-1">
                         {renderHealthBadge(zaloStatus.health)}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => checkHealth("zalo")}
                      disabled={zaloStatus.health === "checking" || zaloStatus.running || loadingAction === "health-zalo"}
                      className="px-2.5 py-1.5 text-[11px] font-medium rounded-lg border border-border bg-background hover:bg-muted transition-colors disabled:opacity-50"
                    >
                      {loadingAction === "health-zalo" ? "..." : "Check"}
                    </button>
                    <button
                      onClick={() => handleLogin("zalo")}
                      disabled={zaloStatus.running || loadingAction === "zalo"}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-lg bg-[#0068FF]/10 text-[#0068FF] hover:bg-[#0068FF]/20 transition-colors disabled:opacity-50"
                    >
                      {loadingAction === "zalo" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogIn className="w-3.5 h-3.5" />}
                      <span className="hidden sm:inline">Đăng nhập</span>
                    </button>
                  </div>
                </div>
              </div>
            </section>

            {/* Sync Manager */}
            <section className="space-y-2">
              <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <RefreshCcw className="w-4 h-4" /> Đồng bộ Dữ liệu
              </h2>
              <div className="p-5 rounded-2xl border border-border bg-card shadow-sm space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-sm flex items-center gap-2">
                      Trạng thái đồng bộ
                      {syncStatus.running && (
                        <span className="flex h-2 w-2 relative">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                        </span>
                      )}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      {lastSyncTime > 0 ? `Lần quét cuối: ${format(lastSyncTime, "HH:mm:ss dd/MM")}` : "Chưa có dữ liệu"}
                    </p>
                  </div>
                  <button
                    onClick={handleManualSync}
                    disabled={syncStatus.running || loadingAction === "sync"}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 shadow-sm"
                  >
                    {loadingAction === "sync" || syncStatus.running ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
                    {syncStatus.running ? "Đang đồng bộ..." : "Đồng bộ ngay"}
                  </button>
                </div>

                {/* Sync Progress Bar */}
                {syncStatus.running && syncStatus.progress && syncStatus.progress.total > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        {syncStatus.progress.message || `Đang đồng bộ chat thứ ${syncStatus.progress.done + 1}/${syncStatus.progress.total}...`}
                      </span>
                      <span className="font-medium text-foreground">
                        {Math.round((syncStatus.progress.done / syncStatus.progress.total) * 100)}%
                      </span>
                    </div>
                    <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-500 ease-out"
                        style={{ width: `${(syncStatus.progress.done / syncStatus.progress.total) * 100}%` }}
                      />
                    </div>
                  </div>
                )}

                <div className="pt-4 border-t border-border/50 flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-muted-foreground" />
                    <p className="text-sm font-medium">
                      Hẹn giờ: <span className="text-primary font-bold">{nextSyncStr}</span>
                    </p>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-muted/20 p-4 rounded-xl border border-border/50">
                    <div className="flex flex-col gap-2">
                      <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Sync Tất Cả (Trang Omni)</label>
                      <select
                        value={autoSyncInterval}
                        onChange={(e) => handleIntervalChange(Number(e.target.value))}
                        className="bg-background border border-border/50 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary cursor-pointer font-medium text-foreground w-full transition-colors hover:bg-accent/50"
                        title="Thời gian tự động sync tất cả nhóm khi treo Omni page"
                      >
                        <option value={0}>Tắt tự động</option>
                        <option value={1}>Mỗi 1 phút</option>
                        <option value={5}>Mỗi 5 phút</option>
                        <option value={15}>Mỗi 15 phút</option>
                        <option value={30}>Mỗi 30 phút (mặc định)</option>
                        <option value={60}>Mỗi 1 tiếng</option>
                        <option value={120}>Mỗi 2 tiếng</option>
                      </select>
                    </div>
                    
                    <div className="flex flex-col gap-2">
                      <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Sync Nhóm (Trang Dự án)</label>
                      <select
                        value={projectChatReloadInterval}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setProjectChatReloadInterval(val);
                          localStorage.setItem("projectChatReloadInterval", val.toString());
                          window.dispatchEvent(new CustomEvent("projectChatReloadIntervalChanged", { detail: val }));
                        }}
                        className="bg-background border border-border/50 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary cursor-pointer font-medium text-foreground w-full transition-colors hover:bg-accent/50"
                        title="Thời gian tự động tải lại chat khi bạn đang mở chi tiết 1 dự án"
                      >
                        <option value={0}>Tắt tự động</option>
                        <option value={30}>Mỗi 30 giây</option>
                        <option value={60}>Mỗi 1 phút</option>
                        <option value={90}>Mỗi 1 phút rưỡi</option>
                        <option value={120}>Mỗi 2 phút (mặc định)</option>
                        <option value={180}>Mỗi 3 phút</option>
                        <option value={300}>Mỗi 5 phút</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-2">
                      <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Chế độ đồng bộ</label>
                      <select
                        value={prefs?.chatSyncMode || "incremental"}
                        onChange={(e) => {
                          if (userId) void pm2.updateUserPreferences({ userId, chatSyncMode: e.target.value });
                        }}
                        className="bg-background border border-border/50 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary cursor-pointer font-medium text-foreground w-full transition-colors hover:bg-accent/50"
                        title="Incremental: chỉ lấy tin mới từ mốc đã sync (nhanh — dùng cho sync tự động). Full: quét toàn bộ lịch sử chat (chậm — dùng khi cần lấy lại dữ liệu cũ)."
                      >
                        <option value="incremental">Incremental (nhanh)</option>
                        <option value="full">Full (đầy đủ)</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Sync Queue */}
            <section className="space-y-2">
              <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <ListOrdered className="w-4 h-4" /> Queue đồng bộ
                {syncQueue && syncQueue.queueLength > 0 && (
                  <span className="ml-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                    {syncQueue.queueLength} job chờ
                  </span>
                )}
              </h2>
              <div className="rounded-2xl border border-border bg-card shadow-sm p-4 space-y-3">
                {!syncQueue ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/50" />
                  </div>
                ) : syncQueue.running || syncQueue.queuedJobs.length > 0 ? (
                  <>
                    {/* Job đang chạy */}
                    {syncQueue.currentJob && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-foreground/80 flex items-center gap-1.5">
                            <Activity className="w-3.5 h-3.5 text-blue-500" />
                            {syncQueue.currentJob.label}
                            <QueueJobBadge type={syncQueue.currentJob.type} />
                          </span>
                          {syncQueue.currentTask && (
                            <span className="text-[10px] text-muted-foreground truncate max-w-[45%]">
                              đang sync: <span className="font-medium text-foreground/70">{syncQueue.currentTask.chatName}</span>
                            </span>
                          )}
                        </div>

                        {/* Progress tổng */}
                        {syncQueue.progress && syncQueue.progress.total > 0 && (
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                              <span>{syncQueue.progress.message}</span>
                              <span className="font-medium text-foreground/70">
                                {Math.round((syncQueue.progress.done / syncQueue.progress.total) * 100)}%
                              </span>
                            </div>
                            <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full bg-blue-500 rounded-full transition-all duration-500 ease-out"
                                style={{ width: `${(syncQueue.progress.done / syncQueue.progress.total) * 100}%` }}
                              />
                            </div>
                          </div>
                        )}

                        {/* Từng task nhỏ — trạng thái chờ/đang/xong */}
                        {syncQueue.currentJobTasks.length > 0 && (
                          <div className="pt-1 space-y-1">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold">
                              Task chi tiết ({syncQueue.currentJobTasks.filter(t => t.status === "done").length}/{syncQueue.currentJobTasks.length} xong)
                            </p>
                            <div className="space-y-1 max-h-40 overflow-y-auto custom-scrollbar">
                              {syncQueue.currentJobTasks.map((task) => (
                                <TaskItem key={task.id} task={task} showProject />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Worker đang hoạt động nhưng chưa nhặt job (chờ lock) */}
                    {!syncQueue.currentJob && (
                      <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
                        Worker đang chạy — chờ khởi động job kế tiếp...
                      </div>
                    )}

                    {/* Job chờ trong queue */}
                    {syncQueue.queuedJobs.length > 0 && (
                      <div className="pt-2 border-t border-border/50 space-y-1.5">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold">
                          Đang chờ ({syncQueue.queuedJobs.length} job)
                        </p>
                        {syncQueue.queuedJobs.map((job) => (
                          <div key={job.id} className="px-2 py-1.5 rounded-lg bg-muted/30 text-xs space-y-1">
                            <div className="flex items-center gap-2">
                              <Clock className="w-3 h-3 text-muted-foreground shrink-0" />
                              <span className="flex-1 min-w-0 truncate text-foreground/80">{job.label}</span>
                              <QueueJobBadge type={job.type} />
                              <span className="text-[10px] text-muted-foreground/70 shrink-0">{job.chats} chats</span>
                            </div>
                            {/* Từng nhóm chat trong job chờ */}
                            {job.chatTasks && job.chatTasks.length > 0 && (
                              <div className="pl-5 space-y-0.5">
                                {job.chatTasks.map((c, i) => (
                                  <div key={i} className="flex items-center gap-1.5 text-[10px] text-muted-foreground/80">
                                    <span className="w-1 h-1 rounded-full bg-muted-foreground/40 shrink-0" />
                                    <span className="truncate">{c.chatName}</span>
                                    <span className="text-muted-foreground/50 shrink-0">· {c.platform}</span>
                                    {job.type === "all" && c.projectId && (
                                      <span className="text-muted-foreground/40 shrink-0">· P{c.projectId}</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {syncQueue.activeProjectId && (
                      <p className="pt-2 border-t border-border/50 text-[11px] text-muted-foreground/70 flex items-center gap-1.5">
                        <Info className="w-3 h-3" /> Project đang xem được ưu tiên chạy trước
                      </p>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center py-4 text-muted-foreground">
                    <ListOrdered className="w-8 h-8 mb-2 opacity-20" />
                    <p className="text-xs">Queue đang rảnh — không có job đang chạy hoặc chờ</p>
                  </div>
                )}
              </div>
            </section>

            {/* Chat Lists */}
            <section className="space-y-2">
              <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <MessageSquare className="w-4 h-4" /> Danh sách nhóm
              </h2>
              <div className="rounded-2xl border border-border bg-card shadow-sm flex flex-col max-h-[50vh] min-h-[200px]">
                {/* Tabs - fixed */}
                <div className="flex border-b border-border/50 shrink-0">
                  <button
                    type="button"
                    onClick={() => setChatListTab("teams")}
                    className={`flex-1 text-[11px] font-semibold py-2.5 px-3 transition-colors flex items-center justify-center gap-1.5 ${
                      chatListTab === "teams"
                        ? "text-foreground border-b-2 border-[#5B5FC7] bg-[#5B5FC7]/5"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                    }`}
                  >
                    <img src="/teams.svg" alt="" className="w-4 h-4" />
                    Teams
                    <span className="text-[10px] text-muted-foreground/60 ml-0.5">({teamsChats.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setChatListTab("zalo")}
                    className={`flex-1 text-[11px] font-semibold py-2.5 px-3 transition-colors flex items-center justify-center gap-1.5 ${
                      chatListTab === "zalo"
                        ? "text-foreground border-b-2 border-[#0068FF] bg-[#0068FF]/5"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                    }`}
                  >
                    <img src="/zalo.svg" alt="Zalo Web" className="w-4 h-4 shrink-0 object-contain drop-shadow-sm" />
                    Zalo
                    <span className="text-[10px] text-muted-foreground/60 ml-0.5">({zaloChats.length})</span>
                  </button>
                </div>

                {/* Toolbar - fixed */}
                <div className="flex items-center justify-between px-3 py-2 border-b border-border/30 shrink-0">
                  <div className="relative flex-1 max-w-[200px]">
                    <input
                      type="text"
                      value={chatListSearch}
                      onChange={(e) => setChatListSearch(e.target.value)}
                      placeholder="Tìm nhóm..."
                      className="w-full text-[11px] px-2.5 py-1.5 rounded-lg bg-muted/50 border border-border/50 outline-none focus:border-primary/40 placeholder:text-muted-foreground/40"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={fetchChats}
                    disabled={fetchingChats}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-lg border border-border bg-background hover:bg-muted transition-colors disabled:opacity-50"
                  >
                    <RefreshCcw className={`w-3.5 h-3.5 ${fetchingChats ? "animate-spin" : ""}`} />
                    Tải lại
                  </button>
                </div>

                {/* Chat items - scrollable */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-1 min-h-0">
                  {fetchingChats ? (
                    <div className="flex items-center justify-center h-full">
                      <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/50" />
                    </div>
                  ) : (chatListTab === "teams" ? teamsChats : zaloChats).length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                      <MessageSquare className="w-8 h-8 mb-2 opacity-20" />
                      <p className="text-xs">Chưa có dữ liệu</p>
                      <p className="text-[10px] text-muted-foreground/60 mt-1">Nhấn "Tải lại" để lấy danh sách nhóm</p>
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      {(chatListTab === "teams" ? teamsChats : zaloChats)
                        .filter((c) => c.toLowerCase().includes(chatListSearch.toLowerCase()))
                        .map((chat, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs text-foreground/80 hover:bg-muted/50 transition-colors"
                          >
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                              chatListTab === "teams" ? "bg-[#5B5FC7]" : "bg-[#0068FF]"
                            }`} />
                            <span className="truncate">{chat}</span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            </section>
          </div>

          {/* Right Column: Logs */}
          <section className="space-y-2 flex flex-col lg:max-h-[calc(100vh-180px)] lg:sticky lg:top-4 self-start">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Activity className="w-4 h-4" /> Lịch sử quét
            </h2>
            <div className="flex-1 rounded-2xl border border-border bg-card shadow-sm overflow-y-auto flex flex-col p-2 min-h-0">
              {logs === undefined ? (
                  <div className="h-full flex items-center justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground/50" />
                  </div>
                ) : logs && logs.length > 0 ? (
                  <div className="space-y-1">
                    {logs.map((log) => (
                      <div key={log._id} className="flex items-start gap-3 p-3 hover:bg-muted/50 rounded-xl transition-colors">
                        <div className="mt-0.5 shrink-0">
                          {getLogIcon(log.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium text-foreground/90 truncate">{log.message}</span>
                            <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
                              {format(log.createdAt, "HH:mm:ss")}
                            </span>
                          </div>
                          {(log.chatName || log.details) && (
                            <p className="text-xs text-muted-foreground/80 mt-1 line-clamp-2">
                              {log.chatName && <span className="font-semibold text-foreground/70 mr-1">[{log.chatName}]</span>}
                              {log.details}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                    <Activity className="w-10 h-10 mb-2 opacity-20" />
                    <p className="text-sm">Chưa có dữ liệu log</p>
                  </div>
                )}
                {logsStatus === "CanLoadMore" && (
                  <div className="flex justify-center mt-4 mb-2">
                    <button
                      onClick={() => loadMoreLogs(20)}
                      className="px-4 py-2 bg-muted hover:bg-muted/80 text-foreground text-xs rounded-full font-medium transition-colors flex items-center gap-2"
                    >
                      <RefreshCcw className="w-3 h-3" />
                      Tải thêm
                    </button>
                  </div>
                )}
                {logsStatus === "LoadingMore" && (
                  <div className="flex justify-center mt-4 mb-2">
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  </div>
                )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
