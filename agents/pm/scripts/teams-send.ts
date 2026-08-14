/**
 * Teams Message Sender - CLI Entry Point
 *
 * Gửi tin nhắn tới một chat Teams (nhóm hoặc 1:1) với cơ chế verify an toàn:
 * - CHỈ gửi khi xác minh được chat đang mở đúng tên mục tiêu
 * - Dry run: nhập tin rồi xoá, KHÔNG gửi
 * - Compose-only: mở chat + soạn sẵn tin nhắn, giữ nguyên để user tự gửi
 *   (dùng cho luồng "mở deep link" từ UI — không tự động gửi)
 * - Mặc định yêu cầu xác nhận trước khi gửi thật
 *
 * Usage:
 *   # Dry run (soạn tin, không gửi):
 *   npx tsx agents/pm/scripts/teams-send.ts --chat "Mai Thuận An" --message "Xin chào" --dry-run
 *
 *   # Compose-only (mở chat + soạn sẵn, giữ browser mở để user tự gửi):
 *   npx tsx agents/pm/scripts/teams-send.ts --chat "Nhóm Dự án X" --message "Xin chào" --compose --keep-open
 *
 *   # Gửi thật (cần --yes):
 *   npx tsx agents/pm/scripts/teams-send.ts --chat "Mai Thuận An" --message "Xin chào" --yes
 */

import {
  createStealthContext,
  waitForLogin,
  navigateToTeams,
  applyStealthPatches,
  sendTeamsMessage,
  openTeamsTabInBackground,
  focusCdpWindow,
  fitWindowToScreen,
  killPlaywrightChromeOnProfile,
  DEFAULT_CONFIG,
  log,
  type AutomatorConfig,
} from "../lib/teams-automator";
import * as fs from "fs";
import * as path from "path";

/**
 * Auto-sync (sync-all-projects spawned by next-server) and teams-send share
 * the SAME Chrome profile (.teams-session/chrome-profile) — they must never
 * run at the same time, otherwise each side's browser kills the other's
 * ("Target page, context or browser has been closed"). Wait for the sync to
 * finish before launching our own browser.
 */
const SYNC_RUNNING_FILE = path.join(process.cwd(), ".teams-sync-running");
const SEND_RUNNING_FILE = path.join(process.cwd(), ".teams-send-running");

async function waitForSyncToFinish(timeoutMs = 3 * 60 * 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let syncRunning = false;
    try {
      if (fs.existsSync(SYNC_RUNNING_FILE)) {
        // Lock file có thể chứa NHIỀU PID (queue chạy song song, mỗi script
        // con 1 dòng) — dòng nào còn sống là đang có sync chạy.
        const content = fs.readFileSync(SYNC_RUNNING_FILE, "utf-8");
        const pids = content.split("\n").map(l => l.trim()).filter(Boolean).map(l => parseInt(l, 10)).filter(p => !isNaN(p));
        syncRunning = pids.some(pid => {
          try {
            process.kill(pid, 0); // throws if not running
            return true;
          } catch {
            return false;
          }
        });
      }
    } catch {
      // stale lock file — ignore
    }
    if (!syncRunning) {
      log("Khong co sync nao dang chay — bat dau gui tin.");
      return;
    }
    log(`Dang co sync chay — cho sync xong (poll 3s, con ${Math.max(0, Math.round((deadline - Date.now()) / 1000))}s)...`);
    await new Promise((r) => setTimeout(r, 3_000));
  }
  log("Timeout cho sync — van tiep tuc gui (co the dung chung profile!).");
}

/** Claim the send lock so auto-sync skips while we send. */
function claimSendLock(): void {
  try {
    fs.writeFileSync(SEND_RUNNING_FILE, `${process.pid}`, "utf-8");
  } catch {
    /* */
  }
}

function releaseSendLock(): void {
  try {
    if (fs.existsSync(SEND_RUNNING_FILE)) fs.unlinkSync(SEND_RUNNING_FILE);
  } catch {
    /* */
  }
}

function parseArgs(): {
  chatName: string;
  message: string;
  dryRun: boolean;
  compose: boolean;
  confirm: boolean;
  force: boolean;
  headless: boolean;
  keepOpen: boolean;
} {
  const args = process.argv.slice(2);
  const getArg = (name: string): string | undefined => {
    const idx = args.indexOf(name);
    if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
    return undefined;
  };

  return {
    chatName: getArg("--chat") || process.env.TEAMS_TARGET_CHAT || "",
    message: getArg("--message") || process.env.TEAMS_MESSAGE || "",
    dryRun: args.includes("--dry-run"),
    compose: args.includes("--compose"),
    confirm: !args.includes("--yes"),
    force: args.includes("--force"),
    headless: args.includes("--headless"),
    keepOpen: args.includes("--keep-open"),
  };
}

async function main() {
  const { chatName, message, dryRun, compose, confirm, headless, keepOpen } = parseArgs();

  if (!chatName) {
    console.error("Error: --chat <name> is required (ten chat Teams can gui den).");
    process.exit(1);
  }
  if (!message) {
    console.error("Error: --message <text> is required (noi dung tin nhan).");
    process.exit(1);
  }

  console.log("========== TEAMS SEND ==========");
  console.log(`  Chat target : ${chatName}`);
  console.log(`  Message     : ${message.slice(0, 120)}${message.length > 120 ? "..." : ""}`);
  console.log(`  Mode        : ${compose ? "COMPOSE ONLY (soan san, khong gui)" : dryRun ? "DRY RUN (khong gui)" : "LIVE"}`);

  // Confirm before real send
  if (!dryRun && !compose && confirm) {
    console.log("\n⚠️  CHU Y: Ban sap gui tin nhan THAT toi chat Teams:");
    console.log(`    "${chatName}"`);
    console.log(`    Noi dung: "${message.slice(0, 80)}..."`);
    console.log("\n  De tiep tuc, chay lai voi --yes (hoac --yes --force de bo qua xac nhan).");
    process.exit(2);
  }

  const config: AutomatorConfig = {
    ...DEFAULT_CONFIG,
    headless,
    keepOpen,
    useRealChrome: true,
  };

  // Never launch Chrome while a background sync holds the shared profile.
  // Claim send lock NGAY (trước khi đợi sync) — sync đang scroll/extract sẽ
  // thấy `.teams-send-running` và dừng sớm (send-preemption), send không phải
  // chờ hết task sync.
  claimSendLock();

  // Track kết quả tổng — dùng trong finally (CDP force-exit cần biết exit code)
  let exitedOk = false;
  let browser: Awaited<ReturnType<typeof createStealthContext>>["browser"] | undefined;
  let context: Awaited<ReturnType<typeof createStealthContext>>["context"] | undefined;

  try {
    // Sync đã thấy lock và preempt — không chờ 3 phút. 20s là đủ để sync thoát.
    await waitForSyncToFinish(20_000);
    // Chrome sync thường sống sót SIGTERM → kill Playwright leftover trước khi launch.
    await killPlaywrightChromeOnProfile(path.join(config.sessionDir, "chrome-profile"));

    const launched = await createStealthContext(config);
    browser = launched.browser;
    context = launched.context;
    // Chọn tab Teams NẾU CÓ (sync-project-chats cách làm): tab đang mở sẵn
    // trong Chrome CDP thường có sidebar chat đã load. Fallback: tab đầu tiên.
    let page = context.pages()[0];
    if (process.env.USE_CDP === "1" || process.env.USE_CDP === "true") {
      const teamsPg = context.pages().find((p) => p.url().includes("teams.microsoft.com"));
      page = teamsPg || (await openTeamsTabInBackground(browser, context, {
        background: config.headless,
        minimize: config.headless,
      }));
      // Gửi headfull (headless=false) → đưa cửa sổ Chrome lên trước + focus tab Teams
      // để user nhìn thấy quá trình gửi (CDP mode mặc định giữ window ẩn/nền).
      if (!config.headless && page) {
        await focusCdpWindow(browser, page).catch(() => {});
      }
    }
    await applyStealthPatches(page);
    if (!config.headless) {
      await fitWindowToScreen(page).catch(() => {});
      await page.bringToFront().catch(() => {});
    }

    await navigateToTeams(page, config);
    const neededLogin = await waitForLogin(page, config);
    if (neededLogin) {
      await context.storageState({ path: config.sessionDir + "/state.json" });
    }

    const result = await sendTeamsMessage(page, {
      chatName,
      message,
      dryRun,
      composeOnly: compose,
      screenshots: true,
    });

    console.log("\n--- Ket qua ---");
    // JSON 1 dòng để route API parse được bằng regex /\{"ok":.*\}/
    console.log(JSON.stringify(result));

    if (!result.ok) {
      exitedOk = false;
      // Để JSON {"ok":false,...} được print trước khi exit — dùng finally
      // force-exit với exit code đúng.
      throw new Error("send failed");
    }
    exitedOk = true;
    if (result.composeOnly) {
      log("COMPOSE ONLY hoan tat: tin nhan da soan san, user tu kiem tra va gui.");
    } else if (result.dryRun) {
      log("DRY RUN hoan tat: khong co tin nhan nao duoc gui.");
    } else {
      log("Tin nhan da gui thanh cong.");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg !== "send failed") {
      console.error("[TeamsSend] Fatal:", err);
      console.log(JSON.stringify({ ok: false, error: msg }));
    }
  } finally {
    releaseSendLock();
    // CDP mode: Chrome thật đã giữ session tự nhiên — KHÔNG gọi storageState
    // (gọi qua CDP có thể kẹt khi Chrome đang bận với tab vừa mở). Chỉ lưu
    // session khi dùng persistent profile (mở Chrome riêng).
    if (context && process.env.SYNC_CDP_CONNECTED !== "1") {
      try {
        await context.storageState({ path: config.sessionDir + "/state.json" });
      } catch { /* */ }
    }

    if (!config.headless && config.keepOpen) {
      log("Giu browser mo.");
      await new Promise(() => {});
    }
    // browser.close() can hang forever when the Chrome child refuses to die
    // (kill EPERM on macOS), leaving the profile locked and blocking every
    // later send. Cap the wait, then force-exit so the script never leaks.
    const closeTimeout = setTimeout(() => {
      console.error("[TeamsSend] browser.close() timed out — forcing exit.");
      process.exit(exitedOk ? 0 : 1);
    }, 8_000);
    if (browser) {
      await browser.close().catch(() => {});
    }
    clearTimeout(closeTimeout);
    // Luôn force-exit ở cuối. Cả 2 đường đều có thể để sót handle trên event loop
    // (CDP websocket, persistent Chrome watcher, Playwright internal) → Node
    // không tự exit → API route chờ `child.on("exit")` vô hạn ("gửi xong không
    // trả kết quả"). Force-exit đảm bảo script luôn kết thúc đúng.
    log(exitedOk ? "Hoan tat — exit." : "Co loi — exit.");
    process.exit(exitedOk ? 0 : 1);
  }
}

main().catch((err) => {
  console.error("[TeamsSend] Fatal:", err);
  process.exit(1);
});
