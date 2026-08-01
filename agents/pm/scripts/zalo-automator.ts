/**
 * Zalo Automator - CLI Entry Point
 *
 * Usage:
 *   # Lần đầu (cần QR login): npx tsx agents/pm/scripts/zalo-automator.ts
 *   # Có session rồi (headless): npx tsx agents/pm/scripts/zalo-automator.ts --headless
 *   # Với tên nhóm:              ZALO_GROUP_NAME="Nhóm ABC" npx tsx agents/pm/scripts/zalo-automator.ts
 *   # Headless + nhóm:           ZALO_GROUP_NAME="Nhóm ABC" npx tsx agents/pm/scripts/zalo-automator.ts --headless
 *
 * Output: zalo-messages.json (PM Agent tự động đọc file này)
 */

import { runZaloAutomation, DEFAULT_ZALO_CONFIG, log } from "../lib/zalo-automator";

async function main() {
  const isHeadless = process.argv.includes("--headless");
  const keepOpen = process.argv.includes("--keep-open");
  const useRealChrome = process.argv.includes("--use-real-chrome");

  const config = {
    ...DEFAULT_ZALO_CONFIG,
    headless: isHeadless,
    keepOpen,
    useRealChrome: useRealChrome || true, // Always use real Chrome for session persistence
    groupName: process.env.ZALO_GROUP_NAME || undefined,
    keywords: (process.env.ZALO_KEYWORDS || "").split(",").filter(Boolean),
  };

  log(`Bat dau Zalo automation (headless=${isHeadless}, realChrome=${useRealChrome})...`);
  if (config.groupName) log(`Group name: ${config.groupName}`);

  const result = await runZaloAutomation(config);

  // Preview
  console.log(`\n--- Ket qua ---`);
  console.log(`Group: ${result.groupName}`);
  console.log(`Tong tin nhan: ${result.totalMessages}`);
  console.log(`\n--- Preview (5 tin nhan moi nhat) ---`);
  for (const msg of result.messages.slice(-5)) {
    console.log(`  [${msg.timestamp}] ${msg.sender}: ${msg.content.slice(0, 120)}`);
  }
  console.log(`\nPM Agent se tu dong doc file zalo-messages.json.`);
}

main().catch((err) => {
  console.error("[ZaloAutomator] Fatal:", err);
  process.exit(1);
});
