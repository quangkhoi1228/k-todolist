/**
 * Backfill senderAvatars của message Teams bị lưu placeholder/thiếu.
 *
 * Vấn đề (xem teams-automator.ts, fix 11/08):
 *  - extractTextOnly trước đây KHÔNG lấy senderAvatar → nhiều tin lưu NULL.
 *  - extractMessages chọn nhầm placeholder evergreen-asset (avatar chung) → lưu ảnh giả.
 *  - Upsert ghi đè senderAvatar mỗi lần sync → tin đã có avatar đẹp bị ghi đè bằng NULL/placeholder.
 *
 * Script này:
 *  1. Xoá senderAvatar placeholder (evergreen/mountpoint) → NULL (UI fallback dicebear).
 *  2. Re-sync incremental từng chat Teams của user (mở Chrome thật + scroll tới watermark),
 *     sửa senderAvatar của tin đã lưu qua upsert (ON CONFLICT UPDATE đã có sẵn).
 *  3. In ra tổng kết avatar trước/sau.
 *
 * Lưu ý: cần Chrome thật (Teams session) — chạy khi Chrome CDP đang mở hoặc persistent
 * profile `.teams-session` có session (script tự fallback).
 *
 * Chạy:  npx tsx scripts/backfill-teams-avatars.ts
 *        USER_ID=user_xxx PROJECT_ID=45 npx tsx scripts/backfill-teams-avatars.ts  (chỉ 1 project)
 */
import "dotenv/config";
import { getDb } from "../src/lib/db";
import { projectChats, projects } from "../src/lib/db";
import { and, eq } from "drizzle-orm";

const db = getDb();
const userId = process.env.USER_ID || "user_3H33tqEKNl3DVKINbhrQcvckqF4";
const projectIdFilter = process.env.PROJECT_ID ? Number(process.env.PROJECT_ID) : undefined;

function isPlaceholder(url: string | null | undefined): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return (
    lower.startsWith("data:image/svg") ||
    lower.includes("/evergreen-assets/") ||
    lower.includes("/evergreen-asset") ||
    lower.includes("/mountpoint/")
  );
}

async function main() {
  // Project của user (từ bảng projects — projectChats không có userId)
  const rows = await db.select().from(projects).where(eq(projects.userId, userId));
  const myProjectIds = rows.map((p) => Number(p.id));
  const targetProjects = projectIdFilter ? [projectIdFilter] : myProjectIds;
  console.log(`Target projects (${targetProjects.length}): ${targetProjects.join(", ")}`);
  if (targetProjects.length === 0) {
    console.log("Không có project nào của user — dừng.");
    return;
  }

  // Lọc các project thực sự có chat Teams
  const teamsChats: { projectId: number; chatName: string }[] = [];
  for (const pid of targetProjects) {
    const groups = await db
      .select()
      .from(projectChats)
      .where(and(eq(projectChats.projectId, pid), eq(projectChats.platform, "teams")));
    const names = [...new Set(groups.map((g) => g.chatName))];
    for (const n of names) teamsChats.push({ projectId: pid, chatName: n });
  }

  // 1. Clear placeholder avatars
  let cleared = 0;
  for (const chat of teamsChats) {
    const rows = await db
      .select()
      .from(projectChats)
      .where(and(
        eq(projectChats.projectId, chat.projectId),
        eq(projectChats.chatName, chat.chatName),
        eq(projectChats.platform, "teams")
      ));
    for (const row of rows) {
      if (isPlaceholder(row.senderAvatar)) {
        await db.update(projectChats).set({ senderAvatar: null }).where(eq(projectChats.id, row.id));
        cleared++;
      }
    }
  }
  console.log(`Đã clear ${cleared} senderAvatar placeholder → NULL`);

  if (process.env.VERIFY_ONLY === "1") {
    console.log("VERIFY_ONLY — không hydrate.");
    return;
  }

  // 2. Re-sync incremental từng chat Teams (upsert sửa avatar qua sync-single-chat)
  console.log(`Sẽ re-sync ${teamsChats.length} chat Teams (incremental): ${teamsChats.map((c) => `P${c.projectId}:${c.chatName}`).join(", ")}`);
  const { spawnSync } = await import("child_process");
  for (const chat of teamsChats) {
    console.log(`\n▶ Re-sync P${chat.projectId} "${chat.chatName}"...`);
    const r = spawnSync(
      "npx",
      ["tsx", "agents/pm/scripts/sync-single-chat.ts"],
      {
        env: {
          ...process.env,
          USER_ID: userId,
          PROJECT_ID: String(chat.projectId),
          CHAT_NAME: chat.chatName,
          PLATFORM: "teams",
          HEADLESS: process.env.HEADLESS || "false",
        },
        stdio: "inherit",
        shell: true,
        timeout: 8 * 60 * 1000,
      }
    );
    if (r.status !== 0) {
      console.warn(`  ⚠ Re-sync thất bại (exit ${r.status}) — tiếp tục chat khác.`);
    }
  }

  // 3. Tổng kết
  console.log("\n=== Tổng kết ===");
  for (const pid of targetProjects) {
    const rows = await db
      .select()
      .from(projectChats)
      .where(and(eq(projectChats.projectId, pid), eq(projectChats.platform, "teams")));
    const placeholders = rows.filter((r) => isPlaceholder(r.senderAvatar)).length;
    const data = rows.filter((r) => r.senderAvatar && r.senderAvatar.startsWith("data:")).length;
    const nulls = rows.filter((r) => !r.senderAvatar).length;
    const other = rows.length - placeholders - data - nulls;
    console.log(`P${pid}: total=${rows.length} placeholder=${placeholders} data=${data} null=${nulls} http=${other}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});