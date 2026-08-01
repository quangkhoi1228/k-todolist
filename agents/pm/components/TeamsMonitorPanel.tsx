"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useAuth } from "@clerk/nextjs";
import {
  Loader2, X, RefreshCw, MessageSquare,
  Users, ChevronDown, ChevronUp, AlertTriangle,
  CheckCircle, Clock, Search, Filter, Play, Settings,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────

interface TeamsMessage {
  id: string;
  groupId: string;
  groupName: string;
  sender: string;
  content: string;
  timestamp: number;
}

interface ScopeChange {
  id: string;
  type: string;
  description: string;
  confidence: string;
  sourceMessageId: string;
  sourceContent: string;
  suggestedAction: string;
}

interface ActionItem {
  id: string;
  description: string;
  assignee: string | null;
  deadline: string | null;
  priority: string;
  sourceMessageId: string;
}

interface KeywordAlert {
  keyword: string;
  matchCount: number;
  messages: Array<{ id: string; sender: string; content: string; timestamp: number }>;
  suggestedAction: string;
}

interface TeamsAnalysis {
  scopeChanges: ScopeChange[];
  actionItems: ActionItem[];
  keywordAlerts: KeywordAlert[];
  summary: string;
}

interface MonitoredGroup {
  id: string;
  name: string;
  deepLink: string;
  type: "internal" | "external";
  lastExtractedAt: number | null;
  autoMonitor: boolean;
  keywords: string[];
  notifyOnKeyword: boolean;
}

interface MonitorConfig {
  groups: MonitoredGroup[];
  autoMonitorIntervalMs: number;
}

// ─── Helpers ────────────────────────────────────────────────

function formatTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleDateString("vi-VN", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

function formatRelative(ts: number) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "Vài giây trước";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} phút trước`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} giờ trước`;
  return `${Math.floor(diff / 86400_000)} ngày trước`;
}

// ─── Props ──────────────────────────────────────────────────

interface TeamsMonitorPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSuggestionGenerated?: (suggestions: any[]) => void;
}

// ─── Component ──────────────────────────────────────────────

export function TeamsMonitorPanel({ isOpen, onClose, onSuggestionGenerated }: TeamsMonitorPanelProps) {
  const [activeTab, setActiveTab] = useState<"messages" | "analysis" | "config">("messages");
  const [messages, setMessages] = useState<TeamsMessage[]>([]);
  const [analysis, setAnalysis] = useState<TeamsAnalysis | null>(null);
  const [config, setConfig] = useState<MonitorConfig>({ groups: [], autoMonitorIntervalMs: 1800000 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Message filter / search
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMessage, setViewMessage] = useState<TeamsMessage | null>(null);

  // Analysis detail
  const [showScopeDetail, setShowScopeDetail] = useState(false);
  const [showActionDetail, setShowActionDetail] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ─── Active Projects with Teams Groups (Convex) ─────
  const { userId } = useAuth();
  const activeProjects = useQuery(
    api.projects.getActiveProjectsWithTeamsGroups,
    userId ? { userId } : "skip"
  );

  // Derive monitored groups from active projects
  const projectGroups = useMemo(() => {
    if (!activeProjects) return [];
    const groups: Array<{
      projectId: string;
      projectName: string;
      internalGroupUrl: string | null;
      customerGroupUrl: string | null;
    }> = [];
    for (const p of activeProjects) {
      if (p.internalGroupUrl || p.customerGroupUrl) {
        groups.push({
          projectId: p._id,
          projectName: p.name,
          internalGroupUrl: p.internalGroupUrl ?? null,
          customerGroupUrl: p.customerGroupUrl ?? null,
        });
      }
    }
    return groups;
  }, [activeProjects]);

  // Sync to config.groups for backward compatibility with automator
  useEffect(() => {
    const gs: MonitoredGroup[] = [];
    let counter = 0;
    for (const pg of projectGroups) {
      if (pg.internalGroupUrl) {
        counter++;
        gs.push({
          id: `proj_${pg.projectId}_int`,
          name: `${pg.projectName} (Nội bộ)`,
          deepLink: pg.internalGroupUrl,
          type: "internal",
          lastExtractedAt: null,
          autoMonitor: true,
          keywords: [],
          notifyOnKeyword: true,
        });
      }
      if (pg.customerGroupUrl) {
        counter++;
        gs.push({
          id: `proj_${pg.projectId}_ext`,
          name: `${pg.projectName} (KH)`,
          deepLink: pg.customerGroupUrl,
          type: "external",
          lastExtractedAt: null,
          autoMonitor: true,
          keywords: [],
          notifyOnKeyword: true,
        });
      }
    }
    setConfig({ groups: gs, autoMonitorIntervalMs: 1800000 });
  }, [projectGroups]);

  // ─── Load data ──────────────────────────────────────
  const loadMessages = useCallback(async () => {
    try {
      const res = await fetch("/api/agents/teams-messages");
      if (!res.ok) return;
      const data = await res.json();
      const msgs: TeamsMessage[] = (data.messages || []).map((m: any, i: number) => ({
        id: `msg_${i}`,
        groupId: m.groupId || m.groupName || "extracted",
        groupName: m.groupName || m.channel || "Teams",
        sender: m.sender || "Unknown",
        content: m.content || "",
        timestamp: typeof m.timestamp === "number" ? m.timestamp : Date.parse(String(m.timestamp)) || Date.now(),
      }));
      setMessages(msgs);
    } catch { /* ignore */ }
  }, []);

  // Automator state
  const [automatorRunning, setAutomatorRunning] = useState(false);
  const [automatorPid, setAutomatorPid] = useState<number | null>(null);
  const [automatorError, setAutomatorError] = useState<string | null>(null);
  const [automatorDeepLink, setAutomatorDeepLink] = useState("");
  const [automatorChatName, setAutomatorChatName] = useState("");
  const [automatorHeadless, setAutomatorHeadless] = useState(true);
  const [automatorKeepOpen, setAutomatorKeepOpen] = useState(false);
  const [automatorUseRealChrome, setAutomatorUseRealChrome] = useState(true);
  const [availableChats, setAvailableChats] = useState<string[]>([]);
  const [fetchingChats, setFetchingChats] = useState(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Automator: fetch chats ───────────────────────────
  const fetchChats = useCallback(async () => {
    setFetchingChats(true);
    setAutomatorError(null);
    try {
      const res = await fetch("/api/agents/teams-automator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list_chats" }),
      });
      const data = await res.json();
      if (!data.ok) {
        setAutomatorError(data.error || "Failed to fetch chats");
      } else if (data.chats) {
        setAvailableChats(data.chats);
      }
    } catch (err) {
      setAutomatorError(err instanceof Error ? err.message : "Error fetching chats");
    } finally {
      setFetchingChats(false);
    }
  }, []);

  // ─── Automator: start ───────────────────────────────
  const startAutomation = useCallback(async (deepLink?: string, headlessOverride?: boolean, keepOpenOverride?: boolean) => {
    setAutomatorRunning(true);
    setAutomatorError(null);
    try {
      const link = deepLink || automatorDeepLink.trim() || undefined;
      const headless = headlessOverride !== undefined ? headlessOverride : automatorHeadless;
      const keepOpen = keepOpenOverride !== undefined ? keepOpenOverride : automatorKeepOpen;
      const res = await fetch("/api/agents/teams-automator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deepLink: link,
          chatName: automatorChatName.trim() || undefined,
          headless,
          keepOpen,
          useRealChrome: automatorUseRealChrome,
          keywords: config.groups.flatMap((g) => g.keywords),
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setAutomatorError(data.error || "Failed to start");
        setAutomatorRunning(false);
      } else {
        setAutomatorPid(data.pid);
        // Poll for completion
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = setInterval(async () => {
          try {
            const statusRes = await fetch("/api/agents/teams-automator", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "status" }),
            });
            const statusData = await statusRes.json();
            if (!statusData.running) {
              if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
              setAutomatorRunning(false);
              setAutomatorPid(null);
              // Reload messages + run analysis
              await loadMessages();
              setActiveTab("messages");
            }
          } catch { /* ignore */ }
        }, 5000);
      }
    } catch (err) {
      setAutomatorError(err instanceof Error ? err.message : "Failed to start automation");
      setAutomatorRunning(false);
    }
  }, [automatorDeepLink, automatorChatName, automatorHeadless, automatorKeepOpen, automatorUseRealChrome, config.groups, loadMessages]);

  // Cleanup poll interval
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  const runAnalysis = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/agents/teams-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "analyse" }),
      });
      if (!res.ok) throw new Error("Failed to analyse");
      const data = await res.json();
      if (data.ok && data.analysis) {
        setAnalysis(data.analysis);
        if (onSuggestionGenerated && data.suggestions) {
          onSuggestionGenerated(data.suggestions);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }, [onSuggestionGenerated]);

  useEffect(() => {
    if (isOpen) {
      loadMessages();
    }
  }, [isOpen, loadMessages]);

  // ─── Filter messages ────────────────────────────────
  const filteredMessages = searchQuery
    ? messages.filter((m) =>
        m.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.sender.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.groupName.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : messages;

  // ─── Run extraction ─────────────────────────────────
  const runExtraction = () => {
    setLoading(true);
    setError(null);
    // Open extraction instructions
    const msg = [
      "## Hướng dẫn trích xuất Teams\n\n",
      "Do Playwright cần trình duyệt thực tế, vui lòng chạy lệnh sau trong terminal:\n\n",
      "```bash\n",
      "TEAMS_DEEPLINK=\"<deep-link-của-bạn>\" npx tsx agents/pm/scripts/teams-automator.ts --headless\n",
      "```\n\n",
      "Sau đó refresh panel để xem kết quả.\n\n",
      "---\n\n",
      "Nếu chưa có deep link, hãy copy URL từ thanh địa chỉ khi đang ở channel/group chat Teams.",
    ].join("");

    // Show in dialog
    const dialog = window.confirm(
      "Để trích xuất tin nhắn Teams, bạn cần chạy script trong terminal.\n\n" +
      "Lệnh: TEAMS_DEEPLINK=\"<deep-link>\" npx tsx agents/pm/scripts/teams-automator.ts --headless\n\n" +
      "Sau khi chạy xong, nhấn OK để refresh messages."
    );

    if (dialog) {
      loadMessages().then(() => {
        // Auto-run analysis after loading
        runAnalysis();
      });
    }
    setLoading(false);
  };

  if (!isOpen) return null;

  return (
    <div className="flex flex-col h-full bg-background/98 dark:bg-zinc-900/98 border-l border-border/50">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-border/40 dark:border-zinc-800 bg-gradient-to-r from-primary/5 to-transparent">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500/20 to-blue-500/5 flex items-center justify-center ring-2 ring-blue-500/20">
            <Users className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <p className="text-sm font-bold text-foreground dark:text-zinc-100 leading-tight">Teams Monitor</p>
            <p className="text-[10px] text-muted-foreground dark:text-zinc-500">
              {messages.length} tin nhắn · {projectGroups.length} dự án
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => { loadMessages(); runAnalysis(); }}
            disabled={loading}
            className="w-7 h-7 rounded-lg hover:bg-foreground/5 dark:hover:bg-white/10 flex items-center justify-center cursor-pointer text-muted-foreground hover:text-foreground dark:text-zinc-400 dark:hover:text-zinc-100 transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg hover:bg-destructive/10 dark:hover:bg-red-500/20 flex items-center justify-center cursor-pointer text-muted-foreground hover:text-destructive dark:text-zinc-400 dark:hover:text-red-400 transition-colors"
            title="Đóng"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="shrink-0 flex border-b border-border/30 dark:border-zinc-800 px-3 gap-0.5">
        {[
          { id: "messages" as const, label: "Messages", icon: MessageSquare },
          { id: "analysis" as const, label: "Phân tích", icon: Search },
          { id: "config" as const, label: "Nhóm", icon: Settings },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-semibold border-b-2 transition-all cursor-pointer ${
              activeTab === tab.id
                ? "border-primary text-primary dark:text-blue-400 dark:border-blue-400"
                : "border-transparent text-muted-foreground hover:text-foreground dark:text-zinc-500 dark:hover:text-zinc-300"
            }`}
          >
            <tab.icon className="w-3 h-3" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="shrink-0 mx-3 mt-2 p-2.5 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
          <p className="text-[11px] text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* Tab Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* ─── MESSAGES TAB ─────────────────────────── */}
        {activeTab === "messages" && (
          <div className="flex flex-col h-full">
            {/* Search bar */}
            <div className="shrink-0 px-3 py-2">
              <div className="flex items-center gap-2 bg-card dark:bg-zinc-800/80 border border-border/50 dark:border-zinc-700/60 rounded-xl px-3 py-1.5">
                <Search className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Tìm kiếm tin nhắn..."
                  className="flex-1 bg-transparent border-none outline-none text-xs font-medium dark:text-zinc-100 placeholder:text-muted-foreground/50"
                />
                {searchQuery && (
                  <button type="button" onClick={() => setSearchQuery("")} className="text-muted-foreground/60 hover:text-foreground cursor-pointer">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Action buttons + Automator deep link input */}
            <div className="shrink-0 px-3 pb-2 space-y-2">
              {/* Deep link quick input + login helper */}
              <div className="flex items-center gap-2 bg-card dark:bg-zinc-800/80 border border-border/50 dark:border-zinc-700/60 rounded-xl px-3 py-1.5">
                <Play className={`w-3.5 h-3.5 shrink-0 ${automatorRunning ? "text-emerald-500 animate-pulse" : "text-muted-foreground/60"}`} />
                <input
                  type="text"
                  list="chat-name-suggestions"
                  value={automatorChatName}
                  onChange={(e) => setAutomatorChatName(e.target.value)}
                  placeholder={automatorRunning ? "Đang chạy..." : "Tên chat (VD: Internal - PM CDC)"}
                  disabled={automatorRunning}
                  className="flex-1 bg-transparent border-none outline-none text-xs font-medium dark:text-zinc-100 placeholder:text-muted-foreground/50"
                />
                <datalist id="chat-name-suggestions">
                  {availableChats.map((chat) => (
                    <option key={chat} value={chat} />
                  ))}
                </datalist>
                
                <button
                  type="button"
                  onClick={() => fetchChats()}
                  disabled={fetchingChats || automatorRunning}
                  className={`text-[10px] px-2 py-1 rounded-lg border transition-all cursor-pointer shrink-0 ${
                    fetchingChats
                      ? "bg-muted text-muted-foreground border-border/50"
                      : availableChats.length > 0
                      ? "bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-500/30 hover:bg-purple-500/20"
                      : "bg-muted/50 hover:bg-muted text-muted-foreground border-border/50"
                  }`}
                  title="Tải danh sách nhóm chat (mất khoảng 10-15s)"
                >
                  {fetchingChats ? <Loader2 className="w-3 h-3 animate-spin" /> : "🔄"}
                </button>
                {automatorRunning ? (
                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium shrink-0 whitespace-nowrap">
                    PID: {automatorPid}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => startAutomation()}
                    disabled={(!automatorDeepLink.trim() && !automatorChatName.trim()) || loading || automatorRunning}
                    className="text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-500/30 transition-all cursor-pointer disabled:opacity-50 shrink-0 whitespace-nowrap"
                  >
                    {loading ? <Loader2 className="w-3 h-3 animate-spin inline" /> : "Chạy"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setAutomatorHeadless(!automatorHeadless)}
                  className={`text-[10px] px-2 py-1 rounded-lg border transition-all cursor-pointer shrink-0 ${
                    automatorHeadless
                      ? "bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-300"
                      : "bg-amber-500/10 border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-300"
                  }`}
                  title={automatorHeadless ? "Chạy ẩn (không hiện browser)" : "Hiện browser"}
                >
                  {automatorHeadless ? "🤖" : "🖥️"}
                </button>
                <button
                  type="button"
                  onClick={() => setAutomatorKeepOpen(!automatorKeepOpen)}
                  className={`text-[10px] px-2 py-1 rounded-lg border transition-all cursor-pointer shrink-0 ${
                    automatorKeepOpen
                      ? "bg-purple-500/10 border-purple-200 dark:border-purple-500/30 text-purple-700 dark:text-purple-300"
                      : "bg-zinc-100 dark:bg-zinc-800 border-border/50 text-muted-foreground"
                  }`}
                  title={automatorKeepOpen ? "Giữ browser mở sau khi trích xuất" : "Tự động đóng browser"}
                >
                  {automatorKeepOpen ? "🔓" : "🔒"}
                </button>
                <button
                  type="button"
                  onClick={() => setAutomatorUseRealChrome(!automatorUseRealChrome)}
                  className={`text-[10px] px-2 py-1 rounded-lg border transition-all cursor-pointer shrink-0 ${
                    automatorUseRealChrome
                      ? "bg-rose-500/10 border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300"
                      : "bg-zinc-100 dark:bg-zinc-800 border-border/50 text-muted-foreground"
                  }`}
                  title={automatorUseRealChrome ? "Dùng Chrome thật (profile riêng)" : "Dùng Playwright Chromium"}
                >
                  {automatorUseRealChrome ? "🌐" : "⚙️"}
                </button>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const link = projectGroups[0]?.internalGroupUrl || projectGroups[0]?.customerGroupUrl || automatorDeepLink.trim();
                    if (link) {
                      startAutomation(link);
                    } else {
                      setAutomatorError("Vui lòng nhập deep link Teams hoặc chọn dự án có link nhóm.");
                    }
                  }}
                  disabled={loading || automatorRunning}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-blue-500/10 hover:bg-blue-500/20 border border-blue-200 dark:border-blue-500/30 text-blue-700 dark:text-blue-300 text-[11px] font-semibold transition-all cursor-pointer disabled:opacity-50"
                >
                  {automatorRunning ? (
                    <><Loader2 className="w-3 h-3 animate-spin" /> Đang trích xuất...</>
                  ) : (
                    <><Play className="w-3 h-3" /> Trích xuất</>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => startAutomation("https://teams.microsoft.com", false, true)}
                  disabled={automatorRunning}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-300 text-[11px] font-semibold transition-all cursor-pointer disabled:opacity-50"
                  title="Mở trình duyệt, đăng nhập Teams, sau đó copy deep link"
                >
                  <Users className="w-3 h-3" />
                  Mở Teams & đăng nhập
                </button>
              </div>
            </div>

            {/* Messages list */}
            <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1.5">
              {!loading && messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center p-6">
                  <Users className="w-10 h-10 text-muted-foreground/20 mb-3" />
                  <p className="text-xs font-medium text-muted-foreground/60">Chưa có tin nhắn nào</p>
                  <p className="text-[10px] text-muted-foreground/40 mt-1 max-w-[200px]">
                    Paste deep link Teams vào ô trên và nhấn "Chạy" để tự động trích xuất
                  </p>
                </div>
              )}

              {loading && messages.length === 0 && (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="w-5 h-5 animate-spin text-primary/60" />
                </div>
              )}

              {filteredMessages.length === 0 && searchQuery && (
                <div className="flex flex-col items-center justify-center h-full p-6">
                  <Search className="w-8 h-8 text-muted-foreground/20 mb-2" />
                  <p className="text-xs text-muted-foreground/60">Không tìm thấy tin nhắn phù hợp</p>
                </div>
              )}

              {filteredMessages.slice(-100).reverse().map((msg) => (
                <button
                  key={msg.id}
                  type="button"
                  onClick={() => setViewMessage(viewMessage?.id === msg.id ? null : msg)}
                  className={`w-full text-left p-2.5 rounded-xl border transition-all cursor-pointer ${
                    viewMessage?.id === msg.id
                      ? "bg-primary/5 dark:bg-primary/10 border-primary/30 dark:border-primary/40"
                      : "bg-card/50 dark:bg-zinc-800/50 border-border/30 dark:border-zinc-700/50 hover:bg-card dark:hover:bg-zinc-800 hover:border-primary/30"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-[11px] font-bold text-foreground dark:text-zinc-200 truncate">
                      {msg.sender}
                    </span>
                    <span className="text-[9px] text-muted-foreground/60 dark:text-zinc-500 shrink-0">
                      {formatRelative(msg.timestamp)}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground dark:text-zinc-400 line-clamp-2 leading-relaxed">
                    {msg.content}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium">
                      {msg.groupName}
                    </span>
                  </div>

                  {/* Expanded view */}
                  {viewMessage?.id === msg.id && (
                    <div className="mt-2 pt-2 border-t border-border/30 dark:border-zinc-700/50">
                      <p className="text-[12px] text-foreground dark:text-zinc-200 whitespace-pre-wrap leading-relaxed">
                        {msg.content}
                      </p>
                      <p className="text-[10px] text-muted-foreground/60 mt-1.5">
                        {formatTime(msg.timestamp)} · {msg.sender} · {msg.groupName}
                      </p>
                    </div>
                  )}
                </button>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </div>
        )}

        {/* ─── ANALYSIS TAB ─────────────────────────── */}
        {activeTab === "analysis" && (
          <div className="p-3 space-y-3">
            {!analysis ? (
              <div className="flex flex-col items-center justify-center h-full text-center pt-12">
                <Search className="w-10 h-10 text-muted-foreground/20 mb-3" />
                <p className="text-xs font-medium text-muted-foreground/60">Chưa có phân tích</p>
                <p className="text-[10px] text-muted-foreground/40 mt-1">
                  Nhấn "Phân tích" trong tab Messages để bắt đầu
                </p>
                <button
                  type="button"
                  onClick={runAnalysis}
                  disabled={loading}
                  className="mt-4 px-4 py-2 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5"
                >
                  {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Filter className="w-3 h-3" />}
                  Phân tích ngay
                </button>
              </div>
            ) : (
              <>
                {/* Summary */}
                <div className="p-3 rounded-xl bg-gradient-to-br from-primary/5 to-primary/0 border border-primary/20 dark:border-primary/30">
                  <div className="flex items-start gap-2">
                    <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <CheckCircle className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-foreground dark:text-zinc-100 mb-1">Tổng quan</p>
                      <div className="text-[11px] text-muted-foreground dark:text-zinc-400 leading-relaxed whitespace-pre-wrap">
                        {analysis.summary}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-3 rounded-xl bg-amber-50/80 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-center">
                    <p className="text-lg font-bold text-amber-600 dark:text-amber-400">{analysis.scopeChanges.length}</p>
                    <p className="text-[10px] text-amber-700/70 dark:text-amber-400/70 font-medium">Thay đổi scope</p>
                  </div>
                  <div className="p-3 rounded-xl bg-blue-50/80 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/30 text-center">
                    <p className="text-lg font-bold text-blue-600 dark:text-blue-400">{analysis.actionItems.length}</p>
                    <p className="text-[10px] text-blue-700/70 dark:text-blue-400/70 font-medium">Cần hành động</p>
                  </div>
                  <div className="p-3 rounded-xl bg-red-50/80 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-center">
                    <p className="text-lg font-bold text-red-600 dark:text-red-400">{analysis.keywordAlerts.length}</p>
                    <p className="text-[10px] text-red-700/70 dark:text-red-400/70 font-medium">Cảnh báo</p>
                  </div>
                </div>

                {/* Scope Changes */}
                {analysis.scopeChanges.length > 0 && (
                  <div>
                    <button
                      type="button"
                      onClick={() => setShowScopeDetail(!showScopeDetail)}
                      className="flex items-center justify-between w-full px-3 py-2 rounded-xl bg-card dark:bg-zinc-800/80 border border-border/40 dark:border-zinc-700/60 cursor-pointer hover:bg-card/80 transition-colors"
                    >
                      <span className="text-xs font-bold text-foreground dark:text-zinc-100">
                        Thay đổi scope ({analysis.scopeChanges.length})
                      </span>
                      {showScopeDetail ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                    </button>
                    {showScopeDetail && (
                      <div className="mt-1.5 space-y-1.5 px-1">
                        {analysis.scopeChanges.map((sc) => (
                          <div key={sc.id} className="p-2.5 rounded-xl bg-amber-50/60 dark:bg-amber-500/5 border border-amber-200/60 dark:border-amber-500/20">
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${
                                sc.confidence === "high"
                                  ? "bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300"
                                  : "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300"
                              }`}>
                                {sc.confidence === "high" ? "Cao" : "Trung bình"}
                              </span>
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 font-semibold">
                                {sc.type}
                              </span>
                            </div>
                            <p className="text-[11px] text-muted-foreground dark:text-zinc-400 leading-relaxed">
                              {sc.description}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Action Items */}
                {analysis.actionItems.length > 0 && (
                  <div>
                    <button
                      type="button"
                      onClick={() => setShowActionDetail(!showActionDetail)}
                      className="flex items-center justify-between w-full px-3 py-2 rounded-xl bg-card dark:bg-zinc-800/80 border border-border/40 dark:border-zinc-700/60 cursor-pointer hover:bg-card/80 transition-colors"
                    >
                      <span className="text-xs font-bold text-foreground dark:text-zinc-100">
                        Cần hành động ({analysis.actionItems.length})
                      </span>
                      {showActionDetail ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                    </button>
                    {showActionDetail && (
                      <div className="mt-1.5 space-y-1.5 px-1">
                        {analysis.actionItems.map((ai) => (
                          <div key={ai.id} className="p-2.5 rounded-xl bg-blue-50/60 dark:bg-blue-500/5 border border-blue-200/60 dark:border-blue-500/20">
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${
                                ai.priority === "high"
                                  ? "bg-red-100 dark:bg-red-500/20 text-red-700 dark:text-red-300"
                                  : "bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300"
                              }`}>
                                {ai.priority === "high" ? "Ưu tiên" : "Thường"}
                              </span>
                              {ai.assignee && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 font-semibold">
                                  @{ai.assignee}
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-muted-foreground dark:text-zinc-400 leading-relaxed">
                              {ai.description}
                            </p>
                            {ai.deadline && (
                              <div className="flex items-center gap-1 mt-1">
                                <Clock className="w-3 h-3 text-red-500/70" />
                                <span className="text-[9px] text-red-600 dark:text-red-400 font-medium">Hạn: {ai.deadline}</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Keyword Alerts */}
                {analysis.keywordAlerts.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-bold text-foreground dark:text-zinc-100 px-1">Cảnh báo từ khoá</p>
                    {analysis.keywordAlerts.map((ka) => (
                      <div key={ka.keyword} className="p-2.5 rounded-xl bg-red-50/60 dark:bg-red-500/5 border border-red-200/60 dark:border-red-500/20">
                        <div className="flex items-center gap-1.5 mb-1">
                          <AlertTriangle className="w-3 h-3 text-red-500" />
                          <span className="text-[11px] font-bold text-red-700 dark:text-red-300">"{ka.keyword}"</span>
                          <span className="text-[9px] text-red-500/70">({ka.matchCount} lần)</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground dark:text-zinc-400 leading-relaxed">
                          {ka.suggestedAction}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ─── NHÓM TAB ──────────────────────────────── */}
        {activeTab === "config" && (
          <div className="p-3 space-y-3 pb-20">
            {/* Summary */}
            <div className="p-3 rounded-xl bg-gradient-to-br from-blue-500/5 to-blue-500/0 border border-blue-500/20 dark:border-blue-500/30">
              <div className="flex items-start gap-2">
                <Users className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold text-foreground dark:text-zinc-100 mb-1">
                    Nhóm Teams từ các dự án
                  </p>
                  <p className="text-[10px] text-muted-foreground dark:text-zinc-400 leading-relaxed">
                    Agent tự động tổng hợp link nhóm Teams từ các dự án đang hoạt động.
                    Để thay đổi, vào chi tiết dự án và cập nhật trong mục "Nhóm Teams".
                  </p>
                </div>
              </div>
            </div>

            {/* Project Groups List */}
            <div className="space-y-1.5">
              {projectGroups.length === 0 && (
                <div className="flex flex-col items-center justify-center text-center py-8">
                  <Users className="w-8 h-8 text-muted-foreground/20 mb-2" />
                  <p className="text-xs text-muted-foreground/60">Chưa có dự án nào có link nhóm Teams</p>
                  <p className="text-[10px] text-muted-foreground/40 mt-1">Vào chi tiết dự án để thêm link nhóm</p>
                </div>
              )}

              {projectGroups.map((pg) => (
                <div
                  key={pg.projectId}
                  className="p-2.5 rounded-xl bg-card/50 dark:bg-zinc-800/50 border border-border/30 dark:border-zinc-700/50"
                >
                  <p className="text-xs font-bold text-foreground dark:text-zinc-100 mb-2 truncate">
                    {pg.projectName}
                  </p>
                  <div className="space-y-1.5">
                    {pg.internalGroupUrl && (
                      <div className="flex items-center gap-2">
                        <span className="text-[8px] px-1.5 py-0.5 rounded-full font-semibold bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 shrink-0">
                          Nội bộ
                        </span>
                        <a
                          href={pg.internalGroupUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline truncate"
                        >
                          {pg.internalGroupUrl}
                        </a>
                      </div>
                    )}
                    {pg.customerGroupUrl && (
                      <div className="flex items-center gap-2">
                        <span className="text-[8px] px-1.5 py-0.5 rounded-full font-semibold bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 shrink-0">
                          KH
                        </span>
                        <a
                          href={pg.customerGroupUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-purple-600 dark:text-purple-400 hover:underline truncate"
                        >
                          {pg.customerGroupUrl}
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* How to use */}
            <div className="p-3 rounded-xl bg-blue-50/60 dark:bg-blue-500/5 border border-blue-200/60 dark:border-blue-500/20">
              <p className="text-xs font-bold text-blue-700 dark:text-blue-300 mb-2">Cách sử dụng Automator</p>
              <ol className="space-y-1.5 text-[10px] text-blue-700/70 dark:text-blue-300/70 list-decimal list-inside">
                <li>Copy deep link từ trình duyệt Teams (URL channel/chat)</li>
                <li>Dán vào ô input trong tab Messages, nhấn "Chạy"</li>
                <li>Playwright sẽ tự động mở trình duyệt, đăng nhập (lần đầu), trích xuất tin nhắn</li>
                <li>Kết quả tự động lưu vào <code>teams-messages.json</code></li>
                <li>Nhấn "Phân tích" để phát hiện scope change, action items, cảnh báo từ khoá</li>
                <li>Thay đổi link nhóm Teams tại trang chi tiết từng dự án</li>
              </ol>
              <p className="text-[10px] text-blue-600/60 dark:text-blue-400/60 mt-2">
                Mẹo: 🤖 headless = chạy ngầm, 🖥️ = hiện browser, 🔓 = giữ browser mở, 🌐 = dùng Chrome thật (nhớ session dài hơn).
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
