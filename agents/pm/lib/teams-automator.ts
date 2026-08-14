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
import { execSync, spawn } from "child_process";

/**
 * Kiểm tra nhanh — có send lock nào đang chờ không.
 * teams-send.ts / zalo-send.ts ghi `.teams-send-running` / `.zalo-send-running`
 * NGAY KHI bấm gửi. Sync đang scroll thấy lock này → dừng sớm nhường Chrome.
 */
export function isSendWaiting(): boolean {
  try {
    for (const file of [".teams-send-running", ".zalo-send-running"]) {
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

/** Main Chrome only — GPU/Renderer/Utility Helper inherit --user-data-dir
 *  nhưng KHÔNG phải process giữ SingletonLock. Match nhầm Helper → false
 *  "profile đang bị Chrome khác dùng" mỗi khi sync/send còn Chrome. */
function isChromeMainProcess(cmdline: string): boolean {
  if (/\s--type=/.test(cmdline)) return false;
  if (/Google Chrome Helper/.test(cmdline)) return false;
  return true;
}

function currentProcessOwnsTeamsSendLock(): boolean {
  try {
    const lockPath = path.join(process.cwd(), ".teams-send-running");
    if (!fs.existsSync(lockPath)) return false;
    const pid = parseInt(fs.readFileSync(lockPath, "utf-8").trim(), 10);
    return !isNaN(pid) && pid === process.pid;
  } catch {
    return false;
  }
}

/**
 * Kill Playwright Chrome (--remote-debugging-pipe) đang giữ profile.
 * Gọi từ teams-send SAU khi preempt sync: Chrome con thường sống sót SIGTERM
 * → send mở Chrome thứ 2 cùng profile sẽ fail "busy".
 */
export async function killPlaywrightChromeOnProfile(
  profileDir: string,
  waitMs = 8_000
): Promise<void> {
  const killOnce = (): number[] => {
    const killed: number[] = [];
    try {
      const lines = execSync("pgrep -fl 'Google Chrome'", { encoding: "utf8" }).split("\n");
      for (const line of lines) {
        if (!line.includes(profileDir)) continue;
        if (!line.includes("--remote-debugging-pipe")) continue;
        if (!isChromeMainProcess(line)) continue;
        const m = line.match(/^(\d+)\s/);
        if (!m) continue;
        const pid = Number(m[1]);
        try {
          process.kill(pid, "SIGKILL");
          killed.push(pid);
        } catch {
          /* already gone */
        }
      }
    } catch {
      /* pgrep unavailable */
    }
    return killed;
  };

  const first = killOnce();
  if (first.length > 0) {
    log(`Da kill Playwright Chrome leftover tren profile (pid=${first.join(",")}).`);
  }

  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    let alive = false;
    try {
      const lines = execSync("pgrep -fl 'Google Chrome'", { encoding: "utf8" }).split("\n");
      alive = lines.some(
        (line) =>
          line.includes(profileDir) &&
          isChromeMainProcess(line) &&
          line.includes("--remote-debugging-pipe")
      );
    } catch {
      alive = false;
    }
    if (!alive) return;
    await new Promise((r) => setTimeout(r, 300));
    killOnce();
  }
  log("Playwright Chrome tren profile van con sau khi kill — van tiep tuc.");
}

const DEFAULT_CDP_PORT = 9222;

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
  /** Incremental sync watermark: stop scrolling once messages at/below this
   *  timestampMs are seen (they are already in the DB). Omit for full sync. */
  incrementalSince?: number;
}

export const DEFAULT_CONFIG: AutomatorConfig = {
  sessionDir: path.join(process.cwd(), ".teams-session"),
  outputFile: path.join(process.cwd(), "teams-messages.json"),
  screenshotDir: path.join(process.cwd(), "teams-screenshots"),
  scrollCount: 5,
  scrollWaitMs: 2_000,
  loginTimeoutMs: 120_000,
  headless: false,
  useRealChrome: true,
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
  timestampMs?: number;
  groupName: string;
  hasKeyword: boolean;
  matchedKeywords: string[];
  /** True if this message was sent by the logged-in user */
  isMine?: boolean;
}

// ─── Người dùng hiện tại (danh xưng "Me" trên Teams) ────────
// Teams hiển thị tên mình trên chính tin mình gửi ("Khoi Tran Quang"),
// nhưng class `.fui-ChatMyMessage` (dùng để nhận diện tin của mình) không
// phải lúc nào cũng có trên DOM. Khi thiếu class đó, tin gửi bởi chính mình
// bị lưu với sender đầy đủ tên thật thay vì "Me". Giải pháp: gộp cả 2 nguồn —
// class `fui-ChatMyMessage` HOẶC sender khớp danh xưng mình (tên đầy đủ /
// alias, so khớp không dấu) → đổi sender thành "Me".
const TEAMS_ME_NAMES = ["khoi tran quang", "khoitq3"];

/** Bỏ dấu + hạ thường để so khớp tên (chịu được tên có dấu tiếng Việt). */
export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Đọc danh xưng "Me" từ env (mặc định "Khoi Tran Quang" / "khoitq3"). */
export function getTeamsMeNames(): string[] {
  const raw = process.env.TEAMS_ME_NAME;
  if (raw && raw.trim()) {
    return raw.split(",").map((s) => normalizeName(s)).filter(Boolean);
  }
  return TEAMS_ME_NAMES.map(normalizeName);
}

/** So khớp sender với danh xưng "Me": khớp chuỗi đầy đủ hoặc tên (không dấu). */
export function isTeamsMeSender(sender: string): boolean {
  const s = normalizeName(sender);
  if (!s) return false;
  const meNames = getTeamsMeNames();
  // Alias dạng khoitq3 thường được Teams gán sau tên ("Khoi Tran Quang (khoitq3)")
  if (meNames.some((n) => n === s || s === n || s.includes(n) || n.includes(s))) return true;
  // So khớp theo tên đầy đủ (≥2 token): "luan tran cao" có chung token "tran"
  // với "khoi tran quang" (họ chung) nhưng khác token tên → KHÔNG khớp.
  // Trước đây chỉ cần 1 token ≥4 chữ trùng (vd "tran") là match → nhầm tin
  // của "Luan Tran Cao" thành "Me" (bug sync Teams sai user nhắn, Hackathon).
  const sTokens = s.split(" ").filter((t) => t.length >= 3);
  if (sTokens.length < 2) return false;
  const meTokenSets = meNames.map((n) => new Set(n.split(" ").filter((t) => t.length >= 3)));
  // Sender là "Me" nếu ít nhất 2 token của sender xuất hiện trong cùng 1 meName
  // (vd "khoi quang", "khoi tran" khớp "khoi tran quang"; "tran cao" KHÔNG khớp
  // vì chỉ 1 token "tran" trùng).
  return meTokenSets.some((meTokens) => {
    const overlap = sTokens.filter((t) => meTokens.has(t)).length;
    return overlap >= 2;
  });
}

/** Chuẩn hoá dữ liệu tin nhắn sau khi trích xuất: gán sender="Me" nếu isMine
 *  (và ngược lại: gán isMine=true nếu sender đã là "Me" — đồng bộ 2 chiều để
 *  downstream save vào DB (projectChats.isMine + sender) không bị lệch giữa
 *  isMine=null / sender="Me" khi isMine được thoát đi qua addToCollection). */
export function cleanTeamMessages<T extends { sender: string; isMine?: boolean }>(messages: T[]): T[] {
  for (const m of messages) {
    if (m.isMine) m.sender = "Me";
    else if (isTeamsMeSender(m.sender)) { m.sender = "Me"; m.isMine = true; }
    else if (m.sender === "Me") m.isMine = true;
    else m.isMine = m.isMine ?? false;
  }
  return messages;
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

  // Không gọi setViewportSize ở đây. Persistent Chrome dùng viewport:null
  // (layout theo inner size thật). Ép viewport lớn hơn cửa sổ → UI Teams/Zalo
  // tràn, ô nhập tin ở đáy bị cắt không nhìn thấy.
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

    // Browser.setWindowBounds cần browser-level CDP session (giống minimizeCdpWindow).
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

export async function createStealthContext(config: AutomatorConfig): Promise<{
  browser: Browser;
  context: BrowserContext;
}> {
  ensureDir(config.sessionDir);
  ensureDir(config.screenshotDir);

    // ── CDP mode: connect to a REAL Chrome already running (opened manually) ──
    // Teams blocks Playwright-launched profiles (navigator.webdriver=true).
    // Real Chrome started with `open -a "Google Chrome" --args --user-data-dir=<profile> --remote-debugging-port=9222`
    // keeps a genuine session + cookies, so Teams doesn't flag it as automation.
    // NOTE: KHÔNG intercept route ở đây — mỗi route.continue() qua CDP roundtrip
    // làm chậm cực lớn trên Teams (hàng trăm requests). Chrome thật đã disable
    // protocol dialog qua Preferences (msteams excluded), nên không cần block.
    if (process.env.USE_CDP === "1" || process.env.USE_CDP === "true") {
    const port = Number(process.env.CDP_PORT || DEFAULT_CDP_PORT);
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
    // (sync-all-projects spawned by next-server) and teams-send share
    // `.teams-session/chrome-profile`, and a blanket kill here was killing
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
        if (!isChromeMainProcess(line)) continue;
        const m = line.match(/^(\d+)\s/);
        if (!m) continue;
        const pid = Number(m[1]);
        // Skip processes that are NOT orphans (still owned by a live parent —
        // i.e. a browser another script is actively using).
        // Ngoại lệ: teams-send đã claim lock → Chrome sync leftover (ppid vẫn
        // là node/tsx sync đang chết) phải bị kill, không chỉ orphan ppid=1.
        try {
          const ppidStr = execSync(`ps -o ppid= -p ${pid}`, { encoding: "utf8" }).trim();
          const ppid = Number(ppidStr);
          if (ppid > 1 && !currentProcessOwnsTeamsSendLock()) continue;
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
      log("Không thể ghi Preferences: " + e);
    }

    log(`Mo Chrome that voi persistent profile: ${profileDir}`);

    // ── Trước khi launch: nếu profile đang bị Chrome KHÁC giữ (live) mà
    // không phải orphan/pipe của mình → launch thất bại "Failed to create a
    // ProcessSingleton" (2 Chrome cùng user-data-dir). Detect sớm để trả
    // lỗi rõ ràng thay vì crash. Chỉ "loại trừ" Chrome cùng pipe chết.
    const profileTaken = (() => {
      try {
        const lines = execSync("pgrep -fl 'Google Chrome'", { encoding: "utf8" }).split("\n");
        for (const line of lines) {
          if (!line.includes(profileDir)) continue;
          if (!isChromeMainProcess(line)) continue; // bỏ GPU/Renderer Helper
          const m = line.match(/^(\d+)\s/);
          if (!m) continue;
          const pid = Number(m[1]);
          try {
            process.kill(pid, 0);
            return {
              pid,
              cdpPort: line.includes("--remote-debugging-port"),
              playwrightPipe: line.includes("--remote-debugging-pipe"),
            };
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
      // Send đã claim lock → Playwright Chrome leftover (sync bị preempt) phải
      // nhường profile. Kill rồi launch, không báo busy giả.
      if (profileTaken.playwrightPipe && currentProcessOwnsTeamsSendLock()) {
        log(`Profile bi Playwright Chrome leftover (pid=${profileTaken.pid}) — kill de gui tin.`);
        await killPlaywrightChromeOnProfile(profileDir);
      } else if (profileTaken.cdpPort && (process.env.USE_CDP === "1" || process.env.USE_CDP === "true")) {
        const port = Number(process.env.CDP_PORT || DEFAULT_CDP_PORT);
        const cdpUrl = `http://127.0.0.1:${port}`;
        log(`Profile đang bị Chrome CDP (pid=${profileTaken.pid}) giữ — thử connect CDP lại ${cdpUrl}...`);
        try {
          const browser = await chromium.connectOverCDP(cdpUrl, { timeout: 2_500 });
          const context = browser.contexts()[0];
          if (!context) throw new Error("CDP browser has no default context.");
          process.env.SYNC_CDP_CONNECTED = "1";
          context.on("page", (newPage) => {
            newPage.on("dialog", async (dialog) => {
              log("Phat hien dialog (tab moi): " + dialog.message().slice(0, 80));
              await dialog.dismiss().catch(() => {});
            });
          });
          const fakeBrowser = new Proxy(browser, {
            get(target, prop, receiver) {
              if (prop === "close") {
                return async () => { log("CDP mode: giu Chrome that mo (khong dong)."); };
              }
              return Reflect.get(target, prop, receiver);
            },
          }) as Browser;
          log("CDP reconnect thanh cong — dung Chrome CDP dang giu profile.");
          return { browser: fakeBrowser, context };
        } catch (cdpRetryErr) {
          log(`CDP reconnect that bai (${String(cdpRetryErr).slice(0, 120)}).`);
        }
        throw new Error(
          `Teams profile đang bị Chrome khác dùng (pid=${profileTaken.pid}, sync/send/đang mở). ` +
          `Trả busy thay vì mở Chrome thứ 2 cùng profile.`
        );
      } else if (!(profileTaken.playwrightPipe && currentProcessOwnsTeamsSendLock())) {
        throw new Error(
          `Teams profile đang bị Chrome khác dùng (pid=${profileTaken.pid}, sync/send/đang mở). ` +
          `Trả busy thay vì mở Chrome thứ 2 cùng profile.`
        );
      }
    }

    // launchPersistentContext uses real Chrome + keeps cookies/storage
    const persistentContext = await chromium.launchPersistentContext(profileDir, {
      channel: "chrome",
      headless: config.headless,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        `--window-size=${CHROME_WINDOW_WIDTH},${CHROME_WINDOW_HEIGHT}`,
        "--lang=en-US",
        // ── Suppress "Open Microsoft Teams?" protocol handler dialog ──
        "--disable-features=ExternalProtocolDialog",
        // ── Suppress "Restore pages?" crash bubble ──
        "--disable-session-crashed-bubble",
        "--disable-restore-session-state",
        // ── Fix macOS headless cookie decryption issue ──
        "--password-store=basic",
        "--use-mock-keychain",
        "--window-position=40,60",
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
    if (!config.headless) await fitWindowToScreen(page).catch(() => {});

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
    "Teams cần Google Chrome + profile `.teams-session/chrome-profile` (không mở Chromium test)."
  );
}

// ─── Helper: tab nền + thu nhỏ window (tránh popup khi sync nền) ──
// Teams chặn Playwright headless (navigator.webdriver) nên sync LUÔN phải
// dùng Chrome thật qua CDP hoặc persistent profile. Với CDP:
//  - Tab Teams mới mở bằng CDP `Target.createTarget background:true` →
//    KHÔNG focus window → không bật cửa sổ popup lên màn hình.
//  - Nếu cửa sổ Chrome CDP đang hiển thị, thu nhỏ (minimized) bằng
//    `Browser.setWindowBounds` khi sync nền → user không bị làm phiền.
export interface OpenTeamsTabOptions {
  /** Mở tab như tab nền (không focus). Mặc định true khi CDP connect. */
  background?: boolean;
  /** Thu nhỏ window chứa tab sau khi mở. Mặc định theo HEADLESS/SYNC_BACKGROUND. */
  minimize?: boolean;
  /** URL khởi tạo cho tab (mặc định about:blank — navigateToTeams sẽ goto). */
  url?: string;
}

export async function openTeamsTabInBackground(
  browser: Browser,
  context: BrowserContext,
  opts: OpenTeamsTabOptions = {}
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
      const { targetId } = await session.send("Target.createTarget", {
        url: opts.url || "about:blank",
        background: true,
      });
      await session.detach().catch(() => {});
      // Poll cho tới khi page mới xuất hiện trong context (Playwright sync qua discovery)
      const deadline = Date.now() + 8_000;
      let created: Page | null = null;
      while (Date.now() < deadline) {
        const page = context.pages().find((p) => !existingPages.has(p));
        if (page) { created = page; break; }
        await new Promise((r) => setTimeout(r, 200));
      }
      if (created) {
        log("CDP: da mo tab Teams BACKGROUND (khong hien cua so popup).");
        // Tab background đã không hiện cửa sổ — không cần minimize nữa.
        return created;
      }
      log("CDP: tao tab background that bai (page chua xuat hien) — chuyen sang newPage().");
    } catch (e) {
      log(`CDP: tao tab background loi (${String(e).slice(0, 100)}) — fallback newPage().`);
    }
  }

  const page = await context.newPage();
  if (minimize) await minimizeCdpWindow(browser, page).catch(() => {});
  return page;
}

/** Thu nhỏ cửa sổ Chrome CDP chứa page (không focus → không nhảy popup). */
export async function minimizeCdpWindow(browser: Browser, page: Page): Promise<boolean> {
  if (process.env.SYNC_CDP_CONNECTED !== "1") return false;
  try {
    const session = await (browser as any).newBrowserCDPSession();
    // Lấy targetId của page qua internal (không dùng title match — có thể trùng)
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

/** Đưa cửa sổ Chrome CDP chứa page lên trước + focus (dùng khi gửi thật headfull để user thấy). */
export async function focusCdpWindow(browser: Browser, page: Page): Promise<boolean> {
  if (process.env.SYNC_CDP_CONNECTED !== "1") return false;
  try {
    const session = await (browser as any).newBrowserCDPSession();
    const targetId = (page as any)._target?._targetId;
    const { windowId } = await session.send("Browser.getWindowForTarget", targetId ? { targetId } : {});
    await session.send("Browser.setWindowBounds", {
      windowId,
      bounds: { windowState: "normal" },
    });
    await session.send("Page.bringToFront", targetId ? { targetId } : {}).catch(() => {});
    await session.detach().catch(() => {});
    await fitWindowToScreen(page).catch(() => {});
    log("CDP: da dua cua so Chrome len truoc + fit man hinh (headfull).");
    return true;
  } catch (e) {
    log(`CDP: focus window loi (${String(e).slice(0, 100)}) — bo qua.`);
    return false;
  }
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
    // Teams v2 selectors + legacy selectors — poll ngắn, đừng chờ 5s cứng.
    const shellDeadline = Date.now() + 4_000;
    while (Date.now() < shellDeadline) {
      const isLoggedIn = await page
        .locator('[data-tid="app-bar-wrapper"], [data-tid="chat-title"], [data-tid="app-bar"], [data-tid="chat-header-title"]')
        .first()
        .isVisible({ timeout: 400 })
        .catch(() => false);
      if (isLoggedIn) {
        log("Da co session, khong can dang nhap.");
        return false;
      }
    }
    // URL đã là Teams (không phải trang login) — SPA có thể chưa render xong
    // sidebar. KHÔNG rơi xuống vòng check ô login (4 × 10s = 40s phí).
    log("URL da la Teams, coi nhu da dang nhap (shell chua kip render).");
    return false;
  }

  const loginSelectors = [
    'input[name="loginfmt"]',
    'input[type="email"]',
    'input[name="passwd"]',
    '[data-tid="signIn"]',
  ];

  let needsLogin = false;
  for (const sel of loginSelectors) {
    const visible = await page.locator(sel).first().isVisible({ timeout: 800 }).catch(() => false);
    if (visible) {
      needsLogin = true;
      break;
    }
  }

  if (!needsLogin && url.includes("login.microsoftonline.com")) {
    needsLogin = true;
  }

  if (needsLogin) {
    log("Cần đăng nhập. Vui lòng đăng nhập trong cửa sổ browser...");
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
  const current = page.url();
  // CDP mode (real Chrome): page may already be on Teams — don't re-navigate,
  // otherwise we lose the current sidebar state and force a full app reload.
  if (current.includes("teams.microsoft.com") || current.includes("teams.live.com")) {
    log(`Da o Teams (${current.slice(0, 60)}), khong navigate lai.`);
    await switchToChatView(page);
    // Sidebar đã có chat items thì khỏi chờ 2s cứng.
    const ready = await page.evaluate(() =>
      document.querySelectorAll('[data-testid="list-item"]').length > 0 ||
      document.querySelectorAll('[role="treeitem"]').length > 5
    ).catch(() => false);
    if (!ready) await page.waitForTimeout(800);
    return;
  }
  // Always go to homepage — v2 SPA loads reliably from there
  log("Dang mo Teams homepage...");
  await page.goto("https://teams.microsoft.com", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await switchToChatView(page);
  // Teams v2 SPA render chậm — tab mới lạnh (sync song song) cần tới ~15-20s
  // để render sidebar chat. Chờ CHAT ITEMS thật xuất hiện (list-item / nhiều
  // treeitem) — `[role="tree"]` xuất hiện sớm khi app còn loading, không đủ.
  // Dùng evaluate string (function evaluate bị Teams chặn: "__name is not defined").
  try {
    const chatListReady = async (): Promise<boolean> => {
      try {
        return await page.evaluate(() =>
          document.querySelectorAll('[data-testid="list-item"]').length > 0 ||
          document.querySelectorAll('[role="treeitem"]').length > 5
        );
      } catch { return false; }
    };
    // Poll nhẹ (500ms/lần) — dừng NGAY khi sidebar render xong, không chờ đủ
    // 45s nếu app load nhanh (bấm gửi thường có tab ấm → chỉ mất vài giây).
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      if (await chatListReady()) break;
      await page.waitForTimeout(500);
    }
  } catch {
    // sidebar chưa xuất hiện — để bước tìm chat xử lý (search box fallback)
  }
  await page.waitForTimeout(500);
  log(`URL: ${page.url()}`);
}

/**
 * Chuyển tab Teams sang Chat view (nếu đang ở Calendar/Calls/Teams view khác).
 * Teams v2: nút Chat trong app bar có aria-label "Chat (Ctrl+2)" — click để
 * sidebar chat (danh sách hội thoại) hiện ra. Nếu đã ở Chat view thì bỏ qua.
 */
export async function switchToChatView(page: Page): Promise<boolean> {
  try {
    const clicked = await page.evaluate(() => {
      const appBarButtons = Array.from(
        document.querySelectorAll<HTMLElement>('[data-tid^="app-bar-item"], [role="button"], button')
      );
      const chatBtn = appBarButtons.find((el) => {
        const aria = (el.getAttribute("aria-label") || "").trim();
        return /^chat(\s*\(|$)/i.test(aria);
      });
      if (!chatBtn) return false;
      const pressed = chatBtn.getAttribute("aria-pressed");
      if (pressed === "true") return false; // đã ở Chat view
      (chatBtn as HTMLElement).click();
      return true;
    });
    if (clicked) {
      log("Da chuyen sang Chat view trong Teams.");
      // Chờ sidebar chat thực sự render sau khi click (SPA chuyển view)
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const ok = await page.evaluate(() =>
          document.querySelectorAll('[data-testid="list-item"]').length > 0 ||
          document.querySelectorAll('[role="treeitem"]').length > 5
        ).catch(() => false);
        if (ok) break;
        await page.waitForTimeout(500);
      }
      await page.waitForTimeout(800);
      return true;
    }
    log("switchToChatView: khong tim thay nut Chat (page khong phai Teams app bar?).");
    return false;
  } catch (e) {
    log(`switchToChatView loi: ${String(e).slice(0, 100)}`);
    return false;
  }
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

  // Helper: use the Teams v2 search box to find a person/chat by name or email
  async function trySearchChat(name: string): Promise<boolean> {
    log(`Thu tim qua o search Teams: "${name}"...`);
    try {
      // Teams v2 search: click the search entry, type query, wait for results
      const searchTrigger = page.locator(
        '[data-tid="search-entry"], input[placeholder*="Search"], input[placeholder*="Tìm kiếm"], ' +
        '[data-tid="app-bar-item-search"], button[aria-label*="Search"], button[aria-label*="Tìm kiếm"]'
      ).first();
      const searchVisible = await searchTrigger.isVisible({ timeout: 3_000 }).catch(() => false);

      if (!searchVisible) {
        log("Không thấy ô search Teams.");
        return false;
      }

      await searchTrigger.click();
      await page.waitForTimeout(400);

      const searchInput = page.locator(
        '[data-tid="AUTOSUGGEST_INPUT"], input[placeholder*="Search"], input[placeholder*="Tìm kiếm"], ' +
        'input[role="searchbox"]'
      ).first();
      const inputVisible = await searchInput.isVisible({ timeout: 3_000 }).catch(() => false);

      if (!inputVisible) {
        log("Không thấy input search.");
        return false;
      }

      await searchInput.click();
      await searchInput.fill(name);
      await page.waitForTimeout(1_200);

      // Results usually appear as list items with the person's name.
      // Teams v2 shows people as `AUTOSUGGEST_SUGGESTION_TOPHITS<orgid>` options
      // with aria-label "Person <name> (<alias>) <org>", and group chats as
      // `AUTOSUGGEST_SUGGESTION_TOPHITS<threadId>@thread.v2` with aria-label
      // "Group chat <name>, <members...>".
      const clicked = await page.evaluate((target: string) => {
        const items = Array.from(document.querySelectorAll('[data-tid^="AUTOSUGGEST_SUGGESTION_TOPHITS"], [data-tid^="AUTOSUGGEST_SUGGESTION_PEOPLE"], [role="option"]'));
        const targetLower = target.toLowerCase().trim();
        const targetFirstWord = targetLower.split(/[\s,]+/)[0] || "";
        const startsWithBracket = targetLower.startsWith("[");

        // Priority 1: an explicit Person suggestion (has "Person" in aria-label or orgid tid)
        // NOTE: person search must come BEFORE group search — a person (1:1 chat like
        // "An Mai Thuan") would otherwise be shadowed by a group whose member list
        // happens to contain the same first word (e.g. "Anh").
        const personItem = items.find((el) => {
          const aria = (el as HTMLElement).getAttribute?.("aria-label") || "";
          if (!aria.toLowerCase().includes("person")) return false;
          const text = (el.textContent || "").trim();
          const norm = text.toLowerCase();
          if (startsWithBracket) {
            return text.toLowerCase().startsWith(targetLower.slice(0, 12)) ||
              norm.includes(targetLower) ||
              norm.startsWith(targetLower.slice(0, 12));
          }
          // Prefer a solid name-part overlap: every word of the target should appear
          // in the candidate name (in order), OR the candidate name fully contains
          // the target, OR the reverse. This keeps "An Mai Thuan" from matching a
          // group member substring like "Anh".
          const targetWords = targetLower.split(/[\s,]+/).filter(Boolean);
          const allWordsMatch = targetWords.length > 0 &&
            targetWords.every((w) => norm.includes(w)) &&
            targetWords.length >= 2;
          return allWordsMatch ||
            norm.includes(targetLower) ||
            targetLower.includes(norm.split(" ")[0] || "");
        });
        if (personItem) {
          (personItem as HTMLElement).click();
          return `Person: ${(personItem.textContent || "").trim().slice(0, 100)}`;
        }

        // Priority 2: Group chat (aria starts with "Group chat" or tid has @thread.v2)
        const groupItem = items.find((el) => {
          const tid = el.getAttribute("data-tid") || "";
          const aria = (el as HTMLElement).getAttribute?.("aria-label") || "";
          const text = (el.textContent || "").trim();
          const norm = text.toLowerCase();
          if (!aria.toLowerCase().startsWith("group chat") && !tid.includes("@thread.v2")) return false;
          if (startsWithBracket) {
            return text.toLowerCase().startsWith(targetLower.slice(0, 12)) ||
              norm.includes(targetLower) ||
              norm.startsWith(targetLower.slice(0, 12));
          }
          return norm.includes(targetLower) ||
            targetLower.includes(norm.split(" ")[0] || "") ||
            norm.includes(targetFirstWord) ||
            targetFirstWord.includes(norm.split(" ")[0] || "");
        });
        if (groupItem) {
          (groupItem as HTMLElement).click();
          return `Group: ${(groupItem.textContent || "").trim().slice(0, 100)}`;
        }

        // Priority 3: any result row whose text STARTS WITH the target
        // (strict — avoids clicking empty rows or unrelated "See more" items)
        const rowItem = items.find((el) => {
          const text = (el.textContent || "").trim();
          if (!text) return false;
          const norm = text.toLowerCase();
          if (/see more messages|send email|call |open profile|open chat|more messages|in all results|from:|messages|files|channels/i.test(text)) return false;
          if (text.length > 250) return false;
          // Strict: first line of the row must start with the target's first word
          const firstLine = norm.split("\n")[0].trim();
          return firstLine.startsWith(targetLower.slice(0, 12)) ||
            firstLine.includes(targetFirstWord) ||
            norm.includes(targetLower);
        });
        if (rowItem) {
          (rowItem as HTMLElement).click();
          return `Row: ${(rowItem.textContent || "").trim().slice(0, 100)}`;
        }

        return null;
      }, name);

      if (clicked) {
        log(`Search: da click vao ket qua "${clicked}"`);
        await waitForChatHeader(2_500);
        return true;
      }

      // Escape to close search results if nothing found
      await page.keyboard.press("Escape").catch(() => {});
      log("Search: khong tim thay ket qua nao.");
      return false;
    } catch (e) {
      log("Search loi: " + String(e));
      return false;
    }
  }

  // Fast path: nhóm đã nằm trong sidebar (dự án đang mở) — click ngay,
  // không mở ô Search (Search tốn 8–15s dù chat đã hiện).
  let found = await tryClickChat(chatName);
  if (found) {
    log(`Da click vao chat (sidebar): "${found}"`);
    await waitForChatHeader(4_000);
    return true;
  }

  // Chat chưa có trong recent list → search theo tên.
  const searchOpened = await trySearchChat(chatName);
  if (searchOpened) {
    log(`Da mo chat qua search: "${chatName}"`);
    await waitForChatHeader(4_000);
    // Search overlay che compose box — đóng trước khi caller tìm ô soạn tin.
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(250);
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
      await waitForChatHeader(4_000);
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
  await waitForChatHeader(3_000);

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
      await waitForChatHeader(4_000);
      return true;
    }
  }

  log(`Không tìm thấy chat "${chatName}" trong sidebar.`);
  return false;

  /** Poll header chat mở lên (tối đa maxMs) — dừng ngay khi header xuất hiện. */
  async function waitForChatHeader(maxMs: number): Promise<void> {
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
      try {
        const header = await page.evaluate(() =>
          document.querySelector('[data-tid="chat-title"], [data-tid="chat-header-title"]')?.textContent?.trim() || ""
        );
        if (header) return;
      } catch { /* SPA đang render */ }
      await page.waitForTimeout(400);
    }
  }
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
 * Chọn ảnh avatar của bubble message (Teams v2). Ưu tiên ảnh nằm trong wrapper
 * avatar của Teams (fui-Avatar / persona) trước; nếu không có, chọn ảnh nhỏ
 * (≤ 28px) bên trong wrapper — emoji cũng ≤ 28px nhưng nằm trong body, còn
 * avatar nằm ở container ngoài nên thứ tự selector vẫn ưu tiên đúng.
 * Trả null khi không tìm thấy (lúc đó dùng dicebear fallback ở UI).
 */
// Browser-only (page.evaluate): không dùng DOM API bên ngoài.
declare function pickSenderAvatarImg(rootEl: HTMLElement): HTMLImageElement | null;
declare function isUsableAvatarSrc(src: string): boolean;

/**
 * Định nghĩa thật (module scope) của 2 helper avatar — được inject vào
 * page.evaluate qua arg (serialize function). page.evaluate KHÔNG nhìn thấy
 * declare ở type level, nên phải truyền bằng giá trị qua arg.
 */
const avatarHelpersSource = `
function pickSenderAvatarImg(rootEl) {
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
    const img = rootEl.querySelector(sel);
    if (img && img.getAttribute('src')) return img;
  }
  const allImgs = rootEl.querySelectorAll('img[src]');
  let smallestArea = Infinity;
  let smallestImg = null;
  for (const img of allImgs) {
    const w = img.naturalWidth || parseInt(img.getAttribute('width') || '0');
    const h = img.naturalHeight || parseInt(img.getAttribute('height') || '0');
    const area = w * h;
    if (w > 0 && w <= 28 && h > 0 && h <= 28 && area < smallestArea) {
      smallestArea = area;
      smallestImg = img;
    }
  }
  return smallestImg;
}
function isUsableAvatarSrc(src) {
  if (!src || !src.length) return false;
  const lower = src.toLowerCase();
  if (lower.startsWith('data:image/svg')) return false; // placeholder svg
  if (lower.includes('/evergreen-assets/')) return false; // avatar chung Teams
  if (lower.includes('/evergreen-asset')) return false;
  if (lower.includes('/mountpoint/')) return false; // file mountpoint
  return true;
}
`;

/**
 * Hydrate avatar URL (Teams profilepicturev2, cần session đăng nhập) → data
 * URL base64 ngay trong-page — nếu không, URL hết hạn auth sau này → 401 →
 * UI fallback dicebear, mất avatar. Gọi sau mỗi lần extract (full lẫn
 * incremental / text-only) để mọi tin đều có avatar "vĩnh viễn".
 */
async function hydrateSenderAvatars(page: Page, messages: Array<{ senderAvatar?: string }>): Promise<void> {
  const avatarUrls = [...new Set(
    messages
      .map((m) => m.senderAvatar)
      .filter((u): u is string => typeof u === 'string' && u.length > 0 && !u.startsWith('data:'))
  )];
  if (avatarUrls.length === 0) return;

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
  for (const m of messages) {
    const av = m.senderAvatar;
    if (av && avatarCache.has(av)) {
      m.senderAvatar = avatarCache.get(av);
      hydrated++;
    }
  }
  log(`Hydrated ${hydrated} Teams avatars (${avatarCache.size} unique).`);
}

/**
 * Browser-only impl của pickSenderAvatarImg / isUsableAvatarSrc — các hàm
 * này được gọi trong page.evaluate (serialize biến thể truyền qua arg).
 * Vì vậy cần khai báo dạng function (không arrow) ở module scope.
 */
declare const __pickSenderAvatarImg: (rootEl: HTMLElement) => HTMLImageElement | null;

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
    log("Không tìm thấy message pane.");
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
    const isInc = config.incrementalSince !== undefined && config.incrementalSince > 0;
    if (isInc) {
      // Incremental: KHÔNG nudge — nudge (-60/+60px) có thể trigger Teams virtual
      // DOM unload tin mới nhất, làm extractor bỏ sót tin gửi sau watermark.
      // Chỉ scroll xuống đáy và chờ để đảm bảo tin mới nhất render.
      await page.evaluate(() => {
        const container = document.querySelector('[data-tid="message-pane-list-viewport"]') ||
          document.querySelector('[role="log"]') || document.documentElement;
        container.scrollTop = container.scrollHeight;
      });
      await page.waitForTimeout(2_000);
    } else {
      // Full sync: nudge để trigger image lazy-load (giữ nguyên behavior cũ).
      await page.evaluate(() => {
        const container = document.querySelector('[data-tid="message-pane-list-viewport"]') ||
          document.querySelector('[role="log"]') || document.documentElement;
        const pos = container.scrollTop;
        container.scrollBy({ top: -60, behavior: 'instant' as any });
        container.scrollBy({ top: 60, behavior: 'instant' as any });
        container.scrollTop = pos;
      });
      await page.waitForTimeout(4_000);
    }
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
  // NOTE: addScriptTag() is blocked by Teams CSP (TrustedScript) — inject the
  // helper via page.evaluate instead (define it directly on window).
  await page.evaluate(() => {
    (window as any).blobToBase64 = async function (url: string) {
      // Strategy: canvas FIRST (more reliable for already-rendered <img> elements
      // even after blob URLs are revoked). Only fall back to fetch() if canvas fails.
      try {
        const imgEl = Array.from(document.querySelectorAll('img')).find((img) => img.src === url);
        if (imgEl && imgEl.complete && imgEl.naturalWidth > 0 && imgEl.naturalHeight > 0) {
          // Set crossOrigin to anonymous to avoid tainted canvas errors
          try { (imgEl as any).crossOrigin = 'anonymous'; } catch (e) { /* ignore */ }
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
    };
  });
  const extractedMessages: ExtractedMessage[] = 
  await page.evaluate(async (args: { kwList: string[]; groupName: string; imgBlocklist: string[]; avatarHelpersSource: string }) => {
    // Inject avatar helpers (module-scope source, truyền qua arg — Playwright
    // không serialize closure của function evaluate).
    eval(args.avatarHelpersSource);
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
    // lastSenderIsMine (đồng bộ cùng lastSender) — chỉ fallback lastSender khi
    // bubble hiện tại CÙNG isMine với lastSender. Lý do: trong group chat nhiều
    // member, khi DOM đang lazy-load và nameEl chưa render, tin của 1 người khác
    // (isMine=false) kế thừa nhầm lastSender của bubble mine=Y trước đó → bị
    // gán thành "Me" sau cleanTeamMessages → sai user nhắn (xem PROJECT_STATUS:
    // "Hackathon test" 10/08: tin của "Luan Tran Cao" bị lưu sender="Me").
    let lastSenderIsMine = false;

    for (const el of wrappers) {
      const isMine = el.classList.contains('fui-ChatMyMessage') ||
        el.classList.contains('fui-ChatMyMessage__body') ||
        el.closest('.fui-ChatMyMessage') !== null;
      const nameEl = el.querySelector<HTMLElement>('[data-tid="message-author-name"]');
      let sender = nameEl?.textContent?.trim() || "";
      
      let senderAvatar = "";
      const avatarImg = pickSenderAvatarImg(el);
      if (avatarImg) {
        senderAvatar = avatarImg.getAttribute('src') || avatarImg.getAttribute('data-src') || "";
        // Loại placeholder chung của Teams (avatar giả "người dùng ẩn") —
        // nếu lưu nó, UI hiển thị ảnh placeholder thay vì dicebear fallback.
        if (!isUsableAvatarSrc(senderAvatar)) senderAvatar = "";
      }

      if (!sender && lastSender) {
        // Chỉ kế thừa lastSender nếu cùng isMine — tránh gán nhầm tin của người
        // khác cho "Me" hay ngược lại khi nameEl chưa render kịp do Teams v2
        // lazy-load. Nếu khác isMine → bỏ qua fallback (tin này sẽ được extract
        // ở lần sau khi nameEl render xong), trừ khi isMine=true (tin của mình):
        // class fui-ChatMyMessage đã xác nhận → sender="Me" trực tiếp.
        if (lastSenderIsMine === isMine) {
          sender = lastSender;
        } else if (isMine) {
          // DOM nói là mine, không có nameEl — tin của chính mình, không cần name.
          sender = "Me";
        }
        // else: isMine=false nhưng lastSender là mine khác → skip tin (no fallback)
      } else if (sender) {
        lastSender = sender;
        lastSenderIsMine = isMine;
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
      // Only use the real datetime from the <time> element. Falling back to
      // Date.now() made timestampMs change on every sync for messages without
      // a time element, which corrupted the messageId-based dedup and caused
      // duplicate rows on each re-sync.
      const rawDatetime = timeEl?.getAttribute("datetime");
      const parsedDatetime = rawDatetime ? new Date(rawDatetime).getTime() : NaN;
      const timestampMs = isNaN(parsedDatetime) ? undefined : parsedDatetime;

      // === Extract quoted/reply message ===
      // Teams v2 (2026) renders quoted replies with a "quote pill":
      //   <div class="fui-Flex" aria-label="Begin quote, Sender, date, content, End quote">
      //     <div data-tid="quoted-reply-card">
      //       <span class="fui-StyledText">Sender Name</span>
      //       <span data-tid="quoted-reply-timestamp">8/4/2026 9:20 AM</span>
      //       <span data-tid="quoted-reply-preview-content">quoted text</span>
      //     </div>
      //   </div>
      // Older Teams rendered <blockquote itemprop="quote"> — keep as fallback.
      let quoteSender = "";
      let quoteContent = "";
      const quotePill = el.querySelector<HTMLElement>('[data-tid="quoted-reply-card"]');
      if (quotePill) {
        // Sender = the span immediately before the timestamp span
        const qTimeEl = quotePill.querySelector<HTMLElement>('[data-tid="quoted-reply-timestamp"]');
        const qSenderEl = qTimeEl?.previousElementSibling as HTMLElement | null;
        quoteSender = qSenderEl?.textContent?.trim() || "";
        // Content = the dedicated preview element
        quoteContent = quotePill.querySelector<HTMLElement>('[data-tid="quoted-reply-preview-content"]')?.textContent?.trim() || "";
        // Fallback: parse the pill container aria-label
        if (!quoteSender || !quoteContent) {
          const pillContainer = quotePill.closest<HTMLElement>('[aria-label^="Begin quote"]');
          const label = pillContainer?.getAttribute("aria-label") || "";
          const body = label.replace(/^Begin quote,\s*/, "").replace(/,\s*End quote\s*$/, "");
          const parts = body.split(",");
          if (parts.length >= 3) {
            if (!quoteSender) quoteSender = parts[0].trim();
            const rest = parts.slice(2).join(",").trim();
            if (!quoteContent) quoteContent = rest;
          }
        }
      } else {
        // Some messages expose the quote only in the container aria-label
        const labelEl = el.querySelector<HTMLElement>('[aria-label*="Begin quote"]');
        const label = labelEl?.getAttribute("aria-label") || "";
        const body = label.replace(/^Begin quote,\s*/, "").replace(/,\s*End quote\s*$/, "");
        const parts = body.split(",");
        if (parts.length >= 3) {
          quoteSender = parts[0].trim();
          quoteContent = parts.slice(2).join(",").trim();
        }
      }
      // Legacy blockquote fallback
      if (!quoteSender && !quoteContent) {
        const quoteBq = el.querySelector<HTMLElement>('blockquote[itemtype*="schema.skype.com/Reply"], blockquote[itemprop*="quote"]');
        if (quoteBq) {
          const qNameEl = quoteBq.querySelector<HTMLElement>('strong[itemprop="mri"], [itemprop="mri"]');
          const qCopyEl = quoteBq.querySelector<HTMLElement>('[itemprop="copy"]') ||
            quoteBq.querySelector<HTMLElement>('[itemprop="preview"]');
          quoteSender = qNameEl?.textContent?.trim() || "";
          quoteContent = qCopyEl?.textContent?.trim() || "";
        }
      }

      let content = "";
      const bodyEl = el.querySelector<HTMLElement>(
        '[data-tid="message-body-content"], [data-tid="chat-pane-message"], .fui-ChatMessage__body, .fui-ChatMyMessage__body'
      );
      if (bodyEl) {
        const bodyClone = bodyEl.cloneNode(true) as HTMLElement;
        // Remove the quote (pill or blockquote) from the body so it isn't duplicated
        bodyClone.querySelectorAll('[data-tid="quoted-reply-card"]').forEach(e => e.remove());
        bodyClone.querySelectorAll('blockquote[itemtype*="schema.skype.com/Reply"], blockquote[itemprop*="quote"]').forEach(e => e.remove());
        // Remove the reaction summary ("1 Heart reaction." pills) — rendered
        // separately, not part of the message body.
        bodyClone.querySelectorAll('.fui-ChatMessage__reactions, .fui-ChatMyMessage__reactions, [data-tid="diverse-reaction-summary"]').forEach(e => e.remove());
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
          // CSP (TrustedHTML) blocks innerHTML assignment on Teams — use textContent.
          bq.textContent = `\n> ${bq.innerText.trim()}\n`;
        });
        
        clone.querySelectorAll('div').forEach(div => {
          div.textContent = (div.textContent || "") + ' ';
        });

        content = clone.textContent?.trim().replace(/\s{2,}/g, " ") || "";
      }

      // Strip any residual "Begin quote ... End quote" placeholder text that
      // Teams v2 embeds in the body when the quote pill is not removed.
      if (content.includes("Begin quote") || content.includes("End quote")) {
        content = content.replace(/Begin quote[\s\S]*?End quote/g, " ").replace(/\s{2,}/g, " ").trim();
      }
      // Strip the " image " marker Teams v2 inserts between attachments.
      content = content.replace(/\s+image\s+/gi, " ").replace(/\s{2,}/g, " ").trim();

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

      // Dedup key PHẢI bao gồm timestampMs. Trước đây key = sender|content|images
      // (không có timestamp) → 2 tin cùng nội dung nhưng khác thời điểm (vd tin
      // "Chào chị To Thi..." gửi lại nhiều lần lúc 10:44, 11:33, 11:37) bị coi
      // là 1, chỉ giữ tin đầu tiên → các tin mới hơn watermark bị bỏ sót, sync
      // báo saved=0 dù Teams có tin mới. Thêm timestampMs để phân biệt.
      const key = `${sender}|${content.slice(0, 80)}|${images.join(',')}|${timestampMs ?? ''}`;
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
        timestampMs,
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
    ],
    avatarHelpersSource
  });

  log(`Trich xuat duoc ${extractedMessages.length} tin nhan.`);

  // Hydrate avatar URL → data URL trong-page (URL cần session Teams, hết hạn
  // sau này) — trước cleanTeamMessages để không bỏ sót avatar.
  await hydrateSenderAvatars(page, extractedMessages);

  // Gán sender="Me" cho tin do chính mình gửi (class fui-ChatMyMessage hoặc
  // tên hiển thị khớp danh xưng "Me" — Teams không luôn gắn class own-message).
  cleanTeamMessages(extractedMessages);

  extractedMessages.sort((a, b) => (a.timestampMs ?? 0) - (b.timestampMs ?? 0));

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

  const extractedMessages: ExtractedMessage[] = await page.evaluate((args: { groupName: string; avatarHelpersSource: string }) => {
    // Inject avatar helpers (module-scope source, truyền qua arg).
    eval(args.avatarHelpersSource);
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
    let lastSenderAvatar = "";
    // lastSenderIsMine (đồng bộ cùng lastSender) — chỉ fallback lastSender khi
    // bubble hiện tại CÙNG isMine với lastSender. Xem giải thích trong extractMessages.
    let lastSenderIsMine = false;

    for (const el of wrappers) {
      const isMine = el.classList.contains('fui-ChatMyMessage') ||
        el.classList.contains('fui-ChatMyMessage__body') ||
        el.closest('.fui-ChatMyMessage') !== null;
      const nameEl = el.querySelector<HTMLElement>('[data-tid="message-author-name"]');
      let sender = nameEl?.textContent?.trim() || "";

      // Avatar giống hệt extractMessages — nếu không tìm được ảnh thật
      // (placeholder evergreen-asset…) thì coi như không có, để UI fallback
      // dicebear thay vì hiển thị ảnh mặc định chung.
      let senderAvatar = "";
      const avatarImg = pickSenderAvatarImg(el);
      if (avatarImg) {
        senderAvatar = avatarImg.getAttribute('src') || avatarImg.getAttribute('data-src') || "";
        if (!isUsableAvatarSrc(senderAvatar)) senderAvatar = "";
      }

      if (!sender && lastSender) {
        if (lastSenderIsMine === isMine) {
          sender = lastSender;
        } else if (isMine) {
          sender = "Me";
        }
      } else if (sender) {
        lastSender = sender;
        lastSenderIsMine = isMine;
      }

      if (!senderAvatar && lastSenderAvatar && sender === lastSender) {
        senderAvatar = lastSenderAvatar;
      } else if (senderAvatar) {
        lastSenderAvatar = senderAvatar;
      }

      const timeEl = el.querySelector<HTMLTimeElement>("time");
      const timestampText = timeEl?.getAttribute("aria-label") || timeEl?.textContent?.trim() || "";
      // Same rule as extractMessages: never fabricate Date.now() timestamps.
      const rawDatetime = timeEl?.getAttribute("datetime");
      const parsedDatetime = rawDatetime ? new Date(rawDatetime).getTime() : NaN;
      const timestampMs = isNaN(parsedDatetime) ? undefined : parsedDatetime;

      // === Extract quoted/reply message (same logic as extractMessages) ===
      let quoteSender = "";
      let quoteContent = "";
      const quotePill = el.querySelector<HTMLElement>('[data-tid="quoted-reply-card"]');
      if (quotePill) {
        const qTimeEl = quotePill.querySelector<HTMLElement>('[data-tid="quoted-reply-timestamp"]');
        const qSenderEl = qTimeEl?.previousElementSibling as HTMLElement | null;
        quoteSender = qSenderEl?.textContent?.trim() || "";
        quoteContent = quotePill.querySelector<HTMLElement>('[data-tid="quoted-reply-preview-content"]')?.textContent?.trim() || "";
        if (!quoteSender || !quoteContent) {
          const pillContainer = quotePill.closest<HTMLElement>('[aria-label^="Begin quote"]');
          const label = pillContainer?.getAttribute("aria-label") || "";
          const body = label.replace(/^Begin quote,\s*/, "").replace(/,\s*End quote\s*$/, "");
          const parts = body.split(",");
          if (parts.length >= 3) {
            if (!quoteSender) quoteSender = parts[0].trim();
            const rest = parts.slice(2).join(",").trim();
            if (!quoteContent) quoteContent = rest;
          }
        }
      } else {
        const labelEl = el.querySelector<HTMLElement>('[aria-label*="Begin quote"]');
        const label = labelEl?.getAttribute("aria-label") || "";
        const body = label.replace(/^Begin quote,\s*/, "").replace(/,\s*End quote\s*$/, "");
        const parts = body.split(",");
        if (parts.length >= 3) {
          quoteSender = parts[0].trim();
          quoteContent = parts.slice(2).join(",").trim();
        }
      }
      if (!quoteSender && !quoteContent) {
        const quoteBq = el.querySelector<HTMLElement>('blockquote[itemtype*="schema.skype.com/Reply"], blockquote[itemprop*="quote"]');
        if (quoteBq) {
          const qNameEl = quoteBq.querySelector<HTMLElement>('strong[itemprop="mri"], [itemprop="mri"]');
          const qCopyEl = quoteBq.querySelector<HTMLElement>('[itemprop="copy"]') ||
            quoteBq.querySelector<HTMLElement>('[itemprop="preview"]');
          quoteSender = qNameEl?.textContent?.trim() || "";
          quoteContent = qCopyEl?.textContent?.trim() || "";
        }
      }

      let content = "";
      const bodyEl = el.querySelector<HTMLElement>(
        '[data-tid="message-body-content"], [data-tid="chat-pane-message"], .fui-ChatMessage__body, .fui-ChatMyMessage__body'
      );
      if (bodyEl) {
        const bodyClone = bodyEl.cloneNode(true) as HTMLElement;
        bodyClone.querySelectorAll('[data-tid="quoted-reply-card"]').forEach(e => e.remove());
        bodyClone.querySelectorAll('blockquote[itemtype*="schema.skype.com/Reply"], blockquote[itemprop*="quote"]').forEach(e => e.remove());
        bodyClone.querySelectorAll('.fui-ChatMessage__reactions, .fui-ChatMyMessage__reactions, [data-tid="diverse-reaction-summary"]').forEach(e => e.remove());
        content = bodyClone.textContent?.trim().replace(/\s{2,}/g, " ") || "";
      }

      // Strip any residual "Begin quote ... End quote" placeholder text.
      if (content.includes("Begin quote") || content.includes("End quote")) {
        content = content.replace(/Begin quote[\s\S]*?End quote/g, " ").replace(/\s{2,}/g, " ").trim();
      }
      // Strip the " image " marker Teams v2 inserts between attachments.
      content = content.replace(/\s+image\s+/gi, " ").replace(/\s{2,}/g, " ").trim();

      if (quoteSender && quoteContent) {
        content = `> ${quoteSender}: ${quoteContent}\n${content}`;
      }

      if (!content || !sender) continue;

      // Dedup key bao gồm timestampMs (giống extractMessages) để không bỏ sót
      // tin cùng nội dung nhưng khác thời điểm (tin gửi lại sau watermark).
      const key = `${sender}|${content.slice(0, 80)}|${timestampMs ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);

      counter++;
      results.push({
        id: `text_${counter}_${Date.now()}`,
        sender,
        senderAvatar: senderAvatar || undefined,
        content,
        images: undefined,
        timestamp: timestampText,
        timestampMs,
        groupName: args.groupName,
        hasKeyword: false,
        matchedKeywords: [],
        isMine: isMine || undefined,
      });
    }

    return results;
  }, { groupName: pageInfo.channelName, avatarHelpersSource });

  log(`Trich xuat text: ${extractedMessages.length} messages`);

  // Hydrate avatar URL → data URL (extractTextOnly chạy trước early-stop —
  // nếu không có extractMessages nào chạy thì avatar sẽ là URL hết hạn).
  await hydrateSenderAvatars(page, extractedMessages);

  // Gán sender="Me" cho tin do chính mình gửi (xem cleanTeamMessages).
  cleanTeamMessages(extractedMessages);

  extractedMessages.sort((a, b) => (a.timestampMs ?? 0) - (b.timestampMs ?? 0));

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

  // Incremental sync: once we've collected a message at/below the DB watermark
  // (timestampMs), everything older is already stored — stop scrolling early.
  const seenIncrementalSince = (): boolean => {
    if (config.incrementalSince === undefined || config.incrementalSince <= 0) return false;
    for (const m of allMessages.values()) {
      const ts = (m as any).timestampMs;
      if (typeof ts === "number" && ts > 0 && ts <= (config.incrementalSince as number)) return true;
    }
    return false;
  };

  // FAST watermark detect: scan the currently rendered DOM for any message
  // time at/below the DB watermark, WITHOUT running the full extractor
  // (which is slow — it walks every bubble, hydrates avatars, converts
  // images). Teams renders <time datetime="..."> on messages; the newest
  // rendered bubble's datetime is the top of the visible window.
  const domHasIncrementalSince = async (): Promise<boolean> => {
    if (config.incrementalSince === undefined || config.incrementalSince <= 0) return false;
    return page.evaluate((since) => {
      // Kiểm tra xem DOM có còn tin mới hơn watermark không. Nếu TẤT CẢ
      // time[datetime] đều <= watermark → đã chạm vùng đã lưu → early-stop.
      // Trước đây dùng querySelector (element đầu tiên) — sai khi DOM chứa
      // cả tin cũ (<= watermark) lẫn tin mới (> watermark): element đầu tiên
      // là tin cũ → trả true → EARLY-STOP sai, bỏ sót tin mới.
      const times = Array.from(document.querySelectorAll<HTMLTimeElement>('time[datetime]'));
      if (times.length === 0) return false;
      let hasNewer = false;
      for (const t of times) {
        const ts = new Date(t.getAttribute("datetime") || "").getTime();
        if (!isNaN(ts) && ts > 0 && ts > since) { hasNewer = true; break; }
      }
      // Có tin mới hơn watermark trong DOM → chưa nên dừng.
      if (hasNewer) return false;
      return true;
    }, config.incrementalSince).catch(() => false);
  };

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
        timestampMs: (m as any).timestampMs,
        // Giữ isMine từ extract (sẽ true khi sender="Me" nhờ cleanTeamMessages).
        // Trước đây addToCollection dropout flag này → DB lưu isMine=null cho
        // mọi tin Teams → UI phải dựa vào sender="Me" mới biết tin của mình.
        isMine: (m as any).isMine,
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
      } else if (
        // Tin đã có trong collection nhưng được extract lại với thông tin
        // tốt hơn: (a) sender cụ thể (Luan Tran Cao...) thay vì "Me"/"",
        // (b) isMine=true rõ ràng thay vì null. Vì key dedup chứa sender,
        // 2 lần extract cùng 1 tin với sender khác nhau tạo 2 key khác nhau
        // → saveMessages upsert theo messageId (timestampMs+content) nên row
        // cuối phụ thuộc thứ tự save. Ưu tiên sender cụ thể để lần save sau
        // không ghi đè sender đúng bằng "Me" (bug: tin Luan "ok anh thấy rồi
        // nha" bị lưu Me dù DOM nói Luan).
        (cleaned.sender && cleaned.sender !== "Me" && (!existing.sender || existing.sender === "Me")) ||
        (cleaned.isMine && !existing.isMine)
      ) {
        // Cùng timestampMs+content nhưng sender/isMine tốt hơn → thay thế
        const better = { ...existing, ...cleaned, sender: cleaned.sender || existing.sender };
        allMessages.delete(key);
        const betterKey = `${better.sender}|${better.timestampMs}|${(better.content || '').slice(0, 30)}`;
        allMessages.set(betterKey, better as any);
      }
    }
  };

  // ── Build final result (dùng khi early-stop) ──
  const buildFinalResult = async (): Promise<TeamsExtractResult> => {
    const msgs = Array.from(allMessages.values())
      .filter((m: any) => m.content || m.images?.length)
      .sort((a: any, b: any) => a.timestampMs - b.timestampMs);
    const channelNames = await page
      .evaluate(() => {
        const el =
          document.querySelector<HTMLElement>('[data-tid="chat-title"]') ||
          document.querySelector<HTMLElement>('[data-tid="chat-header-title"]') ||
          document.querySelector<HTMLElement>('[data-tid="thread-header-title"]');
        return el?.textContent?.trim() || "";
      })
      .catch(() => "");
    const result: TeamsExtractResult = {
      channelName: channelNames,
      teamName: "",
      totalMessages: msgs.length,
      messages: msgs as ExtractedMessage[],
      extractedAt: new Date().toISOString(),
    };
    mergeOutput(result, config);
    log(`[Incremental] FINAL: ${result.totalMessages} messages, ${result.messages.filter(m => m.images?.length).length} with images.`);
    return result;
  };

  // ── Step 1: Fast Timestamp Check & Extract at BOTTOM ──
  log("[Incremental] Step 1: Checking timestamps at bottom...");
  // Scroll xuống đáy NHIỀU LẦN với thời gian chờ giữa các lần. Teams v2 dùng
  // virtual DOM — khi chat vừa mở, scrollHeight chưa cập nhật đầy đủ, và tin
  // mới nhất chỉ render sau khi scroll + chờ. Scroll 1 lần + chờ 1s (trước đây)
  // thường KHÔNG đưa được tin mới nhất (vd tin gửi sau watermark) vào DOM →
  // extractor bỏ sót, sync báo saved=0 dù Teams có tin mới.
  await page.evaluate(() => {
    const c =
      document.querySelector('[data-tid="message-pane-list-viewport"]') ||
      document.querySelector('[role="log"]') ||
      document.documentElement;
    c.scrollTop = c.scrollHeight;
  });
  await page.waitForTimeout(1_200);
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => {
      const c =
        document.querySelector('[data-tid="message-pane-list-viewport"]') ||
        document.querySelector('[role="log"]') ||
        document.documentElement;
      c.scrollTop = c.scrollHeight;
    });
    await page.waitForTimeout(900);
  }

  if (config.incrementalSince !== undefined && config.incrementalSince > 0) {
    const tsInfo = await page.evaluate(() => {
      let maxTs = -1;
      let minTs = Infinity;
      document.querySelectorAll<HTMLTimeElement>('time[datetime]').forEach(t => {
        const ts = new Date(t.getAttribute("datetime") || "").getTime();
        if (!isNaN(ts) && ts > 0) {
          if (ts > maxTs) maxTs = ts;
          if (ts < minTs) minTs = ts;
        }
      });
      return { maxTs, minTs: minTs === Infinity ? -1 : minTs };
    });

    if (tsInfo.maxTs > 0 && tsInfo.maxTs <= config.incrementalSince) {
      log(`[Incremental] EARLY-STOP at Step 1: max visible time ${tsInfo.maxTs} <= watermark ${config.incrementalSince}. (0 new messages)`);
      return await buildFinalResult();
    }
  }

  log("[Incremental] Extracting newest messages at bottom with images...");
  const isIncremental = config.incrementalSince !== undefined && config.incrementalSince > 0;
  if (isIncremental) {
    // Incremental: không cần chờ ảnh lazy-load đầy đủ (tin mới thường đã render
    // text). Rút ngắn wait để tốc độ thuần tăng — ảnh sẽ tự tải khi user mở chat.
    await page.waitForTimeout(800);
    const bottomResult = await extractMessages(page, config, true);
    addToCollection(bottomResult.messages, true);
  } else {
    await page.waitForTimeout(2_000);
    await page.evaluate(() => {
      document.querySelectorAll<HTMLImageElement>('img').forEach(img => {
        img.scrollIntoView({ block: "center", inline: "nearest" });
      });
    });
    await page.waitForTimeout(5_000);
    const bottomResult = await extractMessages(page, config, true);
    addToCollection(bottomResult.messages, true);
  }
  log(`[Incremental] Bottom done: ${allMessages.size} unique msgs.`);

  if (isIncremental) {
    if (await domHasIncrementalSince()) {
       log(`[Incremental] EARLY-STOP after Step 1: found message <= watermark ${config.incrementalSince}. All new messages are on the first page.`);
       return await buildFinalResult();
    }
  }

  // ── Step 2: Incremental scroll-up (FULL SYNC only) ──
  if (fullSync && config.scrollCount > 0) {
    const totalBatches = Math.ceil(config.scrollCount / EXTRACT_EVERY_N);
    log(`[Incremental] Step 2: Scrolling up ${config.scrollCount}x, text-only extract every ${EXTRACT_EVERY_N} (${totalBatches} batches)`);

    for (let batch = 0; batch < totalBatches; batch++) {
      // Send preemption: nếu có send lock (zalo-send/teams-send đang chờ),
      // dừng sớm để nhường Chrome — vòng sync tiếp theo sẽ đồng bộ bù.
      if (isSendWaiting()) {
        log(`[Incremental] PHÁT HIỆN send đang chờ — dừng scroll sớm tại batch ${batch + 1}/${totalBatches} để nhường Chrome.`);
        const lastBatch = await extractTextOnly(page, config);
        addToCollection(lastBatch.messages, false);
        log(`[Incremental] Final batch (preempt): ${lastBatch.messages.length} text msgs, ${allMessages.size} unique`);
        return await buildFinalResult();
      }
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
        // Incremental rút ngắn wait: chỉ cần DOM render window mới enough để
        // đo watermark — không cần chờ ảnh đầy đủ. Full sync giữ wait cũ.
        const isInc = config.incrementalSince !== undefined && config.incrementalSince > 0;
        await page.waitForTimeout(isInc ? 700 + randomInt(200, 600) : config.scrollWaitMs + randomInt(500, 1500));

        // Incremental fast-detect mỗi lượt scroll: chỉ đọc timestamp của message
        // mới nhất trong DOM — gặp message <= watermark là đã chạm vùng đã lưu,
        // đủ điều kiện dừng (KHÔNG cần extract text batch — nhanh hơn nhiều).
        if (config.incrementalSince !== undefined && config.incrementalSince > 0) {
          if (await domHasIncrementalSince()) {
            log(`[Incremental] EARLY-STOP at scroll ${scrollNum}: DOM time <= watermark ${config.incrementalSince}`);
            // Collect text-only lần cuối (messages vừa scroll tới) rồi dừng.
            const lastBatch = await extractTextOnly(page, config);
            addToCollection(lastBatch.messages, false);
            log(`[Incremental] Final batch: ${lastBatch.messages.length} text msgs, ${allMessages.size} unique`);
            if (seenIncrementalSince()) {
              log(`[Incremental] EARLY-STOP at batch ${batch + 1}: found message <= incrementalSince=${config.incrementalSince}`);
            }
            return await buildFinalResult();
          }
        }
      }

      const batchResult = await extractTextOnly(page, config);
      addToCollection(batchResult.messages, false);
      log(`[Incremental] Batch ${batch + 1}/${totalBatches}: ${batchResult.messages.length} text msgs, ${allMessages.size} unique`);

      // Incremental early-stop: watermark reached → skip remaining batches + top pass
      if (seenIncrementalSince()) {
        log(`[Incremental] EARLY-STOP at batch ${batch + 1}: found message <= incrementalSince=${config.incrementalSince}`);
        break;
      }
    }
  } else {
    log("[Incremental] Step 2: Skipped (quick update mode, scrollCount=0)");
  }

  // ── Step 3: Final extraction at TOP with images (oldest messages) ──
  if (fullSync && !seenIncrementalSince()) {
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
  } else if (seenIncrementalSince()) {
    log("[Incremental] Step 3: Skipped (early-stop reached incremental watermark)");
  } else {
    log("[Incremental] Step 3: Skipped (quick update mode)");
  }

  // ── Final path: build result + hydrate avatars (nếu có) ──
  const finalMessages = Array.from(allMessages.values())
    .filter((m: any) => m.content || m.images?.length)
    .sort((a: any, b: any) => a.timestampMs - b.timestampMs);

  await hydrateSenderAvatars(page, finalMessages);

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
 * Verify the currently open chat is the intended target (Teams v2).
 * Reads the header title and checks it contains the target name.
 * Handles name order variants ("Mai Thuận An" vs "An Mai Thuan") and email/alias.
 */
export async function verifyOpenChatTeams(
  page: Page,
  targetName: string
): Promise<{ verified: boolean; headerName?: string; reason?: string }> {
  const headerRaw = await page.evaluate(() => {
    const el =
      document.querySelector('[data-tid="chat-title"]') ||
      document.querySelector('[data-tid="chat-header-title"]') ||
      document.querySelector('[data-testid="header-chat-title"]') ||
      document.querySelector('[data-tid="chat-topic-menu"]') ||
      document.querySelector('[aria-label*="chat"], [data-tid="header"] h1, [data-tid="header"] h2, [data-tid="header"] div[class*="title"]');
    return el?.textContent?.trim() || "";
  });

  if (!headerRaw) {
    return { verified: false, reason: "Không tìm thấy header chat (không thể verify)." };
  }

  // Extract only the participant names — strip app chrome text like
  // "Send feedback", timestamps, and last message previews.
  const headerName = headerRaw
    .split("Send feedback")[0]
    .split("You, ")[1] || headerRaw.split("Send feedback")[0];

  const targetLower = targetName.toLowerCase().trim();
  // Normalize: strip diacritics for fuzzy compare
  const strip = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const headerNorm = strip(headerName);
  const targetNorm = strip(targetLower);

  // Token-level match: every significant token of the target should appear in header.
  // Also handle reversed name order ("An Mai Thuan" vs "Mai Thuận An").
  const targetTokens = targetNorm.split(/[\s,]+/).filter((t) => t.length > 1);
  const headerTokens = headerNorm.split(/[\s,]+/).filter((t) => t.length > 1);

  const allTokensFound = targetTokens.length > 0 && targetTokens.every((t) =>
    headerTokens.some((h) => h.includes(t) || t.includes(h))
  );

  // Email/alias match: target email (anmt3@...) vs header "An Mai Thuan (ANMT3)"
  const emailMatch = targetNorm.includes("@") &&
    (headerNorm.includes(targetNorm.split("@")[0]) ||
     headerNorm.includes("anmt3"));

  const verified = allTokensFound || emailMatch;

  if (!verified) {
    return {
      verified: false,
      headerName,
      reason: `Header chat "${headerName}" khong khop voi target "${targetName}".`,
    };
  }
  return { verified: true, headerName };
}

// ─── Search person theo email (Teams v2) ────────────────────
export interface TeamsPersonSearchResult {
  ok: boolean;
  error?: string;
  /** Nếu tìm được: tên hiển thị từ kết quả search */
  name?: string;
  /** Nếu tìm được: email hiển thị trong kết quả */
  email?: string;
  /** Tên chi tiết từng kết quả trả về (kể cả không khớp chính xác) */
  suggestions?: Array<{ name: string; email?: string; alias?: string; raw: string }>;
}

/**
 * Tìm người trong Teams theo email (hoặc tên/alias) qua ô search.
 *
 * Cơ chế (đã có sẵn trong navigateToChatInSidebar/trySearchChat, verify trên
 * Chrome thật 07/08): bấm search entry → gõ query → đọc các suggestion
 * `AUTOSUGGEST_SUGGESTION_*` có aria-label "Person <tên> (<alias>) <org>".
 * Riêng email → hiển thị rõ ràng trong item nên không cần mở profile card.
 *
 * KHÔNG clone profile: dùng createStealthContext chuẩn (CDP nếu Chrome thật
 * đang mở, fallback persistent profile `.teams-session/chrome-profile`).
 */
export async function searchTeamsPerson(
  page: Page,
  query: string
): Promise<TeamsPersonSearchResult> {
  const q = query.trim();
  if (!q) return { ok: false, error: "query is required" };

  try {
    // Trường hợp panel search đã mở sẵn (từ lần chạy trước / user tự mở): input
    // AUTOSUGGEST_INPUT hiển thị, không cần bấm search-entry nữa.
    const openInput = page.locator('[data-tid="AUTOSUGGEST_INPUT"]').first();
    const openInputVisible = await openInput.isVisible({ timeout: 1_500 }).catch(() => false);
    if (openInputVisible) {
      await openInput.click();
      await openInput.fill(q);
    } else {
      const searchTrigger = page.locator(
        '[data-tid="search-entry"], input[placeholder*="Search"], input[placeholder*="Tìm kiếm"], ' +
        '[data-tid="app-bar-item-search"], button[aria-label*="Search"], button[aria-label*="Tìm kiếm"]'
      ).first();
      const visible = await searchTrigger.isVisible({ timeout: 3_000 }).catch(() => false);
      if (!visible) {
        log("Search person: khong thay o search Teams.");
        return { ok: false, error: "Không thấy ô search Teams." };
      }
      await searchTrigger.click();
      await page.waitForTimeout(1_200);

      const searchInput = page.locator(
        '[data-tid="AUTOSUGGEST_INPUT"], input[placeholder*="Search"], input[placeholder*="Tìm kiếm"], ' +
        'input[role="searchbox"]'
      ).first();
      const inputVisible = await searchInput.isVisible({ timeout: 3_000 }).catch(() => false);
      if (!inputVisible) {
        log("Search person: khong thay input search.");
        return { ok: false, error: "Không thấy ô nhập search." };
      }
      await searchInput.click();
      await searchInput.fill(q);
    }
    await page.waitForTimeout(2_800);

    // Đọc suggestion hiển thị (person + group + "see more") — ưu tiên Person.
    const suggestions: TeamsPersonSearchResult["suggestions"] = [];
    const top = await page.evaluate(() => {
      const items = Array.from(
        document.querySelectorAll(
          '[data-tid^="AUTOSUGGEST_SUGGESTION_TOPHITS"], [data-tid^="AUTOSUGGEST_SUGGESTION_PEOPLE"], [role="option"], [data-tid^="AUTOSUGGEST_SUGGESTION_"]'
        )
      );
      return items
        .map((el) => {
          const aria = (el as HTMLElement).getAttribute?.("aria-label") || "";
          const text = ((el as HTMLElement).textContent || "").trim().replace(/\s+/g, " ").slice(0, 300);
          return { aria, text, tid: el.getAttribute("data-tid") || "" };
        })
        .filter((x) => x.text.length > 0 && !/see more messages|send email|call |open profile|open chat/i.test(x.text));
    });
    for (const t of top) {
      const isPerson = t.aria.toLowerCase().includes("person") || t.tid.includes("PEOPLE");
      if (!isPerson) continue;
      // Ưu tiên aria-label chuẩn của Teams: "Person <tên> (<alias>) <org>"
      // (textContent dính cả hint "Use arrow keys to access controls" + avatar).
      const raw = t.aria.includes("Person") || t.aria.includes("person")
        ? t.aria.replace(/^Person:?\s*/i, "")
        : t.text;
      const nameRaw = raw.split("\n")[0].trim();
      const emailMatch = raw.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
      let email: string | undefined;
      if (emailMatch) email = emailMatch[0];
      // Tách alias khỏi tên: "An Mai Thuan (ANMT3) FCI - CLOUD" → tên "An Mai Thuan",
      // giữ nguyên khi không có ngoặc.
      const parenMatch = nameRaw.match(/^(.*?)\s*\(([^)]+)\)\s*(.*)$/);
      const name = parenMatch
        ? parenMatch[1].trim()
        : nameRaw.replace(/\s*\(.*\)\s*$/, "").trim();
      // Alias trong ngoặc: "An Mai Thuan (ANMT3) FCI - CLOUD" → "ANMT3"
      const alias = parenMatch ? parenMatch[2].trim() : undefined;
      suggestions.push({ name, email, alias, raw });
    }

    // Dedup theo name
    const seen = new Set<string>();
    const uniq = suggestions.filter((s) => {
      const k = s.name.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    if (uniq.length === 0) {
      await page.keyboard.press("Escape").catch(() => {});
      log(`Search person: khong tim thay nguoi nao khop "${q}".`);
      return { ok: false, error: `Không tìm thấy ai khớp "${q}".`, suggestions: [] };
    }

    // Ưu tiên kết quả khớp chính xác email / alias / toàn bộ từ
    const qLower = q.toLowerCase();
    const qEmail = qLower.includes("@") ? qLower.split("@")[0] : "";
    const exact = uniq.find((s) =>
      (s.email && s.email.toLowerCase() === qLower) ||
      (qEmail && s.email && s.email.toLowerCase().startsWith(qEmail)) ||
      (s.alias && s.alias.toLowerCase() === qLower) ||
      s.name.toLowerCase() === qLower
    );
    const chosen = exact || uniq[0];

    await page.keyboard.press("Escape").catch(() => {});
    return { ok: true, name: chosen.name, email: chosen.email, suggestions: uniq };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}


export interface TeamsSendOptions {
  chatName: string;
  message: string;
  dryRun?: boolean;
  /** Compose-only: mở chat, soạn sẵn tin nhắn vào ô soạn thảo NHƯNG giữ nguyên
   * để user tự kiểm tra rồi bấm Gửi — không gửi, không xoá. */
  composeOnly?: boolean;
  screenshots?: boolean;
  openWaitMs?: number;
}

export interface TeamsSendResult {
  ok: boolean;
  error?: string;
  dryRun?: boolean;
  composeOnly?: boolean;
  targetChat?: string;
  screenshot?: string;
}

/**
 * Gửi tin nhắn tới một chat Teams (nhóm hoặc 1:1) với cơ chế verify an toàn:
 * - Mở chat qua sidebar (tìm theo tên hoặc viewId/email)
 * - CHỈ gửi khi xác minh được chat đang mở đúng tên mục tiêu
 * - Dry run: nhập tin rồi xoá, KHÔNG gửi
 */
const TEAMS_COMPOSE_SELECTORS = [
  '[data-tid="compose-content"] [contenteditable="true"]',
  '[data-tid="ckeditor-text-input"] [contenteditable="true"]',
  '[data-tid="ckeditor"] [contenteditable="true"]',
  '[data-tid*="compose"] [contenteditable="true"]',
  'div[role="textbox"][contenteditable="true"]',
  '[aria-label*="Type a message" i][contenteditable="true"]',
  '[aria-label*="soạn" i][contenteditable="true"]',
  '[aria-placeholder*="Type a message" i]',
  '[aria-placeholder*="soạn" i]',
];

/**
 * Tìm ô soạn tin Teams ĐANG HIỆN — không dùng `.first()` trên `[contenteditable]`
 * (DOM có nhiều contenteditable ẩn: search, quote, edit) nên isVisible() fail.
 */
async function findTeamsComposeInput(page: Page, timeoutMs = 12_000): Promise<ReturnType<Page["locator"]> | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await page.evaluate(() => {
      const panes = document.querySelectorAll(
        '[data-tid="message-pane"], [data-tid="chat-pane"], [role="log"], [data-tid="chat-pane-list"]'
      );
      panes.forEach((p) => {
        (p as HTMLElement).scrollTop = (p as HTMLElement).scrollHeight;
      });
    }).catch(() => {});

    for (const sel of TEAMS_COMPOSE_SELECTORS) {
      const loc = page.locator(sel);
      const n = await loc.count().catch(() => 0);
      for (let i = 0; i < n; i++) {
        const item = loc.nth(i);
        if (await item.isVisible().catch(() => false)) {
          await item.scrollIntoViewIfNeeded().catch(() => {});
          return item;
        }
      }
    }

    // Fallback: contenteditable visible nằm thấp nhất (ô soạn tin ở đáy chat)
    const idx = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('[contenteditable="true"]')) as HTMLElement[];
      const visible = nodes
        .map((el, i) => ({ el, i, r: el.getBoundingClientRect() }))
        .filter(({ r, el }) => {
          const st = getComputedStyle(el);
          return (
            r.width > 80 &&
            r.height > 18 &&
            st.visibility !== "hidden" &&
            st.display !== "none" &&
            r.bottom > 0 &&
            r.top < window.innerHeight
          );
        });
      if (visible.length === 0) return -1;
      visible.sort((a, b) => b.r.top - a.r.top);
      return visible[0].i;
    }).catch(() => -1);
    if (typeof idx === "number" && idx >= 0) {
      const item = page.locator('[contenteditable="true"]').nth(idx);
      if (await item.isVisible().catch(() => false)) {
        await item.scrollIntoViewIfNeeded().catch(() => {});
        return item;
      }
    }

    await page.waitForTimeout(400);
  }
  return null;
}

export async function sendTeamsMessage(
  page: Page,
  options: TeamsSendOptions
): Promise<TeamsSendResult> {
  const { chatName, message, dryRun, composeOnly, screenshots, openWaitMs = 5_000 } = options;

  if (!chatName?.trim()) return { ok: false, error: "chatName is required" };
  if (!message?.trim()) return { ok: false, error: "message is required" };
  if (message.length > 2000) return { ok: false, error: "message too long (max 2000 chars)" };

  const shotDir = path.join(process.cwd(), "teams-screenshots");
  if (screenshots) ensureDir(shotDir);
  const stamp = Date.now();

  // ── 1. Open the target chat via sidebar ─────────────────────
  log(`Mo chat "${chatName}" trong sidebar...`);
  const opened = await navigateToChatInSidebar(page, chatName);
  if (!opened) {
    return { ok: false, error: `Không tìm thấy chat "${chatName}" trong sidebar. Không gửi gì cả.` };
  }

  // ── 2. VERIFY the open chat is the intended target ──────────
  // Poll header cho tới khi chat thực sự mở (nếu sidebar đã có chat, mở
  // trong vài trăm ms; tối đa openWaitMs) — không chờ cứng openWaitMs.
  const verifyDeadline = Date.now() + openWaitMs;
  let verify = await verifyOpenChatTeams(page, chatName);
  while (!verify.verified && Date.now() < verifyDeadline) {
    await page.waitForTimeout(400);
    verify = await verifyOpenChatTeams(page, chatName);
  }
  if (!verify.verified) {
    if (screenshots) {
      await page.screenshot({ path: path.join(shotDir, `send-verify-fail-${stamp}.png`) }).catch(() => {});
    }
    return {
      ok: false,
      error: `VERIFY FAILED: ${verify.reason}`,
      targetChat: verify.headerName || undefined,
    };
  }
  log(`Verify OK: chat="${verify.headerName || chatName}"`);

  // Đóng overlay Search (nếu vừa mở chat qua Search) — overlay che ô soạn tin.
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);
  await page.keyboard.press("Escape").catch(() => {});

  // ── 3. Find the VISIBLE compose input (không lấy contenteditable ẩn đầu DOM) ──
  const input = await findTeamsComposeInput(page, 12_000);
  if (!input) {
    if (screenshots) {
      await page.screenshot({ path: path.join(shotDir, `send-no-compose-${stamp}.png`) }).catch(() => {});
    }
    return { ok: false, error: "Không thấy ô nhập tin nhắn Teams (compose box). Không gửi gì cả." };
  }

  await input.click();
  await page.waitForTimeout(200);

  // Paste tin nhắn qua clipboard (Cmd+V) thay vì input.fill() — Teams compose box
  // là rich contenteditable; fill() đặt innerText trực tiếp KHÔNG trigger React
  // onInput/onPaste events → React state vẫn rỗng → nút Send disabled → Enter
  // không gửi được (đặc biệt lỗi ở lần gửi thứ 2 trở đi). Paste thật qua clipboard
  // mô phỏng user thật, trigger đầy đủ events.
  let typedOk = false;
  // Cách 1 (ưu tiên): clipboard paste (Cmd+V) — trigger onPaste của React/CKEditor.
  // Verified trên Chrome thật 12/08: execCommand insertText bị CKEditor Teams reset
  // (nội dung biến mất sau ~500ms, nút Send không enabled). Paste thật qua clipboard
  // giữ nội dung ổn định và bật nút Send.
  try {
    await page.evaluate(async (text: string) => {
      await navigator.clipboard.writeText(text);
    }, message);
    await input.click();
    await page.waitForTimeout(200);
    await page.keyboard.press("Meta+V");
    await page.waitForTimeout(600);
    typedOk = true;
    log(`Da paste ${message.length} ky tu vao o input (clipboard).`);
  } catch (e) {
    log(`Paste clipboard loi (${String(e).slice(0, 140)}) — fallback execCommand insertText.`);
  }
  // Cách 2: execCommand insertText — trigger input event chuẩn cho contenteditable
  if (!typedOk) {
    try {
      await input.evaluate((el: HTMLElement, text: string) => {
        el.focus();
        (document as any).execCommand("selectAll", false);
        (document as any).execCommand("insertText", false, text);
      }, message);
      await page.waitForTimeout(400);
      typedOk = true;
      log(`Da insert ${message.length} ky tu (execCommand insertText).`);
    } catch (e) {
      log(`execCommand insertText loi (${String(e).slice(0, 100)}) — fallback fill().`);
    }
  }
  // Cách 3 (fallback cuối): fill() — có thể không trigger React events
  if (!typedOk) {
    await input.fill(message);
    await page.waitForTimeout(400);
  }

  // Confirm the text actually landed in the input — đọc từ cùng locator `input`
  // (không query lại bằng document.querySelector vì có thể chọn sai contenteditable
  // — Teams CKEditor tạo nhiều [contenteditable] trên trang).
  const typedText = await input.evaluate((el: HTMLElement) => el.innerText || "").catch(() => "");
  if (!typedText.trim()) {
    return { ok: false, error: "Không thể nhập tin nhắn vào ô input. Không gửi gì cả." };
  }
  log(`Da nhap ${typedText.length} ky tu vao o input.`);

  if (screenshots) {
    await page.screenshot({ path: path.join(shotDir, `send-composed-${stamp}.png`) }).catch(() => {});
  }

  // ── 4a. COMPOSE ONLY: giữ tin nhắn soạn sẵn để user tự kiểm tra + gửi ──
  if (composeOnly) {
    log("COMPOSE ONLY: da soan san tin nhan, KHONG tu dong gui — user tu bam Gui.");
    return { ok: true, composeOnly: true, targetChat: chatName };
  }

  // ── 4. DRY RUN: clear and abort ─────────────────────────────
  if (dryRun) {
    await input.fill("");
    await page.waitForTimeout(400);
    log("DRY RUN: da xoa tin nhan, KHONG gui.");
    return { ok: true, dryRun: true, targetChat: chatName };
  }

  // ── 5. Send via Enter ───────────────────────────────────────
  // Đợi nút Send ENABLED trước khi Enter. Teams CKEditor cần vài trăm ms để
  // cập nhật state sau khi paste — nếu Enter ngay khi nút còn disabled thì
  // tin nhắn không gửi (user thấy "paste được nhưng không enter"). Poll tối
  // đa 8s, mỗi lượt 300ms.
  log("Cho nut Send enabled sau khi paste...");
  const sendEnabled = await page
    .waitForFunction(
      () => {
        const btn = document.querySelector(
          '[data-tid="newMessageCommands-send"], button[aria-label*="Send"], button[data-tid*="send"]'
        ) as HTMLElement | null;
        if (!btn) return false;
        const disabled =
          btn.hasAttribute("disabled") ||
          btn.getAttribute("aria-disabled") === "true" ||
          btn.getAttribute("tabindex") === "-1";
        return !disabled;
      },
      { timeout: 8_000 }
    )
    .then(() => true)
    .catch(() => false);

  if (!sendEnabled) {
    if (screenshots) {
      await page.screenshot({ path: path.join(shotDir, `send-btn-disabled-${stamp}.png`) }).catch(() => {});
    }
    return {
      ok: false,
      error: "Nút Send vẫn disabled sau khi paste (CKEditor chưa nhận nội dung). Không gửi.",
      targetChat: chatName,
    };
  }
  log("Nut Send da enabled — nhan Enter de gui.");

  await input.click().catch(() => {});
  await page.waitForTimeout(200);
  await input.press("Enter");

  // ── 6. Verify send succeeded ────────────────────────────────
  // Đếm số message wrapper TRƯỚC khi Enter — sau Enter, wrapper phải TĂNG lên
  // (tin nhắn mới thực sự xuất hiện). KHÔNG dùng "wrapper cuối có chứa text"
  // vì gửi lần 2 cùng nội dung → wrapper cuối vẫn là tin lần 1 → false positive.
  const wrapperCountBefore = await page.evaluate(() => {
    return document.querySelectorAll(
      '[data-testid="comfy-message-wrapper"], .fui-ChatMessage, .fui-ChatMyMessage, [data-tid="chat-pane-message"]'
    ).length;
  });

  const inputNow = await input.evaluate((el: HTMLElement) => el.innerText || "").catch(() => "");
  const inputCleared = inputNow.trim() === "";

  // Poll: chờ wrapper count tăng (tin nhắn mới render). Tối đa 6 lượt × 500ms.
  let sentCountIncreased = false;
  for (let attempt = 0; attempt < 6 && !sentCountIncreased; attempt++) {
    const countNow = await page.evaluate(() => {
      return document.querySelectorAll(
        '[data-testid="comfy-message-wrapper"], .fui-ChatMessage, .fui-ChatMyMessage, [data-tid="chat-pane-message"]'
      ).length;
    });
    if (countNow > wrapperCountBefore) {
      sentCountIncreased = true;
      break;
    }
    await page.waitForTimeout(500);
  }

  if (screenshots) {
    await page.screenshot({ path: path.join(shotDir, `send-result-${stamp}.png`) }).catch(() => {});
  }

  if (sentCountIncreased || inputCleared) {
    log("GUI THANH CONG.");
    return { ok: true, targetChat: chatName, screenshot: path.join(shotDir, `send-result-${stamp}.png`) };
  }

  return {
    ok: false,
    error: `Chua xac nhan tin nhan da gui (inputCleared=${inputCleared}, countIncreased=${sentCountIncreased}).`,
    targetChat: chatName,
  };
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
