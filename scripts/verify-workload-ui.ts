/* Chạy: npx tsx scripts/verify-workload-ui.ts [--cdp <url>] [--screenshot <path>]
 * Verify Workload view: chuyển view, đếm cột ngày, kiểm tra Tồn đọng, tổng giờ/cột.
 */
import { chromium } from "playwright";

const CDP = process.argv.includes("--cdp")
  ? process.argv[process.argv.indexOf("--cdp") + 1]
  : "http://127.0.0.1:9222";
const shotIdx = process.argv.indexOf("--screenshot");
const shotPath = shotIdx >= 0 ? process.argv[shotIdx + 1] : null;

async function main() {
  const browser = await chromium.connectOverCDP(CDP);
  const pages = browser.contexts()[0].pages();
  const board = pages.find((p) => p.url().includes("/board")) || pages[0];
  await board.bringToFront();
  await board.waitForTimeout(1000);

  // Click nút Workload
  const clicked = await board.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Workload"
    );
    if (btn) { btn.click(); return true; }
    return false;
  });
  console.log("Clicked Workload:", clicked);
  await board.waitForTimeout(1500);

  const info = await board.evaluate(() => {
    const columns = Array.from(document.querySelectorAll("h3")).map((e) => e.textContent?.trim());
    const dayCols = columns.filter((c) => c && /Thứ|Chủ nhật|Tồn đọng/i.test(c));
    // Đếm số cột bằng cách tìm container
    const colContainers = document.querySelectorAll('div[class*="rounded-2xl"]');
    // Tổng giờ mỗi cột
    const hourBadges = Array.from(document.querySelectorAll("div")).filter(
      (d) => d.textContent?.trim() && /\d+\s*\/\s*8h/.test(d.textContent.trim())
    ).map((d) => d.textContent?.trim());
    return {
      columns: dayCols,
      columnCount: dayCols.length,
      hourBadges: hourBadges.slice(0, 15),
      hasOverdue: dayCols.some((c) => c === "Tồn đọng"),
      bodyText: document.body.innerText.slice(0, 400),
    };
  });
  console.log(JSON.stringify(info, null, 2));

  if (shotPath) {
    await board.screenshot({ path: shotPath });
    console.log("Screenshot:", shotPath);
  }

  await browser.close();
}

main().catch((err) => {
  console.error("Lỗi:", err);
  process.exit(1);
});
