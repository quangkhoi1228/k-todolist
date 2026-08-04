# Bảng Logic Hành Động — Dự án FRT AI Agent FMON (id 18)

> Bảng mô tả các hành động cần thực hiện trong dự án, dựa trên phân tích chat Teams + Zalo hiện có.
> File này để **PM cùng chỉnh sửa** — thêm/sửa logic trực tiếp trong bảng.

---

## 1. Bối cảnh dự án

- **Dự án:** FRT AI Agent FMON (id 18)
- **Nhóm chat đang theo dõi:**
  - `[TEST] Grouping Verify` (teams) — chat test, 8 tin
  - `[TEST] Teams Real` (teams) — chat thật, 10 tin
- **Trạng thái:** Đang triển khai, có 2 ticket VPC + yêu cầu cấp storage

---

## 2. Bảng logic hành động

| # | Giai đoạn | Hành động | Người thực hiện | Điều kiện kích hoạt (Trigger) | Input (dữ liệu cần) | Suy luận / Tại sao | Kết quả mong muốn (Outcome) | Trạng thái |
|---|-----------|-----------|-----------------|-------------------------------|----------------------|--------------------|------------------------------|------------|
| 1 | Chuẩn bị | Tạo ticket rename VPC "VPC-UICVN-DEV" → "UICVN-PROD-VPC" | Hung Duong Tan | Khách cần đổi tên VPC trước khi triển khai | Tên VPC cũ/mới, link ticket `38075` | Đổi tên sau khi dựng sẽ ảnh hưởng dịch vụ bên trong, nên phải làm trước | Ticket được tạo, L1 process sớm để triển khai kịp | ✅ Ticket đã tạo |
| 2 | Chuẩn bị | Tạo ticket VPC Transit "UICVN-TRANSIT-VPC" | Hung Duong Tan | Khách cần kết nối VPC transit | Tên VPC transit, link ticket `ISD-93421` | Cần ticket riêng để nhóm hạ tầng xử lý | Ticket được tạo và xử lý | ✅ Ticket đã tạo |
| 3 | Theo dõi | Đôn đốc FCI.SUPPORT process ticket rename VPC sớm | PM (Khoi) | Ticket `38075` chưa được process | Số ticket, trạng thái ticket | Yêu cầu process sớm để không chặn tiến độ triển khai | Ticket được xử lý trước ngày triển khai | 🔄 Cần theo dõi |
| 4 | Xác nhận | Xác nhận rủi ro đổi tên VPC với khách | PM (Khoi) | FCI.SUPPORT cảnh báo: "dựng rồi mà đổi tên VPC là dịch vụ bên trong sẽ bị ảnh hưởng" | Nội dung cảnh báo, trạng thái VPC | Xung đột giữa yêu cầu đổi tên và ảnh hưởng dịch vụ → cần làm rõ trước khi thực hiện | Khách chấp thuận phương án + không gián đoạn dịch vụ | 🔄 Cần xác nhận |
| 5 | Yêu cầu | Làm rõ yêu cầu cấp storage cho 2 VM | PM (Khoi) | FCI.SUPPORT: "e chưa clear yêu cầu luôn ấy", đưa ra 2 phương án (1 ổ rời external / 2 VM cùng dùng 1 ổ) | Loại storage (external/shared), số VM, dung lượng | Thiếu thông tin loại storage → thực hiện sai → phải hỏi khách qua Zalo | Yêu cầu storage được xác định rõ, đội ngũ thực hiện chính xác | 🔄 Cần làm rõ |
| 6 | Xác định | Xác định team hạ tầng phụ trách | PM (Khoi) | Nhut hỏi "team hạ tầng là ai anh nhỉ" | Tên đầu mối | Trả lời `cuonglc19@fpt.com` | Team hạ tầng được xác định | ✅ Đã trả lời |
| 7 | Giao việc | Giao L1 thực hiện (đã xác nhận làm được) | PM (Khoi) | Nhut: "a có hỏi team Hạ tầng, note a Team L1 làm được" | Danh sách L1 | L1 đã xác nhận khả năng thực hiện → giao việc | Việc được giao đúng người | ✅ Đã xác nhận |

---

## 3. Quy ước trạng thái

| Ký hiệu | Ý nghĩa |
|---------|---------|
| ✅ | Đã hoàn thành |
| 🔄 | Đang cần theo dõi / làm rõ |
| ⏳ | Chờ xử lý |
| ❌ | Chặn / không thực hiện được |

---

## 4. Ghi chú chỉnh sửa

- Thêm dòng mới: copy 1 dòng trong bảng, sửa nội dung theo hành động mới.
- Cột **"Suy luận / Tại sao"** là phần quan trọng nhất — nó giúp agent (và PM) hiểu logic vì sao hành động cần làm, từ đó tự động đề xuất chính xác hơn.
- Sau khi sửa xong, nói cho agent biết để agent cập nhật prompt phân tích chat cho khớp logic.
