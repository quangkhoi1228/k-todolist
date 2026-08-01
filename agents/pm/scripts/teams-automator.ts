/**
 * Teams Automator - CLI Entry Point
 *
 * Usage:
 *   # Lần đầu (cần login manual): npx tsx agents/pm/scripts/teams-automator.ts
 *   # Có session rồi (headless):   npx tsx agents/pm/scripts/teams-automator.ts --headless
 *   # Với deep link:              TEAMS_DEEPLINK="https://..." npx tsx agents/pm/scripts/teams-automator.ts
 *   # Headless + deep link:       TEAMS_DEEPLINK="https://..." npx tsx agents/pm/scripts/teams-automator.ts --headless
 *
 * Output: teams-messages.json (PM Agent tự động đọc file này)
 */

import { runAutomation, DEFAULT_CONFIG, log } from "../lib/teams-automator";

async function main() {
  const isHeadless = process.argv.includes("--headless");
  const keepOpen = process.argv.includes("--keep-open");
  const useRealChrome = process.argv.includes("--use-real-chrome");
  const deepLink = process.env.TEAMS_DEEPLINK || "";

  const config = {
    ...DEFAULT_CONFIG,
    headless: isHeadless,
    keepOpen,
    useRealChrome: useRealChrome || true, // Always use real Chrome for Teams v2
    deepLink: deepLink || undefined,
    chatName: process.env.TEAMS_CHAT_NAME || undefined,
    keywords: (process.env.TEAMS_KEYWORDS || "").split(",").filter(Boolean),
  };

  log(`Bat dau automation (headless=${isHeadless}, realChrome=${useRealChrome})...`);
  if (deepLink) log(`Deep link: ${deepLink.slice(0, 80)}...`);

  const result = await runAutomation(config);

  // Preview
  console.log(`\n--- Ket qua ---`);
  console.log(`Channel: ${result.channelName}${result.teamName ? ` (${result.teamName})` : ""}`);
  console.log(`Tong tin nhan: ${result.totalMessages}`);
  console.log(`\n--- Preview (5 tin nhan moi nhat) ---`);
  for (const msg of result.messages.slice(-5)) {
    console.log(`  [${msg.timestamp}] ${msg.sender}: ${msg.content.slice(0, 120)}`);
  }
  console.log(`\nPM Agent se tu dong doc file teams-messages.json.`);
}

main().catch((err) => {
  console.error("[TeamsAutomator] Fatal:", err);
  process.exit(1);
});
