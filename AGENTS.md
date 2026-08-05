<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Project status / Context

Before starting ANY task, read **`PROJECT_STATUS.md`** — it captures what this project is, what's currently working, and the next actions. Use it as the input for the task and update it (status + next actions) when you finish.

# Database

This project uses **PostgreSQL** as its backend database (via Drizzle ORM), replacing the former Convex backend.

- Schema: `src/lib/db/schema.ts`
- Repo layer (data access): `src/lib/repo/*.ts`
- API routes (frontend + automator data access): `src/app/api/data/*`
- Connection: `DATABASE_URL` in `.env.local`
- Push schema changes: `npm run db:push`

