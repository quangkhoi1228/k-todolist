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
import { execSync, spawn } from "child_process";

// (Browser-only — được eval trong page.evaluate qua arg avatarSource.)
declare function isUsableZaloAvatarSrc(src: string): boolean;

/**
 * Kiểm tra nhanh (không đọc cả file lặp) — có send lock nào đang chờ không.
 * zalo-send.ts / teams-send.ts ghi `.zalo-send-running` / `.teams-send-running`
 * NGAY KHI bấm gửi. Sync đang scroll thấy lock này → dừng sớm nhường Chrome.
 */
export function isSendWaiting(): boolean {
  try {
    for (const file of [".zalo-send-running", ".teams-send-running"]) {
      const lockPath = path.join(process.cwd(), file);
      if (fs.existsSync(lockPath)) {
        const pid = parseInt(fs.readFileSync(lockPath, "utf-8").trim(), 10);
        if (!isNaN(pid)) {
          try { process.kill(pid, 0); return true; } catch { /* pid chết -> lock stale */ }
        }
      }
    }
  } catch { /* ignore */ }
  return false;
}

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
  useRealChrome: true,
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

/** Outer Chrome window — vừa laptop 13/14" (avail ~1440×900 / 1512×982). */
const CHROME_WINDOW_WIDTH = 1280;
const CHROME_WINDOW_HEIGHT = 800;

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

  // Không gọi setViewportSize ở đây. Persistent Chrome dùng viewport:null
  // (layout theo inner size thật). Ép viewport lớn hơn cửa sổ → UI Zalo
  // tràn, ô nhập tin (#richInput) ở đáy bị cắt không nhìn thấy.
}

/**
 * Đặt cửa sổ Chrome vừa màn hình thật (không tràn, ô input ở đáy còn nhìn thấy).
 * Chrome persistent profile hay restore kích thước cũ (vd 1600×1000) nên cần
 * ghi đè sau khi launch. Bỏ qua khi sync nền / headless.
 */
export async function fitWindowToScreen(page: Page): Promise<void> {
  if (process.env.SYNC_BACKGROUND === "1") return;
  if (process.env.HEADLESS === "true" || process.env.HEADLESS === "1") return;
  try {
    // Bỏ emulated viewport (nếu Playwright từng setViewportSize) — phải gọi
    // trên page session. Layout sẽ theo inner size thật của cửa sổ.
    try {
      const pageSession = await page.context().newCDPSession(page);
      await pageSession.send("Emulation.clearDeviceMetricsOverride");
      await pageSession.detach().catch(() => {});
    } catch {
      /* no override */
    }

    const screenInfo = await page.evaluate(() => ({
      availW: window.screen.availWidth,
      availH: window.screen.availHeight,
    }));

    const marginX = 48;
    const marginY = 72; // menu bar + dock
    const maxW = Math.max(1024, screenInfo.availW - marginX);
    const maxH = Math.max(700, screenInfo.availH - marginY);
    const width = Math.min(CHROME_WINDOW_WIDTH, maxW);
    const height = Math.min(CHROME_WINDOW_HEIGHT, maxH);
    const left = Math.max(16, Math.floor((screenInfo.availW - width) / 2));
    const top = Math.max(28, Math.floor((screenInfo.availH - height) / 5));

    // Browser.setWindowBounds cần browser-level CDP session (giống minimizeZaloCdpWindow).
    const browser = page.context().browser();
    const session = browser
      ? await (browser as any).newBrowserCDPSession()
      : await page.context().newCDPSession(page);
    const targetId = (page as any)._target?._targetId;
    const { windowId } = await session.send(
      "Browser.getWindowForTarget",
      targetId ? { targetId } : {}
    );
    await session.send("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState: "normal", left, top, width, height },
    });
    await session.detach().catch(() => {});
    log(`Fit window ${width}x${height} (screen avail ${screenInfo.availW}x${screenInfo.availH})`);
  } catch (e) {
    log(`Fit window CDP loi (${String(e).slice(0, 100)}) — fallback resizeTo.`);
    try {
      await page.evaluate(
        ({ w, h }) => {
          window.moveTo(24, 40);
          window.resizeTo(w, h);
        },
        { w: CHROME_WINDOW_WIDTH, h: CHROME_WINDOW_HEIGHT }
      );
    } catch {
      /* ignore */
    }
  }
}

// ─── Browser Helpers ────────────────────────────────────────

export async function createZaloStealthContext(config: ZaloAutomatorConfig): Promise<{
  browser: Browser;
  context: BrowserContext;
}> {
  ensureDir(config.sessionDir);
  ensureDir(config.screenshotDir);

  // ── CDP mode: CHỈ khi ZALO_ALLOW_CDP=1 ──
  // Port 9222 gần như luôn là Chrome profile TEAMS. Zalo connect nhầm vào đó
  // → tab Zalo trong profile sai (QR / "Đổi thiết bị") rồi fallback Chromium
  // test — đúng triệu chứng "mở thừa 1 profile test trước, chưa thành công".
  if (
    (process.env.ZALO_ALLOW_CDP === "1" || process.env.ZALO_ALLOW_CDP === "true") &&
    (process.env.USE_CDP === "1" || process.env.USE_CDP === "true")
  ) {
    const port = Number(process.env.CDP_PORT || 9222);
    const cdpUrl = `http://127.0.0.1:${port}`;
    log(`CDP mode: connecting to real Chrome at ${cdpUrl}`);
    try {
      const browser = await chromium.connectOverCDP(cdpUrl, { timeout: 2_500 });
      const context = browser.contexts()[0];
      if (!context) throw new Error("CDP browser has no default context.");

      // Đánh dấu CDP connect thành công — script con dùng để biết có nên
      // mở tab riêng (sync song song) hay fallback đang dùng persistent
      // profile (phải đóng cả browser).
      process.env.SYNC_CDP_CONNECTED = "1";

      context.on("page", (newPage) => {
        newPage.on("dialog", async (dialog) => {
          log("Phat hien dialog (tab moi): " + dialog.message().slice(0, 80));
          await dialog.dismiss().catch(() => {});
        });
      });

      // Do NOT close the user's Chrome when the automation finishes.
      // Giữ browser thật (có newBrowserCDPSession cho helper mở tab nền) —
      // chỉ chặn close() để không đóng Chrome của user.
      const fakeBrowser = new Proxy(browser, {
        get(target, prop, receiver) {
          if (prop === "close") {
            return async () => { log("CDP mode: giu Chrome that mo (khong dong)."); };
          }
          return Reflect.get(target, prop, receiver);
        },
      }) as Browser;

      return { browser: fakeBrowser, context };
    } catch (cdpErr) {
      // Chrome CDP khong chay (crash, chua mo, hoac bi kill nham). Khong fail
      // cung — fallback xuong mo Chrome rieng voi persistent profile (cung
      // session/cookies) de "Tai nhom"/sync van chay duoc.
      log(`CDP connect that bai (${String(cdpErr).slice(0, 120)}). Fallback: mo Chrome rieng voi persistent profile.`);
    }
  }

  if (config.useRealChrome !== false) {
    const profileDir = path.join(config.sessionDir, "chrome-profile");
    ensureDir(profileDir);

    // ── Cleanup orphan Chrome + stale locks ─────────────
    // Playwright sometimes leaves the browser process running (kill EPERM on
    // macOS) while holding the profile lock; a later run then aborts with
    // "Aborting now to avoid profile corruption" or "Opening in existing
    // browser session" (stale SingletonLock pointing at a dead pid).
    //
    // IMPORTANT: only kill Chrome processes whose parent pid is 1 (orphaned
    // by a CRASHED/closed previous script). Never kill a live Chrome owned by
    // ANOTHER running script using the same profile — the auto-sync
    // (sync-all-projects spawned by next-server) and zalo-send share
    // `.zalo-session/chrome-profile`, and a blanket kill here was killing
    // the other script's browser mid-flight, producing "Target page, context
    // or browser has been closed".
    //
    // CRITICAL (08/08): the USER's manually opened CDP Chrome
    // (`open -n ... --user-data-dir=<profile> --remote-debugging-port=9222`)
    // looks like an "orphan": `open -n` detaches it so its ppid is 1
    // (launchd) and its cmdline contains the profile path. Killing it broke
    // the "Tải nhóm" button (connect ECONNREFUSED 127.0.0.1:9222). We only
    // SIGKILL Chrome whose cmdline has `--remote-debugging-pipe` (Playwright
    // launches with it); a CDP browser keeps `--remote-debugging-port=9222`
    // and is NEVER killed here.
    try {
      const chromePaths = execSync("pgrep -fl 'Google Chrome'", { encoding: "utf8" }).split("\n");
      for (const line of chromePaths) {
        if (!line.includes(profileDir)) continue;
        if (!line.includes("--remote-debugging-pipe")) continue; // Playwright-spawned only
        const m = line.match(/^(\d+)\s/);
        if (!m) continue;
        const pid = Number(m[1]);
        // Skip processes that are NOT orphans (still owned by a live parent —
        // i.e. a browser another script is actively using).
        try {
          const ppidStr = execSync(`ps -o ppid= -p ${pid}`, { encoding: "utf8" }).trim();
          const ppid = Number(ppidStr);
          if (ppid > 1) continue;
        } catch {
          continue; // process already gone
        }
        try {
          process.kill(pid, "SIGKILL");
          log(`Da kill Chrome orphan (pid=${pid}, ppid=1) giu lock profile.`);
        } catch {
          // process may have exited already — ignore
        }
      }
      await new Promise((r) => setTimeout(r, 800));
    } catch {
      // pgrep not available / no matches — ignore
    }

    // ── Remove stale SingletonLock/Socket/Cookie ────────
    // Chrome writes SingletonLock containing "<hostname>-<pid>". If that pid
    // is dead but the file survived (kill EPERM on macOS), Chrome refuses to
    // start with "Opening in existing browser session". Remove the lock only
    // when its pid is no longer alive — never while another script's Chrome
    // is still running on this profile.
    for (const lockName of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
      const lockPath = path.join(profileDir, lockName);
      try {
        if (!fs.existsSync(lockPath)) continue;
        const lockContent = fs.readFileSync(lockPath, "utf-8").trim();
        const pidMatch = lockContent.match(/(\d+)$/);
        let pidAlive = false;
        if (pidMatch) {
          const lockPid = Number(pidMatch[1]);
          try {
            process.kill(lockPid, 0);
            pidAlive = true;
          } catch {
            pidAlive = false;
          }
        }
        if (!pidAlive) {
          fs.unlinkSync(lockPath);
          log(`Da xoa stale lock ${lockName} (pid trong lock khong con song).`);
        }
      } catch (e) {
        log(`Không thể xử lý lock ${lockName}: ${String(e).slice(0, 80)}`);
      }
    }

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
      log("Không thể ghi Preferences: " + e);
    }

    log(`Mo Chrome that voi persistent profile: ${profileDir}`);

    // ── Trước khi launch: nếu profile đang bị Chrome KHÁC giữ (live) mà
    // không phải orphan/pipe của mình → launch thất bại "Failed to create a
    // ProcessSingleton" (2 Chrome cùng user-data-dir). Detect sớm để trả
    // lỗi rõ ràng thay vì crash.
    const profileTaken = (() => {
      try {
        const lines = execSync("pgrep -fl 'Google Chrome'", { encoding: "utf8" }).split("\n");
        for (const line of lines) {
          if (!line.includes(profileDir)) continue;
          if (/\s--type=/.test(line) || /Google Chrome Helper/.test(line)) continue; // GPU/Renderer Helper
          if (line.includes("--remote-debugging-pipe")) continue; // pipe-cùng script khác, sẽ được cleanup
          const m = line.match(/^(\d+)\s/);
          if (!m) continue;
          const pid = Number(m[1]);
          try {
            process.kill(pid, 0);
            return pid; // live non-pipe Chrome đang giữ profile
          } catch {
            // process gone — ignore
          }
        }
      } catch {
        // pgrep unavailable
      }
      return null;
    })();
    if (profileTaken) {
      throw new Error(
        `Zalo profile đang bị Chrome khác dùng (pid=${profileTaken}, sync/send/đang mở). ` +
        `Trả busy thay vì mở Chrome thứ 2 cùng profile.`
      );
    }

    const persistentContext = await chromium.launchPersistentContext(profileDir, {
      channel: "chrome",
      headless: config.headless,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        `--window-size=${CHROME_WINDOW_WIDTH},${CHROME_WINDOW_HEIGHT}`,
        "--lang=vi-VN",
        // ── Suppress "Restore pages?" crash bubble ──
        "--disable-session-crashed-bubble",
        "--disable-restore-session-state",
        // ── Fix macOS headless cookie decryption issue ──
        "--password-store=basic",
        "--use-mock-keychain",
        // ── Sync nền (queue): minimized để không bật popup gây lag khi
        // user đang làm việc. Khi chạy tay (scan QR / debug) không set
        // SYNC_BACKGROUND → Chrome hiện bình thường. ──
        ...(process.env.SYNC_BACKGROUND === "1"
          ? ["--window-position=-32000,-32000"]
          : ["--window-position=40,60"]),
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
    if (!config.headless) await fitWindowToScreen(page).catch(() => {});

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

    // ── Best-effort child-process reaping ────────────────
    // Playwright's close() can leave the Chrome child running (kill EPERM on
    // macOS). Spawn a short-lived watcher that SIGKILLs it once this script
    // exits (when our parent dies we are reparented to pid 1 — ppid check is
    // robust against pid reuse), so the profile lock never outlives the run.
    //
    // IMPORTANT: the watcher only SIGKILLs Chrome processes whose parent pid
    // is 1 (orphaned by THIS script) — NOT a blanket `pkill -f <profileDir>`.
    // The blanket pkill was killing the Chrome instance of a *different*
    // automation process using the same profile (e.g. a running
    // sync-single-chat killed the teams-send browser mid-flight, producing
    // "Target page, context or browser has been closed").
    //
    // (08/08) Scope further still: `pkill -P 1 -f <profileDir>` ALSO matched
    // the user's manually-opened CDP Chrome (`open -n` detaches it → ppid=1,
    // cmdline contains the profile path) and killed it, breaking "Tải nhóm"
    // (ECONNREFUSED 127.0.0.1:9222). Since Playwright's persistent Chrome is
    // the only process we need to reap and we know its pid (from the pgrep
    // cleanup above, which now only selects `--remote-debugging-pipe`
    // processes), the watcher reaps only that exact pid.
    let chromePid = 0;
    try {
      const chromePaths = execSync("pgrep -fl 'Google Chrome'", { encoding: "utf8" }).split("\n");
      for (const line of chromePaths) {
        if (!line.includes(profileDir)) continue;
        if (!line.includes("--remote-debugging-pipe")) continue;
        const m = line.match(/^(\d+)\s/);
        if (m) { chromePid = Number(m[1]); break; }
      }
    } catch { /* no chrome */ }

    const detached = spawn(
      process.execPath,
      [
        "-e",
        `const int=setInterval(()=>{if(process.ppid===1){clearInterval(int);try{process.kill(${chromePid},'SIGKILL')}catch{};process.exit(0)}},1000);setTimeout(()=>{clearInterval(int);process.exit(0)},60000);`,
      ],
      { detached: true, stdio: "ignore" }
    );
    detached.unref();
    log(`Watcher reap Chrome orphan (pid=${chromePid}) — chi kill Playwright Chrome, khong pkill rong.`);

    return { browser: fakeBrowser, context: persistentContext };
  }

  throw new Error(
    "Zalo cần Google Chrome + profile `.zalo-session/chrome-profile` (không mở Chromium test)."
  );
}

// ─── Helper: mở tab nền (tránh popup khi sync nền) ──────────
// Giống openTeamsTabInBackground bên teams-automator: CDP mode mở tab bằng
// `Target.createTarget background:true` — không focus window, không popup.
// Khi sync chạy nền (HEADLESS=true / SYNC_BACKGROUND=1) cũng thu nhỏ window.
export interface OpenZaloTabOptions {
  /** Mở tab như tab nền (không focus). Mặc định true khi CDP connect. */
  background?: boolean;
  /** Thu nhỏ window chứa tab sau khi mở. Mặc định theo HEADLESS/SYNC_BACKGROUND. */
  minimize?: boolean;
  /** URL khởi tạo cho tab (mặc định about:blank — navigateToZalo sẽ goto). */
  url?: string;
}

export async function openZaloTabInBackground(
  browser: Browser,
  context: BrowserContext,
  opts: OpenZaloTabOptions = {}
): Promise<Page> {
  const isCdp = process.env.SYNC_CDP_CONNECTED === "1" || process.env.USE_CDP === "1";
  const isHeadless = process.env.HEADLESS === "true" || process.env.HEADLESS === "1";
  const background = opts.background ?? isCdp;
  const minimize = opts.minimize ?? (isHeadless || process.env.SYNC_BACKGROUND === "1");

  // CDP mode: tạo tab BACKGROUND qua protocol — không focus window hiện tại.
  if (isCdp && background) {
    try {
      const session = await (browser as any).newBrowserCDPSession();
      const existingPages = new Set(context.pages());
      await session.send("Target.createTarget", {
        url: opts.url || "about:blank",
        background: true,
      });
      await session.detach().catch(() => {});
      const deadline = Date.now() + 8_000;
      let created: Page | null = null;
      while (Date.now() < deadline) {
        const page = context.pages().find((p) => !existingPages.has(p));
        if (page) { created = page; break; }
        await new Promise((r) => setTimeout(r, 200));
      }
      if (created) {
        log("CDP: da mo tab Zalo BACKGROUND (khong hien cua so popup).");
        return created;
      }
      log("CDP: tao tab Zalo background that bai (page chua xuat hien) — chuyen sang newPage().");
    } catch (e) {
      log(`CDP: tao tab Zalo background loi (${String(e).slice(0, 100)}) — fallback newPage().`);
    }
  }

  const page = await context.newPage();
  if (minimize) await minimizeZaloCdpWindow(browser, page).catch(() => {});
  return page;
}

/** Thu nhỏ cửa sổ Chrome CDP chứa page (không focus → không nhảy popup). */
export async function minimizeZaloCdpWindow(browser: Browser, page: Page): Promise<boolean> {
  if (process.env.SYNC_CDP_CONNECTED !== "1") return false;
  try {
    const session = await (browser as any).newBrowserCDPSession();
    const targetId = (page as any)._target?._targetId;
    const { windowId } = await session.send("Browser.getWindowForTarget", targetId ? { targetId } : {});
    await session.send("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState: "minimized" },
    });
    await session.detach().catch(() => {});
    log("CDP: da thu nho cua so Chrome (minimized) de khong lam phien man hinh.");
    return true;
  } catch (e) {
    log(`CDP: thu nho window loi (${String(e).slice(0, 100)}) — bo qua.`);
    return false;
  }
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
    log("Cần đăng nhập Zalo. Vui lòng scan QR code trong cửa sổ browser...");
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
  // Poll conversation list xuất hiện — dừng ngay khi app render xong
  // (không chờ đủ 5s nếu session ấm, tab cũ đã load sẵn).
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const ready = await page.evaluate(() =>
        !!document.querySelector('#conversationListId, [data-id="conversations-list"], .conv-list, .chat-list, [class*="conversation-list"]')
      );
      if (ready) break;
    } catch { /* app đang load */ }
    await page.waitForTimeout(400);
  }
  log(`URL: ${page.url()}`);
}

// ─── Group Navigation ────────────────────────────────────────

/**
 * Navigate to a specific group chat by clicking on it in the sidebar.
 * Handles scrolling and searching.
 */
/**
 * Find the index (within the sidebar selector) of the conversation item whose
 * TITLE matches `name` (exact normalized equality, NOT substring — "Thảo
 * Nguyên BB" must never match "Thảo Nguyên BB 2"). Only the item title is
 * compared so sender names in message previews are ignored. Returns -1 when
 * not found.
 */
async function findConversationItemIndex(page: Page, name: string): Promise<number> {
  const normalized = name.trim().replace(/\s+/g, " ").toLowerCase();
  return page.evaluate((target) => {
    const items = Array.from(document.querySelectorAll(
      '[class*="conv-item"], [class*="conversation-item"], [class*="ChatItem"], [role="listitem"]'
    ));
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const titleEl = item.querySelector('[class*="name"], [class*="title"], .truncate');
      const text = (titleEl ? titleEl.textContent : item.textContent) || "";
      const norm = text.replace(/\u00a0/g, " ").trim().replace(/\s+/g, " ").toLowerCase();
      if (norm === target) return i;
    }
    return -1;
  }, normalized);
}

/**
 * Read the currently open chat name from the Zalo DOM:
 * - `header .header-title` (verified live: the open chat's title bar), or
 * - the sidebar item carrying the "selected"/"active" class.
 * Returns the normalized name or "" when no chat is open.
 */
export async function getZaloOpenChatName(page: Page): Promise<string> {
  try {
    return await page.evaluate(() => {
      const headerEl =
        document.querySelector<HTMLElement>('.header-title') ||
        document.querySelector<HTMLElement>('.chat-info .title') ||
        document.querySelector<HTMLElement>('header [class*="name"]');
      const headerName = headerEl?.textContent?.trim().replace(/\u00a0/g, " ") || "";

      if (headerName) return headerName;

      // Fallback: sidebar selected item
      for (const item of Array.from(document.querySelectorAll('[class*="conv-item"]'))) {
        const cls = (item.className || "").toString();
        if (cls.includes("selected") || cls.includes("--active") ||
            (item as HTMLElement).getAttribute("aria-selected") === "true") {
          const titleEl = item.querySelector('[class*="name"], [class*="title"], .truncate');
          return (titleEl?.textContent || item.textContent || "").trim().replace(/\u00a0/g, " ");
        }
      }
      return "";
    });
  } catch {
    return "";
  }
}

/**
 * Verify the chat actually open in Zalo is the expected one, using the DOM
 * header (`.header-title`) and the sidebar "selected" state. Returns
 * { verified, openName, reason }.
 */
export async function verifyZaloOpenChat(
  page: Page,
  expectedName: string
): Promise<{ verified: boolean; openName: string; reason: string }> {
  const normalize = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const openName = (await getZaloOpenChatName(page)).trim();
  const target = normalize(expectedName);

  if (!openName) {
    return { verified: false, openName, reason: "no chat header visible" };
  }
  if (normalize(openName) === target) {
    return { verified: true, openName, reason: "header matches" };
  }
  return {
    verified: false,
    openName,
    reason: `header is "${openName}", expected "${expectedName}"`,
  };
}

/**
 * Poll the open chat header until it matches `expectedName` (or timeout).
 * Faster than a fixed wait: returns as soon as the header matches, so a chat
 * that renders instantly doesn't waste the full wait; still gives lazy-loaded
 * chats up to `timeoutMs` to appear. Falls back to a single verify on timeout.
 */
export async function waitForZaloOpenChat(
  page: Page,
  expectedName: string,
  timeoutMs = 3_000
): Promise<{ verified: boolean; openName: string; reason: string }> {
  const normalize = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const target = normalize(expectedName);
  const deadline = Date.now() + timeoutMs;
  let last: { verified: boolean; openName: string; reason: string } = {
    verified: false,
    openName: "",
    reason: "no chat header visible",
  };
  while (Date.now() < deadline) {
    last = await verifyZaloOpenChat(page, expectedName);
    if (last.verified) return last;
    // Header chưa match — có thể chat đang lazy render, chờ ngắn rồi thử lại
    await page.waitForTimeout(250);
  }
  return last;
}

/**
 * Navigate to a specific group chat by clicking it in the sidebar.
 *
 * IMPORTANT: clicks are REAL Playwright clicks (page.locator().click()).
 * Zalo's SPA does NOT reliably switch chats when the click is dispatched via
 * element.click() in page.evaluate — the sidebar may highlight the item but
 * the chat view stays on the previous conversation, so a sync would extract
 * the WRONG chat's messages. Real pointer events are the only dependable way.
 *
 * Returns true when the target chat is verified open in the chat view.
 */
export async function navigateToZaloGroup(
  page: Page,
  groupName: string
): Promise<boolean> {
  if (!groupName) return false;

  log(`Tim kiem nhom chat Zalo: "${groupName}" trong sidebar...`);

  // Close any open search/overlay that intercepts pointer events
  // (recent-search-list overlay has been observed blocking sidebar clicks)
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);

  const tryClickGroup = async (): Promise<boolean> => {
    const idx = await findConversationItemIndex(page, groupName);
    if (idx < 0) return false;
    const item = page
      .locator('[class*="conv-item"], [class*="conversation-item"], [class*="ChatItem"], [role="listitem"]')
      .nth(idx);
    try {
      await item.scrollIntoViewIfNeeded({ timeout: 3_000 });
      await item.click({ timeout: 8_000, force: false });
      // Chờ chat render — poll header thay vì wait cứng 3s (nhanh hơn khi
      // chat đã sẵn trong DOM, đủ thời gian khi chat cần lazy render).
      const check = await waitForZaloOpenChat(page, groupName, 3_000);
      if (check.verified) {
        log(`Da mo dung nhom Zalo: "${check.openName}"`);
        return true;
      }
      log(`Click vao item "${groupName}" nhung chat dang mo la "${check.openName}" (${check.reason}) — thu cach khac.`);
      return false;
    } catch (e) {
      log(`Click item "${groupName}" that bai: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
      return false;
    }
  };

  // Attempt 1: Direct click on the visible sidebar item
  if (await tryClickGroup()) return true;

  // Attempt 2: Use Zalo's search box to find the group, then click the result
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

      if (await tryClickGroup()) {
        // Clear the search box so the next group sync starts from a clean list
        const clearBtn = page.locator('[class*="clear-search"], [icon="close"]').first();
        if (await clearBtn.isVisible().catch(() => false)) {
          await clearBtn.click();
        } else {
          await searchBox.fill("");
        }
        await page.waitForTimeout(1_000);
        return true;
      }

      // Clear search if not found
      await searchBox.fill("");
      await page.waitForTimeout(500);
    }
  } catch {
    log("Không thể sử dụng search box.");
  }

  // Attempt 3: Scroll the sidebar to load more items, then click
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

    if (await tryClickGroup()) return true;
  }

  log(`Không tìm thấy nhóm Zalo "${groupName}" trong sidebar.`);
  await page.screenshot({ path: path.join(DEFAULT_ZALO_CONFIG.screenshotDir, `not-found-${Date.now()}.png`) });
  return false;
}

/**
 * Zalo Web only keeps ONE tab active per session. When another tab is opened
 * (parallel sync, or the user's own Zalo tab), a fresh tab shows
 * "Bạn đang mở Zalo trên một Tab khác..." with a "Kích hoạt" button and the
 * whole app (`#app`) is hidden (display:none) — a sync on such a tab silently
 * extracts 0 messages. Reloading the tab re-runs Zalo's activation check;
 * once all other Zalo tabs are closed, the reloaded tab becomes the active
 * session and the conversation renders normally. We wait until #app is
 * actually visible (with a chat header present) before scrolling/extracting.
 *
 * NOTE: parallel sync can only WORK for ONE Zalo chat at a time because of
 * this limitation — other Zalo tasks will keep retrying here until their tab
 * becomes the active one.
 */
export async function ensureZaloTabActive(page: Page, config: ZaloAutomatorConfig): Promise<boolean> {
  const deadline = Date.now() + (config.loginTimeoutMs || 120_000);
  let attempts = 0;

  const isAppVisible = async (): Promise<boolean> => {
    return page.evaluate(() => {
      const app = document.getElementById("app");
      if (!app) return false;
      if (getComputedStyle(app).display === "none") return false;
      // App hiển thị nhưng vẫn còn overlay "Kích hoạt" thì coi như chưa active
      const overlay = Array.from(document.querySelectorAll("div")).some(
        (el) => (el.textContent || "").includes("Nhấn kích hoạt để sử dụng trên Tab này")
      );
      return !overlay;
    }).catch(() => false);
  };

  while (Date.now() < deadline) {
    attempts++;
    const visible = await isAppVisible();
    if (visible) {
      log(`[Zalo] Tab da active (lan thu ${attempts}).`);
      return true;
    }

    const url = page.url();
    log(`[Zalo] Tab chua active (overlay "Kich hoat") — reload lan ${attempts} (${url.slice(0, 60)}).`);
    try {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 45_000 });
    } catch {
      // reload có thể fail khi tab vừa bị đóng/điều hướng — thử lại vòng sau
    }
    await page.waitForTimeout(4_000 + randomInt(0, 2_000));
    // Sau reload, nếu chưa có session (login page) → chờ redirect về chat.zalo.me
    if (page.url().includes("id.zalo.me") || page.url().includes("login")) {
      await page.waitForTimeout(3_000);
    }
  }

  log("[Zalo] Hết thời gian chờ tab active — sync tiếp tục (có thể extract rỗng).");
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
/**
 * Scroll the Zalo chat and COLLECT messages in chunks so both the OLDEST and
 * the NEWEST messages survive ReactVirtualized's DOM recycling.
 *
 * Old behavior scrolled ALL the way to the top and extracted ONCE at the end —
 * Zalo virtualizes the message list, so once you reach the top the newest
 * messages are unmounted from the DOM and the final extract silently misses
 * them ("thiếu message ở cuối"). Now we:
 *   - start at the bottom (newest loaded first)
 *   - scroll up CHUNK_SCROLLS at a time
 *   - collect whatever is currently rendered after each chunk
 *   - go to the next chunk
 * This keeps a moving window: newest messages are captured in the first pass,
 * older ones in later passes. `scrollCount` keeps its meaning (total number
 * of scroll steps). For incremental syncs we still early-stop once the DOM's
 * newest bubble is at/below the DB watermark.
 *
 * Returns the combined (unsorted, unhydrated) messages from all passes —
 * callers must run finalizeZaloMessages() before saving.
 */
export async function scrollZaloChatContainer(
  page: Page,
  config: ZaloAutomatorConfig
): Promise<ZaloExtractedMessage[]> {
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

  // Mỗi chunk: số scroll tối đa trước khi collect DOM. Collect thường xuyên
  // giữ cửa sổ DOM nhỏ (ReactVirtualized) — message mới nhất không bị mất.
  const CHUNK_SCROLLS = 30;
  const totalScrolled = config.scrollCount > 0 ? config.scrollCount : 1;
  const collected: ZaloExtractedMessage[] = [];

  // Dedup theo platformMsgId (bb_msg_id) + fallback sender|content|ts — các
  // pass collect lặp lại nhiều message giống nhau.
  const seen = new Set<string>();
  const pushUnique = (msgs: ZaloExtractedMessage[]) => {
    for (const m of msgs) {
      const key = m.platformMsgId
        ? `id:${m.platformMsgId}`
        : `fallback:${m.sender}|${(m.content || "").slice(0, 100)}|${m.timestamp}`;
      if (seen.has(key)) continue;
      seen.add(key);
      collected.push(m);
    }
  };

  // Ensure we are at the BOTTOM of the chat so the newest messages load.
  // Zalo keeps the previous scroll position when reopening a chat and
  // renders messages lazily, so a single `scrollTop = scrollHeight` right
  // after opening can land MID-chat (scrollHeight at that moment only
  // covers what has been rendered so far, and newer bubbles that load
  // afterwards never move the scroll position down). Repeat until the
  // container truly reaches the bottom — i.e. the scroll offset stops
  // growing AND the newest visible message timestamp stops advancing.
  // 10s đủ: chat đã được navigateToZaloGroup mở + verify header trước đó nên
  // message pane render nhanh. Nhóm RỖNG (không có tin) sẽ timeout — trước đây
  // chờ tận 20s vô ích mỗi lần sync nhóm rỗng.
  await page
    .waitForSelector('[id^="bb_msg_id_"], [class*="message-wrapper"], [class*="chat-message"]', {
      timeout: 10_000,
    })
    .catch(() => log("[Zalo] Không thấy message nào sau khi mở chat — tiếp tục..."));
  await page.waitForTimeout(1_500);

  const scrollToBottom = `
    const __getZaloScrollContainer = ${getScrollContainer.toString()};
    (function() {
      const container = __getZaloScrollContainer();
      container.scrollTop = container.scrollHeight;
    })();
  `;
  const getBottomState = `
    const __getZaloScrollContainer = ${getScrollContainer.toString()};
    (function() {
      const container = __getZaloScrollContainer();
      let maxTs = -1;
      document.querySelectorAll('[id^="bb_msg_id_"]').forEach((el) => {
        const m = (el.id || "").match(/bb_msg_id_(\\d+)/);
        if (m) {
          const ts = parseInt(m[1], 10);
          if (ts > maxTs) maxTs = ts;
        }
      });
      return {
        maxTs,
        atBottom: container.scrollTop + container.clientHeight >= container.scrollHeight - 5,
        scrollTop: container.scrollTop,
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
      };
    })();
  `;

  interface BottomState {
    maxTs: number;
    atBottom: boolean;
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
  }
  let prevMaxTs = -1;
  for (let attempt = 0; attempt < 3; attempt++) {
    // Send preemption: nhường Chrome ngay khi send bấm gửi.
    if (isSendWaiting()) {
      log(`[Zalo] Send đang chờ — dừng bottom-stabilize sớm (attempt ${attempt}).`);
      pushUnique(await collectZaloMessagesFromPage(page, config));
      return collected;
    }
    await page.evaluate(scrollToBottom);
    await page.waitForTimeout(1_000);
    const state = (await page.evaluate(getBottomState)) as BottomState;
    // Đã ở đáy ngay lần đầu → không cần lặp thêm (tránh 5 lần chờ thừa)
    if (state.atBottom && attempt === 0 && state.maxTs > 0) {
      log(`[Zalo] Da o cuoi chat ngay lan dau: maxTs=${state.maxTs}.`);
      break;
    }
    const settled = state.atBottom && state.maxTs <= prevMaxTs && prevMaxTs > 0;
    if (settled) {
      log(`[Zalo] Da o cuoi chat (bottom ổn định): maxTs=${state.maxTs} sau ${attempt + 1} lan.`);
      break;
    }
    if (attempt === 2) {
      log(`[Zalo] Bottom chưa ổn định sau 3 lần (scrollTop=${state.scrollTop}/${state.scrollHeight}, maxTs=${state.maxTs}) — tiếp tục với vùng DOM hiện tại.`);
    }
    prevMaxTs = state.maxTs;
  }

  // ── Step 1: Fast Timestamp Check & Collect at BOTTOM ──
  if (config.incrementalSince !== undefined && config.incrementalSince > 0) {
    const tsInfo = await page.evaluate(() => {
      let maxTs = -1;
      let minTs = Infinity;
      document.querySelectorAll<HTMLElement>('[id^="bb_msg_id_"]').forEach((el) => {
        const m = (el.id || "").match(/bb_msg_id_(\d+)/);
        if (m) {
          const ts = parseInt(m[1], 10);
          if (ts > maxTs) maxTs = ts;
          if (ts < minTs) minTs = ts;
        }
      });
      return { maxTs, minTs: minTs === Infinity ? -1 : minTs };
    });

    if (tsInfo.maxTs > 0 && tsInfo.maxTs <= config.incrementalSince) {
      log(`[Incremental] EARLY-STOP before extract: max visible time ${tsInfo.maxTs} <= watermark ${config.incrementalSince}. (0 new messages)`);
      return collected;
    }
  }

  // Collect first pass (newest messages — CRITICAL, đừng để scroll lên làm mất)
  pushUnique(await collectZaloMessagesFromPage(page, config));

  if (config.incrementalSince !== undefined && config.incrementalSince > 0) {
    const tsInfo = await page.evaluate(() => {
      let maxTs = -1;
      document.querySelectorAll<HTMLElement>('[id^="bb_msg_id_"]').forEach((el) => {
        const m = (el.id || "").match(/bb_msg_id_(\d+)/);
        if (m) {
          const ts = parseInt(m[1], 10);
          if (ts > maxTs) maxTs = ts;
        }
      });
      return { maxTs };
    });

    // Chỉ EARLY-STOP khi tin MỚI NHẤT trong cửa sổ <= watermark (mọi tin đã
    // sync). KHÔNG dùng minTs: cửa sổ DOM hiển thị cả tin cũ lẫn tin mới —
    // nếu dựa vào minTs (tin cũ nhất) sẽ dừng sớm và BỎ SÓT tin mới ở cuối
    // cửa sổ (vd nhóm vừa có tin mới sau watermark nhưng cửa sổ vẫn chứa
    // tin "Hello" cũ hơn watermark).
    if (tsInfo.maxTs > 0 && tsInfo.maxTs <= config.incrementalSince) {
      log(`[Incremental] EARLY-STOP after bottom extract: max visible time ${tsInfo.maxTs} <= watermark ${config.incrementalSince}.`);
      return collected;
    }
  }

  let scrollsDone = 0;
  // Incremental: collect mỗi scroll để không mất tin do ReactVirtualized
  // unmount. Zalo virtualizes rất mạnh — tin mới nằm giữa đáy và vùng cũ
  // (vd tin vừa gửi cách vài tin từ đáy) bị unmount sau 1-2 scroll, collect
  // thưa (mỗi 2/5 scroll) sẽ bỏ sót. Collect mỗi scroll chậm hơn (~1-2s)
  // nhưng đảm bảo bắt đủ mọi tin mới — đúng trọng tâm của incremental.
  const INCREMENTAL_COLLECT_EVERY = 1;
  // FULL-SYNC early-stop: nhóm RỖNG hoặc đã cuộn tới ĐỈNH thì scroll thêm vô
  // ích. Trước đây full sync scroll đủ 40/200 lần (~2.5 phút) dù extract 0 tin.
  // Theo dõi số tin thu được — nếu không tăng qua vài lần scroll liên tiếp VÀ
  // container đã ở đỉnh (hoặc rỗng) thì dừng sớm.
  let prevFullLen = collected.length;
  let fullNoGrowth = 0;
  let earlyStopFull = false;
  const FULL_NOGROWTH_LIMIT = 3;
  while (scrollsDone < totalScrolled) {
    const chunkStart = scrollsDone;
    const chunkEnd = Math.min(chunkStart + CHUNK_SCROLLS, totalScrolled);

    for (let i = chunkStart; i < chunkEnd; i++) {
      // Send preemption: nếu có zalo-send/teams-send đang chờ (giữ Chrome
      // profile), dừng scroll sớm để nhường Chrome cho lệnh gửi — việc còn
      // lại sẽ do vòng sync tiếp theo (2 phút) lo sau.
      if (isSendWaiting()) {
        log(`[Zalo] PHÁ́T HIỆN send đang chờ — dừng scroll sớm tại ${scrollsDone + 1}/${totalScrolled} để nhường Chrome.`);
        return collected;
      }

      const isIncremental = config.incrementalSince !== undefined && config.incrementalSince > 0;
      // Incremental rút ngắn wait: chỉ cần DOM render window mới enough để đo
      // watermark — không cần chờ ảnh/avatar load đầy đủ như full sync.
      const waitMs = isIncremental
        ? 600 + randomInt(200, 600)
        : config.scrollWaitMs + randomInt(500, 1500);

      await page.evaluate(`
        const __getZaloScrollContainer = ${getScrollContainer.toString()};
        (function() {
          const container = __getZaloScrollContainer();
          const vh = container.clientHeight || window.innerHeight;
          container.scrollBy({ top: -Math.round(vh * 0.8) });
        })();
      `);
      await page.waitForTimeout(waitMs);

      if (isIncremental) {
        // Chỉ đo watermark (nhẹ: 1 querySelectorAll, ~ms) — KHÔNG collect DOM
        const tsInfo = await page.evaluate(() => {
          let maxTs = -1;
          let minTs = Infinity;
          document.querySelectorAll<HTMLElement>('[id^="bb_msg_id_"]').forEach((el) => {
            const m = (el.id || "").match(/bb_msg_id_(\d+)/);
            if (m) {
              const ts = parseInt(m[1], 10);
              if (ts > maxTs) maxTs = ts;
              if (ts < minTs) minTs = ts;
            }
          });
          return { maxTs, minTs: minTs === Infinity ? -1 : minTs };
        });

        // Cả window đều là tin cũ → đã chạm vùng đã sync: collect 1 lần rồi dừng.
        // Dựa trên maxTs (tin MỚI NHẤT trong window) — nếu maxTs <= watermark
        // thì mọi tin còn lại đều là tin cũ đã sync, không cần scroll tiếp.
        if (tsInfo.maxTs > 0 && tsInfo.maxTs <= config.incrementalSince!) {
           log(`[Incremental] EARLY-STOP at scroll ${i + 1}: max visible timestamp ${tsInfo.maxTs} <= watermark ${config.incrementalSince}`);
           pushUnique(await collectZaloMessagesFromPage(page, config));
           return collected;
        }

        // Collect định kỳ (mỗi INCREMENTAL_COLLECT_EVERY scroll) để không mất
        // tin mới do ReactVirtualized unmount khi scroll lên xa
        if ((scrollsDone + 1) % INCREMENTAL_COLLECT_EVERY === 0) {
          pushUnique(await collectZaloMessagesFromPage(page, config));
        }
      } else {
        // COLLECT sau khi scroll (FULL SYNC)
        pushUnique(await collectZaloMessagesFromPage(page, config));

        // Early-stop: dừng khi không thu thêm tin qua nhiều scroll liên tiếp
        // VÀ đã chạm đỉnh (scrollTop ~ 0) — hoặc nhóm rỗng (collected === 0).
        // Tránh scroll đủ 40/200 lần vô ích khi nhóm ít/không có tin.
        if (collected.length > prevFullLen) {
          fullNoGrowth = 0;
          prevFullLen = collected.length;
        } else {
          fullNoGrowth++;
        }
        if (fullNoGrowth >= FULL_NOGROWTH_LIMIT) {
          const atTop = (await page.evaluate(`
            const __getZaloScrollContainer = ${getScrollContainer.toString()};
            (function() { return __getZaloScrollContainer().scrollTop <= 4; })();
          `)) as boolean;
          if (atTop || collected.length === 0) {
            log(`[Zalo] FULL early-stop tại scroll ${i + 1}/${totalScrolled}: ${fullNoGrowth} lần không thêm tin${atTop ? " + đã ở đỉnh" : ""} (collected=${collected.length}).`);
            earlyStopFull = true;
            scrollsDone = i + 1;
            break;
          }
          // Chưa ở đỉnh mà không tăng (có thể đang lazy-load chậm) — reset đếm
          // để cho thêm cơ hội, tránh dừng non giữa chat dài.
          fullNoGrowth = 0;
        }
      }
    }
    if (earlyStopFull) break;
    scrollsDone = chunkEnd;

    if (scrollsDone >= totalScrolled) break;
    log(`  Scroll ${scrollsDone}/${totalScrolled}`);
  }

  // Kick lazy loading on all images with a small nudge (down then back up).
  // We do NOT scroll all the way to the bottom — that would unload the old
  // messages from ReactVirtualized's DOM and we'd lose them for extraction.
  // Bỏ qua nudge (và chờ 4s) khi nhóm RỖNG (không có tin) — không có ảnh nào
  // để lazy-load, chờ 4s là vô ích.
  if ((config.incrementalSince === undefined || config.incrementalSince <= 0) && collected.length > 0) {
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
    // Collect lại lần cuối — nudge có thể đã load thêm ảnh/caption cho
    // messages đang ở trong DOM.
    pushUnique(await collectZaloMessagesFromPage(page, config));
  } else {
    log(`[Incremental] Skipped bottom-nudge (incremental mode)`);
  }

  log(`[Zalo] Collected ${collected.length} unique messages sau ${scrollsDone} scrolls.`);
  return collected;
}

/**
 * Collect messages currently rendered in the Zalo chat DOM (no scrolling).
 * Uses multiple selector strategies for robustness across Zalo Web versions.
 * Returns ONLY the raw extracted messages — callers combine multiple passes
 * (see scrollZaloChatContainer) and hydrate via finalizeZaloMessages.
 */
export async function collectZaloMessagesFromPage(
  page: Page,
  config: ZaloAutomatorConfig
): Promise<ZaloExtractedMessage[]> {
  log("Dang trich xuat tin nhan Zalo (DOM hien tai)...");

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
    log("Không tìm thấy message pane. Se thu tim bang text.");
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

  // Filter avatar URL: loại icon/placeholder (icon like, sticker, avatar chưa
  // tải là svg placeholder) — chỉ giữ avatar thật (ava-talk/ava-grp zadn).
  // (Browser-only — được eval trong page.evaluate qua arg avatarSource.)
  const zaloAvatarHelperSource = `
function isUsableZaloAvatarSrc(src) {
  if (!src || !src.length) return false;
  const lower = src.toLowerCase();
  if (lower.startsWith('data:image/svg')) return false;       // placeholder svg
  if (lower.includes('iconlike') || lower.includes('icon-like')) return false; // icon like
  if (lower.includes('emoji')) return false;                  // emoji/sticker
  if (lower.includes('sticker')) return false;
  if (lower.includes('res-zalo.zadn.vn')) return false;       // resource (icon/nhạc chuông...)
  return true;
}
`;
  
  const extractedMessages: { messages: ZaloExtractedMessage[]; htmlDump: string } = 
  await page.evaluate(async (args: { kwList: string[]; groupName: string; imgBlocklist: string[]; avatarSource: string }) => {
    // Inject avatar filter helper (module-scope source, truyền qua arg).
    eval(args.avatarSource);
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
    
    // Detect 1:1 chat: Zalo shows NO sender-name element on received messages
    // in direct chats (only an avatar), while group chats always render one.
    // If no received message carries a real sender name, treat this chat as
    // 1:1 and attribute received messages to the partner (config.groupName is
    // the partner's display name), instead of leaking "Me" via lastSender.
    const anyRealSenderName = wrappers.some((w) => {
      const s = w.querySelector<HTMLElement>('.message-sender-name-content .truncate')?.innerText?.trim();
      return !!s && s !== "Me";
    });
    const singleChat = !anyRealSenderName;
    const partnerName = singleChat ? (args.groupName || "") : "";
    
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
      // Zalo marks own messages with an independent "me" class token on the
      // wrapper (e.g. "chat-message chat-message-v2 wrap-message rotate-container me -send-time"),
      // on the .message-wrapper child ("message-wrapper message-wrapper--me")
      // and on the parent .chat-item ("chat-item ... me"). These are 100%
      // reliable — verified against live DOM: a 1:1 chat's received messages
      // never carry the token.
      //
      // IMPORTANT: only match whole tokens — "chat-message" contains "-me" as
      // a substring but is NOT a sent message, so `includes("-me")` would
      // mislabel every message as mine.
      //
      // DO NOT rely on [data-id="btn_SentMsg_React"] / "div_SentMsg_Text": in
      // 1:1 chats Zalo renders a reaction button on EVERY message, and the
      // sent/received data-id does not exist on older bubbles — that selector
      // mislabeled every received message as "Me".
      const wrapperClass = el.className || "";
      const isMine = /(^|\s)(me|mine|my|owner|self)($|\s)/i.test(wrapperClass) ||
        wrapperClass.toLowerCase().includes("-right") ||
        /(^|\s)(me|mine|my|owner|self)($|\s)/i.test(el.querySelector('.message-wrapper')?.className || "") ||
        /(^|\s)(me|mine|my|owner|self)($|\s)/i.test(el.closest('.chat-item')?.className || "");
      
      if (isMine) {
        sender = "Me";
      }
      
      // Sender fallback logic. Order matters:
      // - In a 1:1 chat, received messages carry no sender-name element at
      //   all, so `lastSender` (often "Me" from an earlier message) must NOT
      //   leak into received messages — use the partner name instead.
      // - In a group chat, a received message without its own name belongs to
      //   the previous sender (Zalo only renders the name on the first bubble
      //   of a contiguous run) — `lastSender` is correct there.
      if (!sender && !isMine && singleChat) {
        sender = partnerName || "Unknown";
      } else if (!sender && lastSender) {
        // Group chat: bubble tiếp theo của cùng run không render name —
        // thuộc về sender của bubble trước đó.
        sender = lastSender;
      } else if (!sender) {
        sender = "Unknown";
      }
      const chatItem = el.closest<HTMLElement>('.chat-item');
      const avatarScope = chatItem || el;
      const avatarImg = avatarScope.querySelector<HTMLImageElement>(
        '.zavatar-container img, [class*="zavatar-container"] img, .avatar--overlay img, [class*="zavatar"] img'
      );
      let senderAvatar = "";
      if (avatarImg) {
        senderAvatar = avatarImg.getAttribute('src') || avatarImg.getAttribute('data-src') || "";
        // Loại icon/placeholder lạ (vd icon "like" của Zalo nằm trong scope
        // nhưng không phải avatar người) — để UI fallback dicebear.
        if (!isUsableZaloAvatarSrc(senderAvatar)) senderAvatar = "";
      }

      // Track the previous real sender for the group-chat fallback, but NEVER
      // let "Me" leak into a partner's message in a 1:1 chat (the received
      // bubbles have no sender-name element, so lastSender would otherwise
      // attribute them to the wrong person).
      if (sender && !(singleChat && !isMine)) {
        lastSender = sender;
      }

      if (!senderAvatar && lastSenderAvatar && sender === lastSender) {
        senderAvatar = lastSenderAvatar;
      } else if (senderAvatar) {
        lastSenderAvatar = senderAvatar;
      }

      // If a received message still has no sender (neither an explicit name
      // nor a recorded previous sender), and we are in a 1:1 chat, attribute
      // it to the partner instead of leaking "Me".
      if (!sender && singleChat && !isMine) {
        sender = partnerName || "Unknown";
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

      const key = platformMsgId
        ? `id:${platformMsgId}`
        : `${sender}|${finalContent.slice(0, 80)}|${images.join(',')}`;
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
    ],
    avatarSource: zaloAvatarHelperSource
  });

  console.log("FIRST MSG HTML:", extractedMessages.htmlDump.substring(0, 3000));

  return extractedMessages.messages;
}

/**
 * Finalize a set of collected Zalo messages:
 * - Hydrate sender avatars (Zalo avatar URLs need session cookies; download
 *   via page.request and convert to base64 data URLs).
 * - Sort chronologically by real epoch timestamp (timestampMs).
 * - Build the ZaloExtractResult (dedup + merge with the output JSON file).
 */
export async function finalizeZaloMessages(
  page: Page,
  config: ZaloAutomatorConfig,
  displayGroupName: string,
  messagesArray: ZaloExtractedMessage[]
): Promise<ZaloExtractResult> {
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
    await page.waitForTimeout(200);
    await searchBox.fill(chatName);
    // Poll kết quả xuất hiện (tối đa 2.5s) — dừng ngay khi thấy item tên khớp
    const resultsDeadline = Date.now() + 2_500;
    let clicked: string | null = null;
    while (Date.now() < resultsDeadline && !clicked) {
      clicked = await page.evaluate((target: string) => {
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
      if (!clicked) await page.waitForTimeout(400);
    }

    if (!clicked) {
      // Clear the search box so we don't leave it dirty
      await searchBox.fill("").catch(() => {});
      return { ok: false, error: `Không tìm thấy chat "${chatName}" trong danh sách. Không gửi gì cả.` };
    }
    log(`Da click vao chat: ${clicked}`);
  } else {
    return { ok: false, error: "Không tìm thấy ô tìm kiếm Zalo (search box). Không gửi gì cả." };
  }

  // ── 2. VERIFY the open chat is the intended target ──────────
  // Poll sidebar-selected (tối đa openWaitMs, mỗi 400ms) — dừng ngay khi
  // item tên khớp được chọn, không chờ cứng openWaitMs.
  const verifyDeadline = Date.now() + openWaitMs;
  let verify = await verifyOpenChat(page, chatName);
  while (!verify.verified && Date.now() < verifyDeadline) {
    await page.waitForTimeout(400);
    verify = await verifyOpenChat(page, chatName);
  }
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
  // Scroll chat xuống đáy để ô soạn tin chắc chắn hiển thị trong viewport
  // (nhất là khi cửa sổ to — ô input nằm sát đáy màn hình).
  await page.evaluate(() => {
    const container =
      document.querySelector<HTMLElement>('#messageViewScroll') ||
      document.querySelector<HTMLElement>('#messageViewContainer') ||
      document.querySelector<HTMLElement>('[class*="message-view"]');
    if (container) container.scrollTop = container.scrollHeight;
  }).catch(() => {});
  await page.waitForTimeout(300);

  const input = page.locator('#richInput, [contenteditable="true"]').first();
  const inputVisible = await input.isVisible({ timeout: 3_000 }).catch(() => false);
  if (!inputVisible) {
    return { ok: false, error: "Không thấy ô nhập tin nhắn (#richInput). Không gửi gì cả." };
  }

  await input.click();
  await page.waitForTimeout(150);
  await input.fill(message);
  // Chờ lâu hơn sau khi fill để user nhìn thấy text trong ô input
  // (trước khi Enter gửi — nhất là khi chạy headfull để quan sát thao tác).
  await page.waitForTimeout(1_200);

  // Confirm the text actually landed in the input
  const typedText = await page.evaluate(() => {
    const el = document.querySelector('#richInput') as HTMLElement | null;
    return el?.innerText || '';
  });
  if (!typedText.trim()) {
    return { ok: false, error: "Không thể nhập tin nhắn vào ô input. Không gửi gì cả." };
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
  // Chờ thêm 1 chút để user quan sát text đã vào ô input trước khi gửi
  await page.waitForTimeout(800);
  await input.press("Enter");

  // ── 6. Verify send succeeded ────────────────────────────────
  // Poll msgCount tăng (tối đa ~2.5s) — dừng ngay khi tin mới xuất hiện.
  const afterDeadline = Date.now() + 2_500;
  let afterVerify = await verifyOpenChat(page, chatName);
  while (Date.now() < afterDeadline && afterVerify.msgCount <= verify.msgCount) {
    await page.waitForTimeout(300);
    afterVerify = await verifyOpenChat(page, chatName);
  }
  const inputNow = await page.evaluate(() => {
    const el = document.querySelector('#richInput') as HTMLElement | null;
    return el?.innerText || '';
  });
  const inputCleared = inputNow.trim() === "";

  // sent = msgCount tăng (dấu hiệu tin đã vào list) HOẶC input đã rỗng (Zalo
  // thường xoá ô soạn ngay khi Enter; msgCount đếm từ #messageViewContainer
  // có thể về 0 khi ReactVirtualized re-render). textVisible chỉ là check phụ.
  const msgCountIncreased = afterVerify.msgCount > verify.msgCount;
  let sentTextVisible = false;
  if (afterVerify.verified || msgCountIncreased) {
    // Check the last message in the chat contains our text
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
  const sent = inputCleared && (msgCountIncreased || sentTextVisible);

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

    // Step 4: Scroll to load history (collect từng chunk — giữ cả message cũ
    // lẫn mới, không scroll lên tới đỉnh làm mất message cuối khỏi DOM)
    const collected = await scrollZaloChatContainer(page, config);
    const displayGroupName = collected.length > 0
      ? (collected[0] as any).groupName || config.groupName || "Zalo Group"
      : config.groupName || "Zalo Group";

    // Step 5: Extract messages (finalize: hydrate avatars, sort, merge)
    const result = await finalizeZaloMessages(page, config, displayGroupName, collected);

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
