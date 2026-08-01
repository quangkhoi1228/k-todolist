import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../convex/_generated/api";
import { createStealthContext as createTeamsContext, waitForLogin as waitTeamsLogin, navigateToTeams, DEFAULT_CONFIG as DEFAULT_TEAMS_CONFIG } from "../lib/teams-automator";
import { createZaloStealthContext, waitForZaloLogin, DEFAULT_ZALO_CONFIG } from "../lib/zalo-automator";
import dotenv from "dotenv";
import path from "path";
import { Page } from "playwright";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!CONVEX_URL) {
  console.error("Missing NEXT_PUBLIC_CONVEX_URL");
  process.exit(1);
}

const client = new ConvexHttpClient(CONVEX_URL);
const USER_ID = process.env.USER_ID || "demo-user";

async function scrapeTeamsGroups(page: Page): Promise<{ name: string; url?: string }[]> {
  console.log("Scraping Teams groups...");
  
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
      
      const aTag = item.querySelector("a");
      const url = aTag?.href;
      
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

  console.log(`Found ${groups.length} Zalo groups.`);
  return groups;
}

async function run() {
  console.log("Starting Group Sync...");

  // --- TEAMS ---
  try {
    const headless = process.env.HEADLESS !== "false";
    const { browser: tBrowser, context: teamsCtx } = await createTeamsContext({ ...DEFAULT_TEAMS_CONFIG, headless });
    const tPage = teamsCtx.pages().length > 0 ? teamsCtx.pages()[0] : await teamsCtx.newPage();
    
    await tPage.goto("https://teams.microsoft.com/v2/", { waitUntil: "domcontentloaded" });
    await waitTeamsLogin(tPage, { ...DEFAULT_TEAMS_CONFIG, headless });
    await navigateToTeams(tPage, { ...DEFAULT_TEAMS_CONFIG, headless });
    
    const teamsGroups = await scrapeTeamsGroups(tPage);
    
    if (teamsGroups.length > 0) {
      await client.mutation(api.groups.syncGroups, {
        userId: USER_ID,
        platform: "teams",
        groups: teamsGroups,
      });
      console.log(`Saved ${teamsGroups.length} Teams groups to Convex.`);
    }
    
    await tBrowser.close();
  } catch (e) {
    console.error("Teams sync failed:", e);
  }

  // --- ZALO ---
  try {
    const { browser: zBrowser, context: zaloCtx } = await createZaloStealthContext({ ...DEFAULT_ZALO_CONFIG, headless: process.env.HEADLESS !== "false" });
    const zPage = zaloCtx.pages().length > 0 ? zaloCtx.pages()[0] : await zaloCtx.newPage();
    
    await zPage.goto("https://chat.zalo.me", { waitUntil: "domcontentloaded" });
    await waitForZaloLogin(zPage, { ...DEFAULT_ZALO_CONFIG, headless: process.env.HEADLESS !== "false" });
    
    const zaloGroups = await scrapeZaloGroups(zPage);
    
    if (zaloGroups.length > 0) {
      await client.mutation(api.groups.syncGroups, {
        userId: USER_ID,
        platform: "zalo",
        groups: zaloGroups,
      });
      console.log(`Saved ${zaloGroups.length} Zalo groups to Convex.`);
    }
    
    await zBrowser.close();
  } catch (e) {
    console.error("Zalo sync failed:", e);
  }

  console.log("Group Sync complete!");
  process.exit(0);
}

run();
