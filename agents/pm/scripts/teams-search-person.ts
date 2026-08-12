/**
 * Search person trong Teams theo email/tên — dùng cho UI "Nhập thông tin sơ bộ".
 *
 * Cơ chế: dùng chung createStealthContext (KHÔNG clone profile):
 * - CDP mode (USE_CDP=1): connect Chrome thật đang mở (Teams profile),
 *   dùng tab Teams có sẵn, sau đó chỉ đóng tab riêng của script.
 * - Fallback: launchPersistentContext trên `.teams-session/chrome-profile`
 *   (profile chính, giữ session Teams).
 *
 * Usage:
 *   npx tsx agents/pm/scripts/teams-search-person.ts --query "email@fpt.com"
 *   HEADLESS=true USE_CDP=1 npx tsx agents/pm/scripts/teams-search-person.ts --query "anmt3"
 */
import {
  createStealthContext,
  waitForLogin,
  navigateToTeams,
  applyStealthPatches,
  searchTeamsPerson,
  openTeamsTabInBackground,
  DEFAULT_CONFIG,
  log,
  type AutomatorConfig,
} from "../lib/teams-automator";
import * as fs from "fs";
import * as path from "path";

const SYNC_RUNNING_FILE = path.join(process.cwd(), ".teams-sync-running");
const SEND_RUNNING_FILE = path.join(process.cwd(), ".teams-send-running");

/** Claim send lock ngắn để sync/send khác không đụng profile Teams khi đang search. */
function claimLock(): void {
  try { fs.writeFileSync(SEND_RUNNING_FILE, `${process.pid}`, "utf-8"); } catch { /* */ }
}
function releaseLock(): void {
  try { if (fs.existsSync(SEND_RUNNING_FILE)) fs.unlinkSync(SEND_RUNNING_FILE); } catch { /* */ }
}

async function waitForSyncToFinish(timeoutMs = 3 * 60 * 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let syncRunning = false;
    try {
      if (fs.existsSync(SYNC_RUNNING_FILE)) {
        const content = fs.readFileSync(SYNC_RUNNING_FILE, "utf-8");
        const pids = content.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => parseInt(l, 10)).filter((p) => !isNaN(p));
        syncRunning = pids.some((pid) => {
          try { process.kill(pid, 0); return true; } catch { return false; }
        });
      }
    } catch { /* */ }
    if (!syncRunning) return;
    log(`Dang co sync chay — cho sync xong (poll 3s, con ${Math.max(0, Math.round((deadline - Date.now()) / 1000))}s)...`);
    await new Promise((r) => setTimeout(r, 3_000));
  }
  log("Timeout cho sync — van tiep tuc (co the dung chung profile!).");
}

function parseArgs(): { query: string; headless: boolean } {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--query");
  return {
    query: (idx !== -1 && idx + 1 < args.length ? args[idx + 1] : "") || process.env.TEAMS_SEARCH_QUERY || "",
    headless: args.includes("--headless") || process.env.HEADLESS === "true",
  };
}

async function main() {
  const { query, headless } = parseArgs();
  if (!query) {
    console.error("Error: --query <email/ten> is required.");
    process.exit(1);
  }

  const config: AutomatorConfig = { ...DEFAULT_CONFIG, headless, useRealChrome: true };

  claimLock();
  await waitForSyncToFinish();

  let browser: any;
  let context: any;
  try {
    const ctx = await createStealthContext(config);
    browser = ctx.browser;
    context = ctx.context;

    const isCdp = process.env.USE_CDP === "1" || process.env.USE_CDP === "true";
    let page = context.pages()[0] || (await openTeamsTabInBackground(browser, context));
    if (isCdp) {
      const teamsPage = context.pages().find((p: any) => p.url().includes("teams.microsoft.com"));
      page = teamsPage || (context.pages()[0] || (await openTeamsTabInBackground(browser, context)));
    }
    await applyStealthPatches(page);

    await navigateToTeams(page, config);
    const neededLogin = await waitForLogin(page, config);
    if (neededLogin) await context.storageState({ path: config.sessionDir + "/state.json" });

    const result = await searchTeamsPerson(page, query);
    console.log(JSON.stringify(result));

    // CDP mode: chỉ đóng tab riêng script mở, giữ Chrome thật + tab Teams sẵn
    if (process.env.SYNC_CDP_CONNECTED === "1" && context.pages().length > 1) {
      await page.close().catch(() => {});
    } else {
      await browser.close().catch(() => {});
    }
  } catch (err) {
    console.log(JSON.stringify({ ok: false, error: String(err) }));
  } finally {
    releaseLock();
    if (browser && browser !== context) await browser.close().catch(() => {});
  }
}

main()
  .catch((err) => console.log(JSON.stringify({ ok: false, error: String(err) })))
  .finally(() => process.exit(0));
