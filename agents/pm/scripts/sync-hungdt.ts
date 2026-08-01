import { createStealthContext, waitForLogin, navigateToTeams, applyStealthPatches, scrollChatContainer, scrollChatToTop, extractMessages, DEFAULT_CONFIG } from "../lib/teams-automator";
import * as path from "path";
import * as fs from "fs";

async function extractChat(page: any, config: any, chatName: string): Promise<any[]> {
  console.log(`\n[Sync] Looking for chat: "${chatName}"...`);
  
  await page.evaluate(() => {
    const treeitems = document.querySelectorAll('[role="treeitem"]');
    for (const item of treeitems) {
      const text = item.textContent?.trim() || "";
      if (text.includes("Chats") || text.includes("External")) {
        (item as HTMLElement).click();
      }
    }
  });
  await page.waitForTimeout(3000);

  let found = false;
  for (let i = 0; i < 10; i++) {
    const clicked = await page.evaluate((name: string) => {
      const items = document.querySelectorAll('[data-testid="list-item"]');
      for (const item of items) {
        const text = item.textContent?.trim() || "";
        if (text.includes(name)) {
          (item as HTMLElement).click();
          return text.slice(0, 100);
        }
      }
      return null;
    }, chatName);

    if (clicked) {
      console.log(`[Sync] Clicked: "${clicked}"`);
      found = true;
      break;
    }

    await page.evaluate(() => {
      const sb = document.querySelector('[data-tid="app-layout-area--mid-nav"]') || document.querySelector('[role="tree"]');
      if (sb) sb.scrollTop += 400;
    });
    await page.waitForTimeout(1500);
  }

  if (!found) {
    console.log(`[Sync] Could not find chat "${chatName}"`);
    return [];
  }

  await page.waitForTimeout(5000);
  console.log(`[Sync] Running extraction for "${chatName}"...`);

  // PASS 1: Extract at BOTTOM first (newest messages + their images)
  await page.evaluate(() => {
    const c = document.querySelector('[data-tid="message-pane-list-viewport"]') ||
      document.querySelector('[role="log"]') || document.documentElement;
    c.scrollTop = c.scrollHeight;
  });
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    document.querySelectorAll<HTMLImageElement>('img').forEach(img => {
      img.scrollIntoView({ block: "center", inline: "nearest" });
    });
  });
  await page.waitForTimeout(5000);
  const bottomResult = await extractMessages(page, { ...config }, false);
  console.log(`[Sync] Bottom-pass: ${bottomResult.totalMessages} msgs, ${bottomResult.messages.filter(m => m.images?.length).length} with images.`);

  // PASS 2: Scroll up loading history, extract at TOP
  await scrollChatContainer(page, config, true);
  const topResult = await extractMessages(page, { ...config }, true);
  console.log(`[Sync] Top-pass: ${topResult.totalMessages} msgs, ${topResult.messages.filter(m => m.images?.length).length} with images.`);

  // Merge: collect ALL messages, deduplicate, prefer entry WITH images
  const nonEmoji = (urls: string[]) => urls.filter(i => !i.includes('evergreen') && !i.includes('emoticon') && !i.includes('personal-expressions') && !i.startsWith('blob:'));
  const keyToMessage = new Map<string, any>();

  function insertMessage(msg: any) {
    const key = `${msg.sender}|${msg.timestampMs}|${(msg.content || '').slice(0, 30)}`;
    const existing = keyToMessage.get(key);
    if (!existing) {
      keyToMessage.set(key, msg);
    } else if (msg.images?.length && !existing.images?.length) {
      keyToMessage.set(key, msg);
    } else if (msg.images?.length && existing.images?.length) {
      const merged = [...new Set([...(existing.images || []), ...(msg.images || [])])];
      keyToMessage.set(key, { ...existing, images: merged });
    }
  }

  for (const msg of bottomResult.messages) {
    insertMessage({
      sender: msg.sender,
      senderAvatar: (msg as any).senderAvatar || undefined,
      content: msg.content,
      images: (msg as any).images?.length ? nonEmoji((msg as any).images) : undefined,
      timestamp: msg.timestamp,
    });
  }
  for (const msg of topResult.messages) {
    insertMessage({
      sender: msg.sender,
      senderAvatar: (msg as any).senderAvatar || undefined,
      content: msg.content,
      images: (msg as any).images?.length ? nonEmoji((msg as any).images) : undefined,
      timestamp: msg.timestamp,
    });
  }

  return Array.from(keyToMessage.values()).filter(m => m.content || m.images?.length);
}

async function main() {
  const config = {
    ...DEFAULT_CONFIG,
    headless: false,
    useRealChrome: true,
    scrollCount: 60,  // more scrolls to reach older messages
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

    // Extract from UICVN x FCI chat
    const uicvnMessages = await extractChat(page, config, "UICVN");
    
    // Extract from external chat (DOMESCO)
    const domescolMessages = await extractChat(page, config, "DOMESCO");

    const allMessages = [...uicvnMessages, ...domescolMessages];

    // Show results
    console.log(`\n============= RESULTS =============`);
    console.log(`Total merged: ${allMessages.length}`);
    
    const hungDtMessages = allMessages.filter(m => m.sender.includes("Hung"));
    console.log(`HungDT messages: ${hungDtMessages.length}`);
    
    for (const msg of hungDtMessages) {
      console.log(`\n--- ${msg.sender} @ ${msg.timestamp} ---`);
      console.log(`  Content: ${(msg.content || '').slice(0, 120)}`);
      const imgs = msg.images || [];
      console.log(`  Images: ${imgs.length}`);
      for (let i = 0; i < imgs.length; i++) {
        const imgVal = imgs[i];
        const prefix = imgVal.startsWith('data:') ? 'data:image (base64)' : imgVal.slice(0, 150);
        console.log(`    [${i+1}] ${prefix}`);
      }
    }

    // Also find ALL messages with images
    console.log(`\n--- All messages with images ---`);
    for (const msg of allMessages) {
      const imgs = msg.images || [];
      if (imgs.length > 0) {
        console.log(`  ${msg.sender}: ${imgs.length} images, "${(msg.content || '').slice(0, 60)}"`);
      }
    }

    // Save to file
    const outputPath = path.join(process.cwd(), "hungdt-extract.json");
    fs.writeFileSync(outputPath, JSON.stringify({ 
      extractedAt: new Date().toISOString(),
      hungDtMessages,
      allMessagesWithImages: allMessages.filter(m => (m.images||[]).length > 0),
      allMessages
    }, null, 2), "utf-8");
    console.log(`\nSaved to ${outputPath}`);

    await browser.close().catch(() => {});
  } catch (err) {
    console.error("Fatal error:", err);
    await browser.close().catch(() => {});
  }
}

main().catch(console.error);
