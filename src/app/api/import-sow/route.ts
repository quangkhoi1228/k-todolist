import { NextRequest, NextResponse } from "next/server";
import { parseSowWorkbook, detectTemplateType } from "@/lib/sow-parser";
import { createTaskTemplate, getTaskTemplates } from "@/lib/repo/taskTemplates";
import { requireUserId, handleRoute } from "../data/_helpers";
import { getDb } from "@/lib/db";
import { tasks } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  return handleRoute(req, async () => {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const userId = String(formData.get("userId") ?? "");
    requireUserId({ userId });
    const projectId = String(formData.get("projectId") ?? "");
    const action = String(formData.get("action") ?? "importSow");

    if (action === "createFromTemplate") {
      const templateId = String(formData.get("templateId") ?? "");
      if (!templateId) {
        return NextResponse.json({ error: "Thiếu templateId" }, { status: 400 });
      }
      const { getTaskTemplate } = await import("@/lib/repo/taskTemplates");
      const template = await getTaskTemplate(templateId);
      if (!template) {
        return NextResponse.json({ error: "Không tìm thấy template" }, { status: 404 });
      }

      const db = getDb();
      const now = Date.now();
      const createdTasks = [];
      for (const item of template.items ?? []) {
        if (item.isGroup || !item.title) continue;
        const res = await db
          .insert(tasks)
          .values({
            userId,
            title: item.title,
            estimatedTime: item.manday ?? 1,
            startDate: null,
            endDate: null,
            status: "todo",
            project: Number(projectId) || null,
            order: null,
            pic: item.pic || null,
            support: item.support || null,
            priority: "normal",
            notes: item.details || null,
            createdAt: now,
          })
          .returning();
        createdTasks.push(res[0]);
      }

      return {
        ok: true,
        templateId: Number(template.id),
        templateName: template.name,
        templateCategory: template.category,
        items: (template.items ?? []).length,
        createdTasks: createdTasks.length,
      };
    }

    if (!file) {
      return NextResponse.json({ error: "Không có file nào được upload" }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = parseSowWorkbook(buffer, file.name);

    if (action === "importSow") {
      // 1. Tìm template có sẵn khớp category — nếu chưa có thì tạo mới
      let templateId: number | null = null;
      const existing = await getTaskTemplates(userId);
      const match = existing.find((t) => t.category === parsed.templateCategory);
      if (match) {
        templateId = Number(match.id);
      } else {
        const created = await createTaskTemplate({
          userId,
          name: parsed.templateName,
          category: parsed.templateCategory,
          description: parsed.templateDescription,
          items: parsed.items,
          triggers: parsed.triggers,
        });
        templateId = Number(created.id);
      }

      // 2. Tạo tasks từ items (bỏ qua các item là group/phase — chỉ tạo task thực tế)
      const db = getDb();
      const now = Date.now();
      const createdTasks = [];
      for (const item of parsed.items) {
        // Bỏ qua các group (có task con) — chỉ tạo leaf tasks
        if (item.isGroup) continue;
        if (!item.title) continue;

        const res = await db
          .insert(tasks)
          .values({
            userId,
            title: item.title,
            estimatedTime: item.manday ?? 1,
            startDate: null,
            endDate: null,
            status: "todo",
            project: Number(projectId) || null,
            order: null,
            pic: item.pic || null,
            support: item.support || null,
            priority: "normal",
            notes: item.details || null,
            createdAt: now,
          })
          .returning();
        createdTasks.push(res[0]);
      }

      return {
        ok: true,
        templateId,
        templateName: parsed.templateName,
        templateCategory: parsed.templateCategory,
        items: parsed.items.length,
        skippedRows: parsed.skippedRows,
        createdTasks: createdTasks.length,
      };
    }

    if (action === "previewSow") {
      return {
        ok: true,
        templateName: parsed.templateName,
        templateCategory: parsed.templateCategory,
        templateDescription: parsed.templateDescription,
        triggers: parsed.triggers,
        items: parsed.items,
        rawRows: parsed.rawRows,
        skippedRows: parsed.skippedRows,
      };
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  });
}
