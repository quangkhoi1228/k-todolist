/**
 * Restore một project từ file snapshot (tạo bởi demo-snapshot.ts).
 *
 * Hai chế độ:
 *   1. Restore lên project MỚI (mặc định): tạo project mới + copy toàn bộ
 *      state (members, chats, suggestions, workflow, tasks, summaries).
 *      → Dùng khi muốn có 1 project demo sạch, không đụng project gốc.
 *   2. Restore đè lên project CŨ (--overwrite=<projectId>): xoá hết state
 *      cũ của project đó rồi copy snapshot vào.
 *      → Dùng khi muốn reset project demo về đúng trạng thái đã snapshot.
 *
 * Chạy:
 *   npx tsx scripts/demo-restore.ts --file=demo-snapshots/project-12.json
 *   npx tsx scripts/demo-restore.ts --file=demo-snapshots/project-12.json --overwrite=12
 *   (tuỳ chọn: --userId=user_xxx để override user sở hữu project mới)
 */
import dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";
import { eq } from "drizzle-orm";
import { getDb } from "../src/lib/db";
import {
  projects, projectMembers, projectChats, projectSuggestions,
  projectWorkflows, tasks, projectSummaries,
} from "../src/lib/db/schema";
import { closePool, parseCliArgs, type DemoSnapshot } from "./demo-utils";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

function loadSnapshot(file: string): DemoSnapshot {
  const raw = fs.readFileSync(file, "utf-8");
  return JSON.parse(raw);
}

async function clearProjectState(db: any, pid: number) {
  await db.delete(projectMembers).where(eq(projectMembers.projectId, pid));
  await db.delete(projectChats).where(eq(projectChats.projectId, pid));
  await db.delete(projectSuggestions).where(eq(projectSuggestions.projectId, pid));
  await db.delete(projectWorkflows).where(eq(projectWorkflows.projectId, pid));
  await db.delete(tasks).where(eq(tasks.project, pid));
  await db.delete(projectSummaries).where(eq(projectSummaries.projectId, pid));
}

async function main() {
  const cli = parseCliArgs(process.argv);
  const file = cli.file || "";
  if (!file) {
    console.error("Cần --file (vd: npx tsx scripts/demo-restore.ts --file=demo-snapshots/project-12.json)");
    process.exit(1);
  }
  const snap = loadSnapshot(file);

  const db = getDb();
  const now = Date.now();

  // ── Determine target project ──
  let targetPid: number;
  let targetUserId: string;

  const overwriteRaw = cli.overwrite;
  if (overwriteRaw) {
    targetPid = parseInt(overwriteRaw, 10);
    const existing = await db.query.projects.findFirst({ where: eq(projects.id, targetPid) });
    if (!existing) {
      console.error(`Không tìm thấy project id=${targetPid} để overwrite`);
      process.exit(1);
    }
    targetUserId = existing.userId;
    console.log(`⟳ Overwrite project id=${targetPid} (${existing.name}) từ snapshot...`);
    await clearProjectState(db, targetPid);
    // Cập nhật config project từ snapshot
    await db
      .update(projects)
      .set({
        name: snap.project.name,
        color: snap.project.color,
        order: snap.project.order,
        notes: snap.project.notes,
        teamsGroups: snap.project.teamsGroups as any,
        ticketId: snap.project.ticketId,
        phase: snap.project.phase ?? "init",
      })
      .where(eq(projects.id, targetPid));
  } else {
    targetUserId = cli.userId || snap.sourceUserId;
    const res = await db
      .insert(projects)
      .values({
        userId: targetUserId,
        name: snap.project.name,
        color: snap.project.color,
        order: snap.project.order,
        notes: snap.project.notes,
        teamsGroups: snap.project.teamsGroups as any,
        ticketId: snap.project.ticketId,
        phase: snap.project.phase ?? "init",
        archived: false,
        createdAt: now,
      })
      .returning();
    targetPid = res[0].id;
    console.log(`✦ Tạo project mới id=${targetPid} ("${snap.project.name}") từ snapshot`);
  }

  // ── Members ──
  for (const m of snap.members) {
    await db.insert(projectMembers).values({
      projectId: targetPid,
      userId: targetUserId,
      name: m.name,
      email: m.email,
      roleId: m.roleId,
      roleName: m.roleName,
      source: m.source,
      permissions: m.permissions as any,
      createdAt: now,
    });
  }

  // ── Chats ──
  let chatSaved = 0;
  for (const c of snap.chats) {
    try {
      await db
        .insert(projectChats)
        .values({
          projectId: targetPid,
          chatName: c.chatName,
          messageId: c.messageId,
          sender: c.sender,
          senderAvatar: c.senderAvatar,
          content: c.content,
          images: c.images,
          timestamp: c.timestamp,
          timestampMs: c.timestampMs,
          platform: c.platform,
          isMine: c.isMine,
          scrapedAt: now,
        })
        .onConflictDoNothing();
      chatSaved++;
    } catch (e) {
      console.warn(`  ! skip chat (${c.chatName}/${c.messageId}): ${e}`);
    }
  }

  // ── Suggestions ──
  for (const s of snap.suggestions) {
    await db.insert(projectSuggestions).values({
      projectId: targetPid,
      userId: targetUserId,
      type: s.type,
      title: s.title,
      description: s.description,
      sourceMessage: s.sourceMessage,
      sourceSender: s.sourceSender,
      sourceChatName: s.sourceChatName,
      sourceTimestamp: s.sourceTimestamp,
      actionLabel: s.actionLabel,
      actionUrl: s.actionUrl,
      suggestionData: s.suggestionData,
      isRead: s.isRead,
      isResolved: s.isResolved,
      createdAt: now,
    });
  }

  // ── Workflow ──
  if (snap.workflow) {
    await db.insert(projectWorkflows).values({
      projectId: targetPid,
      userId: targetUserId,
      phase: snap.workflow.phase,
      steps: snap.workflow.steps as any,
      initData: snap.workflow.initData as any,
      requirements: snap.workflow.requirements as any,
      kickoffQuestions: snap.workflow.kickoffQuestions as any,
      taskIds: snap.workflow.taskIds as any,
      sowPlan: snap.workflow.sowPlan as any,
      preinfoAnalysis: snap.workflow.preinfoAnalysis as any,
      updatedAt: now,
      createdAt: now,
    });
  }

  // ── Tasks ──
  for (const t of snap.tasks) {
    await db.insert(tasks).values({
      userId: targetUserId,
      title: t.title,
      estimatedTime: t.estimatedTime,
      startDate: t.startDate,
      endDate: t.endDate,
      status: t.status,
      isCompleted: t.isCompleted,
      project: targetPid,
      order: t.order,
      pic: t.pic,
      support: t.support,
      path: t.path,
      priority: t.priority,
      notes: t.notes,
      createdAt: now,
    });
  }

  // ── Summaries ──
  for (const sm of snap.summaries) {
    await db.insert(projectSummaries).values({
      projectId: targetPid,
      userId: targetUserId,
      version: sm.version,
      trigger: sm.trigger,
      summaryText: sm.summaryText,
      summaryData: sm.summaryData as any,
      createdAt: now,
    });
  }

  console.log(`✅ Restore xong project id=${targetPid}:`);
  console.log(`   Members: ${snap.members.length}`);
  console.log(`   Chats:   ${chatSaved} messages`);
  console.log(`   Suggestions: ${snap.suggestions.length}`);
  console.log(`   Workflow: ${snap.workflow ? snap.workflow.phase : "(none)"}`);
  console.log(`   Tasks: ${snap.tasks.length}`);
  console.log(`   Summaries: ${snap.summaries.length}`);
}

main()
  .then(() => closePool())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });