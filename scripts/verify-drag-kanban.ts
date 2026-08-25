/* Chạy: npx tsx scripts/verify-drag-kanban.ts [--cdp <url>]
 * Verify drag-drop trong Kanban view (status mode).
 * Kéo 1 task từ cell "Chưa thực hiện" → "Đang xử lý" cùng project.
 * Kiểm tra optimistic + network request + server confirm, rồi kéo lại để restore.
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

  // Đảm bảo đang ở Kanban view
  await board.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Kanban"
    );
    if (btn) btn.click();
  });
  await board.waitForTimeout(1200);

  // Track POST
  const posts: any[] = [];
  board.on("request", (req) => {
    if (req.method() === "POST" && req.url().includes("/api/data/tasks")) {
      posts.push({ url: req.url(), body: req.postData() });
    }
  });

  // Lấy bounding box của các cell status trong project đầu tiên
  const cells = await board.evaluate(() => {
    const result: Record<string, any> = {};
    document.querySelectorAll("h3").forEach((h) => {});
    // Tìm project section đầu tiên: các cell có droppable
    // Cell được xác định bởi div[class*="rounded-2xl"] chứa h3? Không — cell không có h3.
    // Cell là div chứa "Kéo thả vào đây" hoặc task cards
    const swimCells = document.querySelectorAll('div[data-task-card]');
    return { totalCards: swimCells.length };
  });
  console.log("Total cards:", cells.totalCards);

  // Tìm SwimlaneCell: div có class "rounded-2xl" và border, chứa task cards hoặc text "Kéo thả"
  const cellInfo = await board.evaluate(() => {
    const result: any[] = [];
    // Tìm tất cả div có class chứa "rounded-2xl" (đặc trưng của SwimlaneCell)
    document.querySelectorAll('[class*="rounded-2xl"]').forEach((d) => {
      const html = d as HTMLElement;
      const r = html.getBoundingClientRect();
      if (r.width >= 250 && r.width <= 360 && r.height > 50) {
        const cards = d.querySelectorAll('[data-task-card]').length;
        const header = d.querySelector('h3')?.textContent?.trim() || "";
        const text = d.textContent?.trim().slice(0, 60) || "";
        // Lọc ra các cell chứa status header (Không lấy project section header)
        const isStatusCell = ["Chưa thực hiện", "Đang xử lý", "Đến hạn", "Đã hoàn thành"].some(s => 
          d.querySelector('h3')?.textContent?.includes(s)
        );
        if (isStatusCell || cards > 0) {
          result.push({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), cards, header, text: text.slice(0, 40) });
        }
      }
    });
    return result.slice(0, 16);
  });
  console.log("Cells:", JSON.stringify(cellInfo, null, 2));

  // Tìm 1 task trong cell đầu tiên có cards
  const srcCell = cellInfo.find((c) => c.cards > 0);
  if (!srcCell) {
    console.log("KHÔNG có cell nào có task");
    await browser.close();
    return;
  }

  // Lấy task đầu tiên trong cell đó
  const srcTask = await board.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[data-task-card]'));
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      // Task trong viewport
      if (r.y > 60 && r.y < 800) {
        return { title: c.textContent?.trim().slice(0, 60), x: r.x, y: r.y, cx: r.x + r.width / 2, cy: r.y + r.height / 2, id: c.getAttribute("data-task-id"), status: c.closest('div')?.querySelector('h3')?.textContent?.trim() };
      }
    }
    return null;
  });
  console.log("Source task:", JSON.stringify(srcTask, null, 2));

  // Tìm cell "Đang xử lý" (cột 2, x=520) — header ở sticky row phía trên
  // Dựa vào KANBAN_COLUMN_WIDTH=320 và vị trí: cột 1 x~188, cột 2 x~520, cột 3 x~852, cột 4 x~1184
  const targetCell = await board.evaluate(() => {
    // Tìm sticky header "Đang xử lý"
    const headers = Array.from(document.querySelectorAll("div")).filter((d) => d.textContent?.trim() === "Đang xử lý");
    let targetX = 0;
    for (const h of headers) {
      const r = h.getBoundingClientRect();
      if (r.width > 100 && r.height > 15) { // header status column
        targetX = r.x + r.width / 2;
        break;
      }
    }
    if (!targetX) return null;
    // Tìm cell có cùng x trong vùng dữ liệu (y > header)
    const cells: any[] = [];
    document.querySelectorAll('[class*="rounded-2xl"]').forEach((d) => {
      const r = (d as HTMLElement).getBoundingClientRect();
      if (r.width >= 250 && r.width <= 360 && r.height > 50 && Math.abs(r.x + r.width / 2 - targetX) < 40 && r.y > 100) {
        cells.push({ x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cards: d.querySelectorAll('[data-task-card]').length });
      }
    });
    // Chọn cell đầu tiên (project đầu tiên)
    cells.sort((a, b) => a.y - b.y);
    return cells[0] || null;
  });
  console.log("Target cell (Đang xử lý):", JSON.stringify(targetCell, null, 2));

  if (!srcTask || !targetCell) {
    console.log("THIẾU task hoặc cell target");
    await browser.close();
    return;
  }

  // Drag task → cell Đang xử lý (vị trí y + 150 trong cell để không đè lên task khác)
  await board.mouse.move(srcTask.cx, srcTask.cy);
  await board.mouse.down();
  await board.waitForTimeout(200);
  const targetCx = targetCell.cx;
  const targetCy = Math.min(targetCell.y + 120, targetCell.y + targetCell.h - 40);
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await board.mouse.move(
      srcTask.cx + ((targetCx - srcTask.cx) * i) / steps,
      srcTask.cy + ((targetCy - srcTask.cy) * i) / steps
    );
    await board.waitForTimeout(50);
  }
  await board.waitForTimeout(200);
  await board.mouse.up();
  console.log("Đã thả task vào Đang xử lý");
  await board.waitForTimeout(800);

  // Kiểm tra optimistic
  const afterDrop = await board.evaluate(() => {
    const result: Record<string, any> = {};
    document.querySelectorAll('[class*="rounded-2xl"]').forEach((d) => {
      const r = (d as HTMLElement).getBoundingClientRect();
      if (r.width >= 250 && r.width <= 360 && r.height > 50) {
        const cards = d.querySelectorAll('[data-task-card]').length;
        const header = d.querySelector('h3')?.textContent?.trim() || "";
        const key = header || `cell-${Math.round(r.x)}`;
        if (cards > 0 || header) result[key] = cards;
      }
    });
    return result;
  });
  console.log("Sau drop:", JSON.stringify(afterDrop));
  await board.waitForTimeout(2500);

  const afterRefetch = await board.evaluate(() => {
    const result: Record<string, any> = {};
    document.querySelectorAll('[class*="rounded-2xl"]').forEach((d) => {
      const r = (d as HTMLElement).getBoundingClientRect();
      if (r.width >= 250 && r.width <= 360 && r.height > 50) {
        const cards = d.querySelectorAll('[data-task-card]').length;
        const header = d.querySelector('h3')?.textContent?.trim() || "";
        const key = header || `cell-${Math.round(r.x)}`;
        if (cards > 0 || header) result[key] = cards;
      }
    });
    return result;
  });
  console.log("Sau refetch:", JSON.stringify(afterRefetch));

  console.log("--- POST requests:");
  posts.forEach((p) => {
    console.log(p.url());
    console.log(p.body?.slice(0, 600));
    console.log("---");
  });

  await browser.close();
}

main().catch((err) => {
  console.error("Lỗi:", err);
  process.exit(1);
});
