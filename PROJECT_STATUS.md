---
noteId: "b23fc800930511f19112294d6cf59d6f"
tags: []
---

# Hiện trạng dự án K-Todolist

> File này là **nguồn sự thật** về trạng thái dự án — dùng làm đầu vào cho mọi task tiếp theo.
> Cách cập nhật: sửa trực tiếp file này khi bắt đầu/kết thúc 1 task.

- **Cập nhật lần cuối:** 2026-08-25 (**Loại bỏ toàn bộ phần agent / ISD / quy trình dự án / chat sync — chỉ giữ lại quản lý task** — user yêu cầu "Loại bỏ hoàn toàn phần agent, tích hợp với ISD, quy trình dự án, bỏ cả phần sync chat. Nói chung chỉ giữ lại phần quản lý task". Đã xoá khỏi source code toàn bộ: thư mục `agents/` (automator Teams/Zalo/Outlook, monitor, intent-parser, llm-client, workflow, sync scripts, PMAgentPopup, NotificationBadge...), mọi API route `src/app/api/agents/*`, data routes không dùng (`agents-pm`, `chats`, `detect-gender`, `emails`, `groups`, `isd`, `logs`, `project-summaries`, `suggestions`, `project-workflows`, `business-processes`, `preinfo-analyze`, `debate-runs`), các page (`email`, `omni`, `pm-agent`, `settings/roles`, `business-processes`), lib (`chatSend`, `projectSummaryGenerator`, `sync-queue`, `sync-queue-runner`, `genderDetector`, repo `agentsPm`/`emails`/`groups`/`projectChats`/`projectIsdData`/`projectSummaries`/`syncLogs`), component chat/suggestion/debate/email (`SuggestionsQuickView`, `SuggestionsPopupClient`, `InteractiveChecklist`, `SuggestionNotificationCard`, `DebatePipelineViewer`, `PhaseWorkflowCard`, `EmailComposeDialog/Inline`, `IsdFlowDiagram`, `GlobalSyncManager`, `PMAgentPopupClient`), bảng DB không còn dùng trong `schema.ts` (scrapedGroups, pmAgentSessions, pmAgentMessages, projectSuggestions, projectChats, syncLogs, sentEmails, knownRecipients, projectIsdData, businessProcesses, projectSummaries, debateRuns, projectWorkflows), fields agent trên bảng `projects` (teamsGroups, ticketId, isdStatus, isdUpdatedAt, phase, pauseAutoSync) và `userPreferences` (autoSyncInterval, lastSyncTime, chatSyncMode). **Giữ lại nguyên vẹn phần quản lý task**: Kanban board, List, Gantt, Notes (Tiptap + share slug), Projects, Task Templates (`/templates`), Task Modules, Import task từ Excel (`TaskListImportPanel`), Import SOW (`SowImportDialog`), project members + roles (tab Thành viên), editor thông tin dự án (WYSIWYG). `ProjectDetailPanel.tsx` được viết lại gọn chỉ còn 4 tab: **Thông tin dự án / Ghi chú / Thành viên / Import task**. Sidebar/MobileSidebar giờ chỉ có: Kanban, Danh sách, Biểu đồ Gantt, Ghi chú, Dự án, Template. `useDomain.ts` cắt còn hooks cần thiết (projects, tasks, notes, preferences, files, members, roles, task-templates, task-modules). `tsc --noEmit` exit 0. Scripts `scripts/` giữ lại các tool reusable cho task: `test-db.ts`, `check-pg-counts.ts`, `check-pg-columns.ts`, `truncate-pg.ts`, `repair-task-dates.ts`, `seed-task-templates.ts`, `verify-board-*.ts`, `verify-*.ts`, `verify-ui-open.sh`; xoá toàn bộ scripts chat/suggestion/debate/ISD/email/demo.)

- **Commit HEAD:** (trước commit loại bỏ agent — chưa commit phần xoá này). `tsc --noEmit` exit 0.

---

## 1. Dự án là gì

**K-Todolist** — công cụ quản lý dự án/task cho cá nhân (PM Khôi), Next.js 16 + App Router, PostgreSQL/Drizzle. Chỉ tập trung vào **quản lý task**: Kanban board, danh sách, biểu đồ Gantt, ghi chú, dự án, task template/module, import task từ Excel/SOW.

### Stack chính

| Phần | Công nghệ |
|------|-----------|
| Frontend | Next.js 16.2.10, React 19, Tailwind v4, shadcn/ui, `@base-ui/react`, `react-resizable-panels` |
| Editor | Tiptap 3 (rich text, table, image…) |
| Kanban/Gantt | `@dnd-kit` (drag-drop), `gantt-task-react` |
| Backend/Database | **PostgreSQL + Drizzle ORM** |
| Auth | Clerk (`@clerk/nextjs`) |
| Data | SWR (`src/hooks/useData.ts`) |

### Lưu ý quan trọng
- Backend dùng **PostgreSQL + Drizzle** (không Convex). Không viết code Convex mới.
- Next.js bản này có **breaking changes** so với training data — đọc guide trong `node_modules/next/dist/docs/` trước khi viết code.
- `.env.local` chứa `DATABASE_URL` (không còn cần OPENAI/ISD creds sau khi bỏ agent).
- **Verify UI app KHÔNG cần user đăng nhập lại** — đã có sẵn session Clerk. Xem mục `### Verify UI app đã đăng nhập sẵn (Clerk)` bên dưới.

---

## 2. Kiến trúc & luồng chính

```
   ┌──────────────────────────────────────────────────┐
   │  src/lib/repo/*  (PostgreSQL qua Drizzle)         │
   │  projects · tasks · taskDependencies · notes      │
   │  userPreferences · files · projectMembers         │
   │  projectRoles · taskTemplates · taskModules       │
   └──────────────────────────────────────────────────┘
        ▲                                  ▲
        │ src/app/api/data/* (Repo)        │
        │                                  │
   UI pages (board/gantt/list/notes/       │
   projects/templates)                     │
```

### Verify UI app đã đăng nhập sẵn (Clerk) — CHỈ khi user yêu cầu

- **KHÔNG tự ý mở browser để verify UI** — chỉ mở khi user chủ động yêu cầu.
- **Session Clerk app nằm trong Chrome profile thật của user** tại `~/Library/Application Support/Google/Chrome/` (thư mục gốc, chứa `Default/`). Cookies `localhost|__session` còn hạn.
- **Phải COPY profile** (không dùng thẳng profile thật — bị `SingletonLock`): copy sang `/tmp/kflow-login-profile` giữ nguyên Cookies, chỉ xoá lock/history/session-restore/Login Data.
- **CÁCH ĐÚNG — 1 lệnh** (`scripts/verify-ui-open.sh`, mặc định mở `http://localhost:3000/projects` port 9222): script tự copy profile → xoá lock files → mở Chrome CDP bằng `open -n`. Khi xong: `scripts/verify-ui-open.sh --stop`.
- Các script verify board dùng Playwright `connectOverCDP("http://127.0.0.1:9222")` (xem `scripts/verify-board-ui.ts`, `verify-workload-ui.ts`, `verify-create-task.ts`, `verify-edit-task.ts`, `verify-drag-kanban.ts`, `verify-drag-workload.ts`, `verify-hide-done.ts`, `verify-board-features.ts`).

### Các khu vực code chính
- `src/app/(dashboard)/` — board, list, gantt, notes, projects (+`[id]`), templates.
- `src/app/api/data/*` — repo cho UI: projects, tasks, notes, files, preferences, members, roles, task-templates, task-modules, task-list-import (+ `src/app/api/import-sow`, `src/app/api/proxy-image`).
- `src/components/board/` — KanbanBoard, Column, TaskCard, ProjectDetailPanel, NewTaskSheet, TaskListImportPanel, SowImportDialog, WysiwygEditor.
- `src/components/notes/` — NoteTree, NoteEditor.
- `src/components/templates/` — ImportTemplatesDialog, ItemEditorDialog.
- `src/lib/db/schema.ts` + `src/lib/repo/*` + `src/lib/db/index.ts` — DB layer. Push schema: `npm run db:push`.
- Scripts tool reusable: `scripts/test-db.ts`, `scripts/check-pg-*`, `scripts/repair-task-dates.ts`, `scripts/seed-task-templates.ts`, `scripts/verify-*.ts`, `scripts/verify-ui-open.sh`.

---

## 3. Tính năng / Đang làm được gì

**Đã hoạt động (ổn định):**
- **Kanban board** (`/board`): 4 cột (Chưa thực hiện / Đang xử lý / Đến hạn / Đã hoàn thành), drag-drop kéo thả + reorder, multi-select marquee, filter trạng thái + dự án, sort (Mặc định / Hạn chót / Ưu tiên), ẩn/hiện task đã hoàn thành (lưu preference), tạo/sửa/xoá task, quick-edit title, tạo task qua NewTaskSheet.
- **Workload board** (date view trong `/board`): cột theo ngày (Tồn đọng + các ngày), cột Tồn đọng/Hôm nay/Ngày mai to hơn, drag task giữa các ngày, optimistic updates, badge giờ/cột.
- **List** (`/list`): bảng task với cột thời gian/PIC/Support/Nhóm (path), sắp xếp theo order → startDate, auto-shift task quá hạn, edit nhanh ngày/giờ.
- **Gantt** (`/gantt`): biểu đồ task theo project, dependency visualization, quản lý task dependencies.
- **Notes** (`/notes` + tab Ghi chú trong dự án): NoteTree phân cấp, NoteEditor Tiptap (rich text, table, image upload qua `/api/data/files`, share qua slug).
- **Projects** (`/projects` + `/projects/[id]`): tạo/sửa/xoá/archive/restore/clone, đổi tên, editor thông tin dự án (WYSIWYG, auto-save), ProjectDetailPanel 4 tab: **Thông tin dự án / Ghi chú / Thành viên / Import task**.
- **Task Templates & Modules** (`/templates`): template task list dùng chung (Migration/Security/WAF...), module task tái sử dụng (tham chiếu), import nhiều template vào 1 dự án, expand module thành task.
- **Import task từ Excel** (`TaskListImportPanel` — tab Import task): dán nội dung → LLM phân tích → tạo task (PIC/Support từ members).
- **Import SOW** (`SowImportDialog`): upload file `.xlsx` → parse task list → tạo task theo template.
- **Thành viên & vai trò** (tab Thành viên trong dự án): quản lý member, role (capabilities), ghi đè quyền riêng member.
- **User preferences**: `hideDoneTasks` (ẩn task đã xong trên board).

### Điểm lưu ý
- `ProjectDetailPanel.tsx` là component viết lại gọn (4 tab), dữ liệu task/notes/members qua hooks trong `src/hooks/useDomain.ts`.
- Các bảng DB còn lại trong `schema.ts`: `projects`, `tasks`, `taskDependencies`, `userPreferences`, `notes`, `projectRoles`, `projectMembers`, `files`, `taskTemplates`, `taskModules`.
- Khi xoá dự án: cascade xoá task + taskDependencies + notes (đệ quy) + members.

---

## 4. Những việc tiếp theo (next actions)

- [ ] Commit phần xoá agent/ISD/workflow/chat sync (working tree hiện tại).
- [ ] (Tuỳ chọn) `npm run db:push` để đồng bộ schema đã thu gọn lên DB (các bảng cũ đã bỏ khỏi schema — chỉ push nếu muốn thực sự drop bảng trên Postgres; dữ liệu cũ trong bảng bỏ đi sẽ không còn truy cập được qua code).
- [ ] Xoá các file rác cấp root còn sót liên quan agent: `teams-messages.json`, `zalo-messages.json`, `teams-monitor-config.json`, `teams-screenshots/`, `zalo-screenshots/`, `demo/` (nếu không cần demo cũ), `DEMO_SCRIPT.md`.
- [ ] Dọn `.cursor/rules` nếu còn rule tham chiếu agent/sync Teams/Zalo (không bắt buộc).
