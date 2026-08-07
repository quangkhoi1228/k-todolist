/**
 * Verify UI Teams send composer qua CDP (browser thật đã login Clerk).
 * Chạy với Chrome CDP port 9222 mở bằng profile copy /tmp/kflow-login-profile
 * (xem .cursor/rules/verify-app-login.mdc để biết cách mở profile đã login).
 * Run: npx tsx scripts/verify-teams-send-ui.ts
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

  // Vào project 45 (PM-FRT FinOPS có chat An Mai Thuan)
  await page.goto("http://localhost:3000/projects/45", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(4000);
  result.projectUrl = page.url();
  await page.screenshot({ path: "/tmp/teams-send-ui-verify/01-project45.png" });

  // Mở tab Chats (text bắt đầu bằng "Chats")
  const chatsTab = page.getByRole("button", { name: /^Chats/i }).first();
  const chatsTabCount = await chatsTab.count().catch(() => 0);
  result.chatsTabCount = chatsTabCount;
  if (chatsTabCount > 0) {
    await chatsTab.click();
    await page.waitForTimeout(4000);
  }
  await page.screenshot({ path: "/tmp/teams-send-ui-verify/02-chats-tab.png" });

  // Chọn group "An Mai Thuan"
  const anGroup = page.getByText("An Mai Thuan", { exact: true }).first();
  const anGroupCount = await anGroup.count().catch(() => 0);
  result.anGroupCount = anGroupCount;
  if (anGroupCount > 0) {
    await anGroup.click();
    await page.waitForTimeout(4000);
  }
  await page.screenshot({ path: "/tmp/teams-send-ui-verify/03-an-selected.png" });

  // Verify composer
  const textareas = await page.locator("textarea").count();
  result.textareas = textareas;
  result.placeholder = await page.locator("textarea").first().getAttribute("placeholder").catch(() => null);
  const btnDisabled = await page
    .locator("textarea")
    .first()
    .evaluate((el: any) => {
      const wrap = el.closest("div")?.parentElement;
      const btn = wrap?.querySelector("button");
      return btn ? (btn as HTMLButtonElement).disabled : null;
    })
    .catch(() => null);
  result.sendButtonDisabled = btnDisabled;

  await page.screenshot({ path: "/tmp/teams-send-ui-verify/04-composer-final.png" });
  console.log("RESULT:" + JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
