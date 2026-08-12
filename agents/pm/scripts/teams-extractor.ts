/**
 * Teams Message Extractor - Playwright Script (Teams v2 compatible)
 *
 * Usage:
 *   # Lan dau (login):  npx tsx agents/pm/scripts/teams-extractor.ts
 *   # Sau do:           npx tsx agents/pm/scripts/teams-extractor.ts --headless
 *   # Voi deep link:    TEAMS_DEEPLINK="https://teams.microsoft.com/l/chat/19:..." \
 *                        npx tsx agents/pm/scripts/teams-extractor.ts
 *   # Hoac TEAMS_CHAT_NAME="Internal - PM CDC" npx tsx agents/pm/scripts/teams-extractor.ts
 *
 * Output: teams-messages.json  (PM Agent tu dong doc file nay neu co)
 *
 * Teams v2 notes:
 *   - Deep links (/l/chat/...) redirect to launcher page → cannot use
 *   - Must load homepage first, then click on chat in sidebar
 *   - Messages use: .fui-ChatMessage, data-testid="comfy-message-wrapper"
 *   - Author: data-tid="message-author-name"
 *   - Message pane: data-tid="message-pane-list-viewport"
 *   - Chat title: data-tid="chat-title"
 */

import { chromium, type Page } from "playwright";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

const PROJECT_ROOT = process.cwd();
const SESSION_DIR = path.join(PROJECT_ROOT, ".teams-session");
const OUTPUT_FILE = path.join(PROJECT_ROOT, "teams-messages.json");
const SCREENSHOT_DIR = path.join(PROJECT_ROOT, "teams-screenshots");

const SCROLL_WAIT_MS = 2_000;
const SCROLL_COUNT = 5;

function log(msg: string) {
  console.log(`[Teams] ${new Date().toLocaleString("vi-VN")}  ${msg}`);
}

function prompt(query: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(query, (ans) => { rl.close(); resolve(ans); }));
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Extract chat name from a Teams deep link.
 * Deep link format: https://teams.microsoft.com/l/chat/19:THREAD_ID@thread.v2/conversations?...
 * Returns the thread ID which can be used to find the chat.
 */
function extractThreadIdFromDeepLink(deepLink: string): string {
  const match = deepLink.match(/chat\/([^/]+)\//);
  return match ? decodeURIComponent(match[1]) : "";
}

/**
 * Navigate to a specific chat by clicking on it in the sidebar.
 * Uses the chat name (TEAMS_CHAT_NAME env) or falls back to using whatever chat is open.
 */
async function navigateToChat(page: Page, chatName: string): Promise<boolean> {
  if (!chatName) return false;

  log(`Tim kiem chat: "${chatName}" trong sidebar...`);

  // Helper: search and click the chat item
  async function tryClickChat(name: string): Promise<string | null> {
    return page.evaluate((searchName: string) => {
      // Get all individual chat items
      const items = document.querySelectorAll('[data-testid="list-item"]');

      // Find best match: shortest text that includes the chat name
      let bestMatch: HTMLElement | null = null;
      let bestLen = Infinity;

      for (const item of items) {
        const text = item.textContent?.trim() || "";
        if (text.includes(searchName) && text.length < bestLen) {
          bestMatch = item as HTMLElement;
          bestLen = text.length;
        }
      }

      if (bestMatch) {
        bestMatch.click();
        return bestMatch.textContent?.trim().slice(0, 100) || "clicked";
      }
      return null;
    }, name);
  }

  // Attempt 1: Direct search
  let found = await tryClickChat(chatName);
  if (found) {
    log(`Da click vao chat: "${found}"`);
    await page.waitForTimeout(5_000);
    return true;
  }

  // Attempt 2: Scroll the sidebar to load more items (lazy/virtual list)
  log("Chat khong thay o sidebar hien tai, dang scroll sidebar...");
  const sidebarSelector = '[data-tid="app-layout-area--mid-nav"], [data-testid="simple-collab-rail"], [role="tree"]';
  
  for (let scrollAttempt = 0; scrollAttempt < 5; scrollAttempt++) {
    await page.evaluate((sel: string) => {
      // Find the scrollable sidebar container
      const sidebar = document.querySelector(sel) 
        || document.querySelector('[data-tid="simple-collab-dnd-rail"]')
        || document.querySelector('[role="tree"]');
      if (sidebar) {
        sidebar.scrollTop += 400;
      }
      // Also try scrolling the closest scrollable parent
      const tree = document.querySelector('[role="tree"]');
      if (tree) {
        const scrollParent = tree.closest('[style*="overflow"]') || tree.parentElement;
        if (scrollParent) (scrollParent as HTMLElement).scrollTop += 400;
      }
    }, sidebarSelector);
    await page.waitForTimeout(1_500);

    // Try click again after scrolling
    found = await tryClickChat(chatName);
    if (found) {
      log(`Da click vao chat (sau scroll): "${found}"`);
      await page.waitForTimeout(5_000);
      return true;
    }
  }

  // Attempt 3: Expand collapsed section headers (e.g. "Chats", "External")
  log("Thu mo rong cac section bi dong...");
  await page.evaluate(() => {
    const treeitems = document.querySelectorAll('[role="treeitem"]');
    for (const item of treeitems) {
      const text = item.textContent?.trim() || "";
      // Click section headers to expand them
      if (["Chats", "External", "Đợi chốt manday"].includes(text)) {
        (item as HTMLElement).click();
      }
    }
  });
  await page.waitForTimeout(3_000);

  // Scroll and retry
  for (let scrollAttempt = 0; scrollAttempt < 5; scrollAttempt++) {
    await page.evaluate((sel: string) => {
      const sidebar = document.querySelector(sel) 
        || document.querySelector('[data-tid="simple-collab-dnd-rail"]')
        || document.querySelector('[role="tree"]');
      if (sidebar) sidebar.scrollTop += 400;
    }, sidebarSelector);
    await page.waitForTimeout(1_500);

    found = await tryClickChat(chatName);
    if (found) {
      log(`Da click vao chat (sau expand): "${found}"`);
      await page.waitForTimeout(5_000);
      return true;
    }
  }

  log(`Khong tim thay chat "${chatName}" trong sidebar sau khi scroll + expand.`);
  return false;
}

// ─── Extract messages via Teams v2 DOM selectors ──────────────────
async function extractMessagesV2(page: Page) {
  // Get chat/group name from the header
  const channelName = await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('[data-tid="chat-title"]');
    return el?.textContent?.trim() || "Unknown";
  });
  log(`Dang o channel: ${channelName}`);

  // Wait for message pane or messages to appear
  try {
    await page.waitForSelector(
      '[data-tid="message-pane-list-viewport"], [data-testid="comfy-message-wrapper"], .fui-ChatMessage',
      { timeout: 20_000 }
    );
    log("Da tim thay message pane.");
  } catch {
    log("Khong tim thay message pane, snapshot debug...");
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, `debug-${Date.now()}.png`) });
    return { channelName, messages: [] };
  }

  // Scroll within the message pane to load older messages
  log(`Dang scroll (${SCROLL_COUNT} lan)...`);
  for (let i = 0; i < SCROLL_COUNT; i++) {
    await page.evaluate(() => {
      const viewport = document.querySelector('[data-tid="message-pane-list-viewport"]');
      if (viewport) {
        viewport.scrollTop = 0; // scroll to top to load older messages
      }
    });
    await page.waitForTimeout(SCROLL_WAIT_MS);
    log(`  Scroll ${i + 1}/${SCROLL_COUNT}`);
  }

  // Scroll back to bottom for latest messages
  await page.evaluate(() => {
    const viewport = document.querySelector('[data-tid="message-pane-list-viewport"]');
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  });
  await page.waitForTimeout(1_000);

  // Extract messages using Teams v2 selectors
  log("Dang trich xuat tin nhan (Teams v2)...");
  const messages = await page.evaluate((groupName: string) => {
    const results: Array<{ sender: string; content: string; timestamp: string; groupName: string }> = [];

    // Teams v2: messages are inside .fui-ChatMessage or [data-testid="comfy-message-wrapper"]
    const wrappers = document.querySelectorAll<HTMLElement>(
      '[data-testid="comfy-message-wrapper"], .fui-ChatMessage'
    );

    const seen = new Set<string>();

    wrappers.forEach((el) => {
      // Author name: data-tid="message-author-name" still works in v2
      const nameEl = el.querySelector<HTMLElement>('[data-tid="message-author-name"]');
      const sender = nameEl?.textContent?.trim() || "";

      // Timestamp: <time> element with aria-label or datetime
      const timeEl = el.querySelector<HTMLTimeElement>("time");
      const timestamp = timeEl?.getAttribute("aria-label")
        || timeEl?.textContent?.trim()
        || "";

      // Message body: look for the text content that is NOT the author name or timestamp
      // In v2, message body is inside divs after the author header
      let content = "";

      // Quoted/reply message (Skype Reply schema blockquote)
      let quoteSender = "";
      let quoteContent = "";
      const quoteBq = el.querySelector<HTMLElement>('blockquote[itemtype*="schema.skype.com/Reply"], blockquote[itemprop*="quote"]');
      if (quoteBq) {
        const qNameEl = quoteBq.querySelector<HTMLElement>('strong[itemprop="mri"], [itemprop="mri"]');
        const qCopyEl = quoteBq.querySelector<HTMLElement>('[itemprop="copy"]') ||
          quoteBq.querySelector<HTMLElement>('[itemprop="preview"]');
        quoteSender = qNameEl?.textContent?.trim() || "";
        quoteContent = qCopyEl?.textContent?.trim() || "";
      }

      // Strategy 1: find a dedicated body container
      const bodyEl = el.querySelector<HTMLElement>('[data-tid="message-body-content"]');
      if (bodyEl) {
        const bodyClone = bodyEl.cloneNode(true) as HTMLElement;
        bodyClone.querySelectorAll('blockquote[itemtype*="schema.skype.com/Reply"], blockquote[itemprop*="quote"]').forEach(e => e.remove());
        content = bodyClone.textContent?.trim() || "";
      }

      // Strategy 2: get all text minus author/time/action buttons
      if (!content) {
        // Clone element, remove known non-content parts
        const clone = el.cloneNode(true) as HTMLElement;
        // Remove author
        clone.querySelectorAll('[data-tid="message-author-name"]').forEach(e => e.remove());
        // Remove time
        clone.querySelectorAll("time").forEach(e => e.remove());
        // Remove "Translate" links
        clone.querySelectorAll('a').forEach(e => {
          if (e.textContent?.trim() === "Translate" || e.textContent?.trim() === "Never translate Vietnamese") {
            e.remove();
          }
        });
        // Remove reaction buttons
        clone.querySelectorAll('button').forEach(e => e.remove());
        // Remove "Edited" label
        clone.querySelectorAll('span').forEach(e => {
          if (e.textContent?.trim() === "Edited") e.remove();
        });
        
        // Format quotes properly instead of squishing text
        clone.querySelectorAll('blockquote').forEach(bq => {
          bq.innerHTML = `\n> ${bq.innerText.trim()}\n\n`;
        });
        
        // Ensure divs have spaces
        clone.querySelectorAll('div').forEach(div => {
          div.innerHTML = div.innerHTML + ' ';
        });

        content = clone.textContent?.trim().replace(/\s{2,}/g, " ") || "";
      }

      // Compose final content: prefix quoted message in "> Sender: quoted" format
      if (quoteSender && quoteContent) {
        const quotedPrefix = `> ${quoteSender}: ${quoteContent}`;
        let stripped = content.replace(quotedPrefix, "");
        stripped = stripped.replace(/^\s*>.*$/m, () => "");
        stripped = stripped.replace(/\s{2,}/g, " ").trim();
        content = `> ${quoteSender}: ${quoteContent}\n${stripped}`;
      }

      if (!content || !sender) return;

      // Dedup by sender+content
      const key = `${sender}|${content.slice(0, 80)}`;
      if (seen.has(key)) return;
      seen.add(key);

      results.push({ sender, content, timestamp, groupName });
    });

    return results;
  }, channelName);

  log(`Trich xuat duoc ${messages.length} tin nhan.`);
  return { channelName, messages };
}

// ─── Main ─────────────────────────────────────────────────
async function main() {
  const isHeadless = process.argv.includes("--headless") || process.env.HEADLESS === "true";
  ensureDir(SESSION_DIR);
  ensureDir(SCREENSHOT_DIR);

  // Get deep link or chat name from env
  const deepLink = process.env.TEAMS_DEEPLINK || "";
  const chatName = process.env.TEAMS_CHAT_NAME || "";

  log(`Khoi dong browser...`);
  const profileDir = path.join(SESSION_DIR, "chrome-profile");
  ensureDir(profileDir);

  // Clean stale lock files
  for (const f of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
    const p = path.join(profileDir, f);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: isHeadless,
    channel: "chrome",
    viewport: { width: 1920, height: 1080 },
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-features=ExternalProtocolDialog",
      "--disable-session-crashed-bubble",
      "--disable-restore-session-state",
    ],
  });

  // Block msteams:// protocol to prevent browser popup
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith("msteams:") || url.startsWith("msteams-launch:") || url.startsWith("microsoft-edge:")) {
      await route.abort();
    } else {
      await route.continue();
    }
  });

  const page = context.pages()[0] || await context.newPage();

  try {
    // ── Step 1: Always go to Teams homepage (v2 SPA) ──
    log("Dang mo Teams homepage...");
    await page.goto("https://teams.microsoft.com", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(8_000);
    log(`URL: ${page.url()}`);

    // ── Step 2: Check login ──
    const needLogin = page.locator('input[type="email"], [data-tid="signIn"]');
    if (await needLogin.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
      log("Can dang nhap. Dang nhap trong cua so browser (co 120s)...");
      console.log("\n  >>> DANG NHAP VAO TEAMS TRONG CUA SO VUA MO <<<");
      await page.waitForURL("**/v2/**", { timeout: 120_000 });
      log("Dang nhap thanh cong!");
      await page.waitForTimeout(5_000);
    } else {
      log("Da co session.");
    }

    // ── Step 3: Navigate to specific chat ──
    // Priority: chatName > extract name from sidebar matching thread ID
    if (chatName) {
      await navigateToChat(page, chatName);
    } else if (deepLink) {
      // Extract thread ID from deep link and try to find corresponding chat
      const threadId = extractThreadIdFromDeepLink(deepLink);
      log(`Thread ID tu deep link: ${threadId.slice(0, 50)}...`);
      // We can't directly match thread ID to sidebar items, so we just use whatever chat is open
      // The user should pass TEAMS_CHAT_NAME for reliable navigation
      log("Deep link khong ho tro navigation truc tiep trong Teams v2. Su dung chat hien tai.");
    }

    // Wait for chat content to load
    await page.waitForTimeout(3_000);

    // ── Step 4: Extract messages ──
    const { channelName, messages } = await extractMessagesV2(page);

    // ── Step 5: Save output ──
    const output: Record<string, unknown> = {
      channel: channelName,
      extractedAt: new Date().toISOString(),
      totalMessages: messages.length,
      messages,
      groups: [{ id: "teams_extracted", name: channelName, type: "external" }],
    };

    // Merge with existing
    if (fs.existsSync(OUTPUT_FILE)) {
      try {
        const existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, "utf-8"));
        const existingIds = new Set(
          (existing.messages || []).map((m: { sender: string; content: string; timestamp: string }) =>
            `${m.sender}_${m.content.slice(0, 80)}_${m.timestamp}`
          )
        );
        const newMsgs = (messages as Array<{ sender: string; content: string; timestamp: string }>).filter(
          (m) => !existingIds.has(`${m.sender}_${m.content.slice(0, 80)}_${m.timestamp}`)
        );
        output.messages = [...(existing.messages || []), ...newMsgs];
        output.totalMessages = (output.messages as Array<unknown>).length;
        output.groups = existing.groups || output.groups;
        log(`Them ${newMsgs.length} tin nhan moi (tong: ${output.totalMessages})`);
      } catch { /* ghi de */ }
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), "utf-8");
    log(`Da luu ${output.totalMessages} tin nhan vao: ${OUTPUT_FILE}`);

    // Save session
    await context.storageState({ path: path.join(SESSION_DIR, "state.json") });
    log("Da luu session.");

    // Preview
    const msgs = output.messages as Array<{ sender: string; content: string; timestamp: string }>;
    console.log(`\n--- Preview (5 tin nhan moi nhat) ---`);
    for (const msg of msgs.slice(-5)) {
      console.log(`  [${msg.timestamp}] ${msg.sender}: ${msg.content.slice(0, 120)}`);
    }
    console.log("---\n");
    console.log(`PM Agent se tu dong doc file nay. Mo lai popup PM Agent de kiem tra.`);

  } catch (err) {
    log(`Loi: ${err}`);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, `error-${Date.now()}.png`) });
    log(`Da luu screenshot tai: ${SCREENSHOT_DIR}`);
  } finally {
    if (!isHeadless) {
      log("Dong browser sau 5s...");
      await page.waitForTimeout(5_000);
    }
    await context.close();
  }
}

main().catch(console.error);
