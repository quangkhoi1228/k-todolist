/**
 * Seed data mẫu cho Kho quy trình (businessProcesses).
 *
 * Tạo các quy trình nghiệp vụ mẫu (kickoff, SOW, bàn giao, blocker, decision...
 * và đặc biệt là "Gia hạn license firewall") cho user đang đăng nhập —
 * để PM Agent tham khảo khi sinh gợi ý.
 *
 * Chạy:
 *   npx tsx scripts/seed-business-processes.ts
 *   (nếu cần seed cho user khác: USER_ID=user_xxx npx tsx scripts/seed-business-processes.ts)
 */
import dotenv from "dotenv";
import * as path from "path";
import { createBusinessProcess, getBusinessProcesses } from "../src/lib/repo/businessProcesses";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const userId = process.env.USER_ID || "user_3H33tqEKNl3DVKINbhrQcvckqF4";

const LICENSE_RENEWAL_PROCESS = {
  name: "Gia hạn license firewall (Palo Alto / Fortinet / vAR)",
  category: "delivery",
  description:
    "Quy trình khi khách hàng báo sắp hết hạn license firewall (Palo Alto, Fortinet, vAR...) — PM cần xác nhận tiếp nhận với khách và push sale tạo ticket gia hạn. License hết hạn = firewall ngưng update signature + có thể ngưng bảo vệ → ưu tiên khẩn.",
  triggers: [
    "hết hạn",
    "license",
    "firewall",
    "palo alto",
    "fortinet",
    "var",
    "gia hạn",
    "renewal",
    "sắp hết hạn",
    "email báo",
    "báo hết hạn",
    "subscription",
    "expiry",
  ],
steps: [
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
  ],
  outcome:
    "Khách hàng được xác nhận tiếp nhận trong ngày, Sale đã tạo Renewal Ticket, task theo dõi có trên Kanban board, license mới được active kịp thời trước khi hết hạn.",
};

const OTHER_SAMPLES = [
  {
    name: "Kickoff dự án sau khi ký hợp đồng",
    category: "kickoff",
    description:
      "Quy trình khởi động dự án ngay sau khi hợp đồng được ký và ticket ISD chuyển trạng thái kickoff. Đảm bảo khách hàng được chào đón, đội ngũ được giới thiệu và timeline được chốt ngay từ đầu.",
    triggers: ["kickoff", "đã ký hợp đồng", "khởi động dự án", "bắt đầu dự án", "welcome"],
    steps: [
      { order: 1, title: "Gửi email/mail chào khách hàng", description: "Gửi lời chào, giới thiệu đội ngũ triển khai, kèm lịch họp kickoff đề xuất. Cần ít nhất 1 buổi trong tuần đầu sau khi ký.", owner: "PM", duration: "1 ngày sau ký" },
      { order: 2, title: "Tổ chức họp kickoff", description: "Họp giới thiệu đội ngũ 2 bên, chốt phạm vi (scope), mốc thời gian (timeline), đầu mối liên hệ và kênh làm việc chính thức.", owner: "PM", duration: "1 buổi" },
      { order: 3, title: "Gửi biên bản kickoff", description: "Tổng hợp biên bản: scope, timeline, danh sách đầu mối, các quyết định đã chốt. Gửi qua email và lưu trong group chat nội bộ.", owner: "PM", duration: "1 ngày sau họp" },
      { order: 4, title: "Tạo task triển khai trên board", description: "Phân rã giai đoạn đầu thành task trên Kanban: setup môi trường, truy cập, tài liệu, v.v. Gán người thực hiện + deadline.", owner: "PM", duration: "2 ngày" },
    ],
    outcome: "Khách hàng xác nhận lịch kickoff, biên bản được ký/gửi, board dự án có task triển khai đầu tiên.",
  },
  {
    name: "Chốt SOW (Statement of Work)",
    category: "sow",
    description:
      "Quy trình soạn và chốt SOW với khách hàng — phạm vi công việc, sản phẩm bàn giao, mốc thời gian và điều kiện nghiệm thu.",
    triggers: ["sow", "scope", "phạm vi", "chốt timeline", "statement of work"],
    steps: [
      { order: 1, title: "Thu thập yêu cầu & bối cảnh", description: "Tổng hợp từ ticket ISD, email, tin nhắn Teams/Zalo: yêu cầu khách, ràng buộc, mong đợi của KH.", owner: "PM + Sale", duration: "2-3 ngày" },
      { order: 2, title: "Soạn bản nháp SOW", description: "Soạn phạm vi, deliverables, mốc thanh toán, điều kiện nghiệm thu. Gửi bản nháp cho khách qua email.", owner: "PM", duration: "2 ngày" },
      { order: 3, title: "Họp review SOW với khách", description: "Trao đổi từng mục phạm vi, chốt ngoại lệ/loại trừ (out of scope), timeline từng phase.", owner: "PM", duration: "1 buổi" },
      { order: 4, title: "Chốt SOW cuối cùng", description: "Cập nhật bản cuối theo ý kiến, gửi bản chốt và xác nhận bằng văn bản/email trước khi bắt đầu triển khai.", owner: "PM", duration: "1 ngày" },
    ],
    outcome: "SOW được khách xác nhận chính thức, mọi tranh chấp phạm vi sau này dựa trên bản chốt.",
  },
  {
    name: "Xử lý blocker / vướng mắc triển khai",
    category: "delivery",
    description:
      "Quy trình khi dự án gặp blocker: khách chưa phản hồi, thiếu thông tin, lỗi môi trường, chờ bên thứ ba — để không bị trễ tiến độ âm thầm.",
    triggers: ["blocker", "vướng", "chưa fix", "chờ phản hồi", "chờ bên", "chặn", "đang chờ"],
    steps: [
      { order: 1, title: "Nhận diện & đánh giá mức độ", description: "Xác định blocker ảnh hưởng tới task/timeline nào, của bên nào (KH, nội bộ, bên thứ ba), thời điểm bắt đầu chờ.", owner: "PM", duration: "Ngay khi phát hiện" },
      { order: 2, title: "Thông báo rõ ràng cho các bên", description: "Nhắn nhóm chat + email cho bên liên quan: nêu rõ cần gì, deadline cần phản hồi, hậu quả nếu chậm.", owner: "PM", duration: "Trong ngày" },
      { order: 3, title: "Theo dõi & nhắc lại theo lịch", description: "Nhắc lần 2 sau 1-2 ngày không phản hồi; leo thang lên quản lý/ticket ISD nếu quá 2 lần nhắc hoặc gần deadline.", owner: "PM", duration: "2 ngày / lần nhắc" },
      { order: 4, title: "Cập nhật rủi ro lên board & ticket", description: "Ghi rõ blocker trên task (note), đổi status, cập nhật ticket ISD nếu ảnh hưởng timeline cam kết.", owner: "PM", duration: "Sau mỗi lần cập nhật" },
    ],
    outcome: "Blocker được gỡ hoặc được quản lý minh bạch (đã leo thang/đổi timeline có xác nhận), không để trễ âm thầm.",
  },
  {
    name: "Phản hồi yêu cầu thay đổi scope (change request)",
    category: "general",
    description:
      "Quy trình khi khách hàng yêu cầu thêm việc ngoài phạm vi SOW — tránh làm miễn phí, giữ lịch trình, ghi nhận rõ.",
    triggers: ["thêm", "ngoài scope", "yêu cầu mới", "change", "phát sinh", "thêm tính năng", "làm thêm"],
    steps: [
      { order: 1, title: "Tiếp nhận & phân loại yêu cầu", description: "Ghi nhận yêu cầu từ chat/email, xác định thuộc scope hay ngoài scope, mức độ ảnh hưởng (nhỏ/lớn).", owner: "PM", duration: "Ngay khi nhận" },
      { order: 2, title: "Ước lượng & gửi đề xuất", description: "Ước lượng công sức + ảnh hưởng timeline, gửi đề xuất (chấp nhận/đổi timeline/phát sinh phí) cho khách.", owner: "PM", duration: "2-3 ngày" },
      { order: 3, title: "Chốt với khách & cập nhật SOW", description: "Khi khách đồng ý phương án: cập nhật SOW/phụ lục, ghi note trên project, thông báo team.", owner: "PM", duration: "1 ngày" },
      { order: 4, title: "Theo dõi thực hiện", description: "Tạo task cho phần phát sinh, theo dõi tới khi xong và nghiệm thu cùng KH.", owner: "PM", duration: "Theo task" },
    ],
    outcome: "Mọi yêu cầu ngoài scope đều được định giá/chốt văn bản trước khi làm, không phát sinh làm miễn phí.",
  },
];

const ALL_SAMPLES = [LICENSE_RENEWAL_PROCESS, ...OTHER_SAMPLES];

async function main() {
  const existing = await getBusinessProcesses(userId, true);
  if (existing.length > 0) {
    console.log(`[Seed] User ${userId} đã có ${existing.length} quy trình — bỏ qua (tránh trùng).`);
    console.log("[Seed] Nếu muốn seed lại: xoá dữ liệu cũ trong trang /business-processes rồi chạy lại.");
    return;
  }

  let saved = 0;
  for (const sample of ALL_SAMPLES) {
    await createBusinessProcess({ userId, ...sample });
    saved++;
    console.log(`  - ${sample.name}`);
  }
  console.log(`[Seed] Xong: đã tạo ${saved}/${ALL_SAMPLES.length} quy trình mẫu cho user ${userId}.`);
  console.log("[Seed] Mở trang /business-processes để xem.");
  console.log("[Seed] Quy trình 'Gia hạn license firewall' nằm đầu danh sách — đây chính là quy trình PM Agent sẽ tham khảo khi KH báo hết hạn license.");
}

main().catch((e) => {
  console.error("[Seed] Lỗi:", e);
  process.exit(1);
});