/**
 * Sync tất cả nhóm chat (Teams + Zalo) của MỘT project — dành cho auto-sync
 * nhanh khi user đang mở project đó (1 phút/lần). Chỉ sync các nhóm đã add
 * qua UI (teamsGroups), incremental theo watermark, không sync toàn bộ project.
 *
 * Chạy:
 *   USER_ID=xxx PROJECT_ID=35 npx tsx agents/pm/scripts/sync-project-chats.ts
 *   SYNC_MODE=full  — bỏ qua watermark (full sync)
 */
import { createStealthContext, waitForLogin, navigateToTeams, applyStealthPatches, incrementalScrollAndExtract, DEFAULT_CONFIG, getChatUrl, cleanTeamMessages, openTeamsTabInBackground } from "../lib/teams-automator";
import { createZaloStealthContext, waitForZaloLogin, navigateToZalo, navigateToZaloGroup, applyStealthPatches as applyZaloStealthPatches, scrollZaloChatContainer, collectZaloMessagesFromPage, finalizeZaloMessages, ensureZaloTabActive, getGroupUrl, verifyZaloOpenChat, DEFAULT_ZALO_CONFIG, openZaloTabInBackground } from "../lib/zalo-automator";
import * as path from "path";
import * as fs from "fs";
import dotenv from "dotenv";
import { getProject } from "../../../src/lib/repo/projects";
import { saveMessages, getLatestTimestampMs } from "../../../src/lib/repo/projectChats";
import { addLog } from "../../../src/lib/repo/syncLogs";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const userId = process.env.USER_ID;
const projectIdRaw = process.env.PROJECT_ID;
if (!userId || !projectIdRaw) {
  console.error("Missing USER_ID or PROJECT_ID env variable");
  process.exit(1);
}
const projectId = projectIdRaw;

// Lock file: tránh 2 sync cùng lúc đè Chrome profile (giống sync-all-projects)
const RUNNING_FILE = path.join(process.cwd(), ".teams-sync-running");
const SEND_RUNNING_FILE = path.join(process.cwd(), ".teams-send-running");

function claimRunningLock(): boolean {
  try {
    if (fs.existsSync(RUNNING_FILE)) {
      const pid = parseInt(fs.readFileSync(RUNNING_FILE, "utf-8").trim(), 10);
      if (!isNaN(pid)) {
        process.kill(pid, 0);
        return false; // another sync already running
      }
    }
  } catch {
    try { fs.unlinkSync(RUNNING_FILE); } catch { /* ignore */ }
  }
  try {
    fs.writeFileSync(RUNNING_FILE, `${process.pid}`, "utf-8");
    return true;
  } catch {
    return false;
  }
}

function releaseRunningLock() {
  try { if (fs.existsSync(RUNNING_FILE)) fs.unlinkSync(RUNNING_FILE); } catch { /* ignore */ }
}

function isSendRunning(): boolean {
  // Check cả teams-send và zalo-send lock — mỗi cái 1 PID, pid chết là stale
  for (const file of [SEND_RUNNING_FILE, path.join(process.cwd(), ".zalo-send-running")]) {
    try {
      if (fs.existsSync(file)) {
        const pid = parseInt(fs.readFileSync(file, "utf-8").trim(), 10);
        if (!isNaN(pid)) {
          process.kill(pid, 0);
          return true;
        }
      }
    } catch { /* ignore */ }
  }
  return false;
}

/**
 * CDP mode: script mở TAB RIÊNG trên Chrome thật — khi xong phải huỷ ĐÚNG
 * tab đó (page.close()), không đóng browser (Chrome thật + tab khác sống).
 * Xét page có phải tab do script mở không (không phải tab có sẵn như
 * pages()[0] / tab zalo.me): nếu có → chỉ đóng page.
 */
function shouldCloseOnlyPage(page: import("playwright").Page, context: import("playwright").BrowserContext): boolean {
  if (process.env.SYNC_CDP_CONNECTED !== "1") return false;
  try {
    return context.pages().length > 1 || !context.pages().includes(page) || page.url() === "about:blank";
  } catch {
    return false;
  }
}

/** Đóng đúng tài nguyên: tab riêng (CDP) hoặc cả browser (persistent fallback). */
async function closeOwnPageOrBrowser(page: import("playwright").Page, browser: import("playwright").Browser, context: import("playwright").BrowserContext): Promise<void> {
  if (shouldCloseOnlyPage(page, context)) {
    await page.close().catch(() => {});
    console.log("[SyncProject] Đã huỷ tab riêng (CDP).");
  } else {
    await browser.close().catch(() => {});
  }
}

async function log(projectId: string, chatName: string | undefined, type: string, message: string, details?: string) {
  try {
    await addLog({ projectId, userId, chatName, type, message, details });
  } catch (e) {
    console.error("[SyncLog] Failed to write log:", e);
  }
}

/**
 * Upload large data: URLs to Postgres files table (giống sync-all-projects).
 */
async function processDataUrls(messages: any[]): Promise<any[]> {
  const processed = messages.map(m => ({ ...m }));
  for (const msg of processed) {
    if (typeof msg.senderAvatar === 'string' && msg.senderAvatar.startsWith('data:') && msg.senderAvatar.length > 100_000) {
      try {
        const { uploadChatImage } = await import("../../../src/lib/repo/projectChats");
        const fileId = await uploadChatImage(msg.senderAvatar, userId!);
        if (fileId) msg.senderAvatar = `/api/data/files/${fileId}`;
      } catch (e) {
        console.warn("[SyncProject] Failed to upload avatar:", e);
      }
    }
    if (!msg.images?.length) continue;
    const processedImages: string[] = [];
    for (const img of msg.images) {
      if (typeof img !== 'string' || !img.length) continue;
      if (img.startsWith('data:') && img.length > 100_000) {
        try {
          const { uploadChatImage } = await import("../../../src/lib/repo/projectChats");
          const fileId = await uploadChatImage(img, userId!);
          if (fileId) {
            processedImages.push(`/api/data/files/${fileId}`);
            continue;
          }
        } catch (e) {
          console.warn("[SyncProject] Failed to upload image, keeping data:", e);
        }
      }
      processedImages.push(img);
    }
    msg.images = processedImages;
  }
  return processed;
}

async function syncTeamsChat(page: any, config: any, chatName: string): Promise<number> {
  console.log(`[SyncProject-Teams] --- Syncing: "${chatName}" ---`);
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
  await page.waitForTimeout(2500);

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
    if (clicked) { found = true; break; }
    await page.evaluate(() => {
      const sb = document.querySelector('[data-tid="app-layout-area--mid-nav"]') || document.querySelector('[role="tree"]');
      if (sb) (sb as HTMLElement).scrollTop += 800;
    });
    await page.waitForTimeout(1000);
  }

  if (!found) {
    console.log(`[SyncProject-Teams] Could not find chat "${chatName}".`);
    await log(projectId, chatName, "sync_error", `Không tìm thấy chat "${chatName}" trong sidebar`);
    return 0;
  }
  await page.waitForTimeout(4000);

  const chatConfig = { ...config, chatName };
  if (process.env.SYNC_MODE !== "full") {
    const since = await getLatestTimestampMs(projectId, chatName, "teams");
    if (since !== null) {
      chatConfig.incrementalSince = since;
      console.log(`[SyncProject-Teams] Incremental: watermark=${since}`);
    } else {
      console.log(`[SyncProject-Teams] No watermark — full sync`);
    }
  }
  const result = await incrementalScrollAndExtract(page, chatConfig);

  // Gán sender="Me" cho tin của mình (Teams không luôn gắn class .fui-ChatMyMessage)
  cleanTeamMessages(result.messages);

  const finalMessages = result.messages.filter(m => m.content || m.images?.length);
  console.log(`[SyncProject-Teams] Extracted ${result.totalMessages} total, ${finalMessages.length} usable.`);

  let savedCount = 0;
  if (finalMessages.length > 0) {
    const cleaned = await processDataUrls(finalMessages);
    const saved = await saveMessages({ projectId, chatName, platform: "teams", messages: cleaned });
    savedCount = saved.saved;
    console.log(`[SyncProject-Teams] Saved ${savedCount} new messages.`);
    await log(projectId, chatName, "sync_end", `Đã lưu ${savedCount} tin nhắn Teams mới từ "${chatName}"`, JSON.stringify({ extracted: finalMessages.length, saved: savedCount }));
  } else {
    await log(projectId, chatName, "sync_end", `Không có tin nhắn Teams mới từ "${chatName}"`);
  }
  return savedCount;
}

async function syncZaloChat(page: any, config: any, chatName: string): Promise<number> {
  console.log(`[SyncProject-Zalo] --- Syncing: "${chatName}" ---`);
  await log(projectId, chatName, "sync_start", `Bắt đầu đồng bộ Zalo: "${chatName}"`);

  const found = await navigateToZaloGroup(page, chatName);
  if (!found) {
    console.log(`[SyncProject-Zalo] Could not find chat "${chatName}".`);
    await log(projectId, chatName, "sync_error", `Không tìm thấy nhóm Zalo "${chatName}" trong sidebar`);
    return 0;
  }

  // Zalo chỉ cho 1 tab active — xử lý overlay "Kích hoạt" trước khi sync
  await ensureZaloTabActive(page, config);
  const foundAfterActivate = await navigateToZaloGroup(page, chatName);
  if (!foundAfterActivate) {
    console.log(`[SyncProject-Zalo] Could not find chat "${chatName}" (after activation).`);
    await log(projectId, chatName, "sync_error", `Không tìm thấy nhóm Zalo "${chatName}" (sau kích hoạt tab)`);
    return 0;
  }

  // Verify the chat view is actually showing the target group — abort if a
  // click landed on a different chat instead of extracting its messages.
  const openCheck = await verifyZaloOpenChat(page, chatName);
  if (!openCheck.verified) {
    console.log(`[SyncProject-Zalo] WRONG CHAT OPEN: "${openCheck.openName}" (${openCheck.reason}). Aborting "${chatName}".`);
    await log(projectId, chatName, "sync_error", `Sai nhóm khi sync "${chatName}": đang mở "${openCheck.openName}"`, JSON.stringify({ expected: chatName, open: openCheck.openName, reason: openCheck.reason }));
    return 0;
  }
  console.log(`[SyncProject-Zalo] Navigated to "${chatName}". Extracting...`);

  const chatConfig = { ...config, groupName: chatName };
  if (process.env.SYNC_MODE !== "full") {
    const since = await getLatestTimestampMs(projectId, chatName, "zalo");
    if (since !== null) {
      chatConfig.incrementalSince = since;
      console.log(`[SyncProject-Zalo] Incremental: watermark=${since}`);
    } else {
      console.log(`[SyncProject-Zalo] No watermark — full sync`);
    }
  }
  const collected = await scrollZaloChatContainer(page, chatConfig);
  const result = await finalizeZaloMessages(page, chatConfig, chatName, collected);
  console.log(`[SyncProject-Zalo] Extracted ${result.totalMessages} messages.`);

  let savedCount = 0;
  if (result.totalMessages > 0) {
    const cleaned = await processDataUrls(result.messages.map(m => ({
      sender: m.sender,
      senderAvatar: (m as any).senderAvatar || undefined,
      content: m.content,
      images: (m as any).images?.length ? (m as any).images : undefined,
      timestamp: m.timestamp,
      timestampMs: (m as any).timestampMs,
      platformMsgId: (m as any).platformMsgId,
      isMine: (m as any).isMine,
    })));
    const saved = await saveMessages({ projectId, chatName, platform: "zalo", messages: cleaned });
    savedCount = saved.saved;
    console.log(`[SyncProject-Zalo] Saved ${savedCount} new messages.`);
    await log(projectId, chatName, "sync_end", `Đã lưu ${savedCount} tin nhắn Zalo mới từ "${chatName}"`, JSON.stringify({ extracted: result.totalMessages, saved: savedCount }));
  } else {
    await log(projectId, chatName, "sync_end", `Không có tin nhắn Zalo mới từ "${chatName}"`);
  }
  return savedCount;
}

async function main() {
  const startTime = Date.now();
  console.log(`[SyncProject] Syncing all chats of project ${projectId}`);

  // Không chạy khi đang có teams-send (dùng chung Chrome profile)
  if (isSendRunning()) {
    console.log("[SyncProject] teams-send dang chay — skip vong sync nay.");
    await log(projectId, undefined, "sync_end", "Bỏ qua đồng bộ: đang gửi tin nhắn Teams", JSON.stringify({ reason: "teams-send running" }));
    return;
  }

  const project = await getProject(projectId);
  if (!project) {
    console.error(`[SyncProject] Project ${projectId} not found.`);
    process.exit(1);
  }

  const groups = ((project as any).teamsGroups || []) as Array<{ name: string; type: string; platform?: string }>;
  const tasks = groups
    .filter(g => g.name && !/^https?:\/\//i.test(String(g.name).trim()))
    .map(g => ({
      chatName: String(g.name).trim(),
      platform: ((g as any).platform || "teams") as "teams" | "zalo",
    }));

  if (tasks.length === 0) {
    console.log("[SyncProject] No groups to sync (chua add nhom nao).");
    return;
  }
  console.log(`[SyncProject] Groups: ${tasks.filter(t => t.platform === "teams").length} Teams, ${tasks.filter(t => t.platform === "zalo").length} Zalo`);

  const headlessMode = process.env.HEADLESS !== "false";
  const incrementalMode = process.env.SYNC_MODE !== "full";
  let totalSaved = 0;

  // ─── Teams ──────────────────────────────────────────────
  const teamsTasks = tasks.filter(t => t.platform === "teams");
  if (teamsTasks.length > 0) {
    const teamsConfig = {
      ...DEFAULT_CONFIG,
      headless: headlessMode,
      useRealChrome: true,
      scrollCount: incrementalMode ? 6 : 30,
    };
    const { browser: teamsBrowser, context: teamsContext } = await createStealthContext(teamsConfig);
    let teamsPage = teamsContext.pages()[0];
    if (process.env.USE_CDP === "1" || process.env.USE_CDP === "true") {
      const teamsPg = teamsContext.pages().find((p) => p.url().includes("teams.microsoft.com"));
      teamsPage = teamsPg || await openTeamsTabInBackground(teamsBrowser, teamsContext);
    }
    await applyStealthPatches(teamsPage);
    try {
      await navigateToTeams(teamsPage, teamsConfig);
      const neededLogin = await waitForLogin(teamsPage, teamsConfig);
      if (neededLogin) {
        await teamsContext.storageState({ path: teamsConfig.sessionDir + "/state.json" });
        await log(projectId, undefined, "sync_progress", "Đã đăng nhập Teams (cần xác thực thủ công)");
      }
      for (const task of teamsTasks) {
        totalSaved += await syncTeamsChat(teamsPage, teamsConfig, task.chatName);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[SyncProject-Teams] Error:", errMsg);
      await log(projectId, undefined, "sync_error", `Lỗi Teams: ${errMsg}`);
    } finally {
      await closeOwnPageOrBrowser(teamsPage, teamsBrowser, teamsContext);
    }
  }

  // ─── Zalo ───────────────────────────────────────────────
  const zaloTasks = tasks.filter(t => t.platform === "zalo");
  if (zaloTasks.length > 0) {
    const zaloConfig = {
      ...DEFAULT_ZALO_CONFIG,
      headless: headlessMode,
      useRealChrome: true,
      scrollCount: incrementalMode ? 5 : 60,
    };
    const { browser: zaloBrowser, context: zaloContext } = await createZaloStealthContext(zaloConfig);
    let zaloPage = zaloContext.pages()[0];
    if (process.env.USE_CDP === "1" || process.env.USE_CDP === "true") {
      const zaloPg = zaloContext.pages().find((p) => p.url().includes("zalo.me"));
      zaloPage = zaloPg || await openZaloTabInBackground(zaloBrowser, zaloContext);
    }
    await applyZaloStealthPatches(zaloPage);
    try {
      await navigateToZalo(zaloPage, zaloConfig);
      const neededLogin = await waitForZaloLogin(zaloPage, zaloConfig);
      if (neededLogin) {
        try { await zaloContext.storageState({ path: zaloConfig.sessionDir + "/state.json" }); } catch { /* persistent context */ }
        await log(projectId, undefined, "sync_progress", "Đã đăng nhập Zalo (cần scan QR)");
      }
      for (const task of zaloTasks) {
        totalSaved += await syncZaloChat(zaloPage, zaloConfig, task.chatName);
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[SyncProject-Zalo] Error:", errMsg);
      await log(projectId, undefined, "sync_error", `Lỗi Zalo: ${errMsg}`);
    } finally {
      await closeOwnPageOrBrowser(zaloPage, zaloBrowser, zaloContext);
    }
  }

  const duration = Date.now() - startTime;
  console.log(`[SyncProject] Done: ${tasks.length} chats, ${totalSaved} new messages in ${duration}ms`);
  await log(projectId, undefined, "sync_end", `Kết thúc đồng bộ project ${projectId}: ${tasks.length} nhóm, ${totalSaved} tin mới`, JSON.stringify({ chats: tasks.length, saved: totalSaved, durationMs: duration }));
}

// ─── Run ───────────────────────────────────────────────────
(async () => {
  if (!claimRunningLock()) {
    console.log("[SyncProject] Another sync is already running — skip.");
    await log(projectId, undefined, "sync_end", "Bỏ qua đồng bộ: đang có sync khác chạy", JSON.stringify({ reason: "sync running" }));
    process.exit(0);
  }

  try {
    await main();
    releaseRunningLock();
    console.log("[SyncProject] Finished.");
    process.exit(0);
  } catch (err) {
    releaseRunningLock();
    console.error(err);
    process.exit(1);
  }
})();
