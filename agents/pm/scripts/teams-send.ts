/**
 * Teams Message Sender - CLI Entry Point
 *
 * Gửi tin nhắn tới một chat Teams (nhóm hoặc 1:1) với cơ chế verify an toàn:
 * - CHỈ gửi khi xác minh được chat đang mở đúng tên mục tiêu
 * - Dry run: nhập tin rồi xoá, KHÔNG gửi
 * - Mặc định yêu cầu xác nhận trước khi gửi thật
 *
 * Usage:
 *   # Dry run (soạn tin, không gửi):
 *   npx tsx agents/pm/scripts/teams-send.ts --chat "Mai Thuận An" --message "Xin chào" --dry-run
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
  DEFAULT_CONFIG,
  log,
  type AutomatorConfig,
} from "../lib/teams-automator";

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
    chatName: getArg("--chat") || process.env.TEAMS_TARGET_CHAT || "",
    message: getArg("--message") || process.env.TEAMS_MESSAGE || "",
    dryRun: args.includes("--dry-run"),
    confirm: !args.includes("--yes"),
    force: args.includes("--force"),
    headless: args.includes("--headless"),
    keepOpen: args.includes("--keep-open"),
  };
}

async function main() {
  const { chatName, message, dryRun, confirm, headless, keepOpen } = parseArgs();

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
  console.log(`  Mode        : ${dryRun ? "DRY RUN (khong gui)" : "LIVE"}`);

  // Confirm before real send
  if (!dryRun && confirm) {
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

  const { browser, context } = await createStealthContext(config);
  const page = context.pages()[0] || (await context.newPage());
  await applyStealthPatches(page);

  try {
    await navigateToTeams(page, config);
    const neededLogin = await waitForLogin(page, config);
    if (neededLogin) {
      await context.storageState({ path: config.sessionDir + "/state.json" });
    }

    const result = await sendTeamsMessage(page, {
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
  console.error("[TeamsSend] Fatal:", err);
  process.exit(1);
});
