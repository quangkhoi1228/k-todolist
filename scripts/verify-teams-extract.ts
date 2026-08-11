/* Extract messages trực tiếp từ DOM (CDP 9222) không save — in thông tin
 * sender/isMine của 28 tin cuối để verify fix extract.
 * Chạy: npx tsx scripts/verify-teams-extract.ts
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { chromium } from "playwright";

async function main() {
  const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find(p => p.url().includes("teams.microsoft.com")) || ctx.pages()[0];
  if (!page) { console.error("No Teams page found"); process.exit(1); }

  // Scroll to bottom to load newest messages
  await page.evaluate(() => {
    const c = document.querySelector('[data-tid="message-pane-list-viewport"]') ||
      document.querySelector('[role="log"]') || document.documentElement;
    c.scrollTop = c.scrollHeight;
  });
  await page.waitForTimeout(2000);

  // Wait for messages to render (mimic extractMessages)
  await page.waitForSelector(
    '[data-tid="message-pane-list-viewport"], [data-testid="comfy-message-wrapper"], .fui-ChatMessage',
    { timeout: 20000 }
  ).catch(() => {});
  await page.waitForTimeout(2000);  // cho lazy-load thêm

  const data = await page.evaluate(() => {
    const rawWrappers = Array.from(document.querySelectorAll<HTMLElement>(
      '[data-testid="comfy-message-wrapper"], .fui-ChatMessage, .fui-ChatMyMessage, .fui-ChatMyMessage__body, [data-tid="chat-pane-message"]'
    ));
    const wrappers = rawWrappers.filter(el => !rawWrappers.some(o => o !== el && o.contains(el)));

    let lastSender = "";
    let lastSenderIsMine = false;

    const out = wrappers.map((el, idx) => {
      const isMine = el.classList.contains('fui-ChatMyMessage') ||
        el.classList.contains('fui-ChatMyMessage__body') ||
        el.closest('.fui-ChatMyMessage') !== null;
      const nameEl = el.querySelector<HTMLElement>('[data-tid="message-author-name"]');
      let sender = nameEl?.textContent?.trim() || "";

      if (!sender && lastSender) {
        if (lastSenderIsMine === isMine) {
          sender = lastSender;
        } else if (isMine) {
          sender = "Me";
        }
      } else if (sender) {
        lastSender = sender;
        lastSenderIsMine = isMine;
      }

      const timeEl = el.querySelector<HTMLTimeElement>("time");
      const ts = timeEl?.getAttribute("datetime") || "";
      const bodyEl = el.querySelector<HTMLElement>('[data-tid="message-body-content"], [data-tid="chat-pane-message"], .fui-ChatMessage__body, .fui-ChatMyMessage__body');
      const content = (bodyEl?.textContent || "").trim().replace(/\s{2,}/g, " ").slice(0, 80);
      return { idx, isMine, sender, hasNameEl: !!nameEl, ts: ts.slice(0, 16), content };
    });
    return { total: wrappers.length, out };
  });

  console.log(`Total: ${data.total}`);
  for (const m of data.out.slice(-30)) {
    console.log(`#${m.idx} mine=${m.isMine ? "Y" : "n"} name=${m.hasNameEl ? "Y" : "n"} sender="${m.sender}" ts=${m.ts} | "${m.content}"`);
  }

  await browser.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
