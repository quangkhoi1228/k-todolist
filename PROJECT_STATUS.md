---
noteId: "b23fc800930511f19112294d6cf59d6f"
tags: []

---

# Hiện trạng dự án K-Todolist

> File này là **nguồn sự thật** về trạng thái dự án — dùng làm đầu vào cho mọi task tiếp theo.
> Cách cập nhật: sửa trực tiếp file này khi bắt đầu/kết thúc 1 task. Xem mục [Giữ file đúng hiện trạng](#giữ-file-đúng-hiện-trạng).

- **Cập nhật lần cuối:** 2026-08-11 (card Quy trình dự án: lấy tên/email Sale từ ISD, xưng hô đúng giới tính, nút deep link Teams mở chat 1:1 + auto-fill tin nhắn)
- **Commit HEAD:** `ef0ce04` — `feat: suggestions actions (add task, send Teams/Zalo) + session/login fixes` *(working tree có thay đổi chưa commit — xem mục 3)*

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
- **Verify UI app (K-todolist) KHÔNG cần user đăng nhập lại** — đã có sẵn session Clerk. Xem mục `### Verify UI app đã đăng nhập sẵn (Clerk)` bên dưới.

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
   - Người dùng có thể: Đã xử lý · Thêm task · **Gửi tin nhắn qua Teams** (deep link chat 1:1 với Sale, nội dung prefill sẵn).

### Verify UI app đã đăng nhập sẵn (Clerk) — CHỈ khi user yêu cầu

- **KHÔNG tự ý mở browser để verify UI** — mở Chrome/profile tốn thời gian. Chỉ mở khi user chủ động yêu cầu (quyết định 11/08).
- **Session Clerk app nằm trong Chrome profile thật của user** tại `~/Library/Application Support/Google/Chrome/` (thư mục gốc, chứa `Default/` — 983M). Cookies `localhost|__session` còn hạn tới 2027.
- **Phải COPY profile (user hỏi 11/08 "sao ko dùng luôn")**: profile thật đang bị Chrome user mở giữ `SingletonLock` → mở instance CDP trỏ thẳng vào sẽ thoát/từ chối. Copy sang `/tmp/kflow-login-profile` **giữ nguyên Cookies** (session không mất), chỉ xoá lock/history/session-restore/Login Data. Chi tiết xem `.cursor/rules/verify-app-login.mdc`.
- **SAI LẦM CẦN TRÁNH** (đã mắc 07/08): dùng `chromium.launchPersistentContext` trỏ vào **profile con `Default`** (vd `/Users/.../Google/Chrome/Default`) → Chrome tạo `Default/Default` mới → **mất session, bắt đăng nhập** dù cookie vẫn còn. Cũng **không dùng** `--user-data-dir="$HOME/.../Google/Chrome"` kèm `--remote-debugging-port` trực tiếp: Chrome báo *"DevTools remote debugging requires a non-default data directory"*. **Không dùng profile `.teams-session/*`/`.zalo-session/*` để mở app** — chỉ có session Teams/Zalo, không có Clerk → bắt đăng nhập.
- **CÁCH ĐÚNG — 1 lệnh (script `scripts/verify-ui-open.sh`, verified 11/08 OK — CHỈ khi user yêu cầu)**:
  1. Mở: `scripts/verify-ui-open.sh` (tuỳ chọn `"<url>" [port]`, mặc định `http://localhost:3000/projects` port 9222). Script tự copy profile → xoá lock files → mở Chrome CDP bằng `open -n` (không dùng `nohup & disown` — dễ chết process).
  2. Verify qua `http://127.0.0.1:9222/json/list` — page URL trỏ `/projects` (không phải `/sign-in`) là session OK. Có thể chụp screenshot bằng Playwright `connectOverCDP` (VD: `npx tsx` script nhỏ gọi `chromium.connectOverCDP("http://127.0.0.1:9222")` → `page.screenshot()`).
  3. Khi xong: `scripts/verify-ui-open.sh --stop` (tắt Chrome + dọn profile copy).
  - Nếu dùng Playwright `launchPersistentContext` thì trỏ **thư mục gốc** `/tmp/kflow-login-profile` (KHÔNG phải `/tmp/kflow-login-profile/Default`).
- **Lưu ý**: copy profile này KHÔNG nên dùng để chạy sync Teams/Zalo (dùng `.teams-session/chrome-profile` / `.zalo-session/chrome-profile` riêng, xem mục CDP bên dưới).

### Ping/SSE vs polling
- `useData` dùng SWR (polling/invalidate), không có real-time server push. Fetch chat có thể **kẹt lâu** khi browser thật (Chrome profile) bị mở popup/login — không phải app treo.

### Các khu vực code chính
- `src/app/(dashboard)/` — board, gantt, list, notes, omni, pm-agent (chat + `[id]` + new), projects (+`[id]`), settings/roles, email.
- `src/app/api/data/*` — repo cho UI (projects, tasks, notes, suggestions, chats, groups, members, roles, isd, logs, emails, files, preferences, agents-pm, **project-workflows**).
- `src/app/api/agents/*` — pipeline PM agent (parse-intent, match-project, fetch-isd, refresh-isd-statuses, sync-groups, sync-projects, sync-single-chat, monitor-messages, analyse-suggestions, generate-project-suggestions, teams/zalo-automator, teams/zalo-send, teams-messages, outlook-send, health-status, project-teams-groups).
- `agents/pm/lib/` — automator (Teams/Zalo bằng Chrome thật), teams-monitor, outlook-automator, intent-parser, llm-client, isd-api, workflow (các bước PM), monitor (**tham khảo kho business processes khi phân tích gợi ý**).
- `agents/pm/scripts/` — scripts chạy ngoài: sync-all-projects, sync-single-chat, sync-all-groups, teams/zalo-extractor/health/list-chats/send, teams-automator, zalo-automator, outlook-send, hourly-healthcheck. *(Các script này được route API gọi — không được xoá.)*
- `src/lib/db/schema.ts` + `src/lib/repo/*` + `src/lib/db/index.ts` — DB layer. Push schema: `npm run db:push`.
- Scripts seed/test reusable: `scripts/test-db.ts`, `scripts/check-pg-*`.

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
- Suggestion actions: mark read/resolve, **Thêm task**, "Sao chép tin nhắn".
- **Gộp tab Gợi ý — PhaseWorkflowCard thay thế list suggestion cũ** (11/08, code xong, **user không yêu cầu verify UI**): user quyết định **tạm loại bỏ toàn bộ logic gợi ý trong tab Gợi ý** (sẽ bổ sung sau) và **bỏ PhaseWorkflowCard khỏi tab Thông tin dự án**. Kết quả trong `ProjectDetailPanel.tsx`: xoá hết state/handler/JSX suggestion cũ (`projectSuggestions`, `smx`, `tmx`, `runSuggestionAnalysis`, `handleAddSuggestionTask`, `analysingSuggestions`, `suggestionsError`, `expandedSuggestionId`, `addingTaskId`, `taskError`, `taskAddedId`, `analysisAttemptedRef`, `projectChatsRef`, `getGroupAction`, interface `SuggestionRow`, import `useSuggestionsByProject`/`useSuggestionMutations`/`useTaskMutations`); tab Gợi ý giờ chỉ chứa `PhaseWorkflowCard`; tab Thông tin dự án chỉ còn WYSIWYG editor; label tab bỏ badge unread. Data layer (`projectSuggestions` table + API + hooks + `SuggestionsQuickView` global) **giữ nguyên** — chỉ gỡ UI trong tab project detail. `tsc --noEmit` exit 0.
- **Workflow dự án init → kick-off** (11/08): `projectWorkflows` table + card "Quy trình dự án" trong tab Thông tin dự án — gợi ý mẫu tin nhắn chào Sale (copy), gợi ý nhập thông tin sơ bộ (pre-sale + nhóm external/internal), chuyển phase `kickoff`, gợi ý câu hỏi hỏi Pre-sale/Sale, nhập yêu cầu sơ bộ → **tự sinh task tracking** (`[Kickoff] ...`). Mỗi bước đánh dấu done → update tiến độ. Phase hiển thị badge trên Kanban board (Init/Kick-off). **Check lại 11/08**: tsc + build OK; API test full flow (ensure → step → data → phase → generate tasks → taskIds) chạy đúng, phase đồng bộ vào `projects`; verify browser thật CDP 9223 — project 16 (init): card + hint + nút "Đã gửi" bước 1 hoạt động, nút Chuyển Kick-off chỉ hiện khi đủ 2 bước; project 45 (kickoff): card hiển thị 2 task tracking tự sinh. **Fix nhỏ**: `moveToKickoff` giờ giữ nguyên trạng thái `skipped` của bước đã bỏ qua (trước ghi đè thành done); toast sau lưu requirements gộp luôn số task đã sinh.
- **Role capabilities + member permissions** (11/08): `CAPABILITY_CATALOG` (10 chức năng) trong `src/lib/roleCapabilities.ts` (file thuần, dùng chung server/client); `projectRoles.capabilities` + `projectMembers.permissions` (jsonb) — UI settings/roles tick chức năng theo role, MemberCard hiển thị + chỉnh chức năng riêng member (ghi đè role). **Đã xoá cơ chế Kho quy trình (businessProcesses)** — table + page + API + hooks + sidebar link đã gỡ.

**Đang làm dở (working tree — CHƯA commit, khả năng chưa hoàn thiện):**
1. **Deep link Teams cho suggestion kickoff** — `generate-project-suggestions/route.ts` thêm `saleEmail`/`emailSubject`/`emailBody`/`teamsDeepLink`/`input`/`reasoning`/`expectedOutcome`; `SuggestionsQuickView` + `ProjectDetailPanel` + PMAgentPopup + chat page thêm:
   - **Chỉ còn 1 nút "Gửi tin nhắn qua Teams"** trên card suggestion kickoff → mở deep link `https://teams.microsoft.com/l/chat/0/0?users=<email>&message=<nội dung>` tự điền sẵn tin nhắn vào ô soạn thảo Teams. Đã **bỏ** các nút: "Sao chép tin nhắn" (dialog chỉnh sửa/copy), "Gửi Email", "Nhắn kênh" (menu chọn Teams/Zalo + email dialog cho suggestion) — cả QuickView lẫn ProjectDetailPanel.
   - *Đã thử @mention (prepend `@Tên sale`) nhưng Teams không resolve @ từ deep link nên đã gỡ.*
   - *Cần kiểm tra:* field `saleEmail` có được populate đúng từ ISD reporter/requester không (quyết định nút có hiển thị hay không).
2. **Suggestion "Thêm nhóm nội bộ & khách hàng vào dự án"** — khi project ở trạng thái **kickoff**, `generate-project-suggestions/route.ts` sinh thêm suggestion `groupAction: "add_groups"`:
   - `SuggestionsQuickView` + `ProjectDetailPanel` hiển thị nút **"Thêm nhóm vào dự án"** (màu cam) trên card suggestion → click chuyển sang tab **Chats** + tự mở dialog **"Thêm nhóm Chat mới"** (đã verify browser: URL `/projects/<id>?tab=chats&addGroup=1`, dialog mở sẵn).
   - Cơ chế: QuickView dùng `router.push` với query `?tab=chats&addGroup=1`; `projects/[id]/page.tsx` đọc `tab` trong `useEffect` (tránh hydration error — không đọc `searchParams` trong `useState` init); `ProjectDetailPanel` đọc `addGroup=1` → `handleTabChange("chats")` + `setIsGroupManagerOpen(true)`.
   - **Dialog thêm nhóm đã nâng cấp: thêm nhiều nhóm cùng lúc** (05/08) — dạng multi-row, mỗi dòng chọn nền tảng (Teams/Zalo) + loại nhóm (Khách hàng/Nội bộ) + tên nhóm (có dropdown gợi ý từ danh sách chat đã tải); nút "Thêm dòng" để thêm row, "Thêm N nhóm" submit batch; cùng lúc lưu `pm.updateProject(teamsGroups)` toàn bộ + tự động `sync-single-chat` cho từng nhóm mới thêm (đã verify bằng browser thật: thêm 2 nhóm mix Teams+Zalo, dữ liệu DB đúng platform/type).
   - **UX dialog thêm nhóm** (05/08): khi mở dialog → tự động thêm sẵn 1 dòng nhập + focus ô tên + mở sẵn dropdown gợi ý danh sách nhóm (Teams/Zalo đã tải) → user thấy ngay gợi ý, không phải tự click thêm dòng; nút "Tải danh sách nhóm (Teams + Zalo)" luôn hiển thị; khi chưa tải danh sách → dropdown hiện hint "Chưa có danh sách nhóm" + nút tải (fix lỗi trước đó: bản multi-row đầu mất phần hint/nút tải khi chưa có dữ liệu).
   - **Fix dropdown gợi ý bị cắt/không hiện trong dialog thêm nhóm** (05/08): nguyên nhân kép — (1) dropdown `absolute` nằm trong container `.space-y-2 max-h-64 overflow-y-auto` bị clip bởi `overflow` của container (chỉ cao bằng 1 dòng nhập); (2) dù đã chuyển sang `position: fixed`, dropdown vẫn bị tính sai vị trí (render lệch ~850px sang phải, xuống dưới) vì Radix Dialog tạo containing block khiến `fixed` behave như `absolute` so với dialog content. **Giải pháp**: render dropdown qua **React Portal** (`createPortal(..., document.body)`) với vị trí đo từ `getBoundingClientRect` của input (`dropdownAnchor` state, cập nhật khi focus/typing/scroll) — dropdown thoát hẳn khỏi dialog DOM nên không bị clip cũng không bị lệch vị trí. Đã verify bằng browser thật: mở dialog tự hiện 97 nhóm, gõ "FRT" filter ra 12 kết quả hiển thị đúng ngay dưới ô nhập (elementFromPoint xác nhận visible), chọn item điền đúng tên, thêm dòng 2 + chuyển Zalo dropdown vẫn hoạt động, đóng dialog không còn dropdown rò rỉ.
   - **Dropdown gợi ý rõ platform** (05/08): theo yêu cầu user "search chỉ thấy option Teams" — giữ nguyên cơ chế dropdown chỉ filter theo platform của row (đã xác nhận với user), nhưng thêm header dính đầu dropdown **"Nhóm Teams (97)" / "Nhóm Zalo (67)"** để user biết đang search trong kênh nào + hint khi không có kết quả: *"Đổi Nền tảng sang Zalo nếu nhóm bạn cần thuộc kênh kia..."*. Đã verify: search "thần tài" (chỉ có ở Zalo) khi row đang Teams → hiện hint đổi platform; chuyển Zalo → ra đúng kết quả.
   - **Section "Nhóm đã sync" trong tab Chats** (05/08): hiển thị nhóm Teams/Zalo đã lưu trong DB `scrapedGroups` (đếm tổng, badge nền tảng, **hiện đầy đủ tất cả nhóm — đã bỏ giới hạn 60 nhóm/nền tảng**, trước đây slice(0,60) khiến user không thấy đủ nhóm + cá nhân 1:1 khi tổng > 120) với nút **+** click 1 lần thêm thẳng vào dự án (`quickAddGroup` — lưu `teamsGroups` + auto `sync-single-chat`), nhóm đã thêm hiện dấu ✓. Kèm caption "Nhóm đã lưu trong DB sau khi tải danh sách".
   - **Fix sync nhóm bị URL** (05/08): dữ liệu cũ lưu **URL deep link làm tên nhóm** trong `teamsGroups`/`customerGroupUrl`/`internalGroupUrl` (vd `https://zalo.me/g/...`, `https://teams.microsoft.com/l/chat/...`) → `sync-all-projects` đem đi search sidebar → spam "Không tìm thấy chat". 3 lớp fix:
     1. **`sync-all-projects.ts`**: skip mọi group có name là URL (`/^https?:\/\//i`) + **trim trước khi check** legacy fields (dữ liệu cũ có space đầu chuỗi nên `startsWith("http")` không nhận diện được).
     2. **`sync-single-chat.ts`**: `extractNameFromUrl()` — nếu chatName là URL thì trích ID → sync với tên `[Teams] 19:...` / `[Zalo] okcmgz519` (đúng platform), URL không nhận diện được → báo lỗi rõ ràng và thoát sớm (không mở browser).
     3. **`ProjectDetailPanel.tsx`**: khi dán URL vào ô tên nhóm → tự detect platform + đổi tên thành `[Zalo] okcmgz519`/`[Teams] 19:...`, hiện hint xanh "Tự nhận diện: nhóm Zalo (...)" hoặc hint vàng nếu link không nhận diện được. Đã verify browser: dán Zalo link → hint hiện + submit lưu DB đúng `{name: "[Zalo] okcmgz519", platform: "zalo"}` (trước đây lưu URL raw + platform teams).
   - **`sync-all-groups.ts`**: đồng bộ expand sections ("Favorites/Gần đây/Recent/Yêu thích") + skip label ảo (giống `teams-list-chats`) để quét đủ chat 1:1.
   - **Đã dọn data cũ**: xoá URL raw khỏi legacy fields project 16 (`customerGroupUrl`/`internalGroupUrl`); DB hiện sạch — scan toàn bộ projects không còn URL làm tên nhóm.
   - **Fix mất dữ liệu scraped groups** (05/08) trong `src/lib/repo/groups.ts`: `syncGroups` trước đây **xóa toàn bộ nhóm stale** mỗi lần sync — khi listing bị lỗi (chỉ trả 1-2 nhóm, vd Zalo) thì 60+ nhóm cũ bị xóa sạch khỏi DB. Giờ chỉ xóa stale khi listing mới có **≥ 5 nhóm** (listing thành công hầu như luôn ≥ 5), listing lỗi sẽ giữ nguyên dữ liệu cũ. Đã verify: Zalo 67 + Teams 97 nhóm được giữ nguyên sau sync.
2. **CDP mode — kết nối Chrome thật qua DevTools Protocol** (05/08, giải quyết "Teams chặn profile test"):
   - `teams-automator.ts` + `zalo-automator.ts`: khi `USE_CDP=1` → `chromium.connectOverCDP("http://127.0.0.1:9222")` kết nối **Chrome thật do user mở tay** (đăng nhập Teams/Zalo sẵn, không bị detect bot); `fakeBrowser.close()` no-op để **không đóng Chrome của user**; **bỏ hẳn `context.route` interceptor trong CDP mode** (mỗi `route.continue()` là 1 CDP roundtrip — làm Teams chậm cực nặng, script 20s chạy thành 5 phút).
   - Mọi script (`teams/zalo-list-chats`, `sync-all-groups`, `sync-single-chat`, `sync-all-projects`) trong CDP mode **tìm tab Teams/Zalo đã mở sẵn** (`pages().find(p => p.url().includes("teams.microsoft.com"))`) → dùng lại, không mở tab mới (tránh tích tụ tab nặng).
   - `teams-list-chats.ts` + `zalo-list-chats.ts`: gộp extract + scroll vào **1 `page.evaluate`** (giảm CDP roundtrip, script ~10-20s thay vì 5+ phút) + **thêm `process.exit(0)`** ở cuối (CDP connection giữ event loop sống → process không bao giờ thoát, UI tưởng script treo).
   - `navigateToTeams`: nếu page đã ở `teams.microsoft.com`/`teams.live.com` → **không navigate lại** (tránh reload SPA nặng, giữ sidebar state).
   - **Cách mở Chrome thật với CDP** (đã verify 05/08): `open -n -a "Google Chrome" --args --user-data-dir="/Volumes/home/Project/k-todolist/.teams-session/chrome-profile" --remote-debugging-port=9222 --no-first-run --no-default-browser-check` — dùng `open -n` (detached khỏi shell, không bị kill khi terminal đóng). Profile `.teams-session/chrome-profile` vẫn giữ session Teams đăng nhập. Khi Chrome bị đóng (user tắt / restart), script CDP fail `ECONNREFUSED` → cần mở lại Chrome theo lệnh trên.
   - **Kết quả verify (05/08):** `teams-list-chats` CDP lấy 96 chat Teams ~20s; `sync-all-groups PLATFORM=teams` lưu 52 nhóm thật vào `scrapedGroups` cho `user_3GR4jOa1wskoz2wg26s8X2D9FOZ` (các mục 1:1/"Unread"/"Unknown User" bị filter); UI dropdown "Thêm nhóm Chat mới" hiện **"Nhóm Teams (52)"** + gợi ý đầy đủ, chọn "[Internal] TCSC x FCI" → nút "Thêm 1 nhóm" active.
   - **Zalo session hết hạn** (05/08): tab Zalo bị đẩy về `id.zalo.me/account` — **cần user scan QR** trong Chrome thật để sync Zalo tiếp (Teams đã OK).

3. **Zalo list-chats quét cả chat 1:1** (không còn chỉ lọc tab "Nhóm") + `teams-list-chats` thêm section "Favorites/Gần đây" và skip label ảo.
4. **Chat page + channel dropdown** trong ProjectDetailPanel: `fetchChats(platform)` cho phép tải từng nền tảng, dropdown mới ("Tải danh sách nhóm" khi rỗng).
5. **Đã xoá** `sync-hungdt.ts` (script dùng 1 lần).
6. **Đã gỡ hook auto check** (05/08) — xoá `afterAgentResponse` trong `.cursor/hooks.json` (trước đây tự chạy `npx tsc --noEmit` sau mỗi lần agent trả lời, gây chậm/treo khi đang sửa dở) + xoá `.cursor/hooks/build-check.sh`. Thay bằng **rule `final-build-check.mdc`**: agent tự chạy `node_modules/.bin/tsc --noEmit` **một lần ở bước cuối** sau khi sửa xong hết, fix lỗi rồi mới báo hoàn thành.
7. **Fix "nhóm Teams join có nhưng không hiển thị để add vào dự án"** (06/08):
   - **Root cause 1 — dữ liệu**: `scrapedGroups` bị phân tán theo 3 userId cũ (`user_2jJ4`/`user_3GR4`/`user_3H33`) do trước đây script chạy với USER_ID khác nhau. User đang đăng nhập app (`user_3H33...`) chỉ có **1 nhóm Teams** ("Team") trong khi 52 nhóm Teams thật nằm ở user khác → "Nhóm đã sync" không hiển thị đủ. **Đã xử lý**: chạy `USER_ID=user_3H33tqEKNl3DVKINbhrQcvckqF4 PLATFORM=teams npx tsx agents/pm/scripts/sync-all-groups.ts` với Chrome thật CDP → DB giờ có **53 Teams + 67 Zalo** cho đúng user đang đăng nhập (verify: API `/api/data/groups?action=getScrapedGroups&userId=user_3H33...&platform=teams` trả 53 nhóm).
   - **Root cause 2 — UI nuốt lỗi**: `fetchChats` trong `ProjectDetailPanel.tsx` chỉ check `res.ok` (HTTP 200) mà không check `data.ok` — khi Chrome thật CDP chưa mở, script `teams-list-chats` fail (`connectOverCDP` ECONNREFUSED) nhưng route vẫn trả HTTP 200 `{ok:false}` → UI set danh sách rỗng, không báo gì. **Đã fix**: check `data.ok` + `chatFetchError` state hiển thị lỗi đỏ kèm mẹo "mở Chrome thật CDP (port 9222) trước khi tải".
   - **Verify**: `teams-list-chats.ts` qua Chrome thật CDP port 9222 lấy **96 chats Teams ~12s**; route `POST /api/agents/teams-automator` body `{action:"list_chats"}` trả `{"ok":true,"chats":[...]}` đúng. `tsc --noEmit` exit 0.
8. **Fix dữ liệu hiển thị lẫn lộn giữa các user** (06/08):
   - **Audit toàn bộ API data routes** (`src/app/api/data/*`) — xác nhận tất cả route chính đều filter theo `userId` (projects, tasks, notes, suggestions, chats, groups, emails, roles, preferences, agents-pm) hoặc theo `projectId` (members, isd, projectChats — project là của user nên không lẫn).
   - **Fix nguồn lẫn duy nhất: `syncLogs` không có cột `userId`** → trang Omni (`usePaginatedLogs`) và log toàn cục hiển thị log của **mọi user**. Xử lý:
     1. Thêm cột `userId` vào schema `syncLogs` + `npm run db:push`.
     2. Repo `syncLogs.ts`: `getLogs`/`getLogsPaginated`/`getRecentLogs` nhận thêm `userId` filter (khi có projectId → ưu tiên projectId; không projectId nhưng có userId → chỉ trả log của user đó); `addLog`/`addLogsBatch` ghi kèm `userId`.
     3. Scripts ghi log kèm `userId`: `sync-all-projects.ts`, `sync-single-chat.ts`. (`hourly-healthcheck` chạy qua launchd không gắn user → log healthcheck giữ `userId=NULL`, tự bị loại khi lọc theo user.)
     4. Route `logs` + hooks `usePaginatedLogs(userId, limit)` / `useRecentLogs(userId, type, limit)` + trang Omni truyền `userId` từ `useAuth`.
     5. **Migrate dữ liệu cũ**: gán `userId` cho 1682 log theo `projectId → projects.userId` + 431 log theo regex `user_xxx` trong message (sync-all-projects). Còn lại ~2030 log (healthcheck/sync project đã xoá) giữ `NULL` — không hiện cho ai.
   - **Verify**: API `getLogsPaginated&userId=<user>` trả đúng log của từng user (test user_3H33 vs user_3GR4 — không lẫn). `tsc --noEmit` exit 0.
9. **Fix project 45 hiển thị "chưa add nhóm nhưng có 130 message + 26 gợi ý"** (06/08):
   - **Root cause**: project 45 (`[ PM-FRT] DỰ ÁN FINOPS`) có `teamsGroups=[]` nhưng `internalGroupUrl="Team"` + `customerGroupUrl="fptchat"` (field **deprecated**). UI chỉ đọc `teamsGroups` → danh sách nhóm trống; nhưng script sync `sync-all-projects.ts` có fallback đọc field cũ → vẫn sync "Team" (lưu 130 messages `projectChats`) và monitor LLM sinh 26 suggestions — tất cả đúng user `user_3H33...`, **không lẫn user**.
   - **Nguồn gốc 2 nhóm ma**: không phải user thêm — `createProjectFromTicket` (tạo project từ ticket ISD qua PM Agent chat) đọc `customfield_14730`/`customfield_14731` của ticket Jira (ISD-93943 chứa `"Team"`/`"fptchat"`) → ghi vào `internalGroupUrl`/`customerGroupUrl` → sync-all-projects fallback đọc chúng thành nhóm thật.
   - **Đã xử lý (theo yêu cầu "xoá 2 nhóm ma")**:
     1. **DB**: xoá `teamsGroups` (2 nhóm ma), xoá 130 `projectChats`, xoá 34 `projectSuggestions`, xoá 67 `syncLogs` của project 45 → project sạch (0 message, 0 gợi ý). Verify API `getProjects` trả `teamsGroups: []`.
     2. **Chặn tái phát**: bỏ fallback legacy fields trong `sync-all-projects.ts` (không còn đọc `internalGroupUrl`/`customerGroupUrl` làm nhóm sync); `createProjectFromTicket` không ghi 2 field này vào project nữa (dữ liệu ISD vẫn lưu trong `projectIsdData` để hiển thị); `getActiveProjectsWithTeamsGroups` chỉ dựa trên `teamsGroups`.
   - **Còn lại**: project 16 có field cũ nhưng rỗng (không cần xử lý). TeamsMonitorPanel (không còn import trong app) vẫn đọc 2 field cũ — không ảnh hưởng.
10. **Animation trạng thái đồng bộ chat trên UI** (06/08):
   - Khi sync 1 nhóm chat (nút 🔄 nhóm / thêm nhóm / thêm nhanh từ "Nhóm đã sync" / "Xóa & đồng bộ lại"), UI chi tiết project giờ hiển thị:
     - **Spinner + badge "Đang đồng bộ..."** cạnh tên nhóm đang sync trong danh sách nhóm (nút 🔄 nhóm cũng thành spinner).
     - **Banner "Đang đồng bộ chat \"<tên>\"..."** phía trên messages area khi sync nhóm đang được chọn.
     - **Badge "Lỗi đồng bộ"** đỏ khi sync thất bại (tooltip hiện chi tiết lỗi).
   - Cơ chế: state `syncingGroups` (Set tên nhóm) + `syncErrors` (map tên→lỗi); helper `syncChat()` gọi `/api/agents/sync-single-chat`, invalidate `chats:`/`suggestions:`/`logs:` sau khi xong để messages mới hiện ngay. Hỗ trợ sync **nhiều nhóm cùng lúc** (mỗi nhóm có spinner riêng).
   - **Chưa verify browser** (Chrome CDP chưa mở) — cần user mở CDP port 9222 + có nhóm thật để xem animation.
11. **Kho quy trình nghiệp vụ (business processes) + tích hợp vào gợi ý** (06/08):
   - **Mục đích**: user muốn có 1 "kho quy trình" mô tả cách xử lý tình huống nghiệp vụ; phần gợi ý sẽ **tham khảo kho này + lịch sử chat** để đưa ra gợi ý.
   - **Bảng mới `businessProcesses`** (schema + `npm run db:push`): `userId`, `name`, `category` (kickoff/sow/delivery/handover/general), `description`, `steps` (jsonb array {order,title,description,owner,duration}), `triggers` (jsonb array từ khoá kích hoạt), `outcome`, `isActive`, `createdAt`, `updatedAt`. Index theo user + user/active.
   - **Repo** `src/lib/repo/businessProcesses.ts`: CRUD + `searchBusinessProcesses(userId, keywords, category?, limit)` — match theo tên/mô tả/triggers/steps (dùng `::text ilike` cho jsonb).
   - **API** `src/app/api/data/business-processes/route.ts`: GET (list/search/get-one) + POST (create/update/delete) — có `requireUserId` như các route khác.
   - **Hooks** `useDomain.ts`: `useBusinessProcesses`, `useSearchBusinessProcesses`, `useBusinessProcessMutations`.
   - **UI** `src/app/(dashboard)/business-processes/page.tsx` + link "Kho quy trình" trong Sidebar: tạo/sửa/xoá/tạm ẩn (toggle active), editor từng bước (title/desc/owner/duration), triggers dạng 1 từ khoá 1 dòng, filter nhóm + search, expand xem chi tiết.
   - **Tích hợp monitor**: `agents/pm/lib/monitor.ts` rút từ khoá từ tin nhắn → `searchBusinessProcesses` → đưa các quy trình khớp vào system prompt + user message (mục "QUY TRÌNH THAM KHẢO") → LLM tham khảo để sinh gợi ý cụ thể theo quy trình.
   - **Verify**: API CRUD + search hoạt động (curl: tạo → search match "kickoff/hợp đồng" → update → get → delete, dữ liệu demo-user đã dọn). `tsc --noEmit` exit 0.
   - **Chưa verify browser** — cần user login mở `/business-processes` xem UI; cần Chrome CDP + sync thật để thấy quy trình được LLM tham khảo trong gợi ý.
12. **Seed data mẫu cho Kho quy trình** (06/08):
   - Tạo `scripts/seed-business-processes.ts` (reusable — giữ lại): seed **8 quy trình mẫu** cho đúng user đang đăng nhập `user_3H33tqEKNl3DVKINbhrQcvckqF4`:
     1. Kickoff dự án sau khi ký hợp đồng (`kickoff`, 4 bước)
     2. Chốt SOW (Statement of Work) (`sow`, 4 bước)
     3. Xử lý blocker / vướng mắc triển khai (`delivery`, 4 bước)
     4. Chốt quyết định giữa các bên (`delivery`, 4 bước)
     5. Bàn giao dự án cho vận hành (`handover`, 4 bước)
     6. Cập nhật tiến độ định kỳ cho khách hàng (`general`, 3 bước)
     7. Phản hồi yêu cầu thay đổi scope — change request (`general`, 4 bước)
     8. Xử lý khách chưa phản hồi lâu ngày (`general`, 3 bước)
   - Mỗi quy trình có `triggers` (từ khoá kích hoạt tiếng Việt, dùng cho search/match trong monitor) + `steps` (title/desc/owner/duration) + `outcome`.
   - Script **chống chạy trùng**: nếu user đã có quy trình → bỏ qua, báo cách seed lại (xoá cũ trước).
   - **Verify**: API trả đúng 8 quy trình cho user đăng nhập; search `kickoff,blocker,bàn giao` trả 5 quy trình khớp. `tsc --noEmit` exit 0.
   - Cách chạy lại: `npx tsx scripts/seed-business-processes.ts` (hoặc `USER_ID=user_xxx` cho user khác).
13. **Fix sync Teams "Không tìm thấy chat trong sidebar"** (06/08, đã verify browser thật):
   - **Root cause 1 — double space trong tên nhóm**: Teams v2 render tên chat với **2 khoảng trắng** (`[Internal]  FRT FinOPS`), DB lưu 1 space (`[Internal] FRT FinOPS`) → `sync-single-chat.ts` tìm `text.includes(name)` **không khớp** → báo "Không tìm thấy chat trong sidebar" dù chat có ở ngay đầu danh sách. **Fix**: normalize whitespace (`replace(/\s+/g, " ")`) cả 2 phía trước khi so khớp.
   - **Root cause 2 — thiếu fallback search**: script tự viết loop tìm list-item + scroll, không có fallback qua ô tìm kiếm Teams (cơ chế robust có trong `navigateToChatInSidebar`). **Fix**: thêm hàm `searchTeamsChat(page, chatName)` — click ô search → gõ tên → click kết quả (ưu tiên group chat `@thread.v2`, rồi row khớp) — gọi khi tìm sidebar thất bại.
   - **Lỗi phát sinh khi fix (Teams CSP)**:
     1. `page.addScriptTag` bị chặn (**TrustedScript**) → thay bằng inject `window.blobToBase64` trực tiếp qua `page.evaluate`.
     2. Gán `innerHTML` bị chặn (**TrustedHTML**) tại 2 chỗ trong `extractMessages` (blockquote + div spacing) → thay bằng `textContent`.
   - **Kết quả verify (Chrome CDP thật, 06/08 17:10)**: `sync-single-chat` nhóm `[Internal] FRT FinOPS` → `Clicked chat` → `Extracted 52 messages` → `Saved 3 new messages to Postgres`. DB project 45 giờ có **52 message Teams + 127 Zalo**. `tsc --noEmit` exit 0.
   - **Lưu ý còn lại**: `[Monitor] LLM error: 524` (timeout OpenAI) — lỗi monitor riêng, không ảnh hưởng sync message.
14. **Fix miss tin nhắn quote + reaction dính body khi sync Teams** (06/08, đã verify browser thật + DB):
   - **Root cause — Teams v2 bỏ `blockquote`**: Teams v2 (2026) render tin reply bằng **"quote pill"** mới thay vì `<blockquote itemtype="schema.skype.com/Reply">` như cũ. DOM thật:
     - Container `div.fui-Flex[aria-label^="Begin quote"]` + `div[data-tid="quoted-reply-card"]` bên trong, với:
       - Sender: `span` ngay trước `[data-tid="quoted-reply-timestamp"]`
       - Content: `[data-tid="quoted-reply-preview-content"]`
       - Fallback: parse `aria-label="Begin quote, Sender, date, content, End quote"`
     - **Hệ quả khi extractor cũ không nhận diện**: nội dung quote dính thẳng vào body dạng `Sender8/6/2026 9:40 AMnội dung quote` (không separator), tin reply mất phần quote, `> Sender: quoted` không xuất hiện trong DB.
   - **Fix `teams-automator.ts`** (cả `extractMessages` lẫn `extractTextOnly`):
     1. Nhận diện quote pill mới `[data-tid="quoted-reply-card"]` → lấy sender (span trước timestamp) + content (`quoted-reply-preview-content`), fallback parse `aria-label` (chia `Begin quote` theo dấu phẩy, content có thể chứa dấu phẩy), giữ `blockquote` cũ làm fallback.
     2. Khi xoá quote khỏi body clone: xoá cả `[data-tid="quoted-reply-card"]` + blockquote.
     3. Strip chuỗi dư `Begin quote ... End quote` (regex `[\s\S]*?`) + marker ` image ` Teams v2 chèn giữa attachments.
     4. **Strip reaction summary** `.fui-ChatMessage__reactions` / `.fui-ChatMyMessage__reactions` (container `1 Heart reaction.`/`1 Like reaction.` trước đây dính vào cuối body) khỏi body clone.
   - **Verify (Chrome thật, SCROLL_COUNT=30)**: sync `[Internal] FRT FinOPS` → **101 messages, 13 có ảnh, 21 tin quote tách đúng** dạng `> Sender: quoted\nreply`, body sạch không còn `1 Heart reaction.`/`Begin quote`/`image`. **DB project 45 sau dọn duplicate cũ: 93 tin Teams (34 quote đúng format `> Sender: quoted`, 13 tin có ảnh — 8 ảnh data URL hiển thị được, 5 ảnh HTTP qua proxy-image), 0 content dính reaction/date dư**. Tin mới nhất 10:42 sáng 06/08. `tsc --noEmit` exit 0.
   - **Đã dọn dữ liệu cũ**: xoá ~50 row duplicate cũ (cùng sender+timestampMs, bản cũ dính `1 Heart reaction.` / `Sender8/6/2026...`), giữ bản mới sạch.
   - **Lưu ý**: lần sync kế tiếp upsert theo `messageId` mới (content sạch) sẽ tự ghi đè row cũ nếu còn sót; script verify reusable giữ tại `scripts/verify-teams-quote-extract.ts` (`SCROLL_COUNT=5 npx tsx scripts/verify-teams-quote-extract.ts`).
15. **Task Template + Import từ file SOW** (06/08, đã verify browser thật + DB):
   - **Mục đích**: từ file SOW (Statement of Work) của dự án (vd Domesco Migration), render ra task list theo template — template lưu trong DB tái sử dụng cho nhiều dự án; tự nhận diện loại template (Migration / Security/NGFW / WAF) theo nội dung file hoặc mô tả dự án.
   - **Bảng mới `taskTemplates`** (schema + `npm run db:push`): `userId`, `name`, `category` (migration/security/waf/general), `description`, `items` (jsonb array {phase,title,details,pic,support,manday,isGroup}), `triggers` (jsonb từ khoá auto-detect), `isActive`, `createdAt`, `updatedAt`.
   - **Repo** `src/lib/repo/taskTemplates.ts`: CRUD + `detectTemplateForProject(userId, text)` — match triggers theo từ khoá trong mô tả dự án (score theo độ dài từ khoá).
   - **Parser** `src/lib/sow-parser.ts`: đọc `.xlsx` qua `xlsx` package (mới cài `xlsx@0.18.5`), tìm sheet chứa cột "Task" (ưu tiên tên chứa "sow" trừ "High Level"), parse theo số thứ tự dạng `1`/`1.1`/`2.1.2` → phase = task cha trực tiếp, đánh dấu `isGroup` cho item có con, lấy cột Details/PIC/Support/Team/Manday; auto-detect template theo từ khoá trong nội dung file.
   - **API**:
     - `src/app/api/data/task-templates/route.ts`: GET (list/get/detectTemplateForProject) + POST (create/update/delete).
     - `src/app/api/import-sow/route.ts`: POST multipart — `previewSow` (parse file, trả template detect + items), `importSow` (tìm/tạo template theo category + tạo tasks bỏ group items), `createFromTemplate` (tạo task từ template có sẵn không cần file).
   - **UI** `src/components/board/SowImportDialog.tsx` + nút "Import SOW" trong tab Thông tin dự án (`ProjectDetailPanel.tsx`):
     - Upload file `.xlsx` → parse → **Preview** bảng task (Phase/Task/Chi tiết/PIC) + badge template detect (Migration Cloud/migration...).
     - Hoặc chọn template có sẵn (có badge "(phù hợp)" cho template detect từ mô tả dự án — tự gọi `detectTemplateForProject` khi mở dialog).
     - Bấm "Tạo N task" → tạo task (title, notes=details, pic, support, estimatedTime=manday, project) + invalidate `tasks`/`task-templates` → kanban cập nhật ngay.
   - **Seed** `scripts/seed-task-templates.ts` (reusable — giữ lại): tạo template Migration Cloud (35 items, parse từ file SOW Domesco thật) + Security/Firewall (6) + WAF (6); chạy `SEED_USER_ID=user_xxx npx tsx scripts/seed-task-templates.ts`.
   - **Verify browser thật (project 45, user đang login)**: nút Import SOW hiển thị; dialog mở đúng (3 template); auto-detect project → **Security / Firewall (phù hợp)**; upload file Domesco thật → **Preview: Migration Cloud, 27 tasks** bảng đầy đủ; tạo 27 task + reload trang → task hiển thị trên kanban. **DB**: 27 tasks đúng (title/notes=details/pic) rồi đã dọn sạch test data (project 45 = 0 tasks). `tsc --noEmit` exit 0.
16. **Sync chat incremental sau sync-all** (07/08, đã verify browser thật + DB):
   - **Mục đích**: trước đây mỗi lần sync (sync-all/sync-single) đều scroll từ tin mới nhất 30-80 lần (Teams) / 40-200 (Zalo) dù phần lớn tin đã lưu trong DB — tốn thời gian + resource. Giờ: **lần đầu sync full, các lần sau chỉ scroll tới khi gặp tin đã lưu rồi dừng sớm (incremental)**.
   - **Mốc dừng (watermark)**: `getLatestTimestampMs(projectId, chatName, platform)` — query `MAX(timestampMs)` từ bảng `projectChats` cho nhóm chat đó; nhóm chưa từng sync (không có mốc) → tự chạy full.
   - **Cơ chế early-stop**:
     - Teams (`teams-automator.ts` `incrementalScrollAndExtract`): sau mỗi batch scroll kiểm tra collection — thấy message có `timestampMs <= incrementalSince` → **break ngay, bỏ luôn Step 3 (extract top)**.
     - Zalo (`zalo-automator.ts` `scrollZaloChatContainer`): sau mỗi scroll đọc `max(bb_msg_id_<epochMs>)` của bubble trong DOM; max ≤ mốc → dừng sớm + **skip bước nudge ảnh cuối**.
   - **Quyết định chế độ**: `sync-single-chat.ts` tự gọi `getLatestTimestampMs` — có mốc → incremental (scrollCount Teams 10 / Zalo 20), không có → full (30/40); `SCROLL_COUNT=0` vẫn là "chỉ tin mới nhất"; `FULL_SYNC=true`/`SYNC_MODE=full` ép full (Teams 80 / Zalo 200).
   - **`sync-all-projects.ts`**: đọc `getUserPreferences(userId).chatSyncMode` (mặc định `incremental`) → với từng nhóm gọi `getLatestTimestampMs` truyền `incrementalSince`; user đặt "full" hoặc `FULL_SYNC=true` → quét đầy đủ.
   - **Cài đặt user**: cột mới `chatSyncMode` (default `incremental`) trong bảng `userPreferences` (schema + `npm run db:push`); UI **trang Omni** thêm dropdown "Chế độ sync" (Incremental nhanh / Full đầy đủ) cạnh dropdown hẹn giờ.
   - **UI chi tiết project**: tab Chats — nút 🔄 (incremental, mặc định) + nút mới **"Đồng bộ toàn bộ"** (full) cạnh từng nhóm; route `sync-single-chat` nhận `syncMode` body → env `SYNC_MODE`.
   - **Verify browser thật (Chrome CDP, project 45 nhóm `[Internal] FRT FinOPS`, 07/08)**: log `Incremental sync ... (watermark=1785987700000)` → `EARLY-STOP at batch 1` + `Step 3: Skipped` — chỉ ~10 scroll thay vì 30, lưu được **2 tin mới** (upsert dedup theo messageId, không duplicate). `SYNC_MODE=full` chạy lại → đủ Step 2 + Step 3 (extract top) như cũ. `getLatestTimestampMs` verify đúng với 10 nhóm thật (maxTs khớp). `tsc --noEmit` exit 0.
   - **Script verify reusable giữ lại**: `scripts/check-sync-watermark.ts` (liệt kê watermark/count theo nhóm — `npx tsx scripts/check-sync-watermark.ts`).
17. **Auto-sync thường xuyên (1/5 phút) + cơ chế queue chống đụng** (07/08):
   - **Dropdown hẹn giờ trong trang Omni** thêm option **"Mỗi 1 phút"** và **"Mỗi 5 phút"** (trước đây tối thiểu 15 phút) — user chọn 1/5/15/30/60/120 phút hoặc Tắt.
   - **`GlobalSyncManager` (layout dashboard)** nâng cấp cơ chế sync tự động:
     - Check định kỳ 10s/lần; chỉ sync khi đã đủ `autoSyncInterval` kể từ `lastSyncTime`.
     - **Queue**: nếu sync đang chạy (check `action:"status"` của `/api/agents/sync-projects`) thì **đợi tới khi xong rồi chạy tiếp** — không gửi request chồng lấn, không bị lỗi "already running" từ lock file `.teams-sync-running`.
     - Nếu `start` bị từ chối (đã có sync khác / lỗi server) → vẫn cập nhật `lastSyncTime` để không retry spam 10s/lần, lần sau đúng interval mới chạy lại.
   - **Lưu ý an toàn**: bản thân `sync-all-projects` giờ là **incremental** (chỉ tin mới, dừng sớm theo watermark) nên sync 5 phút không tốn resource như trước; nếu user bật chế độ "Full" thì 5 phút sẽ lâu — nên dùng "Incremental (nhanh)".
   - `tsc --noEmit` exit 0. Chưa verify browser (cần user login bật hẹn giờ) — xem Next actions #0.
18. **Gửi tin nhắn vào Nhóm Teams từ UI** (07/08, đã verify browser thật + dry-run thật):
   - **Mục đích**: trước đây composer chat chỉ gửi được **Zalo** (`/api/agents/zalo-send`). Giờ gửi được **cả Teams** qua `/api/agents/teams-send` (API + script `teams-send.ts` + `sendTeamsMessage` trong `teams-automator.ts` đã có sẵn từ trước, chỉ thiếu UI hook).
   - **UI** `src/components/board/ProjectDetailPanel.tsx`: composer đổi từ `handleSendZalo` (chỉ Zalo) → **`handleSendChat(chatName, platform, message)`** — platform `zalo` → `/api/agents/zalo-send`, còn lại → `/api/agents/teams-send`. Textarea + nút gửi (Enter hoặc click) hiện cho **cả nhóm Zalo lẫn Teams**; placeholder theo platform: *"Soạn tin nhắn, nhấn Enter để gửi tới Teams..."*.
   - **Fix bug search nhầm người khi gửi Teams** (`teams-automator.ts` `navigateToChatInSidebar`): khi tìm chat 1:1 "An Mai Thuan", logic cũ ưu tiên **Group trước Person** → click nhầm group "Internal - PM CDC..." (member list chứa chữ khớp first-word "Anh") → verify chặn đúng (không gửi nhầm). **Fix**: đảo ưu tiên **Person trước Group** + yêu cầu mọi từ trong tên target xuất hiện trong candidate (tránh khớp substring 1 từ).
   - **Verify (07/08)**:
     - **Dry-run thật với Chrome thật** (`teams-send.ts --chat "An Mai Thuan" --dry-run`): search click đúng **"Person: An Mai Thuan (ANMT3) FCI - CLOUD"** → `Verify OK: chat="An Mai Thuan"` → nhập 42 ký tự rồi **xoá, KHÔNG gửi** (dry-run an toàn).
     - **UI browser thật** (CDP profile copy đã login Clerk — xem mục "Verify UI app đã đăng nhập sẵn"): project 45 → tab Chats → chọn "An Mai Thuan | Teams" → composer hiển thị placeholder *"...gửi tới Teams..."*, nút title **"Gửi tin nhắn Teams"** disabled khi trống → gõ chữ → nút active. `tsc --noEmit` exit 0.
   - **Script verify reusable**: `scripts/verify-teams-send-ui.ts` (cần Chrome CDP port 9222 + profile copy đã login, xem rule `verify-app-login.mdc`).
   - **Lưu ý**: tên chat đúng trong DB là **"An Mai Thuan"** (teams, KH) — project 45; alias hiển thị là ANMT3.
19. **Fix Zalo chat 1:1 gán nhầm "Me" + fix tranh chấp Chrome profile healthcheck** (08/08, verify browser thật):
   - **Vấn đề**: user báo chat đơn Zalo nhận hết tin là "me nhắn". Điều tra sâu với probe DOM thật (dump class từng wrapper) xác nhận: **logic `isMine`/`sender` trong `zalo-automator.ts` đã ĐÚNG từ trước** — tin partner (vd "00:11nhà mới nó nè babii", "Nay hello nữa babii") có `me` token class chính xác (`chat-message... -send-time` không có `me`, `chat-item` không `me`), DB cũng lưu đúng sau khi upsert (messageId không chứa sender + ON CONFLICT DO UPDATE SET isMine).
   - **Gốc rễ thật sự của "browser has been closed" / dữ liệu lẫn lộn khi sync**: launchd agent `~/Library/LaunchAgents/com.kflow.healthcheck.plist` (chạy mỗi giờ, `RunAtLoad`) spawn `hourly-healthcheck.ts` → `teams-health.ts` + `zalo-health.ts` dùng **cùng profile Chrome** `.teams-session`/`.zalo-session` với sync/send → 2 Chrome cùng profile đè nhau, xoá SingletonLock của nhau, giết Chrome của nhau giữa chừng → sync bị "Target page, context or browser has been closed", lưu dữ liệu dở dang.
   - **Fix** (`agents/pm/scripts/teams-health.ts`, `zalo-health.ts`): healthcheck giờ dùng **profile riêng** `.health-session/teams-profile` + `.health-session/zalo-profile` (copy 1 lần từ profile chính để kế thừa session login; đã xoá cache — chỉ ~280MB + 45MB). Không còn đụng profile chính của sync/send.
   - **Verify (08/08)**: chạy `sync-single-chat.ts` Zalo (HEADLESS, scroll 25) **song song** với `hourly-healthcheck.ts` → sync `Finished` không lỗi, healthcheck `Teams=connected Zalo=connected` khi chạy riêng. DB chat "Thảo Nguyên BB" (p35+p45): 15 tin `Me` (đều là tin Khôi Trần gửi thật, probe xác nhận `me=true`) + 7 tin `Thảo Nguyên BB` (partner, `me=false`) — **khớp 100% với DOM thật**.
   - **Lưu ý**: `.health-session/` đã thêm vào `.gitignore`.
20. **Auto-sync 1 phút cho project đang mở** (08/08, đã verify browser thật + DB):
   - **Yêu cầu**: user mở project để xem → sync tin nhắn mỗi phút 1 lần với **các nhóm đã add** (không phải sync toàn bộ dự án).
   - **Cơ chế**: `GlobalSyncManager` (dashboard layout, mọi trang) giờ **đọc URL `/projects/:id`** qua `usePathname`:
     - Đang mở project → gọi **route mới `/api/agents/sync-project-chats`** mỗi 60s → spawn script mới **`agents/pm/scripts/sync-project-chats.ts`**: sync tuần tự tất cả group trong `teamsGroups` của ĐÚNG project đó (Teams + Zalo), **incremental theo watermark** (`SYNC_MODE=full` để full), scroll giới hạn (Teams 6, Zalo 15) → mỗi vòng vài chục giây thay vì sync toàn bộ dự án.
     - Không mở project → giữ hành vi cũ: sync tất cả dự án theo `autoSyncInterval` (setting `/omni`).
   - **An toàn đồng thời**: script dùng chung lock `.teams-sync-running` (2 sync không đè Chrome profile); nếu đang có `teams-send` thì skip vòng này; client check `status` trước khi start, đợi tối đa 60s nếu sync khác đang chạy (không xếp chồng).
   - **Cơ chế**: `GlobalSyncManager` (dashboard layout, mọi trang) giờ **đọc URL `/projects/:id`** qua `usePathname`:
     - Đang mở project → gọi **route mới `/api/agents/sync-project-chats`** mỗi 60s → spawn script mới **`agents/pm/scripts/sync-project-chats.ts`**: sync tuần tự tất cả group trong `teamsGroups` của ĐÚNG project đó (Teams + Zalo), **incremental theo watermark** (`SYNC_MODE=full` để full), scroll giới hạn (Teams 6, Zalo 15) → mỗi vòng vài chục giây thay vì sync toàn bộ dự án.
     - Không mở project → giữ hành vi cũ: sync tất cả dự án theo `autoSyncInterval` (setting `/omni`).
   - **An toàn đồng thời**: script dùng chung lock `.teams-sync-running` (2 sync không đè Chrome profile); nếu đang có `teams-send` thì skip vòng này; client check `status` trước khi start, đợi tối đa 60s nếu sync khác đang chạy (không xếp chồng).
   - **Fix race lock (08/08, rà soát lại)**: route `/api/agents/sync-project-chats` ban đầu spawn + ghi đè `.teams-sync-running` **không check lock trước** (khiến `child.on("exit")` xoá lock file của sync đang chạy khác → 2 sync chạy chồng lên nhau, đè Chrome profile). Đã fix: route check `isRunning` CHUNG với `/api/agents/sync-projects` (cùng lock file) trước khi spawn, trả lỗi nếu đang chạy. `GlobalSyncManager` dùng 1 nguồn `checkIfRunning()` duy nhất (dựa trên lock chung) cho cả 2 nhánh sync — project đang mở lẫn sync-all — không còn cơ hội xếp chồng ở client.
   - **Verify (08/08, Chrome thật + session thật)**: chạy `USER_ID=user_3H33tqEKNl3DVKINbhrQcvckqF4 PROJECT_ID=45 HEADLESS=true npx tsx agents/pm/scripts/sync-project-chats.ts` → Teams "An Mai Thuan" incremental EARLY-STOP đúng watermark, Zalo "Thảo Nguyên BB" early-stop scroll 1 → **Done: 2 chats, 5 tin mới trong ~3.2 phút**; DB xác nhận tin mới nhất "oi7" (4:00 PM) là `Me`, tin "anhhhhh ơiiiiii" là `Thảo Nguyên BB` (`isMine=false`) — đúng. Lock file tự dọn sau khi xong.
   - **Lưu ý**: route mới ghi đè `.teams-sync-running` giống route sync-projects cũ — không nên bật đồng thời auto-sync project + sync-all interval cao (các lock chờ nhau).
21. **Fix nút "Tải nhóm" bị lỗi — Chrome CDP bị cleanup giết nhầm + fallback persistent profile** (08/08, đã verify browser thật):
   - **Triệu chứng**: bấm "Tải danh sách nhóm" (tab Chats) → lỗi `connect ECONNREFUSED 127.0.0.1:9222` — không lấy được danh sách Teams/Zalo.
   - **Root cause — cleanup "Chrome orphan" tự giết Chrome CDP của user**: `teams-automator.ts` + `zalo-automator.ts` có đoạn cleanup kill Chrome có `ppid=1` (mồ côi) + cmdline chứa profile path. Chrome CDP user mở tay bằng `open -n ... --user-data-dir=<profile> --remote-debugging-port=9222` có **đúng signature đó** (`open -n` tách khỏi shell → ppid=1; cmdline chứa profile path) → mỗi lần script non-CDP chạy cùng profile (vd `sync-all-projects` trước khi route set `USE_CDP`) là Chrome CDP của user bị SIGKILL → nút "Tải nhóm" (các route default `USE_CDP=1`) fail.
   - **Fix**:
     1. Cleanup orphan giờ **chỉ kill Chrome do Playwright spawn** — cmdline chứa `--remote-debugging-pipe` (luôn có ở Playwright persistent launch); Chrome CDP của user có `--remote-debugging-port=9222` → **không bao giờ bị đụng**.
     2. Watcher reap sau `launchPersistentContext` bỏ `pkill -P 1 -f <profile>` (cùng vấn đề), thay bằng **kill đúng pid Chrome Playwright** tìm được lúc khởi động (watcher vẫn chỉ fire khi cha chết → ppid=1).
     3. **Fallback CDP**: khi `USE_CDP=1` mà connect thất bại (Chrome CDP chưa mở/crash/bị kill) → **không fail cứng** — tự chuyển xuống `launchPersistentContext` với `.teams-session/chrome-profile` / `.zalo-session/chrome-profile` (cùng cookies/session, Chrome thật) → list-chats/sync vẫn chạy được.
     4. `teams/zalo-list-chats.ts` + `sync-project-chats.ts`: khi fallback (không CDP), `context.pages()[0]` là page Teams/Zalo sẵn của persistent context — không bắt buộc tìm tab `teams.microsoft.com`/`zalo.me` như CDP.
     5. Route `sync-projects` thêm `USE_CDP: process.env.USE_CDP ?? "1"` (trước đây thiếu → auto-sync-all chạy chế độ launch profile riêng).
   - **Verify (08/08, HEADLESS thật, không cần CDP port 9222)**:
     - Script trực tiếp: `USE_CDP=1 npx tsx agents/pm/scripts/teams-list-chats.ts` → log `CDP connect that bai (...) Fallback...` → mở Chrome persistent → `{"ok":true,"chats":[...~100 chats...]}`; `zalo-list-chats.ts` → `{"ok":true,"chats":[...59 chats...]}`.
     - **API end-to-end đúng luồng nút bấm** (dev server `localhost:3000`, Chrome CDP tắt hẳn): `POST /api/agents/teams-automator {action:"list_chats",headless:true}` → `ok:true, 97 chats` (~47s); `POST /api/agents/zalo-automator {action:"list_chats",headless:true}` → `ok:true, 59 chats` (~18s). Sau khi chạy: không còn Chrome orphan, lock files sạch, watcher reap đã dọn Playwright Chrome đúng pid (không đụng gì khác).
   - **Hướng dẫn**: user vẫn có thể mở Chrome CDP như cũ (nếu muốn) — giờ không còn bị kill; không mở cũng OK (fallback tự chạy).
   - **Dọn dead code (08/08)**: bỏ `queuedRef` trong `GlobalSyncManager` — chỉ set `true` rồi reset `false` mà không dùng (gây hiểu nhầm là có queue). Cơ chế chống xếp chồng là `isSyncingRef` + chờ `checkIfRunning()` — vòng 60s (project) / 10s (sync-all) tự chạy lại sau khi vòng trước xong.
   - **Lưu ý**: route mới ghi đè `.teams-sync-running` giống route sync-projects cũ — không nên bật đồng thời auto-sync project + sync-all interval cao (các lock chờ nhau).
22. **Queue sync tập trung + ưu tiên project đang xem + sync-all incremental 30 phút** (08/08, code xong — chưa verify browser):
   - **Vấn đề cũ**: mọi sync (project auto 1 phút, sync-all, sync 1 chat UI, teams-send) có lock riêng/spawn riêng → nối đuôi nhau chờ, project mở vẫn bị sync-all chen ngang.
   - **Giải pháp — `src/lib/sync-queue.ts` (queue tập trung trong next-server)**:
     - Mọi job đi qua 1 hàng đợi: `project` (project đang xem), `all` (sync-all định kỳ/manual), `single` (nút sync 1 nhóm trên UI). Worker chạy tuần tự, mỗi task = 1 nhóm chat → spawn `sync-single-chat.ts` (incremental theo watermark).
     - **Ưu tiên**: job project đang xem chạy trước mọi job khác; khi mở project trong lúc sync-all đang chạy → hủy job sync-all để nhường Chrome (`setActiveProjectId`).
     - Worker ghi `.teams-sync-running` = PID script con (teams-send/chrome ngoài thấy queue đang bận); check cả `.teams-send-running` trước mỗi task (chờ tối đa 90s rồi skip).
     - Cross-process: lock `.sync-queue-worker.lock` (atomic `wx`) chỉ 1 next-server được làm worker.
     - Scheduler `src/lib/sync-queue-runner.ts`: check mỗi 15s, sync-all chỉ chạy khi `autoSyncInterval` phút đã trôi qua (đọc từ `userPreferences`, mặc định 30 phút, 0 = tắt), không mở project, queue rỗng. Khi enqueue thành công → cập nhật `lastSyncTime` cho UI Omni.
   - **Routes**:
     - `/api/agents/sync-project-chats`: `status` (queue state + progress), `setActiveProject`/`clearActiveProject`, `syncAllNow`, hoặc POST `{projectId}` → enqueue job project.
     - `/api/agents/sync-projects`: `status` trả `running` + progress (tương thích UI Omni), `start` → enqueue job all.
     - `/api/agents/sync-single-chat`: giờ enqueue job `single` thay vì spawn — nút sync 1 nhóm trên UI cũng đi qua queue.
   - **`GlobalSyncManager`**: mount Dashboard, gọi `setActiveProject`/`clearActiveProject` khi mở/rời project; sync project mỗi 2 phút (thay vì 60s); KHÔNG tự sync-all nữa (server scheduler lo).
   - **Omni**: dropdown hẹn giờ giữ nguyên (30 phút là mặc định); `lastSyncAt` hiển thị mốc sync-all server.
   - **Omni — theo dõi queue (09/08)**: section "Queue đồng bộ" mới — hiển thị job đang chạy (label + badge loại `project`/`all`/`single` + progress bar + chat đang sync), danh sách job chờ (label + badge + số chats), trạng thái "Project đang xem được ưu tiên". Data từ `getSyncQueueStatus()` mở rộng: `queuedJobs[].chatTasks` (chatName/platform/syncMode) + `taskIndexInJob`. Poll 5s sẵn có.
   - **Omni — tiến độ từng task nhỏ + log rõ (09/08)**: `getSyncQueueStatus()` thêm `currentJobTasks[]` (mỗi task của job đang chạy có `status: pending/running/done/skipped` + projectId + syncMode); `progress.message` ghi `[Project X] "chat" (i/total)`; `queuedJobs[].chatTasks[].projectId`. UI Omni hiển thị từng task (icon trạng thái + tên + platform + mode + project), job chờ xổ danh sách chat con kèm project (cho job `all`). Log enqueue/runJob/runTask/spawnTask rõ hơn: liệt kê từng task `[Project X] "chat"`, lý do gộp, thời gian từng task, lý do skip, job bị hủy.
   - **Lưu ý nhóm chat thuộc 2 dự án**: task key gồm `projectId|chatName|platform` → cùng 1 chat ở 2 project là 2 task RIÊNG (đúng, vì message lưu theo project). UI phân biệt bằng thẻ `P{projectId}`.
   - **Gộp task trùng (dedup, 09/08)**: task mới trùng task đang chờ trong queue hoặc đang chạy (cùng `projectId + chatName + platform`) sẽ KHÔNG xếp thêm — gộp vào task cũ:
     - Task mới chỉ `incremental` → bỏ qua hoàn toàn, giữ task cũ (bấm sync nhóm nhiều lần cũng không chồng task).
     - Task mới yêu cầu `full` mà task cũ đang chờ/pending chỉ `incremental` → **nâng cấp task trong queue lên full**; nếu task cũ đang chạy → ghi vào `refetchTasks` (persist qua `.sync-queue-state.json`), task xong sẽ tự chạy lại full.
     - Job project mới thay thế job project cũ trước khi gộp (không gộp nhầm vào task sắp xóa); kể cả task chưa chạy trong job đang chạy cũng được tính là "đang cam kết" để gộp.
   - `tsc --noEmit` exit 0.
   - **Chưa verify browser** — cần user mở app + thử: project auto 2 phút, sync-all 30 phút sau khi rời mọi project.
23. **Fix spinner sync 1 nhóm bị tắt sớm khi chuyển sang queue** (09/08, code xong — chưa verify browser):
   - **Vấn đề**: sau khi chuyển sang queue tập trung (`sync-queue.ts`), route `sync-single-chat` chỉ enqueue rồi trả về ngay → `syncChat()` trong `ProjectDetailPanel` xoá spinner ngay khi fetch xong (vài mili giây), trong khi việc thật (mở Chrome + scroll lấy tin) mất cả phút — user không biết nhóm đang được sync.
   - **Fix**:
     1. `sync-queue.ts` thêm `isChatQueuedOrRunning(projectId, chatName, platform)` (hữu ích cho UI/script khác).
     2. `ProjectDetailPanel.tsx`: bỏ `finally` xoá spinner; thêm poll `/api/agents/sync-project-chats` `{action:"status"}` mỗi 2.5s — khi `currentTask.projectId === project._id` → giữ spinner đúng nhóm đang chạy; khi queue hết việc → xoá hết spinner + invalidate `chats:`/`suggestions:`/`logs:` để tin mới hiện ngay. Nhóm do tay bấm sync (pending) cũng được giữ spinner tới khi queue báo xong; queue rỗng → pending tự xoá.
   - **Fix 2 — mất loading khi bấm qua lại task (09/08, cùng ngày)**: poll effect ban đầu có early-return `pending.size===0 && !lastQueueWasRunning` đọc từ `useRef` — ref thay đổi không trigger effect chạy lại nên khi mở project lần đầu effect bỏ luôn, không bao giờ poll; đồng thời chuyển project/task làm panel remount → state mất, spinner không hiện lại khi quay về. **Fix**: poll **luôn chạy** khi panel mở; dùng `queuedSyncGroupsRef` đồng bộ state để tránh setState lặp; khi queue hết việc dọn spinner còn sót (kể cả từ mount trước) + invalidate data; chưa từng thấy queue chạy → không invalidate thừa (mở project bình thường không spam fetch/invalidate).
   - `tsc --noEmit` exit 0 (Tailwind warnings sẵn có, không liên quan).
   - **Chưa verify browser** — cần user mở project + bấm sync 1 nhóm (hoặc thêm nhóm) để xem spinner/banner hiện đúng tới khi xong, kể cả khi bấm qua lại task khác rồi quay về.
24. **Cooldown reload UI cho nhóm chat đang mở** (09/08, đã verify browser thật + CDP):
   - **Yêu cầu**: user muốn có nút reload có cooldown trong chat đang mở — trước đây tin mới chỉ tự hiện khi queue sync xong (poll 2.5s + invalidate), không có cách bấm tay để tải lại ngay.
   - **Fix `ProjectDetailPanel.tsx`**: thêm nút **"Tải lại"** (icon RefreshCw) cạnh nút "Xóa & đ.bộ lại" trong header chat của nhóm đang mở:
     - Click → **invalidate `chats:` ngay lập tức** (SWR refetch messages từ DB, tin mới đã sync hiện ngay) + **enqueue sync incremental** cho nhóm đó (lấy tin mới từ Teams/Zalo nếu chưa đang sync).
     - **Cooldown 60s**: sau click nút hiện `Tải lại (58s)` + disabled + icon xoay chậm; countdown đếm ngược từng giây qua `reloadTimerRef` interval (cleanup khi unmount); click lần 2 trong thời gian chờ bị chặn. Lý do: mỗi lần tải lại mở Chrome + scroll tốn ~20-60s — cooldown tránh spam nhiều sync chồng lên nhau.
   - **Auto-scroll xuống cuối chat khi vào nhóm** (theo yêu cầu "khi vào chat chi tiết thì scroll xuống cuối cùng chat"): messages sort theo `timestampMs` tăng dần (tin mới nhất ở cuối) → thêm `messagesScrollRef` + 2 effects:
     - Chọn nhóm chat mới → scroll xuống đáy ngay + lặp lại qua `requestAnimationFrame` + `setTimeout` 250ms/800ms (ảnh trong tin nhắn load sau làm `scrollHeight` tăng — scroll 1 lần dừng cách đáy vài trăm px).
     - Khi data SWR về muộn cho nhóm vừa chọn → scroll bổ sung 1 lần (guard `messagesScrolledRef` theo tên nhóm) — không scroll lại mỗi khi data đổi (không giật giữa chừng khi sync thêm tin vào nhóm đang xem).
   - **Verify browser thật (Chrome CDP port 9223, profile copy đã login Clerk, project 45 tab Chats)**:
     - Nút "Tải lại" hiển thị cạnh nút xóa, click → 2.5s sau nút thành `Tải lại (58s)` disabled, icon xoay; click lần 2 → `false` (bị chặn bởi cooldown).
     - Auto-scroll: chuyển nhóm An Mai Thuan (9070px) → FRT Migration TF (10895px) → Thảo Nguyên BB (2700px) → quay lại An Mai Thuan — mọi lần đều `atBottom: true` (diff 0-32px), kể cả khi cuộn lên đầu trước khi đổi nhóm.
     - `tsc --noEmit` exit 0.
25. **Fix sync Zalo thiếu message cuối + giữa chat** (09/08, đã fix + verify browser thật):
   - **Triệu chứng**: full sync UICVN (project 29) chỉ thu 93-95 message, thiếu message ở giữa chat (vd "hiện phần này chưa hỗ trợ cho mình add cả dải CIDR anh ạ" — bb_msg_id_1785998924926) dù bubble có trong DOM.
   - **Root cause 1 — extractor bỏ bubble không có sender name**: trong group chat, Zalo chỉ render tên sender ở bubble ĐẦU mỗi run; bubble tiếp theo (cùng run, không name) bị `if (!sender) continue` loại vì fallback `else if (!sender && !lastSender) sender = "Unknown"` KHÔNG gán `lastSender` khi có — sửa thành `else if (!sender && lastSender) sender = lastSender`. → bubble "add cả dải" + nhiều bubble run-tiếp-theo được collect (29 → 42 messages/collect, full sync 95 → 149).
   - **Root cause 2 — `timestampMs` cột `real` (float4) mất precision**: epoch ms ~1.7e12 bị tròn hóa (độ phân giải ~64s) → watermark `getLatestTimestampMs` lệch hàng chục giây → incremental early-stop sai chỗ + message cuối bị coi là "đã sync" dù chưa từng lưu. **Fix**: đổi `timestampMs` + `scrapedAt` sang `bigint` (đã `npm run db:push`). Watermark giờ chính xác: UICVN 1786009687448 (khớp bb_msg_id cuối).
   - **Fix phụ**: `navigateToZaloGroup` dùng **Playwright click thật** (không phải `evaluate().click()` — Zalo SPA không chuyển chat với JS click) + `verifyZaloOpenChat` đối chiếu `.header-title`/sidebar selected → abort nếu mở sai nhóm (tránh gán nhầm sender); bottom stabilization (scroll-to-bottom lặp tới khi maxTs ổn định — Zalo giữ scroll cũ khi mở lại chat đã từng mở, scroll 1 lần rơi vào giữa chat).
   - **Verify thật**: full sync UICVN project 29 → **149 messages collected, 5 new saved**, watermark chính xác 1786009687448; "add cả dải" có trong DB với sender đúng "Fci - Htkt"; incremental sync → early-stop đúng watermark, 0 new (đã đủ); full sync TCSC project 45 → 239 messages, 11 new. `tsc --noEmit` exit 0.
   - **Còn lại**: các group Zalo chưa re-sync (project 15, 33, 10, 45 "Thảo Nguyên BB") vẫn mang watermark tròn hóa cũ — đợi queue sync tới hoặc full sync lại (xem Next actions #0b).

**Còn biết tới (chưa confirm làm / tồn đọng):**
- `src/proxy.ts` + `proxy-image` — proxy image (cần xác nhận role hiện tại).
- PWA manifest (`manifest.ts`), theme toggle.
- File docs mô tả quy trình nghiệp vụ: `docs/cloud-project-deployment-process.md`, `docs/fmon-project-action-logic.md` (logic dự án FMON - id 18, vẫn 🔄 vài mục).
- `docs/dual-platform-sync-queue.md` — plan tách queue theo platform đã **implement xong** (10/08, xem mục 27); chưa verify browser thật.

**27. Tách queue sync theo platform — Teams & Zalo chạy song song (10/08, đã code pass tsc, chưa verify browser):**
  - **Mục đích**: 2 nền tảng (Teams + Zalo) dùng Chrome profile riêng, không xung đột → chạy song song giảm thời gian sync. Tham khảo `docs/dual-platform-sync-queue.md`.
  - **Thay đổi kiến trúc** (`src/lib/sync-queue.ts`):
    - 2 worker độc lập (`teamsWorker` + `zaloWorker`) dùng struct `PlatformWorkerState` (queue/currentJob/currentTask/taskStatuses/refetchTasks/runningChildren/jobStartTime/taskIndexInJob) thay vì biến duy nhất.
    - `enqueueJob()` tự tách task theo `task.platform` → 2 job (cùng `jobGroupId` cho UI gộp progress).
    - 2 worker lock riêng: `.sync-queue-teams-worker.lock` + `.sync-queue-zalo-worker.lock`.
    - Mỗi worker tuần tự nội bộ (1 Chrome profile/platform); Zalo worker **LUÔN sequential** (`canParallel=false`), Teams worker giữ parallel khi có CDP.
  - **Chống starvation (interleave + cooldown)**:
    - `setActiveProjectId()` **KHÔNG cancel** sync-all đang chạy — chỉ ghi `activeProjectId`; task project được chèn đầu queue ở `getNextJob()` kế tiếp (sau khi task đang chạy ~15s xong).
    - `markProjectSyncDone(platform, projectId)` ghi timestamp; 3 phút sau project sync mới được enqueue lại trên cùng platform → sync-all có thời gian chạy tiếp.
  - **Lock file tách riêng**: `.teams-sync-running` chỉ Teams, `.zalo-sync-running` (MỚI) chỉ Zalo. `isSyncRunning(platform)` chỉ check đúng lock; `isAnySyncRunning()` wrapper check cả 2 cho UI/scheduler.
  - **Send preemption tách theo platform**: `runTaskWithSendPreemption` chỉ check `.teams-send-running` cho Teams worker, `.zalo-send-running` cho Zalo worker (gửi Zalo không kill Teams sync và ngược lại).
  - **Files sửa kèm**:
    - `agents/pm/scripts/zalo-send.ts`: `SYNC_RUNNING_FILE` → `.zalo-sync-running` (trước check nhầm `.teams-sync-running`).
    - `agents/pm/scripts/sync-single-chat.ts`: `SYNC_RUNNING_FILE` theo `platform` env (Teams → `.teams-sync-running`, Zalo → `.zalo-sync-running`).
    - `src/app/api/agents/zalo-automator/route.ts`: `stopBackgroundSync` check `.zalo-sync-running` (multi-PID), KHÔNG còn kill Teams sync — Teams sync không ảnh hưởng login Zalo. `teams-automator/route.ts` đã đúng (check `.teams-sync-running`).
    - `src/components/board/ProjectDetailPanel.tsx`: đọc `currentTasks` (plural — mảng chứa cả Teams + Zalo task đang chạy) để hiển thị spinner nhiều nhóm cùng lúc; vẫn đọc `currentTask` (singular) backward-compat.
    - `src/lib/sync-queue-runner.ts`: comment cập nhật; scheduler giữ nguyên (dùng `status.running` + `status.queueLength` — giờ gộp 2 worker).
  - **Backward-compat UI**: `getSyncQueueStatus()` trả cả `running`/`queueLength`/`currentJob`/`currentTask`/`currentJobTasks`/`queuedJobs`/`progress` cũ (gộp 2 worker) + mới `currentTasks`/`teamsWorker`/`zaloWorker` cho UI muốn hiển thị 2 lane.
  - **Mutex cho summaries** (mục 5.18 của plan): `maybeAutoGenerateSummary` có flag `summaryGenerating[projectId]` tránh 2 worker (Teams + Zalo) trigger cùng project cùng lúc ra 2 version.
  - `tsc --noEmit` exit 0.
  - **Chưa verify browser** — cần user mở app, chạy sync với project có cả nhóm Teams + Zalo để xem 2 worker chạy song song (log `[Worker:teams]` + `[Worker:zalo]` bắt đầu gần nhau, task Teams + Zalo chạy đồng thời). Kiểm tra log KHÔNG còn `hủy job sync-all` khi mở project, KHÔNG còn kill nhầm cross-platform. Cooldown: sau project sync 3 phút → log `[Queue] ⏭ Skip ... cooldown còn Xs`.


---

## 4. Next actions trước mắt

0l. **Bổ sung lại logic gợi ý vào tab Gợi ý** (11/08, user sẽ làm sau) — tạm thời tab Gợi ý chỉ chứa PhaseWorkflowCard; toàn bộ state/handler/UI list suggestion cũ trong `ProjectDetailPanel.tsx` đã bị xoá hẳn, data layer (`projectSuggestions` + API + hooks + SuggestionsQuickView) vẫn giữ nguyên. Khi user muốn thêm lại: render lại list suggestion trong tab Gợi ý (có thể đặt dưới PhaseWorkflowCard), dùng lại `useSuggestionsByProject`/`useSuggestionMutations`.
0m. **Card Quy trình dự án — tin chào Sale đúng thông tin + deep link Teams + nhập nhóm kiểu "Thêm nhóm"** (11/08, code xong, `tsc --noEmit` exit 0, **chưa verify UI**) — `PhaseWorkflowCard` nhận thêm `saleName`/`saleEmail` từ ISD (`useIsdByProject` trong `ProjectDetailPanel` — reporter/requester/creator + email tương ứng, DB verify: project 45 ticket ISD-93943 → reporter "To Thi Cam Tu" / tutt c3@fpt.com):
   - **Xưng hô đúng giới tính**: detect gender cục bộ từ tên (mẫu "Thị/Thi" giữa tên → chị; tên đệm/tên chính thường gặp nam/nữ; không rõ → "anh/chị") — không gọi LLM ở client; tin chào hiển thị + copy đều theo gender (vd: *"Chào chị To Thi Cam Tu ơi..."*). Có `GREET_SALE_TEMPLATE_TEXT` (bản text, không link ticket) cho deep link.
   - **Style tin nhắn nhẹ nhàng hơn + nhờ add vào nhóm** (11/08): tin chào viết lại tự nhiên, mềm mại hơn — theo đúng câu user duyệt: *"Chào chị To Thi Cam Tu, em Khôi PM CDC ạ. Em mới được giao phụ trách ticket này (https://servicedesk.fci.vn/browse/ISD-93943) ạ. Dự án mới nên em chưa có nhiều thông tin, nhờ chị bớt chút thời gian chia sẻ giúp em về yêu cầu, pre-sale phụ trách và add giúp em vào các nhóm nội bộ/khách hàng nhé ạ. Em cảm ơn chị nhiều!"* — áp dụng cả 2 bản (hiển thị/copy + deep link Teams, bản text thay link bằng `(ticket ID)`).
   - **Nút "Gửi tin nhắn qua Teams"** trên step 1 (chỉ hiện khi có `saleEmail`): mở `https://teams.microsoft.com/l/chat/0/0?users=<email>&message=<tin nhắn>` — Teams mở chat 1:1 với đúng Sale + tự điền tin nhắn vào ô soạn thảo.
   - **Toggle done/chưa done + collapse từng bước** (11/08): mỗi step (Init: Gửi tin chào / Nhập thông tin sơ bộ; Kick-off: Gửi câu hỏi / Nhập yêu cầu) — click header step để **collapse/mở rộng**; nút **"Hoàn tác"** (icon quay lại) khi step đã done/skipped → xoá status trở về chưa xử lý (repo `updateWorkflowStep` nhận `status: null`); bấm "Đã gửi"/"Đã lưu"/lưu qua form → đánh done + **auto collapse** step; chưa xử lý → mặc định mở + chevron xoay.
   - **Nhập thông tin sơ bộ — chọn nhóm kiểu "Thêm nhóm"** (11/08): bỏ 2 textarea external/internal; thay bằng form chọn nhóm **mỗi dòng có Nền tảng (Teams/Zalo) + Loại nhóm (Khách hàng/Nội bộ) + Tên nhóm (dropdown gợi ý từ danh sách nhóm đã tải qua `list_chats`, portal ra body như dialog "Thêm nhóm Chat mới")**; nút "Tải danh sách nhóm (Teams + Zalo)" + "Thêm nhóm" multi-row. Khi lưu: `initData.externalGroups`/`internalGroups` giờ lưu mảng `{name, platform}` (WorkflowInitData mở rộng `WorkflowGroupRef` — đọc được cả dữ liệu cũ dạng chuỗi); **đồng thời gộp nhóm đã chọn vào `teamsGroups` của dự án + tự sync chat** qua prop mới `onSaveGroups` (ProjectDetailPanel: `handleSaveWorkflowGroups` — gộp bỏ trùng tên, `pm.updateProject` + `syncChat` từng nhóm). Sau khi done → hiển thị tóm tắt Pre-sale / Nhóm khách hàng / Nhóm nội bộ.
   - **Cần verify UI**: mở project có ticket (vd project 45) → tab Gợi ý → xem tin chào có tên Sale + xưng hô đúng, nút Teams hiện (saleEmail có sẵn) và click mở đúng chat Teams; bước "Nhập thông tin sơ bộ" → thêm nhóm chọn Teams/Zalo + Loại nhóm → dropdown gợi ý → lưu → nhóm xuất hiện trong tab Chats + `teamsGroups` DB.
0j. **Flow init → kick-off vừa làm (11/08, đã verify browser thật + check lại)** — cần user dùng thử trên dự án thật:
   - Mở project (phase Init) → tab Thông tin dự án → card "Quy trình dự án": sao chép tin chào Sale → nhập thông tin sơ bộ (pre-sale, nhóm ext/int) → bấm "Chuyển sang Kick-off" → chọn câu hỏi gửi Pre-sale/Sale → nhập yêu cầu sơ bộ → tự sinh task tracking.
   - Kiểm tra: task tracking hiện trong board (title `[Kickoff] ...`), phase badge trên Kanban, dữ liệu `projectWorkflows` trong DB.
   - Kết nối thêm (nếu muốn): tự động gửi tin nhắn chào sale / câu hỏi kick-off qua Teams/Zalo composer thay vì chỉ copy; sinh suggestions từ `projectWorkflows`; đồng bộ phase với `pmAgentSessions.currentStep`.
   - Lưu ý: `phase` mặc định `init` — dự án cũ chưa có workflow sẽ tự tạo khi mở card.
0. **Verify queue sync mới (08/08, cần user login + Chrome)** — hệ thống vừa chuyển sang queue tập trung (`src/lib/sync-queue.ts`):
   - Mở 1 project → đợi 2 phút → log server `[Sync] → Bắt đầu job: project N...` + từng task `[Sync] Done teams/xxx (exit 0)`; messages mới hiện trong tab Chats.
   - Rời project → chờ 30 phút (hoặc bấm "Đồng bộ ngay" trên Omni = enqueue sync-all) → log `[SyncScheduler]` + job `all-...`.
   - Mở project trong lúc sync-all đang chạy → sync-all bị hủy, job project ưu tiên.
   - Kiểm tra lock: chạy 2 request `sync-project-chats` liên tiếp → request sau trả `ok:true` (job thay thế, không lỗi "already running").
   - Lưu ý: 2 next-server đang chạy cùng lúc (PID #19963 + #4772) — chỉ giữ 1 dev server, worker lock chỉ cho 1 instance chạy queue.
0a. **Gửi tin thật tới "An Mai Thuan" (ANMT3)** (07/08, optional) — dry-run + UI verify đã OK; khi user muốn gửi thật: bấm gửi trong composer Teams (tab Chats project 45) → Chrome thật mở + verify header rồi mới Enter gửi; kiểm tra tin hiển thị sau khi sync.
0b. **Re-sync các nhóm Zalo còn watermark cũ** (09/08) — project 15 (`[FPTCLOUD] - UICVN`), project 33 (`[FPTCLOUD] - TCSC`), project 45 (`Thảo Nguyên BB`), project 10 (`[FPTCLOUD] - UICVN`) vẫn mang `timestampMs` tròn hóa từ `real` (float4) → chạy full sync (hoặc đợi queue tự sync) để cập nhật watermark chính xác + thu message bị thiếu. Đã fix root cause: cột đổi sang `bigint` + extractor gán `lastSender` cho bubble không name. **Lưu ý profile**: CDP port 9222 đang chạy profile `.teams-session/chrome-profile` (Teams) — sync Zalo qua CDP này sẽ KHÔNG có session Zalo; phải chạy Zalo bằng profile `.zalo-session/chrome-profile` (fallback persistent hoặc mở CDP riêng cho Zalo).
0c. **Cơ chế huỷ tab sau khi dùng xong** (09/08, đã code) — `sync-single-chat.ts`, `sync-project-chats.ts`, `sync-all-projects.ts` giờ dùng `closeOwnPageOrBrowser()`: trong CDP mode đóng ĐÚNG tab riêng script vừa mở (page.close) sau khi sync xong/lỗi, không đóng Chrome thật + tab script khác; không CDP (persistent fallback) vẫn đóng cả browser như cũ.

---

## 6. Verify end-to-end: gửi tin thật + auto-sync 2 phút (09/08, đã verify browser thật)

**Yêu cầu user**: "mở chi tiết dự án 45, gửi tin Thảo Nguyên BB (Zalo) + [Internal] Hackathon Test (Teams), check sync qua 2 phút".

1. **Đã gửi tin thật** (browser thật, đúng profile chính):
   - Zalo → `agents/pm/scripts/zalo-send.ts --chat "Thảo Nguyên BB"` → `GUI THANH CONG` (msgCount 0→2), tin: *"Test sync Zalo 09/08 18:47 — tin nhắn gửi từ hệ thống KI, các bạn bỏ qua nhé"*.
   - Teams → `agents/pm/scripts/teams-send.ts --chat "[Internal] Hackathon Test"` → `GUI THANH CONG` (search find "Group: [Internal] Hackathon TestLuan and Manh", verify header OK), tin: *"Test sync Teams 09/08 18:48 — tin nhắn gửi từ hệ thống KI, các bạn bỏ qua nhé"*.
2. **Sync 2 phút khi mở project 45 — ĐÃ CHẠY ĐÚNG**:
   - Mở `http://localhost:3000/projects/45` (Chrome real CDP 9223 + profile copy login Clerk) → `GlobalSyncManager` tự enqueue job project 45; queue `current: project 45 (4 chats)` chạy tuần tự 4 nhóm (An Mai Thuan → Thảo Nguyên BB → Hackathon Test → FRT Migration) rồi **lặp lại chu kỳ mỗi 2 phút** (job mới thay job cũ, trạng thái `activeProject=45` ghi trong `.sync-queue-state.json`).
   - **DB đã có 2 tin mới** sau sync: `[Internal] Hackathon | Me | "Test sync Teams 09/08 18:48..."` + `An Thảo Nguyên BB | Me | mine:true | "Test sync Zalo 09/08 18:47..."`.
   - **UI hiển thị đủ**: tab Chats project 45 → group "Thảo Nguyên BB" hiển thị tin Zalo mới (screenshot `/tmp/project45-messages.png`), group "[Internal] Hackathon Test" hiển thị tin Teams mới dưới "test 2" (screenshot `/tmp/project45-teams-msg2.png`); badge `Chats (324)` tăng từ 323.
3. **Lưu ý còn lại**:
   - Queue hiện có thể chạy lặp liên tục vì tab project vẫn mở (đúng cơ chế); khi đóng project sẽ dừng.
   - 2 next-server đang chạy cùng lúc (PID #77797 dev mới + #67356 cũ port 20128) — worker lock chỉ cho 1 instance chạy queue; nếu thấy queue không chạy hãy kiểm tra instance nào giữ worker lock.

0e. **Fix healthcheck dùng 2 profile khác nhau → fail "Đổi thiết bị" / trắng trang** (09/08, đã fix + verify) —
   - **Gốc rễ**: `zalo-health.ts` + `teams-health.ts` dùng **bản copy** `.health-session/<platform>-profile` (copy 1 lần từ profile chính) → Zalo xem đó như "thiết bị thứ 2" → healthcheck fail / đá logout, và login mới không đồng bộ vào bản copy (trắng trang vì window login `--keep-open` treo ở about:blank giữ SingletonLock).
   - **Fix**: 2 script health giờ gọi thẳng `createZaloStealthContext`/`createStealthContext` (helper chuẩn): CDP → connect Chrome thật đang mở; không CDP → mở **profile chính** `.zalo-session/chrome-profile`/`.teams-session/chrome-profile` (có cleanup lock an toàn, không kill Chrome thật). Khi xong CDP chỉ đóng tab mới, không đóng Chrome user.
   - **Đã verify thật**: `zalo-health.ts` → `{"ok":true,"status":"connected"}` (profile chính có session Zalo 18:06); `teams-health.ts` → `connected`. Đã kill Chrome treo `--keep-open` (giữ SingletonLock) + unlock profile.
   - Lưu ý: `.health-session/` (profile copy cũ) không còn được dùng — có thể xoá.
0e. **Fix healthcheck dùng 2 profile khác nhau → fail "Đổi thiết bị" / trắng trang** (09/08, đã fix + verify) —
   - **Zalo** (`scrollZaloChatContainer`): incremental giờ KHÔNG extract DOM sau mỗi scroll (tốn ~giây vì duyệt avatar/ảnh) — chỉ scroll + đo `maxVisibleTs` từ `bb_msg_id_` (nhẹ, 1 querySelector); gặp message <= watermark DB là `EARLY-STOP` ngay + collect DOM hiện tại rồi dừng. `scrollCount` incremental giảm 20 → 5 (an toàn fallback).
   - **Teams** (`incrementalScrollAndExtract`): thêm `domHasIncrementalSince()` — sau MỖI scroll đọc `<time datetime>` đầu tiên trong DOM, gặp <= watermark là dừng ngay (không chờ đủ batch); thêm `buildFinalResult()` để return sớm khi early-stop.
   - Kết quả: incremental chỉ mất vài scroll (không tới 6-10 lần như trước), mỗi lượt chỉ 1-2s thay vì extract tốn hàng chục giây. Chưa verify thật (cần Chrome + session).

0g. **Tối ưu tốc độ gửi tin Teams/Zalo** (09/08, đã code + verify thật) —
   - **Trước**: gửi Zalo 168s / Teams phải chờ sync 20 phút (timeout lock 20p), ~40-50s wait cứng trong automator.
   - **Đã fix**:
     - **Waits cứng → polling điều kiện**: Teams `navigateToTeams` (poll sidebar thay waitForFunction 45s), `navigateToChatInSidebar` (poll chat header thay 5s), `sendTeamsMessage` (poll verify header thay openWait chỉ định); Zalo `navigateToZalo` (poll conversation list thay 5s), `sendZaloMessage` (poll search result + poll sidebar-selected thay 2.5s+3.5s) — tổng giảm ~10-20s/chat.
     - **`isSendWaiting()` + send-preemption**: `teams-automator.ts`/`zalo-automator.ts` check `.teams-send-running`/`.zalo-send-running` mỗi vòng scroll → sync đang chạy **dừng sớm** (nhường Chrome) khi user bấm gửi. `sync-queue.ts` có `runTaskWithSendPreemption()` — kill task con khi send chờ, task đánh `skipped` (sẽ chạy lại vòng sau 2 phút).
     - **Lock đúng**: `zalo-send.ts` thêm `.zalo-send-running` (trước không có — đè profile sync); `teams-send.ts` giảm timeout chờ sync 20p→3p; cả 2 claim lock NGAY đầu rồi mới đợi sync (preempt nhanh), poll 3s thay 10s; `isAnySyncRunning()` queue + `isSendRunning()` scripts check cả 2 lock.
     - **Fix false-negative verify**: Zalo OK khi msgCount tăng HOẶC textVisible (không bắt buộc cả 2); Teams OK khi textVisible HOẶC inputCleared.
   - **Kết quả đo**: Zalo 10s tổng (trước 168s); Teams gửi khi sync đang chạy 19s (14:59→15:00 khi sync 40-160s trước). Tin gửi sync vào DB OK (kiểm tra `projectChats` thấy cả 4 tin test).

0h. **Incremental sync nhanh: scroll từng window + detect watermark mỗi lượt** (09/08 code — **10/08 tối ưu thêm**) —
   - **Zalo** (`scrollZaloChatContainer`): incremental giờ KHÔNG extract DOM sau mỗi scroll (tốn ~giây vì duyệt avatar/ảnh) — chỉ scroll + đo `maxVisibleTs` từ `bb_msg_id_` (nhẹ, 1 querySelector); gặp message <= watermark DB là `EARLY-STOP` ngay + collect DOM hiện tại rồi dừng. `scrollCount` incremental giảm 20 → 5 (an toàn fallback). **Tối ưu 10/08**: collect định kỳ mỗi 5 scroll (chứ không mỗi scroll) để giảm call `collectZaloMessagesFromPage` (nặng ~1-2s) từ 5 lần → 1 lần; wait mỗi scroll incremental rút từ `scrollWaitMs+random(500-1500)` (~3s) xuống `600+random(200-600)` (~1s); bottom-stabilize rút từ 6×2s=12s xuống tối đa 3×1s=3s (thoát ngay nếu đáy lần đầu).
   - **Teams** (`incrementalScrollAndExtract`): thêm `domHasIncrementalSince()` — sau MỖI scroll đọc `<time datetime>` đầu tiên trong DOM, gặp <= watermark là dừng ngay (không chờ đủ batch); thêm `buildFinalResult()` để return sớm khi early-stop. **Tối ưu 10/08**: Step 1 (bottom) incremental rút từ `2s+img-scrollIntoView+5s` (~7s) xuống `800ms` (không cần chờ ảnh lazy-load khi chỉ đo watermark); Step 2 wait mỗi scroll rút từ `scrollWaitMs+random(500-1500)` (~3s) xuống `700+random(200-600)` (~1s).
   - **sync-single-chat.ts**: sau click chat Teams, wait rút từ 5s → 2s khi incremental (tin mới render text đủ, ảnh tự tải sau). **Log thời gian (10/08)**: thêm log `[SyncOne] ⏱  Teams/Zalo "<tên>" tổng Xs | mở+nav+extract: Ys | save: Zs | extract=N saved=M (incremental|full) lúc HH:MM:SS` ở cuối mỗi sync (cả Teams lẫn Zalo, cả nhánh có tin mới / 0 tin / FAIL) — dễ đối chiếu tốc độ từng nhóm. `sync-queue.ts` `runTask` cũng log `[Sync] ▶ BẮT ĐẦU ... lúc <ISO>` + `[Sync] ✓ KẾT THÚC ... — Xs (xong lúc <ISO>)`.
   - Kết quả ước tính: incremental Zalo từ ~40s/chat → ~10-15s/chat; Teams từ ~30-40s/chat → ~10-15s/chat (chỉ vài scroll × ~1s thay vì ~3s + ít call extract). **Đã verify thật (10/08)**: Zalo `[FPTCLOUD] - UICVN` incremental EARLY-STOP ngay lập tức (0 tin mới), tổng 15.3s (mở Chrome + navigate chiếm hầu hết); Teams `[Internal] UICVN x FCI` EARLY-STOP tại batch 1, Step 2 chỉ 11s, `Saved 75 new messages to Postgres`.

0i. **Verify dual-platform queue song song** (10/08, đã code — chưa verify browser) — sau khi restart dev server (kill PID cũ đang chạy code single-queue), mở project có cả nhóm Teams + Zalo (vd project 45):
   - Log server phải có `[Worker:teams] Sync worker bắt đầu (lock acquired)` + `[Worker:zalo] Sync worker bắt đầu` gần nhau (2 worker song song).
   - Sync project có 2 nhóm khác platform → log `[Sync:teams] ▶ BẮT ĐẦU ...` + `[Sync:zalo] ▶ BẮT ĐẦU ...` gần nhau (2 task chạy đồng thời), không còn "hủy job sync-all" khi mở project (chỉ interleave).
   - Sau project sync xong → đợi 3 phút → bấm sync lại/log scheduler fire → log `[Queue] ⏭ Skip 45 (teams|zalo) — cooldown còn Xs` (3 phút mới chạy lại).
   - Bấm sync-all qua Omni → log `[SyncScheduler]` + enqueue tạo 2 job (`<id>-teams` + `<id>-zalo`, cùng `jobGroupId`); 2 worker chạy 2 lane song song → xong nhanh hơn 2x so với cũ.
   - Gửi tin Zalo khi Teams sync đang chạy → log `[Sync:zalo] ⏸ Send đang chờ — kill task` (vì Zalo send nhường Zalo sync), nhưng Teams sync KHÔNG bị kill (log Teams tiếp tục `✓ KẾT THÚC`).
   - Login Zalo (route `zalo-automator` headfull) khi Teams sync đang chạy → `stopBackgroundSync` chỉ kill Zalo sync (`[Sync:zalo]` dừng), Teams sync tiếp tục.
   - UI ProjectDetailPanel tab Chats → 2 nhóm khác platform cùng spinner "Đang đồng bộ..." cùng lúc (đọc `currentTasks` plural).
   - Omni "Queue đồng bộ" section → queue hiển thị gộp 2 worker; `(optional)` muốn hiển thị 2 lane rõ ràng thì đọc `teamsWorker`/`zaloWorker` từ `getSyncQueueStatus()`.
   - `ls -la .teams-sync-running .zalo-sync-running .sync-queue-teams-worker.lock .sync-queue-zalo-worker.lock` — teams lock chỉ chứa PID teams, zalo lock chỉ chứa PID zalo.

0j. **Fix Teams sync sai user nhắn (sender/isMine)** (10-11/08, đã fix + verify DB + UI browser thật) —
   - **Triệu chứng**: user báo sync Teams gán sai người gửi — tin của "Luan Tran Cao" trong nhóm `[Internal] Hackathon Test` (project 45) bị lưu `sender="Me", isMine=true`; nhiều tin khác trong `Internal - FRT Migration TF` cũng bị "Me" hoá sai.
   - **Root cause chính — `isTeamsMeSender()` match nhầm theo họ chung**: logic cũ so khớp **1 token ≥4 chữ** của sender với token của meName → `"Luan Tran Cao"` có token `"tran"` trùng với `"Khoi Tran Quang"` (meName) → bị coi là "Me" → `cleanTeamMessages` đổi sender thành "Me" + `isMine=true` → DB lưu sai. **Fix**: yêu cầu **≥2 token trùng trong cùng 1 meName** ("Luan Tran Cao" chỉ trùng 1 token "tran" → `false`; "Khoi Tran Quang" trùng 3 → `true`). Đã test edge cases: "Luan Tran Cao"→false, "Manh Ho Duc Tri"→false, "Khoi Quang"→true, "Tran Cao"→false.
   - **Fix kèm (hardening)**:
     - `cleanTeamMessages`: đồng bộ 2 chiều isMine/sender — khi `isTeamsMeSender(sender)` đổi sender="Me" thì set `isMine=true` (trước đây để `isMine=null` gây lệch).
     - `extractMessages` + `extractTextOnly`: `lastSender` fallback chỉ kế thừa khi **cùng isMine** với bubble trước (tránh gán nhầm khi DOM lazy-load chưa render nameEl); `isMine=true` không có nameEl → sender="Me" trực tiếp.
     - `addToCollection` (incrementalScrollAndExtract): **preserve `isMine`** từ extract (trước đây dropout → DB lưu isMine=null cho mọi tin Teams); thêm logic ưu tiên sender cụ thể (không "Me"/"") khi cùng timestampMs+content trong collection.
     - Upsert `ON CONFLICT (projectId, messageId) DO UPDATE SET sender/isMine` (messageId không chứa sender) → full re-sync tự sửa rows cũ, không cần script backfill.
   - **Verify thật (10-11/08)**:
     - Full sync lại `[Internal] Hackathon Test` (project 45) → DB: "Okay", "ok anh thấy rồi nha", "=))" giờ `sender="Luan Tran Cao", isMine=false` — trước là Me; các tin của mình vẫn `Me/isMine=true`; "Manh Ho Duc Tri" không đổi.
     - Full sync `Internal - FRT Migration TF` (project 45, 266 msgs, 199 mới) → các tin trước bị "Me" hoá giờ hiển thị đúng tên người gửi ("Quang Nguyen Duy" 40, "Toan Bui Song" 35, "Tuyen Phan Thai" 16...), chỉ còn tin mình thật sự là "Me" (61).
     - Chat 1:1 "An Mai Thuan" (project 45) → toàn bộ 127 tin: 64 `Me/isMine=true` + 63 `An Mai Thuan/isMine=false` — hoàn hảo.
     - **UI browser thật** (Clerk session sẵn): project 45 → tab Chats → nhóm "[Internal] Hackathon Test" → tin "ok anh thấy rồi nha" hiển thị **"Luan Tran Cao" phía trái** + tin reply của mình "Mute đi anh ơi..." hiển thị **"Me" phía phải** — đúng (screenshot `teams-screenshots/verify-chat-luan-sender-fixed.png`).
     - `tsc --noEmit` exit 0.
   - **Scripts giữ lại** (reusable, `scripts/`): `check-teams-sender.ts` (list sender/isMine theo project+chat), `verify-teams-extract.ts` (extract DOM không save — xem sender của tin cuối), `check-p45-all.ts`, `dump-teams-dom.ts`, `inspect-teams-detail.ts`, `inspect-teams-hackathon.ts`, `dump-anmai.ts` (debug DOM).

0k. **Clear toàn bộ chat cũ + full sync all để verify sender/isMine** (11/08, hoàn tất) —
   - **Yêu cầu user**: "sau khi xong hãy clear data chat cũ và sync all để check đến khi nào xong thì thôi".
   - **Đã làm**:
     1. Dừng `next-server` (queue worker) tránh đụng Chrome profile khi sync tay.
     2. Clear 402 messages của 6 groups active (theo `teamsGroups` trong DB): #18 `[TEST] Grouping Verify` (7), `[TEST] Teams Real` (11); #29 `[FPTCLOUD] - UICVN` zalo (178); #45 `An Mai Thuan` teams (127), `[Internal] Hackathon Test` teams (28), `Thảo Nguyên BB` zalo (51). Giữ dữ liệu project archived (#33) + group lịch sử.
     3. Full sync lại từng chat (`FULL_SYNC=true` + `USE_CDP=1` cho Teams / `USE_CDP=0` cho Zalo theo rule "Zalo luôn persistent profile"):
        - #29 Zalo UICVN → 102 msgs (Zalo chỉ scroll được ~102 tin trong 200 scrolls — virtual DOM limit).
        - #45 Teams `An Mai Thuan` → 124 msgs.
        - #45 Teams `[Internal] Hackathon Test` → 28 msgs.
        - #45 Zalo `Thảo Nguyên BB` → 43 msgs.
        - #18 2 chat `[TEST]` **không còn tồn tại trên Teams** (đã xoá/archive trong Teams — verify bằng dump sidebar 106 chats, không thấy tên) → sync báo "not found", không phải lỗi.
   - **Verify DB sau full sync** (script check sender/isMine theo từng nhóm):
     - `An Mai Thuan`: 64 `Me/isMine=true` + 60 `An Mai Thuan/isMine=false`; **0 tin `sender="Me" nhưng isMine!=true`**.
     - `[Internal] Hackathon Test`: 22 `Me` + **3 `Luan Tran Cao` + 3 `Manh Ho Duc Tri`** (đúng user khác — fix `isTeamsMeSender` ăn); **0 bất thường**.
     - Zalo `Thảo Nguyên BB`: 34 `Me/isMine=true` + 9 `Zalo Group` (isMine null — Zalo DOM không cung cấp đầy đủ, không phải bug sender).
     - Zalo UICVN: `Me=12` + các tên đúng (Viet It Uic 53, Đat Pham 14, Minh Long 11, Fci - Htkt 10, Henry Hưng 2).
   - **Verify UI browser thật** (Chrome CDP 9223 + profile copy Clerk session — theo mục "Verify UI app đã đăng nhập sẵn"): project 45 → tab Chats → `An Mai Thuan` → **124 tin nhắn**, sender "Me" và "An Mai Thuan" hiển thị đúng từng tin (screenshot `teams-screenshots/verify-fullsync-anmaithuan.png`).
   - `tsc --noEmit` exit 0. Đã dừng Chrome 9223 + dọn profile copy `/tmp/kflow-login-profile`.

1. **Verify reload UI project 45** (06/08, cần user login) — mở `http://localhost:3000/projects/45` → tab Chats: **93 tin Teams** hiển thị đủ, **34 tin có block quote `> Sender: quoted`**, **13 tin có ảnh** (8 ảnh base64 hiển thị trực tiếp, 5 ảnh sharepoint qua proxy-image có thể 401 nếu cookie hết hạn), tin mới nhất 10:42 06/08. Không còn tin nào dính `1 Heart reaction.`/`Sender8/6/2026...`.
2. **Verify animation sync chat** (06/08, cần Chrome CDP port 9222 + user login) — thêm 1 nhóm thật vào project → UI phải hiện spinner "Đang đồng bộ..." trên nhóm + banner ở messages area, sau sync messages mới hiện ngay (invalidate chats/suggestions/logs).
3. **Verify deep link Teams suggestion kickoff end-to-end** — khi 1 ticket ISD chuyển kickoff, gợi ý "Gửi tin nhắn chào Sale" hiển thị nút **"Gửi tin nhắn qua Teams"** → mở chat Teams với Sale (`users=<email>`) và prefill `message`. Xác nhận `saleEmail` populate đúng từ ISD reporter/requester (quyết định nút có hiện hay không).
4. **Verify trang Kho quy trình** (06/08, cần user login) — mở `/business-processes`: tạo 1 quy trình (vd Kickoff: gửi mail → họp kickoff → chốt timeline), search/filter, toggle tạm ẩn, edit, xoá. Kiểm tra dữ liệu chỉ hiển thị cho user đang đăng nhập.
5. **Verify quy trình được tham khảo trong gợi ý** (06/08, cần Chrome CDP + sync thật) — sau khi sync 1 nhóm có tin nhắn liên quan quy trình đã tạo (vd "kickoff"), log `[Monitor] Found N relevant business process(es)` phải hiện trong terminal; suggestion LLM sinh ra có nội dung bám theo quy trình.
6. **Commit working tree hiện tại** (sau khi test) — gồm thay đổi: PMAgentPopup, teams/zalo-list-chats, chat page, generate-project-suggestions, ProjectDetailPanel, SuggestionsQuickView (gỡ "Sao chép tin nhắn"/"Gửi Email"/"Nhắn kênh", chỉ còn nút deep link Teams + suggestion add groups), sync-all-projects/sync-single-chat/sync-all-groups (chống URL làm tên nhóm), teams/zalo-automator (CDP mode), fix nuốt lỗi `fetchChats`, **business processes (schema/repo/API/hooks/UI/monitor)**, **teams-automator (quote pill mới + strip reaction)**.
7. **Verify sync incremental cho Zalo** (07/08, cần Chrome CDP + session Zalo QR) — nhóm Zalo đã có watermark: log dừng sớm `< [Incremental] EARLY-STOP`, thời gian giảm; `sync-all-projects` với cài `incremental` dừng sớm từng nhóm. (Teams đã verify OK.)
8. **Xác nhận luồng suggestions end-to-end** — từ message → `analyse-suggestions` → hiển thị + action thành công (add task / nhắn kênh / gửi email).
9. **Sau khi ổn định** — đánh giá: tự động hóa theo dõi ISD status (scheduled), gắn `team` field check, tối ưu luồng kickoff (đã có `docs/fmon-project-action-logic.md` làm mẫu).
10. **Verify Import SOW trên project thật có dữ liệu** — đã verify trên project 45 (user đang login): dialog + preview + tạo task + reload đều OK (test data đã dọn). Có thể test thêm với file SOW khác (WAF/NGFW sheet) để xác nhận auto-detect "security"/"waf" qua đường upload file.
11. **Verify nút "Tải nhóm" trên UI thật** (08/08, cần user login) — mở project → tab Chats → bấm "Tải danh sách nhóm (Teams + Zalo)": giờ không cần mở Chrome CDP tay — fallback persistent profile tự chạy. **Đã verify API end-to-end** (route `teams-automator` + `zalo-automator` `list_chats` trả 97 + 59 chats khi CDP tắt) — chỉ còn chờ user bấm nút trên UI để xác nhận hiển thị.
12. **Verify spinner sync 1 nhóm sau fix queue** (09/08, cần user login + Chrome) — mở project → tab Chats → bấm 🔄 1 nhóm: spinner + banner "Đang đồng bộ..." phải giữ tới khi task queue xong (mở Chrome + scroll), tin mới hiện ngay sau đó. Xem thêm mục 3.23.
13. **Verify reload + auto-scroll bằng tay** (09/08) — đã verify bằng Chrome CDP (mục 3.24); nếu user muốn: mở project 45 → tab Chats → bấm "Tải lại" → nút đếm ngược 60s + spinner nhóm hiện trong lúc sync; đổi nhóm chat → scroll tự động xuống tin mới nhất.

### Lưu ý về run check
- **Agent tự chạy check ở bước cuối** (sau khi sửa xong hết) theo rule `.cursor/rules/final-build-check.mdc`: `node_modules/.bin/tsc --noEmit`, fix lỗi đến khi exit 0, trước khi báo hoàn thành.
- Không thêm lại hook `afterAgentResponse` auto-chạy `tsc` — nó khiến agent chậm/treo khi làm việc dài.

### Chú ý khi làm task
- **Verify UI qua browser thật CHỈ khi user yêu cầu** — không tự ý mở Chrome để verify (quyết định 11/08). Feature liên quan Teams/Zalo/rendering vẫn dùng browser thật cho **sync/automation** (rule `real-browser-verification`), nhưng verify UI app chỉ làm khi user nhờ.
- **Dọn dẹp file tạm sau task** (debug/test scripts, screenshot) trước khi kết thúc (file rule `cleanup-after-task`).
- Không tự ý xoá script trong `agents/pm/scripts/` đang được route API gọi, không xoá dữ liệu DB/ISD/Teams/Zalo.

---

## 5. Các quyết định & ràng buộc đã biết

- **DB:** PostgreSQL/Drizzle — schema tại `src/lib/db/schema.ts`; không quay lại Convex.
- **Browser automation:** phải dùng Chrome thật (channel "chrome" + user-data-dir thật), không Playwright chromium headless mặc định (Teams/Zalo detect bot).
- **MỘT NGUYÊN TẮC QUAN TRỌNG — profile Chrome (09/08):** Teams và Zalo mỗi bên có **duy nhất 1 profile chính** chứa session đăng nhập: `.teams-session/chrome-profile` và `.zalo-session/chrome-profile`. Mọi tool (sync, healthcheck, list-chats, login, send) PHẢI dùng thẳng profile chính — qua `createStealthContext`/`createZaloStealthContext` (helper đã hỗ trợ CDP + fallback persistent). **KHÔNG BAO GIỜ tạo profile copy mới** (`.health-session/*` trước đây là lỗi — Zalo xem đó là thiết bị thứ 2 → fail "Đổi thiết bị", đá logout; mkdir/cp mới sẽ không có session, healthcheck luôn unauthorized). Nếu thấy script nào tự tạo profile riêng (`prepareProfile`, `cpSync`) — hãy sửa theo 2 health script hiện tại.
- **CDP profile bind cứng**: Chrome mở với `--remote-debugging-port` chỉ dùng 1 user-data-dir. Hiện tại Teams hay mở CDP 9222 với profile `.teams-session/chrome-profile` → sync/zalo health khi `USE_CDP=1` sẽ connect nhầm vào profile đó mà KHÔNG có session Zalo. Khi cần Zalo qua CDP: mở Chrome riêng với `--user-data-dir=.zalo-session/chrome-profile`.
- **Fix Zalo đá logout khi queue/route set USE_CDP=1 (10/08):** gốc rễ session Zalo bị "Đổi thiết bị" đá logout — `spawnTask` (sync-queue.ts) + route `zalo-automator`, `sync-groups` set `USE_CDP=1` cho task Zalo → `createZaloStealthContext` connect CDP 9222 (profile Teams, không có cookies Zalo) → Zalo cố login → bị đá logout session trong profile chính. **Fix**: task Zalo LUÔN `USE_CDP=0` (dùng persistent profile `.zalo-session` riêng, không bao giờ connect CDP); task Teams giữ `USE_CDP=1` (CDP 9222 = profile Teams OK). Sửa ở `spawnTask` (sync-queue.ts), `zalo-automator/route.ts` (list_chats + start), `sync-groups/route.ts` (platform=zalo). `zalo-send`/`zalo-health` vốn không set `USE_CDP` → an toàn.
- **Healthcheck "Failed to create a ProcessSingleton" (09/08, đã fix):** lỗi xảy ra khi healthcheck cố `launchPersistentContext` trên profile Teams/Zalo đang bị Chrome khác giữ (sync/send đang chạy, hoặc Chrome `--keep-open` còn sót). Fix gồm 3 lớp:
  1. `teams-automator/route.ts` healthcheck giờ **bật `USE_CDP=1`** (giống list_chats) — nếu Chrome CDP đang chạy thì connect vào đó, không mở Chrome thứ 2 cùng profile. (Zalo route KHÔNG bật vì CDP 9222 thường là Chrome Teams — sẽ connect nhầm profile.)
  2. `teams-health.ts` / `zalo-health.ts` thêm `isProfileInUse()` (pgrep profileDir + kill(pid,0)): profile bị giữ → **chờ tối đa 15s** (sync 2 phút rảnh liên tục) rồi trả `{status:"busy"}` thay vì crash; còn bắt lỗi `ProcessSingleton` trong catch → cũng trả `busy`.
  3. `createStealthContext` / `createZaloStealthContext` thêm check **trước khi launch persistent**: nếu profile đang bị Chrome live (không phải Playwright pipe) giữ → ném lỗi rõ ràng "profile đang bị Chrome khác dùng" thay vì crash mờ.
  UI Omni thêm badge **"Đang bận (sync chạy)"** (màu xanh sky) cho status `busy` — user thấy rõ lý do thay vì "Lỗi" mù mờ. `ok:true` khi busy để UI không hiện lỗi đỏ.
- **Slớp 4 — healthcheck đọc cookies khi profile bị giữ (09/08 tối, đã fix):** khi profile bị Chrome khác giữ (VD Chrome Zalo `--keep-open` từ lúc đăng nhập chạy mãi không thoát) thì chờ 15s xong vẫn báo `busy` mãi dù user ĐÃ đăng nhập → user tưởng vẫn lỗi. Fix: `teams-health.ts` / `zalo-health.ts` thêm `sessionFromTeamsCookies()` / `sessionFromZaloCookies()` — đọc thẳng `Default/Cookies` (SQLite, đọc được ngay cả khi Chrome đang chạy trên profile đó) — có cookie `authtoken` (Teams) / `zpsid` (Zalo) → trả `connected`; không có → `unauthorized`; không mở được DB → `busy`. Áp dụng ở BOTH: nhánh `isProfileInUse` hết hạn chờ, và catch lỗi "ProcessSingleton"/"đang bị Chrome khác dùng" (race: Chrome bắt giữ profile sau check nhưng trước launch).
- **Chrome treo giữ SingletonLock:** Chrome tàn dư (`--keep-open`, crash) giữ `SingletonLock` → mọi script sau không mở được profile (lỗi "Opening in existing browser session" / trắng trang / lock). Cách xử lý: find PID từ lock, kill nếu là process treo, xoá lock. `createZaloStealthContext`/`createStealthContext` đã tự cleanup lock của process đã chết + chỉ kill Chrome Playwright-spawned (không kill CDP/Chrome người dùng).
- **Incremental sync (09/08):** chỉ scroll từng window (viewport) + detect mỗi lượt — Zalo đo `maxVisibleTs` từ `bb_msg_id_` (không extract DOM nặng), Teams đọc `<time datetime>` đầu tiên; gặp message <= watermark DB (timestampMs bigint) là EARLY-STOP, collect lần cuối rồi dừng. Không chạy hết `scrollCount` (incremental chỉ còn 5 lượt Zalo / 6-10 Teams). Watermark phải chính xác — đã chuyển `timestampMs`/`scrapedAt` sang `bigint` (trước là real → tròn hoá → early-stop sai).
- **AI/LLM:** chỉ dùng qua `src/app/api/agents/*` hoặc `agents/pm/lib/llm-client` — không nhúng key vào client.
- **App: đã có login bắt buộc** (Clerk) cho dashboard; landing page riêng.
- **Naming:** UI dùng Convex-style `_id`/`_creationTime` (repo `mapProject` chuyển đổi từ drizzle id).

---

## 6. Giữ file đúng hiện trạng

- **Bắt đầu task:** đọc file này trước; cập nhật mục 3/4 (trạng thái + next action) nếu task làm thay đổi hiện trạng.
- **Kết thúc task:** cập nhật lại mục 1 (ngày, commit HEAD), mục 3 (cái gì mới hoạt động), mục 4 (next action mới).
- **Quy ước trạng thái:** ✅ hoàn thành · 🔄 đang làm/đang dang dở · ⏳ chờ · ❌ chặn.