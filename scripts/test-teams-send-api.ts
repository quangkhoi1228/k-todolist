/* Chạy: npx tsx scripts/test-teams-send-api.ts — test API teams-send dry run */
async function main() {
  const res = await fetch("http://localhost:3000/api/agents/teams-send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "send",
      chatName: "An Mai Thuan",
      message: "Test API từ agent — verify fix lock",
      dryRun: true,
      headless: false,
    }),
  });
  const data = await res.json();
  console.log("Status:", res.status);
  console.log("Result:", JSON.stringify(data, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
