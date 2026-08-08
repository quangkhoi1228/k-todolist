/* Chạy: npx tsx scripts/verify-zalo-single-ui.ts
 * Verify UI chat Zalo "Thảo Nguyên BB" hiển thị sender đúng (không bị "Me").
 * Yêu cầu: Chrome CDP port 9222 + profile copy đã login Clerk.
 */
import { chromium } from "playwright";

async function main() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const ctx = browser.contexts()[0];
  const page =
    ctx.pages().find((p) => p.url().includes("localhost:3000") && !p.url().includes("/sign-in")) ||
    ctx.pages()[0];
  await page.goto("http://localhost:3000/projects/45", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  await page.getByRole("button", { name: /^Chats/i }).click().catch(() => {});
  await page.waitForTimeout(2500);

  // Select the Zalo single chat
  const sel = page.locator('[data-testid*="chat"], [class*="chat-item"], [class*="conversation"]').filter({ hasText: "Thảo Nguyên BB" }).first();
  await sel.click().catch(async () => {
    // Fallback: click by text anywhere
    await page.getByText("Thảo Nguyên BB", { exact: false }).first().click();
  });
  await page.waitForTimeout(3000);

  // Read visible messages in the chat panel
  const messages = await page.evaluate(() => {
    const panel = document.querySelector('[class*="message"], [class*="chat-panel"], [class*="conversation-detail"]');
    const body = panel ? panel.textContent : document.body.textContent;
    return body ? body.slice(0, 1500) : "";
  });
  console.log("=== UI CHAT PANEL TEXT ===");
  console.log(messages);
  await page.screenshot({ path: "teams-screenshots/zalo-single-ui.png" });
  console.log("Screenshot saved.");
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
