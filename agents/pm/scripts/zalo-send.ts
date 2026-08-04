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
