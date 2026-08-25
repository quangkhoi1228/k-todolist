/* Chạy: npx tsx scripts/verify-hide-done.ts [--cdp <url>]
 * Verify hide/show done tasks một cách sạch sẽ: reload trang rồi toggle eye.
 */
import { chromium } from "playwright";

const CDP = process.argv.includes("--cdp")
  ? process.argv[process.argv.indexOf("--cdp") + 1]
  : "http://127.0.0.1:9222";

async function countCards(page: any) {
  return page.evaluate(() => document.querySelectorAll('[data-task-card]').length);
}

async function findEyeButton(page: any) {
  return page.evaluate(() => {
    // Tìm header ĐÃ HOÀN THÀNH chứa button eye (title chứa "Ẩn" hoặc "Hiện")
    const headers = Array.from(document.querySelectorAll("div"));
    for (const h of headers) {
      const t = h.textContent?.trim().toUpperCase() || "";
      if (t.startsWith("ĐÃ HOÀN THÀNH")) {
        const btn = h.querySelector("button");
        if (btn && (btn.title?.includes("Ẩn") || btn.title?.includes("Hiện") || btn.querySelector('svg'))) {
          return { title: btn.title, found: true };
        }
      }
    }
    return { found: false };
  });
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP);
  const pages = browser.contexts()[0].pages();
  const board = pages.find((p) => p.url().includes("/board")) || pages[0];
  await board.bringToFront();

  // Reload để reset UI state
  await board.reload();
  await board.waitForLoadState("domcontentloaded");
  await board.waitForTimeout(2500);

  // Đảm bảo Kanban view
  await board.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Kanban");
    if (btn) btn.click();
  });
  await board.waitForTimeout(1500);

  const initial = await countCards(board);
  console.log("Sau reload (Kanban):", initial, "cards");

  const eye = await findEyeButton(board);
  console.log("Eye button:", JSON.stringify(eye));

  // Click eye (lần 1)
  const clicked1 = await board.evaluate(() => {
    const headers = Array.from(document.querySelectorAll("div"));
    for (const h of headers) {
      const t = h.textContent?.trim().toUpperCase() || "";
      if (t.startsWith("ĐÃ HOÀN THÀNH")) {
        const btn = h.querySelector("button");
        if (btn) { btn.click(); return btn.title; }
      }
    }
    return null;
  });
  console.log("Clicked eye:", clicked1);
  await board.waitForTimeout(1500);
  const after1 = await countCards(board);
  console.log("Sau click 1:", after1, "cards");

  // Click lại (lần 2)
  const clicked2 = await board.evaluate(() => {
    const headers = Array.from(document.querySelectorAll("div"));
    for (const h of headers) {
      const t = h.textContent?.trim().toUpperCase() || "";
      if (t.startsWith("ĐÃ HOÀN THÀNH")) {
        const btn = h.querySelector("button");
        if (btn) { btn.click(); return btn.title; }
      }
    }
    return null;
  });
  console.log("Clicked eye 2:", clicked2);
  await board.waitForTimeout(1500);
  const after2 = await countCards(board);
  console.log("Sau click 2:", after2, "cards");

  await board.screenshot({ path: "/tmp/board-final.png" });
  await browser.close();
}

main().catch((err) => {
  console.error("Lỗi:", err);
  process.exit(1);
});
