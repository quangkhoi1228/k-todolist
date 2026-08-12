import { NextRequest } from "next/server";
import { parseTaskListPaste, rowsToTasks } from "@/lib/taskListParser";
import { analyzeTaskList } from "@/lib/taskListAnalyzer";
import { requireUserId, readJsonBody, handleRoute } from "../_helpers";
import { getMembersByProject } from "@/lib/repo/projectMembers";
import { getDb } from "@/lib/db";
import { tasks } from "@/lib/db";
import type { DetectedTask } from "@/lib/taskListAnalyzer";

export const runtime = "nodejs";

/** Chuẩn hoá tên member để so khớp (bỏ dấu + lowercase) — dùng để nhận diện placeholder "Khách hàng". */
function normMemberName(name: string): string {
  return String(name ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Import task list dán từ Excel vào dự án:
 * - action=analyze: { userId, projectId, text } → parse + LLM detect → { tasks, source, mappedPics }
 * - action=import:   { userId, projectId, tasks } → tạo task thực tế → { created, items }
 */
export async function POST(req: NextRequest) {
  return handleRoute(req, async (req) => {
    const body = await readJsonBody(req);
    requireUserId(body);
    const action = String(body.action ?? "");
    const projectId = String(body.projectId ?? "");
    if (!projectId) throw Object.assign(new Error("Thiếu projectId"), { status: 400 });

    const members = await getMembersByProject(projectId);

    // Đảm bảo luôn có placeholder "Khách hàng" cho task của khách (PIC = "KH")
    const CUSTOMER_PLACEHOLDER = { name: "Khách hàng", email: undefined, roleName: "" };
    const hasCustomer = members.some((m) => normMemberName(m.name) === "khachhang");
    const membersWithCustomer = hasCustomer ? members : [{ ...CUSTOMER_PLACEHOLDER } as any, ...members];

    if (action === "analyze") {
      const text = String(body.text ?? "").trim();
      if (!text) throw Object.assign(new Error("Chưa có nội dung"), { status: 400 });

      const parsed = parseTaskListPaste(text);
      const items = rowsToTasks(parsed.rows);
      const result = await analyzeTaskList(
        items,
        membersWithCustomer.map((m) => ({ name: m.name, email: m.email, roleName: m.roleName })),
        text
      );
      return {
        ok: true,
        tasks: result.tasks,
        source: result.source,
        mappedPics: result.mappedPics,
        parsedRows: parsed.rows.length,
        skipped: parsed.skipped.length,
        sourceType: parsed.source,
      };
    }

    if (action === "import") {
      const tasksList: DetectedTask[] = Array.isArray(body.tasks) ? body.tasks : [];
      if (tasksList.length === 0) throw Object.assign(new Error("Không có task nào để import"), { status: 400 });

      const db = getDb();
      const now = Date.now();
      let order = 0;
      const created: any[] = [];
      for (const t of tasksList) {
        if (!t.title || !t.title.trim()) continue;
        const res = await db
          .insert(tasks)
          .values({
            userId: String(body.userId),
            title: t.title.trim(),
            estimatedTime: t.manday && t.manday > 0 ? t.manday : 1,
            startDate: t.startDate && !isNaN(Number(t.startDate)) ? Number(t.startDate) : null,
            endDate: t.endDate && !isNaN(Number(t.endDate)) ? Number(t.endDate) : null,
            status: "todo",
            project: Number(projectId),
            order: ++order,
            pic: t.pic || null,
            support: t.support || null,
            path: t.path || null,
            priority: "normal",
            notes: t.details || null,
            createdAt: now + order,
          })
          .returning();
        created.push(res[0]);
      }
      return { ok: true, created: created.length, items: created };
    }

    throw Object.assign(new Error(`Unknown action: ${action}`), { status: 400 });
  });
}
