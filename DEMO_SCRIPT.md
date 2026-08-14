# 🎯 Demo PM Agent — 5 Phút Knockout

> **Nguyên tắc**: Không giải thích nhiều. **Show, don't tell.** Chỉ 2 cú demo live, mỗi cú phải khiến người xem "ồ".

---

## ⏱️ Phút 0:00–0:40 — MỞ: Vấn đề THẬT, đau THẬT

> *"Tôi là PM ở FCI. Mỗi ngày tôi mở ISD xem ticket, rồi mở Teams đọc tin, rồi mở Zalo đọc tin, rồi tự nhớ 'dự án này đến bước nào rồi, việc tiếp theo là gì'. 15 dự án. Hàng trăm tin nhắn. Bỏ sót 1 tin = trễ 1 tuần."*

> *"Tôi build PM Agent để giải quyết cái đó."*

**Màn hình**: Kanban board đầy project thật. Dừng 2 giây cho ban giám khảo thấy scale.

---

## ⏱️ Phút 0:40–2:30 — CÚ 1: AI đọc 100+ tin nhắn → hành động 1 click

> *"Đây là 1 dự án thật đang chạy."*

**👉 Thao tác LIVE:**

1. **Click project** → tab **Chats** — cuộn nhanh cho thấy **tin nhắn Teams/Zalo thật**, sync tự động bằng browser automation
   > *"Agent tự vào Teams, Zalo của tôi — đọc hết tin nhắn — sync về đây. Không cần API, không cần token — dùng Chrome thật."*

2. **Chuyển tab Gợi ý** → PhaseWorkflowCard hiện lên
   > *"AI đã đọc hết tin nhắn. Nó biết dự án đang ở phase nào. Và nó gợi ý cho tôi: bước tiếp theo cần làm gì."*

3. **Click vào bước "Gửi tin nhắn chào Sale"** → nội dung đã soạn sẵn → **bấm "Gửi qua Teams"**
   > *"Tin nhắn AI soạn. Xưng hô đúng tên, đúng giới tính Sale. Tôi chỉ bấm 1 nút."*

> **🔥 Nếu có mạng**: gửi thật lên Teams trên sân khấu. Ban giám khảo thấy tin nhắn bay vào Teams = instant wow.
> Nếu không có mạng: show nội dung soạn sẵn + deep link Teams là đủ.

---

## ⏱️ Phút 2:30–4:10 — CÚ 2: Chat tiếng Việt → task xuất hiện trên Kanban

> *"PM Agent không chỉ gợi ý. Tôi nói chuyện với nó bằng tiếng Việt."*

**👉 Thao tác LIVE — gõ thật trước mặt ban giám khảo:**

1. **Mở PM Agent chat** (dùng Chat Page `/pm-agent/chat`, KHÔNG dùng Popup)

2. **Gõ:**
   ```
   Tạo task cho dự án: Chuẩn bị SoW hạn ngày mai, Họp kick-off tuần sau, Gửi báo giá cho khách hạn thứ 6
   ```

3. **Chờ 2-3s** → AI trả về preview 3 task với **title, priority, deadline đúng**
   > *"Nó hiểu 'ngày mai' là ngày nào, 'tuần sau' là ngày nào. Không bịa ngày."*

4. **Bấm "Xác nhận"** → toast "Đã tạo 3 task"

5. **Chuyển qua tab Kanban Board** (đã mở sẵn) → **3 task mới xuất hiện** trong cột To Do
   > *"Xong. Từ lời nói → task trên board. Không cần điền form, không cần click 3 lần."*

> **🎯 Đây là khoảnh khắc wow nhất** — gõ tiếng Việt tự nhiên → task tự sinh → thấy ngay trên Kanban.

---

## ⏱️ Phút 4:10–5:00 — ĐÓNG: Giá trị + AI trong phát triển

> *"PM Agent giải quyết 1 bài toán đơn giản: **PM không phải nhớ, AI nhớ hộ. PM không phải viết, AI viết hộ. PM chỉ cần ra quyết định.**"*

> *"Stack: Next.js 16, PostgreSQL, Playwright, OpenAI. 100% code viết cùng AI — từ schema database đến browser automation. AI giúp giảm 70% thời gian phát triển. Và sản phẩm này đang chạy thật — dữ liệu trên màn hình là dữ liệu production của FCI."*

**Dừng. Cảm ơn. Nhận câu hỏi.**

---

## 🔍 Kết quả kiểm tra Demo Readiness

### ✅ Hoạt động tốt
| Thành phần | Trạng thái |
|---|---|
| `npm run dev` (Turbopack) + `node_modules` + `.env.local` | ✅ Sẵn sàng |
| PM Agent chat → `add_task` flow (detect → preview → confirm → create) | ✅ |
| `parse-intent` API + relative dates (`today/tomorrow/+N`) | ✅ |
| Task preview UI (confirmation card, title + priority + deadline) | ✅ |
| PhaseWorkflowCard trong tab Gợi ý (render đúng phase) | ✅ |
| Workflow steps (Gửi tin chào Sale, Nhập sơ bộ, Sinh scope AI) | ✅ |
| "Gửi qua Teams" button (deep link + `/api/agents/teams-send`) | ✅ |
| Tab Chats hiện tin nhắn sync (avatars, platform badges, quotes) | ✅ |

### ⚠️ Cần chuẩn bị TRƯỚC khi demo

| # | Vấn đề | Cách xử lý | Mức |
|---|---|---|---|
| 1 | **PMAgentPopup tạo task xong KHÔNG refresh Kanban** (thiếu `invalidate()` SWR) | **Dùng Chat Page** (`/pm-agent/chat`) thay Popup. Chat Page có invalidate đúng. Hoặc F5 Board. | 🔴 |
| 2 | **Sale Email phải có sẵn** trên project — không có → nút "Gửi Teams" bị ẩn | Kiểm tra project demo có member Sale với email | 🔴 |
| 3 | **Chrome CDP port 9222** phải chạy nếu gửi Teams thật | `open -n -a "Google Chrome" --args --user-data-dir=".teams-session/chrome-profile" --remote-debugging-port=9222` | 🟡 |
| 4 | **Project demo cần `teamsGroups`** — ít nhất 1 nhóm Teams | Kiểm tra tab Chats có nhóm | 🟡 |
| 5 | **Không auto-redirect về Board** sau tạo task | Mở sẵn Board ở tab riêng, switch qua | ℹ️ |
| 6 | **13 file chưa commit** — feature demo ở working tree | Không ảnh hưởng dev, nhưng nên commit | ℹ️ |

---

## 📋 Checklist trước khi lên sân khấu

- [ ] `npm run dev` đang chạy, app load được `localhost:3000`
- [ ] Đã đăng nhập Clerk (không redirect `/sign-in`)
- [ ] Board có 4+ project thật, có data sync
- [ ] 1 project có **Sale member với email** (nút Gửi Teams hiện)
- [ ] 1 project có **nhóm Teams** trong tab Chats (có tin nhắn sync)
- [ ] 1 project ở **phase Init** (demo workflow card)
- [ ] Chrome CDP port 9222 đã mở (nếu gửi Teams thật)
- [ ] **Mở sẵn 2 tab**: Chat Page (`/pm-agent/chat`) + Board (`/board`)
- [ ] `OPENAI_API_KEY` trong `.env.local` còn hạn

---

## 🛡️ Backup nếu demo bị lỗi

| Lỗi | Xử lý |
|---|---|
| Chat AI trả chậm/fail | Screenshot/video dự phòng trên điện thoại |
| Task không hiện trên Board | F5 reload Board — SWR fetch lại |
| Teams gửi fail | Show nội dung soạn sẵn, nói "demo offline" |
| App crash | Mở video recording backup |

**⚠️ Quay sẵn 1 video backup 2 phút** trước khi lên sân khấu.

---

## 🧠 Câu hỏi hóc búa từ Ban Giám Khảo (Q&A)

| Câu hỏi | Trả lời |
|---|---|
| 💥 **1. Bảo mật & Rò rỉ dữ liệu:** *"Đưa hết chat của khách hàng/nội bộ cho AI, làm sao đảm bảo không rò rỉ bí mật kinh doanh?"* | *"Kiến trúc PM Agent hoàn toàn **decoupling (tách biệt) với LLM**. Chỉ cần sửa file env `.env.local` trỏ Base URL sang một model Open-Source (như Llama 3/Qwen) host ngay trên server nội bộ của FPT Smart Cloud. Dữ liệu sẽ 100% không bao giờ rời khỏi hạ tầng công ty."* |
| 💥 **2. Hallucination (AI Bịa chuyện):** *"Làm sao đảm bảo AI không tự bịa ra task ảo hoặc deadline sai khiến dự án vỡ tiến độ?"* | *"Sản phẩm áp dụng mô hình **Hybrid (LLM + Rule-based)**. Ví dụ: AI rất hay bịa ngày quá khứ. Đội ngũ đã code logic bắt AI chỉ được trả về ngày tương đối ('ngày mai', 'tuần sau', '+3 ngày'). Sau đó Server code (chạy bằng code cứng) sẽ tự tính toán ra ngày thật dựa trên đồng hồ hệ thống. Mọi thứ AI sinh ra đều đi qua lớp filter này."* |
| 💥 **3. Độ bền vững (UI Changes):** *"Teams/Zalo rất hay update giao diện. Dùng Playwright crawl thì app của bạn có 'chết' liên tục không?"* | *"Đúng là có rủi ro, nhưng hệ thống có script **Hourly Healthcheck** chạy ngầm để phát hiện lỗi UI sớm. Nếu Zalo đổi UI, app sẽ cảnh báo PM thao tác tay tạm thời. Tương lai có thể dùng Vision AI (như GPT-4o) để agent tự 'nhìn' giao diện thay vì lệ thuộc vào DOM selector."* |
| 💥 **4. Mâu thuẫn thông tin:** *"Khách chat trên Zalo 'Làm tính năng A', 5 phút sau Sếp chat trên Teams 'Dừng tính năng A'. AI của bạn xử lý thế nào?"* | *"AI được nhồi context theo **Time-series (trình tự thời gian)** trộn từ cả 2 kênh. Nó hiểu tin sau ghi đè tin trước. Quan trọng hơn, hệ thống thiết kế theo hướng **Co-pilot (Gợi ý)** chứ không phải Auto-pilot (Tự chạy). AI tổng hợp conflict, PM là người bấm nút duyệt cuối cùng."* |
| 💥 **5. Giá trị cốt lõi (Over-engineering?):** *"PM tự tạo task tốn có 2 phút, bạn có đang làm phức tạp hóa vấn đề không?"* | *"1 dự án thì 2 phút, nhưng 15 dự án thì PM bị mất **Context-switching cost (chi phí chuyển đổi tư duy)** rất lớn. Giá trị lớn nhất không phải là tiết kiệm 2 phút gõ phím, mà là **Chống trôi việc, chống quên**, giúp PM giải phóng 'Mental Bandwidth' để tập trung giải quyết vấn đề thay vì đi nhặt nhạnh thông tin."* |
| *"Sao không dùng API Teams?"* | *"Teams Graph API yêu cầu admin consent toàn tenant. Playwright + Chrome thật bypass — không cần IT approve."* |
| *"Scale cho nhiều PM?"* | *"Multi-user sẵn — Clerk auth, userId isolation trên mọi table."* |
