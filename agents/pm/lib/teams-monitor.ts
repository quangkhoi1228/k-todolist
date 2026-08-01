/**
 * Teams Monitor Module
 *
 * Core module for monitoring Teams groups:
 * - Manage monitored groups configuration
 * - Analyse messages for scope changes, action items, keywords
 * - Generate summaries and actionable insights
 */

import type { TeamsMessage, AgentSuggestion } from "./types";

// ─── Types ──────────────────────────────────────────────────

export interface MonitoredGroup {
  id: string;
  name: string;
  deepLink: string;
  type: "internal" | "external";
  lastExtractedAt: number | null;
  autoMonitor: boolean;
  keywords: string[];          // keywords to watch for
  notifyOnKeyword: boolean;
}

export interface MonitorConfig {
  groups: MonitoredGroup[];
  autoMonitorIntervalMs: number;  // default 30 min
}

export interface TeamsAnalysis {
  scopeChanges: ScopeChange[];
  actionItems: ActionItem[];
  keywordAlerts: KeywordAlert[];
  summary: string;
}

export interface ScopeChange {
  id: string;
  type: "infra" | "security" | "network" | "other";
  description: string;
  confidence: "high" | "medium" | "low";
  sourceMessageId: string;
  sourceContent: string;
  suggestedAction: string;
}

export interface ActionItem {
  id: string;
  description: string;
  assignee: string | null;
  deadline: string | null;
  priority: "high" | "normal" | "low";
  sourceMessageId: string;
}

export interface KeywordAlert {
  keyword: string;
  matchCount: number;
  messages: Array<{ id: string; sender: string; content: string; timestamp: number }>;
  suggestedAction: string;
}

// ─── Default Monitor Config ─────────────────────────────────

export const DEFAULT_MONITOR_CONFIG: MonitorConfig = {
  groups: [],
  autoMonitorIntervalMs: 30 * 60 * 1000, // 30 min
};

const MONITOR_CONFIG_FILE = "teams-monitor-config.json";

// ─── Config Persistence (server-side) ──────────────────────

export function loadMonitorConfig(): MonitorConfig {
  try {
    const fs = require("fs");
    const path = require("path");
    const filePath = path.join(process.cwd(), MONITOR_CONFIG_FILE);
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(raw);
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_MONITOR_CONFIG, groups: [] };
}

export function saveMonitorConfig(config: MonitorConfig): void {
  try {
    const fs = require("fs");
    const path = require("path");
    const filePath = path.join(process.cwd(), MONITOR_CONFIG_FILE);
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), "utf-8");
  } catch (e) {
    console.error("[TeamsMonitor] Failed to save config:", e);
  }
}

export function addMonitoredGroup(group: MonitoredGroup): MonitorConfig {
  const config = loadMonitorConfig();
  const existing = config.groups.find((g) => g.deepLink === group.deepLink);
  if (existing) {
    Object.assign(existing, group);
  } else {
    config.groups.push(group);
  }
  saveMonitorConfig(config);
  return config;
}

export function removeMonitoredGroup(groupId: string): MonitorConfig {
  const config = loadMonitorConfig();
  config.groups = config.groups.filter((g) => g.id !== groupId);
  saveMonitorConfig(config);
  return config;
}

// ─── Message Analysis ──────────────────────────────────────

const SCOPE_KEYWORDS: Record<string, Array<{ pattern: RegExp; type: ScopeChange["type"]; confidence: ScopeChange["confidence"]; action: string }>> = {
  infra: [
    { pattern: /\b(?:firewall|firewall)\b/i, type: "infra", confidence: "high", action: "Bổ sung Infras vào scope triển khai" },
    { pattern: /\b(?:infra|hạ tầng|cơ sở hạ tầng|server|vm|virtual machine)\b/i, type: "infra", confidence: "medium", action: "Xem xét yêu cầu hạ tầng" },
    { pattern: /\b(?:router|switch|load.?balancer|lb)\b/i, type: "infra", confidence: "medium", action: "Xem xét yêu cầu hạ tầng mạng" },
  ],
  security: [
    { pattern: /\b(?:security|bảo mật|firewall|waf|ips|ids)\b/i, type: "security", confidence: "high", action: "Bổ sung Security vào scope triển khai" },
    { pattern: /\b(?:pentest|vulnerability|patch|ssl|tls)\b/i, type: "security", confidence: "medium", action: "Xem xét yêu cầu bảo mật" },
  ],
  network: [
    { pattern: /\b(?:network|mạng|peering|vpn|connectivity|kết nối)\b/i, type: "network", confidence: "medium", action: "Xem xét yêu cầu kết nối mạng" },
    { pattern: /\b(?:bandwidth|băng thông|latency|delay)\b/i, type: "network", confidence: "medium", action: "Xem xét yêu cầu băng thông" },
  ],
  other: [
    { pattern: /\b(?:migration|di chuyển|chuyển đổi)\b/i, type: "other", confidence: "medium", action: "Xem xét yêu cầu migration" },
    { pattern: /\b(?:backup|sao lưu|dự phòng|DR)\b/i, type: "other", confidence: "medium", action: "Xem xét yêu cầu backup/DR" },
    { pattern: /\b(?:monitor|monitoring|giám sát|alert|cảnh báo)\b/i, type: "other", confidence: "medium", action: "Xem xét yêu cầu monitoring" },
  ],
};

export function analyseMessages(
  messages: TeamsMessage[],
  config?: MonitorConfig
): TeamsAnalysis {
  const scopeChanges: ScopeChange[] = [];
  const actionItems: ActionItem[] = [];
  const keywordAlerts: KeywordAlert[] = [];
  const keywordMap = new Map<string, Array<{ id: string; sender: string; content: string; timestamp: number }>>();

  let changeCounter = 0;
  let actionCounter = 0;

  for (const msg of messages) {
    const content = msg.content;

    // ── Scope change detection ──────────────────────
    for (const [, patterns] of Object.entries(SCOPE_KEYWORDS)) {
      for (const p of patterns) {
        if (p.pattern.test(content)) {
          const existing = scopeChanges.find(
            (s) => s.type === p.type && s.confidence === p.confidence
          );
          if (!existing) {
            changeCounter++;
            scopeChanges.push({
              id: `scope_${changeCounter}`,
              type: p.type,
              description: `Phát hiện nội dung liên quan đến ${p.type}: "${content.slice(0, 100)}"`,
              confidence: p.confidence,
              sourceMessageId: msg.id,
              sourceContent: content,
              suggestedAction: p.action,
            });
          }
          break; // one match per category per message
        }
      }
    }

    // ── Action item detection ───────────────────────
    const deadlineMatch = content.match(/(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)/);
    const hasAssignee = content.match(/@(\w+)|(?:anh|chị|bạn)\s+(\w+)/i);
    const hasDeadlineWord = /\b(?:deadline|due|hạn|chốt|ngày\s+\d+)\b/i.test(content);

    if (hasDeadlineWord || deadlineMatch) {
      actionCounter++;
      actionItems.push({
        id: `action_${actionCounter}`,
        description: content.length > 150 ? content.slice(0, 150) + "..." : content,
        assignee: hasAssignee ? hasAssignee[1] || hasAssignee[2] || null : null,
        deadline: deadlineMatch ? deadlineMatch[1] : null,
        priority: /\b(?:urgent|gấp|khẩn|important|quan trọng)\b/i.test(content) ? "high" : "normal",
        sourceMessageId: msg.id,
      });
    }

    // ── Keyword monitoring ──────────────────────────
    if (config) {
      for (const group of config.groups) {
        if (group.keywords.length > 0 && group.notifyOnKeyword) {
          for (const kw of group.keywords) {
            const kwLower = kw.toLowerCase();
            if (content.toLowerCase().includes(kwLower)) {
              if (!keywordMap.has(kw)) keywordMap.set(kw, []);
              keywordMap.get(kw)!.push({
                id: msg.id,
                sender: msg.sender,
                content,
                timestamp: msg.timestamp,
              });
            }
          }
        }
      }
    }
  }

  // Build keyword alerts
  for (const [kw, msgs] of keywordMap.entries()) {
    keywordAlerts.push({
      keyword: kw,
      matchCount: msgs.length,
      messages: msgs.slice(0, 10),
      suggestedAction: `Từ khoá "${kw}" xuất hiện ${msgs.length} lần trong Teams. Kiểm tra nội dung để có hành động phù hợp.`,
    });
  }

  // Generate summary
  const summary = generateSummary(scopeChanges, actionItems, keywordAlerts, messages.length);

  return { scopeChanges, actionItems, keywordAlerts, summary };
}

function generateSummary(
  scopeChanges: ScopeChange[],
  actionItems: ActionItem[],
  keywordAlerts: KeywordAlert[],
  totalMessages: number
): string {
  const parts: string[] = [];

  parts.push(`Tổng số tin nhắn Teams: **${totalMessages}**.`);

  if (scopeChanges.length > 0) {
    const byType = new Map<string, number>();
    for (const sc of scopeChanges) {
      byType.set(sc.type, (byType.get(sc.type) || 0) + 1);
    }
    const typeStr = Array.from(byType.entries())
      .map(([t, c]) => `- ${t}: ${c}`)
      .join("\n");
    parts.push(`Phát hiện thay đổi scope:${typeStr}`);
  } else {
    parts.push("Chưa phát hiện thay đổi scope nào.");
  }

  if (actionItems.length > 0) {
    parts.push(`Phát hiện **${actionItems.length}** mục cần hành động.`);
  }

  if (keywordAlerts.length > 0) {
    parts.push(`**${keywordAlerts.length}** cảnh báo từ khoá đang theo dõi.`);
  }

  return parts.join("\n\n");
}

// ─── Extract channel name from deep link ────────────────────

export function extractChannelName(deepLink: string): string {
  // Pattern: /l/channel/<encoded-name>/...
  const channelMatch = deepLink.match(/\/channel\/([^/?]+)/);
  if (channelMatch) {
    try {
      return decodeURIComponent(channelMatch[1].replace(/%2F/g, "/").replace(/%20/g, " "));
    } catch {
      return channelMatch[1];
    }
  }

  // Pattern: /_#/conversations/<name>
  const convMatch = deepLink.match(/\/conversations\/([^?]+)/);
  if (convMatch) {
    try {
      return decodeURIComponent(convMatch[1]);
    } catch {
      return convMatch[1];
    }
  }

  return "Teams Group";
}

// ─── Generate suggestions from analysis ─────────────────────

export function analysisToSuggestions(analysis: TeamsAnalysis): AgentSuggestion[] {
  const suggestions: AgentSuggestion[] = [];

  for (const sc of analysis.scopeChanges) {
    suggestions.push({
      id: `teams_scope_${sc.id}`,
      type: sc.confidence === "high" ? "warning" : "info",
      title: `Thay đổi scope: ${sc.type}`,
      description: sc.description,
      actionLabel: sc.suggestedAction,
      actionPayload: { type: "scope_change", scopeType: sc.type },
      source: "teams_monitor",
    });
  }

  for (const ai of analysis.actionItems) {
    suggestions.push({
      id: `teams_action_${ai.id}`,
      type: ai.priority === "high" ? "warning" : "info",
      title: `Cần hành động${ai.assignee ? ` (${ai.assignee})` : ""}`,
      description: ai.description,
      actionLabel: ai.deadline ? `Hạn: ${ai.deadline}` : "Xem chi tiết",
      source: "teams_monitor",
    });
  }

  for (const ka of analysis.keywordAlerts) {
    suggestions.push({
      id: `teams_kw_${ka.keyword.replace(/\s+/g, "_")}`,
      type: "warning",
      title: `Từ khoá "${ka.keyword}" xuất hiện ${ka.matchCount} lần`,
      description: `Phát hiện từ khoá "${ka.keyword}" trong Teams. ${ka.suggestedAction}`,
      actionLabel: "Kiểm tra",
      source: "teams_monitor",
    });
  }

  return suggestions;
}

// ─── Extract messages from teams-messages.json ──────────────

export function loadTeamsMessagesFile(): TeamsMessage[] {
  try {
    const fs = require("fs");
    const path = require("path");
    const filePath = path.join(process.cwd(), "teams-messages.json");
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      const data = JSON.parse(raw);
      return (data.messages || []).map((m: Record<string, unknown>, i: number) => ({
        id: `teams_extracted_${i}`,
        groupId: String(m.groupId || m.groupName || "extracted"),
        groupName: String(m.groupName || m.channel || "Teams"),
        sender: String(m.sender || "Unknown"),
        content: String(m.content || ""),
        timestamp: typeof m.timestamp === "number" ? m.timestamp : Date.parse(String(m.timestamp)) || Date.now(),
      }));
    }
  } catch { /* ignore */ }
  return [];
}

// ─── Merge external messages into TeamsMessage format ───────

export function normalizeMessages(raw: Array<Record<string, unknown>>): TeamsMessage[] {
  return raw.map((m, i) => ({
    id: `normalized_${i}`,
    groupId: String(m.groupId || m.groupName || "unknown"),
    groupName: String(m.groupName || m.channel || "Teams"),
    sender: String(m.sender || "Unknown"),
    content: String(m.content || ""),
    timestamp: typeof m.timestamp === "number" ? m.timestamp : Date.parse(String(m.timestamp)) || Date.now(),
  }));
}
