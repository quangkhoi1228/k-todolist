import { createStealthContext, waitForLogin, navigateToTeams, applyStealthPatches, incrementalScrollAndExtract, DEFAULT_CONFIG, getChatUrl, cleanTeamMessages } from "../lib/teams-automator";
import { createZaloStealthContext, waitForZaloLogin, navigateToZalo, navigateToZaloGroup, applyStealthPatches as applyZaloStealthPatches, scrollZaloChatContainer, extractZaloMessages, getGroupUrl, DEFAULT_ZALO_CONFIG } from "../lib/zalo-automator";
import dotenv from "dotenv";
import * as path from "path";
import { getProject, updateProjectTeamsGroups } from "../../../src/lib/repo/projects";
import { saveMessages, uploadChatImage, getLatestTimestampMs } from "../../../src/lib/repo/projectChats";
import { runMonitor } from "../lib/monitor";
import { addLog } from "../../../src/lib/repo/syncLogs";
import { syncGroups } from "../../../src/lib/repo/groups";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const userId = process.env.USER_ID;
if (!userId) {
  console.error("Missing USER_ID env variable");
  process.exit(1);
}

const projectId: string = process.env.PROJECT_ID!;
const chatName: string = process.env.CHAT_NAME!;
if (!projectId || !chatName) {
  console.error("Missing PROJECT_ID or CHAT_NAME env variables");
  process.exit(1);
}

const platform = (process.env.PLATFORM || "teams") as "teams" | "zalo";

// Nếu chatName là URL (deep link dán nhầm) — không thể tìm trong sidebar.
// Trích tên/ID từ URL nếu có thể, nếu không thì báo lỗi rõ ràng.
function extractNameFromUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return trimmed; // không phải URL — giữ nguyên
  try {
    const u = new URL(trimmed);
    // Zalo: https://zalo.me/g/okcmgz519 hoặc https://chat.zalo.me/#/g/{id}
    if (/zalo/i.test(u.hostname)) {
      const hashMatch = u.hash.match(/#\/g\/([\w-]+)/);
      const pathMatch = u.pathname.match(/\/g\/([\w-]+)/);
      const id = hashMatch?.[1] || pathMatch?.[1];
      if (id) return `[Zalo] ${id}`;
      return null;
    }
    // Teams: https://teams.microsoft.com/l/chat/19:xxx@thread.v2/... hoặc /v2/#/conversations/19:xxx
    if (/teams\.(microsoft|live)\.com/i.test(u.hostname)) {
      const m = trimmed.match(/19:[%a-zA-Z0-9._-]+@thread\.(v2|unq\.gbl\.thread\.2)/);
      if (m) return `[Teams] ${m[0].replace("%3a", ":").replace("%3A", ":")}`;
      return null;
    }
  } catch { /* fallthrough */ }
  return null;
}

/**
 * Upload large data: URLs to Postgres files table and return /api/data/files/{id} URLs.
 * Small data URLs (< 100KB base64) are kept as-is to avoid unnecessary storage ops.
 */
async function processDataUrls(messages: any[]): Promise<any[]> {
  const processed = messages.map(m => ({ ...m }));
  let uploadedCount = 0;

  for (const msg of processed) {
    // Large sender avatars are uploaded to the files table the same way as
    // large message images (base64 avatars can be several hundred KB).
    if (typeof msg.senderAvatar === 'string' && msg.senderAvatar.startsWith('data:') && msg.senderAvatar.length > 100_000) {
      try {
        const fileId = await uploadChatImage(msg.senderAvatar, userId!);
        if (fileId) {
          msg.senderAvatar = `/api/data/files/${fileId}`;
          uploadedCount++;
        }
      } catch (e) {
        console.warn(`[SyncOne] Failed to upload avatar data URL (${(msg.senderAvatar.length / 1024).toFixed(0)}KB):`, e);
      }
    }

    if (!msg.images?.length) continue;

    const processedImages: string[] = [];
    for (const img of msg.images) {
      // Skip invalid entries (null/objects from failed blob→base64 conversions)
      if (typeof img !== 'string' || !img.length) continue;
      if (img.startsWith('data:') && img.length > 100_000) {
        try {
          const fileId = await uploadChatImage(img, userId!);
          if (fileId) {
            processedImages.push(`/api/data/files/${fileId}`);
            uploadedCount++;
            continue;
          }
        } catch (e) {
          console.warn(`[SyncOne] Failed to upload data URL (${(img.length / 1024).toFixed(0)}KB), keeping as data:`, e);
        }
      }
      processedImages.push(img);
    }
    msg.images = processedImages;
  }

  if (uploadedCount > 0) {
    console.log(`[SyncOne] Uploaded ${uploadedCount} large images/avatars to Postgres.`);
  }

  return processed;
}

async function log(type: string, message: string, details?: string) {
  try {
    await addLog({
      projectId: projectId,
      userId,
      chatName: chatName!,
      type,
      message,
      details,
    });
  } catch (e) {
    console.error("[SyncLog] Failed to write log:", e);
  }
}

/**
 * Decide sync mode for a chat group:
 * - FULL_SYNC=true or SYNC_MODE=full → full sync (existing behavior)
 * - SCROLL_COUNT explicit → leave scroll count alone (caller uses it as-is)
 * - Otherwise incremental: use the DB watermark (latest timestampMs of this
 *   group) to stop scrolling early; no watermark → full sync (first time).
 */
async function resolveSyncMode(): Promise<{ incremental: boolean; incrementalSince?: number }> {
  if (process.env.FULL_SYNC === "true" || process.env.SYNC_MODE === "full") {
    return { incremental: false };
  }
  const since = await getLatestTimestampMs(projectId, chatName!, platform);
  if (since !== null) {
    console.log(`[SyncOne] Incremental sync for "${chatName}" (watermark=${since})`);
    return { incremental: true, incrementalSince: since };
  }
  console.log(`[SyncOne] No watermark for "${chatName}" — full sync`);
  return { incremental: false };
}

/**
 * Persist the chat/group deep link for a project's teamsGroups entry.
 * Looks up the current project's teamsGroups, patches the url on the
 * matching group, and saves the url to the scrapedGroups table too.
 */
async function saveGroupUrlToDb(platform: "teams" | "zalo", url: string | undefined) {
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
      groups: [{ name: chatName!, url }],
    }).catch(() => {});
    console.log(`[SyncOne] Saved ${platform} group url for "${chatName}": ${url.slice(0, 100)}`);
  } catch (e) {
    console.warn("[SyncOne] Failed to save group url:", e);
  }
}

async function searchTeamsChat(page: import("playwright").Page, chatName: string): Promise<boolean> {
  try {
    const searchTrigger = page
      .locator(
        '[data-tid="search-entry"], input[placeholder*="Search"], input[placeholder*="Tìm kiếm"], ' +
          '[data-tid="app-bar-item-search"], button[aria-label*="Search"], button[aria-label*="Tìm kiếm"]'
      )
      .first();
    const visible = await searchTrigger.isVisible({ timeout: 3_000 }).catch(() => false);
    if (!visible) {
      console.log("[SyncOne] Search box not found.");
      return false;
    }
    await searchTrigger.click();
    await page.waitForTimeout(1_500);

    const searchInput = page
      .locator(
        '[data-tid="AUTOSUGGEST_INPUT"], input[placeholder*="Search"], input[placeholder*="Tìm kiếm"], input[role="searchbox"]'
      )
      .first();
    const inputVisible = await searchInput.isVisible({ timeout: 3_000 }).catch(() => false);
    if (!inputVisible) {
      console.log("[SyncOne] Search input not found.");
      return false;
    }
    await searchInput.click();
    await searchInput.fill(chatName);
    await page.waitForTimeout(3_000);

    // Click the best result: group chat first, then any row starting with target
    const clicked = await page.evaluate((target: string) => {
      const targetLower = target.toLowerCase().trim();
      const items = Array.from(
        document.querySelectorAll('[data-tid^="AUTOSUGGEST_SUGGESTION_TOPHITS"], [data-tid^="AUTOSUGGEST_SUGGESTION_PEOPLE"], [role="option"]')
      );
      // Priority 1: group chat (aria starts with "Group chat" or tid has @thread.v2)
      const groupItem = items.find((el) => {
        const tid = el.getAttribute("data-tid") || "";
        const aria = (el as HTMLElement).getAttribute?.("aria-label") || "";
        if (!aria.toLowerCase().startsWith("group chat") && !tid.includes("@thread.v2")) return false;
        const text = (el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
        return text.includes(targetLower) || text.startsWith(targetLower.slice(0, 12));
      });
      if (groupItem) {
        (groupItem as HTMLElement).click();
        return true;
      }
      // Priority 2: any row whose first line contains the target
      const rowItem = items.find((el) => {
        const text = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (!text) return false;
        if (/see more messages|send email|call |open profile|open chat|more messages|in all results|from:|messages|files|channels/i.test(text)) return false;
        if (text.length > 250) return false;
        const firstLine = text.toLowerCase().split("\n")[0].trim();
        return firstLine.includes(targetLower) || firstLine.startsWith(targetLower.slice(0, 12));
      });
      if (rowItem) {
        (rowItem as HTMLElement).click();
        return true;
      }
      return false;
    }, chatName);

    if (clicked) {
      console.log("[SyncOne] Clicked chat via Teams search.");
      await page.waitForTimeout(4_000);
      return true;
    }
    await page.keyboard.press("Escape").catch(() => {});
    console.log("[SyncOne] No matching result in Teams search.");
    return false;
  } catch (e) {
    console.log("[SyncOne] Teams search failed: " + String(e));
    return false;
  }
}

async function syncTeams(syncName: string) {
  const syncMode = await resolveSyncMode();
  const config = {
    ...DEFAULT_CONFIG,
    headless: process.env.HEADLESS !== "false",
    useRealChrome: true,
    // Mặc định scroll 30 lần để lấy nhiều message cũ.
    // Set FULL_SYNC=true để scroll nhiều hơn (80 lần).
    // Set SCROLL_COUNT=0 để chỉ lấy message mới nhất.
    // Incremental: scroll tối đa 10 lần, dừng sớm khi gặp mốc đã sync.
    scrollCount: process.env.FULL_SYNC === "true" ? 80 : (process.env.SCROLL_COUNT ? parseInt(process.env.SCROLL_COUNT) : (syncMode.incremental ? 10 : 30)),
    ...(syncMode.incrementalSince !== undefined ? { incrementalSince: syncMode.incrementalSince } : {}),
  };

  const { browser, context } = await createStealthContext(config);
  // CDP mode: dùng tab Teams có sẵn (đã load) nếu có — tránh tích tụ tab heavy
  let page = context.pages()[0];
  if (process.env.USE_CDP === "1" || process.env.USE_CDP === "true") {
    const teamsPage = context.pages().find((p) => p.url().includes("teams.microsoft.com"));
    page = teamsPage || await context.newPage();
  }
  await applyStealthPatches(page);

  try {
    await navigateToTeams(page, config);
    const neededLogin = await waitForLogin(page, config);
    if (neededLogin) {
      await context.storageState({ path: config.sessionDir + "/state.json" });
      await log("sync_progress", "Đã đăng nhập Teams (cần xác thực thủ công)");
    }

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
    // NOTE: Teams renders chat names with DOUBLE spaces (e.g. "[Internal]  FRT FinOPS"),
    // while our DB stores single-spaced names ("[Internal] FRT FinOPS"). So we must
    // normalize whitespace before matching.
    const nameToFind = syncName.replace(/\s+/g, " ").trim();

    let found = false;
    for (let i = 0; i < 5; i++) {
      const clicked = await page.evaluate((name: string) => {
        const items = document.querySelectorAll('[data-testid="list-item"]');
        for (const item of items) {
          const text = (item.textContent || "").replace(/\s+/g, " ").trim();
          if (text.includes(name)) {
            (item as HTMLElement).click();
            return true;
          }
        }
        return false;
      }, nameToFind);

      if (clicked) {
        found = true;
        break;
      }

      await page.evaluate(() => {
        const sb = document.querySelector('[data-tid="app-layout-area--mid-nav"]') || document.querySelector('[role="tree"]');
        if (sb) sb.scrollTop += 800;
      });
      await page.waitForTimeout(1000);
    }

    // Fallback: use the Teams search box (finds chats not visible in sidebar)
    if (!found) {
      console.log(`[SyncOne] Chat not found in sidebar, trying Teams search box...`);
      found = await searchTeamsChat(page, syncName);
    }

    if (!found) {
      console.log(`[SyncOne] Could not find chat "${syncName}" in sidebar.`);
      await log("sync_error", `Không tìm thấy chat "${syncName}" trong sidebar`);
      return;
    }

    console.log(`[SyncOne] Clicked chat "${syncName}". Waiting for render...`);
    await page.waitForTimeout(5000);

    // ── INCREMENTAL SCROLL-AND-EXTRACT ──
    // Uses incrementalScrollAndExtract which captures messages periodically
    // during scroll-up to work around Teams virtual DOM (which only keeps
    // ~100-200 messages rendered at a time).
    const result = await incrementalScrollAndExtract(page, { ...config, chatName: syncName });
    console.log(`[SyncOne] Extracted ${result.totalMessages} messages total, ${result.messages.filter(m => m.images?.length).length} with images.`);

    // Save the deep link to this chat group (Teams v2 hash URL)
    const chatUrl = (result as any).chatUrl || await getChatUrl(page);
    if (chatUrl) {
      await saveGroupUrlToDb("teams", chatUrl);
    }

    // Gán sender="Me" cho tin của mình (Teams không luôn gắn class .fui-ChatMyMessage)
    cleanTeamMessages(result.messages);

    const finalMessages = result.messages.filter(m => m.content || m.images?.length);
    console.log(`[SyncOne] Final: ${finalMessages.length} msgs, ${finalMessages.filter(m => m.images?.length).length} with images.`);

    if (finalMessages.length > 0) {
      const cleanedMessages = await processDataUrls(finalMessages);
      const saved = await saveMessages({
        projectId: projectId,
        chatName: syncName,
        platform: "teams",
        messages: cleanedMessages,
      });
      console.log(`[SyncOne] Saved ${saved.saved} new messages to Postgres.`);
      await log("sync_end", `Đã lưu ${saved.saved} tin nhắn mới từ "${syncName}"`, JSON.stringify({ extracted: finalMessages.length, saved: saved.saved }));

      // Monitor new messages for PM actions
      if (saved.saved > 0) {
        await runMonitor(cleanedMessages.slice(-20), projectId, syncName, userId!);
      }
    } else {
      await log("sync_end", `Không có tin nhắn mới từ "${syncName}"`);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[SyncOne] Fatal error:", err);
    await log("sync_error", `Lỗi: ${errMsg}`, JSON.stringify({ error: errMsg }));
  } finally {
    await browser.close().catch(() => {});
  }
}

async function syncZalo(syncName: string) {
  const syncMode = await resolveSyncMode();
  // Init mode: fetch up to ~200 old messages
  // Regular mode: fetch only newest messages (~40 scrolls)
  // Incremental mode: scroll tối đa 20 lần, dừng sớm khi gặp mốc đã sync.
  const zaloInit = process.env.FULL_SYNC === "true";
  const config = {
    ...DEFAULT_ZALO_CONFIG,
    headless: process.env.HEADLESS !== "false",
    useRealChrome: true,
    scrollCount: zaloInit ? 200 : (syncMode.incremental ? 20 : 40),
    ...(syncMode.incrementalSince !== undefined ? { incrementalSince: syncMode.incrementalSince } : {}),
  };

  const { browser, context } = await createZaloStealthContext(config);
  // CDP mode: dùng tab Zalo có sẵn (đã load) nếu có — tránh tích tụ tab heavy
  let page = context.pages()[0];
  if (process.env.USE_CDP === "1" || process.env.USE_CDP === "true") {
    const zaloPage = context.pages().find((p) => p.url().includes("zalo.me"));
    page = zaloPage || await context.newPage();
  }
  await applyZaloStealthPatches(page);

  try {
    await navigateToZalo(page, config);
    const neededLogin = await waitForZaloLogin(page, config);
    if (neededLogin) {
      try {
        await context.storageState({ path: config.sessionDir + "/state.json" });
      } catch { /* persistent context */ }
      await log("sync_progress", "Đã đăng nhập Zalo (cần scan QR)");
    }

    const found = await navigateToZaloGroup(page, syncName);
    if (!found) {
      console.log(`[SyncOne] Could not find Zalo chat "${syncName}" in sidebar.`);
      await log("sync_error", `Không tìm thấy nhóm Zalo "${syncName}" trong sidebar`);
      return;
    }

    console.log(`[SyncOne] Navigated to Zalo "${syncName}". Extracting...`);
    await scrollZaloChatContainer(page, config);
    const result = await extractZaloMessages(page, { ...config, groupName: syncName });

    console.log(`[SyncOne] Extracted ${result.totalMessages} messages from Zalo "${syncName}".`);
    await log("sync_progress", `Trích xuất ${result.totalMessages} tin nhắn Zalo từ "${syncName}"`);

    // Save the deep link to this Zalo group (hash URL: #/g/{groupId})
    const groupUrl = (result as any).groupUrl || await getGroupUrl(page);
    if (groupUrl) {
      await saveGroupUrlToDb("zalo", groupUrl);
    }

    if (result.totalMessages > 0) {
      // Upload large data: URLs to Postgres files table before saving
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
        chatName: syncName,
        platform: "zalo",
        messages: cleanedMessages,
      });
      console.log(`[SyncOne] Saved ${saved.saved} new Zalo messages to Postgres.`);
      await log("sync_end", `Đã lưu ${saved.saved} tin nhắn Zalo mới từ "${syncName}"`, JSON.stringify({ extracted: result.totalMessages, saved: saved.saved }));

      // Monitor new messages for PM actions
      if (saved.saved > 0) {
        await runMonitor(cleanedMessages.slice(-20), projectId, syncName, userId!);
      }
    } else {
      await log("sync_end", `Không có tin nhắn Zalo mới từ "${syncName}"`);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[SyncOne] Fatal Zalo error:", err);
    await log("sync_error", `Lỗi Zalo: ${errMsg}`, JSON.stringify({ error: errMsg }));
  } finally {
    await browser.close().catch(() => {});
  }
}

async function main() {
  const rawName = chatName;
  const extracted = extractNameFromUrl(rawName);

  if (extracted === null) {
    // URL không trích được tên — dừng sớm, không mở browser
    console.error(`[SyncOne] chatName is a URL that cannot be matched in sidebar: "${rawName.slice(0, 120)}"`);
    await log("sync_error", `Tên nhóm là link (${rawName.slice(0, 80)}...) — không thể tìm trong sidebar. Hãy nhập tên nhóm chính xác trong panel Thêm nhóm.`);
    process.exit(0);
  }

  if (extracted !== rawName) {
    console.log(`[SyncOne] chatName is a URL — extracted display id "${extracted}"`);
  }

  console.log(`[SyncOne] Syncing ${platform} chat "${extracted}" for project ${projectId}`);
  await log("sync_start", `Bắt đầu đồng bộ ${platform} chat: "${extracted}"`);

  if (platform === "zalo") {
    await syncZalo(extracted);
  } else {
    await syncTeams(extracted);
  }
}

main().then(() => {
  console.log("[SyncOne] Finished.");
  process.exit(0);
}).catch(console.error);
