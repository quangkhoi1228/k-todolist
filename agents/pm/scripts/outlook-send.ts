/**
 * Outlook Email Sender - CLI Entry Point
 *
 * Usage:
 *   # Gửi email đơn giản:
 *   npx tsx agents/pm/scripts/outlook-send.ts --to "user@email.com" --subject "Test" --body "<p>Hello</p>"
 *
 *   # Gửi cho nhiều người:
 *   npx tsx agents/pm/scripts/outlook-send.ts --to "a@email.com,b@email.com" --subject "Test" --body "<p>Hi</p>"
 *
 *   # Với CC, BCC, đính kèm:
 *   npx tsx agents/pm/scripts/outlook-send.ts \
 *     --to "user@email.com" \
 *     --cc "cc@email.com" \
 *     --subject "SOW Document" \
 *     --body "<p>Đính kèm SOW</p>" \
 *     --attach "/path/to/file.pdf"
 *
 *   # Dry run (compose nhưng không gửi):
 *   npx tsx agents/pm/scripts/outlook-send.ts --to "user@email.com" --subject "Test" --body "<p>Hello</p>" --dry-run
 *
 *   # Health check:
 *   npx tsx agents/pm/scripts/outlook-send.ts --health
 *
 *   # Headless mode:
 *   npx tsx agents/pm/scripts/outlook-send.ts --to "user@email.com" --subject "Test" --body "<p>Hello</p>" --headless
 */

import {
  composeAndSendEmail,
  outlookHealthCheck,
  DEFAULT_OUTLOOK_CONFIG,
  log,
  type OutlookEmailPayload,
  type OutlookConfig,
} from "../lib/outlook-automator";

function parseArgs(): {
  action: "send" | "health";
  payload: OutlookEmailPayload;
  config: Partial<OutlookConfig>;
} {
  const args = process.argv.slice(2);

  // Check for health check
  if (args.includes("--health")) {
    return {
      action: "health",
      payload: { to: [], subject: "", body: "" },
      config: {},
    };
  }

  const getArg = (name: string): string | undefined => {
    const idx = args.indexOf(name);
    if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
    return undefined;
  };

  const to = getArg("--to")?.split(",").map((e) => e.trim()).filter(Boolean) || [];
  const cc = getArg("--cc")?.split(",").map((e) => e.trim()).filter(Boolean);
  const bcc = getArg("--bcc")?.split(",").map((e) => e.trim()).filter(Boolean);
  const subject = getArg("--subject") || "";
  const body = getArg("--body") || "";
  const attachments = getArg("--attach")?.split(",").map((f) => f.trim()).filter(Boolean);
  const importance = (getArg("--importance") || "normal") as "low" | "normal" | "high";

  if (to.length === 0) {
    console.error("Error: --to is required. Usage: --to 'email1@example.com,email2@example.com'");
    process.exit(1);
  }
  if (!subject) {
    console.error("Error: --subject is required.");
    process.exit(1);
  }

  return {
    action: "send",
    payload: {
      to,
      cc,
      bcc,
      subject,
      body,
      attachments,
      importance,
    },
    config: {
      headless: args.includes("--headless"),
      dryRun: args.includes("--dry-run"),
      keepOpen: args.includes("--keep-open"),
    },
  };
}

async function main() {
  const { action, payload, config: partialConfig } = parseArgs();

  const config: OutlookConfig = {
    ...DEFAULT_OUTLOOK_CONFIG,
    ...partialConfig,
  };

  if (action === "health") {
    log("Dang kiem tra Outlook session...");
    const result = await outlookHealthCheck(config);
    console.log(JSON.stringify(result));
    process.exit(result.ok ? 0 : 1);
  }

  // Send email
  log("Bat dau gui email...");
  log(`  To: ${payload.to.join(", ")}`);
  if (payload.cc?.length) log(`  CC: ${payload.cc.join(", ")}`);
  if (payload.bcc?.length) log(`  BCC: ${payload.bcc.join(", ")}`);
  log(`  Subject: ${payload.subject}`);
  log(`  Body: ${payload.body.slice(0, 100)}...`);
  if (payload.attachments?.length) log(`  Attachments: ${payload.attachments.join(", ")}`);
  log(`  Importance: ${payload.importance || "normal"}`);
  log(`  Mode: ${config.dryRun ? "DRY RUN" : "LIVE"}`);

  const result = await composeAndSendEmail(payload, config);

  console.log(`\n--- Ket qua ---`);
  console.log(JSON.stringify(result, null, 2));

  if (result.ok) {
    log(`Email da gui thanh cong!`);
  } else {
    log(`Loi: ${result.error}`);
  }
}

main().catch((err) => {
  console.error("[OutlookSend] Fatal:", err);
  process.exit(1);
});
