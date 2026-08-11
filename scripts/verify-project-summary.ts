/* Chạy: npx tsx scripts/verify-project-summary.ts USER_ID=xxx PROJECT_ID=xxx [GATE=0|1]
 *
 * Verify tính năng "Bản tóm tắt dự án" (projectSummaries):
 * - Liệt kê các version hiện có của project
 * - Nếu GATE=1: chạy thử LLM gate (should_update) với messages gần nhất
 * - Sinh + LƯU 1 version tóm tắt mới (trigger manual) để kiểm tra INSERT + số version
 *   (hoặc chỉ xem nếu đã có — dùng --no-save để không ghi thêm bản mới)
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const userId = process.env.USER_ID;
const projectId = process.env.PROJECT_ID;
const gateOnly = process.env.GATE === "1";
const dryRun = process.argv.includes("--no-save");

async function main() {
  if (!userId || !projectId) {
    console.error("Thiếu USER_ID / PROJECT_ID. Chạy: npx tsx scripts/verify-project-summary.ts USER_ID=xxx PROJECT_ID=xxx");
    process.exit(1);
  }

  const { getSummariesByProject, getLatestSummary } = await import("../src/lib/repo/projectSummaries");
  const { getProject } = await import("../src/lib/repo/projects");
  const { getMessagesByProject } = await import("../src/lib/repo/projectChats");
  const { shouldUpdateSummary, generateAndSaveSummary } = await import("../src/lib/projectSummaryGenerator");

  const pid = Number(projectId);
  const project = await getProject(pid);
  if (!project) {
    console.error(`Không tìm thấy project ${pid}`);
    process.exit(1);
  }
  console.log(`\n=== Verify Project Summary ===`);
  console.log(`Project: ${project.name} (id ${pid}, user ${userId.slice(0, 8)}…)`);

  // 1. Liệt kê version hiện có
  const summaries = await getSummariesByProject(pid);
  console.log(`\n[1] Versions hiện có: ${summaries.length}`);
  for (const s of summaries) {
    console.log(`   - v${s.version} (${s.trigger}) ${new Date(s.createdAt).toLocaleString("vi-VN")} — ${(s.summaryText || "").slice(0, 60).replace(/\n/g, " ")}…`);
  }

  const latest = await getLatestSummary(pid);
  console.log(`\n[2] Latest: ${latest ? `v${latest.version} (${latest.trigger})` : "chưa có"}`);

  // 2. Nếu GATE=1: test LLM gate với messages gần nhất
  if (gateOnly || process.env.GATE) {
    const messages = await getMessagesByProject(pid);
    const newMessages = (messages || []).slice(-20).map((m: any) => ({
      sender: m.sender || "",
      chatName: m.chatName || "",
      content: m.content || "",
    }));
    console.log(`\n[3] Gate test — ${newMessages.length} messages gần nhất (LLM gate):`);
    const gate = await shouldUpdateSummary({
      projectName: project.name,
      projectStatus: project.isdStatus || "",
      newMessages,
      latestSummaryText: latest?.summaryText || null,
    });
    console.log(`   → shouldUpdate: ${gate.shouldUpdate} — ${gate.reason}`);
  }

  // 3. Sinh + lưu 1 bản tóm tắt (trigger manual — kiểm tra INSERT + version tăng)
  if (!gateOnly) {
    if (dryRun) {
      console.log(`\n[--no-save] Bỏ qua tạo version mới.`);
    } else {
      console.log(`\n[3] Generate + save version mới (trigger manual)...`);
      const created = await generateAndSaveSummary({ projectId: pid, userId, trigger: "manual" });
      if (!created) {
        console.error(`   ❌ Generate thất bại`);
        process.exit(1);
      }
      console.log(`   ✅ Đã lưu v${created.version} (${created.trigger}) — id ${created.id}`);
      console.log(`   Summary text (${created.summaryText.length} ký tự):`);
      console.log(created.summaryText.slice(0, 800));
      console.log(`   summaryData keys: ${Object.keys(created.summaryData || {}).join(", ")}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});