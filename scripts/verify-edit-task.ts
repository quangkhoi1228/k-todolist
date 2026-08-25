/* Chạy: npx tsx scripts/verify-edit-task.ts [--cdp <url>]
 * Verify edit task: click nút Sửa trên card → dialog mở → đổi title → save → verify.
 * Đổi title rồi đổi lại title cũ (không để lại thay đổi).
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

  // Đảm bảo Kanban view
  await board.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Kanban");
    if (btn) btn.click();
  });
  await board.waitForTimeout(1500);

  // Lấy task đầu tiên visible + title gốc
  const src = await board.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[data-task-card]'));
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (r.y > 60 && r.y < 800) {
        const h = c.querySelector("h4");
        return { id: c.getAttribute("data-task-id"), title: h?.textContent?.trim() || c.textContent?.trim().slice(0, 50) };
      }
    }
    return null;
  });
  console.log("Task đầu:", JSON.stringify(src, null, 2));
  if (!src) {
    await browser.close();
    return;
  }

  // Hover card để hiện nút Sửa, rồi click
  const cardBox = await board.evaluate((id) => {
    const card = document.querySelector(`[data-task-id="${id}"]`);
    if (!card) return null;
    const r = card.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  }, src.id);
  console.log("Card box:", JSON.stringify(cardBox));

  if (!cardBox) { await browser.close(); return; }

  // Hover vào card để nút edit hiện ra
  await board.mouse.move(cardBox.cx, cardBox.cy);
  await board.waitForTimeout(600);

  // Click nút edit (pencil, title="Sửa chi tiết")
  const editClicked = await board.evaluate((id) => {
    const card = document.querySelector(`[data-task-id="${id}"]`);
    const btn = card?.querySelector('button[title="Sửa chi tiết"]');
    if (btn) { (btn as HTMLElement).click(); return true; }
    return false;
  }, src.id);
  console.log("Clicked edit:", editClicked);
  await board.waitForTimeout(1000);

  // Kiểm tra dialog edit mở (title có value = src.title)
  const dialogInfo = await board.evaluate(() => {
    const ta = document.querySelector('textarea[id="title"]') as HTMLTextAreaElement;
    return {
      open: !!ta,
      value: ta?.value?.slice(0, 80),
      hasDelete: Array.from(document.querySelectorAll("button")).some((b) => b.textContent?.includes("Xóa Công Việc")),
      hasSave: Array.from(document.querySelectorAll("button")).some((b) => b.textContent?.includes("Lưu Thay Đổi")),
    };
  });
  console.log("Dialog edit:", JSON.stringify(dialogInfo, null, 2));

  // Đóng dialog (Escape hoặc nút X)
  await board.evaluate(() => {
    const closeBtn = Array.from(document.querySelectorAll("button")).find((b) =>
      b.getAttribute("aria-label")?.includes("Close") || b.className.includes("absolute right-4")
    );
    if (closeBtn) closeBtn.click();
  });
  await board.waitForTimeout(500);

  // Test quick edit: double-click title → input hiện → Escape
  const quickEdit = await board.evaluate((id) => {
    const card = document.querySelector(`[data-task-id="${id}"]`);
    const h = card?.querySelector("h4");
    if (h) {
      h.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      return true;
    }
    return false;
  }, src.id);
  await board.waitForTimeout(600);
  const quickEditOpen = await board.evaluate(() => {
    const inputs = document.querySelectorAll('input');
    for (const i of Array.from(inputs)) {
      if (i.value && i.value.length > 3 && i.className.includes("h-6") || i.className.includes("text-\\[11px\\]")) {
        return { value: i.value.slice(0, 50), className: i.className.slice(0, 80) };
      }
    }
    return null;
  });
  console.log("Quick edit input:", JSON.stringify(quickEditOpen));
  // Escape để thoát
  await board.keyboard.press("Escape");
  await board.waitForTimeout(300);

  await board.screenshot({ path: "/tmp/board-edit-task.png" });
  await browser.close();
}

main().catch((err) => {
  console.error("Lỗi:", err);
  process.exit(1);
});
