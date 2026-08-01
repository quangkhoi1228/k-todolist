import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import { createStealthContext, waitForLogin, navigateToTeams, applyStealthPatches, incrementalScrollAndExtract, DEFAULT_CONFIG } from "../lib/teams-automator";
import { createZaloStealthContext, waitForZaloLogin, navigateToZalo, navigateToZaloGroup, applyStealthPatches as applyZaloStealthPatches, scrollZaloChatContainer, extractZaloMessages, DEFAULT_ZALO_CONFIG } from "../lib/zalo-automator";
import * as path from "path";
import * as fs from "fs";
import dotenv from "dotenv";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) {
  console.error("Missing NEXT_PUBLIC_CONVEX_URL");
  process.exit(1);
}

const userId = process.env.USER_ID;
if (!userId) {
  console.error("Missing USER_ID env variable");
  process.exit(1);
}

const client = new ConvexHttpClient(convexUrl);

// ─── Progress file ──────────────────────────────────────────
const PROGRESS_FILE = path.join(process.cwd(), ".teams-sync-progress.json");
const RUNNING_FILE = path.join(process.cwd(), ".teams-sync-running");

function writeProgress(data: { total: number; done: number; currentChat?: string; platform?: string; type?: string; message?: string }) {
  try {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ ...data, updatedAt: Date.now() }), "utf-8");
  } catch { /* ignore */ }
}

function clearProgress() {
  try { if (fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE); } catch { /* ignore */ }
}

/**
 * Upload large data: URLs to Convex storage and return storage: references.
 * Small data URLs (< 100KB base64) are kept as-is to avoid unnecessary storage ops.
 */
async function processDataUrls(messages: any[]): Promise<any[]> {
  const processed = messages.map(m => ({ ...m }));
  let uploadedCount = 0;

  for (const msg of processed) {
    if (!msg.images?.length) continue;

    const processedImages: string[] = [];
    for (const img of msg.images) {
      // Skip invalid entries (null/objects from failed blob→base64 conversions)
      if (typeof img !== 'string' || !img.length) continue;
      if (img.startsWith('data:') && img.length > 100_000) {
        // Upload large data URLs to Convex storage
        try {
          const storageId = await client.action(api.projectChats.uploadChatImage, { dataUrl: img });
          if (storageId) {
            processedImages.push(`storage:${storageId}`);
            uploadedCount++;
            continue;
          }
        } catch (e) {
          console.warn(`[Sync] Failed to upload data URL (${(img.length / 1024).toFixed(0)}KB), keeping as data:`, e);
        }
      }
      processedImages.push(img);
    }
    msg.images = processedImages;
  }

  if (uploadedCount > 0) {
    console.log(`[Sync] Uploaded ${uploadedCount} large images to Convex storage.`);
  }

  return processed;
}

/**
 * After saving messages, analyse if any messages need PM attention
 * by calling LLM directly. Creates suggestions in projectSuggestions table.
 */
async function runMonitor(savedMessages: any[], projectId: string, chatName: string) {
  if (!savedMessages || savedMessages.length === 0) return;

  const apiKey = process.env.OPENAI_API_KEY;
  const apiBase = process.env.OPENAI_BASE_URL;
  const model = process.env.LLM_MODEL || "deepsseek-v4_mimo_combo";

  if (!apiKey || !apiBase) return;

  try {
    console.log(`[Monitor] Analysing ${savedMessages.length} new messages for PM action...`);

    const messageLog = savedMessages
      .slice(-30)
      .map((m: any) => `[${m.sender || "Unknown"}]: ${(m.content || "").slice(0, 500)}`)
      .join("\n");

    const systemPrompt = `Bạn là PM Agent - trợ lý quản lý dự án thông minh.

Phân tích tin nhắn từ nhóm chat dự án và xác định:
1. Có cần PM tham gia giải quyết vấn đề gì không?
2. Nếu có, cần hành động gì?

Các hành động thường dùng:
- "Gọi kỹ thuật" — khi có issue kỹ thuật, lỗi, cần support
- "Lên template nghiệm thu khi golive" — khi gần golive, khách hàng yêu cầu bàn giao
- "Xác nhận với khách hàng" — khi cần khách hàng xác nhận/approve
- "Họp với team" — khi cần align giữa các bên
- "Tạo task" — khi có đầu việc mới được giao
- "Cập nhật tiến độ" — khi khách hàng hỏi tiến độ
- "Theo dõi" — cần PM để mắt nhưng chưa cần hành động gấp

QUAN TRỌNG: Chỉ đề xuất hành động KHI THỰC SỰ CẦN THIẾT. Nếu tin nhắn là trao đổi thông thường, trả về [].

Output là JSON array, không markdown, không code block:
[{"type":"action_item","title":"...","description":"...","sourceSender":"...","sourceMessage":"...","actionLabel":"..."}]`;

    const response = await fetch(`${apiBase}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Phân tích tin nhắn:\n\n${messageLog}` },
        ],
        temperature: 0.1,
        max_tokens: 8192,
      }),
      signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) {
      console.warn(`[Monitor] LLM error: ${response.status}`);
      return;
    }

    const rawText = await response.text();
    // Strip SSE trailers that some proxies append (e.g. "data: [DONE]")
    let content = rawText.replace(/data:\s*\[DONE\]\s*$/i, "").trim();

    try {
      const parsed = JSON.parse(content);
      const msg = parsed.choices?.[0]?.message;
      if (msg?.content && msg.content.trim().length > 0) {
        content = msg.content;
      } else if (msg?.reasoning_content) {
        // DeepSeek reasoning models put the final answer at the END of
        // reasoning_content. Take the LAST [...] block (the final answer),
        // not the first (which is usually a description of the task).
        content = msg.reasoning_content;
      }
    } catch {}

    content = content.trim();

    let actions: any[] = [];
    try {
      actions = JSON.parse(content);
      if (!Array.isArray(actions)) throw new Error("not array");
    } catch {
      // Fallback: for reasoning content, prefer the LAST [...] block (final answer)
      const matches = content.match(/\[[\s\S]*?\]/g) || [];
      // Keep only blocks that look like JSON arrays of objects
      const candidates = matches.filter(m => {
        try {
          const arr = JSON.parse(m);
          return Array.isArray(arr) && arr.every((x: any) => x && typeof x === "object");
        } catch { return false; }
      });
      const best = candidates.length > 0 ? candidates[candidates.length - 1] : null;
      if (best) {
        try {
          actions = JSON.parse(best);
        } catch (e) {
          console.log(`[Monitor] Could not parse JSON from LLM response`);
          return;
        }
      }
    }

    // Keep only actions with a meaningful title (LLM sometimes returns
    // placeholder objects like {actionLabel: ""} for "no action needed")
    actions = actions.filter((a: any) => a && typeof a.title === "string" && a.title.trim().length > 0);

    if (!Array.isArray(actions) || actions.length === 0) {
      console.log(`[Monitor] No PM action needed`);
      return;
    }

    console.log(`[Monitor] Found ${actions.length} action(s) needing PM:`);
    actions.forEach((a: any) => console.log(`  - ${a.title}: ${a.actionLabel}`));

    await client.mutation(api.projectSuggestions.addSuggestionsBatch, {
      projectId: projectId as any,
      userId: userId!,
      suggestions: actions.map((a: any) => ({
        type: a.type || "action_item",
        title: a.title || "Cần PM xử lý",
        description: a.description || "",
        sourceSender: a.sourceSender,
        sourceChatName: a.sourceChatName || chatName,
        sourceMessage: a.sourceMessage,
        actionLabel: a.actionLabel,
      })),
    });

    console.log(`[Monitor] Saved ${actions.length} suggestion(s) to Convex.`);
  } catch (err) {
    console.warn(`[Monitor] Error:`, err);
  }
}

async function log(projectId: string | undefined, chatName: string | undefined, type: string, message: string, details?: string) {
  try {
    await client.mutation(api.syncLogs.addLog, {
      projectId: projectId as any,
      chatName,
      type,
      message,
      details,
    });
  } catch (e) {
    console.error("[SyncLog] Failed to write log:", e);
  }
}

async function main() {
  const syncStartTime = Date.now();
  console.log(`[Sync] Fetching projects for user: ${userId}`);
  await log(undefined, undefined, "sync_start", `Bắt đầu đồng bộ toàn bộ chat cho user ${userId}`);

  const projects = await client.query(api.projects.getActiveProjectsWithTeamsGroups, { userId: userId as string });
  
  if (projects.length === 0) {
    console.log("[Sync] No active projects with Teams/Zalo groups found.");
    await log(undefined, undefined, "sync_end", "Không có dự án nào cần đồng bộ", JSON.stringify({ duration: Date.now() - syncStartTime }));
    return;
  }

  console.log(`[Sync] Found ${projects.length} projects to sync.`);
  await log(undefined, undefined, "sync_progress", `Tìm thấy ${projects.length} dự án cần đồng bộ`);

  // ─── Separate groups by platform ─────────────────────────
  interface GroupTask {
    projectId: string;
    chatName: string;
    platform: "teams" | "zalo";
    type: string;
  }

  const allGroupTasks: GroupTask[] = [];

  for (const p of projects) {
    const groups = p.teamsGroups && p.teamsGroups.length > 0
      ? p.teamsGroups
      : [];

    // Fallback to old schema fields if needed
    if (groups.length === 0) {
      if (p.customerGroupUrl) groups.push({ name: p.customerGroupUrl, type: "customer" });
      if (p.internalGroupUrl) groups.push({ name: p.internalGroupUrl, type: "internal" });
    }

    for (const group of groups) {
      if (group.name) {
        const platform = ((group as any).platform || "teams") as "teams" | "zalo";
        allGroupTasks.push({
          projectId: p._id,
          chatName: group.name,
          platform,
          type: group.type,
        });
      }
    }
  }

  const teamsGroups = allGroupTasks.filter(g => g.platform === "teams");
  const zaloGroups = allGroupTasks.filter(g => g.platform === "zalo");

  console.log(`[Sync] Groups: ${teamsGroups.length} Teams, ${zaloGroups.length} Zalo`);

  let totalChats = 0;
  let totalExtracted = 0;
  let totalSaved = 0;

  const headlessMode = process.env.HEADLESS !== "false"; // default headless

  // ─── Sync Teams groups ────────────────────────────────────
  if (teamsGroups.length > 0) {
    const teamsConfig = {
      ...DEFAULT_CONFIG,
      headless: headlessMode,
      useRealChrome: true,
      // Mặc định scroll 30 lần để lấy nhiều message cũ.
      // Set FULL_SYNC=true để scroll nhiều hơn (80 lần).
      // Set SCROLL_COUNT=0 để chỉ lấy message mới nhất.
      scrollCount: process.env.FULL_SYNC === "true" ? 80 : (process.env.SCROLL_COUNT ? parseInt(process.env.SCROLL_COUNT) : 30),
    };

    const { browser: teamsBrowser, context: teamsContext } = await createStealthContext(teamsConfig);
    const teamsPage = teamsContext.pages()[0] || await teamsContext.newPage();
    await applyStealthPatches(teamsPage);

    try {
      await navigateToTeams(teamsPage, teamsConfig);
      const neededLogin = await waitForLogin(teamsPage, teamsConfig);
      if (neededLogin) {
        await teamsContext.storageState({ path: teamsConfig.sessionDir + "/state.json" });
        await log(undefined, undefined, "sync_progress", "Đã đăng nhập Teams (cần xác thực thủ công)");
      }

      for (let idx = 0; idx < teamsGroups.length; idx++) {
        const task = teamsGroups[idx];
        writeProgress({ total: allGroupTasks.length, done: totalChats, currentChat: task.chatName, platform: "teams", type: "syncing", message: `Teams: ${task.chatName}` });
        const result = await syncTeamsChat(teamsPage, teamsContext, teamsConfig, task.projectId, task.chatName);
        totalChats++;
        totalExtracted += result.extracted;
        totalSaved += result.saved;
        writeProgress({ total: allGroupTasks.length, done: totalChats, currentChat: "", platform: "teams", type: "done", message: `Teams: ${task.chatName} — ${result.saved} tin nhắn mới` });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[Sync-Teams] Error:", err);
      await log(undefined, undefined, "sync_error", `Lỗi Teams: ${errMsg}`);
    } finally {
      await teamsBrowser.close().catch(() => {});
    }
  }

  // ─── Sync Zalo groups ─────────────────────────────────────
  if (zaloGroups.length > 0) {
    // Init mode: fetch up to ~200 old messages
    // Regular mode: fetch only newest messages (~40 scrolls)
    const zaloInit = process.env.FULL_SYNC === "true";
    const zaloConfig = {
      ...DEFAULT_ZALO_CONFIG,
      headless: headlessMode,
      useRealChrome: true,
      scrollCount: zaloInit ? 200 : 40,
    };

    const { browser: zaloBrowser, context: zaloContext } = await createZaloStealthContext(zaloConfig);
    const zaloPage = zaloContext.pages()[0] || await zaloContext.newPage();
    await applyZaloStealthPatches(zaloPage);

    try {
      await navigateToZalo(zaloPage, zaloConfig);
      const neededLogin = await waitForZaloLogin(zaloPage, zaloConfig);
      if (neededLogin) {
        try {
          await zaloContext.storageState({ path: zaloConfig.sessionDir + "/state.json" });
        } catch { /* persistent context */ }
        await log(undefined, undefined, "sync_progress", "Đã đăng nhập Zalo (cần scan QR)");
      }

      for (let idx = 0; idx < zaloGroups.length; idx++) {
        const task = zaloGroups[idx];
        writeProgress({ total: allGroupTasks.length, done: totalChats, currentChat: task.chatName, platform: "zalo", type: "syncing", message: `Zalo: ${task.chatName}` });
        const result = await syncZaloChat(zaloPage, zaloConfig, task.projectId, task.chatName);
        totalChats++;
        totalExtracted += result.extracted;
        totalSaved += result.saved;
        writeProgress({ total: allGroupTasks.length, done: totalChats, currentChat: "", platform: "zalo", type: "done", message: `Zalo: ${task.chatName} — ${result.saved} tin nhắn mới` });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[Sync-Zalo] Error:", err);
      await log(undefined, undefined, "sync_error", `Lỗi Zalo: ${errMsg}`);
    } finally {
      await zaloBrowser.close().catch(() => {});
    }
  }

  const totalDuration = Date.now() - syncStartTime;
  console.log(`[Sync] Total: ${totalChats} chats, ${totalExtracted} extracted, ${totalSaved} saved in ${totalDuration}ms`);
  await log(undefined, undefined, "sync_end", `Kết thúc đồng bộ: ${totalChats} nhóm chat, ${totalExtracted} tin nhắn trích xuất, ${totalSaved} tin nhắn lưu mới`, JSON.stringify({ chats: totalChats, extracted: totalExtracted, saved: totalSaved, durationMs: totalDuration }));
}

// ─── Teams Chat Sync ────────────────────────────────────────

async function syncTeamsChat(page: any, context: any, config: any, projectId: string, chatName: string): Promise<{ extracted: number; saved: number }> {
  console.log(`\n[Sync-Teams] --- Syncing chat: "${chatName}" ---`);
  await log(projectId, chatName, "sync_start", `Bắt đầu đồng bộ Teams: "${chatName}"`);

  // Expand sections in sidebar
  await page.evaluate(() => {
    const treeitems = document.querySelectorAll('[role="treeitem"]');
    for (const item of treeitems) {
      const text = item.textContent?.trim() || "";
      if (["Chats", "External", "Đợi chốt manday"].includes(text)) {
        (item as HTMLElement).click();
      }
    }
  });
  await page.waitForTimeout(3000);

  // Search for the chat and click it
  let found = false;
  for (let i = 0; i < 5; i++) {
    const clicked = await page.evaluate((name: string) => {
      const items = document.querySelectorAll('[data-testid="list-item"]');
      for (const item of items) {
        const text = item.textContent?.trim() || "";
        if (text.includes(name) || name.includes(text.replace(/\d{1,2}:\d{2}.*/, "").trim())) {
          (item as HTMLElement).click();
          return true;
        }
      }
      return false;
    }, chatName);

    if (clicked) {
      found = true;
      break;
    }

    // Scroll sidebar down
    await page.evaluate(() => {
      const sb = document.querySelector('[data-tid="app-layout-area--mid-nav"]') || document.querySelector('[role="tree"]');
      if (sb) sb.scrollTop += 800;
    });
    await page.waitForTimeout(1000);
  }

  if (!found) {
    console.log(`[Sync-Teams] Could not find chat "${chatName}" in sidebar.`);
    await log(projectId, chatName, "sync_error", `Không tìm thấy chat "${chatName}" trong sidebar`);
    return { extracted: 0, saved: 0 };
  }

  console.log(`[Sync-Teams] Clicked chat "${chatName}". Waiting for render...`);
  await page.waitForTimeout(5000);

  // ── INCREMENTAL SCROLL-AND-EXTRACT ──
  // Uses incrementalScrollAndExtract which captures messages periodically
  // during scroll-up to work around Teams virtual DOM (which only keeps
  // ~100-200 messages rendered at a time).
  const result = await incrementalScrollAndExtract(page, { ...config, chatName });
  console.log(`[Sync-Teams] Extracted ${result.totalMessages} messages total, ${result.messages.filter(m => m.images?.length).length} with images.`);

  const finalMessages = result.messages.filter(m => m.content || m.images?.length);
  const imgCount = finalMessages.filter(m => m.images?.length).length;
  console.log(`[Sync-Teams] Final: ${finalMessages.length} msgs, ${imgCount} with images.`);

  let savedCount = 0;
  if (finalMessages.length > 0) {
    // Upload large data: URLs to Convex storage before saving
    const cleanedMessages = await processDataUrls(finalMessages);
    const saved = await client.mutation(api.projectChats.saveMessages, {
      projectId: projectId as any,
      chatName: chatName,
      platform: "teams",
      messages: cleanedMessages,
    });
    savedCount = saved.saved;
    console.log(`[Sync-Teams] Saved ${savedCount} new messages to Convex.`);
    await log(projectId, chatName, "sync_end", `Đã lưu ${savedCount} tin nhắn Teams mới từ "${chatName}"`, JSON.stringify({ extracted: finalMessages.length, saved: savedCount }));

    // Monitor new messages for PM actions
    if (savedCount > 0) {
      await runMonitor(cleanedMessages.slice(-20), projectId as any, chatName);
    }
  } else {
    await log(projectId, chatName, "sync_end", `Không có tin nhắn Teams mới từ "${chatName}"`);
  }

  return { extracted: finalMessages.length, saved: savedCount };
}

// ─── Zalo Chat Sync ─────────────────────────────────────────

async function syncZaloChat(page: any, config: any, projectId: string, chatName: string): Promise<{ extracted: number; saved: number }> {
  console.log(`\n[Sync-Zalo] --- Syncing chat: "${chatName}" ---`);
  await log(projectId, chatName, "sync_start", `Bắt đầu đồng bộ Zalo: "${chatName}"`);

  const found = await navigateToZaloGroup(page, chatName);
  if (!found) {
    console.log(`[Sync-Zalo] Could not find chat "${chatName}" in sidebar.`);
    await log(projectId, chatName, "sync_error", `Không tìm thấy nhóm Zalo "${chatName}" trong sidebar`);
    return { extracted: 0, saved: 0 };
  }

  console.log(`[Sync-Zalo] Navigated to "${chatName}". Extracting...`);
  await scrollZaloChatContainer(page, config);
  const result = await extractZaloMessages(page, { ...config, groupName: chatName });

  console.log(`[Sync-Zalo] Extracted ${result.totalMessages} messages from "${chatName}".`);
  await log(projectId, chatName, "sync_progress", `Trích xuất ${result.totalMessages} tin nhắn Zalo từ "${chatName}"`);

  let savedCount = 0;
  if (result.totalMessages > 0) {
    // Upload large data: URLs to Convex storage before saving
    const cleanedMessages = await processDataUrls(result.messages.map(m => ({
      sender: m.sender,
      senderAvatar: (m as any).senderAvatar || undefined,
      content: m.content,
      images: (m as any).images?.length ? (m as any).images : undefined,
      timestamp: m.timestamp,
      timestampMs: (m as any).timestampMs,
      isMine: (m as any).isMine,
    })));
    const saved = await client.mutation(api.projectChats.saveMessages, {
      projectId: projectId as any,
      chatName: chatName,
      platform: "zalo",
      messages: cleanedMessages,
    });
    savedCount = saved.saved;
    console.log(`[Sync-Zalo] Saved ${savedCount} new messages to Convex.`);
    await log(projectId, chatName, "sync_end", `Đã lưu ${savedCount} tin nhắn Zalo mới từ "${chatName}"`, JSON.stringify({ extracted: result.totalMessages, saved: savedCount }));

    // Monitor new messages for PM actions
    if (savedCount > 0) {
      await runMonitor(cleanedMessages.slice(-20), projectId as any, chatName);
    }
  } else {
    await log(projectId, chatName, "sync_end", `Không có tin nhắn Zalo mới từ "${chatName}"`);
  }

  return { extracted: result.totalMessages, saved: savedCount };
}

main().then(() => {
  clearProgress();
  console.log("[Sync] Finished all syncs.");
  process.exit(0);
}).catch((err) => {
  clearProgress();
  console.error(err);
  process.exit(1);
});

