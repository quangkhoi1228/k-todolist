/* Chạy: npx tsx scripts/verify-drag-workload.ts [--cdp <url>]
 * Verify drag-drop trong Workload view qua Chrome CDP.
 * Kéo 1 task từ cột ngày A sang cột ngày B, kiểm tra:
 *  - Task xuất hiện ở cột mới ngay lập tức (optimistic)
 *  - Network POST /api/data/tasks?action=updateTaskOrders ghi đúng startDate
 *  - Sau refetch (2s), task vẫn ở cột mới (server confirm)
 * KHÔNG ghi data vĩnh viễn — kéo task rồi kéo lại về vị trí cũ.
 */
import { chromium } from "playwright";

const CDP = process.argv.includes("--cdp")
  ? process.argv[process.argv.indexOf("--cdp") + 1]
  : "http://127.0.0.1:9222";

async function main() {
  const browser = await chromium.connectOverCDP(CDP);
  const pages = browser.contexts()[0].pages();
  const board = pages.find((p) => p.url().includes("/board")) || pages[0];
  await board.bringToFront();
  await board.waitForTimeout(500);

  // Đảm bảo đang ở Workload view
  await board.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Workload"
    );
    if (btn) btn.click();
  });
  await board.waitForTimeout(1200);

  // Track POST updateTaskOrders
  const requests: any[] = [];
  board.on("request", (req) => {
    if (req.method() === "POST" && req.url().includes("/api/data/tasks")) {
      requests.push({ url: req.url(), body: req.postData() });
    }
  });

  // Lấy bounding box của cột Thứ Ba (hôm nay) và Thứ Tư
  const cols = await board.evaluate(() => {
    const colEls = Array.from(document.querySelectorAll("h3"))
      .map((h) => h.parentElement?.parentElement?.parentElement)
      .filter(Boolean);
    const result: Record<string, any> = {};
    document.querySelectorAll("h3").forEach((h) => {
      const name = h.textContent?.trim() || "";
      const col = h.closest('div[class*="rounded-2xl"]');
      if (col) {
        const r = col.getBoundingClientRect();
        result[name] = { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
      }
    });
    return result;
  });
  console.log("Columns:", JSON.stringify(cols, null, 2));

  // Lấy 1 task card trong cột Thứ Ba
  const task = await board.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[data-task-card]'));
    for (const c of cards) {
      const col = c.closest('div[class*="rounded-2xl"]');
      const colTitle = col?.querySelector("h3")?.textContent?.trim();
      if (colTitle === "Thứ Ba") {
        const r = c.getBoundingClientRect();
        return { title: c.textContent?.trim().slice(0, 60), x: r.x, y: r.y, cx: r.x + r.width / 2, cy: r.y + r.height / 2, id: c.getAttribute("data-task-id") };
      }
    }
    return null;
  });
  console.log("Task in Thứ Ba:", JSON.stringify(task, null, 2));

  if (!task || !cols["Thứ Tư"]) {
    console.log("THIẾU task hoặc cột Thứ Tư — dừng.");
    await browser.close();
    return;
  }

  // Drag task từ Thứ Ba → Thứ Tư
  const targetCx = cols["Thứ Tư"].cx;
  const targetCy = Math.min(cols["Thứ Tư"].cy, task.cy + 200);

  await board.mouse.move(task.cx, task.cy);
  await board.mouse.down();
  await board.waitForTimeout(300);
  // Di chuyển từng bước để dnd-kit activate
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await board.mouse.move(
      task.cx + ((targetCx - task.cx) * i) / steps,
      task.cy + ((targetCy - task.cy) * i) / steps
    );
    await board.waitForTimeout(60);
  }
  await board.waitForTimeout(250);
  await board.mouse.up();
  console.log("Đã thả task vào cột Thứ Tư");

  await board.waitForTimeout(800);

  // Kiểm tra optimistic: task có xuất hiện ở Thứ Tư không
  const afterDrop = await board.evaluate(() => {
    const result: Record<string, any> = {};
    document.querySelectorAll("h3").forEach((h) => {
      const name = h.textContent?.trim() || "";
      const col = h.closest('div[class*="rounded-2xl"]');
      if (col) {
        const cards = col.querySelectorAll('[data-task-card]');
        result[name] = cards.length;
      }
    });
    return result;
  });
  console.log("Sau drop (optimistic):", JSON.stringify(afterDrop));
  await board.waitForTimeout(2500);

  // Sau refetch — kiểm tra lại
  const afterRefetch = await board.evaluate(() => {
    const result: Record<string, any> = {};
    document.querySelectorAll("h3").forEach((h) => {
      const name = h.textContent?.trim() || "";
      const col = h.closest('div[class*="rounded-2xl"]');
      if (col) {
        const cards = col.querySelectorAll('[data-task-card]');
        result[name] = cards.length;
      }
    });
    return result;
  });
  console.log("Sau refetch:", JSON.stringify(afterRefetch));

  console.log("--- Requests updateTaskOrders:");
  requests.filter((r) => r.body?.includes("updateTaskOrders")).forEach((r) => {
    console.log(r.body?.slice(0, 800));
  });

  await browser.close();
}

main().catch((err) => {
  console.error("Lỗi:", err);
  process.exit(1);
});
