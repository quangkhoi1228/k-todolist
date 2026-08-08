/**
 * Debug Zalo DOM thật cho chat 1:1 — dump class + sender + msg id của từng wrapper.
 * Chạy: npx tsx scripts/debug-zalo-dom.ts
 * (CHẠY THẬT với Chrome profile .zalo-session — KHÔNG dùng headless chromium)
 */
import { createZaloStealthContext, navigateToZalo, DEFAULT_ZALO_CONFIG, log } from "../agents/pm/lib/zalo-automator";

const CHAT = process.env.CHAT_NAME || "Thảo Nguyên BB";

async function main() {
  const config = { ...DEFAULT_ZALO_CONFIG, headless: false, useRealChrome: true };
  const { browser, context } = await createZaloStealthContext(config);
  const page = context.pages()[0] || (await context.newPage());
  await page.setViewportSize({ width: 1280, height: 800 });

  try {
    await navigateToZalo(page, config);
    await page.waitForTimeout(4000);

    // Click chat 1:1 qua search
    const found = await page.evaluate((name: string) => {
      const items = document.querySelectorAll('[class*="conv-item"], [role="listitem"]');
      for (const item of items) {
        const titleEl = item.querySelector('[class*="conv-item-title__name"], [class*="name"], .truncate');
        const text = (titleEl?.textContent || item.textContent || "").trim();
        const firstLine = text.split("\n")[0].trim();
        if (firstLine.toLowerCase() === name.toLowerCase()) {
          (item as HTMLElement).click();
          return firstLine;
        }
      }
      return null;
    }, CHAT);
    console.log("Clicked:", found);
    if (!found) {
      const searchBox = page.locator('#contact-search-input, input[placeholder*="Tìm kiếm"]').first();
      await searchBox.fill(CHAT);
      await page.waitForTimeout(2500);
      const clicked = await page.evaluate((name: string) => {
        const items = document.querySelectorAll('[class*="conv-item"], [role="listitem"]');
        for (const item of items) {
          const titleEl = item.querySelector('[class*="conv-item-title__name"], [class*="name"], .truncate');
          const text = (titleEl?.textContent || item.textContent || "").trim();
          const firstLine = text.split("\n")[0].trim();
          if (firstLine.toLowerCase() === name.toLowerCase()) {
            (item as HTMLElement).click();
            return firstLine;
          }
        }
        return null;
      }, CHAT);
      console.log("Clicked after search:", clicked);
    }
    await page.waitForTimeout(5000);

    const dump = await page.evaluate(() => {
      const chatView = document.querySelector('#chatView, article.rel') ||
        document.querySelector('#messageViewContainer, .message-view__scroll, [class*="message-view"]');
      const chatArea = chatView
        ? (chatView.querySelector('#messageViewContainer') ||
           chatView.querySelector('.message-view__scroll, .message-view__scroll__inner') ||
           chatView.querySelector('[class*="message-view"]'))
        : (document.querySelector('#messageViewContainer') ||
           document.querySelector('.message-view__scroll, .message-view__scroll__inner') ||
           document.querySelector('[class*="message-view"]'));
      if (!chatArea) return { ok: false, reason: "no chatArea" };

      const possibleMsgs = Array.from(chatArea.querySelectorAll<HTMLElement>(
        '[class*="message-content-wrapper"], [class*="message-wrapper"], ' +
        '[class*="message-frame"], .text-message__container, ' +
        '[class*="chat-message"], [class*="ChatMessage"], [data-component="message-content-view"]'
      )).filter(el => {
        const cls = el.className || "";
        if (el.closest('.leftbar, .nav, [class*="sidebar"], [class*="contact-list"], ' +
              '#nav-container, .nav__tabs, [class*="conv-item"], [class*="conversation-list"], .conv-list')) return false;
        if (cls.includes('conv-item') || cls.includes('conversation-item') || cls.includes('z-conv-message') || cls.includes('preview')) return false;
        return true;
      });

      const wrapperSet = new Set<HTMLElement>();
      for (const el of possibleMsgs) {
        let parent = el.parentElement;
        let hasParentInSet = false;
        while (parent) {
          if (possibleMsgs.includes(parent as any)) { hasParentInSet = true; break; }
          parent = parent.parentElement;
        }
        if (!hasParentInSet) wrapperSet.add(el);
      }
      const wrappers = Array.from(wrapperSet);

      return {
        ok: true,
        count: wrappers.length,
        items: wrappers.slice(0, 30).map((el) => {
          const senderName = el.querySelector<HTMLElement>('.message-sender-name-content .truncate')?.innerText?.trim() || "";
          const item = el.closest<HTMLElement>('.chat-item');
          return {
            id: el.id || "",
            wrapperClass: (el.className || "").toString().slice(0, 120),
            itemClass: (item?.className || "").toString().slice(0, 120),
            hasMessageWrapperChild: !!el.querySelector('.message-wrapper'),
            childWrapperClass: el.querySelector('.message-wrapper')?.className?.toString().slice(0, 100) || "",
            senderName: senderName,
            hasSentReact: !!el.querySelector('[data-id="btn_SentMsg_React"], [data-id="div_SentMsg_Text"]'),
            hasRecvReact: !!el.querySelector('[data-id="btn_ReceivedMsg_React"]'),
            content: (el.textContent || "").replace(/\s+/g, " ").slice(0, 60),
          };
        }),
      };
    });

    if (!dump.ok) {
      console.log("FAILED:", dump.reason);
      await page.screenshot({ path: "zalo-debug-fail.png" });
    } else {
      console.log("TOTAL wrappers:", dump.count);
      for (const it of dump.items || []) {
        console.log("---");
        console.log("id:", it.id, "| senderName:", JSON.stringify(it.senderName));
        console.log("  wrapperClass:", it.wrapperClass);
        console.log("  itemClass:", it.itemClass);
        console.log("  childWrapperClass:", it.childWrapperClass);
        console.log("  sentReact:", it.hasSentReact, "recvReact:", it.hasRecvReact, "| content:", JSON.stringify(it.content));
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((e) => { console.error("ERR:", e); process.exit(1); });
