/**
 * Script to list available Zalo group chats from the sidebar.
 * Reads names directly from sidebar title elements (fast, no clicking needed).
 * Zalo conversation items have the name on the first line (often bold),
 * and message preview on subsequent lines.
 */

import { chromium } from "playwright";
import path from "path";
import fs from "fs";
import { DEFAULT_ZALO_CONFIG, createZaloStealthContext, waitForZaloLogin, navigateToZalo, applyStealthPatches, openZaloTabInBackground } from "../lib/zalo-automator";

async function main() {
  const config = {
    ...DEFAULT_ZALO_CONFIG,
    headless: process.argv.includes("--headless"),
    useRealChrome: true,
  };

  const { browser, context } = await createZaloStealthContext(config);
  const isCdp = process.env.USE_CDP === "1" || process.env.USE_CDP === "true";
  // CDP mode: dùng tab Zalo có sẵn (đã load) nếu có — tránh tích tụ tab heavy
  // Lưu ý: `isCdp` == false → fallback đã chuyển sang launchPersistentContext,
  // lúc đó context.pages()[0] là page của ZALO (persistent), còn page Zalo
  // CDP không tồn tại. Dùng page đầu tiên có sẵn (newPage chỉ dùng khi thật cần).
  let page = context.pages()[0];
  if (isCdp) {
    const zaloPage = context.pages().find((p) => p.url().includes("zalo.me"));
    page = zaloPage || (context.pages()[0] || await openZaloTabInBackground(browser, context));
  } else {
    page = context.pages()[0] || await openZaloTabInBackground(browser, context);
  }
  await applyStealthPatches(page);

  try {
    await navigateToZalo(page, config);
    const neededLogin = await waitForZaloLogin(page, config);
    if (neededLogin) {
      try {
        await context.storageState({ path: config.sessionDir + "/state.json" });
      } catch { /* persistent context */ }
    }

    // ─── Không lọc tab "Nhóm" — quét cả chat cá nhân (1:1) và nhóm ──
    // Tab "Nhóm" chỉ hiển thị group chats; bỏ qua nó để bao gồm cả
    // các cuộc hội thoại cá nhân (khách hàng, sale, đồng nghiệp) mà
    // PM cũng cần theo dõi.
    // (Giữ lại cảnh báo nếu tab vẫn được render, nhưng không click.)
    const tabClicked = await page.evaluate(() => {
      const allElements = document.querySelectorAll('div, span, a, button, [role="tab"]');
      for (const el of allElements) {
        const text = (el.textContent || "").trim().replace(/\u00a0/g, " ");
        if (/^Nhóm$/i.test(text) && el.children.length === 0) {
          // Không click — chỉ ghi nhận sự tồn tại của tab
          return true;
        }
      }
      return false;
    });
    if (tabClicked) {
      console.error("[zalo-list-chats] Phat hien tab Nhóm — nhung khong click, quet ca chat ca nhan.");
    } else {
      console.error("[zalo-list-chats] Khong thay tab Nhóm — quet toan bo danh sach.");
    }
    // Đảm bảo đang ở tab "Gần đây" (Recent) / "Tin nhắn" (Messages) để thấy cả 1:1
    await page.evaluate(() => {
      const allElements = document.querySelectorAll('div, span, a, button, [role="tab"]');
      for (const el of allElements) {
        const text = (el.textContent || "").trim().replace(/\u00a0/g, " ").toLowerCase();
        if (/(^gần đây$|^tin nhắn$|^recent$|^messages$|^chat$|^hội thoại$)/i.test(text) && el.children.length === 0) {
          (el as HTMLElement).click();
          return;
        }
      }
    });
    // Wait for filter to take effect
    await page.waitForTimeout(1_500);

    // ─── Scroll and collect names (Zalo uses virtual list, so items are recycled) ──
    const MAX_ITEMS = 200;
    const MAX_SCROLLS = 15;
    let allNames = new Set();
    let prevCount = 0;
    let staleRounds = 0;

    for (let i = 0; i < MAX_SCROLLS; i++) {
      // Extract names from currently visible items
      const names = await page.evaluate(() => {
        // Chỉ lấy các phần tử con có title thực sự — tránh match wrapper lẫn preview.
        // Zalo vẽ mỗi conversation 1 item, tên nằm trong element chứa class title.
        const titleEls = document.querySelectorAll(
          '.conv-item-title__name.truncate.grid-item, [class*="conv-item-title__name"], [class*="conv-title"], [class*="conversation-title"], [class*="conv_item"] .title, [class*="conv-item"] [class*="name"][class*="truncate"]'
        );
        const found: string[] = [];
        for (const el of titleEls) {
          const text = (el.textContent || "").trim().replace(/\u00a0/g, " ").replace(/\s+/g, " ");
          if (text.length < 2) continue;
          if (/^(Tất cả|Cá nhân|Nhóm|Gần đây|Tin nhắn|All|Personal|Groups|Recent|Messages)$/i.test(text)) continue;
          if (!found.includes(text)) found.push(text);
        }
        return found;
      });

      // Merge into global set
      for (const n of names) allNames.add(n);

      console.error(
        `[zalo-list-chats] Scroll ${i+1}/${MAX_SCROLLS}: ` +
        `visible=${names.length} cumulative=${allNames.size}`
      );

      // Stop if we have enough
      if (allNames.size >= MAX_ITEMS) {
        console.error(`[zalo-list-chats] Reached target: ${allNames.size} items`);
        break;
      }

      // Stale check: if visible items count hasn't changed, we might be at end
      if (names.length === prevCount) {
        staleRounds++;
        if (staleRounds >= 3) {
          console.error(`[zalo-list-chats] No new items after ${staleRounds} scrolls. Stopping.`);
          break;
        }
      } else {
        staleRounds = 0;
      }
      prevCount = names.length;

      // Scroll the list container
      await page.evaluate(() => {
        const allDivs = document.querySelectorAll('div');
        for (const div of allDivs) {
          const style = window.getComputedStyle(div);
          if (style.overflow === 'auto' || style.overflow === 'scroll' ||
              style.overflowY === 'auto' || style.overflowY === 'scroll') {
            const rect = div.getBoundingClientRect();
            if (rect.width > 100 && rect.height > 100 && div.scrollHeight > div.clientHeight + 10) {
              div.scrollTop += 600;
            }
          }
        }
      });
      await page.waitForTimeout(800);
    }

    const chats = Array.from(allNames);

    console.error(`[zalo-list-chats] Extracted ${chats.length} chats directly from sidebar.`);
    console.log(JSON.stringify({ ok: true, chats }));

  } catch (err) {
    console.log(JSON.stringify({ ok: false, error: String(err) }));
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((err) => {
  console.log(JSON.stringify({ ok: false, error: String(err) }));
}).finally(() => {
  // CDP connection keeps the event loop alive — force-exit so the UI
  // doesn't wait forever on this child process.
  process.exit(0);
});
