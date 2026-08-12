/**
 * Script to list available joined chats from Teams v2 sidebar.
 * Used by the PM Agent UI to provide an autocomplete dropdown.
 */

import { DEFAULT_CONFIG, createStealthContext, waitForLogin, navigateToTeams, applyStealthPatches, openTeamsTabInBackground } from "../lib/teams-automator";

async function main() {
  const config = {
    ...DEFAULT_CONFIG,
    headless: process.argv.includes("--headless"),
    useRealChrome: true, // Always real Chrome for v2
  };

  const { browser, context } = await createStealthContext(config);
  const isCdp = process.env.USE_CDP === "1" || process.env.USE_CDP === "true";
  // CDP mode: dùng tab Teams có sẵn (đã load) nếu có — tránh tích tụ tab heavy
  // Lưu ý: `isCdp` == false → fallback đã chuyển sang launchPersistentContext,
  // lúc đó context.pages()[0] là page của TEAMS (persistent), còn page Teams
  // CDP không tồn tại. Dùng page đầu tiên có sẵn (newPage chỉ dùng khi thật cần).
  let page = context.pages()[0];
  if (isCdp) {
    const teamsPage = context.pages().find((p) => p.url().includes("teams.microsoft.com"));
    page = teamsPage || (context.pages()[0] || await openTeamsTabInBackground(browser, context));
  } else {
    page = context.pages()[0] || await openTeamsTabInBackground(browser, context);
  }
  await applyStealthPatches(page);

  try {
    await navigateToTeams(page, config);

    const neededLogin = await waitForLogin(page, config);
    if (neededLogin) {
      await context.storageState({ path: config.sessionDir + "/state.json" });
    }

    // Expand sections — bao gồm cả các section chứa chat cá nhân (1:1)
    await page.evaluate(() => {
      const treeitems = document.querySelectorAll('[role="treeitem"]');
      for (const item of treeitems) {
        const text = item.textContent?.trim() || "";
        if (["Chats", "External", "Đợi chốt manday", "Favorites", "Gần đây", "Recent", "Yêu thích"].includes(text)) {
          (item as HTMLElement).click();
        }
      }
    });
    await page.waitForTimeout(3_000);

    // Scroll sidebar and collect names at each step (Teams uses virtual list — items recycle)
    // NOTE (CDP mode): mỗi page.evaluate qua CDP roundtrip trên Teams heavy rất chậm (~10s).
    // Gộp extract + scroll vào 1 evaluate để giảm roundtrip.
    const MAX_ITEMS = 200;
    const MAX_SCROLLS = 12;
    let allNames = new Set<string>();
    let prevCount = 0;
    let staleRounds = 0;

    for (let i = 0; i < MAX_SCROLLS; i++) {
      const result = await page.evaluate(() => {
        const items = document.querySelectorAll('[data-testid="list-item"]');
        const found: string[] = [];
        for (const item of items) {
          let text = (item as HTMLElement).innerText || "";
          text = text.split("\n")[0].trim();
          text = text.replace(/\d{1,2}:\d{2}\s*(AM|PM).*/, "");
          text = text.replace(/ \(\d+\)$/, "");
          // Skip UI-only labels that are not actual chats
          if (/^(Chats|Chat|External|Favorites|Gần đây|Recent|Yêu thích|Tin nhắn|Đợi chốt manday)$/i.test(text)) continue;
          if (text) found.push(text);
        }
        // Scroll all sizable scrollable containers (cùng lúc với extract)
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
        return found;
      });

      for (const n of result) allNames.add(n);

      console.error(
        `[teams-list-chats] Scroll ${i+1}/${MAX_SCROLLS}: ` +
        `visible=${result.length} cumulative=${allNames.size}`
      );

      if (allNames.size >= MAX_ITEMS) {
        console.error(`[teams-list-chats] Reached target: ${allNames.size} items`);
        break;
      }

      if (result.length === prevCount) {
        staleRounds++;
        if (staleRounds >= 3) {
          console.error(`[teams-list-chats] No new items after ${staleRounds} scrolls. Stopping.`);
          break;
        }
      } else {
        staleRounds = 0;
      }
      prevCount = result.length;

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
}).finally(() => {
  // CDP connection keeps the event loop alive — force-exit so the UI
  // doesn't wait forever on this child process.
  process.exit(0);
});
