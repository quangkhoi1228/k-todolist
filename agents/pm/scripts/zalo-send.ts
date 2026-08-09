/**
 * Zalo Message Sender - CLI Entry Point
 *
 * Gửi tin nhắn tới một chat Zalo (nhóm hoặc 1:1) với cơ chế verify an toàn:
 * - CHỈ gửi khi xác minh được chat đang mở đúng tên mục tiêu
 * - Dry run: nhập tin rồi xoá, KHÔNG gửi
 * - Mặc định yêu cầu xác nhận trước khi gửi thật
 *
 * Usage:
 *   # Dry run (soạn tin, không gửi):
 *   npx tsx agents/pm/scripts/zalo-send.ts --chat "Thảo Nguyên BB" --message "Xin chào" --dry-run
 *
 *   # Gửi thật (cần --yes):
 *   npx tsx agents/pm/scripts/zalo-send.ts --chat "Thảo Nguyên BB" --message "Xin chào" --yes
 *
 *   # Gửi thật không cần xác nhận (cần --yes --force):
 *   npx tsx agents/pm/scripts/zalo-send.ts --chat "..." --message "..." --yes --force
 */

import {
  createZaloStealthContext,
  waitForZaloLogin,
  navigateToZalo,
  applyStealthPatches,
  sendZaloMessage,
  DEFAULT_ZALO_CONFIG,
  log,
  type ZaloAutomatorConfig,
} from "../lib/zalo-automator";
import * as fs from "fs";
import * as path from "path";

/**
 * Lock chung: sync (queue/sync-all/sync-one) và zalo-send dùng CHUNG Chrome
 * profile `.zalo-session/chrome-profile` — 2 Chrome cùng user-data-dir không
 * chạy song song được. zalo-send phải:
 * - Chờ sync đang chạy xong (từng vòng 10s, tối đa 3 phút — KHÔNG 20 phút)
 * - Ghi `.zalo-send-running` để sync biết mà chờ/skip
 */
const SYNC_RUNNING_FILE = path.join(process.cwd(), ".teams-sync-running");
const SEND_RUNNING_FILE = path.join(process.cwd(), ".zalo-send-running");

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** Đang có sync nào chạy (đọc lock nhiều PID) — chờ tối đa `timeoutMs`. */
async function waitForSyncToFinish(timeoutMs = 3 * 60 * 1000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let syncRunning = false;
    try {
      if (fs.existsSync(SYNC_RUNNING_FILE)) {
        const content = fs.readFileSync(SYNC_RUNNING_FILE, "utf-8");
        const pids = content.split("\n").map(l => l.trim()).filter(Boolean).map(l => parseInt(l, 10)).filter(p => !isNaN(p));
        syncRunning = pids.some(pid => pid !== process.pid && pidAlive(pid));
      }
    } catch { /* stale lock */ }
    if (!syncRunning) return true;
    log("Dang co sync chay — cho sync xong (poll 3s)...");
    await new Promise((r) => setTimeout(r, 3_000));
  }
  log("Timeout cho sync (3 phut) — van tiep tuc gui (co the dung chung profile!).");
  return true;
}

function claimSendLock(): void {
  try { fs.writeFileSync(SEND_RUNNING_FILE, `${process.pid}`, "utf-8"); } catch { /* */ }
}

function releaseSendLock(): void {
  try { if (fs.existsSync(SEND_RUNNING_FILE)) fs.unlinkSync(SEND_RUNNING_FILE); } catch { /* */ }
}

function parseArgs(): {
  chatName: string;
  message: string;
  dryRun: boolean;
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
    chatName: getArg("--chat") || process.env.ZALO_TARGET_CHAT || "",
    message: getArg("--message") || process.env.ZALO_MESSAGE || "",
    dryRun: args.includes("--dry-run"),
    confirm: !args.includes("--yes"),
    force: args.includes("--force"),
    headless: args.includes("--headless"),
    keepOpen: args.includes("--keep-open"),
  };
}

async function main() {
  const { chatName, message, dryRun, confirm, force, headless, keepOpen } = parseArgs();

  if (!chatName) {
    console.error("Error: --chat <name> is required (ten chat Zalo can gui den).");
    process.exit(1);
  }
  if (!message) {
    console.error("Error: --message <text> is required (noi dung tin nhan).");
    process.exit(1);
  }

  if (force && !confirm) {
    // --force only meaningful with --yes; if --force but not --yes, still confirm
  }

  console.log("========== ZALO SEND ==========");
  console.log(`  Chat target : ${chatName}`);
  console.log(`  Message     : ${message.slice(0, 120)}${message.length > 120 ? "..." : ""}`);
  console.log(`  Mode        : ${dryRun ? "DRY RUN (khong gui)" : "LIVE"}`);

  // Confirm before real send
  if (!dryRun && confirm) {
    console.log("\n⚠️  CHU Y: Ban sap gui tin nhan THAT toi chat Zalo:");
    console.log(`    "${chatName}"`);
    console.log(`    Noi dung: "${message.slice(0, 80)}..."`);
    console.log("\n  De tiep tuc, chay lai voi --yes (hoac --yes --force de bo qua xac nhan).");
    process.exit(2);
  }

  const config: ZaloAutomatorConfig = {
    ...DEFAULT_ZALO_CONFIG,
    headless,
    keepOpen,
  };

  // Không mở Chrome khi sync đang giữ profile chính — chờ ngắn (3 phút tối đa)
  // Claim send lock NGAY (trước khi đợi sync): sync đang chạy phát hiện
  // `.zalo-send-running` sẽ thoát sớm → send không phải chờ lâu.
  claimSendLock();
  await waitForSyncToFinish();

  const { browser, context } = await createZaloStealthContext(config);
  const page = context.pages()[0] || (await context.newPage());
  await applyStealthPatches(page);

  try {
    await navigateToZalo(page, config);
    const neededLogin = await waitForZaloLogin(page, config);
    if (neededLogin) {
      try {
        await context.storageState({ path: config.sessionDir + "/state.json" });
      } catch { /* persistent context */ }
    }

    const result = await sendZaloMessage(page, {
      chatName,
      message,
      dryRun,
      screenshots: true,
    });

    console.log("\n--- Ket qua ---");
    console.log(JSON.stringify(result, null, 2));

    if (!result.ok) {
      process.exit(1);
    }
    if (result.dryRun) {
      log("DRY RUN hoan tat: khong co tin nhan nao duoc gui.");
    } else {
      log("Tin nhan da gui thanh cong.");
    }
  } finally {
    releaseSendLock();
    try {
      await context.storageState({ path: config.sessionDir + "/state.json" });
    } catch { /* */ }

    if (!config.headless && config.keepOpen) {
      log("Giu browser mo.");
      await new Promise(() => {});
    }
    await browser.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error("[ZaloSend] Fatal:", err);
  process.exit(1);
});
