/**
 * Debug: run the REAL production extractor (incrementalScrollAndExtract) on the
 * Teams chat and print messages with quotes to verify quote parsing works.
 * Chay: SCROLL_COUNT=5 npx tsx scripts/verify-teams-quote-extract.ts
 */
import {
  createStealthContext,
  applyStealthPatches,
  incrementalScrollAndExtract,
} from "../agents/pm/lib/teams-automator";

const CHAT_NAME = process.env.CHAT_NAME || "[Internal] FRT FinOPS";

async function main() {
  const baseConfig = {
    sessionDir: ".teams-session",
    screenshotDir: "teams-screenshots",
    headless: false,
    useRealChrome: true,
    scrollCount: Number(process.env.SCROLL_COUNT || 5),
    scrollWaitMs: 1200,
    outputFile: "/tmp/teams-verify-messages.json",
    groupName: "",
    chatUrl: "",
  } as any;

  const { browser, context } = await createStealthContext(baseConfig);

  const page = context.pages()[0] || (await context.newPage());
  await applyStealthPatches(page);
  await page.goto("https://teams.microsoft.com/v2/", { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(15_000);

  const found = await page.evaluate((name: string) => {
    const items = document.querySelectorAll('[data-testid="list-item"]');
    for (const item of items) {
      const t = (item.textContent || "").replace(/\s+/g, " ").trim();
      if (t.includes(name)) {
        (item as HTMLElement).click();
        return true;
      }
    }
    return false;
  }, CHAT_NAME);
  console.log("Found:", found);
  await page.waitForTimeout(8_000);

  const result = await incrementalScrollAndExtract(page, { ...baseConfig, chatName: CHAT_NAME } as any);
  console.log("TOTAL:", result.totalMessages);

  // Print all messages with quote lines
  let quoteCount = 0;
  for (const m of result.messages) {
    if (m.content.startsWith(">")) {
      quoteCount++;
      console.log(`QUOTE [${m.sender}] (${m.timestampMs}):\n  ${m.content}\n  imgs=${m.images?.length || 0}`);
    }
  }
  console.log("QUOTE COUNT:", quoteCount);

  // Print first 5 messages overall
  for (const m of result.messages.slice(0, 5)) {
    console.log(`MSG [${m.sender}] (${m.timestampMs}): ${m.content.slice(0, 120)} imgs=${m.images?.length || 0}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("ERR:", e);
  process.exit(1);
});