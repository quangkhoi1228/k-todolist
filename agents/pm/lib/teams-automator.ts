/**
 * Teams Web Automator
 *
 * Uses Playwright with stealth anti-detection to automate Teams web:
 * - Login session management
 * - Channel extraction (messages)
 * - Keyword monitoring
 * - Message sending (future)
 *
 * This module is meant to be used from:
 *   a) CLI via `npx tsx agents/pm/scripts/teams-automator.ts`
 *   b) API route via child_process.spawn
 *
 * Anti-detection is done manually (no playwright-extra dependency required):
 *   - User-agent rotation
 *   - Viewport / geolocation spoofing
 *   - WebDriver flag override
 *   - Chromium launch args for stealth
 *   - navigator.webdriver patch
 *   - Random mouse movements & delays
 */

import type { Page, BrowserContext, Browser } from "playwright";
import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";

// ─── Config ─────────────────────────────────────────────────

export interface AutomatorConfig {
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
  /** Timeout for login wait (ms) */
  loginTimeoutMs: number;
  /** Whether to run headless (requires existing session) */
  headless: boolean;
  /** Deep link to navigate to on start */
  deepLink?: string;
  /** Chat name to navigate to in sidebar (Teams v2) */
  chatName?: string;
  /** Extra keywords to highlight during extraction */
  keywords?: string[];
  /** Keep browser open after extraction (non-headless only) */
  keepOpen?: boolean;
  /** Use real Chrome (with persistent profile) instead of bundled Chromium */
  useRealChrome?: boolean;
}

export const DEFAULT_CONFIG: AutomatorConfig = {
  sessionDir: path.join(process.cwd(), ".teams-session"),
  outputFile: path.join(process.cwd(), "teams-messages.json"),
  screenshotDir: path.join(process.cwd(), "teams-screenshots"),
  scrollCount: 5,
  scrollWaitMs: 2_000,
  loginTimeoutMs: 120_000,
  headless: false,
};

// ─── Types ──────────────────────────────────────────────────

export interface TeamsExtractResult {
  channelName: string;
  teamName: string;
  chatUrl?: string;
  totalMessages: number;
  messages: ExtractedMessage[];
  extractedAt: string;
}

export interface ExtractedMessage {
  id: string;
  sender: string;
  content: string;
  images?: string[];
  senderAvatar?: string;
  timestamp: string;
  timestampMs: number;
  groupName: string;
  hasKeyword: boolean;
  matchedKeywords: string[];
  /** True if this message was sent by the logged-in user */
  isMine?: boolean;
}

// ─── Logging ────────────────────────────────────────────────

export function log(msg: string, data?: unknown) {
  const prefix = `[TeamsAuto] ${new Date().toISOString().slice(11, 19)}`;
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

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
];

function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Chromium launch args for stealth */
const STEALTH_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--disable-features=IsolateOrigins,site-per-process",
  "--disable-web-security",
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-infobars",
  "--disable-dev-shm-usage",
  "--disable-accelerated-2d-canvas",
  "--disable-gpu",
  "--window-size=1280,800",
  "--hide-scrollbars",
  "--lang=en-US",
];

/**
 * Patch page to avoid bot detection.
 * Overrides navigator.webdriver, adds chrome runtime, etc.
 */
export async function applyStealthPatches(page: Page): Promise<void> {
  // Override navigator.webdriver
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

    // Override plugins array (Teams checks this)
    Object.defineProperty(navigator, "plugins", {
      get: () => [
        { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer" },
        { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai" },
        { name: "Native Client", filename: "internal-nacl-plugin" },
      ],
    });

    // Override languages
    Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en", "vi"] });
  });

  // Randomize viewport slightly (Teams still needs reasonable size)
  await page.setViewportSize({ width: randomInt(1250, 1280), height: randomInt(780, 800) });
}

// ─── Browser Helpers ────────────────────────────────────────

/**
 * Detect path to real Google Chrome on macOS.
 */
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

export async function createStealthContext(config: AutomatorConfig): Promise<{
  browser: Browser;
  context: BrowserContext;
}> {
  ensureDir(config.sessionDir);
  ensureDir(config.screenshotDir);

  if (config.useRealChrome) {
    const profileDir = path.join(config.sessionDir, "chrome-profile");
    ensureDir(profileDir);

    // ── Suppress "Restore pages?" crash bubble ─────────
    // Write Preferences before Chrome starts so it thinks it was shut down cleanly
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
      // ── Suppress "Open Microsoft Teams?" protocol dialog ──
      prefs.protocol_handler = prefs.protocol_handler || {};
      prefs.protocol_handler.excluded_schemes = prefs.protocol_handler.excluded_schemes || {};
      prefs.protocol_handler.excluded_schemes.msteams = true;
      prefs.protocol_handler.excluded_schemes["msteams-launch"] = true;
      prefs.protocol_handler.excluded_schemes["microsoft-edge"] = true;
      fs.writeFileSync(prefsPath, JSON.stringify(prefs, null, 2), "utf-8");
      log("Da ghi Preferences (suppress restore + protocol dialog).");
    } catch (e) {
      log("Khong the ghi Preferences: " + e);
    }

    log(`Mo Chrome that voi persistent profile: ${profileDir}`);

    // launchPersistentContext uses real Chrome + keeps cookies/storage
    const persistentContext = await chromium.launchPersistentContext(profileDir, {
      channel: "chrome",
      headless: config.headless,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--window-size=1280,800",
        "--lang=en-US",
        // ── Suppress "Open Microsoft Teams?" protocol handler dialog ──
        "--disable-features=ExternalProtocolDialog",
        // ── Suppress "Restore pages?" crash bubble ──
        "--disable-session-crashed-bubble",
        "--disable-restore-session-state",
        // ── Fix macOS headless cookie decryption issue ──
        "--password-store=basic",
        "--use-mock-keychain",
      ],
      viewport: null, // De window-size tu config hoat dong
      locale: "en-US",
      timezoneId: "Asia/Ho_Chi_Minh",
      bypassCSP: true,
      ignoreHTTPSErrors: true,
      colorScheme: "light",
    });

    // Persistent context comes with pages already
    const pages = persistentContext.pages();
    const page = pages.length > 0 ? pages[0] : await persistentContext.newPage();
    await applyStealthPatches(page);

    // ── Block msteams:// protocol navigation ────────────
    // Teams tries to open the native app via msteams:// redirects,
    // which triggers the browser-level "Open Microsoft Teams?" dialog.
    // We intercept these at the context level so it applies to all tabs.
    await persistentContext.route("**/*", async (route) => {
      const url = route.request().url();
      if (url.startsWith("msteams:") || url.startsWith("msteams-launch:") || url.startsWith("microsoft-edge:")) {
        log("Chan protocol redirect: " + url.slice(0, 80));
        await route.abort();
      } else {
        await route.continue();
      }
    });

    // ── Dismiss any browser dialogs automatically ─────
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

  log(`Khoi dong Playwright Chromium (headless=${config.headless})...`);

  const browser = await chromium.launch({
    headless: config.headless,
    args: STEALTH_ARGS,
  });

  const context = await browser.newContext({
    storageState: fs.existsSync(path.join(config.sessionDir, "state.json"))
      ? path.join(config.sessionDir, "state.json")
      : undefined,
    userAgent: randomPick(USER_AGENTS),
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
    timezoneId: "Asia/Ho_Chi_Minh",
    geolocation: { latitude: 10.8231, longitude: 106.6297 },
    permissions: ["geolocation"],
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    bypassCSP: true,
    ignoreHTTPSErrors: true,
    colorScheme: "light",
  });

  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith("msteams:") || url.startsWith("msteams-launch:") || url.startsWith("microsoft-edge:")) {
      log("Chan protocol redirect: " + url.slice(0, 80));
      await route.abort();
    } else {
      await route.continue();
    }
  });

  context.on("page", (newPage) => {
    newPage.on("dialog", async (dialog) => {
      log("Phat hien dialog (tab moi): " + dialog.message().slice(0, 80));
      await dialog.dismiss().catch(() => {});
    });
  });

  return { browser, context };
}

/**
 * Wait for Teams login to complete by watching URL.
 * Returns true if login was needed and completed.
 */
export async function waitForLogin(
  page: Page,
  config: AutomatorConfig
): Promise<boolean> {
  // Check if already logged in by URL pattern or Teams v2 shell elements
  const url = page.url();
  if (url.includes("teams.microsoft.com") && !url.includes("login") && !url.includes("auth")) {
    // Teams v2 selectors + legacy selectors
    const isLoggedIn = await page
      .locator('[data-tid="app-bar-wrapper"], [data-tid="chat-title"], [data-tid="app-bar"], [data-tid="chat-header-title"]')
      .first()
      .isVisible({ timeout: 5_000 })
      .catch(() => false);
    if (isLoggedIn) {
      log("Da co session, khong can dang nhap.");
      return false;
    }
  }

  const loginSelectors = [
    'input[name="loginfmt"]',
    'input[type="email"]',
    'input[name="passwd"]',
    '[data-tid="signIn"]',
  ];

  let needsLogin = false;
  for (const sel of loginSelectors) {
    const visible = await page.locator(sel).first().isVisible({ timeout: 10_000 }).catch(() => false);
    if (visible) {
      needsLogin = true;
      break;
    }
  }

  if (!needsLogin && url.includes("login.microsoftonline.com")) {
    needsLogin = true;
  }

  if (needsLogin) {
    log("Can dang nhap. Vui long dang nhap trong cua so browser...");
    console.log("\n  >>> DANG NHAP VAO TEAMS TRONG CUA SO VUA MO <<<");

    try {
      // Teams v2 uses /v2/ URL after login
      await page.waitForURL("**/v2/**", { timeout: config.loginTimeoutMs });
      log("Dang nhap thanh cong!");
    } catch {
      try {
        await page.waitForURL(/teams\.microsoft\.com\/(?!.*login)/, { timeout: 30_000 });
        log("Dang nhap thanh cong! (teams.microsoft.com)");
      } catch {
        const currentUrl = page.url();
        log("Da vao duoc Teams (URL: " + currentUrl.slice(0, 80) + "...)");
      }
    }
    return true;
  }

  log("Khong can dang nhap.");
  return false;
}

/**
 * Navigate to Teams homepage (v2 SPA).
 * Deep links no longer work in v2 — they redirect to launcher page.
 */
export async function navigateToTeams(
  page: Page,
  _config: AutomatorConfig
): Promise<void> {
  // Always go to homepage — v2 SPA loads reliably from there
  log("Dang mo Teams homepage...");
  await page.goto("https://teams.microsoft.com", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(8_000);
  log(`URL: ${page.url()}`);
}

/**
 * Navigate to a specific chat by clicking on it in the sidebar (Teams v2).
 * Handles scrolling and expanding collapsed sidebar sections.
 */
export async function navigateToChatInSidebar(
  page: Page,
  chatName: string
): Promise<boolean> {
  if (!chatName) return false;

  log(`Tim kiem chat: "${chatName}" trong sidebar...`);

  // Helper: search and click the chat item
  async function tryClickChat(name: string): Promise<string | null> {
    return page.evaluate((searchName: string) => {
      const items = document.querySelectorAll('[data-testid="list-item"]');
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

  // Attempt 2: Scroll the sidebar
  log("Chat khong thay, dang scroll sidebar...");
  const sidebarSelector = '[data-tid="app-layout-area--mid-nav"], [data-testid="simple-collab-rail"], [role="tree"]';

  for (let i = 0; i < 5; i++) {
    await page.evaluate((sel: string) => {
      const sidebar = document.querySelector(sel)
        || document.querySelector('[data-tid="simple-collab-dnd-rail"]')
        || document.querySelector('[role="tree"]');
      if (sidebar) sidebar.scrollTop += 400;
      const tree = document.querySelector('[role="tree"]');
      if (tree) {
        const scrollParent = tree.closest('[style*="overflow"]') || tree.parentElement;
        if (scrollParent) (scrollParent as HTMLElement).scrollTop += 400;
      }
    }, sidebarSelector);
    await page.waitForTimeout(1_500);

    found = await tryClickChat(chatName);
    if (found) {
      log(`Da click vao chat (sau scroll): "${found}"`);
      await page.waitForTimeout(5_000);
      return true;
    }
  }

  // Attempt 3: Expand collapsed sections
  log("Thu mo rong cac section bi dong...");
  await page.evaluate(() => {
    const treeitems = document.querySelectorAll('[role="treeitem"]');
    for (const item of treeitems) {
      const text = item.textContent?.trim() || "";
      if (["Chats", "External", "Đợi chốt manday"].includes(text)) {
        (item as HTMLElement).click();
      }
    }
  });
  await page.waitForTimeout(3_000);

  for (let i = 0; i < 5; i++) {
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

  log(`Khong tim thay chat "${chatName}" trong sidebar.`);
  return false;
}

/**
 * Simulate human-like scrolling inside the chat message list.
 * Teams chat is typically inside a scrollable container,
 * so we try both window scroll and container scroll.
 */
/**
 * Scroll the chat container to a specific position.
 */
async function getChatContainer(page: Page) {
  return await page.evaluate(() => {
    const container =
      document.querySelector('[data-tid="message-pane-list-viewport"]') ||
      document.querySelector('[data-tid="message-list-container"]') ||
      document.querySelector('[data-tid="chat-pane"]') ||
      document.querySelector('[role="log"]') ||
      document.documentElement;
    return (container as HTMLElement).scrollHeight;
  });
}

/**
 * Capture the current chat URL from the Teams v2 SPA (hash-based deep link),
 * e.g. https://teams.microsoft.com/v2/#/conversations/19:xxx@thread.v2
 * Falls back to the raw page URL if no hash routing is present.
 */
export async function getChatUrl(page: Page): Promise<string | undefined> {
  try {
    const raw = page.url();
    if (!raw || raw.includes("login") || raw.includes("launcher")) return undefined;
    return raw;
  } catch {
    return undefined;
  }
}

/**
 * Scroll to top of the chat to load older messages.
 * Returns when the scroll has settled.
 */
export async function scrollChatToTop(page: Page, config: AutomatorConfig): Promise<void> {
  await page.evaluate(() => {
    const container =
      document.querySelector('[data-tid="message-pane-list-viewport"]') ||
      document.querySelector('[data-tid="message-list-container"]') ||
      document.querySelector('[data-tid="chat-pane"]') ||
      document.querySelector('[role="log"]') ||
      document.documentElement;
    container.scrollTop = 0;
  });
  await page.waitForTimeout(config.scrollWaitMs || 2000);
}

/**
 * Scroll chat container by scrolling to top repetitively to load older messages.
 * By default scrolls back to bottom at the end (for text extraction).
 * Pass `stayAtTop: true` to keep at top (for image extraction).
 */
export async function scrollChatContainer(page: Page, config: AutomatorConfig, stayAtTop?: boolean): Promise<void> {
  log(`Dang scroll len de load tin nhan cu hon (${config.scrollCount} lan)...`);

  for (let i = 0; i < config.scrollCount; i++) {
    await page.evaluate(() => {
      const container =
        document.querySelector('[data-tid="message-pane-list-viewport"]') ||
        document.querySelector('[data-tid="message-list-container"]') ||
        document.querySelector('[data-tid="chat-pane"]') ||
        document.querySelector('[role="log"]') ||
        document.documentElement;
      container.scrollTop = 0;
    });
    await page.waitForTimeout(config.scrollWaitMs + randomInt(500, 1500));
    log(`  Scroll ${i + 1}/${config.scrollCount}`);
  }

  if (stayAtTop) {
    // Stay at top — old messages & their images stay in DOM.
    // extractMessages will be called with skipLazyKick=true so it won't
    // scroll away and trigger Teams virtual DOM to unload our wrappers.
    await scrollChatToTop(page, config);
    return;
  }

  // Scroll back down to latest messages (default path)
  await page.evaluate(() => {
    const container =
      document.querySelector('[data-tid="message-pane-list-viewport"]') ||
      document.querySelector('[data-tid="message-list-container"]') ||
      document.documentElement;
    container.scrollTop = container.scrollHeight;
  });
  await page.waitForTimeout(1_000);
  
  // After scrolling to top, wait and repeatedly scroll images into view to trigger lazy loading
  // This is needed because Teams uses virtual scrolling — images only load when visible
  await page.evaluate(() => {
    // First, scroll all the way down briefly, then back to top
    // This ensures even the last messages' images get a chance to load
    const container = document.querySelector('[data-tid="message-pane-list-viewport"]') ||
      document.querySelector('[role="log"]') || document.documentElement;
    container.scrollTop = container.scrollHeight;
  });
  await page.waitForTimeout(2_000);
  await scrollChatToTop(page, config);
  await page.waitForTimeout(2_000);
  
  // Then carefully scroll through the container from bottom to top,
  // bringing each img into view to force lazy load
  await page.evaluate(() => {
    const imgs = document.querySelectorAll<HTMLImageElement>('img');
    imgs.forEach(img => {
      img.scrollIntoView({ block: "center", inline: "nearest" });
    });
  });
  await page.waitForTimeout(5_000);

  // Final check: scroll to top (where old messages are) and wait for images
  await scrollChatToTop(page, config);
  await page.waitForTimeout(3_000);
}

/**
 * Extract messages from the current Teams channel.

/**
 * Extract messages from the current Teams channel.
 * Uses multiple selector strategies for robustness.
 */
export async function extractMessages(page: Page, config: AutomatorConfig, skipLazyKick?: boolean): Promise<TeamsExtractResult> {
  log("Dang trich xuat tin nhan (Teams v2)...");

  // Get channel / team name from page — Teams v2 uses data-tid="chat-title"
  const pageInfo = await page.evaluate(() => {
    const channelEl =
      document.querySelector<HTMLElement>('[data-tid="chat-title"]') ||
      document.querySelector<HTMLElement>('[data-tid="chat-header-title"]') ||
      document.querySelector<HTMLElement>('[data-tid="thread-header-title"]');
    const channelName = channelEl?.textContent?.trim() || "Unknown Channel";
    const teamName = "";
    return { channelName, teamName };
  });

  log(`Channel: ${pageInfo.channelName}`);

  // Wait for messages to render — Teams v2 selectors
  try {
    await page.waitForSelector(
      '[data-tid="message-pane-list-viewport"], [data-testid="comfy-message-wrapper"], .fui-ChatMessage',
      { timeout: 20_000 }
    );
    log("Da tim thay message pane.");
  } catch {
    log("Khong tim thay message pane.");
    if (process.env.DEBUG_SCRIPTS === "1") {
      await page.screenshot({ path: path.join(config.screenshotDir, `debug-${Date.now()}.png`) });
    }
  }

  // Wait for lazy-loaded images to start loading
  log("Dang cho hinh anh load...");

  if (skipLazyKick) {
    // Pass 1 (image pass): We're already at top after scrollChatContainer(stayAtTop).
    // Teams virtual DOM keeps old messages visible at the current scroll position.
    // Do NOT scroll away — that would unload the wrappers + <img> we need.
    // Small "nudge" scroll (a few px) to trigger lazy loading without moving
    // far enough to recycle messages, then restore position.
    await page.evaluate(() => {
      const container = document.querySelector('[data-tid="message-pane-list-viewport"]') ||
        document.querySelector('[role="log"]') || document.documentElement;
      const pos = container.scrollTop;
      container.scrollBy({ top: -60, behavior: 'instant' as any });
      container.scrollBy({ top: 60, behavior: 'instant' as any });
      container.scrollTop = pos;
    });
    await page.waitForTimeout(4_000);
  } else {
    // Pass 2 (text pass): Scroll to bottom + kick lazy loading (safe because
    // the text content of messages persists even when images are unloaded).
    await page.evaluate(() => {
      const container = document.querySelector('[data-tid="message-pane-list-viewport"]') ||
        document.querySelector('[role="log"]') || document.documentElement;
      container.scrollTop = container.scrollHeight;
    });
    // Kick lazy loading by gently scrolling each image into view one by one.
    // Teams uses IntersectionObserver for image loading, so we need to ensure
    // each img element enters the viewport.
    await page.evaluate(() => {
      const imgs = document.querySelectorAll<HTMLImageElement>('img');
      imgs.forEach((img, idx) => {
        img.scrollIntoView({ block: "center", inline: "nearest" });
      });
    });
    await page.waitForTimeout(6_000);
  }

  // Extract messages via Teams v2 DOM selectors
  await page.addScriptTag({ content: `
    window.blobToBase64 = async function(url) {
      // Strategy: canvas FIRST (more reliable for already-rendered <img> elements
      // even after blob URLs are revoked). Only fall back to fetch() if canvas fails.
      try {
        const imgEl = Array.from(document.querySelectorAll('img')).find(img => img.src === url);
        if (imgEl && imgEl.complete && imgEl.naturalWidth > 0 && imgEl.naturalHeight > 0) {
          // Set crossOrigin to anonymous to avoid tainted canvas errors
          try { imgEl.crossOrigin = 'anonymous'; } catch (e) { /* ignore */ }
          const canvas = document.createElement('canvas');
          canvas.width = imgEl.naturalWidth;
          canvas.height = imgEl.naturalHeight;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(imgEl, 0, 0);
            const dataUrl = canvas.toDataURL('image/png');
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
  const extractedMessages: ExtractedMessage[] = 
  await page.evaluate(async (args: { kwList: string[]; groupName: string; imgBlocklist: string[] }) => {
    const results: ExtractedMessage[] = [];
    let counter = 0;
    const seen = new Set<string>();


    const rawWrappers = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid="comfy-message-wrapper"], .fui-ChatMessage, .fui-ChatMyMessage, .fui-ChatMyMessage__body, [data-tid="chat-pane-message"]'
      )
    );
    const wrappers = rawWrappers.filter(el =>
      !rawWrappers.some(other => other !== el && other.contains(el))
    );
    console.log(`[TeamsAuto] Found ${rawWrappers.length} raw wrappers, filtered to ${wrappers.length} outermost`);

    let lastSender = "";
    let lastSenderAvatar = "";

    for (const el of wrappers) {
      const isMine = el.classList.contains('fui-ChatMyMessage') ||
        el.classList.contains('fui-ChatMyMessage__body') ||
        el.closest('.fui-ChatMyMessage') !== null;
      const nameEl = el.querySelector<HTMLElement>('[data-tid="message-author-name"]');
      let sender = nameEl?.textContent?.trim() || "";
      
      let senderAvatar = "";
      let avatarImg: HTMLImageElement | null = null;

      const avatarSelectors = [
        'img.fui-Avatar__image',
        'img[class*="avatar"]',
        'img[data-tid*="avatar"]',
        'img[class*="Avatar"]',
        '[class*="fui-Avatar"] img',
        '[class*="avatar"] img',
        'img[class*="Persona"]',
        'img[class*="persona"]',
        'img[class*="profile"]',
        'img[aria-label*="avatar"]',
        'img[role="presentation"]',
      ];

      for (const sel of avatarSelectors) {
        avatarImg = el.querySelector<HTMLImageElement>(sel);
        if (avatarImg) break;
      }

      if (!avatarImg) {
        const allImgs = el.querySelectorAll<HTMLImageElement>('img[src]');
        let smallestArea = Infinity;
        let smallestImg: HTMLImageElement | null = null;

        allImgs.forEach((img) => {
          const w = img.naturalWidth || parseInt(img.getAttribute('width') || '0');
          const h = img.naturalHeight || parseInt(img.getAttribute('height') || '0');
          const area = w * h;
          if (w > 0 && w <= 28 && h > 0 && h <= 28 && area < smallestArea) {
            smallestArea = area;
            smallestImg = img;
          }
        });

        if (smallestImg) {
          avatarImg = smallestImg;
        }
      }

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

      const timeEl = el.querySelector<HTMLTimeElement>("time");
      const timestampText = timeEl?.getAttribute("aria-label")
        || timeEl?.textContent?.trim()
        || "";
      const timestampMs = timeEl?.getAttribute("datetime")
        ? new Date(timeEl.getAttribute("datetime")!).getTime()
        : Date.now();

      // === Extract quoted/reply message (Skype Reply schema blockquote) ===
      // Teams renders inline replies as:
      //   <blockquote itemtype="http://schema.skype.com/Reply" itemid="...">
      //     <strong itemprop="mri">Sender Name</strong>
      //     <p itemprop="preview">quoted text</p>
      //   </blockquote>
      // The <strong> (sender) and <p> (content) must be pulled out BEFORE
      // computing the raw body text — otherwise they get squished together
      // with the reply text ("SenderTimestampquotedReply") with no separators.
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

      let content = "";
      const bodyEl = el.querySelector<HTMLElement>(
        '[data-tid="message-body-content"], [data-tid="chat-pane-message"], .fui-ChatMessage__body'
      );
      if (bodyEl) {
        const bodyClone = bodyEl.cloneNode(true) as HTMLElement;
        // Remove the quote blockquote from the body so it isn't duplicated
        // into the main text (it is rendered separately below).
        bodyClone.querySelectorAll('blockquote[itemtype*="schema.skype.com/Reply"], blockquote[itemprop*="quote"]').forEach(e => e.remove());
        content = bodyClone.textContent?.trim().replace(/\s{2,}/g, " ") || "";
      }

      const images: string[] = [];
      const seenUrls = new Set<string>();

      for (const img of el.querySelectorAll<HTMLImageElement>('img')) {
        const w = img.naturalWidth || parseInt(img.getAttribute('width') || '0');
        const h = img.naturalHeight || parseInt(img.getAttribute('height') || '0');
        if (w > 0 && w <= 28 && h > 0 && h <= 28) continue;

        // Collect ALL candidates for this img element first
        const candidates = [
          { attr: img.getAttribute('data-src'), type: 'data-src' },
          { attr: img.getAttribute('data-url'), type: 'data-url' },
          { attr: img.getAttribute('data-src-url'), type: 'data-src-url' },
          { attr: img.getAttribute('data-original'), type: 'data-original' },
          { attr: img.getAttribute('data-image-url'), type: 'data-image-url' },
          { attr: img.getAttribute('data-preview'), type: 'data-preview' },
          { attr: img.getAttribute('data-echo'), type: 'data-echo' },
          { attr: img.getAttribute('data-lazy-src'), type: 'data-lazy-src' },
          { attr: img.getAttribute('data-original-src'), type: 'data-original-src' },
          { attr: img.getAttribute('data-orig-src'), type: 'data-orig-src' },
          { attr: img.getAttribute('data-gallery-src'), type: 'data-gallery-src' },
          { attr: img.getAttribute('data-actualsrc'), type: 'data-actualsrc' },
          { attr: img.getAttribute('data-ng-src'), type: 'data-ng-src' },
          { attr: img.getAttribute('src'), type: 'src' },
          { attr: img.getAttribute('srcset') ? img.getAttribute('srcset')!.match(/https?:\/\/[^\s,]+/g)?.[0] : null, type: 'srcset' },
        ].filter(c => c.attr !== null) as { attr: string; type: string }[];

        if (candidates.length === 0) continue;

        // Priority: prefer blob: → base64 (self-contained, no auth needed).
        // Teams uses blob: URLs for lazy-loaded images; converting them to data:
        // captures the decoded pixels from the <img> element.
        // Only fall back to HTTP/S URL if blob: is unavailable or conversion fails.
        const httpCandidate = candidates.find(c => c.attr.startsWith('http://') || c.attr.startsWith('https://'));
        const blobCandidate = candidates.find(c => c.attr.startsWith('blob:'));

        if (blobCandidate) {
          // Try blob: → base64 conversion (captures decoded pixels from <img>)
          const blobUrl = blobCandidate.attr;
          const lowerBlobUrl = blobUrl.toLowerCase();
          if (!args.imgBlocklist.some((pattern: string) => lowerBlobUrl.includes(pattern))) {
            const finalUrl = await (window as any).blobToBase64(blobUrl);
            if (finalUrl && !images.includes(finalUrl)) {
              images.push(finalUrl);
            } else if (httpCandidate) {
              // Blob conversion failed — fall back to HTTP URL
              const httpUrl = httpCandidate.attr.startsWith('//') ? 'https:' + httpCandidate.attr : httpCandidate.attr;
              if (!images.includes(httpUrl)) {
                images.push(httpUrl);
              }
            }
          }
        } else if (httpCandidate) {
          // No blob URL but has HTTP URL — skip blocklist check after blob
          const httpUrl = httpCandidate.attr.startsWith('//') ? 'https:' + httpCandidate.attr : httpCandidate.attr;
          const lowerHttp = httpUrl.toLowerCase();
          if (!args.imgBlocklist.some((pattern: string) => lowerHttp.includes(pattern))) {
            if (!images.includes(httpUrl)) {
              images.push(httpUrl);
            }
          }
        }
      }

      const anchorEls = Array.from(el.querySelectorAll<HTMLAnchorElement>('a[href]'));
      for (const a of anchorEls) {
        const href = a.getAttribute('href');
        if (!href) continue;
        if (!href.startsWith('blob:') && !href.startsWith('http://') && !href.startsWith('https://') && !href.startsWith('//') && !href.startsWith('data:')) continue;

        const lowerHref = href.toLowerCase();
        if (args.imgBlocklist.some((pattern: string) => lowerHref.includes(pattern))) continue;

        // Check if this anchor wraps ONLY images (link to a full-size image).
        // Teams wraps shared images in <a href="CDN_URL"><img ... data-src="CDN_URL"></a>.
        // The <img> processing above already captured the image (blob→data: or http URL).
        // Skip the anchor entirely for image-only links to avoid URL[2] and URL[3] duplicates.
        const hasImgDescendant = a.querySelector('img') !== null;
        const directTextContent = Array.from(a.childNodes)
          .filter(n => n.nodeType === 3) // TEXT_NODE
          .some(n => n.textContent?.trim());
        if (hasImgDescendant && !directTextContent) {
          continue; // already captured by <img> processing above
        }

        let normalizedHref = href.startsWith('//') ? 'https:' + href : href;
        if (normalizedHref.startsWith('blob:')) {
            normalizedHref = await (window as any).blobToBase64(normalizedHref);
            if (normalizedHref && !images.includes(normalizedHref)) images.push(normalizedHref);
        } else if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(normalizedHref)) {
          if (!images.includes(normalizedHref)) images.push(normalizedHref);
        } else if (normalizedHref.includes('/api/mt/') || normalizedHref.includes('teams.microsoft.com') || normalizedHref.includes('sharepoint')) {
          if (!images.includes(normalizedHref)) images.push(normalizedHref);
        }

        const childImg = a.querySelector<HTMLImageElement>('img');
        if (childImg) {
          const childSrc = childImg.getAttribute('src') || childImg.getAttribute('data-src');
          if (childSrc) {
            const lowerChildSrc = childSrc.toLowerCase();
            const blocked = args.imgBlocklist.some((pattern: string) => lowerChildSrc.includes(pattern));
            if (!blocked && !images.includes(childSrc)) {
              let finalChildSrc = childSrc.startsWith('//') ? 'https:' + childSrc : childSrc;
              if (finalChildSrc.startsWith('blob:')) {
                finalChildSrc = await (window as any).blobToBase64(finalChildSrc);
              }
              if (finalChildSrc && !images.includes(finalChildSrc)) {
                images.push(finalChildSrc);
              }
            }
          }
        }
      }

      const bgEls = Array.from((bodyEl || el).querySelectorAll<HTMLElement>('[style*="background-image"], [style*="background"]'));
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
            if (bgUrl && !images.includes(bgUrl)) {
              images.push(bgUrl);
            }
          }
        }
      }

      if (images.length === 0 && content) {
        const fallbackBgEls = Array.from(el.querySelectorAll<HTMLElement>('[style*="background"]'));
        for (const el_ of fallbackBgEls) {
          const match = el_.getAttribute('style')?.match(/url\(["']?([^"')]+)["']?\)/);
          if (match && match[1] && !match[1].startsWith('data:')) {
            const lowerUrl = match[1].toLowerCase();
            const blocked = args.imgBlocklist.some((pattern: string) => lowerUrl.includes(pattern));
            if (!blocked && !images.includes(match[1])) {
              let bgUrl = match[1].startsWith('//') ? 'https:' + match[1] : match[1];
              if (bgUrl.startsWith('blob:')) {
                  bgUrl = await (window as any).blobToBase64(bgUrl);
              }
              if (bgUrl && !images.includes(bgUrl)) {
                images.push(bgUrl);
              }
            }
          }
        }
      }

      if (images.length === 0) {
        const dataUrlEls = Array.from(el.querySelectorAll<HTMLElement>('[data-url*="teams"], [data-url*="sharepoint"], [data-url*=".png"], [data-url*=".jpg"], [data-url*=".jpeg"], [data-url*=".gif"]'));
        for (const el_ of dataUrlEls) {
          const url = el_.getAttribute('data-url') || el_.getAttribute('data-src') || '';
          if (url && (url.startsWith('http') || url.startsWith('blob:'))) {
            const lowerUrl = url.toLowerCase();
            const blocked = args.imgBlocklist.some((pattern: string) => lowerUrl.includes(pattern));
            if (!blocked && !images.includes(url)) {
                let finalUrl = url;
                if (finalUrl.startsWith('blob:')) {
                    finalUrl = await (window as any).blobToBase64(finalUrl);
                }
                if (finalUrl && !images.includes(finalUrl)) {
                  images.push(finalUrl);
                }
            }
          }
        }
      }

      if (!content) {
        const clone = el.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('[data-tid="message-author-name"]').forEach(e => e.remove());
        clone.querySelectorAll("time").forEach(e => e.remove());
        clone.querySelectorAll('a').forEach(e => {
          if (e.textContent?.trim() === "Translate" || e.textContent?.includes("Never translate")) e.remove();
        });
        clone.querySelectorAll('button').forEach(e => e.remove());
        clone.querySelectorAll('span').forEach(e => {
          if (e.textContent?.trim() === "Edited") e.remove();
        });
        
        clone.querySelectorAll('blockquote').forEach(bq => {
          bq.innerHTML = `
> ${bq.innerText.trim()}

`;
        });
        
        clone.querySelectorAll('div').forEach(div => {
          div.innerHTML = div.innerHTML + ' ';
        });

        content = clone.textContent?.trim().replace(/\s{2,}/g, " ") || "";
      }

      // Compose final content: prefix the quoted message (if any) in the
      // same "> Sender: quoted" format used by Zalo, so the UI can render
      // the quote block and keep the reply text separate.
      if (quoteSender && quoteContent) {
        // The fallback clone path above may have already embedded the
        // blockquote as a "> ..." line — strip it (first occurrence) to
        // avoid duplication.
        const quotedPrefix = `> ${quoteSender}: ${quoteContent}`;
        let stripped = content.replace(quotedPrefix, "");
        stripped = stripped.replace(/^\s*>.*$/m, () => ""); // first > line only
        stripped = stripped.replace(/\s{2,}/g, " ").trim();
        content = `> ${quoteSender}: ${quoteContent}\n${stripped}`;
      }

      if ((!content && images.length === 0) || !sender) continue;

      const key = `${sender}|${content.slice(0, 80)}|${images.join(',')}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const matchedKeywords = args.kwList.filter((kw) =>
        content.toLowerCase().includes(kw.toLowerCase())
      );

      counter++;
      results.push({
        id: `auto_${counter}_${Date.now()}`,
        sender,
        content,
        images: images.length > 0 ? images : undefined,
        senderAvatar: senderAvatar || undefined,
        timestamp: timestampText,
        timestampMs: isNaN(timestampMs) ? Date.now() : timestampMs,
        groupName: args.groupName,
        hasKeyword: matchedKeywords.length > 0,
        matchedKeywords,
        isMine: isMine || undefined,
      });
    }

    // Fallback: scan ALL images in the message pane not captured by wrappers
    // This catches images inside non-standard wrapper structures (e.g., fui-ChatMyMessage)
    try {
      const pane = document.querySelector('[data-tid="message-pane-list-viewport"]') ||
                   document.querySelector('[role="log"]') || document.body;
      const allImgs = pane.querySelectorAll<HTMLImageElement>('img');
      const fallbackImages: string[] = [];
      const fallbackSeen = new Set<string>();

      allImgs.forEach((img) => {
        const rect = img.getBoundingClientRect();
        const w = rect.width || parseInt(img.getAttribute('width') || '0');
        const h = rect.height || parseInt(img.getAttribute('height') || '0');
        if (w > 0 && w <= 28 && h > 0 && h <= 28) return; // skip emoji
        if (img.src.includes('profilepicture')) return; // skip avatars

        // Check if this img is already inside any wrapper (dedup)
        if (img.closest('.fui-ChatMessage, .fui-ChatMyMessage, [data-testid="comfy-message-wrapper"], [data-tid="chat-pane-message"]')) return;

        const src = img.getAttribute('data-orig-src') || img.getAttribute('data-gallery-src') || img.getAttribute('data-src') || img.getAttribute('src') || '';
        if (!src || src.startsWith('data:image/svg')) return;

        const lowerUrl = src.toLowerCase();
        if (['/profilepicture', '/profilepicturev2', '/emoticons/', '/personal-expressions/', '/reactions/', '/evergreen-assets/']
            .some(p => lowerUrl.includes(p))) return;

        if (!fallbackSeen.has(src)) {
          fallbackSeen.add(src);
          fallbackImages.push(src);
        }
      });

      if (fallbackImages.length > 0) {
        results.push({
          id: `auto_fallback_${Date.now()}`,
          sender: '(image attachment)',
          content: '',
          images: fallbackImages,
          senderAvatar: undefined,
          timestamp: '',
          timestampMs: Date.now(),
          groupName: args.groupName,
          hasKeyword: false,
          matchedKeywords: [],
        });
        console.log(`[TeamsAuto] Fallback captured ${fallbackImages.length} orphan images`);
      }
    } catch (e) {
      console.log('[TeamsAuto] Fallback image scan error:', e);
    }

    return results;
  }, { 
    kwList: config.keywords || [], 
    groupName: pageInfo.channelName,
    imgBlocklist: [
      '/profilepicture',
      '/profilepicturev2',
      '/emoticons/',
      '/personal-expressions/',
      '/reactions/',
      '/evergreen-assets/'
    ]
  });

  log(`Trich xuat duoc ${extractedMessages.length} tin nhan.`);

  extractedMessages.sort((a, b) => a.timestampMs - b.timestampMs);

  const result: TeamsExtractResult = {
    channelName: pageInfo.channelName,
    teamName: pageInfo.teamName,
    totalMessages: extractedMessages.length,
    messages: extractedMessages,
    extractedAt: new Date().toISOString(),
  };

  mergeOutput(result, config);

  return result;
}

/**
 * Lightweight text-only extraction — skips ALL image processing (blob→base64,
 * lazy kick waits, background scanning, anchor/fallback image collection).
 * Use during intermediate scroll batches in incrementalScrollAndExtract to
 * avoid the ~15-30s overhead of extractMessages.
 * Only the bottom and top passes should use the full extractMessages (with images).
 */
export async function extractTextOnly(page: Page, config: AutomatorConfig): Promise<TeamsExtractResult> {
  log("Dang trich xuat text (nhe)...");

  const pageInfo = await page.evaluate(() => {
    const channelEl =
      document.querySelector<HTMLElement>('[data-tid="chat-title"]') ||
      document.querySelector<HTMLElement>('[data-tid="chat-header-title"]') ||
      document.querySelector<HTMLElement>('[data-tid="thread-header-title"]');
    return {
      channelName: channelEl?.textContent?.trim() || "Unknown Channel",
      teamName: "",
    };
  });

  const extractedMessages: ExtractedMessage[] = await page.evaluate((args: { groupName: string }) => {
    const results: ExtractedMessage[] = [];
    let counter = 0;
    const seen = new Set<string>();

    const rawWrappers = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid="comfy-message-wrapper"], .fui-ChatMessage, .fui-ChatMyMessage, .fui-ChatMyMessage__body, [data-tid="chat-pane-message"]'
      )
    );
    const wrappers = rawWrappers.filter(el =>
      !rawWrappers.some(other => other !== el && other.contains(el))
    );

    let lastSender = "";

    for (const el of wrappers) {
      const isMine = el.classList.contains('fui-ChatMyMessage') ||
        el.classList.contains('fui-ChatMyMessage__body') ||
        el.closest('.fui-ChatMyMessage') !== null;
      const nameEl = el.querySelector<HTMLElement>('[data-tid="message-author-name"]');
      let sender = nameEl?.textContent?.trim() || "";

      if (!sender && lastSender) {
        sender = lastSender;
      } else if (sender) {
        lastSender = sender;
      }

      const timeEl = el.querySelector<HTMLTimeElement>("time");
      const timestampText = timeEl?.getAttribute("aria-label") || timeEl?.textContent?.trim() || "";
      const timestampMs = timeEl?.getAttribute("datetime")
        ? new Date(timeEl.getAttribute("datetime")!).getTime()
        : Date.now();

      // === Extract quoted/reply message (same logic as extractMessages) ===
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

      let content = "";
      const bodyEl = el.querySelector<HTMLElement>(
        '[data-tid="message-body-content"], [data-tid="chat-pane-message"], .fui-ChatMessage__body'
      );
      if (bodyEl) {
        const bodyClone = bodyEl.cloneNode(true) as HTMLElement;
        bodyClone.querySelectorAll('blockquote[itemtype*="schema.skype.com/Reply"], blockquote[itemprop*="quote"]').forEach(e => e.remove());
        content = bodyClone.textContent?.trim().replace(/\s{2,}/g, " ") || "";
      }

      if (quoteSender && quoteContent) {
        content = `> ${quoteSender}: ${quoteContent}\n${content}`;
      }

      if (!content || !sender) continue;

      const key = `${sender}|${content.slice(0, 80)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      counter++;
      results.push({
        id: `text_${counter}_${Date.now()}`,
        sender,
        content,
        images: undefined,
        timestamp: timestampText,
        timestampMs: isNaN(timestampMs) ? Date.now() : timestampMs,
        groupName: args.groupName,
        hasKeyword: false,
        matchedKeywords: [],
        isMine: isMine || undefined,
      });
    }

    return results;
  }, { groupName: pageInfo.channelName });

  log(`Trich xuat text: ${extractedMessages.length} messages`);
  extractedMessages.sort((a, b) => a.timestampMs - b.timestampMs);

  return {
    channelName: pageInfo.channelName,
    teamName: pageInfo.teamName,
    totalMessages: extractedMessages.length,
    messages: extractedMessages,
    extractedAt: new Date().toISOString(),
  };
}

/**
 * Incremental scroll-and-extract to get ALL messages from a Teams chat.
 *
 * PROBLEM: Teams virtual DOM only keeps ~100-200 messages rendered at a time.
 * The old approach (scroll 40× to top THEN extract) only captures the ~100
 * messages nearest the top. All intermediate messages are recycled by the
 * virtual DOM and permanently lost.
 *
 * SOLUTION: Extract every N scrolls during the scroll-up process. Each extraction
 * captures the ~100 messages currently in the virtual DOM at that scroll position.
 * By extracting periodically, we capture each batch before Teams recycles it.
 *
 * Flow:
 *   1. Extract at bottom (newest ~100 messages)
 *   2. Scroll up in batches; after every EXTRACT_EVERY_N scrolls, extract current DOM
 *   3. Final extraction at top (oldest messages + their images)
 *   4. Merge all batches by sender|timestampMs|content dedup key
 *   5. Sort by timestamp ascending
 */
export async function incrementalScrollAndExtract(
  page: Page,
  config: AutomatorConfig,
): Promise<TeamsExtractResult> {
  const allMessages: Map<string, ExtractedMessage> = new Map();
  const fullSync = config.scrollCount > 0;
  const EXTRACT_EVERY_N = fullSync ? 10 : 0;

  const nonEmoji = (urls: string[]) =>
    urls.filter(i => !i.includes('evergreen') && !i.includes('emoticon') && !i.includes('personal-expressions') && !i.startsWith('blob:'));

  const addToCollection = (msgs: ExtractedMessage[], hasImages: boolean) => {
    for (const m of msgs) {
      const cleaned = {
        sender: m.sender,
        senderAvatar: (m as any).senderAvatar || undefined,
        content: m.content,
        images: hasImages && (m as any).images?.length
          ? nonEmoji((m as any).images)
          : undefined,
        timestamp: m.timestamp as any,
        timestampMs: (m as any).timestampMs || Date.now(),
      };
      const key = `${cleaned.sender}|${cleaned.timestampMs}|${(cleaned.content || '').slice(0, 30)}`;
      const existing = allMessages.get(key);
      if (!existing) {
        allMessages.set(key, cleaned as any);
      } else if (cleaned.images?.length && !existing.images?.length) {
        allMessages.set(key, { ...existing, ...cleaned, images: cleaned.images });
      } else if (cleaned.images?.length && existing.images?.length) {
        const merged = [...new Set([...(existing.images || []), ...(cleaned.images || [])])];
        allMessages.set(key, { ...existing, images: merged });
      } else if (cleaned.senderAvatar && !existing.senderAvatar) {
        // Text-only pass (hasImages=false) drops the avatar — keep the one
        // captured by an earlier image pass.
        allMessages.set(key, { ...existing, senderAvatar: cleaned.senderAvatar });
      }
    }
  };

  // ── Step 1: Extract at BOTTOM with images (newest messages) ──
  log("[Incremental] Step 1: Extracting newest messages at bottom...");
  await page.evaluate(() => {
    const c =
      document.querySelector('[data-tid="message-pane-list-viewport"]') ||
      document.querySelector('[role="log"]') ||
      document.documentElement;
    c.scrollTop = c.scrollHeight;
  });
  await page.waitForTimeout(3_000);
  await page.evaluate(() => {
    document.querySelectorAll<HTMLImageElement>('img').forEach(img => {
      img.scrollIntoView({ block: "center", inline: "nearest" });
    });
  });
  await page.waitForTimeout(5_000);
  const bottomResult = await extractMessages(page, config, true);
  addToCollection(bottomResult.messages, true);
  log(`[Incremental] Bottom done: ${bottomResult.messages.length} msgs, ${bottomResult.messages.filter(m => m.images?.length).length} with images. Unique: ${allMessages.size}`);

  // ── Step 2: Incremental scroll-up (FULL SYNC only) ──
  if (fullSync && config.scrollCount > 0) {
    const totalBatches = Math.ceil(config.scrollCount / EXTRACT_EVERY_N);
    log(`[Incremental] Step 2: Scrolling up ${config.scrollCount}x, text-only extract every ${EXTRACT_EVERY_N} (${totalBatches} batches)`);

    for (let batch = 0; batch < totalBatches; batch++) {
      // Instead of jumping to scrollTop = 0 every time (which just re-captures the
      // same ~100 messages), scroll up in increments of 1 viewport height.
      // This progressively loads older messages from Teams' virtual DOM.
      for (let i = 0; i < EXTRACT_EVERY_N; i++) {
        const scrollNum = batch * EXTRACT_EVERY_N + i + 1;
        if (scrollNum > config.scrollCount) break;

        const scrollInfo = await page.evaluate(() => {
          const container =
            document.querySelector('[data-tid="message-pane-list-viewport"]') ||
            document.querySelector('[data-tid="message-list-container"]') ||
            document.querySelector('[data-tid="chat-pane"]') ||
            document.querySelector('[role="log"]') ||
            document.documentElement;
          const before = container.scrollTop;
          const vh = container.clientHeight || window.innerHeight;
          container.scrollBy({ top: -Math.round(vh * 0.8), behavior: 'instant' as any });
          return { before, after: container.scrollTop, vh, scrollHeight: container.scrollHeight };
        });
        if (scrollInfo.before === scrollInfo.after) {
          log(`[Incremental] Scroll ${scrollNum}: NO MOVEMENT (before=${scrollInfo.before}, vh=${scrollInfo.vh}, scrollHeight=${scrollInfo.scrollHeight})`);
        }
        await page.waitForTimeout(config.scrollWaitMs + randomInt(500, 1500));
      }

      const batchResult = await extractTextOnly(page, config);
      addToCollection(batchResult.messages, false);
      log(`[Incremental] Batch ${batch + 1}/${totalBatches}: ${batchResult.messages.length} text msgs, ${allMessages.size} unique`);
    }
  } else {
    log("[Incremental] Step 2: Skipped (quick update mode, scrollCount=0)");
  }

  // ── Step 3: Final extraction at TOP with images (oldest messages) ──
  if (fullSync) {
    log("[Incremental] Step 3: Final extraction at top (oldest messages + images)...");
    // Scroll to top progressively so Teams' virtual DOM loads the oldest messages
    await page.evaluate(() => {
      const container =
        document.querySelector('[data-tid="message-pane-list-viewport"]') ||
        document.querySelector('[role="log"]') ||
        document.documentElement;
      // Progressive scroll to top in steps
      const total = container.scrollTop;
      const steps = 5;
      for (let s = 1; s <= steps; s++) {
        container.scrollTop = total * (1 - s / steps);
      }
      container.scrollTop = 0;
    });
    await page.waitForTimeout(4_000);
    // Note: we intentionally do NOT scrollIntoView each img here — scrolling
    // away from the top region causes Teams' virtual DOM to recycle the
    // oldest messages, so only messages already in the DOM are captured.
    const topResult = await extractMessages(page, config, true);
    addToCollection(topResult.messages, true);
    log(`[Incremental] Top done: ${topResult.messages.length} msgs, ${topResult.messages.filter(m => m.images?.length).length} with images. Unique: ${allMessages.size}`);
  } else {
    log("[Incremental] Step 3: Skipped (quick update mode)");
  }

  // ── Build final result ──
  const finalMessages = Array.from(allMessages.values())
    .filter((m: any) => m.content || m.images?.length)
    .sort((a: any, b: any) => a.timestampMs - b.timestampMs);

  // ── Hydrate sender avatars ──
  // Teams avatar URLs (profilepicturev2) require the live browser session
  // (auth cookies + tokens) — server-side fetch without them returns 401.
  // Fetching in-page (same origin as the loaded Teams session) succeeds, so
  // we convert avatars to base64 data URLs which render anywhere.
  const avatarUrls = [...new Set(finalMessages.map((m) => (m as any).senderAvatar).filter((u): u is string => typeof u === 'string' && u.length > 0))];
  if (avatarUrls.length > 0) {
    log(`Hydrating ${avatarUrls.length} unique Teams avatars in-page...`);
    const avatarCache = new Map<string, string>();
    for (const url of avatarUrls) {
      try {
        const dataUrl = await page.evaluate(async (u: string) => {
          try {
            const r = await fetch(u, { credentials: "include", signal: AbortSignal.timeout(15000) });
            if (!r.ok) return null;
            const blob = await r.blob();
            return await new Promise<string | null>((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.onerror = () => resolve(null);
              reader.readAsDataURL(blob);
            });
          } catch {
            return null;
          }
        }, url);
        if (dataUrl && dataUrl.startsWith('data:')) {
          avatarCache.set(url, dataUrl);
        } else {
          log(`  avatar fetch failed: ${url.slice(0, 80)}`);
        }
      } catch (e) {
        log(`  avatar fetch error: ${String(e).slice(0, 80)}`);
      }
    }
    let hydrated = 0;
    for (const m of finalMessages) {
      const av = (m as any).senderAvatar;
      if (av && avatarCache.has(av)) {
        (m as any).senderAvatar = avatarCache.get(av);
        hydrated++;
      }
    }
    log(`Hydrated ${hydrated} Teams avatars (${avatarCache.size} unique).`);
  }

  const pageInfo = await page.evaluate(() => {
    const channelEl =
      document.querySelector<HTMLElement>('[data-tid="chat-title"]') ||
      document.querySelector<HTMLElement>('[data-tid="chat-header-title"]') ||
      document.querySelector<HTMLElement>('[data-tid="thread-header-title"]');
    return { channelName: channelEl?.textContent?.trim() || "Unknown Channel", teamName: "" };
  });

  const chatUrl = await getChatUrl(page);

  const result: TeamsExtractResult = {
    channelName: pageInfo.channelName,
    teamName: pageInfo.teamName,
    chatUrl,
    totalMessages: finalMessages.length,
    messages: finalMessages as ExtractedMessage[],
    extractedAt: new Date().toISOString(),
  };

  mergeOutput(result, config);
  log(`[Incremental] FINAL: ${result.totalMessages} messages, ${result.messages.filter(m => m.images?.length).length} with images.`);

  return result;
}

function mergeOutput(result: TeamsExtractResult, config: AutomatorConfig) {
  let existing: TeamsExtractResult | null = null;
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
  log(`Da luu ${output.totalMessages} tin nhan vao ${config.outputFile} (them ${newMsgs.length} moi).`);
}

/**
 * Auto-dismiss Teams "Use the web app" / app install overlay.
 * Teams often shows a blocking popup that needs to be clicked away.
 * Returns the active page (might be a new tab after clicking dismiss).
 */
async function dismissTeamsOverlay(page: Page, context: any): Promise<Page> {
  const overlaySelectors = [
    // "Stay better connected" page - main dismiss button
    'button:has-text("Use the web app instead"), button:has-text("Sử dụng web")',
    // Teams web "Use the web app" button (alternative text)
    'a[href*="use-the-web-app"], a[href*="webapp"], button:has-text("Use the web app")',
    // "Continue on web" or similar
    'button:has-text("Continue"), button:has-text("Tiếp tục")',
    // "Maybe later" / skip
    'button:has-text("Maybe later"), button:has-text("Để sau")',
    // Generic close buttons on overlays
    '[aria-label="Close"], .fui-FluentProvider button[aria-label="Close"]',
    // "Stay on web" 
    'button:has-text("Stay on web"), button:has-text("Ở lại web")',
    // "Continue to web" app promotion
    'button:has-text("Continue to web"), button:has-text("Tiếp tục với web")',
    // "X" close on the desktop app promotion banner
    'button[aria-label="Close promotion"], button[aria-label="Dismiss"]',
    // "Continue to web" link
    'a:has-text("Continue to web"), a:has-text("Tiếp tục với web")',
    // "Launch it now" — opens msteams protocol, ignore
  ];

  let currentPage = page;
  const pageCountBefore = context.pages().length;

  for (const sel of overlaySelectors) {
    try {
      const visible = await currentPage.locator(sel).first().isVisible({ timeout: 3_000 }).catch(() => false);
      if (visible) {
        await currentPage.locator(sel).first().click({ timeout: 5_000 });
        log("Da dismiss overlay: " + sel.slice(0, 70));
        await currentPage.waitForTimeout(4_000);

        // Check if a new tab was opened
        const allPages = context.pages();
        if (allPages.length > pageCountBefore) {
          // New tab detected — switch to it
          currentPage = allPages[allPages.length - 1];
          log(`Chuyen sang tab moi (total ${allPages.length}): ${currentPage.url().slice(0, 100)}`);
        }
        break; // Only click one
      }
    } catch { /* ignore */ }
  }

  return currentPage;
}

/**
 * Full automation flow:
 * 1. Create stealth browser
 * 2. Navigate to Teams
 * 3. Wait for login (if needed)
 * 4. Navigate to deep link
 * 5. Scroll and extract messages
 * 6. Save session
 * 7. Return result
 */
export async function runAutomation(
  config: AutomatorConfig
): Promise<TeamsExtractResult> {
  const { browser, context } = await createStealthContext(config);

  // Use existing page from persistent context or create new
  const page = context.pages()[0] || await context.newPage();
  await applyStealthPatches(page);

  try {
    // Step 1: Navigate to Teams homepage (v2 SPA)
    await navigateToTeams(page, config);

    // Step 2: Handle login if needed
    const neededLogin = await waitForLogin(page, config);
    if (neededLogin) {
      await context.storageState({ path: path.join(config.sessionDir, "state.json") });
      log("Da luu session sau khi dang nhap.");
      await page.waitForTimeout(5_000);
    }

    // Step 3: Navigate to specific chat via sidebar click
    if (config.chatName) {
      await navigateToChatInSidebar(page, config.chatName);
    } else if (config.deepLink) {
      log("Deep link khong ho tro trong Teams v2. Su dung chat hien tai.");
      log("Tip: Set config.chatName de navigate den chat cu the.");
    }

    // Step 4 & 5: Incremental scroll-and-extract (catches messages at every stage
    // to work around Teams virtual DOM which only keeps ~100-200 messages rendered)
    const result = await incrementalScrollAndExtract(page, config);

    // Step 6: Save session
    await context.storageState({ path: path.join(config.sessionDir, "state.json") });
    log("Da luu session (sau extract).");

    return result;
  } finally {
    await context.storageState({ path: path.join(config.sessionDir, "state.json") }).catch(() => {});

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
