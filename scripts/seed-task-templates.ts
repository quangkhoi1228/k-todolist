/**
 * Seed các task template mẫu (Migration, Security/NGFW, WAF) vào bảng taskTemplates.
 * Chạy: npx tsx scripts/seed-task-templates.ts
 */
import "dotenv/config";
import { createTaskTemplate, getTaskTemplates, deleteTaskTemplate } from "../src/lib/repo/taskTemplates";
import { parseSowWorkbook } from "../src/lib/sow-parser";
import * as fs from "fs";
import * as path from "path";

const USER_ID: string = process.env.SEED_USER_ID ?? "";
if (!USER_ID) {
  console.error("Cần set SEED_USER_ID (vd: SEED_USER_ID=user_xxx npx tsx scripts/seed-task-templates.ts)");
  process.exit(1);
}

// Template mẫu thủ công cho các loại dự án phổ biến
const MANUAL_TEMPLATES: {
  name: string;
  category: string;
  description: string;
  triggers: string[];
  items: any[];
}[] = [
  {
    name: "Migration Cloud",
    category: "migration",
    description: "Triển khai di chuyển workload (VM, dữ liệu, hạ tầng) lên Cloud",
    triggers: ["migrate", "migration", "migrating", "onprem", "on-prem", "lift and shift"],
    items: [
      { phase: "Chuẩn bị", title: "Sizing resource", details: "Xác định tài nguyên cần cấp (CPU, RAM, Storage) theo nhu cầu ứng dụng", pic: "", support: "" },
      { phase: "Chuẩn bị", title: "Thiết kế Topology", details: "Thống nhất sơ đồ mạng triển khai trên Cloud với khách hàng", pic: "", support: "" },
      { phase: "Chuẩn bị", title: "Thống nhất kế hoạch triển khai", details: "Chốt công việc, thời gian, phạm vi 2 bên", pic: "", support: "" },
      { phase: "Triển khai", title: "Cấp tài nguyên theo sizing", details: "Tạo VPC, subnet, máy ảo theo thiết kế", pic: "", support: "" },
      { phase: "Triển khai", title: "Khởi tạo network", details: "Cấu hình VPC, peering, routing theo quy hoạch", pic: "", support: "" },
      { phase: "Triển khai", title: "Migrate dữ liệu và ứng dụng", details: "Di chuyển dữ liệu + ứng dụng từ môi trường cũ lên Cloud", pic: "", support: "" },
      { phase: "Triển khai", title: "Kiểm tra kết nối tổng thể", details: "Verify toàn bộ kết nối mạng, ứng dụng sau migration", pic: "", support: "" },
      { phase: "Bàn giao", title: "Nghiệm thu và bàn giao", details: "Bàn giao tài liệu, hướng dẫn vận hành cho khách hàng", pic: "", support: "" },
    ],
  },
  {
    name: "Security / Firewall",
    category: "security",
    description: "Triển khai thiết bị/cấu hình tường lửa và bảo mật (Fortinet, Palo Alto...)",
    triggers: ["firewall", "fortinet", "palo alto", "ngfw", "security", "dnat"],
    items: [
      { phase: "Chuẩn bị", title: "Survey IP Plan và rule hiện tại", details: "Khảo sát IP plan, rule DNAT/SNAT hiện có", pic: "", support: "" },
      { phase: "Chuẩn bị", title: "Thống nhất kế hoạch triển khai", details: "Chốt kế hoạch, phạm vi 2 bên", pic: "", support: "" },
      { phase: "Triển khai", title: "Cấu hình firewall system cơ bản", details: "License, certificate, HA, interface theo thiết kế", pic: "", support: "" },
      { phase: "Triển khai", title: "Mở policy, rule DNAT", details: "Tạo policy, rule DNAT/SNAT theo survey", pic: "", support: "" },
      { phase: "Triển khai", title: "Kiểm tra kết nối tổng thể", details: "Verify toàn bộ luồng kết nối qua firewall", pic: "", support: "" },
      { phase: "Bàn giao", title: "Hỗ trợ vận hành tạm thời", details: "Hỗ trợ vận hành trong thời gian bảo hành", pic: "", support: "" },
    ],
  },
  {
    name: "WAF (Web Application Firewall)",
    category: "waf",
    description: "Triển khai WAF bảo vệ ứng dụng web (domain survey, policy WAF...)",
    triggers: ["waf", "web application", "domain survey"],
    items: [
      { phase: "Chuẩn bị", title: "Survey IP Plan và WAF Domains", details: "Khảo sát IP plan, danh sách domain cần bảo vệ", pic: "", support: "" },
      { phase: "Chuẩn bị", title: "Thống nhất kế hoạch triển khai", details: "Chốt kế hoạch, phạm vi 2 bên", pic: "", support: "" },
      { phase: "Triển khai", title: "Triển khai WAF", details: "Cấu hình WAF, policy bảo vệ các domain", pic: "", support: "" },
      { phase: "Triển khai", title: "Mở policy, rule DNAT", details: "Tạo policy, rule DNAT cho luồng web", pic: "", support: "" },
      { phase: "Triển khai", title: "Kiểm tra kết nối tổng thể", details: "Verify toàn bộ domain qua WAF", pic: "", support: "" },
      { phase: "Bàn giao", title: "Hỗ trợ vận hành tạm thời", details: "Hỗ trợ vận hành trong thời gian bảo hành", pic: "", support: "" },
    ],
  },
];

async function main() {
  console.log(`Seed templates cho user ${USER_ID}...`);

  // Xoá templates cũ của user (để seed lại sạch)
  const existing = await getTaskTemplates(USER_ID, true);
  for (const t of existing) {
    await deleteTaskTemplate(t.id, USER_ID);
    console.log(`  - Xoá template cũ: ${t.name}`);
  }

  // 1. Template Migration từ file SOW Domesco thật (nếu có)
  const sowPath = "/Users/khoitran/Downloads/20260706_Domesco_Triển khai_SOW (3).xlsx";
  if (fs.existsSync(sowPath)) {
    const buf = fs.readFileSync(sowPath);
    const parsed = parseSowWorkbook(buf, path.basename(sowPath));
    const t = await createTaskTemplate({
      userId: USER_ID,
      name: parsed.templateName,
      category: parsed.templateCategory,
      description: parsed.templateDescription,
      items: parsed.items,
      triggers: parsed.triggers,
    });
    console.log(`  + Tạo template từ SOW: ${t.name} (${parsed.items.length} items)`);
  }

  // 2. Template thủ công cho Migration/Security/WAF
  for (const tmpl of MANUAL_TEMPLATES) {
    const t = await createTaskTemplate({
      userId: USER_ID,
      name: tmpl.name,
      category: tmpl.category,
      description: tmpl.description,
      items: tmpl.items,
      triggers: tmpl.triggers,
    });
    console.log(`  + Tạo template thủ công: ${t.name} (${t.items.length} items)`);
  }

  const all = await getTaskTemplates(USER_ID, true);
  console.log(`\nDone. Tổng templates: ${all.length}`);
  for (const t of all) {
    console.log(`  - [${t.category}] ${t.name}: ${t.items.length} items`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
