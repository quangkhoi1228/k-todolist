/* Chạy: npx tsx scripts/verify-board-ui.ts [--screenshot <path>] [--cdp <url>]
 * Verify UI Kanban/Workload board qua Chrome CDP đã có session Clerk.
 * Không sửa data — chỉ đọc DOM + chụp screenshot.
 */
import { chromium } from "playwright";

const CDP = process.argv.includes("--cdp")
  ? process.argv[process.argv.indexOf("--cdp") + 1]
  : "http://127.0.0.1:9222";
const shotIdx = process.argv.indexOf("--screenshot");
const shotPath = shotIdx >= 0 ? process.argv[shotIdx + 1] : null;

async function main() {
  const browser = await chromium.connectOverCDP(CDP);
  const contexts = browser.contexts();
  const ctx = contexts[0];
  const pages = ctx.pages();
  const board = pages.find((p) => p.url().includes("/board")) || pages[0];

  if (!board) {
    console.log("KHÔNG tìm thấy tab board");
    await browser.close();
    return;
  }
  await board.bringToFront();
  await board.waitForLoadState("domcontentloaded");
  await board.waitForTimeout(1500);

  // Kiểm tra xem có redirect sign-in không
  console.log("URL:", board.url());
  if (board.url().includes("sign-in")) {
    console.log("SESSION LỖI: bị redirect về sign-in");
    await browser.close();
    return;
  }

  // Đọc thông tin cơ bản
  const info = await board.evaluate(() => {
    const titles = Array.from(document.querySelectorAll("h2, h3")).map((e) => e.textContent?.trim()).filter(Boolean);
    const taskCards = document.querySelectorAll('[data-task-card]').length;
    const buttons = Array.from(document.querySelectorAll("button")).map((b) => b.textContent?.trim()).filter(Boolean);
    return {
      title: document.title,
      h2h3: titles.slice(0, 15),
      taskCards,
      buttons: buttons.slice(0, 30),
      hasKanbanToggle: buttons.some((b) => b === "Kanban"),
      hasWorkloadToggle: buttons.some((b) => b === "Workload"),
      bodyText: document.body.innerText.slice(0, 500),
    };
  });
  console.log(JSON.stringify(info, null, 2));

  if (shotPath) {
    await board.screenshot({ path: shotPath, fullPage: false });
    console.log("Screenshot:", shotPath);
  }

  await browser.close();
}

main().catch((err) => {
  console.error("Lỗi:", err);
  process.exit(1);
});
