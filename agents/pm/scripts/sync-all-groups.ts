import { createStealthContext as createTeamsContext, waitForLogin as waitTeamsLogin, navigateToTeams, DEFAULT_CONFIG as DEFAULT_TEAMS_CONFIG } from "../lib/teams-automator";
import { createZaloStealthContext, waitForZaloLogin, DEFAULT_ZALO_CONFIG } from "../lib/zalo-automator";
import dotenv from "dotenv";
import path from "path";
import { Page } from "playwright";
import { syncGroups } from "../../../src/lib/repo/groups";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const USER_ID = process.env.USER_ID || "demo-user";

async function scrapeTeamsGroups(page: Page): Promise<{ name: string; url?: string }[]> {
  console.log("Scraping Teams groups...");
  
  // Đợi sidebar render (New Teams load chậm — tối đa 30s)
  try {
    await page.waitForSelector('[data-testid="list-item"], [data-tid="app-bar-wrapper"], [role="treeitem"]', { timeout: 30_000 });
  } catch {
    console.log("WARN: sidebar selectors not found after 30s");
  }
  await page.waitForTimeout(3000);
  
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
  await page.waitForTimeout(3000);

  // We scroll a bit to load groups
  const sidebarSelector = '[data-tid="app-layout-area--mid-nav"], [data-testid="simple-collab-rail"], [role="tree"]';
  for (let i = 0; i < 10; i++) {
    await page.evaluate((sel: string) => {
      const sidebar = document.querySelector(sel)
        || document.querySelector('[data-tid="simple-collab-dnd-rail"]')
        || document.querySelector('[role="tree"]');
      if (sidebar) sidebar.scrollTop += 800;
    }, sidebarSelector);
    await page.waitForTimeout(1500);
  }

  const groups = await page.evaluate(() => {
    const items = document.querySelectorAll('[data-testid="list-item"]');
    const result: { name: string; url?: string }[] = [];
    
    for (const item of items) {
      let text = (item as HTMLElement).innerText || "";
      text = text.split("\n")[0].trim();
      text = text.replace(/\d{1,2}:\d{2}\s*(AM|PM).*/, "");
      text = text.replace(/ \(\d+\)$/, ""); // e.g. "Chat (2)"
      // Skip UI-only labels that are not actual chats (giống teams-list-chats)
      if (/^(Chats|Chat|External|Favorites|Gần đây|Recent|Yêu thích|Tin nhắn|Đợi chốt manday)$/i.test(text)) continue;
      
      const aTag = item.querySelector("a");
      let url: string | undefined = aTag?.href;
      // Only keep real Teams deep links (hash-based conversation URLs)
      if (url && !/^https:\/\/(teams\.microsoft\.com|teams\.live\.com)/i.test(url)) {
        url = undefined;
      }
      
      if (text) {
        if (!result.find(r => r.name === text)) {
          result.push({ name: text, url });
        }
      }
    }
    return result;
  });

  console.log(`Found ${groups.length} Teams groups.`);
  return groups;
}

async function scrapeZaloGroups(page: Page): Promise<{ name: string; url?: string }[]> {
  console.log("Scraping Zalo groups...");

  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('[class*="nav__tab"], [class*="tab"], button, a'));
    for (const tab of tabs) {
      const text = tab.textContent?.trim().toLowerCase() || "";
      if (text === "nhóm" || text === "group" || text === "groups") {
        (tab as HTMLElement).click();
        return;
      }
    }
    const groupIcon = document.querySelector('[data-translate-inner*="group"]');
    if (groupIcon) (groupIcon as HTMLElement).click();
  });
  await page.waitForTimeout(2000);

  for (let i = 0; i < 10; i++) {
    await page.evaluate(() => {
      const sidebar = document.querySelector(
        '#conversationListId, [data-id="conversations-list"], .conv-list, .chat-list'
      );
      if (sidebar) {
        (sidebar as HTMLElement).scrollTop += 500;
      }
    });
    await page.waitForTimeout(1500);
  }

  const groups = await page.evaluate(() => {
    const results = new Set<string>();

    const selectors = [
      '[class*="conv-item"]',
      '[class*="conversation-item"]',
      '[class*="conv_item"]',
      '[data-id] .truncate',
      '.chat-list li',
      '[class*="ChatItem"]',
      '[role="listitem"]'
    ];

    let allItems: Element[] = [];
    for (const sel of selectors) {
      const items = document.querySelectorAll(sel);
      if (items.length > 0) {
        allItems = Array.from(items);
        break;
      }
    }

    if (allItems.length === 0) {
      const sidebar = document.querySelector(
        '#conversationListId, [data-id="conversations-list"], .conv-list, [class*="ReactVirtualized__Grid"]'
      );
      if (sidebar) {
        allItems = Array.from(
          sidebar.querySelectorAll('[role="listitem"], [role="option"], li, [class*="item"]')
        );
      }
    }

    const resultArr: { name: string; url?: string }[] = [];
    for (const item of allItems) {
      const lines = (item.textContent || "").split("\n").map(l => l.trim()).filter(l => l.length > 0);
      let text = "";
      for (const line of lines) {
        if (/^\d+$/.test(line)) continue;
        if (/^(\d+\s+(phút|giờ|ngày|giây)|hôm qua|vài giây|\d{1,2}:\d{2}|\d{1,2}\/\d{1,2})/i.test(line)) continue;
        if (line.endsWith(":")) continue;
        text = line;
        break;
      }

      text = text.replace(/^(?:\d{1,2}:\d{2}|\d+\s+(?:phút|giờ|ngày).*?)\s+/, "");
      if (!text || text.length < 2) continue;
      if (/^(Tất cả|Cá nhân|Nhóm|All|Personal|Groups|Gần đây|Recently|Tin nhắn)$/i.test(text)) continue;

      if (!results.has(text)) {
        results.add(text);
        resultArr.push({ name: text });
      }
    }
    return resultArr;
  });

  // Zalo conversation items don't expose per-chat hrefs in the sidebar,
  // so click each group once and capture the hash URL from the SPA route.
  // (Best-effort: skipped if the first click doesn't change the URL.)
  const baseUrl = page.url();
  for (const g of groups) {
    try {
      const clicked = await page.evaluate((name: string) => {
        const items = document.querySelectorAll('[class*="conv-item"], [role="listitem"], [class*="conversation-item"]');
        for (const item of items) {
          const titleEl = item.querySelector('[class*="name"], [class*="title"], .truncate, strong');
          const text = titleEl ? titleEl.textContent?.trim() || "" : item.textContent?.trim() || "";
          if (text === name) {
            (item as HTMLElement).click();
            return true;
          }
        }
        return false;
      }, g.name);
      if (!clicked) continue;
      await page.waitForTimeout(1200);
      const url = page.url();
      if (url && url !== baseUrl && url.includes("#/")) {
        g.url = url;
      }
    } catch { /* keep going */ }
  }

  console.log(`Found ${groups.length} Zalo groups.`);
  return groups;
}

async function run() {
  console.log("Starting Group Sync...");
  const targetPlatform = (process.env.PLATFORM || "all") as "all" | "teams" | "zalo";

  // --- TEAMS ---
  if (targetPlatform === "all" || targetPlatform === "teams") {
    try {
      const headless = process.env.HEADLESS !== "false";
      const { browser: tBrowser, context: teamsCtx } = await createTeamsContext({ ...DEFAULT_TEAMS_CONFIG, headless });
      // CDP mode: dùng tab Teams có sẵn (đã load) nếu có — tránh tích tụ tab heavy
      let tPage = teamsCtx.pages()[0];
      if (process.env.USE_CDP === "1" || process.env.USE_CDP === "true") {
        const teamsPage = teamsCtx.pages().find((p) => p.url().includes("teams.microsoft.com"));
        tPage = teamsPage || await teamsCtx.newPage();
      }

      // Teams Classic (v2/) đã bị khai tử 01/07/2025 — goto thẳng "teams.microsoft.com"
      // để có redirect flow đúng (login check → app load). Goto thẳng v2/ → white screen.
      await tPage.goto("https://teams.microsoft.com", { waitUntil: "domcontentloaded", timeout: 60_000 });
      await waitTeamsLogin(tPage, { ...DEFAULT_TEAMS_CONFIG, headless });
      // Chờ app render (New Teams load chậm — up to ~20s)
      await tPage.waitForTimeout(12_000);
      
      const teamsGroups = await scrapeTeamsGroups(tPage);
      
      if (teamsGroups.length > 0) {
        await syncGroups({
          userId: USER_ID,
          platform: "teams",
          groups: teamsGroups,
        });
        console.log(`Saved ${teamsGroups.length} Teams groups to Postgres.`);
      }
      
      await tBrowser.close();
    } catch (e) {
      console.error("Teams sync failed:", e);
    }
  }

  // --- ZALO ---
  if (targetPlatform === "all" || targetPlatform === "zalo") {
    try {
      const { browser: zBrowser, context: zaloCtx } = await createZaloStealthContext({ ...DEFAULT_ZALO_CONFIG, headless: process.env.HEADLESS !== "false" });
      // CDP mode: dùng tab Zalo có sẵn (đã load) nếu có — tránh tích tụ tab heavy
      let zPage = zaloCtx.pages()[0];
      if (process.env.USE_CDP === "1" || process.env.USE_CDP === "true") {
        const zaloPg = zaloCtx.pages().find((p) => p.url().includes("zalo.me"));
        zPage = zaloPg || await zaloCtx.newPage();
      }
      
      await zPage.goto("https://chat.zalo.me", { waitUntil: "domcontentloaded" });
      await waitForZaloLogin(zPage, { ...DEFAULT_ZALO_CONFIG, headless: process.env.HEADLESS !== "false" });
      
      const zaloGroups = await scrapeZaloGroups(zPage);
      
      if (zaloGroups.length > 0) {
        await syncGroups({
          userId: USER_ID,
          platform: "zalo",
          groups: zaloGroups,
        });
        console.log(`Saved ${zaloGroups.length} Zalo groups to Postgres.`);
      }
      
      await zBrowser.close();
    } catch (e) {
      console.error("Zalo sync failed:", e);
    }
  }

  console.log("Group Sync complete!");
  process.exit(0);
}

run();
