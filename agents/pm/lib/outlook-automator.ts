/**
 * Outlook Web Automator
 *
 * Uses Playwright with stealth anti-detection to automate Outlook Web (outlook.office.com):
 * - Reuses Teams browser session (same Microsoft account)
 * - Compose and send emails with rich text (HTML) body
 * - Attach files from local filesystem
 * - Health check for session validity
 *
 * This module reuses the browser session & stealth patches from teams-automator.ts.
 * It is meant to be used from:
 *   a) CLI via `npx tsx agents/pm/scripts/outlook-send.ts`
 *   b) API route via child_process.spawn
 *
 * Outlook Web selectors are based on the new Outlook Web (outlook.office.com) interface.
 */

import type { Page, BrowserContext, Browser } from "playwright";
import * as fs from "fs";
import * as path from "path";
import {
  createStealthContext,
  applyStealthPatches,
  fitWindowToScreen,
  log as teamsLog,
  type AutomatorConfig,
  DEFAULT_CONFIG,
} from "./teams-automator";

export { applyStealthPatches };

// ─── Config ─────────────────────────────────────────────────

export interface OutlookConfig {
  /** Directory to persist browser session (reuses Teams session) */
  sessionDir: string;
  /** Screenshot directory */
  screenshotDir: string;
  /** Timeout for Outlook to load (ms) */
  loadTimeoutMs: number;
  /** Whether to run headless */
  headless: boolean;
  /** Use real Chrome */
  useRealChrome: boolean;
  /** Keep browser open after send */
  keepOpen: boolean;
  /** Dry run — compose but don't click send */
  dryRun: boolean;
}

export const DEFAULT_OUTLOOK_CONFIG: OutlookConfig = {
  sessionDir: path.join(process.cwd(), ".teams-session"),
  screenshotDir: path.join(process.cwd(), "teams-screenshots"),
  loadTimeoutMs: 30_000,
  headless: false,
  useRealChrome: true,
  keepOpen: false,
  dryRun: false,
};

// ─── Types ──────────────────────────────────────────────────

export interface OutlookEmailPayload {
  /** List of recipient email addresses */
  to: string[];
  /** CC recipients */
  cc?: string[];
  /** BCC recipients */
  bcc?: string[];
  /** Email subject */
  subject: string;
  /** Email body as HTML string */
  body: string;
  /** Absolute paths to files to attach */
  attachments?: string[];
  /** Email importance */
  importance?: "low" | "normal" | "high";
}

export interface OutlookSendResult {
  ok: boolean;
  error?: string;
  /** Screenshot path if taken */
  screenshotPath?: string;
  /** Timestamp when email was sent */
  sentAt?: string;
}

// ─── Logging ────────────────────────────────────────────────

export function log(msg: string, data?: unknown) {
  const prefix = `[OutlookAuto] ${new Date().toISOString().slice(11, 19)}`;
  if (data) {
    console.log(
      `${prefix}  ${msg}`,
      typeof data === "string" ? data : JSON.stringify(data).slice(0, 200)
    );
  } else {
    console.log(`${prefix}  ${msg}`);
  }
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Human-like typing delay */
async function humanDelay(page: Page, minMs = 300, maxMs = 800) {
  await page.waitForTimeout(randomInt(minMs, maxMs));
}

// ─── Browser Helpers ────────────────────────────────────────

// Lưu ý: cleanupChromeLocks + killStaleChromeProcesses đã bị xoá — chúng kill
// MỌI Chrome dùng `.teams-session/chrome-profile` (kể cả Chrome thật đang mở)
// và xoá SingletonLock ngay cả khi pid trong lock còn sống → làm mất login
// Teams/Outlook. createStealthContext (teams-automator.ts) đã tự xử lý an toàn:
// CDP connect hoặc chỉ kill orphan ppid=1 + --remote-debugging-pipe.

/**
 * Create a stealth browser context reusing the Teams session.
 * Wraps createStealthContext from teams-automator with Outlook-specific config.
 */
export async function createOutlookContext(config: OutlookConfig): Promise<{
  browser: Browser;
  context: BrowserContext;
}> {
  // KHÔNG gọi killStaleChromeProcesses/cleanupChromeLocks ở đây nữa.
  // Hai hàm đó kill MỌI Chrome dùng `.teams-session/chrome-profile` (kể cả
  // Chrome thật user đang mở) → làm mất login Teams/Outlook.
  // createStealthContext bên dưới đã tự xử lý an toàn:
  //   - CDP mode: connect vào Chrome thật đang mở (USE_CDP=1) — KHÔNG đóng
  //   - Persistent profile: chỉ kill Chrome orphan (ppid=1, --remote-debugging-pipe)
  //     + chỉ xoá stale SingletonLock khi pid trong lock đã chết — không bao giờ
  //     đụng Chrome live của script/user khác.
  const automatorConfig: AutomatorConfig = {
    ...DEFAULT_CONFIG,
    sessionDir: config.sessionDir,
    screenshotDir: config.screenshotDir,
    headless: config.headless,
    useRealChrome: config.useRealChrome,
  };

  return createStealthContext(automatorConfig);
}

// ─── Outlook Navigation ────────────────────────────────────

/**
 * Navigate to Outlook Web mail.
 */
export async function navigateToOutlook(page: Page): Promise<void> {
  log("Dang mo Outlook Web...");
  await page.goto("https://outlook.office.com/mail/", {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.waitForTimeout(5_000);
  log(`URL: ${page.url()}`);
}

/**
 * Wait for Outlook to be fully loaded and ready.
 * Checks for inbox elements and mail compose button.
 */
export async function waitForOutlookReady(
  page: Page,
  config: OutlookConfig
): Promise<boolean> {
  log("Dang doi Outlook load...");

  try {
    // Wait for the main mail interface to appear
    // New Outlook Web uses various selectors for the mail list and compose button
    await page.waitForSelector(
      [
        '[data-testid="compose-new-mail-button"]',       // New mail button
        'button[aria-label="New mail"]',                   // New mail button (alt)
        'button[aria-label="Thư mới"]',                   // Vietnamese locale
        '[data-testid="MailList"]',                        // Mail list
        '[role="main"]',                                   // Main content area
      ].join(", "),
      { timeout: config.loadTimeoutMs }
    );
    log("Outlook da load xong.");
    return true;
  } catch {
    log("Không thể load Outlook. Có thể cần đăng nhập lại.");

    // Take debug screenshot
    const screenshotPath = path.join(
      config.screenshotDir,
      `outlook-debug-${Date.now()}.png`
    );
    await page.screenshot({ path: screenshotPath });
    log(`Da chup screenshot debug: ${screenshotPath}`);

    return false;
  }
}

// ─── Email Compose ──────────────────────────────────────────

/**
 * Click the "New mail" button to open compose panel.
 */
async function clickNewMail(page: Page): Promise<boolean> {
  log("Dang click nut 'New mail'...");

  const selectors = [
    '[data-testid="compose-new-mail-button"]',
    'button[aria-label="New"]',
    'button[data-automation-type="RibbonSplitButton"][aria-label="New"]',
    'button[aria-label="New mail"]',
    'button[aria-label*="New mail" i]',
    'button[aria-label*="New message" i]',
    'button[aria-label="Thư mới"]',
    'button[title="New mail"]',
    'button[title*="New message" i]',
    'button[title="Thư mới"]',
    'button[name="New"]',
    'button:has-text("New mail")',
    'button:has-text("New message")',
    // Fallback: any button with mail compose icon
    'button:has([data-icon-name="Compose"])',
    'button:has([data-icon-name="Edit"])',
  ];

  for (const sel of selectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 3_000 })) {
        await btn.click();
        log(`Da click: ${sel}`);
        await humanDelay(page, 1000, 2000);
        return true;
      }
    } catch {
      // Try next selector
    }
  }

  // Fallback: try keyboard shortcut ('n' or 'c' in Outlook Web)
  log("Khong tim thay nut New mail, thu shortcut 'n'...");
  await page.keyboard.press("n");
  await humanDelay(page, 1000, 2000);
  
  // If 'n' doesn't work, some layouts use 'c' for Compose
  const toInputVisible = await page.locator('[aria-label="To"], input[aria-label="To line"], [aria-label*="To" i]').first().isVisible({ timeout: 2000 }).catch(() => false);
  if (!toInputVisible) {
    log("Thu shortcut 'c'...");
    await page.keyboard.press("c");
    await humanDelay(page, 1000, 2000);
  }

  return true;
}

/**
 * Fill in the To field with email addresses.
 * Outlook Web uses a pill-style input where you type and press Enter/Tab.
 */
async function fillRecipients(
  page: Page,
  fieldLabel: string,
  emails: string[]
): Promise<void> {
  if (!emails || emails.length === 0) return;

  log(`Dang dien ${fieldLabel}: ${emails.join(", ")}`);

  // Map field labels to selectors
  const fieldSelectors: Record<string, string[]> = {
    To: [
      '[aria-label="To"]',
      'input[aria-label="To"]',
      'input[aria-label*="To line" i]',
      'input[aria-label*="To " i]',
      '[aria-label="To line"]',
      '[aria-label*="To " i]',
      '[data-testid="pill-well-input"][aria-label="To"]',
      'div[aria-label="To"] input',
      '#toRecipients input',
      '[aria-label="Đến"]',
      'input[aria-label="Đến"]',
      '[aria-label="Tới"]',
      'input[aria-label="Tới"]',
      '[aria-label="Tới dòng"]',
      'input[aria-label="Tới dòng"]',
      '[data-testid="pill-well-input"][aria-label="Đến"]',
      '[data-testid="pill-well-input"][aria-label="Tới"]'
    ],
    CC: [
      '[aria-label="Cc"]',
      'input[aria-label="Cc"]',
      '[data-testid="pill-well-input"][aria-label="Cc"]',
      'div[aria-label="Cc"] input',
      '[aria-label="Bản sao"]',
      'input[aria-label="Bản sao"]',
      '[aria-label="Cc dòng"]',
      'input[aria-label="Cc dòng"]'
    ],
    BCC: [
      '[aria-label="Bcc"]',
      'input[aria-label="Bcc"]',
      '[data-testid="pill-well-input"][aria-label="Bcc"]',
      'div[aria-label="Bcc"] input',
      '[aria-label="Bản sao ẩn"]',
      'input[aria-label="Bản sao ẩn"]',
      '[aria-label="Bcc dòng"]',
      'input[aria-label="Bcc dòng"]'
    ],
  };

  // For CC/BCC, need to expand the field first
  if (fieldLabel === "CC" || fieldLabel === "BCC") {
    const expandSelectors = [
      `button[aria-label="${fieldLabel === "CC" ? "Show Cc" : "Show Bcc"}"]`,
      `button[aria-label="${fieldLabel === "CC" ? "Hiện Cc" : "Hiện Bcc"}"]`,
      `button[aria-label="${fieldLabel === "CC" ? "Hiển thị Cc" : "Hiển thị Bcc"}"]`,
      `button[aria-label="${fieldLabel === "CC" ? "Bản sao" : "Bản sao ẩn"}"]`,
      '[data-testid="cc-bcc-button"]',
    ];
    for (const sel of expandSelectors) {
      try {
        const expandBtn = page.locator(sel).first();
        if (await expandBtn.isVisible({ timeout: 2_000 })) {
          await expandBtn.click();
          await humanDelay(page, 500, 1000);
          break;
        }
      } catch {
        // Try next
      }
    }
  }

  const selectors = fieldSelectors[fieldLabel] || fieldSelectors["To"];

  for (const sel of selectors) {
    try {
      const input = page.locator(sel).first();
      if (await input.isVisible({ timeout: 3_000 })) {
        for (const email of emails) {
          await input.click();
          await humanDelay(page, 200, 400);
          await input.fill(email);
          await humanDelay(page, 300, 600);
          // Press Enter to confirm the email pill
          await page.keyboard.press("Enter");
          await humanDelay(page, 500, 1000);
        }
        log(`Da dien ${fieldLabel} thanh cong.`);
        return;
      }
    } catch {
      // Try next selector
    }
  }

  log(`Không thể điền ${fieldLabel}. Thử fallback...`);
}

/**
 * Fill in the Subject field.
 */
async function fillSubject(page: Page, subject: string): Promise<void> {
  log(`Dang dien Subject: ${subject}`);

  const selectors = [
    'input[aria-label="Add a subject"]',
    'input[aria-label="Thêm chủ đề"]',
    'input[placeholder="Add a subject"]',
    'input[placeholder="Thêm chủ đề"]',
    'input[aria-label*="subject" i]',
    '[data-testid="subject-input"]',
    '#subjectLine input',
    'input[id*="subject"]',
  ];

  for (const sel of selectors) {
    try {
      const input = page.locator(sel).first();
      if (await input.isVisible({ timeout: 3_000 })) {
        await input.click();
        await humanDelay(page, 200, 400);
        await input.fill(subject);
        await humanDelay(page, 300, 500);
        log("Da dien Subject thanh cong.");
        return;
      }
    } catch {
      // Try next selector
    }
  }

  log("Không thể điền Subject.");
}

/**
 * Fill in the email body with HTML content.
 * Outlook Web uses a contenteditable div for the body.
 */
async function fillBody(page: Page, htmlBody: string): Promise<void> {
  log("Dang dien body email...");

  const selectors = [
    'div[aria-label="Message body, press Alt+F10 to exit"]',
    'div[aria-label*="Message body" i]',
    'div[aria-label="Nội dung thư, nhấn Alt+F10 để thoát"]',
    '[data-testid="editorParent"] [contenteditable="true"]',
    'div[role="textbox"][contenteditable="true"]',
    'div[aria-multiline="true"][contenteditable="true"]',
    '.dFCbN [contenteditable="true"]', // Outlook-specific class
  ];

  for (const sel of selectors) {
    try {
      const editor = page.locator(sel).first();
      if (await editor.isVisible({ timeout: 3_000 })) {
        await editor.click();
        await humanDelay(page, 200, 400);

        // Use evaluate to inject HTML directly into the contenteditable div.
        // Preserve existing content (e.g. signature) by prepending the body before it.
        await editor.evaluate((el: HTMLElement, html: string) => {
          const existingContent = el.innerHTML;
          // Only preserve existing content if it looks like a signature
          // (has more than just whitespace/br and isn't already our body)
          const hasSignature =
            existingContent.trim() &&
            existingContent.replace(/<br>/gi, "").trim().length > 0 &&
            !existingContent.includes(html.trim());
          if (hasSignature) {
            el.innerHTML = html + "<br><br>" + existingContent;
          } else {
            el.innerHTML = html;
          }
          // Dispatch input event so Outlook registers the change
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }, htmlBody);

        await humanDelay(page, 300, 500);
        log("Da dien body thanh cong.");
        return;
      }
    } catch {
      // Try next selector
    }
  }

  // Fallback: use keyboard to type plain text
  log("Khong tim thay rich text editor, thu type text...");
  const plainText = htmlBody.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  await page.keyboard.type(plainText, { delay: 20 });
}

/**
 * Set email importance (high/low).
 * Outlook Web has an importance toggle in the toolbar.
 */
async function setImportance(
  page: Page,
  importance: "low" | "normal" | "high"
): Promise<void> {
  if (importance === "normal") return;

  log(`Dang set importance: ${importance}`);

  // Open the more options menu (⋯) to find importance
  const moreOptionsSelectors = [
    'button[aria-label="More options"]',
    'button[aria-label="Tùy chọn khác"]',
    '[data-testid="more-options-button"]',
  ];

  for (const sel of moreOptionsSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 2_000 })) {
        await btn.click();
        await humanDelay(page, 500, 1000);

        // Look for Set importance option
        const importanceLabel = importance === "high" ? "High importance" : "Low importance";
        const importanceLabelVi = importance === "high" ? "Mức quan trọng cao" : "Mức quan trọng thấp";

        const importanceSelectors = [
          `[role="menuitem"]:has-text("${importanceLabel}")`,
          `[role="menuitem"]:has-text("${importanceLabelVi}")`,
          `button:has-text("${importanceLabel}")`,
        ];

        for (const impSel of importanceSelectors) {
          try {
            const impBtn = page.locator(impSel).first();
            if (await impBtn.isVisible({ timeout: 2_000 })) {
              await impBtn.click();
              log(`Da set importance: ${importance}`);
              await humanDelay(page, 300, 500);
              return;
            }
          } catch {
            // Try next
          }
        }
        break;
      }
    } catch {
      // Try next
    }
  }

  log(`Không thể set importance ${importance}.`);
}

/**
 * Add file attachments to the email.
 * Uses the Attach button and file input dialog.
 */
export async function addAttachments(
  page: Page,
  filePaths: string[]
): Promise<void> {
  if (!filePaths || filePaths.length === 0) return;

  log(`Dang dinh kem ${filePaths.length} file...`);

  // Validate files exist
  const validFiles = filePaths.filter((f) => {
    if (fs.existsSync(f)) return true;
    log(`File khong ton tai: ${f}`);
    return false;
  });

  if (validFiles.length === 0) {
    log("Khong co file hop le de dinh kem.");
    return;
  }

  // Click the Attach button
  const attachSelectors = [
    'button[aria-label="Attach"]',
    'button[aria-label="Đính kèm"]',
    '[data-testid="attach-button"]',
    'button:has([data-icon-name="Attach"])',
    'button[title="Attach"]',
    'button[title="Đính kèm"]',
  ];

  let attachClicked = false;
  for (const sel of attachSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 3_000 })) {
        await btn.click();
        await humanDelay(page, 500, 1000);
        attachClicked = true;
        break;
      }
    } catch {
      // Try next
    }
  }

  if (!attachClicked) {
    log("Khong tim thay nut Attach.");
    return;
  }

  // Look for "Browse this computer" option
  const browseSelectors = [
    'button:has-text("Browse this computer")',
    'button:has-text("Duyệt máy tính này")',
    '[role="menuitem"]:has-text("Browse this computer")',
    '[role="menuitem"]:has-text("computer")',
  ];

  for (const sel of browseSelectors) {
    try {
      const browseBtn = page.locator(sel).first();
      if (await browseBtn.isVisible({ timeout: 3_000 })) {
        // Set up file chooser handler before clicking
        const [fileChooser] = await Promise.all([
          page.waitForEvent("filechooser", { timeout: 10_000 }),
          browseBtn.click(),
        ]);

        // Set files
        await fileChooser.setFiles(validFiles);
        log(`Da dinh kem ${validFiles.length} file.`);

        // Wait for upload
        await page.waitForTimeout(3_000);

        // Verify attachments appeared
        log("Dang doi upload hoan tat...");
        await page.waitForTimeout(2_000);
        return;
      }
    } catch {
      // Try next
    }
  }

  // Alternative: intercept file input directly
  log("Thu dinh kem qua file input truc tiep...");
  try {
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(validFiles);
    log(`Da dinh kem ${validFiles.length} file qua input.`);
    await page.waitForTimeout(3_000);
  } catch (e) {
    log(`Không thể đính kèm file: ${e}`);
  }
}

/**
 * Click the Send button.
 */
async function clickSend(page: Page): Promise<boolean> {
  log("Dang click nut Send...");

  const selectors = [
    'button[aria-label="Send"]',
    'button[aria-label="Gửi"]',
    '[data-testid="send-button"]',
    'button[title="Send (Ctrl+Enter)"]',
    'button[title="Gửi (Ctrl+Enter)"]',
    'button:has-text("Send")',
  ];

  for (const sel of selectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 3_000 })) {
        await btn.click();
        log("Da click Send.");
        await page.waitForTimeout(3_000);
        return true;
      }
    } catch {
      // Try next
    }
  }

  // Fallback: Ctrl+Enter
  log("Khong tim thay nut Send, thu Ctrl+Enter...");
  await page.keyboard.press("Control+Enter");
  await page.waitForTimeout(3_000);
  return true;
}

// ─── Full Flow ──────────────────────────────────────────────

/**
 * Compose and send a new email via Outlook Web.
 *
 * Full automation flow:
 * 1. Create stealth browser (reuse Teams session)
 * 2. Navigate to Outlook Web
 * 3. Wait for Outlook to load
 * 4. Click New Mail
 * 5. Fill To, CC, BCC
 * 6. Fill Subject
 * 7. Fill Body (HTML)
 * 8. Add attachments
 * 9. Set importance
 * 10. Click Send
 */
export async function composeAndSendEmail(
  payload: OutlookEmailPayload,
  config: OutlookConfig = DEFAULT_OUTLOOK_CONFIG
): Promise<OutlookSendResult> {
  ensureDir(config.screenshotDir);

  const { browser, context } = await createOutlookContext(config);
  const page = context.pages()[0] || (await context.newPage());
  await applyStealthPatches(page);
  if (!config.headless) await fitWindowToScreen(page).catch(() => {});

  try {
    // Step 1: Navigate to Outlook
    await navigateToOutlook(page);

    // Step 2: Wait for Outlook to be ready
    const isReady = await waitForOutlookReady(page, config);
    if (!isReady) {
      const screenshotPath = path.join(
        config.screenshotDir,
        `outlook-not-ready-${Date.now()}.png`
      );
      await page.screenshot({ path: screenshotPath });
      return {
        ok: false,
        error: "Outlook Web khong load duoc. Co the session da het han.",
        screenshotPath,
      };
    }

    // Step 3: Click New Mail
    await clickNewMail(page);

    // Step 4: Fill recipients
    await fillRecipients(page, "To", payload.to);
    if (payload.cc && payload.cc.length > 0) {
      await fillRecipients(page, "CC", payload.cc);
    }
    if (payload.bcc && payload.bcc.length > 0) {
      await fillRecipients(page, "BCC", payload.bcc);
    }

    // Step 5: Fill subject
    await fillSubject(page, payload.subject);

    // Step 6: Fill body
    await fillBody(page, payload.body);

    // Step 7: Add attachments
    if (payload.attachments && payload.attachments.length > 0) {
      await addAttachments(page, payload.attachments);
    }

    // Step 8: Set importance
    if (payload.importance && payload.importance !== "normal") {
      await setImportance(page, payload.importance);
    }

    // Step 9: Take screenshot before sending
    const screenshotPath = path.join(
      config.screenshotDir,
      `outlook-compose-${Date.now()}.png`
    );
    await page.screenshot({ path: screenshotPath });
    log(`Screenshot truoc khi gui: ${screenshotPath}`);

    // Step 10: Send (or skip in dry run)
    if (config.dryRun) {
      log("DRY RUN — Khong gui email, chi compose.");
      return {
        ok: true,
        screenshotPath,
        sentAt: new Date().toISOString(),
      };
    }

    const sent = await clickSend(page);
    if (!sent) {
      return {
        ok: false,
        error: "Không thể click nút Send.",
        screenshotPath,
      };
    }

    log("Da click Send, dang doi email gui di (co the mat den 30s neu co delay send)...");
    
    // Wait for the "Sending... Undo" banner to appear and then disappear.
    // Or wait up to 35 seconds to ensure any delay-send has completed.
    try {
      // First wait up to 3 seconds for the alert to appear (it might not appear instantly)
      const alertLocator = page.locator('[role="alert"]:has-text("Undo")');
      await alertLocator.waitFor({ state: "visible", timeout: 3000 });
      log("Phat hien tinh nang Delay Send (Undo banner). Dang doi banner bien mat...");
      // Wait for it to disappear (max 35 seconds)
      await alertLocator.waitFor({ state: "hidden", timeout: 35000 });
      log("Banner Undo da bien mat, email da thuc su duoc gui!");
    } catch {
      // If it doesn't appear, or times out, we wait a fixed 5s to be safe
      log("Khong thay Undo banner hoac da timeout, cho 5s...");
      await page.waitForTimeout(5000);
    }

    // Check for any error dialogs
    const hasError = await page.evaluate(() => {
      const errorBanners = Array.from(document.querySelectorAll('[role="alert"]'));
      for (const banner of errorBanners) {
        const text = banner.textContent?.trim() || "";
        // Ignore success/informational toasts
        if (text && !text.toLowerCase().includes("sending") && !text.toLowerCase().includes("undo") && !text.toLowerCase().includes("sent")) {
          return text;
        }
      }
      return null;
    });

    if (hasError) {
      log(`Loi khi gui email: ${hasError}`);
      return {
        ok: false,
        error: hasError,
        screenshotPath,
      };
    }

    log("Email da gui thanh cong!");
    return {
      ok: true,
      screenshotPath,
      sentAt: new Date().toISOString(),
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log(`Loi: ${errorMsg}`);

    // Take error screenshot
    const screenshotPath = path.join(
      config.screenshotDir,
      `outlook-error-${Date.now()}.png`
    );
    await page.screenshot({ path: screenshotPath }).catch(() => {});

    return {
      ok: false,
      error: errorMsg,
      screenshotPath,
    };
  } finally {
    // CDP mode: Chrome thật đã giữ session tự nhiên — KHÔNG gọi storageState
    // (qua CDP có thể kẹt khi Chrome đang bận) và KHÔNG close (Proxy đã chặn,
    // nhưng gọi đôi khi vẫn làm chậm exit). Persistent profile mới cần lưu state.
    const isCdp = process.env.SYNC_CDP_CONNECTED === "1";
    if (!isCdp) {
      await context
        .storageState({
          path: path.join(config.sessionDir, "state.json"),
        })
        .catch(() => {});
    }

    if (!config.headless && config.keepOpen) {
      log("Giu browser mo.");
      await new Promise(() => {});
    }
    if (!config.headless && !config.keepOpen && !isCdp) {
      log("Browser se dong sau 3s...");
      await page.waitForTimeout(3_000);
    }
    await browser.close().catch(() => {});
    log(isCdp ? "CDP mode: giu Chrome that mo." : "Browser da dong.");
  }
}

/**
 * Health check: verify Outlook session is valid.
 * Opens Outlook Web and checks if it loads without needing login.
 */
export async function outlookHealthCheck(
  config: OutlookConfig = DEFAULT_OUTLOOK_CONFIG
): Promise<{ ok: boolean; error?: string }> {
  const { browser, context } = await createOutlookContext(config);
  const page = context.pages()[0] || (await context.newPage());
  await applyStealthPatches(page);

  try {
    await navigateToOutlook(page);
    const isReady = await waitForOutlookReady(page, config);

    if (isReady) {
      log("Outlook session hop le.");
      return { ok: true };
    }

    // Check if we're on a login page
    const url = page.url();
    if (url.includes("login.microsoftonline.com") || url.includes("login.live.com")) {
      return { ok: false, error: "Session da het han, can dang nhap lai." };
    }

    return { ok: false, error: "Outlook khong load duoc." };
  } finally {
    const isCdp = process.env.SYNC_CDP_CONNECTED === "1";
    if (!isCdp) {
      await context
        .storageState({
          path: path.join(config.sessionDir, "state.json"),
        })
        .catch(() => {});
    }
    await browser.close().catch(() => {});
  }
}
