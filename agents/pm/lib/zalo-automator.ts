/**
 * Zalo Web Automator
 *
 * Uses Playwright with stealth anti-detection to automate Zalo Web (chat.zalo.me):
 * - Login session management (QR code login)
 * - Group chat navigation & message extraction
 * - Keyword monitoring
 *
 * Architecture mirrors teams-automator.ts for consistency.
 * This module is READ-ONLY — no message sending.
 *
 * Usage:
 *   a) CLI via `npx tsx agents/pm/scripts/zalo-automator.ts`
 *   b) API route via child_process.spawn
 *   c) From sync-all-projects.ts (shared browser context)
 *
 * Anti-detection: reuses stealth helpers from teams-automator
 */

import type { Page, BrowserContext, Browser } from "playwright";
import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";

// ─── Config ─────────────────────────────────────────────────

export interface ZaloAutomatorConfig {
  /** Directory to persist browser session (cookies, localStorage) */
  sessionDir: string;
  /** Output file for extracted messages */
  outputFile: string;
  /** Screenshot directory */
  screenshotDir: string;
  /** How many scrolls to load older messages */
  scrollCount: number;
  /** Pause between scrolls (ms) */
  scrollWaitMs: number;
  /** Timeout for login wait (ms) — user needs to scan QR */
  loginTimeoutMs: number;
  /** Whether to run headless (requires existing session) */
  headless: boolean;
  /** Group name to navigate to in sidebar */
  groupName?: string;
  /** Extra keywords to highlight during extraction */
  keywords?: string[];
  /** Keep browser open after extraction (non-headless only) */
  keepOpen?: boolean;
  /** Use real Chrome (with persistent profile) instead of bundled Chromium */
  useRealChrome?: boolean;
  /** Incremental sync watermark: stop scrolling once messages at/below this
   *  timestampMs are seen (they are already in the DB). Omit for full sync. */
  incrementalSince?: number;
}

export const DEFAULT_ZALO_CONFIG: ZaloAutomatorConfig = {
  sessionDir: path.join(process.cwd(), ".zalo-session"),
  outputFile: path.join(process.cwd(), "zalo-messages.json"),
  screenshotDir: path.join(process.cwd(), "zalo-screenshots"),
  scrollCount: 5,
  scrollWaitMs: 2_000,
  loginTimeoutMs: 120_000,
  headless: false,
};

// ─── Types ──────────────────────────────────────────────────

export interface ZaloExtractResult {
  groupName: string;
  groupUrl?: string;
  totalMessages: number;
  messages: ZaloExtractedMessage[];
  extractedAt: string;
}

export interface ZaloExtractedMessage {
  id: string;
  sender: string;
  content: string;
  images?: string[];
  senderAvatar?: string;
  timestamp: string;
  timestampMs?: number;
  /** Stable per-message id from the Zalo DOM (bb_msg_id_<epochMs>) */
  platformMsgId?: string;
  groupName: string;
  hasKeyword: boolean;
  matchedKeywords: string[];
  /** Quoted message text if this is a reply */
  quotedSender?: string;
  quotedContent?: string;
  /** True if this message was sent by the logged-in user */
  isMine?: boolean;
}

// ─── Logging ────────────────────────────────────────────────

export function log(msg: string, data?: unknown) {
  const prefix = `[ZaloAuto] ${new Date().toISOString().slice(11, 19)}`;
  if (data) {
    console.log(`${prefix}  ${msg}`, typeof data === "string" ? data : JSON.stringify(data).slice(0, 200));
  } else {
    console.log(`${prefix}  ${msg}`);
  }
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ─── Stealth Helpers ───────────────────────────────────────

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Patch page to avoid bot detection.
 * Overrides navigator.webdriver, adds chrome runtime, etc.
 */
export async function applyStealthPatches(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Remove webdriver property
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });

    // Add chrome runtime
    (window as any).chrome = {
      runtime: {},
      loadTimes: function () {},
      csi: function () {},
      app: {},
    };

    // Override permissions query
    const originalQuery = window.navigator.permissions.query.bind(window.navigator.permissions);
    window.navigator.permissions.query = (desc: any) =>
      desc.name === "notifications"
        ? Promise.resolve({ state: "denied", onchange: null } as any)
        : originalQuery(desc);

    // Override plugins array
    Object.defineProperty(navigator, "plugins", {
      get: () => [
        { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer" },
        { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai" },
        { name: "Native Client", filename: "internal-nacl-plugin" },
      ],
    });

    // Override languages
    Object.defineProperty(navigator, "languages", { get: () => ["vi", "en-US", "en"] });
  });

  // Randomize viewport slightly
  await page.setViewportSize({ width: randomInt(1250, 1280), height: randomInt(780, 800) });
}

// ─── Browser Helpers ────────────────────────────────────────

function getChromePath(): string {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return "google-chrome";
}

export async function createZaloStealthContext(config: ZaloAutomatorConfig): Promise<{
  browser: Browser;
  context: BrowserContext;
}> {
  ensureDir(config.sessionDir);
  ensureDir(config.screenshotDir);

  // ── CDP mode: connect to a REAL Chrome already running (opened manually) ──
  if (process.env.USE_CDP === "1" || process.env.USE_CDP === "true") {
    const port = Number(process.env.CDP_PORT || 9222);
    const cdpUrl = `http://127.0.0.1:${port}`;
    log(`CDP mode: connecting to real Chrome at ${cdpUrl}`);
    const browser = await chromium.connectOverCDP(cdpUrl);
    const context = browser.contexts()[0];
    if (!context) throw new Error("CDP browser has no default context.");

    context.on("page", (newPage) => {
      newPage.on("dialog", async (dialog) => {
        log("Phat hien dialog (tab moi): " + dialog.message().slice(0, 80));
        await dialog.dismiss().catch(() => {});
      });
    });

    // Do NOT close the user's Chrome when the automation finishes.
    const fakeBrowser = { close: async () => { log("CDP mode: giu Chrome that mo (khong dong)."); } } as Browser;

    return { browser: fakeBrowser, context };
  }

  if (config.useRealChrome) {
    const profileDir = path.join(config.sessionDir, "chrome-profile");
    ensureDir(profileDir);

    // Suppress "Restore pages?" crash bubble
    const prefsPath = path.join(profileDir, "Preferences");
    try {
      let prefs: any = {};
      if (fs.existsSync(prefsPath)) {
        prefs = JSON.parse(fs.readFileSync(prefsPath, "utf-8"));
      }
      prefs.browser = prefs.browser || {};
      prefs.browser.last_redirects_migration_startup_notice = true;
      prefs.session = prefs.session || {};
      prefs.session.exit_type = "Normal";
      prefs.profile = prefs.profile || {};
      prefs.profile.exited_cleanly = true;
      fs.writeFileSync(prefsPath, JSON.stringify(prefs, null, 2), "utf-8");
      log("Da ghi Preferences (suppress restore).");
    } catch (e) {
      log("Khong the ghi Preferences: " + e);
    }

    log(`Mo Chrome that voi persistent profile: ${profileDir}`);

    const persistentContext = await chromium.launchPersistentContext(profileDir, {
      channel: "chrome",
      headless: config.headless,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--window-size=1280,800",
        "--lang=vi-VN",
        // ── Suppress "Restore pages?" crash bubble ──
        "--disable-session-crashed-bubble",
        "--disable-restore-session-state",
        // ── Fix macOS headless cookie decryption issue ──
        "--password-store=basic",
        "--use-mock-keychain",
      ],
      viewport: null, // De window-size tu config hoat dong
      locale: "vi-VN",
      timezoneId: "Asia/Ho_Chi_Minh",
      bypassCSP: true,
      ignoreHTTPSErrors: true,
      colorScheme: "light",
    });

    const pages = persistentContext.pages();
    const page = pages.length > 0 ? pages[0] : await persistentContext.newPage();
    await applyStealthPatches(page);

    // Dismiss any browser dialogs automatically
    persistentContext.on("page", (newPage) => {
      newPage.on("dialog", async (dialog) => {
        log("Phat hien dialog (tab moi): " + dialog.message().slice(0, 80));
        await dialog.dismiss().catch(() => {});
      });
    });
    page.on("dialog", async (dialog) => {
      log("Phat hien dialog: " + dialog.message().slice(0, 80));
      await dialog.dismiss().catch(() => {});
    });

    // Wrap so runAutomation's browser.close() calls context.close()
    const fakeBrowser = { close: () => persistentContext.close() } as Browser;

    return { browser: fakeBrowser, context: persistentContext };
  }

  // Fallback: bundled Chromium
  log(`Khoi dong Playwright Chromium (headless=${config.headless})...`);

  const browser = await chromium.launch({
    headless: config.headless,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-infobars",
      "--disable-dev-shm-usage",
      "--window-size=1280,800",
      "--lang=vi",
    ],
  });

  const context = await browser.newContext({
    storageState: fs.existsSync(path.join(config.sessionDir, "state.json"))
      ? path.join(config.sessionDir, "state.json")
      : undefined,
    viewport: { width: 1280, height: 800 },
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    bypassCSP: true,
    ignoreHTTPSErrors: true,
    colorScheme: "light",
  });

  context.on("page", (newPage) => {
    newPage.on("dialog", async (dialog) => {
      log("Phat hien dialog (tab moi): " + dialog.message().slice(0, 80));
      await dialog.dismiss().catch(() => {});
    });
  });

  return { browser, context };
}

// ─── Login / Session ────────────────────────────────────────

/**
 * Wait for Zalo login to complete.
 * Zalo Web uses QR code login — user needs to scan with phone.
 * Returns true if login was needed and completed.
 */
export async function waitForZaloLogin(
  page: Page,
  config: ZaloAutomatorConfig
): Promise<boolean> {
  const url = page.url();

  // Check if already logged in by looking for main app selectors
  if (url.includes("chat.zalo.me")) {
    const isLoggedIn = await page
      .locator('#conversationListId, [data-id="conversations-list"], .conv-list, .chat-list, [class*="conversation-list"]')
      .first()
      .isVisible({ timeout: 8_000 })
      .catch(() => false);
    if (isLoggedIn) {
      log("Da co session Zalo, khong can dang nhap.");
      return false;
    }
  }

  // Check for QR code login page
  const hasQR = await page
    .locator('.login-qr, .qr-login, canvas[class*="qr"], img[class*="qr"], [data-translate-inner="STR_LOGIN_TITLE"]')
    .first()
    .isVisible({ timeout: 10_000 })
    .catch(() => false);

  if (hasQR || url.includes("chat.zalo.me") || url.includes("id.zalo.me")) {
    log("Can dang nhap Zalo. Vui long scan QR code trong cua so browser...");
    console.log("\n  >>> SCAN QR CODE DANG NHAP ZALO TRONG CUA SO VUA MO <<<\n");

    try {
      // Wait for conversation list to appear (sign of successful login)
      await page.waitForSelector(
        '#conversationListId, [data-id="conversations-list"], .conv-list, .chat-list, [class*="conversation-list"]',
        { timeout: config.loginTimeoutMs }
      );
      log("Dang nhap Zalo thanh cong!");
      // Wait extra for full load
      await page.waitForTimeout(5_000);
      return true;
    } catch {
      // Zalo login flow: id.zalo.me/account -> redirect to chat.zalo.me
      // The OLD code accepted id.zalo.me/account as "logged in" but that page
      // has NO chat UI — that's why the search box was never found.
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        const currentUrl = page.url();
        if (currentUrl.includes("chat.zalo.me") && !currentUrl.includes("login")) {
          const convVisible = await page
            .locator('#conversationListId, [data-id="conversations-list"], .conv-list, .chat-list, [class*="conversation-list"]')
            .first()
            .isVisible({ timeout: 8_000 })
            .catch(() => false);
          if (convVisible) {
            log("Dang nhap Zalo thanh cong (redirect + conv list)!");
            await page.waitForTimeout(3_000);
            return true;
          }
        }
        await page.waitForTimeout(3_000);
      }
      const currentUrl = page.url();
      log("Timeout dang nhap Zalo! URL: " + currentUrl.slice(0, 80));
      await page.screenshot({ path: path.join(config.screenshotDir, `login-timeout-${Date.now()}.png`) });
      throw new Error("Zalo login timed out. Please try again.");
    }
  }

  log("Khong can dang nhap Zalo.");
  return false;
}

/**
 * Navigate to Zalo Web homepage
 */
export async function navigateToZalo(
  page: Page,
  _config: ZaloAutomatorConfig
): Promise<void> {
  log("Dang mo Zalo Web...");
  await page.goto("https://chat.zalo.me", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(5_000);
  log(`URL: ${page.url()}`);
}

// ─── Group Navigation ────────────────────────────────────────

/**
 * Navigate to a specific group chat by clicking on it in the sidebar.
 * Handles scrolling and searching.
 */
export async function navigateToZaloGroup(
  page: Page,
  groupName: string
): Promise<boolean> {
  if (!groupName) return false;

  log(`Tim kiem nhom chat Zalo: "${groupName}" trong sidebar...`);

  // Helper: search and click the group item by text content
  async function tryClickGroup(name: string): Promise<string | null> {
    return page.evaluate((searchName: string) => {
      // Find all elements that might be conversation items
      const possibleItems = document.querySelectorAll(
        '[class*="conv-item"], [class*="conversation-item"], [class*="ChatItem"], [role="listitem"]'
      );
      
      let bestMatch: HTMLElement | null = null;
      let bestLen = Infinity;

      for (const item of Array.from(possibleItems)) {
        // Find the title element inside the item to avoid matching sender names in previews
        const titleEl = item.querySelector('[class*="name"], [class*="title"], .truncate');
        const textToMatch = titleEl ? titleEl.textContent?.trim() || "" : item.textContent?.trim() || "";
        
        if (textToMatch.toLowerCase().includes(searchName.toLowerCase()) && textToMatch.length < bestLen) {
          bestMatch = item as HTMLElement;
          bestLen = textToMatch.length;
        }
      }

      if (bestMatch) {
        bestMatch.click();
        const titleEl = bestMatch.querySelector('[class*="name"], [class*="title"], .truncate');
        return titleEl ? titleEl.textContent?.trim() || "clicked" : bestMatch.textContent?.trim().slice(0, 100) || "clicked";
      }
      return null;
    }, name);
  }

  // Attempt 1: Direct search in visible sidebar
  let found = await tryClickGroup(groupName);
  if (found) {
    log(`Da click vao nhom Zalo: "${found}"`);
    await page.waitForTimeout(3_000);
    return true;
  }

  // Attempt 2: Use Zalo's search box to find the group
  log("Nhom khong thay truc tiep, thu tim qua search...");
  try {
    const searchBox = page.locator(
      'input#contact-search-input, input[placeholder*="Tìm kiếm"], input[placeholder*="Search"], input[type="text"][class*="search"]'
    ).first();
    const searchVisible = await searchBox.isVisible({ timeout: 3_000 }).catch(() => false);

    if (searchVisible) {
      await searchBox.click();
      await page.waitForTimeout(500);
      await searchBox.fill(groupName);
      await page.waitForTimeout(3_000); // Wait for search results to populate

      // Click the search result
      found = await tryClickGroup(groupName);
      if (found) {
        log(`Da click vao nhom Zalo (sau search): "${found}"`);
        await page.waitForTimeout(3_000);
        
        // Clear search box by clicking a clear button or backspace
        const clearBtn = page.locator('[class*="clear-search"], [icon="close"]').first();
        if (await clearBtn.isVisible().catch(() => false)) {
          await clearBtn.click();
        } else {
          await searchBox.fill("");
        }
        await page.waitForTimeout(1000);
        return true;
      }

      // Clear search if not found
      await searchBox.fill("");
      await page.waitForTimeout(500);
    }
  } catch {
    log("Khong the su dung search box.");
  }

  // Attempt 3: Scroll the sidebar
  log("Thu scroll sidebar...");
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => {
      const sidebar = document.querySelector(
        '#conversationListId, [data-id="conversations-list"], .conv-list, .chat-list, [class*="ReactVirtualized__Grid"]'
      );
      if (sidebar) {
        (sidebar as HTMLElement).scrollTop += 500;
      }
    });
    await page.waitForTimeout(1_500);

    found = await tryClickGroup(groupName);
    if (found) {
      log(`Da click vao nhom Zalo (sau scroll): "${found}"`);
      await page.waitForTimeout(3_000);
      return true;
    }
  }

  log(`Khong tim thay nhom Zalo "${groupName}" trong sidebar.`);
  await page.screenshot({ path: path.join(DEFAULT_ZALO_CONFIG.screenshotDir, `not-found-${Date.now()}.png`) });
  return false;
}

/**
 * Capture the current Zalo group URL from the SPA.
 * Zalo Web uses hash routing: https://chat.zalo.me/#/g/{groupId}
 * (or #/z/{userId} for 1:1 chats). Returns the hash-based URL when
 * a conversation is open, otherwise undefined.
 */
export async function getGroupUrl(page: Page): Promise<string | undefined> {
  try {
    const raw = page.url();
    if (!raw || raw.includes("login") || raw.includes("account")) return undefined;
    return raw;
  } catch {
    return undefined;
  }
}

// ─── Scrolling & Extraction ──────────────────────────────────

/**
 * Scroll chat container to load older messages.
 * Zalo Web loads messages lazily on scroll up.
 */
export async function scrollZaloChatContainer(page: Page, config: ZaloAutomatorConfig): Promise<void> {
  log(`Dang scroll len de load tin nhan cu hon (${config.scrollCount} lan)...`);

  // Find the REAL scroll container of the MESSAGE LIST (not the sidebar!):
  // #messageViewContainer > .transform-gpu (overflow: scroll) > #messageViewScroll
  // The sidebar's #conversationList is a DIFFERENT ReactVirtualized list and must
  // NOT be used — scrolling it does nothing for the chat messages.
  const getScrollContainer = (): HTMLElement => {
    const scrollInner = document.querySelector<HTMLElement>('#messageViewScroll');
    if (scrollInner) {
      let el = scrollInner.parentElement;
      while (el && el.scrollHeight <= el.clientHeight + 1) {
        el = el.parentElement;
      }
      if (el && el.scrollHeight > el.clientHeight) return el;
    }
    return (
      document.querySelector<HTMLElement>('#messageViewContainer') ||
      document.querySelector<HTMLElement>('[class*="message-view"]') ||
      document.querySelector<HTMLElement>('[class*="chat-body"]') ||
      document.querySelector<HTMLElement>('[class*="chat_body"]') ||
      document.querySelector<HTMLElement>('[class*="MessageView"]') ||
      document.querySelector<HTMLElement>('[class*="conversation-chat"]') ||
      document.documentElement
    );
  };

  // Ensure we start at the bottom so the latest messages are loaded first
  await page.evaluate(`
    const __getZaloScrollContainer = ${getScrollContainer.toString()};
    (function() {
      const container = __getZaloScrollContainer();
      container.scrollTop = container.scrollHeight;
    })();
  `);
  await page.waitForTimeout(1500);

  for (let i = 0; i < config.scrollCount; i++) {
    await page.evaluate(`
      const __getZaloScrollContainer = ${getScrollContainer.toString()};
      (function() {
        const container = __getZaloScrollContainer();
        // Progressive scroll up by ~80% of viewport height each step.
        // This loads older messages incrementally instead of jumping to top.
        const vh = container.clientHeight || window.innerHeight;
        container.scrollBy({ top: -Math.round(vh * 0.8) });
      })();
    `);

    await page.waitForTimeout(config.scrollWaitMs + randomInt(500, 1500));

    // Incremental early-stop: if the newest bubble still visible in the DOM is
    // at/below the DB watermark, everything older is already stored — stop.
    if (config.incrementalSince !== undefined && config.incrementalSince > 0) {
      const maxVisibleTs = await page.evaluate(() => {
        let maxTs = -1;
        document.querySelectorAll<HTMLElement>('[id^="bb_msg_id_"]').forEach((el) => {
          const m = (el.id || "").match(/bb_msg_id_(\d+)/);
          if (m) {
            const ts = parseInt(m[1], 10);
            if (ts > maxTs) maxTs = ts;
          }
        });
        return maxTs;
      });
      if (maxVisibleTs > 0 && maxVisibleTs <= config.incrementalSince) {
        log(`[Incremental] EARLY-STOP at scroll ${i + 1}: max visible timestamp ${maxVisibleTs} <= watermark ${config.incrementalSince}`);
        break;
      }
    }
    if (i % 10 === 9) log(`  Scroll ${i + 1}/${config.scrollCount}`);
  }

  // Final scroll to top to ensure oldest messages are loaded
  await page.evaluate(`
    const __getZaloScrollContainer = ${getScrollContainer.toString()};
    (function() {
      const container = __getZaloScrollContainer();
      container.scrollTop = 0;
    })();
  `);
  await page.waitForTimeout(2_000);

  // Kick lazy loading on all images with a small nudge (down then back up).
  // We do NOT scroll all the way to the bottom — that would unload the old
  // messages from ReactVirtualized's DOM and we'd lose them for extraction.
  // (In incremental mode we skip this: the oldest already-synced messages
  // were just reached, and bottom-nudging may recycle them anyway.)
  if (config.incrementalSince === undefined || config.incrementalSince <= 0) {
    await page.evaluate(`
      const __getZaloScrollContainer = ${getScrollContainer.toString()};
      (function() {
        const container = __getZaloScrollContainer();
        const pos = container.scrollTop;
        container.scrollBy({ top: 120 });
        container.scrollBy({ top: -120 });
        container.scrollTop = pos;
        document.querySelectorAll('img').forEach(img => {
          img.scrollIntoView({ block: "center", inline: "nearest" });
        });
        container.scrollTop = pos;
      })();
    `);
    await page.waitForTimeout(4_000);
  } else {
    log(`[Incremental] Skipped bottom-nudge (incremental mode)`);
  }
}

/**
 * Extract messages from the current Zalo group chat.
 * Uses multiple selector strategies for robustness across Zalo Web versions.
 */
export async function extractZaloMessages(page: Page, config: ZaloAutomatorConfig): Promise<ZaloExtractResult> {
  log("Dang trich xuat tin nhan Zalo...");

  // Take debug screenshot first (only when DEBUG_SCRIPTS=1 to avoid junk files)
  if (process.env.DEBUG_SCRIPTS === "1") {
    await page.screenshot({ path: path.join(config.screenshotDir, `pre-extract-${Date.now()}.png`) });
  }

  // Wait for messages to render
  try {
    await page.waitForSelector(
      '[class*="message-wrapper"], [class*="chat-message"], [class*="msg-item"], [class*="message-item"], [class*="ChatMessage"], [class*="msg_item"], [class*="text-message"]',
      { timeout: 15_000 }
    );
    log("Da tim thay message pane.");
  } catch {
    log("Khong tim thay message pane. Se thu tim bang text.");
    if (process.env.DEBUG_SCRIPTS === "1") {
      await page.screenshot({ path: path.join(config.screenshotDir, `debug-no-messages-${Date.now()}.png`) });
    }
  }
  
  // Get group name from the chat header (more reliable if we are actually in a chat)
  const groupNameFromPage = await page.evaluate(() => {
    const headerEl =
      document.querySelector<HTMLElement>('.chat-info .title') ||
      document.querySelector<HTMLElement>('header [class*="name"]') ||
      document.querySelector<HTMLElement>('[class*="chat-name"]') ||
      document.querySelector<HTMLElement>('[class*="conv-name"]') ||
      document.querySelector<HTMLElement>('[class*="header-info"] [class*="name"]');
    return headerEl?.textContent?.trim() || "";
  });

  const displayGroupName = config.groupName || groupNameFromPage || "Zalo Group";
  log(`Group: ${displayGroupName}`);

  // Extract messages via Zalo Web DOM selectors
  await page.addScriptTag({ content: `
    window.blobToBase64 = async function(url) {
      // Strategy: canvas FIRST (more reliable for already-rendered <img> elements)
      try {
        const imgEl = Array.from(document.querySelectorAll('img')).find(img => img.src === url);
        if (imgEl && imgEl.complete && imgEl.naturalWidth > 0 && imgEl.naturalHeight > 0) {
          try { imgEl.crossOrigin = 'anonymous'; } catch (e) { /* ignore */ }
          const canvas = document.createElement('canvas');
          canvas.width = imgEl.naturalWidth;
          canvas.height = imgEl.naturalHeight;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(imgEl, 0, 0);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
            if (dataUrl && dataUrl.length > 100) return dataUrl;
          }
        }
      } catch (e) {
        // Canvas failed — try fetch
      }
      // Method 2: Try fetch() for active blobs
      try {
        const res = await fetch(url, { credentials: 'include' });
        const blob = await res.blob();
        return await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        });
      } catch (e) {
        return null;
      }
    }
  ` });
  
  const fs = require('fs');
  if (process.env.DEBUG_SCRIPTS === "1") {
    fs.writeFileSync('zalo-dom.html', await page.content());
  }
  
  const extractedMessages: { messages: ZaloExtractedMessage[]; htmlDump: string } = 
  await page.evaluate(async (args: { kwList: string[]; groupName: string; imgBlocklist: string[] }) => {
    const results: ZaloExtractedMessage[] = [];
    let counter = 0;
    const seen = new Set<string>();
    // Zalo Renders chat messages inside #messageViewContainer or .message-view__scroll
    // The actual message area is scoped to the chat view, NOT the entire document.
    // Avoid falling back to document because that picks up sidebar conversation items.
    const chatView = document.querySelector('#chatView, article.rel') ||
        document.querySelector('#messageViewContainer, .message-view__scroll, [class*="message-view"]');
    const chatArea = chatView
        ? (chatView.querySelector('#messageViewContainer') ||
           chatView.querySelector('.message-view__scroll, .message-view__scroll__inner') ||
           chatView.querySelector('[class*="message-view"]'))
        : (document.querySelector('#messageViewContainer') ||
           document.querySelector('.message-view__scroll, .message-view__scroll__inner') ||
           document.querySelector('[class*="message-view"]'));
    
    if (!chatArea) {
      console.log("WARNING: Could not find chat message area, returning empty.");
      return { messages: [], htmlDump: "" };
    }

    console.log("CHAT AREA CLASSES:", (chatArea as HTMLElement).className || "");
    console.log("CHAT AREA ID:", (chatArea as HTMLElement).id || "");
    const htmlToLog = ((chatArea as HTMLElement).innerHTML || (chatArea as any).body?.innerHTML || "");
    console.log("FIRST 500 CHARS:", htmlToLog.substring(0, 500));

    // Search ONLY inside the chat area scoped to messages
    // Zalo actual message classes: message-content-wrapper, message-wrapper, text-message__container
    // Avoid: conv-item, msg-item (sidebar), z-conv-message (sidebar previews)
    const possibleMsgs = Array.from(chatArea.querySelectorAll<HTMLElement>(
      '[class*="message-content-wrapper"], [class*="message-wrapper"], ' +
      '[class*="message-frame"], .text-message__container, ' +
      '[class*="chat-message"], [class*="ChatMessage"], [data-component="message-content-view"]'
    )).filter(el => {
      const cls = el.className || '';
      // Exclude sidebar / nav / conversation list items
      if (el.closest('.leftbar, .nav, [class*="sidebar"], [class*="contact-list"], ' +
            '#nav-container, .nav__tabs, [class*="conv-item"], [class*="conversation-list"], ' +
            '.conv-list')) return false;
      // Exclude elements that clearly belong to sidebar
      if (cls.includes('conv-item') || cls.includes('conversation-item') || 
          cls.includes('z-conv-message') || cls.includes('preview')) return false;
      return true;
    });
    
    // Deduplicate: only keep outermost wrappers (message-content-wrapper or message-wrapper)
    // Prefer wrapper elements over inner content containers
    const wrapperSet = new Set<HTMLElement>();
    for (const el of possibleMsgs) {
      // If this element has a parent that's also in the set, skip it (keep outermost)
      let parent = el.parentElement;
      let hasParentInSet = false;
      while (parent) {
        if (possibleMsgs.includes(parent as any)) {
          hasParentInSet = true;
          break;
        }
        parent = parent.parentElement;
      }
      if (!hasParentInSet) {
        wrapperSet.add(el);
      }
    }
    const wrappers = Array.from(wrapperSet);
    
    console.log("Found " + possibleMsgs.length + " possible msg elements, " + wrappers.length + " unique wrappers");
    let lastSender = "";
    let lastSenderAvatar = "";
    const htmlDump = wrappers.length > 0 ? wrappers[0].outerHTML : "";
    
    for (const el of wrappers) {
      // Zalo sender: .message-sender-name-content > div.truncate
      // IMPORTANT: never fall back to .message-sender-name-wrapper — its
      // innerText includes the hidden "a" letter Zalo injects in
      // <div class="opacity-0">a</div>, producing senders like "a\nTrần Anh Giàu".
      let sender =
        el.querySelector<HTMLElement>('.message-sender-name-content .truncate')?.innerText?.trim() ||
        el.querySelector<HTMLElement>('.message-sender-name-content')?.innerText?.trim() ||
        el.querySelector<HTMLElement>('.card-sender-name')?.innerText?.trim() ||
        el.querySelector<HTMLElement>('.sender-name')?.innerText?.trim() ||
        el.querySelector<HTMLElement>('.chat-message__sender')?.innerText?.trim() ||
        el.querySelector<HTMLElement>('[data-translate-inner="STR_SENDER_NAME"]')?.innerText?.trim() || "";
      const wrapperClass = el.className || "";
      // Zalo marks own messages with an independent "me" class token on the wrapper
      // (e.g. "chat-message chat-message-v2 wrap-message rotate-container me -send-time").
      // IMPORTANT: only match whole tokens — "chat-message" contains "-me" as a substring
      // but is NOT a sent message, so `includes("-me")` would mislabel every message as mine.
      const isMine = /(^|\s)(me|mine|my|owner|self)($|\s)/i.test(wrapperClass) ||
        wrapperClass.toLowerCase().includes("-right") ||
        /(^|\s)(me|mine|my|owner|self)($|\s)/i.test(el.querySelector('.message-wrapper')?.className || "") ||
        !!el.querySelector('[data-id="btn_SentMsg_React"], [data-id="div_SentMsg_Text"]');
      
      if (isMine) {
        sender = "Me";
      }
      
      if (!sender && !lastSender) {
        sender = "Unknown";
      }
      // Zalo renders sender avatars inside the *chat-item* parent of the
      // message wrapper, NOT inside the wrapper itself:
      //   <div class="chat-item ..."><div class="rel zavatar-container avatar--overlay absolute">
      //     <div class="zavatar ..."><img class="a-child" src="https://s*-ava-talk.zadn.vn/..."></div>
      //   </div><div class="chat-content ...">...message...</div></div>
      // So we walk up to the nearest .chat-item and look for the avatar there.
      let senderAvatar = "";
      const chatItem = el.closest<HTMLElement>('.chat-item');
      const avatarScope = chatItem || el;
      const avatarImg = avatarScope.querySelector<HTMLImageElement>(
        '.zavatar-container img, [class*="zavatar-container"] img, .avatar--overlay img, [class*="zavatar"] img'
      );
      if (avatarImg) {
        senderAvatar = avatarImg.getAttribute('src') || avatarImg.getAttribute('data-src') || "";
      }

      if (!sender && lastSender) {
        sender = lastSender;
      } else if (sender) {
        lastSender = sender;
      }

      if (!senderAvatar && lastSenderAvatar && sender === lastSender) {
        senderAvatar = lastSenderAvatar;
      } else if (senderAvatar) {
        lastSenderAvatar = senderAvatar;
      }

      // Zalo timestamp: .card-send-time__sendTime inside .card-send-time
      // (only the first message of each group carries the time element)
      const timeEl = el.querySelector<HTMLElement>('.card-send-time, .msg-time, .card-send-time__sendTime, .card-send-time [class*="sendTime"], [class*="sendTime"]');
      const timestampText = timeEl?.textContent?.trim() || "";

      // Zalo message id: every bubble carries a stable server id in its own
      // id attribute ("bb_msg_id_<epochMs>"). This is the only reliable,
      // per-message dedup key for Zalo — display timestamps repeat across
      // messages and image-only messages have no text, so sender+time+text
      // based messageIds collide and overwrite each other on re-sync.
      const msgIdMatch = (el.id || "").match(/bb_msg_id_(\d+)/) ||
        (el.getAttribute("data-id") || "").match(/(\d{13})/);
      const platformMsgId = msgIdMatch ? msgIdMatch[1] : undefined;
      // Use the real epoch ms from the bubble id as timestampMs. This is the
      // actual message time — unlike the HH:MM label it is unique per message
      // and stable across syncs, so messageId based dedup works correctly.
      const tsMs = platformMsgId ? parseInt(platformMsgId, 10) : undefined;

      // === Extract quoted message (reply/quote) ===
      // Zalo structure: .message-quote-fragment__container
      // - .message-quote-fragment__title/.quote-name → quoted sender
      // - .message-quote-fragment__description → quoted content
      const quoteEl = el.querySelector<HTMLElement>('.message-quote-fragment__container');
      let quotedSender = "";
      let quotedContent = "";
      if (quoteEl) {
        const qNameEl = quoteEl.querySelector<HTMLElement>('.quote-name, .message-quote-fragment__title');
        if (qNameEl) {
          quotedSender = qNameEl.textContent?.trim() || "";
        }
        const qDescEl = quoteEl.querySelector<HTMLElement>('.message-quote-fragment__description');
        if (qDescEl) {
          quotedContent = qDescEl.textContent?.trim() || "";
        }
      }

      // === Extract main message content ===
      // Try the text container first
      let content = "";
      let contentSource: string[] = [];
      
      // Get text from the message content (not quote, not sender name, not timestamps)
      // Strategy: clone, remove quote fragment, remove sender, remove timestamp/reaction, then get text
      const clone = el.cloneNode(true) as HTMLElement;
      
      // Remove items we don't want in content.
      // IMPORTANT: do NOT remove .img-msg-v2__cap — that element carries the
      // caption TEXT of image messages ("Ảnh đính kèm + mô tả"). Removing it
      // made image messages lose their text (stored as empty content).
      // We only strip the sticker element (.img-msg-v2__st) and the image
      // container (.photo-message-v2) — images are captured separately.
      // .opacity-0 holds a hidden "a" letter Zalo injects for avatar layout —
      // it must not leak into the message text.
      // .card-send-time__sendTime may sit outside .card-send-time (as a
      // sibling of the reaction container), so remove it explicitly to keep
      // timestamps out of the content.
      clone.querySelectorAll(
        '.message-sender-name-wrapper, .message-sender-name-content, .card-send-time, ' +
        '.card-send-time__sendTime, .message-reaction-container, .message-reaction-v2-space, ' +
        '.message-quote-fragment__container, .bubble-message-time, ' +
        '.card-sender-name, .msg-sender, .avatar, ' +
        '.message-reaction-container, .message-reaction-v2-space, ' +
        '.img-msg-v2__st, .photo-message-v2, .opacity-0'
      ).forEach(e => e.remove());

      // Remove reaction button and icon images
      clone.querySelectorAll('[data-id="btn_SentMsg_React"], [data-id="btn_ReceivedMsg_React"], .msg-reaction-icon, .react-icon').forEach(e => e.remove());
      
      // Now get text from the clone
      content = clone.textContent?.trim().replace(/\s{2,}/g, " ") || "";

      // If clone text is empty, try the text-message__container directly
      if (!content) {
        const textContainer = el.querySelector<HTMLElement>('.text-message__container, [data-component="message-text-content"]');
        if (textContainer) {
          content = textContainer.textContent?.trim() || "";
        }
      }

      // Build final content: format quoted message + main content
      let finalContent = content;
      if (quotedSender && quotedContent) {
        // Format: "> Sender: quoted text\nmain text"
        finalContent = `> ${quotedSender}: ${quotedContent}\n${content}`;
      }

      // === Extract images ===
      const images: string[] = [];
      const imgCandidates: string[] = [];
      const seenUrls = new Set<string>();

      el.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
        const w = img.naturalWidth || parseInt(img.getAttribute('width') || '0');
        const h = img.naturalHeight || parseInt(img.getAttribute('height') || '0');
        if (w > 0 && w <= 28 && h > 0 && h <= 28) return;

        const candidates = [
          img.getAttribute('src'),
          img.getAttribute('data-src'),
          img.getAttribute('data-url'),
          img.getAttribute('data-src-url'),
          img.getAttribute('data-original'),
          img.getAttribute('data-image-url')
        ];
        
        for (const c of candidates) {
          if (c && (c.startsWith('blob:') || c.startsWith('http://') || c.startsWith('https://') || c.startsWith('//') || c.startsWith('data:'))) {
            const lowerUrl = c.toLowerCase();
            const blocked = args.imgBlocklist.some((pattern: string) => lowerUrl.includes(pattern));
            if (blocked) continue;
            
            const normalized = c.startsWith('//') ? 'https:' + c : c;
            if (!seenUrls.has(normalized)) {
              seenUrls.add(normalized);
              imgCandidates.push(normalized);
            }
          }
        }
      });

      for (const normalizedSrc of imgCandidates) {
        if (senderAvatar && (normalizedSrc === senderAvatar || normalizedSrc === 'https:' + senderAvatar.replace(/^https?:\/\//, '//'))) continue;
        
        const lowerUrl = normalizedSrc.toLowerCase();
        if (args.imgBlocklist.some((pattern: string) => lowerUrl.includes(pattern))) continue;

        let finalUrl = normalizedSrc;
        if (finalUrl.startsWith('blob:')) {
            finalUrl = await (window as any).blobToBase64(finalUrl);
        }
        // Only keep valid URL strings (blobToBase64 may return null on failure)
        if (finalUrl && typeof finalUrl === 'string' &&
            (finalUrl.startsWith('data:') || finalUrl.startsWith('http://') || finalUrl.startsWith('https://') || finalUrl.startsWith('//')) &&
            !images.includes(finalUrl)) {
          images.push(finalUrl);
        }
      }

      const anchorEls = Array.from(el.querySelectorAll<HTMLAnchorElement>('a[href]'));
      for (const a of anchorEls) {
        const href = a.getAttribute('href');
        if (!href) continue;
        if (!href.startsWith('blob:') && !href.startsWith('http://') && !href.startsWith('https://') && !href.startsWith('//') && !href.startsWith('data:')) continue;
        
        const lowerHref = href.toLowerCase();
        if (args.imgBlocklist.some((pattern: string) => lowerHref.includes(pattern))) continue;
        
        let normalizedHref = href.startsWith('//') ? 'https:' + href : href;
        if (normalizedHref.startsWith('blob:')) {
            normalizedHref = await (window as any).blobToBase64(normalizedHref);
            if (normalizedHref && typeof normalizedHref === 'string' &&
                (normalizedHref.startsWith('data:') || normalizedHref.startsWith('http://') || normalizedHref.startsWith('https://')) &&
                !images.includes(normalizedHref)) images.push(normalizedHref);
        } else if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(normalizedHref)) {
          if (!images.includes(normalizedHref)) images.push(normalizedHref);
        }
        
        const childImg = a.querySelector<HTMLImageElement>('img');
        if (childImg) {
          const childSrc = childImg.getAttribute('src') || childImg.getAttribute('data-src');
          if (childSrc) {
            const lowerChildSrc = childSrc.toLowerCase();            const blocked = args.imgBlocklist.some((pattern: string) => lowerChildSrc.includes(pattern));
            if (!blocked && !images.includes(childSrc)) {
              let finalChildSrc = childSrc.startsWith('//') ? 'https:' + childSrc : childSrc;
              if (finalChildSrc.startsWith('blob:')) {
                  finalChildSrc = await (window as any).blobToBase64(finalChildSrc);
              }
              if (finalChildSrc && typeof finalChildSrc === 'string' &&
                  (finalChildSrc.startsWith('data:') || finalChildSrc.startsWith('http://') || finalChildSrc.startsWith('https://')) &&
                  !images.includes(finalChildSrc)) {
                images.push(finalChildSrc);
              }
            }
          }
        }
      }

      const bgEls = Array.from(el.querySelectorAll<HTMLElement>('[style*="background-image"], [style*="background"]'));
      for (const el_ of bgEls) {
        const match = el_.getAttribute('style')?.match(/url\(["']?([^"')]+)["']?\)/);
        if (match && match[1]) {
          const lowerUrl = match[1].toLowerCase();
          const blocked = args.imgBlocklist.some((pattern: string) => lowerUrl.includes(pattern));
          if (!blocked && !images.includes(match[1])) {
            let bgUrl = match[1].startsWith('//') ? 'https:' + match[1] : match[1];
            if (bgUrl.startsWith('blob:')) {
                bgUrl = await (window as any).blobToBase64(bgUrl);
            }
            if (bgUrl && typeof bgUrl === 'string' &&
                (bgUrl.startsWith('data:') || bgUrl.startsWith('http://') || bgUrl.startsWith('https://')) &&
                !images.includes(bgUrl)) {
              images.push(bgUrl);
            }
          }
        }
      }

      if ((!finalContent && images.length === 0) || !sender) continue;

      const key = `${sender}|${finalContent.slice(0, 80)}|${images.join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const matchedKeywords = args.kwList.filter((kw) =>
        finalContent.toLowerCase().includes(kw.toLowerCase())
      );

      counter++;
      const msgObj: any = {
        id: platformMsgId ? `zalo_${platformMsgId}` : `zalo_${counter}_${Date.now()}`,
        sender,
        content: finalContent,
        images: images.length > 0 ? images : undefined,
        senderAvatar: senderAvatar || undefined,
        timestamp: timestampText,
        // Real epoch ms from the bubble id (bb_msg_id_<epochMs>), when
        // available. Falls back to undefined — never Date.now(), which made
        // messageId change on every sync and duplicated every row.
        timestampMs: tsMs,
        platformMsgId,
        groupName: args.groupName,
        hasKeyword: matchedKeywords.length > 0,
        matchedKeywords: matchedKeywords,
        isMine: isMine || undefined,
      };
      // Include quoted fields if present
      if (quotedSender && quotedContent) {
        msgObj.quotedSender = quotedSender;
        msgObj.quotedContent = quotedContent;
      }
      results.push(msgObj);
    }

    return { 
      messages: results,
      htmlDump
    };
  }, { 
    kwList: config.keywords || [], 
    groupName: displayGroupName,
    imgBlocklist: [
      'iconlike',
      'icon-like',
      'emoji-md',
      'emoji-',
      'ava-talk',
      'ava-grp',
      'ava-'
    ]
  });

  console.log("FIRST MSG HTML:", extractedMessages.htmlDump.substring(0, 3000));
  const messagesArray = extractedMessages.messages;

  // ── Hydrate sender avatars ──
  // Zalo avatar URLs (s*-ava-talk.zadn.vn) require the session cookies and are
  // blocked by CORS for in-page fetch, and return 403 for cookie-less server
  // fetches. Downloading them via page.request (Node-side, shares the browser
  // context cookies) succeeds, so we convert avatars to base64 data URLs which
  // never expire and render directly in the app.
  const avatarUrls = [...new Set(messagesArray.map((m) => (m as any).senderAvatar).filter((u): u is string => typeof u === 'string' && u.length > 0))];
  if (avatarUrls.length > 0) {
    log(`Hydrating ${avatarUrls.length} unique Zalo avatars via context cookies...`);
    const avatarCache = new Map<string, string>();
    for (const url of avatarUrls) {
      try {
        const resp = await page.request.get(url, { timeout: 15_000 });
        if (!resp.ok()) {
          log(`  avatar ${resp.status()}: ${url.slice(0, 80)}`);
          continue;
        }
        const buf = await resp.body();
        const mime = resp.headers()["content-type"]?.split(";")[0]?.trim() || "image/jpeg";
        if (buf.length < 100) continue;
        avatarCache.set(url, `data:${mime};base64,${buf.toString("base64")}`);
      } catch (e) {
        log(`  avatar fetch error: ${String(e).slice(0, 80)}`);
      }
    }
    let hydrated = 0;
    for (const m of messagesArray) {
      const av = (m as any).senderAvatar;
      if (av && avatarCache.has(av)) {
        (m as any).senderAvatar = avatarCache.get(av);
        hydrated++;
      }
    }
    log(`Hydrated ${hydrated} Zalo avatars (${avatarCache.size} unique).`);
  }

  log(`Trich xuat duoc ${messagesArray.length} tin nhan Zalo.`);

  messagesArray.sort((a, b) => (a.timestampMs ?? 0) - (b.timestampMs ?? 0));

  const groupUrl = await getGroupUrl(page);

  const result: ZaloExtractResult = {
    groupName: displayGroupName,
    groupUrl,
    totalMessages: messagesArray.length,
    messages: messagesArray,
    extractedAt: new Date().toISOString(),
  };

  mergeZaloOutput(result, config);

  return result;
}

function mergeZaloOutput(result: ZaloExtractResult, config: ZaloAutomatorConfig) {
  let existing: ZaloExtractResult | null = null;
  try {
    if (fs.existsSync(config.outputFile)) {
      existing = JSON.parse(fs.readFileSync(config.outputFile, "utf-8"));
    }
  } catch { /* ignore */ }

  // Dedup by sender + content snippet + timestamp
  const existingKeys = new Set(
    (existing?.messages || []).map((m) => `${m.sender}|${m.content.slice(0, 100)}|${m.timestamp}`)
  );
  const newMsgs = result.messages.filter(
    (m) => !existingKeys.has(`${m.sender}|${m.content.slice(0, 100)}|${m.timestamp}`)
  );

  const mergedMessages = [...(existing?.messages || []), ...newMsgs];
  const output = {
    ...result,
    messages: mergedMessages,
    totalMessages: mergedMessages.length,
  };

  fs.writeFileSync(config.outputFile, JSON.stringify(output, null, 2), "utf-8");
  log(`Da luu ${output.totalMessages} tin nhan Zalo vao ${config.outputFile} (them ${newMsgs.length} moi).`);
}

// ─── Send Message ────────────────────────────────────────────

export interface ZaloSendResult {
  ok: boolean;
  error?: string;
  /** Name of the chat the message was sent to (verified) */
  targetChat?: string;
  /** True if only composed without actually sending */
  dryRun?: boolean;
  /** Message count in the chat after send attempt */
  msgCount?: number;
  /** Screenshot path if taken */
  screenshot?: string;
  /** Current URL hash */
  urlHash?: string;
}

export interface ZaloSendOptions {
  /** Exact chat name to send to (e.g. "Thảo Nguyên BB") */
  chatName: string;
  /** Message text to send */
  message: string;
  /** If true, compose the message but do NOT press Enter */
  dryRun?: boolean;
  /** Take before/after screenshots */
  screenshots?: boolean;
  /** Milliseconds to wait after opening chat before verifying header */
  openWaitMs?: number;
}

/**
 * Verify the open chat matches the expected name.
 * Safety-critical: verifies that the sidebar item with the EXACT target name
 * is visually selected AND no other chat is selected.
 * Returns { verified, headerName, msgCount, reason }.
 */
async function verifyOpenChat(page: Page, expectedName: string): Promise<{
  verified: boolean;
  headerName: string | null;
  msgCount: number;
  reason?: string;
}> {
  const msgCount = await page.evaluate(() => {
    return document.querySelectorAll(
      '#messageViewContainer [class*="message-wrapper"], ' +
      '#messageViewContainer [class*="message-content-wrapper"]'
    ).length;
  });

  // The open chat in the sidebar: find the item with the EXACT target name
  // and check it has the "selected" class. This is the most reliable signal
  // on Zalo Web — the chat header name is not always rendered in the DOM.
  const selectedState = await page.evaluate((target: string) => {
    const items = document.querySelectorAll('[class*="conv-item"], [role="listitem"]');
    let targetSelected = false;
    let otherSelected: string | null = null;
    for (const item of items) {
      const titleEl = item.querySelector('[class*="conv-item-title__name"], [class*="name"], .truncate');
      const text = (titleEl?.textContent || item.textContent || '').trim().replace(/\u00a0/g, ' ');
      const firstLine = text.split('\n')[0].trim();
      const cls = (item.className || '').toString();
      const isSelected = cls.includes('selected') || cls.includes('--active') || (item as HTMLElement).getAttribute('aria-selected') === 'true';
      if (firstLine.toLowerCase() === target.toLowerCase()) {
        if (isSelected) targetSelected = true;
      } else if (isSelected) {
        otherSelected = firstLine || null;
      }
    }
    return { targetSelected, otherSelected };
  }, expectedName);

  if (selectedState.targetSelected && !selectedState.otherSelected) {
    return { verified: true, headerName: null, msgCount, reason: 'sidebar-selected-exact' };
  }
  if (selectedState.otherSelected) {
    return {
      verified: false,
      headerName: null,
      msgCount,
      reason: `WRONG CHAT SELECTED: "${selectedState.otherSelected}" — aborting send`,
    };
  }
  return {
    verified: false,
    headerName: null,
    msgCount,
    reason: `target chat not selected in sidebar (msgCount=${msgCount})`,
  };
}

/**
 * Send a text message to a Zalo chat.
 *
 * SAFETY: this function NEVER sends without verifying the target chat.
 * - Opens the chat by searching the sidebar for the EXACT name
 * - Verifies the sidebar item with that EXACT name is the one selected
 * - Types into #richInput and presses Enter (Zalo Web's send mechanism)
 * - In dryRun mode, types the message then clears it WITHOUT pressing Enter
 */
export async function sendZaloMessage(
  page: Page,
  options: ZaloSendOptions
): Promise<ZaloSendResult> {
  const { chatName, message, dryRun, screenshots, openWaitMs = 3_500 } = options;

  if (!chatName?.trim()) return { ok: false, error: "chatName is required" };
  if (!message?.trim()) return { ok: false, error: "message is required" };
  if (message.length > 2000) return { ok: false, error: "message too long (max 2000 chars)" };

  const shotDir = path.join(process.cwd(), "zalo-screenshots");
  if (screenshots) ensureDir(shotDir);
  const stamp = Date.now();

  // ── 1. Open the target chat via sidebar search ──────────────
  log(`Mo chat "${chatName}" qua search...`);
  // Zalo Web input can have various selectors; try the classic ones first
  // then fall back to ANY visible input in the left panel (some Zalo UI
  // versions only expose the search input after clicking the search icon).
  const searchBox = page.locator(
    '#contact-search-input, input[data-id="txt_Main_Search"], input[placeholder*="Tìm kiếm"], input[placeholder*="Tim kiem"], input[placeholder*="Tìm bạn bè, tin nhắn"], [data-testid="search-input"]'
  ).first();
  let searchVisible = await searchBox.isVisible({ timeout: 3_000 }).catch(() => false);

  if (!searchVisible) {
    // Look for the search icon/toolbar first and click it
    const searchBtn = page.locator(
      '[data-testid="search"], [aria-label*="Tìm kiếm"], [aria-label*="search" i], [class*="search-icon"], [class*="search-wrapper"] button'
    ).first();
    const btnVisible = await searchBtn.isVisible({ timeout: 3_000 }).catch(() => false);
    if (btnVisible) {
      await searchBtn.click().catch(() => {});
      await page.waitForTimeout(1_500);
      searchVisible = await searchBox.isVisible({ timeout: 3_000 }).catch(() => false);
    }
  }

  if (searchVisible) {
    await searchBox.click();
    await page.waitForTimeout(400);
    await searchBox.fill(chatName);
    await page.waitForTimeout(2_500);

    const clicked = await page.evaluate((target: string) => {
      const items = document.querySelectorAll('[class*="conv-item"], [role="listitem"]');
      for (const item of items) {
        const titleEl = item.querySelector('[class*="conv-item-title__name"], [class*="name"], .truncate');
        const text = (titleEl?.textContent || item.textContent || '').trim().replace(/\u00a0/g, ' ');
        const firstLine = text.split('\n')[0].trim();
        if (firstLine.toLowerCase() === target.toLowerCase()) {
          (item as HTMLElement).click();
          return firstLine;
        }
      }
      return null;
    }, chatName);

    if (!clicked) {
      // Clear the search box so we don't leave it dirty
      await searchBox.fill("").catch(() => {});
      return { ok: false, error: `Khong tim thay chat "${chatName}" trong danh sach. Khong gui gi ca.` };
    }
    log(`Da click vao chat: ${clicked}`);
  } else {
    return { ok: false, error: "Khong tim thay o tim kiem Zalo (search box). Khong gui gi ca." };
  }

  await page.waitForTimeout(openWaitMs);

  // ── 2. VERIFY the open chat is the intended target ──────────
  const verify = await verifyOpenChat(page, chatName);
  if (!verify.verified) {
    await page.screenshot({ path: path.join(shotDir, `send-verify-fail-${stamp}.png`) }).catch(() => {});
    return {
      ok: false,
      error: `VERIFY FAILED: ${verify.reason}`,
      targetChat: verify.headerName || undefined,
      msgCount: verify.msgCount,
    };
  }
  log(`Verify OK: chat="${verify.headerName || chatName}" (msgCount=${verify.msgCount})`);

  // ── 3. Find the input and type the message ──────────────────
  const input = page.locator('#richInput, [contenteditable="true"]').first();
  const inputVisible = await input.isVisible({ timeout: 3_000 }).catch(() => false);
  if (!inputVisible) {
    return { ok: false, error: "Khong thay o nhap tin nhan (#richInput). Khong gui gi ca." };
  }

  await input.click();
  await page.waitForTimeout(300);
  await input.fill(message);
  await page.waitForTimeout(600);

  // Confirm the text actually landed in the input
  const typedText = await page.evaluate(() => {
    const el = document.querySelector('#richInput') as HTMLElement | null;
    return el?.innerText || '';
  });
  if (!typedText.trim()) {
    return { ok: false, error: "Khong the nhap tin nhan vao o input. Khong gui gi ca." };
  }
  log(`Da nhap ${typedText.length} ky tu vao o input.`);

  if (screenshots) {
    await page.screenshot({ path: path.join(shotDir, `send-composed-${stamp}.png`) }).catch(() => {});
  }

  // ── 4. DRY RUN: clear and abort ─────────────────────────────
  if (dryRun) {
    await input.fill("");
    await page.waitForTimeout(400);
    log("DRY RUN: da xoa tin nhan, KHONG gui.");
    return { ok: true, dryRun: true, targetChat: chatName, msgCount: verify.msgCount };
  }

  // ── 5. Send via Enter ───────────────────────────────────────
  log("Nhan Enter de gui tin nhan...");
  await input.press("Enter");
  await page.waitForTimeout(1_500);

  // ── 6. Verify send succeeded ────────────────────────────────
  const afterVerify = await verifyOpenChat(page, chatName);
  const inputNow = await page.evaluate(() => {
    const el = document.querySelector('#richInput') as HTMLElement | null;
    return el?.innerText || '';
  });
  const inputCleared = inputNow.trim() === "";

  let sent = false;
  let sentTextVisible = false;
  if (afterVerify.verified) {
    sent = afterVerify.msgCount > verify.msgCount;
    // Also check the last message in the chat contains our text
    sentTextVisible = await page.evaluate((msg: string) => {
      const wrappers = Array.from(document.querySelectorAll(
        '#messageViewContainer [class*="message-content-wrapper"], ' +
        '#messageViewContainer [class*="message-wrapper"]'
      ));
      const last = wrappers[wrappers.length - 1];
      if (!last) return false;
      return (last.textContent || '').includes(msg);
    }, message.slice(0, 80));
  }

  if (screenshots) {
    await page.screenshot({ path: path.join(shotDir, `send-result-${stamp}.png`) }).catch(() => {});
  }

  if (sent && inputCleared) {
    log(`GUI THANH CONG: msgCount ${verify.msgCount} -> ${afterVerify.msgCount}`);
    return {
      ok: true,
      targetChat: chatName,
      msgCount: afterVerify.msgCount,
      screenshot: path.join(shotDir, `send-result-${stamp}.png`),
    };
  }

  return {
    ok: false,
    error: `Chua xac nhan tin nhan da gui (msgCount=${verify.msgCount}->${afterVerify.msgCount}, inputCleared=${inputCleared}, textVisible=${sentTextVisible}).`,
    targetChat: chatName,
    msgCount: afterVerify.msgCount,
  };
}

// ─── Full Automation Flow ────────────────────────────────────

/**
 * Full automation flow:
 * 1. Create stealth browser
 * 2. Navigate to Zalo Web
 * 3. Wait for login (QR code)
 * 4. Navigate to group chat
 * 5. Scroll and extract messages
 * 6. Save session
 * 7. Return result
 */
export async function runZaloAutomation(
  config: ZaloAutomatorConfig
): Promise<ZaloExtractResult> {
  const { browser, context } = await createZaloStealthContext(config);

  // Use existing page from persistent context or create new
  const page = context.pages()[0] || await context.newPage();
  await applyStealthPatches(page);

  try {
    // Step 1: Navigate to Zalo Web
    await navigateToZalo(page, config);

    // Step 2: Handle login if needed (QR code)
    const neededLogin = await waitForZaloLogin(page, config);
    if (neededLogin) {
      try {
        await context.storageState({ path: path.join(config.sessionDir, "state.json") });
      } catch { /* persistent context doesn't support this */ }
      log("Da luu session sau khi dang nhap.");
      await page.waitForTimeout(5_000);
    }

    // Step 3: Navigate to specific group via sidebar or search
    if (config.groupName) {
      await navigateToZaloGroup(page, config.groupName);
    }

    // Step 4: Scroll to load history
    await scrollZaloChatContainer(page, config);

    // Step 5: Extract messages
    const result = await extractZaloMessages(page, config);

    // Step 6: Save session
    try {
      await context.storageState({ path: path.join(config.sessionDir, "state.json") });
    } catch { /* persistent context doesn't support this */ }
    log("Da luu session (sau extract).");

    return result;
  } finally {
    try {
      await context.storageState({ path: path.join(config.sessionDir, "state.json") });
    } catch { /* ignore */ }

    if (!config.headless && config.keepOpen) {
      log("Giu browser mo.");
      await new Promise(() => {});
    }
    if (!config.headless && !config.keepOpen) {
      log("Browser se dong sau 3s...");
      await page.waitForTimeout(3_000);
    }
    await browser.close().catch(() => {});
    log("Browser da dong.");
  }
}
