import { chromium } from "playwright";
import path from "path";
import fs from "fs";

const SESSION_DIR = path.join(process.cwd(), ".teams-session", "chrome-profile");

async function checkHealth() {
  if (!fs.existsSync(SESSION_DIR)) {
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
      "--lang=en-US",
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
    await page.goto("https://teams.microsoft.com/v2/", { waitUntil: "domcontentloaded", timeout: 15000 });

    // Use same selectors as waitForLogin in teams-automator.ts
    const result = await Promise.race([
      page.waitForSelector('[data-tid="app-bar-wrapper"], [data-tid="chat-title"], [data-tid="app-bar"], [data-tid="chat-header-title"]', { timeout: 15000 }).then(() => "ok"),
      page.waitForSelector('input[name="loginfmt"], #i0116, .login-paginated-page, input[type="email"]', { timeout: 15000 }).then(() => "unauthorized"),
      // Also check if url redirects to login
      page.waitForURL(/login\.microsoftonline\.com/, { timeout: 15000 }).then(() => "unauthorized"),
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
