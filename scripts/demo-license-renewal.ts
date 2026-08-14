/**
 * Chuẩn bị / kiểm tra demo: KH báo hết hạn license → 1 gợi ý → Duyệt gửi Zalo + Teams.
 *
 * Chạy:
 *   npx tsx scripts/demo-license-renewal.ts --check              // unit: gộp 8 card → 1 checklist 2 bước
 *   npx tsx scripts/demo-license-renewal.ts --prepare            // xoá gợi ý cũ, chạy monitor, tạo card chat
 *   npx tsx scripts/demo-license-renewal.ts --prepare --projectId=49
 *   npx tsx scripts/demo-license-renewal.ts --send               // gọi execute-checklist (gửi THẬT Zalo rồi Teams)
 *   npx tsx scripts/demo-license-renewal.ts --prepare --send     // prepare + gửi thật
 */
import dotenv from "dotenv";
import * as path from "path";
import { and, desc, eq } from "drizzle-orm";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

import { getDb } from "../src/lib/db";
import {
  businessProcesses,
  pmAgentMessages,
  pmAgentSessions,
  projectChats,
  projectMembers,
  projectSuggestions,
  projects,
} from "../src/lib/db/schema";
import { postProcessSuggestions } from "../src/lib/ai/debate";
import { olderPendingDuplicates } from "../src/lib/suggestionDedup";
import { runMonitor } from "../agents/pm/lib/monitor";
import { closePool, parseCliArgs } from "./demo-utils";

const DEFAULT_PROJECT_ID = 49;

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

async function runCheck(): Promise<void> {
  const db = getDb();
  const procs = await db.select().from(businessProcesses).where(eq(businessProcesses.id, 1));
  const license = procs[0];
  assert(license, "Thiếu quy trình id=1 Gia hạn license");

  const ctx = {
    projectName: "CÔNG TY BẢO HIỂM LIÊN HIỆP",
    projectGroups: [
      { name: "[Internal] DOMESCO HKT", platform: "teams", type: "internal" },
      { name: "[FPT Cloud] Triển khai dự án Domesco HKT", platform: "zalo", type: "customer" },
    ],
    members: [
      { name: "hungdt43@fpt.com", roleName: "Sale" },
      { name: "Kang Chan", roleName: "Khách hàng" },
    ],
    messages: [
      {
        sender: "Kang Chan",
        chatName: "[FPT Cloud] Triển khai dự án Domesco HKT",
        content: "Pallo alto báo hết hạn license sau 2 ngày đó e",
        platform: "zalo" as const,
      },
    ],
  };

  const noisy = [
    { title: "License hết hạn sau 2 ngày", description: "KH báo license sắp hết hạn" },
    { title: "Gia hạn license Palo Alto trước khi hết hạn", description: "Cần gia hạn Palo Alto" },
    { title: "Nguy cơ gián đoạn dịch vụ nếu không gia hạn kịp", description: "License hết hạn gây gián đoạn" },
    { title: "Tạo Renewal Ticket cho license Palo Alto của Domesco HKT", description: "Nhờ Sale tạo ticket" },
    { title: "Khách hàng Domesco HKT cần gia hạn license Palo Alto", description: "KH báo hết hạn" },
    { title: "Theo dõi tiến độ gia hạn", description: "Theo dõi license firewall" },
    { title: "Xác nhận tiếp nhận với khách hàng", description: "Nhắn Zalo xác nhận tiếp nhận hết hạn license" },
    { title: "Gửi nhóm nội bộ nhờ Sale", description: "Gửi Teams nhờ tạo Renewal Ticket Palo Alto" },
  ];

  const out = postProcessSuggestions(noisy, [license], [license], ctx);
  assert(out.length === 1, `expect 1 card, got ${out.length}: ${out.map((s) => s.title).join(" | ")}`);
  const cl = out[0].checklist || [];
  assert(cl.length >= 2, `expect checklist >= 2, got ${cl.length}`);
  const groups = cl.map((c: any) => c.targetGroup);
  assert(
    groups.some((g: string) => /Domesco HKT/i.test(g) && /FPT Cloud/i.test(g)),
    `missing Zalo KH group: ${groups.join(" / ")}`,
  );
  assert(
    groups.some((g: string) => /Internal/i.test(g) && /DOMESCO/i.test(g)),
    `missing Teams internal group: ${groups.join(" / ")}`,
  );
  assert(
    cl.every((c: any) => c.messageContent && c.targetGroup),
    "every step must have targetGroup + messageContent",
  );
  const blob = cl.map((c: any) => c.messageContent).join("\n");
  assert(/Kang Chan/i.test(blob), "Zalo message should greet Kang Chan");
  assert(/Hung/i.test(blob), "Teams message should greet Hung");
  assert(/Domesco HKT/i.test(blob), "Teams message should name KH Domesco HKT");
  assert(/Palo Alto/i.test(blob), "messages should mention Palo Alto (including typo Pallo)");
  console.log("✅ --check: 8 card license → 1 gợi ý, checklist 2 bước Zalo + Teams");
  cl.forEach((c: any, i: number) => {
    console.log(`   ${i + 1}. ${c.title}`);
    console.log(`      → ${c.targetGroup}`);
    console.log(`      "${c.messageContent}"`);
  });

  const skipped = postProcessSuggestions(noisy, [license], [license], {
    ...ctx,
    pendingSuggestions: [
      { title: "Gia hạn license Palo Alto", description: "KH báo hết hạn Palo Alto", isResolved: false },
    ],
  });
  assert(
    skipped.length === 0,
    `pending unexecuted license must skip new card, got ${skipped.length}: ${skipped.map((s) => s.title).join(" | ")}`,
  );
  console.log("✅ --check: đã có gợi ý renew chưa làm → không báo lại");

  const dups = Array.from({ length: 9 }, (_, i) => ({
    id: 100 + i,
    title: `Gia hạn license Palo Alto ${i}`,
    description: "KH báo hết hạn Palo Alto",
    isResolved: false,
  }));
  const older = olderPendingDuplicates(dups);
  assert(older.length === 8, `collapse should keep 1, mark 8 older, got older=${older.length}`);
  assert(!older.some((s) => s.id === 108), "newest id=108 must be kept");
  console.log("✅ --check: 9 gợi ý renew pending → giữ 1 bản mới nhất, loại 8 bản cũ");
}

async function prepare(projectId: number): Promise<{ messageId: number; sessionId: number }> {
  const db = getDb();
  const project = await db.query.projects.findFirst({ where: eq(projects.id, projectId) });
  if (!project) throw new Error(`Không có project ${projectId}`);

  const delS = await db.delete(projectSuggestions).where(eq(projectSuggestions.projectId, projectId));
  console.log(`🗑  Suggestions project ${projectId}: xoá ${delS.rowCount ?? 0}`);

  const sessions = await db
    .select({ id: pmAgentSessions.id })
    .from(pmAgentSessions)
    .where(eq(pmAgentSessions.projectId, projectId));
  const sessionIds = sessions.map((s) => s.id);
  let deletedNotifs = 0;
  for (const sid of sessionIds) {
    const msgs = await db
      .select({ id: pmAgentMessages.id, metadata: pmAgentMessages.metadata })
      .from(pmAgentMessages)
      .where(eq(pmAgentMessages.sessionId, sid));
    for (const m of msgs) {
      try {
        const meta = m.metadata ? JSON.parse(m.metadata) : null;
        if (meta?.action === "suggestion_notification") {
          await db.delete(pmAgentMessages).where(eq(pmAgentMessages.id, m.id));
          deletedNotifs++;
        }
      } catch {
        /* ignore */
      }
    }
  }
  console.log(`🗑  Chat suggestion_notification: xoá ${deletedNotifs}`);

  const recent = await db
    .select({
      sender: projectChats.sender,
      content: projectChats.content,
      platform: projectChats.platform,
      chatName: projectChats.chatName,
    })
    .from(projectChats)
    .where(eq(projectChats.projectId, projectId))
    .orderBy(desc(projectChats.timestampMs))
    .limit(8);

  const seed = (recent.length
    ? recent
    : [
        {
          sender: "Kang Chan",
          content: "Pallo alto báo hết hạn license sau 2 ngày đó e",
          platform: "zalo",
          chatName: "[FPT Cloud] Triển khai dự án Domesco HKT",
        },
      ]
  ).map((m) => ({
    sender: m.sender || undefined,
    content: m.content || undefined,
    platform: m.platform || undefined,
    chatName: m.chatName || undefined,
  }));

  console.log(`▶  Chạy monitor (${seed.length} tin gần nhất làm trigger)...`);
  await runMonitor(seed, projectId, seed[0]?.chatName || "", project.userId, project.name);

  const session = await db.query.pmAgentSessions.findFirst({
    where: eq(pmAgentSessions.projectId, projectId),
  });
  if (!session) throw new Error("Không tìm thấy PM session của project");

  const latest = await db
    .select()
    .from(pmAgentMessages)
    .where(and(eq(pmAgentMessages.sessionId, session.id), eq(pmAgentMessages.role, "agent")))
    .orderBy(desc(pmAgentMessages.id))
    .limit(5);

  const notif = latest.find((m) => {
    try {
      return JSON.parse(m.metadata || "{}")?.action === "suggestion_notification";
    } catch {
      return false;
    }
  });
  if (!notif) throw new Error("Monitor không tạo được tin gợi ý trong chat");

  const meta = JSON.parse(notif.metadata || "{}");
  const suggestions = meta.suggestions || [];
  console.log(`✅ Chat notification id=${notif.id} — ${suggestions.length} gợi ý`);
  for (const s of suggestions) {
    const cl = s.checklist || [];
    console.log(`   • ${s.title}  checklist=${cl.length}`);
    for (const c of cl) {
      console.log(`       - ${c.title} → ${c.targetGroup || "(no group)"}`);
    }
  }
  if (suggestions.length !== 1) {
    console.warn(`⚠️  Kỳ vọng 1 gợi ý (demo sạch), thực tế ${suggestions.length}`);
  }
  const cl0 = suggestions[0]?.checklist || [];
  if (cl0.length < 2 || cl0.some((c: any) => !c.targetGroup || !c.messageContent)) {
    throw new Error("Checklist chưa đủ 2 bước gửi Zalo + Teams");
  }
  return { messageId: notif.id, sessionId: session.id };
}

async function sendChecklist(projectId: number, messageId: number): Promise<void> {
  const db = getDb();
  const msg = await db.query.pmAgentMessages.findFirst({ where: eq(pmAgentMessages.id, messageId) });
  if (!msg?.metadata) throw new Error(`Không đọc được message ${messageId}`);
  const meta = JSON.parse(msg.metadata);
  const s = (meta.suggestions || [])[0];
  const items = (s?.checklist || []).map((c: any, i: number) => ({
    title: c.title,
    targetGroup: c.targetGroup,
    messageContent: c.messageContent,
    originalIndex: i,
  }));
  if (items.length === 0) throw new Error("Checklist rỗng — không gửi được");

  console.log(`▶  POST /api/agents/execute-checklist  messageId=${messageId}  ${items.length} bước`);
  const res = await fetch("http://localhost:3000/api/agents/execute-checklist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messageId: String(messageId),
      projectId: String(projectId),
      suggestionIndex: 0,
      items,
    }),
  });
  if (!res.ok || !res.body) {
    const t = await res.text().catch(() => "");
    throw new Error(`execute-checklist HTTP ${res.status}: ${t.slice(0, 400)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let failed = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let ev: any;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      if (ev.type === "step") {
        const mark = ev.status === "done" ? "✅" : ev.status === "failed" ? "❌" : "⏳";
        console.log(`   ${mark} [${ev.status}] ${ev.title || ""} → ${ev.platform || ""} ${ev.resolvedName || ev.targetGroup || ""}`);
        if (ev.status === "failed") {
          failed++;
          console.log(`      ${ev.error || ""}`);
        }
      } else if (ev.type === "done") {
        console.log(`   done ok=${ev.ok} results=${(ev.results || []).length}`);
      }
    }
  }
  if (failed > 0) throw new Error(`Có ${failed} bước gửi thất bại`);
  console.log("✅ Gửi Zalo + Teams xong");
}

async function main() {
  const cli = parseCliArgs(process.argv);
  const projectId = parseInt(cli.projectId || String(DEFAULT_PROJECT_ID), 10);
  const doCheck = cli.check === "1" || cli.check === "true" || process.argv.includes("--check");
  const doPrepare = process.argv.includes("--prepare");
  const doSend = process.argv.includes("--send");

  if (!doCheck && !doPrepare && !doSend) {
    console.log("Cần --check và/hoặc --prepare và/hoặc --send");
    process.exit(1);
  }

  if (doCheck) await runCheck();

  let messageId: number | null = null;
  if (doPrepare) {
    const r = await prepare(projectId);
    messageId = r.messageId;
    console.log(`📌 Demo card: /pm-agent/chat?session=${r.sessionId}  messageId=${r.messageId}`);
  }

  if (doSend) {
    if (!messageId) {
      const db = getDb();
      const session = await db.query.pmAgentSessions.findFirst({
        where: eq(pmAgentSessions.projectId, projectId),
      });
      if (!session) throw new Error("Không có session");
      const latest = await db
        .select()
        .from(pmAgentMessages)
        .where(eq(pmAgentMessages.sessionId, session.id))
        .orderBy(desc(pmAgentMessages.id))
        .limit(15);
      const notif = latest.find((m) => {
        try {
          return JSON.parse(m.metadata || "{}")?.action === "suggestion_notification";
        } catch {
          return false;
        }
      });
      if (!notif) throw new Error("Không tìm thấy suggestion_notification — chạy --prepare trước");
      messageId = notif.id;
    }
    await sendChecklist(projectId, messageId);
  }
}

main()
  .then(() => closePool())
  .catch((e) => {
    console.error(e);
    closePool().finally(() => process.exit(1));
  });
