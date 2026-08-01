/**
 * Script to list available Zalo group chats from the sidebar.
 * Reads names directly from sidebar title elements (fast, no clicking needed).
 * Zalo conversation items have the name on the first line (often bold),
 * and message preview on subsequent lines.
 */

import { chromium } from "playwright";
import path from "path";
import fs from "fs";
import { DEFAULT_ZALO_CONFIG, createZaloStealthContext, waitForZaloLogin, navigateToZalo, applyStealthPatches } from "../lib/zalo-automator";

async function main() {
  const config = {
    ...DEFAULT_ZALO_CONFIG,
    headless: process.argv.includes("--headless"),
    useRealChrome: true,
  };

  const { browser, context } = await createZaloStealthContext(config);
  const page = context.pages()[0] || await context.newPage();
  await applyStealthPatches(page);

  try {
    await navigateToZalo(page, config);
    const neededLogin = await waitForZaloLogin(page, config);
    if (neededLogin) {
      try {
        await context.storageState({ path: config.sessionDir + "/state.json" });
      } catch { /* persistent context */ }
    }

    // ─── Click "Nhóm" (Groups) tab to filter only group chats ──
    const tabClicked = await page.evaluate(() => {
      const allElements = document.querySelectorAll('div, span, a, button, [role="tab"]');
      for (const el of allElements) {
        const text = (el.textContent || "").trim().replace(/\u00a0/g, " ");
        if (/^Nhóm$/i.test(text) && el.children.length === 0) {
          (el as HTMLElement).click();
          return true;
        }
      }
      return false;
    });
    if (tabClicked) {
      console.error("[zalo-list-chats] Da click tab Nhóm.");
    } else {
      console.error("[zalo-list-chats] Khong tim thay tab Nhóm, lay tat ca.");
    }
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
        const items = document.querySelectorAll('[class*="conv-item"], [role="listitem"]');
        const found: string[] = [];
        for (const item of items) {
          // Use exact title class if available
          const title = item.querySelector('.conv-item-title__name.truncate.grid-item');
          if (title) {
            const text = (title.textContent || "").trim().replace(/\u00a0/g, " ");
            if (text.length >= 2) found.push(text);
            continue;
          }
          // Fallback: bold element (Zalo renders group names in bold)
          const bold = item.querySelector('strong, b');
          if (bold) {
            const text = (bold.textContent || "").trim().replace(/\u00a0/g, " ");
            if (text.length >= 2) found.push(text);
            continue;
          }
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
});
