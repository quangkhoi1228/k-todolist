/* Chạy: npx tsx scripts/verify-teams-send-ui.ts
 * Verify UI gửi tin nhắn Teams (project 45, chat "An Mai Thuan").
 * Yêu cầu: Chrome CDP port 9222 + profile copy đã login Clerk.
 */
import { chromium } from "playwright";

async function main() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const ctx = browser.contexts()[0];
  const page =
    ctx.pages().find((p) => p.url().includes("localhost:3000") && !p.url().includes("/sign-in")) ||
    ctx.pages()[0];

  const result: Record<string, unknown> = {};
  result.url = page.url();

  if (!page.url().includes("/projects")) {
    await page.goto("http://localhost:3000/projects", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    result.urlAfterNav = page.url();
  }

  // Open project 45
  await page.goto("http://localhost:3000/projects/45", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  result.projectUrl = page.url();

  // Chats tab
  await page.getByRole("button", { name: /^Chats/i }).click().catch(() => {});
  await page.waitForTimeout(2500);

  const chatNames = await page.locator("text=An Mai Thuan").count();
  result.anGroupCount = chatNames;

  // Select chat row "An Mai Thuan"
  const row = page.locator("div", { hasText: "An Mai Thuan" }).filter({ has: page.locator("text=/Teams/i") }).first();
  await row.click({ timeout: 5000 }).catch((e) => { result.rowClickError = String(e).slice(0, 120); });
  await page.waitForTimeout(2000);

  // Composer
  const textareas = await page.locator("textarea").count();
  result.textareas = textareas;
  result.placeholder = await page.locator("textarea").first().getAttribute("placeholder").catch(() => null);

  // Type + verify send button active
  const ta = page.locator("textarea").first();
  await ta.fill("Test UI send Teams " + Date.now());
  await page.waitForTimeout(500);
  const btnDisabled = await ta
    .evaluate((el: any) => {
      const wrap = el.closest("div")?.parentElement;
      const btn = wrap?.querySelector("button");
      return btn ? (btn as HTMLButtonElement).disabled : null;
    })
    .catch(() => null);
  result.sendButtonDisabled = btnDisabled;
  result.composerText = await ta.inputValue().catch(() => null);

  await page.screenshot({ path: "/tmp/verify-teams-ui.png", fullPage: false });
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
