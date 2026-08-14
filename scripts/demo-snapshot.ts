/**
 * Snapshot một project ra file JSON — lưu toàn bộ state (project config,
 * members, chat messages, suggestions, workflow, tasks, summaries) để
 * có thể restore lại bất cứ lúc nào.
 *
 * Chạy:
 *   npx tsx scripts/demo-snapshot.ts --projectId=12
 *   (tuỳ chọn: --file=demo-snapshots/my-demo.json — mặc định: demo-snapshots/project-{id}.json)
 *
 * Sau khi snapshot xong, bạn có thể demo thoải mái (agent chạy, tạo
 * suggestion, gửi tin...). Khi cần demo lại, chỉ cần chạy demo-restore.ts.
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

async function main() {
  const cli = parseCliArgs(process.argv);
  const projectId = parseInt(cli.projectId || "", 10);
  if (!projectId) {
    console.error("Cần --projectId (vd: npx tsx scripts/demo-snapshot.ts --projectId=12)");
    process.exit(1);
  }
  const outFile = cli.file || `demo-snapshots/project-${projectId}.json`;

  const db = getDb();
  const pid = projectId;

  // 1. Project
  const project = await db.query.projects.findFirst({ where: eq(projects.id, pid) });
  if (!project) {
    console.error(`Không tìm thấy project id=${pid}`);
    process.exit(1);
  }

  // 2. Members
  const memberRows = await db
    .select()
    .from(projectMembers)
    .where(eq(projectMembers.projectId, pid));

  // 3. Chats (keep ALL messages — this is the "frozen" data for demo)
  const chatRows = await db
    .select()
    .from(projectChats)
    .where(eq(projectChats.projectId, pid));

  // 4. Suggestions
  const suggestionRows = await db
    .select()
    .from(projectSuggestions)
    .where(eq(projectSuggestions.projectId, pid));

  // 5. Workflow
  const wfRow = await db.query.projectWorkflows.findFirst({
    where: eq(projectWorkflows.projectId, pid),
  });

  // 6. Tasks
  const taskRows = await db
    .select()
    .from(tasks)
    .where(eq(tasks.project, pid));

  // 7. Summaries
  const summaryRows = await db
    .select()
    .from(projectSummaries)
    .where(eq(projectSummaries.projectId, pid));

  const snapshot: DemoSnapshot = {
    version: 1,
    exportedAt: Date.now(),
    sourceProjectId: pid,
    sourceUserId: project.userId,
    project: {
      name: project.name,
      color: project.color,
      order: project.order,
      notes: project.notes,
      teamsGroups: project.teamsGroups as any,
      ticketId: project.ticketId,
      phase: project.phase,
    },
    members: memberRows.map((m) => ({
      name: m.name,
      email: m.email,
      roleName: m.roleName,
      source: m.source,
      roleId: m.roleId,
      permissions: m.permissions as any,
    })),
    chats: chatRows.map((c) => ({
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
    })),
    suggestions: suggestionRows.map((s) => ({
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
    })),
    workflow: wfRow
      ? {
          phase: wfRow.phase,
          steps: wfRow.steps as any,
          initData: wfRow.initData as any,
          requirements: wfRow.requirements as any,
          kickoffQuestions: wfRow.kickoffQuestions as any,
          taskIds: wfRow.taskIds as any,
          sowPlan: wfRow.sowPlan as any,
          preinfoAnalysis: wfRow.preinfoAnalysis as any,
        }
      : null,
    tasks: taskRows.map((t) => ({
      title: t.title,
      estimatedTime: t.estimatedTime,
      startDate: t.startDate,
      endDate: t.endDate,
      status: t.status,
      isCompleted: t.isCompleted,
      order: t.order,
      pic: t.pic,
      support: t.support,
      path: t.path,
      priority: t.priority,
      notes: t.notes,
    })),
    summaries: summaryRows.map((s) => ({
      version: s.version,
      trigger: s.trigger,
      summaryText: s.summaryText,
      summaryData: s.summaryData as any,
    })),
  };

  const dir = path.dirname(outFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(snapshot, null, 2), "utf-8");

  console.log(`✅ Snapshot saved: ${outFile}`);
  console.log(`   Project: "${snapshot.project.name}" (id=${pid})`);
  console.log(`   Members: ${snapshot.members.length}`);
  console.log(`   Chats:   ${snapshot.chats.length} messages`);
  console.log(`   Suggestions: ${snapshot.suggestions.length}`);
  console.log(`   Workflow: ${snapshot.workflow ? snapshot.workflow.phase : "(none)"}`);
  console.log(`   Tasks: ${snapshot.tasks.length}`);
  console.log(`   Summaries: ${snapshot.summaries.length}`);
  console.log("");
  console.log("Để restore: npx tsx scripts/demo-restore.ts --file=" + outFile);
}

main()
  .then(() => closePool())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
