/* Chạy: npx tsx scripts/check-zalo-dom.ts — verify sender/isMine fix trên chat đơn */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { createZaloStealthContext, navigateToZalo, waitForZaloLogin, navigateToZaloGroup, scrollZaloChatContainer, extractZaloMessages, DEFAULT_ZALO_CONFIG } from "../agents/pm/lib/zalo-automator";
import fs from "fs";

async function main() {
  const config = { ...DEFAULT_ZALO_CONFIG, headless: false, useRealChrome: true, scrollCount: 2 };
  const { browser, context } = await createZaloStealthContext(config);
  const page = context.pages()[0] || await context.newPage();
  await navigateToZalo(page, config);
  const needed = await waitForZaloLogin(page, config);
  console.log("login needed:", needed);
  const ok = await navigateToZaloGroup(page, "Thảo Nguyên BB");
  console.log("navigated:", ok);
  const chatConfig = { ...config, groupName: "Thảo Nguyên BB" };
  await scrollZaloChatContainer(page, chatConfig);
  const result = await extractZaloMessages(page, chatConfig);
  console.log("TOTAL:", result.totalMessages);
  const msgs = result.messages.slice(0, 10);
  for (const m of msgs) {
    console.log("sender:", (m.sender||"").padEnd(20), "| mine:", m.isMine, "|", (m.content||"").slice(0,45).replace(/\n/g," "));
  }
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
