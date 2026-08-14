/**
 * Backfill checklist cho các message thông báo gợi ý CŨ của một project.
 *
 * Khi logic checklist mới được thêm, các message gợi ý được tạo TRƯỚC đó
 * chưa có trường `checklist` trong metadata (suggestion_notification).
 * Script này:
 *  1. Tìm tất cả message agent có metadata action="suggestion_notification"
 *     thuộc session của project.
 *  2. Với mỗi suggestion trong metadata, nếu chưa có checklist → tìm quy trình
 *     nghiệp vụ khớp (theo từ khoá) và gắn checklist từ steps.
 *  3. Cập nhật lại metadata + nội dung text (thêm dòng ☐).
 *  4. Cập nhật projectSuggestions (panel Gợi ý) — thêm checklist vào suggestionData.
 *
 * Chạy:
 *   PROJECT_ID=49 npx tsx scripts/backfill-suggestion-checklists.ts
 */
import dotenv from "dotenv";
import * as path from "path";
import { getDb } from "../src/lib/db";
import { pmAgentMessages, pmAgentSessions, businessProcesses, projectSuggestions } from "../src/lib/db";
import { eq } from "drizzle-orm";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const projectId = Number(process.env.PROJECT_ID || "49");
const force = process.env.FORCE === "1";

/** Tìm quy trình khớp theo từ khoá (đơn giản, không cần LLM). */
function findMatchingProcess(processes: any[], suggestion: any): any | null {
  const text = `${suggestion.title || ""} ${suggestion.description || ""}`.toLowerCase();
  // Ưu tiên quy trình gia hạn license
  const license = processes.find(
    (p) => /gia\s*hạn\s+license|firewall|palo\s*alto|fortinet/i.test(p.name || "")
  );
  if (license && /gia\s*hạn\s+license|firewall|palo\s*alto|fortinet|hết\s*hạn|renewal/i.test(text)) {
    return license;
  }
  // Match theo triggers
  for (const p of processes) {
    const triggers = Array.isArray(p.triggers) ? p.triggers : [];
    for (const t of triggers) {
      if (t && text.includes(String(t).toLowerCase())) return p;
    }
  }
  return null;
}

/** Build checklist từ steps của quy trình. */
function buildChecklist(process: any): Array<{ title: string; description?: string; targetGroup?: string; messageContent?: string }> {
  const steps = Array.isArray(process?.steps) ? process.steps : [];
  return steps
    .filter((s: any) => s && s.title)
    .map((s: any) => ({
      title: s.title,
      description: s.description || undefined,
      targetGroup: s.targetGroup || undefined,
      messageContent: s.messageContent || undefined,
    }));
}

/** Append/thay thế dòng ☐ checklist vào nội dung text message. */
function appendChecklistToContent(content: string, checklist: Array<{ title: string; targetGroup?: string; messageContent?: string }>): string {
  if (!content || checklist.length === 0) return content;
  // Xoá block checklist cũ (nếu có) trước khi thêm mới
  const idx = content.indexOf("📋 **Checklist:**");
  if (idx >= 0) content = content.slice(0, idx).replace(/\n+$/, "\n");
  const block = "\n\n📋 **Checklist:**\n" + checklist.map((c) => {
    const grp = c.targetGroup ? ` → **${c.targetGroup}**` : "";
    return `  - ☐ ${c.title}${grp}`;
  }).join("\n");
  return content + block;
}

async function main() {
  const db = getDb();

  // 1. Session của project
  const sessions = await db.select().from(pmAgentSessions).where(eq(pmAgentSessions.projectId, projectId));
  if (sessions.length === 0) {
    console.log(`[Backfill] Không tìm thấy session cho project ${projectId}.`);
    return;
  }
  const sessionIds = sessions.map((s) => s.id);
  console.log(`[Backfill] Project ${projectId}: ${sessions.length} session(s).`);

  // 2. Business processes của user (lấy từ session đầu tiên)
  const userId = sessions[0].userId;
  const processes = await db.select().from(businessProcesses).where(eq(businessProcesses.userId, userId));
  console.log(`[Backfill] User ${userId} có ${processes.length} quy trình nghiệp vụ.`);

  // 3. Tất cả message suggestion_notification của các session này
  const allMessages: any[] = [];
  for (const sid of sessionIds) {
    const msgs = await db.select().from(pmAgentMessages).where(eq(pmAgentMessages.sessionId, sid));
    allMessages.push(...msgs);
  }
  allMessages.sort((a, b) => a.createdAt - b.createdAt);

  const notifMessages = allMessages.filter((m) => {
    if (!m.metadata) return false;
    try {
      const meta = JSON.parse(m.metadata);
      return meta?.action === "suggestion_notification";
    } catch {
      return false;
    }
  });
  console.log(`[Backfill] Tìm thấy ${notifMessages.length} message thông báo gợi ý.`);

  let updatedMsg = 0;

  for (const msg of notifMessages) {
    let meta: any;
    try {
      meta = JSON.parse(msg.metadata);
    } catch {
      continue;
    }
    const suggestions = Array.isArray(meta.suggestions) ? meta.suggestions : [];
    let changed = false;

    const newSuggestions = suggestions.map((s: any) => {
      // FORCE=1: ghi đè checklist cũ (dùng khi quy trình đã được cập nhật steps mới)
      if (!force && Array.isArray(s.checklist) && s.checklist.length > 0) return s;
      const proc = findMatchingProcess(processes, s);
      if (!proc) return s;
      const checklist = buildChecklist(proc);
      if (checklist.length === 0) return s;
      changed = true;
      return { ...s, checklist };
    });

    // Cập nhật nội dung text nếu có checklist mới
    let newContent = msg.content;
    if (changed && newSuggestions.some((s: any) => Array.isArray(s.checklist) && s.checklist.length > 0)) {
      const firstWithChecklist = newSuggestions.find((s: any) => Array.isArray(s.checklist) && s.checklist.length > 0);
      newContent = appendChecklistToContent(msg.content, firstWithChecklist.checklist);
    }

    if (!changed && newContent === msg.content) continue;

    meta.suggestions = newSuggestions;
    await db
      .update(pmAgentMessages)
      .set({ metadata: JSON.stringify(meta), content: newContent })
      .where(eq(pmAgentMessages.id, msg.id));
    updatedMsg++;
    const withCl = newSuggestions.filter((s: any) => Array.isArray(s.checklist) && s.checklist.length > 0).length;
    console.log(`  - Message #${msg.id}: gắn checklist cho ${withCl} gợi ý.`);
  }

  // 4. Cập nhật projectSuggestions (panel Gợi ý) — thêm checklist vào suggestionData
  const suggestionsRows = await db.select().from(projectSuggestions).where(eq(projectSuggestions.projectId, projectId));
  let updatedSugg = 0;
  for (const row of suggestionsRows) {
    let data: any = {};
    try {
      data = row.suggestionData ? JSON.parse(row.suggestionData) : {};
    } catch {}
    if (!force && Array.isArray(data.checklist) && data.checklist.length > 0) continue;
    const proc = findMatchingProcess(processes, row);
    if (!proc) continue;
    const checklist = buildChecklist(proc);
    if (checklist.length === 0) continue;
    data.checklist = checklist;
    await db
      .update(projectSuggestions)
      .set({ suggestionData: JSON.stringify(data) })
      .where(eq(projectSuggestions.id, row.id));
    updatedSugg++;
    console.log(`  - Suggestion #${row.id} ("${row.title}"): gắn checklist.`);
  }

  console.log(`\n[Backfill] Xong.`);
  console.log(`  - Message cập nhật: ${updatedMsg}`);
  console.log(`  - projectSuggestions cập nhật: ${updatedSugg}`);
}

main().catch((e) => {
  console.error("[Backfill] Lỗi:", e);
  process.exit(1);
});