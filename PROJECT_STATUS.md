# Hiện trạng dự án K-Todolist

> File này là **nguồn sự thật** về trạng thái dự án — dùng làm đầu vào cho mọi task tiếp theo.
> Cách cập nhật: sửa trực tiếp file này khi bắt đầu/kết thúc 1 task. Xem mục [Giữ file đúng hiện trạng](#giữ-file-đúng-hiện-trạng).

- **Cập nhật lần cuối:** 2026-08-05
- **Commit HEAD:** `ef0ce04` — `feat: suggestions actions (add task, send Teams/Zalo) + session/login fixes`

---

## 1. Dự án là gì

**K-Todolist** — công cụ quản lý dự án/PM cho cá nhân (PM Khôi), Next.js 16 + App Router, PostgreSQL/Drizzle. Đóng vai trò **PM Agent**: theo dõi ticket ISD, đồng bộ message từ Microsoft Teams + Zalo, phân tích thành gợi ý hành động (suggestions), quản lý project/task/notes trên Kanban board.

### Stack chính

| Phần | Công nghệ |
|------|-----------|
| Frontend | Next.js 16.2.10, React 19, Tailwind v4, shadcn/ui, `@base-ui/react`, `react-resizable-panels` |
| Editor | Tiptap 3 (rich text, table, image…), `@tiptap/markdown` |
| Kanban/Gantt | `@dnd-kit` (drag-drop), `gantt-task-react` |
| Backend/Database | **PostgreSQL + Drizzle ORM** (đã migrate từ Convex — commit `25633bc`, 2026-08-02) |
| Auth | Clerk (`@clerk/nextjs`) |
| AI | `openai` SDK — gọi LLM qua `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `LLM_MODEL` (env) |
| Browser automation | Playwright với Chrome thật (`useRealChrome: true`) — **bắt buộc** vì Teams/Zalo chặn headless |
| Data | SWR (`src/hooks/useData.ts`) |

### Lưu ý quan trọng
- Backend **không còn Convex** — đã chuyển hoàn toàn sang PostgreSQL. Không viết code Convex mới.
- Next.js bản này có **breaking changes** so với training data — đọc guide trong `node_modules/next/dist/docs/` trước khi viết code.
- `.env.local` chứa `DATABASE_URL`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `LLM_MODEL`, ISD creds.

---

## 2. Kiến trúc & luồng chính

```
ISD (servicedesk.fci.vn)          Teams / Zalo (browser thật)
        │                                  │
        ▼                                  ▼
  fetch-isd / refresh-isd-statuses    teams/zalo automator (Playwright + Chrome thật)
        │                                  │
        ▼                                  ▼
   ┌──────────────────────────────────────────────────┐
   │  src/lib/repo/*  (PostgreSQL qua Drizzle)         │
   │  projects · tasks · taskDependencies · notes      │
   │  projectSuggestions · projectChats · projectIsd   │
   │  projectMembers · projectRoles · syncLogs · …     │
   └──────────────────────────────────────────────────┘
        ▲                                  ▲
        │ src/app/api/data/* (Repo)        │ src/app/api/agents/* (pipeline)
        │                                  │
   UI pages (board/gantt/list/…   PM Agent (chat với LLM, workflow
   suggestions panel)             kickoff→sow→triển khai→bàn giao)
```

### Luồng "suggestions" (trọng tâm hiện tại)
1. `sync-all-projects.ts` / `sync-single-chat.ts` → `team`/`zalo-automator` chạy Playwright Chrome thật → lưu chat vào `projectChats`.
2. `monitor-messages` / `analyse-suggestions` → LLM phân tích message → gợi ý lưu vào `projectSuggestions`.
3. `generate-project-suggestions/route.ts` → match trạng thái ticket ISD → sinh gợi ý kịch bản (vd: kickoff → gợi ý "Gửi tin nhắn chào Sale").
4. UI hiển thị gợi ý trong **SuggestionsQuickView** (panel phải) + **ProjectDetailPanel** (tab Suggestions).
   - Người dùng có thể: Đã xử lý · Thêm task · Nhắn kênh (Teams/Zalo) · **Gửi Email** (mới, đang dang dở).

### Ping/SSE vs polling
- `useData` dùng SWR (polling/invalidate), không có real-time server push. Fetch chat có thể **kẹt lâu** khi browser thật (Chrome profile) bị mở popup/login — không phải app treo.

### Các khu vực code chính
- `src/app/(dashboard)/` — board, gantt, list, notes, omni, pm-agent (chat + `[id]` + new), projects (+`[id]`), settings/roles, email.
- `src/app/api/data/*` — repo cho UI (projects, tasks, notes, suggestions, chats, groups, members, roles, isd, logs, emails, files, preferences, agents-pm).
- `src/app/api/agents/*` — pipeline PM agent (parse-intent, match-project, fetch-isd, refresh-isd-statuses, sync-groups, sync-projects, sync-single-chat, monitor-messages, analyse-suggestions, generate-project-suggestions, teams/zalo-automator, teams/zalo-send, teams-messages, outlook-send, health-status, project-teams-groups).
- `agents/pm/lib/` — automator (Teams/Zalo bằng Chrome thật), teams-monitor, outlook-automator, intent-parser, llm-client, isd-api, workflow (các bước PM), monitor.
- `agents/pm/scripts/` — scripts chạy ngoài: sync-all-projects, sync-single-chat, sync-all-groups, teams/zalo-extractor/health/list-chats/send, teams-automator, zalo-automator, outlook-send, hourly-healthcheck. *(Các script này được route API gọi — không được xoá.)*
- `src/lib/db/schema.ts` + `src/lib/repo/*` + `src/lib/db/index.ts` — DB layer. Push schema: `npm run db:push`.

---

## 3. Tính năng / Đang làm được gì

**Đã hoạt động (tương đối ổn định):**
- Kanban board drag-drop, tạo/sửa/xoá project & task, filter, archive, clone project, auto-shift task quá hạn.
- Gantt chart có dependency visualization; quản lý task dependencies.
- Note editor Tiptap (rich text, table, image, sticky toolbar, share qua slug).
- Email composer (Outlook) — `EmailComposeDialog`/`EmailComposeInline`, lưu `sentEmails`, tìm `knownRecipients`.
- PM Agent: session theo ticket ISD, workflow `init → teams_intro → consulting_check → kickoff → sow_draft → sow_review → in_progress → handover → completed`, prompt chat (LLM) trong PMAgentPopup / chat page.
- Sync Teams + Zalo bằng Playwright **Chrome profile thật** (`useRealChrome: true`, `createStealthContext`); sync từng chat, sync all groups/projects; health check; sync logs.
- ISD pipeline: fetch ticket (fetch-isd), refresh statuses, lưu `projectIsdData`; match trạng thái → suggestions.
- Suggestion actions: mark read/resolve, **Thêm task**, **Nhắn kênh** (chọn nhóm Teams/Zalo từ teamsGroups), "Sao chép tin nhắn".

**Đang làm dở (working tree — CHƯA commit, khả năng chưa hoàn thiện):**
1. **Gửi Email cho suggestion kickoff** — `generate-project-suggestions/route.ts` thêm `saleEmail`/`emailSubject`/`emailBody`; `SuggestionsQuickView` + `ProjectDetailPanel` + PMAgentPopup + chat page thêm nút "Gửi Email" mở `EmailComposeDialog` với data mặc định (to=saleEmail, subject/body từ suggestion).
   - *Cần kiểm tra:* field `saleEmail` có được populate đúng từ ISD reporter/requester không; email flow có chạy được end-to-end không (ProjectDetailPanel đã render `EmailComposeDialog` ở `onOpenChange`).
2. **Zalo list-chats quét cả chat 1:1** (không còn chỉ lọc tab "Nhóm") + `teams-list-chats` thêm section "Favorites/Gần đây" và skip label ảo.
3. **Chat page + channel dropdown** trong ProjectDetailPanel: `fetchChats(platform)` cho phép tải từng nền tảng, dropdown mới ("Tải danh sách nhóm" khi rỗng).
4. **Đã xoá** `sync-hungdt.ts` (script dùng 1 lần).
5. **Đã gỡ hook auto check** (05/08) — xoá `afterAgentResponse` trong `.cursor/hooks.json` (trước đây tự chạy `npx tsc --noEmit` sau mỗi lần agent trả lời, gây chậm/treo khi đang sửa dở) + xoá `.cursor/hooks/build-check.sh`. Thay bằng **rule `final-build-check.mdc`**: agent tự chạy `node_modules/.bin/tsc --noEmit` **một lần ở bước cuối** sau khi sửa xong hết, fix lỗi rồi mới báo hoàn thành.

**Còn biết tới (chưa confirm làm / tồn đọng):**
- `src/proxy.ts` + `proxy-image` — proxy image (cần xác nhận role hiện tại).
- PWA manifest (`manifest.ts`), theme toggle.
- File docs mô tả quy trình nghiệp vụ: `docs/cloud-project-deployment-process.md`, `docs/fmon-project-action-logic.md` (logic dự án FMON - id 18, vẫn 🔄 vài mục).

---

## 4. Next actions trước mắt

1. **Hoàn thiện & test luồng "Gửi Email" suggestion kickoff** — chạy `npm run build`/lint để bắt lỗi type; verify `EmailComposeDialog` mở đúng khi bấm "Gửi Email" (ProjectDetailPanel, SuggestionsQuickView).
2. **Commit working tree hiện tại** (sau khi test) — gồm thay đổi: PMAgentPopup, teams/zalo-list-chats, chat page, generate-project-suggestions, ProjectDetailPanel, SuggestionsQuickView (thêm "Gửi Email" + dropdown tải nhóm).
3. **Verify sync thật** — chạy `HEADLESS=false npx tsx agents/pm/scripts/sync-all-projects.ts` / `sync-single-chat.ts` (Chrome thật), kiểm tra list-chats mới (chat 1:1 Zalo, section Favorites) có bị nhiễu label ảo không.
4. **Xác nhận luồng suggestions end-to-end** — từ message → `analyse-suggestions` → hiển thị + action thành công (add task / nhắn kênh / gửi email).
5. **Sau khi ổn định** — đánh giá: tự động hóa theo dõi ISD status (scheduled), gắn `team` field check, tối ưu luồng kickoff (đã có `docs/fmon-project-action-logic.md` làm mẫu).

### Lưu ý về run check
- **Agent tự chạy check ở bước cuối** (sau khi sửa xong hết) theo rule `.cursor/rules/final-build-check.mdc`: `node_modules/.bin/tsc --noEmit`, fix lỗi đến khi exit 0, trước khi báo hoàn thành.
- Không thêm lại hook `afterAgentResponse` auto-chạy `tsc` — nó khiến agent chậm/treo khi làm việc dài.

### Chú ý khi làm task
- **Bắt buộc browser thật để verify** feature nào liên quan Teams/Zalo/rendering (file rule `real-browser-verification`).
- **Dọn dẹp file tạm sau task** (debug/test scripts, screenshot) trước khi kết thúc (file rule `cleanup-after-task`).
- Không tự ý xoá script trong `agents/pm/scripts/` đang được route API gọi, không xoá dữ liệu DB/ISD/Teams/Zalo.

---

## 5. Các quyết định & ràng buộc đã biết

- **DB:** PostgreSQL/Drizzle — schema tại `src/lib/db/schema.ts`; không quay lại Convex.
- **Browser automation:** phải dùng Chrome thật (channel "chrome" + user-data-dir thật), không Playwright chromium headless mặc định (Teams/Zalo detect bot).
- **AI/LLM:** chỉ dùng qua `src/app/api/agents/*` hoặc `agents/pm/lib/llm-client` — không nhúng key vào client.
- **App: đã có login bắt buộc** (Clerk) cho dashboard; landing page riêng.
- **Naming:** UI dùng Convex-style `_id`/`_creationTime` (repo `mapProject` chuyển đổi từ drizzle id).

---

## 6. Giữ file đúng hiện trạng

- **Bắt đầu task:** đọc file này trước; cập nhật mục 3/4 (trạng thái + next action) nếu task làm thay đổi hiện trạng.
- **Kết thúc task:** cập nhật lại mục 1 (ngày, commit HEAD), mục 3 (cái gì mới hoạt động), mục 4 (next action mới).
- **Quy ước trạng thái:** ✅ hoàn thành · 🔄 đang làm/đang dang dở · ⏳ chờ · ❌ chặn.