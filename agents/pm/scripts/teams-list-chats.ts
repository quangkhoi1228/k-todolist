/**
 * Script to list available joined chats from Teams v2 sidebar.
 * Used by the PM Agent UI to provide an autocomplete dropdown.
 */

import { DEFAULT_CONFIG, createStealthContext, waitForLogin, navigateToTeams, applyStealthPatches } from "../lib/teams-automator";

async function main() {
  const config = {
    ...DEFAULT_CONFIG,
    headless: process.argv.includes("--headless"),
    useRealChrome: true, // Always real Chrome for v2
  };

  const { browser, context } = await createStealthContext(config);
  const page = context.pages()[0] || await context.newPage();
  await applyStealthPatches(page);

  try {
    await navigateToTeams(page, config);

    const neededLogin = await waitForLogin(page, config);
    if (neededLogin) {
      await context.storageState({ path: config.sessionDir + "/state.json" });
    }

    // Expand sections
    await page.evaluate(() => {
      const treeitems = document.querySelectorAll('[role="treeitem"]');
      for (const item of treeitems) {
        const text = item.textContent?.trim() || "";
        if (["Chats", "External", "Đợi chốt manday"].includes(text)) {
          (item as HTMLElement).click();
        }
      }
    });
    await page.waitForTimeout(3_000);

    // Scroll sidebar and collect names at each step (Teams uses virtual list — items recycle)
    const MAX_ITEMS = 200;
    const MAX_SCROLLS = 15;
    let allNames = new Set<string>();
    let prevCount = 0;
    let staleRounds = 0;

    for (let i = 0; i < MAX_SCROLLS; i++) {
      // Extract names from currently visible items (before scrolling, so we catch current batch)
      const names = await page.evaluate(() => {
        const items = document.querySelectorAll('[data-testid="list-item"]');
        const found: string[] = [];
        for (const item of items) {
          let text = (item as HTMLElement).innerText || "";
          text = text.split("\n")[0].trim();
          text = text.replace(/\d{1,2}:\d{2}\s*(AM|PM).*/, "");
          text = text.replace(/ \(\d+\)$/, "");
          if (text) found.push(text);
        }
        return found;
      });

      for (const n of names) allNames.add(n);

      console.error(
        `[teams-list-chats] Scroll ${i+1}/${MAX_SCROLLS}: ` +
        `visible=${names.length} cumulative=${allNames.size}`
      );

      if (allNames.size >= MAX_ITEMS) {
        console.error(`[teams-list-chats] Reached target: ${allNames.size} items`);
        break;
      }

      if (names.length === prevCount) {
        staleRounds++;
        if (staleRounds >= 3) {
          console.error(`[teams-list-chats] No new items after ${staleRounds} scrolls. Stopping.`);
          break;
        }
      } else {
        staleRounds = 0;
      }
      prevCount = names.length;

      // Scroll all sizable scrollable containers
      await page.evaluate(() => {
        const allDivs = document.querySelectorAll('div');
        for (const div of allDivs) {
          const style = window.getComputedStyle(div);
          if (style.overflow === 'auto' || style.overflow === 'scroll' ||
              style.overflowY === 'auto' || style.overflowY === 'scroll') {
            const rect = div.getBoundingClientRect();
            if (rect.width > 100 && rect.height > 100 && div.scrollHeight > div.clientHeight + 10) {
              div.scrollTop += 800;
            }
          }
        }
      });
      await page.waitForTimeout(1_500);
    }

    const chats = Array.from(allNames);

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
