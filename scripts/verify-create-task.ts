/* Chạy: npx tsx scripts/verify-create-task.ts [--cdp <url>]
 * Verify tạo task qua NewTaskSheet: mở dialog → điền title → save → verify task xuất hiện → xoá.
 * Tạo task test rồi xoá ngay (không để lại data).
 */
import { chromium } from "playwright";

const CDP = process.argv.includes("--cdp")
  ? process.argv[process.argv.indexOf("--cdp") + 1]
  : "http://127.0.0.1:9222";

const TEST_TITLE = "TEST_TMP_VerifyCreate_" + Date.now();

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
  await board.waitForTimeout(1200);

  // Click nút "Công Việc" (NewTaskSheet trigger)
  const clicked = await board.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Công Việc");
    if (btn) { btn.click(); return true; }
    return false;
  });
  console.log("Clicked Công Việc:", clicked);
  await board.waitForTimeout(800);

  // Kiểm tra dialog mở (Tên Công Việc textarea)
  const dialogOpen = await board.evaluate(() => {
    const ta = document.querySelector('textarea[id="title"]');
    return ta ? true : false;
  });
  console.log("Dialog mở:", dialogOpen);

  // Điền title
  await board.evaluate((t) => {
    const ta = document.querySelector('textarea[id="title"]') as HTMLTextAreaElement;
    if (ta) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(ta, t);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, TEST_TITLE);
  await board.waitForTimeout(300);

  // Submit form
  await board.evaluate(() => {
    const form = document.querySelector('form');
    if (form) form.requestSubmit();
  });
  console.log("Đã submit form");
  await board.waitForTimeout(2500);

  // Kiểm tra task xuất hiện trên board (sau refetch)
  const found = await board.evaluate((t) => {
    const cards = Array.from(document.querySelectorAll('[data-task-card]'));
    return cards.some((c) => c.textContent?.includes(t));
  }, TEST_TITLE);
  console.log("Task test xuất hiện trên board:", found);

  // Xoá task test (qua API)
  const deleted = await board.evaluate(async (t) => {
    const res = await fetch("/api/data/tasks?action=getTasks&userId=user_3GR4jOa1wskoz2wg26s8X2D9FOZ", { cache: "no-store" });
    const tasks = await res.json();
    const task = Array.isArray(tasks) ? tasks.find((x: any) => x.title === t) : null;
    if (!task) return false;
    const del = await fetch("/api/data/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "deleteTask", id: task._id }),
    });
    return del.ok;
  }, TEST_TITLE);
  console.log("Đã xoá task test:", deleted);

  await board.screenshot({ path: "/tmp/board-create-task.png" });
  await browser.close();
}

main().catch((err) => {
  console.error("Lỗi:", err);
  process.exit(1);
});
