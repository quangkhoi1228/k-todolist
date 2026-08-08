import { createStealthContext, waitForLogin, navigateToTeams, applyStealthPatches, incrementalScrollAndExtract, DEFAULT_CONFIG, getChatUrl, cleanTeamMessages } from "../lib/teams-automator";
import { createZaloStealthContext, waitForZaloLogin, navigateToZalo, navigateToZaloGroup, applyStealthPatches as applyZaloStealthPatches, scrollZaloChatContainer, extractZaloMessages, getGroupUrl, DEFAULT_ZALO_CONFIG } from "../lib/zalo-automator";
import * as path from "path";
import * as fs from "fs";
import dotenv from "dotenv";
import { getActiveProjectsWithTeamsGroups, getProject, updateProjectTeamsGroups } from "../../../src/lib/repo/projects";
import { saveMessages, uploadChatImage, getLatestTimestampMs } from "../../../src/lib/repo/projectChats";
import { runMonitor, type MonitorMessage } from "../lib/monitor";
import { addLog } from "../../../src/lib/repo/syncLogs";
import { syncGroups } from "../../../src/lib/repo/groups";
import { getUserPreferences } from "../../../src/lib/repo/userPreferences";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const userId = process.env.USER_ID;
if (!userId) {
  console.error("Missing USER_ID env variable");
  process.exit(1);
}

// ─── Progress file ──────────────────────────────────────────
const PROGRESS_FILE = path.join(process.cwd(), ".teams-sync-progress.json");
const RUNNING_FILE = path.join(process.cwd(), ".teams-sync-running");
// Lock file written by teams-send.ts while a send is in flight. Sync and
// send share the SAME Chrome profile — running both at once kills each
// other's browser, so the sync must wait/skip while a send is happening.
const SEND_RUNNING_FILE = path.join(process.cwd(), ".teams-send-running");

function isSendRunning(): boolean {
  try {
    if (fs.existsSync(SEND_RUNNING_FILE)) {
      const pid = parseInt(fs.readFileSync(SEND_RUNNING_FILE, "utf-8").trim(), 10);
      if (!isNaN(pid)) {
        process.kill(pid, 0); // throws if not running
        return true;
      }
    }
  } catch {
    // stale lock file — ignore
  }
  return false;
}

function writeProgress(data: { total: number; done: number; currentChat?: string; platform?: string; type?: string; message?: string }) {
  try {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify({ ...data, updatedAt: Date.now() }), "utf-8");
  } catch { /* ignore */ }
}

function clearProgress() {
  try { if (fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE); } catch { /* ignore */ }
}

/**
 * Upload large data: URLs to Postgres files table and return /api/data/files/{id} URLs.
 * Small data URLs (< 100KB base64) are kept as-is to avoid unnecessary storage ops.
 */
async function processDataUrls(messages: any[]): Promise<any[]> {
  const processed = messages.map(m => ({ ...m }));
  let uploadedCount = 0;

  for (const msg of processed) {
    // Large sender avatars are uploaded to files table the same way as
    // large message images (base64 avatars can be several hundred KB).
    if (typeof msg.senderAvatar === 'string' && msg.senderAvatar.startsWith('data:') && msg.senderAvatar.length > 100_000) {
      try {
        const fileId = await uploadChatImage(msg.senderAvatar, userId!);
        if (fileId) {
          msg.senderAvatar = `/api/data/files/${fileId}`;
          uploadedCount++;
        }
      } catch (e) {
        console.warn(`[Sync] Failed to upload avatar data URL (${(msg.senderAvatar.length / 1024).toFixed(0)}KB):`, e);
      }
    }

    if (!msg.images?.length) continue;

    const processedImages: string[] = [];
    for (const img of msg.images) {
      // Skip invalid entries (null/objects from failed blob→base64 conversions)
      if (typeof img !== 'string' || !img.length) continue;
      if (img.startsWith('data:') && img.length > 100_000) {
        // Upload large data URLs to files table
        try {
          const fileId = await uploadChatImage(img, userId!);
          if (fileId) {
            processedImages.push(`/api/data/files/${fileId}`);
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
    console.log(`[Sync] Uploaded ${uploadedCount} large images/avatars to Postgres.`);
  }

  return processed;
}

async function log(projectId: string | undefined, chatName: string | undefined, type: string, message: string, details?: string) {
  try {
    await addLog({
      projectId: projectId,
      userId,
      chatName,
      type,
      message,
      details,
    });
  } catch (e) {
    console.error("[SyncLog] Failed to write log:", e);
  }
}

/**
 * Persist the chat/group deep link for a project's teamsGroups entry.
 * Looks up the current project's teamsGroups, patches the url on the
 * matching group, and saves the url to the scrapedGroups table too.
 */
async function saveGroupUrlToDb(projectId: string, chatName: string, platform: "teams" | "zalo", url: string | undefined) {
  if (!url) return;
  try {
    const project = await getProject(projectId);
    const groups = ((project as any)?.teamsGroups || []) as { name: string; type: string; platform?: string; url?: string }[];
    const idx = groups.findIndex((g) => g.name === chatName);
    if (idx >= 0) {
      const newGroups = groups.map((g, i) => (i === idx ? { ...g, url } : g));
      await updateProjectTeamsGroups(projectId, { teamsGroups: newGroups as any });
    }
    await syncGroups({
      userId: userId!,
      platform,
      groups: [{ name: chatName, url }],
    }).catch(() => {});
    console.log(`[Sync] Saved ${platform} group url for "${chatName}": ${url.slice(0, 100)}`);
  } catch (e) {
    console.warn("[Sync] Failed to save group url:", e);
  }
}

async function main() {
  const syncStartTime = Date.now();
  console.log(`[Sync] Fetching projects for user: ${userId}`);

  // A Teams send is in flight on the shared Chrome profile — don't launch a
  // second browser on the same profile. Skip this round entirely (the next
  // auto-sync tick will pick up anything missed). Wait up to 3 minutes in
  // case the send finishes soon, then proceed anyway.
  const sendDeadline = Date.now() + 3 * 60 * 1000;
  while (isSendRunning() && Date.now() < sendDeadline) {
    console.log("[Sync] Dang co teams-send chay — cho send xong roi sync...");
    await new Promise((r) => setTimeout(r, 10_000));
  }
  if (isSendRunning()) {
    console.log("[Sync] teams-send van chay sau 3 phut — skip vong sync nay (tranh dung chung profile).");
    await log(undefined, undefined, "sync_end", "Bỏ qua đồng bộ: đang có tin nhắn Teams được gửi", JSON.stringify({ duration: 0, reason: "teams-send running" }));
    return;
  }

  await log(undefined, undefined, "sync_start", `Bắt đầu đồng bộ toàn bộ chat cho user ${userId}`);

  const projects = await getActiveProjectsWithTeamsGroups(userId!);
  
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

    // KHÔNG fallback sang `internalGroupUrl`/`customerGroupUrl` nữa — 2 field này đã
    // deprecated và chứa dữ liệu rác từ ticket ISD (tên nhóm thường như "Team"/"fptchat",
    // không phải deep link). Fallback cũ khiến sync tự động chạy các nhóm user chưa bao giờ
    // thêm, gây messages/gợi ý ma. Nhóm muốn sync phải được thêm qua UI (teamsGroups).

    for (const group of groups) {
      if (!group.name) continue;

      // Nhóm có name là URL (dán nhầm deep link vào ô tên nhóm) — không thể match
      // trong sidebar nên SKIP, tránh spam sync_error mỗi lần chạy.
      const name = String(group.name).trim();
      if (/^https?:\/\//i.test(name)) {
        console.warn(`[Sync] Skip group with URL as name in project ${p._id}: ${name.slice(0, 80)}`);
        continue;
      }

      const platform = ((group as any).platform || "teams") as "teams" | "zalo";
      allGroupTasks.push({
        projectId: p._id,
        chatName: name,
        platform,
        type: group.type,
      });
    }
  }

  const teamsGroups = allGroupTasks.filter(g => g.platform === "teams");
  const zaloGroups = allGroupTasks.filter(g => g.platform === "zalo");

  console.log(`[Sync] Groups: ${teamsGroups.length} Teams, ${zaloGroups.length} Zalo`);

  let totalChats = 0;
  let totalExtracted = 0;
  let totalSaved = 0;

  // Fresh messages per project, gathered across ALL groups of the project.
  // runMonitor is called once per project AFTER all groups are synced.
  const freshByProject = new Map<string, MonitorMessage[]>();

  const headlessMode = process.env.HEADLESS !== "false"; // default headless

  // ─── Sync mode ────────────────────────────────────────────
  // Incremental by default (per-user preference, overridable with
  // FULL_SYNC=true / SYNC_MODE=full). Incremental scrolls are capped low and
  // stop early once each chat's DB watermark is reached.
  const prefs = await getUserPreferences(userId!).catch(() => null);
  const chatSyncMode = (prefs?.chatSyncMode || process.env.SYNC_MODE || "incremental") as "incremental" | "full";
  const incrementalMode = chatSyncMode !== "full" && process.env.FULL_SYNC !== "true";
  console.log(`[Sync] Chat sync mode: ${incrementalMode ? "incremental" : "full"}`);

  const teamsScrollCount = process.env.FULL_SYNC === "true" ? 80 : (process.env.SCROLL_COUNT ? parseInt(process.env.SCROLL_COUNT) : (incrementalMode ? 10 : 30));
  const zaloScrollCount = process.env.FULL_SYNC === "true" ? 200 : (incrementalMode ? 20 : 40);

  // ─── Sync Teams groups ────────────────────────────────────
  if (teamsGroups.length > 0) {
    const teamsConfig = {
      ...DEFAULT_CONFIG,
      headless: headlessMode,
      useRealChrome: true,
      // Mặc định scroll 30 lần để lấy nhiều message cũ.
      // Set FULL_SYNC=true để scroll nhiều hơn (80 lần).
      // Set SCROLL_COUNT=0 để chỉ lấy message mới nhất.
      // Incremental: scroll tối đa 10 lần, dừng sớm khi gặp mốc đã sync.
      scrollCount: teamsScrollCount,
    };

    const { browser: teamsBrowser, context: teamsContext } = await createStealthContext(teamsConfig);
    // CDP mode: dùng tab Teams có sẵn (đã load) nếu có — tránh tích tụ tab heavy
    let teamsPage = teamsContext.pages()[0];
    if (process.env.USE_CDP === "1" || process.env.USE_CDP === "true") {
      const teamsPg = teamsContext.pages().find((p) => p.url().includes("teams.microsoft.com"));
      teamsPage = teamsPg || await teamsContext.newPage();
    }
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
        const result = await syncTeamsChat(teamsPage, teamsContext, teamsConfig, task.projectId, task.chatName, freshByProject, incrementalMode);
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
    // Incremental mode: scroll tối đa 20 lần, dừng sớm khi gặp mốc đã sync.
    const zaloConfig = {
      ...DEFAULT_ZALO_CONFIG,
      headless: headlessMode,
      useRealChrome: true,
      scrollCount: zaloScrollCount,
    };

    const { browser: zaloBrowser, context: zaloContext } = await createZaloStealthContext(zaloConfig);
    // CDP mode: dùng tab Zalo có sẵn (đã load) nếu có — tránh tích tụ tab heavy
    let zaloPage = zaloContext.pages()[0];
    if (process.env.USE_CDP === "1" || process.env.USE_CDP === "true") {
      const zaloPg = zaloContext.pages().find((p) => p.url().includes("zalo.me"));
      zaloPage = zaloPg || await zaloContext.newPage();
    }
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
        const result = await syncZaloChat(zaloPage, zaloConfig, task.projectId, task.chatName, freshByProject, incrementalMode);
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

  // ─── Monitor: ONE LLM call per project (not per chat) ────
  for (const [pid, fresh] of freshByProject) {
    if (!fresh.length) continue;
    console.log(`[Sync] Running monitor for project ${pid} (${fresh.length} new messages)...`);
    await runMonitor(fresh.slice(-40), pid, fresh[fresh.length - 1].chatName || "", userId!);
  }

  const totalDuration = Date.now() - syncStartTime;
  console.log(`[Sync] Total: ${totalChats} chats, ${totalExtracted} extracted, ${totalSaved} saved in ${totalDuration}ms`);
  await log(undefined, undefined, "sync_end", `Kết thúc đồng bộ: ${totalChats} nhóm chat, ${totalExtracted} tin nhắn trích xuất, ${totalSaved} tin nhắn lưu mới`, JSON.stringify({ chats: totalChats, extracted: totalExtracted, saved: totalSaved, durationMs: totalDuration }));
}

// ─── Teams Chat Sync ────────────────────────────────────────

async function syncTeamsChat(page: any, context: any, config: any, projectId: string, chatName: string, freshByProject: Map<string, MonitorMessage[]>, incrementalMode: boolean): Promise<{ extracted: number; saved: number }> {
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
  const chatConfig = { ...config, chatName };
  if (incrementalMode) {
    const since = await getLatestTimestampMs(projectId, chatName, "teams");
    if (since !== null) {
      chatConfig.incrementalSince = since;
      console.log(`[Sync-Teams] Incremental: watermark=${since}`);
    } else {
      console.log(`[Sync-Teams] No watermark — full sync for "${chatName}"`);
    }
  }
  const result = await incrementalScrollAndExtract(page, chatConfig);
  console.log(`[Sync-Teams] Extracted ${result.totalMessages} messages total, ${result.messages.filter(m => m.images?.length).length} with images.`);

  // Gán sender="Me" cho tin của mình (Teams không luôn gắn class .fui-ChatMyMessage)
  cleanTeamMessages(result.messages);

  // Save the deep link to this chat group (Teams v2 hash URL)
  const chatUrl = (result as any).chatUrl || await getChatUrl(page);
  if (chatUrl) {
    await saveGroupUrlToDb(projectId, chatName, "teams", chatUrl);
  }

  const finalMessages = result.messages.filter(m => m.content || m.images?.length);
  const imgCount = finalMessages.filter(m => m.images?.length).length;
  console.log(`[Sync-Teams] Final: ${finalMessages.length} msgs, ${imgCount} with images.`);

  let savedCount = 0;
  if (finalMessages.length > 0) {
    // Upload large data: URLs to Convex storage before saving
    const cleanedMessages = await processDataUrls(finalMessages);
    const saved = await saveMessages({
      projectId: projectId,
      chatName: chatName,
      platform: "teams",
      messages: cleanedMessages,
    });
    savedCount = saved.saved;
    console.log(`[Sync-Teams] Saved ${savedCount} new messages to Postgres.`);
    await log(projectId, chatName, "sync_end", `Đã lưu ${savedCount} tin nhắn Teams mới từ "${chatName}"`, JSON.stringify({ extracted: finalMessages.length, saved: savedCount }));

    // Collect fresh messages for the per-project monitor pass (one LLM call
    // per project instead of one per chat).
    if (savedCount > 0) {
      const fresh = freshByProject.get(projectId) || [];
      fresh.push(...cleanedMessages.slice(-20));
      freshByProject.set(projectId, fresh);
    }
  } else {
    await log(projectId, chatName, "sync_end", `Không có tin nhắn Teams mới từ "${chatName}"`);
  }

  return { extracted: finalMessages.length, saved: savedCount };
}

// ─── Zalo Chat Sync ─────────────────────────────────────────

async function syncZaloChat(page: any, config: any, projectId: string, chatName: string, freshByProject: Map<string, MonitorMessage[]>, incrementalMode: boolean): Promise<{ extracted: number; saved: number }> {
  console.log(`\n[Sync-Zalo] --- Syncing chat: "${chatName}" ---`);
  await log(projectId, chatName, "sync_start", `Bắt đầu đồng bộ Zalo: "${chatName}"`);

  const found = await navigateToZaloGroup(page, chatName);
  if (!found) {
    console.log(`[Sync-Zalo] Could not find chat "${chatName}" in sidebar.`);
    await log(projectId, chatName, "sync_error", `Không tìm thấy nhóm Zalo "${chatName}" trong sidebar`);
    return { extracted: 0, saved: 0 };
  }

  console.log(`[Sync-Zalo] Navigated to "${chatName}". Extracting...`);
  const chatConfig = { ...config, groupName: chatName };
  if (incrementalMode) {
    const since = await getLatestTimestampMs(projectId, chatName, "zalo");
    if (since !== null) {
      chatConfig.incrementalSince = since;
      console.log(`[Sync-Zalo] Incremental: watermark=${since}`);
    } else {
      console.log(`[Sync-Zalo] No watermark — full sync for "${chatName}"`);
    }
  }
  await scrollZaloChatContainer(page, chatConfig);
  const result = await extractZaloMessages(page, chatConfig);

  console.log(`[Sync-Zalo] Extracted ${result.totalMessages} messages from "${chatName}".`);
  await log(projectId, chatName, "sync_progress", `Trích xuất ${result.totalMessages} tin nhắn Zalo từ "${chatName}"`);

  // Save the deep link to this Zalo group (hash URL: #/g/{groupId})
  const groupUrl = (result as any).groupUrl || await getGroupUrl(page);
  if (groupUrl) {
    await saveGroupUrlToDb(projectId, chatName, "zalo", groupUrl);
  }

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
      platformMsgId: (m as any).platformMsgId,
      isMine: (m as any).isMine,
    })));
    const saved = await saveMessages({
      projectId: projectId,
      chatName: chatName,
      platform: "zalo",
      messages: cleanedMessages,
    });
    savedCount = saved.saved;
    console.log(`[Sync-Zalo] Saved ${savedCount} new messages to Postgres.`);
    await log(projectId, chatName, "sync_end", `Đã lưu ${savedCount} tin nhắn Zalo mới từ "${chatName}"`, JSON.stringify({ extracted: result.totalMessages, saved: savedCount }));

    // Collect fresh messages for the per-project monitor pass.
    if (savedCount > 0) {
      const fresh = freshByProject.get(projectId) || [];
      fresh.push(...cleanedMessages.slice(-20));
      freshByProject.set(projectId, fresh);
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

