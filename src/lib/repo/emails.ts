import { and, desc, eq, inArray, or } from "drizzle-orm";
import { getDb } from "../db";
import { sentEmails, knownRecipients } from "../db";

function mapEmail(e: any): any {
  return {
    ...e,
    _id: String(e.id),
    _creationTime: 0,
    projectId: e.projectId !== null ? String(e.projectId) : undefined,
  };
}

function mapRecipient(r: any): any {
  return {
    ...r,
    _id: String(r.id),
    _creationTime: 0,
  };
}

// ─── Emails ────────────────────────────────────────────────
export async function getByUser(opts: { userId: string; limit?: number; projectId?: number | string }) {
  const db = getDb();
  const limit = opts.limit ?? 50;
  let rows: any[];
  if (opts.projectId) {
    rows = await db
      .select()
      .from(sentEmails)
      .where(
        and(
          eq(sentEmails.userId, opts.userId),
          eq(sentEmails.projectId, Number(opts.projectId))
        )
      )
      .orderBy(desc(sentEmails.sentAt))
      .limit(limit);
  } else {
    rows = await db
      .select()
      .from(sentEmails)
      .where(eq(sentEmails.userId, opts.userId))
      .orderBy(desc(sentEmails.sentAt))
      .limit(limit);
  }
  return rows.map(mapEmail);
}

export async function getByProject(projectId: number | string, limit = 50) {
  const db = getDb();
  const rows = await db
    .select()
    .from(sentEmails)
    .where(eq(sentEmails.projectId, Number(projectId)))
    .orderBy(desc(sentEmails.sentAt))
    .limit(limit);
  return rows.map(mapEmail);
}

export async function getEmailById(id: number | string) {
  const db = getDb();
  const row = await db.query.sentEmails.findFirst({ where: eq(sentEmails.id, Number(id)) });
  return row ? mapEmail(row) : null;
}

export async function createEmailLog(args: {
  userId: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  attachmentNames?: string[];
  importance?: string;
  projectId?: number | string;
}) {
  const db = getDb();
  const res = await db
    .insert(sentEmails)
    .values({
      userId: args.userId,
      to: args.to,
      cc: args.cc ?? null,
      bcc: args.bcc ?? null,
      subject: args.subject,
      body: args.body,
      attachmentNames: args.attachmentNames ?? null,
      importance: args.importance ?? null,
      projectId: args.projectId ? Number(args.projectId) : null,
      status: "sending",
      sentAt: Date.now(),
    })
    .returning();
  return mapEmail(res[0]);
}

export async function updateEmailStatus(id: number | string, status: string, errorMessage?: string) {
  const db = getDb();
  await db
    .update(sentEmails)
    .set({ status, errorMessage: errorMessage ?? null })
    .where(eq(sentEmails.id, Number(id)));
}

export async function setEmailProject(id: number | string, projectId?: number | string) {
  const db = getDb();
  await db
    .update(sentEmails)
    .set({ projectId: projectId ? Number(projectId) : null })
    .where(eq(sentEmails.id, Number(id)));
}

export async function deleteEmail(id: number | string) {
  const db = getDb();
  await db.delete(sentEmails).where(eq(sentEmails.id, Number(id)));
}

// ─── Known recipients ─────────────────────────────────────
export async function searchRecipients(userId: string, query: string, limit = 20) {
  const db = getDb();
  const q = query.toLowerCase().trim();
  if (!q) return [];

  const all = await db
    .select()
    .from(knownRecipients)
    .where(eq(knownRecipients.userId, userId))
    .orderBy(desc(knownRecipients.lastUsedAt))
    .limit(200);

  const filtered = all.filter(
    (r) =>
      r.email.toLowerCase().includes(q) ||
      (r.name && r.name.toLowerCase().includes(q))
  );
  return filtered.slice(0, limit).map(mapRecipient);
}

export async function getAllRecipients(userId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(knownRecipients)
    .where(eq(knownRecipients.userId, userId))
    .orderBy(desc(knownRecipients.lastUsedAt));
  return rows.map(mapRecipient);
}

export async function saveRecipient(userId: string, email: string, name?: string) {
  const db = getDb();
  const e = email.trim().toLowerCase();
  if (!e.includes("@")) return;

  const existing = await db.query.knownRecipients.findFirst({
    where: and(
      eq(knownRecipients.userId, userId),
      eq(knownRecipients.email, e)
    ),
  });

  if (existing) {
    await db
      .update(knownRecipients)
      .set({
        name: name ?? existing.name,
        lastUsedAt: Date.now(),
        useCount: existing.useCount + 1,
      })
      .where(eq(knownRecipients.id, existing.id));
  } else {
    await db.insert(knownRecipients).values({
      userId,
      email: e,
      name: name ?? null,
      lastUsedAt: Date.now(),
      useCount: 1,
    });
  }
}

export async function saveRecipients(userId: string, emails: string[]) {
  const db = getDb();
  for (const email of emails) {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed.includes("@")) continue;

    const existing = await db.query.knownRecipients.findFirst({
      where: and(
        eq(knownRecipients.userId, userId),
        eq(knownRecipients.email, trimmed)
      ),
    });

    if (existing) {
      await db
        .update(knownRecipients)
        .set({ lastUsedAt: Date.now(), useCount: existing.useCount + 1 })
        .where(eq(knownRecipients.id, existing.id));
    } else {
      await db.insert(knownRecipients).values({
        userId,
        email: trimmed,
        name: null,
        lastUsedAt: Date.now(),
        useCount: 1,
      });
    }
  }
}