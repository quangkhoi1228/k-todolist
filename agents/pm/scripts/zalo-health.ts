import { chromium } from "playwright";
import path from "path";
import fs from "fs";

// Health check dùng profile RIÊNG (.health-session/zalo-profile) — KHÔNG dùng
// profile chính .zalo-session/chrome-profile (sync/send đang dùng). Nếu dùng
// chung, healthcheck (launchd chạy mỗi giờ) sẽ xoá SingletonLock của Chrome
// đang chạy và bị giết ngược lại → "Target page, context or browser has been
// closed" ngẫu nhiên khi sync/send. Profile riêng được copy từ profile chính
// để vẫn kế thừa session đăng nhập.
const MAIN_PROFILE = path.join(process.cwd(), ".zalo-session", "chrome-profile");
const SESSION_DIR = path.join(process.cwd(), ".health-session", "zalo-profile");

function prepareProfile() {
  if (!fs.existsSync(MAIN_PROFILE)) return false;
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(path.dirname(SESSION_DIR), { recursive: true });
    fs.cpSync(MAIN_PROFILE, SESSION_DIR, { recursive: true, force: true });
  }
  return true;
}

async function checkHealth() {
  if (!prepareProfile()) {
    console.log(JSON.stringify({ ok: true, status: "unauthorized", message: "No session found" }));
    return;
  }

  // Clean stale Chrome lock files from previous sessions
  for (const lockFile of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
    try {
      const p = path.join(SESSION_DIR, lockFile);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch { /* ignore */ }
  }

  const ARGS = process.argv.slice(2);
  const isHeadless = !ARGS.includes("--headfull");

  const browser = await chromium.launchPersistentContext(SESSION_DIR, {
    channel: "chrome",
    headless: isHeadless,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--window-size=1280,800",
      "--lang=vi-VN",
      "--disable-features=ExternalProtocolDialog",
      "--disable-session-crashed-bubble",
      "--disable-restore-session-state",
      // macOS headless cookie decryption
      "--password-store=basic",
      "--use-mock-keychain",
    ],
    viewport: null as any,
  });

  const page = browser.pages()[0] || await browser.newPage();

  try {
    await page.goto("https://chat.zalo.me", { waitUntil: "domcontentloaded", timeout: 15000 });

    // Use same selectors as waitForZaloLogin in zalo-automator.ts
    const result = await Promise.race([
      page.waitForSelector('#conversationListId, [data-id="conversations-list"], .conv-list, .chat-list, [class*="conversation-list"]', { timeout: 15000 }).then(() => "ok"),
      page.waitForSelector('.login-qr, .qr-login, canvas[class*="qr"], img[class*="qr"], [data-translate-inner="STR_LOGIN_TITLE"]', { timeout: 15000 }).then(() => "unauthorized"),
    ]).catch(() => "timeout");

    if (result === "ok") {
      console.log(JSON.stringify({ ok: true, status: "connected" }));
    } else if (result === "unauthorized") {
      console.log(JSON.stringify({ ok: true, status: "unauthorized", message: "Login required" }));
    } else {
      console.log(JSON.stringify({ ok: true, status: "unknown", message: "Timeout waiting for state" }));
    }
  } catch (error: any) {
    console.log(JSON.stringify({ ok: false, status: "error", error: error.message }));
  } finally {
    await browser.close();
  }
}

checkHealth();
