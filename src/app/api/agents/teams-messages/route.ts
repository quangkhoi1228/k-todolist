/**
 * Teams Monitor API
 *
 * GET  /api/agents/teams-messages        — lấy danh sách messages
 * POST /api/agents/teams-messages         — gửi config, trigger analysis, v.v.
 *
 * POST body (action):
 *   { action: "get_config" }                         — lấy cấu hình monitor
 *   { action: "update_config", config }              — lưu cấu hình monitor
 *   { action: "add_group", group }                   — thêm nhóm theo dõi
 *   { action: "remove_group", groupId }              — xoá nhóm theo dõi
 *   { action: "analyse" }                            — phân tích messages hiện có
 *   { action: "inject_messages", messages }          — inject messages từ nguồn ngoài
 *   { action: "export_to_pm" }                       — xuất messages sang PM Agent format
 */

import { NextResponse, type NextRequest } from "next/server";
import fs from "fs";
import path from "path";

import {
  loadMonitorConfig,
  saveMonitorConfig,
  addMonitoredGroup,
  removeMonitoredGroup,
  analyseMessages,
  loadTeamsMessagesFile,
  normalizeMessages,
  analysisToSuggestions,
} from "../../../../../agents/pm/lib/teams-monitor";
import type { MonitoredGroup } from "../../../../../agents/pm/lib/teams-monitor";

const OUTPUT_FILE = path.join(process.cwd(), "teams-messages.json");

// ─── GET: load messages ───────────────────────────────────
export async function GET() {
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      const raw = fs.readFileSync(OUTPUT_FILE, "utf-8");
      const data = JSON.parse(raw);
      return NextResponse.json(data);
    } catch {
      return NextResponse.json({ messages: [], totalMessages: 0, groups: [] });
    }
  }

  return NextResponse.json({
    channel: "Mock",
    extractedAt: new Date().toISOString(),
    totalMessages: 0,
    messages: [],
    groups: [],
  });
}

// ─── POST: actions ────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    switch (action) {

      // ── Config: get current ────────────────────────
      case "get_config": {
        const config = loadMonitorConfig();
        return NextResponse.json({ ok: true, config });
      }

      // ── Config: update full ────────────────────────
      case "update_config": {
        const { config } = body;
        if (!config) {
          return NextResponse.json({ ok: false, error: "Missing config" }, { status: 400 });
        }
        saveMonitorConfig(config);
        return NextResponse.json({ ok: true, config: loadMonitorConfig() });
      }

      // ── Config: add group ──────────────────────────
      case "add_group": {
        const group = body.group as MonitoredGroup;
        if (!group || !group.deepLink) {
          return NextResponse.json({ ok: false, error: "Missing group info" }, { status: 400 });
        }
        const updated = addMonitoredGroup({
          ...group,
          id: group.id || `group_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          lastExtractedAt: null,
          autoMonitor: group.autoMonitor ?? false,
          keywords: group.keywords ?? [],
          notifyOnKeyword: group.notifyOnKeyword ?? true,
        });
        return NextResponse.json({ ok: true, config: updated });
      }

      // ── Config: remove group ───────────────────────
      case "remove_group": {
        const { groupId } = body;
        if (!groupId) {
          return NextResponse.json({ ok: false, error: "Missing groupId" }, { status: 400 });
        }
        const updated = removeMonitoredGroup(groupId);
        return NextResponse.json({ ok: true, config: updated });
      }

      // ── Analyse current messages ──────────────────
      case "analyse": {
        const messages = loadTeamsMessagesFile();
        const config = loadMonitorConfig();
        const analysis = analyseMessages(messages, config);
        const suggestions = analysisToSuggestions(analysis);
        return NextResponse.json({
          ok: true,
          analysis,
          suggestions,
          messageCount: messages.length,
          monitoredGroups: config.groups,
        });
      }

      // ── Inject external messages ──────────────────
      case "inject_messages": {
        const { messages } = body;
        if (!Array.isArray(messages)) {
          return NextResponse.json({ ok: false, error: "Missing messages array" }, { status: 400 });
        }
        const normalized = normalizeMessages(messages);

        // Load existing
        let existing: Array<Record<string, unknown>> = [];
        if (fs.existsSync(OUTPUT_FILE)) {
          try {
            const raw = fs.readFileSync(OUTPUT_FILE, "utf-8");
            const data = JSON.parse(raw);
            existing = data.messages || [];
          } catch { /* ignore */ }
        }

        // Merge (dedup by sender+content+timestamp)
        const existingKeys = new Set(
          existing.map((m: Record<string, unknown>) => `${m.sender}|${m.content}|${m.timestamp}`)
        );
        const newMsgs = normalized.filter(
          (m) => !existingKeys.has(`${m.sender}|${m.content}|${m.timestamp}`)
        );

        const merged = [...existing, ...newMsgs];
        const output = {
          channel: "Merged",
          extractedAt: new Date().toISOString(),
          totalMessages: merged.length,
          messages: merged,
          groups: [],
        };
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), "utf-8");

        return NextResponse.json({
          ok: true,
          added: newMsgs.length,
          total: merged.length,
          messages: merged.slice(-50),
        });
      }

      // ── Export to PM Agent format ─────────────────
      case "export_to_pm": {
        const messages = loadTeamsMessagesFile();
        return NextResponse.json({
          ok: true,
          exportedAt: new Date().toISOString(),
          messages: messages.slice(-100),
          total: messages.length,
        });
      }

      default:
        return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (err) {
    console.error("[TeamsMonitor API] Error:", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
