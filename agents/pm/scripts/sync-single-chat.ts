import { createStealthContext, waitForLogin, navigateToTeams, applyStealthPatches, incrementalScrollAndExtract, DEFAULT_CONFIG, getChatUrl } from "../lib/teams-automator";
import { createZaloStealthContext, waitForZaloLogin, navigateToZalo, navigateToZaloGroup, applyStealthPatches as applyZaloStealthPatches, scrollZaloChatContainer, extractZaloMessages, getGroupUrl, DEFAULT_ZALO_CONFIG } from "../lib/zalo-automator";
import dotenv from "dotenv";
import * as path from "path";
import { getProject, updateProjectTeamsGroups } from "../../../src/lib/repo/projects";
import { saveMessages, uploadChatImage } from "../../../src/lib/repo/projectChats";
import { addSuggestionsBatch } from "../../../src/lib/repo/projectSuggestions";
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

/**
 * After saving messages, analyse if any messages need PM attention
 * by calling LLM directly. Creates suggestions in projectSuggestions table.
 */
async function runMonitor(savedMessages: any[], projectId: string, chatName: string, projectName?: string) {
  if (!savedMessages || savedMessages.length === 0) return;

  const apiKey = process.env.OPENAI_API_KEY;
  const apiBase = process.env.OPENAI_BASE_URL;
  const model = process.env.LLM_MODEL || "deepsseek-v4_mimo_combo";

  if (!apiKey || !apiBase) {
    console.log(`[Monitor] Skipped: no LLM credentials`);
    return;
  }

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

    await addSuggestionsBatch({
      projectId: projectId,
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

    console.log(`[Monitor] Saved ${actions.length} suggestion(s) to Postgres.`);
  } catch (err) {
    console.warn(`[Monitor] Error:`, err);
  }
}

async function log(type: string, message: string, details?: string) {
  try {
    await addLog({
      projectId: projectId,
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

async function syncTeams() {
  const config = {
    ...DEFAULT_CONFIG,
    headless: process.env.HEADLESS !== "false",
    useRealChrome: true,
    // Mặc định scroll 30 lần để lấy nhiều message cũ.
    // Set FULL_SYNC=true để scroll nhiều hơn (80 lần).
    // Set SCROLL_COUNT=0 để chỉ lấy message mới nhất.
    scrollCount: process.env.FULL_SYNC === "true" ? 80 : (process.env.SCROLL_COUNT ? parseInt(process.env.SCROLL_COUNT) : 30),
  };

  const { browser, context } = await createStealthContext(config);
  const page = context.pages()[0] || await context.newPage();
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
    let found = false;
    const nameToFind = chatName!;
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

    if (!found) {
      console.log(`[SyncOne] Could not find chat "${chatName}" in sidebar.`);
      await log("sync_error", `Không tìm thấy chat "${chatName}" trong sidebar`);
      return;
    }

    console.log(`[SyncOne] Clicked chat "${chatName}". Waiting for render...`);
    await page.waitForTimeout(5000);

    // ── INCREMENTAL SCROLL-AND-EXTRACT ──
    // Uses incrementalScrollAndExtract which captures messages periodically
    // during scroll-up to work around Teams virtual DOM (which only keeps
    // ~100-200 messages rendered at a time).
    const result = await incrementalScrollAndExtract(page, { ...config, chatName: chatName! });
    console.log(`[SyncOne] Extracted ${result.totalMessages} messages total, ${result.messages.filter(m => m.images?.length).length} with images.`);

    // Save the deep link to this chat group (Teams v2 hash URL)
    const chatUrl = (result as any).chatUrl || await getChatUrl(page);
    if (chatUrl) {
      await saveGroupUrlToDb("teams", chatUrl);
    }

    const finalMessages = result.messages.filter(m => m.content || m.images?.length);
    console.log(`[SyncOne] Final: ${finalMessages.length} msgs, ${finalMessages.filter(m => m.images?.length).length} with images.`);

    if (finalMessages.length > 0) {
      const cleanedMessages = await processDataUrls(finalMessages);
      const saved = await saveMessages({
        projectId: projectId,
        chatName: chatName!,
        platform: "teams",
        messages: cleanedMessages,
      });
      console.log(`[SyncOne] Saved ${saved.saved} new messages to Postgres.`);
      await log("sync_end", `Đã lưu ${saved.saved} tin nhắn mới từ "${chatName!}"`, JSON.stringify({ extracted: finalMessages.length, saved: saved.saved }));

      // Monitor new messages for PM actions
      if (saved.saved > 0) {
        await runMonitor(cleanedMessages.slice(-20), projectId, chatName!);
      }
    } else {
      await log("sync_end", `Không có tin nhắn mới từ "${chatName!}"`);
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[SyncOne] Fatal error:", err);
    await log("sync_error", `Lỗi: ${errMsg}`, JSON.stringify({ error: errMsg }));
  } finally {
    await browser.close().catch(() => {});
  }
}

async function syncZalo() {
  // Init mode: fetch up to ~200 old messages
  // Regular mode: fetch only newest messages (~40 scrolls)
  const zaloInit = process.env.FULL_SYNC === "true";
  const config = {
    ...DEFAULT_ZALO_CONFIG,
    headless: process.env.HEADLESS !== "false",
    useRealChrome: true,
    scrollCount: zaloInit ? 200 : 40,
  };

  const { browser, context } = await createZaloStealthContext(config);
  const page = context.pages()[0] || await context.newPage();
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

    const found = await navigateToZaloGroup(page, chatName!);
    if (!found) {
      console.log(`[SyncOne] Could not find Zalo chat "${chatName}" in sidebar.`);
      await log("sync_error", `Không tìm thấy nhóm Zalo "${chatName}" trong sidebar`);
      return;
    }

    console.log(`[SyncOne] Navigated to Zalo "${chatName}". Extracting...`);
    await scrollZaloChatContainer(page, config);
    const result = await extractZaloMessages(page, { ...config, groupName: chatName! });

    console.log(`[SyncOne] Extracted ${result.totalMessages} messages from Zalo "${chatName!}".`);
    await log("sync_progress", `Trích xuất ${result.totalMessages} tin nhắn Zalo từ "${chatName!}"`);

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
        isMine: (m as any).isMine,
      })));
      const saved = await saveMessages({
        projectId: projectId,
        chatName: chatName!,
        platform: "zalo",
        messages: cleanedMessages,
      });
      console.log(`[SyncOne] Saved ${saved.saved} new Zalo messages to Postgres.`);
      await log("sync_end", `Đã lưu ${saved.saved} tin nhắn Zalo mới từ "${chatName!}"`, JSON.stringify({ extracted: result.totalMessages, saved: saved.saved }));

      // Monitor new messages for PM actions
      if (saved.saved > 0) {
        await runMonitor(cleanedMessages.slice(-20), projectId, chatName!);
      }
    } else {
      await log("sync_end", `Không có tin nhắn Zalo mới từ "${chatName!}"`);
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
  console.log(`[SyncOne] Syncing ${platform} chat "${chatName}" for project ${projectId}`);
  await log("sync_start", `Bắt đầu đồng bộ ${platform} chat: "${chatName}"`);

  if (platform === "zalo") {
    await syncZalo();
  } else {
    await syncTeams();
  }
}

main().then(() => {
  console.log("[SyncOne] Finished.");
  process.exit(0);
}).catch(console.error);
