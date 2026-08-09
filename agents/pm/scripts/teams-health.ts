import { chromium } from "playwright";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import { createStealthContext, navigateToTeams, DEFAULT_CONFIG } from "../lib/teams-automator";

// Health check dùng CHUNG profile chính (.teams-session/chrome-profile) — cùng
// profile mà user đăng nhập Teams qua UI "Đăng nhập". TRƯỚC ĐÂY dùng bản copy
// riêng (.health-session/teams-profile): session lệch → healthcheck fail.
//
// Cơ chế (giống createStealthContext trong sync):
//   1. Nếu Chrome CDP đang chạy (port 9222) — connect vào đó, healthcheck
//      chạy ngay trên tab của Chrome ĐÃ ĐĂNG NHẬP.
//   2. Không có CDP — mở persistent context với profile chính (có cleanup
//      stale lock an toàn; chỉ xoá lock của process đã chết, không kill
//      Chrome thật đang chạy).
const MAIN_PROFILE = path.join(process.cwd(), ".teams-session", "chrome-profile");

/** Kiểm tra profile có bị Chrome khác (live) đang giữ không. */
function isProfileInUse(profileDir: string): boolean {
  try {
    const out = execSync("pgrep -fl 'Google Chrome'", { encoding: "utf8" });
    for (const line of out.split("\n")) {
      if (!line.includes(profileDir)) continue;
      const m = line.match(/^(\d+)\s/);
      if (!m) continue;
      const pid = Number(m[1]);
      try {
        process.kill(pid, 0); // throws if not running
        return true;
      } catch {
        // process already gone — skip
      }
    }
  } catch {
    // pgrep failed / no chrome — treat as not in use
  }
  return false;
}

/**
 * Đọc session trực tiếp từ Cookies SQLite của profile (không cần mở Chrome).
 * Hữu ích khi profile bị Chrome khác giữ (login --keep-open, sync) — healthcheck
 * vẫn kết luận được connected/unauthorized. Verified: SQLite cho đọc khi Chrome
 * đang chạy trên profile đó.
 *
 * Teams: cookie `authtoken` trên host `teams.microsoft.com` = đã đăng nhập.
 */
function sessionFromTeamsCookies(profileDir: string): "connected" | "unauthorized" | null {
  const cookiesDb = path.join(profileDir, "Default", "Cookies");
  if (!fs.existsSync(cookiesDb)) return null;
  try {
    const esc = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
    const out = execSync(
      `sqlite3 ${esc(cookiesDb)} "SELECT host_key FROM cookies WHERE name='authtoken' AND host_key LIKE '%teams.microsoft.com' LIMIT 1;"`,
      { encoding: "utf8" }
    );
    return out.trim() ? "connected" : "unauthorized";
  } catch {
    return null; // không mở được db — để caller quyết định
  }
}

async function checkHealth() {
  if (!fs.existsSync(MAIN_PROFILE)) {
    console.log(JSON.stringify({ ok: true, status: "unauthorized", message: "No session found" }));
    return;
  }

  const ARGS = process.argv.slice(2);
  const isHeadless = !ARGS.includes("--headfull");

  // Nếu profile đang bị Chrome khác giữ (sync/send đang chạy, hoặc Chrome
  // thật đang mở) — KHÔNG cố launch persistent context (sẽ lỗi
  // "Failed to create a ProcessSingleton" — 2 Chrome cùng user-data-dir).
  // Chờ tối đa 15s cho sync đang chạy xong task rồi mới báo busy (queue 2
  // phút chạy liên tục nên chờ lâu hơn vô nghĩa).
  if (!process.env.SYNC_CDP_CONNECTED && !process.env.USE_CDP && isProfileInUse(MAIN_PROFILE)) {
    const deadline = Date.now() + 15_000;
    let stillBusy = true;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2_000));
      if (!isProfileInUse(MAIN_PROFILE)) { stillBusy = false; break; }
    }
    if (stillBusy) {
      // Profile bị giữ bởi browser --keep-open (đăng nhập) hoặc sync — đọc
      // session từ cookies thay vì báo busy mù. Vì browser vẫn đang mở, dữ
      // liệu hiển thị trên UI là CHÍNH XÁC nhất.
      const cookieState = sessionFromTeamsCookies(MAIN_PROFILE);
      if (cookieState === "connected") {
        console.log(JSON.stringify({ ok: true, status: "connected", message: "Session hợp lệ (cookies đã đăng nhập), browser đang mở." }));
        return;
      }
      if (cookieState === "unauthorized") {
        console.log(JSON.stringify({ ok: true, status: "unauthorized", message: "Chưa đăng nhập (không có session cookie)." }));
        return;
      }
      console.log(JSON.stringify({ ok: true, status: "busy", message: "Teams profile đang được Chrome khác dùng (sync/send/đang mở). Thử lại sau vài giây." }));
      return;
    }
  }

  // Dùng đúng helper chuẩn: CDP → profile chính, fallback persistent
  const { browser, context } = await createStealthContext({
    ...DEFAULT_CONFIG,
    headless: isHeadless,
    useRealChrome: true,
  });

  const page = context.pages()[0] || await context.newPage();

  try {
    await navigateToTeams(page, { ...DEFAULT_CONFIG, headless: isHeadless });

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
    // Profile bị Chrome khác giữ (sync/send đang chạy cùng lúc) — có 2 dạng
    // lỗi: "Failed to create a ProcessSingleton" (Chrome từ chối) hoặc lỗi mới
    // "profile đang bị Chrome khác dùng" (tự detect trong createStealthContext).
    // Trong cả 2 trường hợp: thử đọc cookies; nếu có session thì vẫn connected.
    const msg = String(error?.message || error);
    if (msg.includes("ProcessSingleton") || msg.includes("đang bị Chrome khác dùng")) {
      const cookieState = sessionFromTeamsCookies(MAIN_PROFILE);
      if (cookieState === "connected") {
        console.log(JSON.stringify({ ok: true, status: "connected", message: "Session hợp lệ (cookies đã đăng nhập), browser đang mở." }));
      } else if (cookieState === "unauthorized") {
        console.log(JSON.stringify({ ok: true, status: "unauthorized", message: "Chưa đăng nhập (không có session cookie)." }));
      } else {
        console.log(JSON.stringify({ ok: false, status: "busy", error: "Teams profile đang bị Chrome khác dùng (sync/send/đang mở). Thử lại sau khi sync xong." }));
      }
    } else {
      console.log(JSON.stringify({ ok: false, status: "error", error: msg }));
    }
  } finally {
    // CDP: chỉ đóng tab mới, không đóng Chrome thật. Persistent: đóng browser.
    if (process.env.SYNC_CDP_CONNECTED === "1") {
      await page.close().catch(() => {});
    } else {
      await browser.close().catch(() => {});
    }
  }
}

checkHealth();