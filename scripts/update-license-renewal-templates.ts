/**
 * Cập nhật template message cho quy trình "Gia hạn license firewall" (id=1)
 * theo mẫu mới:
 * - Nhóm KH: không chỉ đích danh Sale khi tiếp nhận
 * - Nhóm nội bộ: template có tên Sale + "nên nhờ anh tạo sớm giúp Teams nhé"
 *
 * Chạy: npx tsx scripts/update-license-renewal-templates.ts
 *   FORCE=1 npx tsx scripts/update-license-renewal-templates.ts  (ghi đè cả checklist cũ đã có execStatus)
 */
import dotenv from "dotenv";
import * as path from "path";
import { getDb } from "../src/lib/db";
import { businessProcesses } from "../src/lib/db";
import { eq } from "drizzle-orm";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const force = process.env.FORCE === "1";

const NEW_STEPS = [
  {
    order: 1,
    title: "Nhắn email qua nhóm KH (nêu rõ nhóm gì) confirm tiếp nhận thông tin",
    description:
      "Gửi tin nhắn/email tới nhóm khách hàng (nêu rõ tên nhóm KH từ tin nhắn — Zalo hoặc Teams): xác nhận đã nhận thông báo hết hạn license, thông báo đang xử lý và sẽ cập nhật tiến độ sớm. Giữ KH an tâm — license hết hạn là vấn đề bảo mật cấp cao. KHÔNG chỉ đích danh Sale trong tin tiếp nhận.",
    targetGroup: "[FPT Cloud] Triển khai dự án <TÊN DỰ ÁN> (nhóm KH)",
    messageContent:
      "Chào anh Kang Chan, bên em đã tiếp nhận thông tin license Palo Alto sắp hết hạn trong 2 ngày tới. Bên em đang phối hợp để tạo ticket gia hạn và sẽ cập nhật tiến độ sớm ạ.",
    owner: "PM",
    duration: "Trong ngày nhận tin",
  },
  {
    order: 2,
    title: "Gửi nhóm nội bộ báo Sale tạo ticket gia hạn",
    description:
      "Gửi tin nhắn tới nhóm nội bộ (Teams): thông báo KH báo hết hạn license firewall, nhờ Sale/Operation tạo Renewal Ticket để bắt đầu quy trình gia hạn. Đính kèm tên KH, loại firewall, ngày hết hạn nếu có.",
    targetGroup: "FCI Internal Team (nhóm nội bộ)",
    messageContent:
      "Chào a Hung ơi, khách hàng Domesco HKT báo license Palo Alto sắp hết hạn trong 2 ngày tới. Bên em nhờ anh tạo Renewal Ticket để bắt đầu quy trình gia hạn giúp ạ. Thông tin: KH Domesco HKT, firewall Palo Alto, hết hạn trong 2 ngày nên nhờ anh tạo sớm giúp Teams nhé.",
    owner: "PM",
    duration: "Trong ngày",
  },
];

async function main() {
  const db = getDb();
  const rows = await db
    .select()
    .from(businessProcesses)
    .where(eq(businessProcesses.id, 1))
    .limit(1);
  if (rows.length === 0) {
    console.log("[Update] Quy trình id=1 không tồn tại. Chạy seed-business-processes.ts trước.");
    return;
  }
  const proc = rows[0];
  console.log(`[Update] Tìm thấy quy trình: ${proc.name}`);
  const stepsArr = Array.isArray(proc.steps) ? (proc.steps as any[]) : [];
  console.log(`[Update] Steps cũ:`, JSON.stringify(stepsArr.map((s) => s?.messageContent?.slice(0, 60)), null, 2));

  await db
    .update(businessProcesses)
    .set({ steps: NEW_STEPS as any, updatedAt: Date.now() })
    .where(eq(businessProcesses.id, 1));

  console.log("[Update] Đã cập nhật steps với template mới.");
  console.log("[Update] Steps mới:");
  NEW_STEPS.forEach((s, i) => {
    console.log(`  [${i}] ${s.title}`);
    console.log(`      messageContent: ${s.messageContent}`);
  });
  console.log("\n[Update] Lần sync sau, LLM sẽ dùng template mới này để soạn message.");
  if (force) {
    console.log("[Update] FORCE=1: lần sau chạy backfill sẽ ghi đè cả checklist cũ đã có execStatus.");
  }
}

main().catch((e) => {
  console.error("[Update] Lỗi:", e);
  process.exit(1);
});