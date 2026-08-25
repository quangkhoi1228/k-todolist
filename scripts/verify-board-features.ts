/* Chạy: npx tsx scripts/verify-board-features.ts [--cdp <url>]
 * Verify các tính năng chỉ-đọc của Kanban/Workload board:
 *  - Sort theo Hạn chót / Độ ưu tiên
 *  - Filter theo trạng thái
 *  - Hide done tasks
 *  - Badge quá hạn trên header "Đến hạn"
 *  - Toggle Kanban/Workload
 * KHÔNG sửa data.
 */
import { chromium } from "playwright";

const CDP = process.argv.includes("--cdp")
  ? process.argv[process.argv.indexOf("--cdp") + 1]
  : "http://127.0.0.1:9222";

async function clickButton(page: any, text: string) {
  return page.evaluate((t: string) => {
    const btn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === t
    );
    if (btn) { btn.click(); return true; }
    return false;
  }, text);
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP);
  const pages = browser.contexts()[0].pages();
  const board = pages.find((p) => p.url().includes("/board")) || pages[0];
  await board.bringToFront();
  await board.waitForTimeout(500);

  // Đảm bảo Kanban view
  await clickButton(board, "Kanban");
  await board.waitForTimeout(1000);

  const report: Record<string, any> = {};

  // 1. Kiểm tra sticky header + badge quá hạn
  report.header = await board.evaluate(() => {
    const headers = Array.from(document.querySelectorAll("div")).filter((d) => {
      const t = d.textContent?.trim() || "";
      return ["CHƯA THỰC HIỆN", "ĐANG XỬ LÝ", "ĐẾN HẠN", "ĐÃ HOÀN THÀNH"].includes(t.toUpperCase()) ||
        (d.textContent?.includes("quá hạn") && d.querySelectorAll("*").length < 5);
    });
    const overdueBadges = Array.from(document.querySelectorAll("div")).filter((d) =>
      d.textContent?.match(/\d+ quá hạn/)
    ).map((d) => d.textContent?.trim());
    return {
      statusHeaders: headers.slice(0, 8).map((h) => h.textContent?.trim()),
      overdueBadges,
    };
  });

  // 2. Sort theo Hạn chót
  await board.evaluate(() => {
    const triggers = Array.from(document.querySelectorAll("button")).filter((b) =>
      b.textContent?.includes("Sắp xếp")
    );
    if (triggers[0]) triggers[0].click();
  });
  await board.waitForTimeout(500);
  await board.evaluate(() => {
    const items = Array.from(document.querySelectorAll("[role='option'], [role='menuitem'], li, [data-value]")).filter((i) =>
      i.textContent?.includes("Hạn chót")
    );
    if (items[0]) (items[0] as HTMLElement).click();
  });
  await board.waitForTimeout(1000);
  report.sortEndDate = await board.evaluate(() => {
    const trigger = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Sắp xếp"));
    return trigger?.textContent?.trim();
  });

  // 3. Sort theo Độ ưu tiên
  await board.evaluate(() => {
    const triggers = Array.from(document.querySelectorAll("button")).filter((b) =>
      b.textContent?.includes("Sắp xếp")
    );
    if (triggers[0]) triggers[0].click();
  });
  await board.waitForTimeout(500);
  await board.evaluate(() => {
    const items = Array.from(document.querySelectorAll("[role='option'], [role='menuitem'], li, [data-value]")).filter((i) =>
      i.textContent?.includes("Độ ưu tiên")
    );
    if (items[0]) (items[0] as HTMLElement).click();
  });
  await board.waitForTimeout(1000);
  report.sortPriority = await board.evaluate(() => {
    const trigger = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Sắp xếp"));
    return trigger?.textContent?.trim();
  });

  // 4. Filter theo trạng thái "Đang xử lý"
  await board.evaluate(() => {
    const triggers = Array.from(document.querySelectorAll("button")).filter((b) =>
      b.textContent?.includes("Trạng thái")
    );
    if (triggers[0]) triggers[0].click();
  });
  await board.waitForTimeout(500);
  await board.evaluate(() => {
    const items = Array.from(document.querySelectorAll("[role='option'], [role='menuitem'], li, [data-value]")).filter((i) =>
      i.textContent?.includes("Đang xử lý")
    );
    if (items[0]) (items[0] as HTMLElement).click();
  });
  await board.waitForTimeout(1000);
  report.filterProcessing = await board.evaluate(() => {
    const cards = document.querySelectorAll('[data-task-card]').length;
    const trigger = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Trạng thái"));
    return { trigger: trigger?.textContent?.trim(), cards };
  });

  // Reset filter về Tất cả
  await board.evaluate(() => {
    const triggers = Array.from(document.querySelectorAll("button")).filter((b) =>
      b.textContent?.includes("Trạng thái")
    );
    if (triggers[0]) triggers[0].click();
  });
  await board.waitForTimeout(500);
  await board.evaluate(() => {
    const items = Array.from(document.querySelectorAll("[role='option'], [role='menuitem'], li, [data-value]")).filter((i) =>
      i.textContent?.includes("Tất cả")
    );
    if (items[0]) (items[0] as HTMLElement).click();
  });
  await board.waitForTimeout(800);

  // 5. Reset sort về Mặc định
  await board.evaluate(() => {
    const triggers = Array.from(document.querySelectorAll("button")).filter((b) =>
      b.textContent?.includes("Sắp xếp")
    );
    if (triggers[0]) triggers[0].click();
  });
  await board.waitForTimeout(500);
  await board.evaluate(() => {
    const items = Array.from(document.querySelectorAll("[role='option'], [role='menuitem'], li, [data-value]")).filter((i) =>
      i.textContent?.includes("Mặc định")
    );
    if (items[0]) (items[0] as HTMLElement).click();
  });
  await board.waitForTimeout(800);

  // 6. Toggle hide done tasks (nút Eye trên header Đã hoàn thành)
  report.hideDone = await board.evaluate(() => {
    // Tìm button Eye/EyeOff trong header ĐÃ HOÀN THÀNH
    const header = Array.from(document.querySelectorAll("div")).find((d) =>
      d.textContent?.trim().toUpperCase().startsWith("ĐÃ HOÀN THÀNH") && d.querySelectorAll("button").length > 0
    );
    if (!header) return "không tìm thấy header";
    const btn = header.querySelector("button");
    const before = document.querySelectorAll('[data-task-card]').length;
    btn?.click();
    return { clicked: true, before };
  });
  await board.waitForTimeout(1200);
  report.hideDoneAfter = await board.evaluate(() => {
    const cards = document.querySelectorAll('[data-task-card]').length;
    return { cards };
  });
  // Bật lại
  await board.evaluate(() => {
    const header = Array.from(document.querySelectorAll("div")).find((d) =>
      d.textContent?.trim().toUpperCase().startsWith("ĐÃ HOÀN THÀNH") && d.querySelectorAll("button").length > 0
    );
    header?.querySelector("button")?.click();
  });
  await board.waitForTimeout(800);

  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}

main().catch((err) => {
  console.error("Lỗi:", err);
  process.exit(1);
});
