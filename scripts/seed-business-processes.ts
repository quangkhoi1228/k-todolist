/**
 * Seed data mẫu cho Kho quy trình (businessProcesses).
 *
 * Tạo các quy trình nghiệp vụ mẫu (kickoff, SOW, bàn giao, blocker, decision...)
 * cho đúng user đang đăng nhập — để PM Agent tham khảo khi sinh gợi ý.
 *
 * Chạy:
 *   npx tsx scripts/seed-business-processes.ts
 *   (nếu cần seed cho user khác: USER_ID=user_xxx npx tsx scripts/seed-business-processes.ts)
 */
import dotenv from "dotenv";
import * as path from "path";
import { createBusinessProcess } from "../src/lib/repo/businessProcesses";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const userId = process.env.USER_ID || "user_3H33tqEKNl3DVKINbhrQcvckqF4";

const SAMPLES = [
  {
    name: "Kickoff dự án sau khi ký hợp đồng",
    category: "kickoff",
    description:
      "Quy trình khởi động dự án ngay sau khi hợp đồng được ký và ticket ISD chuyển trạng thái kickoff. Đảm bảo khách hàng được chào đón, đội ngũ được giới thiệu và timeline được chốt ngay từ đầu.",
    triggers: ["kickoff", "đã ký hợp đồng", "khởi động dự án", "bắt đầu dự án", "welcome"],
    steps: [
      {
        order: 1,
        title: "Gửi email/mail chào khách hàng",
        description:
          "Gửi lời chào, giới thiệu đội ngũ triển khai, kèm lịch họp kickoff đề xuất. Cần ít nhất 1 buổi trong tuần đầu sau khi ký.",
        owner: "PM",
        duration: "1 ngày sau ký",
      },
      {
        order: 2,
        title: "Tổ chức họp kickoff",
        description:
          "Họp giới thiệu đội ngũ 2 bên, chốt phạm vi (scope), mốc thời gian (timeline), đầu mối liên hệ và kênh làm việc chính thức.",
        owner: "PM",
        duration: "1 buổi",
      },
      {
        order: 3,
        title: "Gửi biên bản kickoff",
        description:
          "Tổng hợp biên bản: scope, timeline, danh sách đầu mối, các quyết định đã chốt. Gửi qua email và lưu trong group chat nội bộ.",
        owner: "PM",
        duration: "1 ngày sau họp",
      },
      {
        order: 4,
        title: "Tạo task triển khai trên board",
        description:
          "Phân rã giai đoạn đầu thành task trên Kanban: setup môi trường, truy cập, tài liệu, v.v. Gán người thực hiện + deadline.",
        owner: "PM",
        duration: "2 ngày",
      },
    ],
    outcome:
      "Khách hàng xác nhận lịch kickoff, biên bản được ký/gửi, board dự án có task triển khai đầu tiên.",
  },
  {
    name: "Chốt SOW (Statement of Work)",
    category: "sow",
    description:
      "Quy trình soạn và chốt SOW với khách hàng — phạm vi công việc, sản phẩm bàn giao, mốc thời gian và điều kiện nghiệm thu.",
    triggers: ["sow", "scope", "phạm vi", "chốt timeline", "statement of work"],
    steps: [
      {
        order: 1,
        title: "Thu thập yêu cầu & bối cảnh",
        description:
          "Tổng hợp từ ticket ISD, email, tin nhắn Teams/Zalo: yêu cầu khách, ràng buộc, mong đợi của KH.",
        owner: "PM + Sale",
        duration: "2-3 ngày",
      },
      {
        order: 2,
        title: "Soạn bản nháp SOW",
        description:
          "Soạn phạm vi, deliverables, mốc thanh toán, điều kiện nghiệm thu. Gửi bản nháp cho khách qua email.",
        owner: "PM",
        duration: "2 ngày",
      },
      {
        order: 3,
        title: "Họp review SOW với khách",
        description:
          "Trao đổi từng mục phạm vi, chốt ngoại lệ/loại trừ (out of scope), timeline từng phase.",
        owner: "PM",
        duration: "1 buổi",
      },
      {
        order: 4,
        title: "Chốt SOW cuối cùng",
        description:
          "Cập nhật bản cuối theo ý kiến, gửi bản chốt và xác nhận bằng văn bản/email trước khi bắt đầu triển khai.",
        owner: "PM",
        duration: "1 ngày",
      },
    ],
    outcome:
      "SOW được khách xác nhận chính thức, mọi tranh chấp phạm vi sau này dựa trên bản chốt.",
  },
  {
    name: "Xử lý blocker / vướng mắc triển khai",
    category: "delivery",
    description:
      "Quy trình khi dự án gặp blocker: khách chưa phản hồi, thiếu thông tin, lỗi môi trường, chờ bên thứ ba — để không bị trễ tiến độ âm thầm.",
    triggers: ["blocker", "vướng", "chưa fix", "chờ phản hồi", "chờ bên", "chặn", "đang chờ"],
    steps: [
      {
        order: 1,
        title: "Nhận diện & đánh giá mức độ",
        description:
          "Xác định blocker ảnh hưởng tới task/timeline nào, của bên nào (KH, nội bộ, bên thứ ba), thời điểm bắt đầu chờ.",
        owner: "PM",
        duration: "Ngay khi phát hiện",
      },
      {
        order: 2,
        title: "Thông báo rõ ràng cho các bên",
        description:
          "Nhắn nhóm chat + email cho bên liên quan: nêu rõ cần gì, deadline cần phản hồi, hậu quả nếu chậm.",
        owner: "PM",
        duration: "Trong ngày",
      },
      {
        order: 3,
        title: "Theo dõi & nhắc lại theo lịch",
        description:
          "Nhắc lần 2 sau 1-2 ngày không phản hồi; leo thang lên quản lý/ticket ISD nếu quá 2 lần nhắc hoặc gần deadline.",
        owner: "PM",
        duration: "2 ngày / lần nhắc",
      },
      {
        order: 4,
        title: "Cập nhật rủi ro lên board & ticket",
        description:
          "Ghi rõ blocker trên task (note), đổi status, cập nhật ticket ISD nếu ảnh hưởng timeline cam kết.",
        owner: "PM",
        duration: "Sau mỗi lần cập nhật",
      },
    ],
    outcome:
      "Blocker được gỡ hoặc được quản lý minh bạch (đã leo thang/đổi timeline có xác nhận), không để trễ âm thầm.",
  },
  {
    name: "Chốt quyết định giữa các bên",
    category: "delivery",
    description:
      "Quy trình khi có quyết định cần chốt giữa khách hàng / nội bộ / bên thứ ba (chọn phương án, chốt IP, chốt công nghệ) — tránh bàn mãi không xong.",
    triggers: ["chốt", "quyết định", "chọn phương án", "phương án nào", "chốt ip", "chọn công nghệ"],
    steps: [
      {
        order: 1,
        title: "Xác định quyết định & người quyết định",
        description:
          "Nêu rõ câu hỏi cần chốt, các phương án kèm ưu/nhược, ai là người có quyền chốt (KH? quản lý nội bộ?).",
        owner: "PM",
        duration: "Ngay khi phát sinh",
      },
      {
        order: 2,
        title: "Chuẩn bị tài liệu so sánh",
        description:
          "Soạn so sánh phương án: chi phí, thời gian, rủi ro, tác động scope — gửi kèm email/chat trước buổi chốt.",
        owner: "PM",
        duration: "1-2 ngày",
      },
      {
        order: 3,
        title: "Tổ chức buổi chốt (meeting)",
        description:
          "Mời đủ người quyết định, trình bày ngắn gọn, ghi nhận quyết định + lý do + người chịu trách nhiệm.",
        owner: "PM",
        duration: "1 buổi",
      },
      {
        order: 4,
        title: "Gửi biên bản & triển khai",
        description:
          "Gửi biên bản xác nhận quyết định qua email/chat, cập nhật task tương ứng ngay sau đó.",
        owner: "PM",
        duration: "1 ngày",
      },
    ],
    outcome:
      "Mọi quyết định quan trọng đều có biên bản + người chịu trách nhiệm, không treo tranh luận quá 1 tuần.",
  },
  {
    name: "Bàn giao dự án cho vận hành",
    category: "handover",
    description:
      "Quy trình bàn giao khi dự án hoàn thành triển khai: kiểm tra checklist, bàn giao tài liệu, huấn luyện và đóng ticket.",
    triggers: ["bàn giao", "handover", "hoàn thành", "đóng dự án", "nghiệm thu"],
    steps: [
      {
        order: 1,
        title: "Rà soát checklist bàn giao",
        description:
          "Kiểm tra toàn bộ deliverables theo SOW, dọn các task còn nợ, xác nhận không còn blocker.",
        owner: "PM",
        duration: "3-5 ngày",
      },
      {
        order: 2,
        title: "Chuẩn bị tài liệu bàn giao",
        description:
          "Tài liệu vận hành, hướng dẫn, cấu hình, mật khẩu/quyền truy cập (bảo mật) — gửi đúng đầu mối KH.",
        owner: "PM + Team",
        duration: "2 ngày",
      },
      {
        order: 3,
        title: "Huấn luyện / demo cho khách",
        description:
          "Tổ chức demo tính năng hoàn thiện + huấn luyện team vận hành của khách; ghi nhận câu hỏi còn lại.",
        owner: "PM",
        duration: "1 buổi",
      },
      {
        order: 4,
        title: "Chốt nghiệm thu & đóng ticket",
        description:
          "Xin xác nhận nghiệm thu bằng văn bản, cập nhật ticket ISD sang trạng thái hoàn thành, tổng kết bài học.",
        owner: "PM",
        duration: "1 tuần sau demo",
      },
    ],
    outcome:
      "Khách ký nghiệm thu, ticket ISD đóng, tài liệu + quyền truy cập bàn giao đầy đủ, bài học được lưu lại.",
  },
  {
    name: "Cập nhật tiến độ định kỳ cho khách hàng",
    category: "general",
    description:
      "Quy trình gửi cập nhật tiến độ định kỳ (weekly) cho khách hàng trong thời gian triển khai — giữ niềm tin, sớm phát hiện lệch kỳ vọng.",
    triggers: ["tiến độ", "progress", "báo cáo", "update", "cập nhật", "weekly", "tuần này"],
    steps: [
      {
        order: 1,
        title: "Tổng hợp việc đã xong trong tuần",
        description:
          "Rà task done/processing trên board + tin nhắn chat trong tuần, chọn điểm nổi bật cho KH.",
        owner: "PM",
        duration: "30 phút",
      },
      {
        order: 2,
        title: "Gửi báo cáo ngắn gọn",
        description:
          "Gửi qua email + nhắc trong group chat: việc xong, việc đang làm, việc cần KH hỗ trợ, rủi ro (nếu có).",
        owner: "PM",
        duration: "Cuối tuần",
      },
      {
        order: 3,
        title: "Theo dõi phản hồi",
        description:
          "Nếu KH không phản hồi sau 2 ngày, nhắc lại; chú ý dấu hiệu không hài lòng để xử lý sớm.",
        owner: "PM",
        duration: "2 ngày",
      },
    ],
    outcome:
      "KH luôn nắm tiến độ, không bất ngờ khi chậm, các yêu cầu mới được phát hiện sớm.",
  },
  {
    name: "Phản hồi yêu cầu thay đổi scope (change request)",
    category: "general",
    description:
      "Quy trình khi khách hàng yêu cầu thêm việc ngoài phạm vi SOW — tránh làm miễn phí, giữ lịch trình, ghi nhận rõ.",
    triggers: ["thêm", "ngoài scope", "yêu cầu mới", "change", "phát sinh", "thêm tính năng", "làm thêm"],
    steps: [
      {
        order: 1,
        title: "Tiếp nhận & phân loại yêu cầu",
        description:
          "Ghi nhận yêu cầu từ chat/email, xác định thuộc scope hay ngoài scope, mức độ ảnh hưởng (nhỏ/lớn).",
        owner: "PM",
        duration: "Ngay khi nhận",
      },
      {
        order: 2,
        title: "Ước lượng & gửi đề xuất",
        description:
          "Ước lượng công sức + ảnh hưởng timeline, gửi đề xuất (chấp nhận/đổi timeline/phát sinh phí) cho khách.",
        owner: "PM",
        duration: "2-3 ngày",
      },
      {
        order: 3,
        title: "Chốt với khách & cập nhật SOW",
        description:
          "Khi khách đồng ý phương án: cập nhật SOW/phụ lục, ghi note trên project, thông báo team.",
        owner: "PM",
        duration: "1 ngày",
      },
      {
        order: 4,
        title: "Theo dõi thực hiện",
        description:
          "Tạo task cho phần phát sinh, theo dõi tới khi xong và nghiệm thu cùng KH.",
        owner: "PM",
        duration: "Theo task",
      },
    ],
    outcome:
      "Mọi yêu cầu ngoài scope đều được định giá/chốt văn bản trước khi làm, không phát sinh làm miễn phí.",
  },
  {
    name: "Xử lý khách chưa phản hồi lâu ngày",
    category: "general",
    description:
      "Quy trình khi khách hàng im lặng (không trả lời chat/email) kéo dài — cần kích hoạt lại và quyết định leo thang.",
    triggers: ["không phản hồi", "im lặng", "không trả lời", "chưa trả lời", "no reply", "chưa thấy phản hồi"],
    steps: [
      {
        order: 1,
        title: "Nhắn lại qua kênh khác",
        description:
          "Sau 2 ngày không phản hồi kênh cũ, nhắn qua kênh khác (Zalo ↔ Teams/email), nêu rõ cần phản hồi trước deadline nào.",
        owner: "PM",
        duration: "2 ngày sau tin cuối",
      },
      {
        order: 2,
        title: "Gọi điện / nhờ Sale liên hệ",
        description:
          "Nếu vẫn im lặng, nhờ Sale/đầu mối quen liên hệ điện thoại — thường hiệu quả nhất với khách nội bộ.",
        owner: "PM + Sale",
        duration: "2-3 ngày sau",
      },
      {
        order: 3,
        title: "Đánh dấu rủi ro trên dự án",
        description:
          "Nếu quá 1 tuần chưa liên lạc được: đánh dấu blocker/risk trên board, thông báo quản lý, xem xét tạm hoãn việc cần KH xác nhận.",
        owner: "PM",
        duration: "1 tuần",
      },
    ],
    outcome:
      "Luôn có trạng thái liên lạc rõ ràng với KH, không để dự án đứng im âm thầm vì chờ phản hồi.",
  },
];

async function main() {
  const existing = await import("../src/lib/repo/businessProcesses").then((m) =>
    m.getBusinessProcesses(userId)
  );
  if (existing.length > 0) {
    console.log(`[Seed] User ${userId} đã có ${existing.length} quy trình — bỏ qua (tránh trùng).`);
    console.log("[Seed] Nếu muốn seed lại: xoá dữ liệu cũ trong trang Kho quy trình rồi chạy lại.");
    return;
  }

  let saved = 0;
  for (const sample of SAMPLES) {
    await createBusinessProcess({ userId, ...sample });
    saved++;
    console.log(`  - ${sample.name}`);
  }
  console.log(`[Seed] Xong: đã tạo ${saved}/${SAMPLES.length} quy trình mẫu cho user ${userId}.`);
  console.log("[Seed] Mở trang /business-processes để xem.");
}

main().catch((e) => {
  console.error("[Seed] Lỗi:", e);
  process.exit(1);
});
