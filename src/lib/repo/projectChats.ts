import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { files, projectChats } from "../db";

function mapMessage(m: any): any {
  return {
    ...m,
    _id: String(m.id),
    _creationTime: 0,
    projectId: String(m.projectId),
  };
}

// Cases: images/senderAvatar may reference Convex storage (storage:...)
// After migration, files are stored as data URLs or /api/files/{id} URLs — no resolution needed.

// ─── Queries ───────────────────────────────────────────────
/**
 * Latest timestampMs of a chat group in DB — used as the "already synced up to"
 * watermark for incremental sync. Returns null when the group has no messages
 * (never synced before → caller should do a full sync).
 */
export async function getLatestTimestampMs(projectId: number | string, chatName: string, platform?: string) {
  const db = getDb();
  const pid = Number(projectId);
  const conditions = [eq(projectChats.projectId, pid), eq(projectChats.chatName, chatName)];
  if (platform) conditions.push(eq(projectChats.platform, platform));

  const rows = await db
    .select({ ts: sql<number>`max(${projectChats.timestampMs})` })
    .from(projectChats)
    .where(and(...conditions));
  const ts = rows[0]?.ts;
  return ts !== undefined && ts !== null ? Number(ts) : null;
}

export async function getMessagesByProject(projectId: number | string, chatNames?: string[]) {
  const db = getDb();
  const pid = Number(projectId);

  if (!chatNames || chatNames.length === 0) {
    const rows = await db
      .select()
      .from(projectChats)
      .where(eq(projectChats.projectId, pid))
      .orderBy(desc(projectChats.id))
      .limit(200);
    return rows.reverse().map(mapMessage);
  }

  const allMessages: any[] = [];
  for (const chatName of chatNames) {
    const groupMessages = await db
      .select()
      .from(projectChats)
      .where(
        and(
          eq(projectChats.projectId, pid),
          eq(projectChats.chatName, chatName)
        )
      )
      .orderBy(desc(projectChats.id))
      .limit(200);
    allMessages.push(...groupMessages);
  }

  // Sort chronologically by the real epoch timestamp (timestampMs). The
  // display `timestamp` column is a localized text label ("13:13" or
  // "Friday, July 24, 2026 4:28 PM.") that Number() cannot parse — sorting
  // on it produced NaN comparisons and a scrambled order (old messages
  // appearing below new ones). timestampMs is stable and unique per
  // message (Zalo: bubble epoch; Teams: <time datetime>).
  allMessages.sort((a, b) => {
    const aTime = a.timestampMs !== undefined && a.timestampMs !== null ? Number(a.timestampMs) : Infinity;
    const bTime = b.timestampMs !== undefined && b.timestampMs !== null ? Number(b.timestampMs) : Infinity;
    if (aTime !== bTime) return aTime - bTime;
    // Fallback: compare by row id (insertion order) when timestamps tie
    return Number(a.id) - Number(b.id);
  });

  return allMessages.map(mapMessage);
}

// ─── Mutations ─────────────────────────────────────────────
export async function saveMessages(args: {
  projectId: number | string;
  chatName: string;
  platform?: string;
  messages: Array<{
    sender: string;
    senderAvatar?: string;
    content: string;
    images?: string[];
    timestamp: string;
    timestampMs?: number;
    platformMsgId?: string;
    isMine?: boolean;
  }>;
}) {
  const db = getDb();
  const pid = Number(args.projectId);
  const scrapedAt = Date.now();
  const platform = args.platform || "teams";
  let saved = 0;
  let updated = 0;

  function cleanImages(images?: string[]): string[] | undefined {
    if (!images) return undefined;
    const cleaned = images.filter((img) => typeof img === "string" && img.length > 0);
    return cleaned.length > 0 ? cleaned : undefined;
  }

  for (const msg of args.messages) {
    const contentPrefix = msg.content.substring(0, 30).replace(/\s+/g, "") || "no-text";
    // Zalo now provides a stable per-message id (bb_msg_id epoch ms); use it
    // as the dedup key so image-only messages and caption-only messages
    // (which have no reliable text/timestamp) never collide.
    const messageId = msg.platformMsgId
      ? `${pid}_${platform}_${msg.platformMsgId}_${msg.sender}_${contentPrefix}`
      : `${pid}_${platform}_${msg.timestampMs !== undefined ? String(msg.timestampMs) : msg.timestamp}_${msg.sender}_${contentPrefix}`;
    const clean = cleanImages(msg.images);

    // Self-heal legacy rows: a message previously stored with empty content
    // ("no-text" id suffix) may now carry real text (e.g. Zalo image captions
    // that used to be stripped by the extractor). Its messageId changes once
    // content appears, so instead of inserting a duplicate we update the
    // empty-content row that matches on sender + timestamp.
    //
    // The new messageId may already be taken by an earlier row (e.g. the first
    // run inserted the full-content row at a different timestamp — float4
    // `timestampMs` loses millisecond precision, so the same logical message
    // can end up on two rows). In that case just delete the stale empty row
    // instead of updating it, or the unique index
    // "chats_by_project_messageId" (projectId, messageId) rejects the update.
    if (msg.content && (msg.timestampMs !== undefined || msg.timestamp)) {
      const legacy = await db
        .select({ id: projectChats.id })
        .from(projectChats)
        .where(
          and(
            eq(projectChats.projectId, pid),
            eq(projectChats.chatName, args.chatName),
            eq(projectChats.sender, msg.sender),
            msg.timestampMs !== undefined
              ? eq(projectChats.timestampMs, msg.timestampMs)
              : eq(projectChats.timestamp, msg.timestamp),
            eq(projectChats.content, "")
          )
        )
        .limit(1);
      if (legacy.length > 0) {
        // The new messageId may already be taken by another row (e.g. the
        // first run inserted the full-content row with a slightly different
        // timestamp — float4 `timestampMs` loses millisecond precision, so
        // the same logical message can live on two rows). Updating this row
        // to the same messageId would violate the unique index
        // "chats_by_project_messageId" (projectId, messageId), so delete the
        // stale empty row and let the upsert below refresh the real one.
        const duplicate =
          (
            await db
              .select({ id: projectChats.id })
              .from(projectChats)
              .where(and(eq(projectChats.projectId, pid), eq(projectChats.messageId, messageId)))
              .limit(1)
          )[0]?.id ?? null;
        if (duplicate !== null && duplicate !== legacy[0].id) {
          await db.delete(projectChats).where(eq(projectChats.id, legacy[0].id));
          updated++;
        } else {
          await db
            .update(projectChats)
            .set({
              content: msg.content,
              messageId,
              senderAvatar: msg.senderAvatar ?? undefined,
              images: clean && clean.length > 0 ? JSON.stringify(clean) : undefined,
              isMine: msg.isMine ?? undefined,
              scrapedAt,
            })
            .where(eq(projectChats.id, legacy[0].id));
          updated++;
        }
        continue;
      }
    }

    // Single upsert statement per message (no SELECT-then-UPSERT N+1).
    // `xmax = 0` distinguishes a real insert from a conflict-update in
    // PostgreSQL RETURNING, so saved/updated counts stay accurate.
    const rows = await db.execute(sql`
      INSERT INTO "projectChats" (
        "projectId", "chatName", "messageId", "sender", "senderAvatar",
        "content", "images", "timestamp", "timestampMs", "scrapedAt",
        "platform", "isMine"
      ) VALUES (
        ${pid}, ${args.chatName}, ${messageId}, ${msg.sender}, ${msg.senderAvatar ?? null},
        ${msg.content}, ${clean && clean.length > 0 ? JSON.stringify(clean) : null}, ${msg.timestamp},
        ${msg.timestampMs ?? null}, ${scrapedAt}, ${platform}, ${msg.isMine ?? null}
      )
      ON CONFLICT ("projectId", "messageId") DO UPDATE SET
        "content" = EXCLUDED."content",
        "senderAvatar" = EXCLUDED."senderAvatar",
        "images" = EXCLUDED."images",
        "timestampMs" = EXCLUDED."timestampMs",
        "isMine" = EXCLUDED."isMine",
        "scrapedAt" = EXCLUDED."scrapedAt"
      RETURNING (xmax = 0) AS "inserted"
    `);

    if (rows.rows[0]?.inserted) saved++;
    else updated++;
  }

  return { saved, updated };
}

export async function updateImages(args: {
  projectId: number | string;
  messageId: string;
  images?: string;
}) {
  const db = getDb();
  const existing = await db.query.projectChats.findFirst({
    where: eq(projectChats.messageId, args.messageId),
  });
  if (!existing || existing.projectId !== Number(args.projectId)) {
    return { updated: 0 };
  }
  await db
    .update(projectChats)
    .set({ images: args.images ?? null })
    .where(eq(projectChats.id, existing.id));
  return { updated: 1 };
}

export async function clearProjectMessages(projectId: number | string, chatName?: string) {
  const db = getDb();
  const pid = Number(projectId);
  let rows: any[];
  if (chatName) {
    rows = await db
      .select()
      .from(projectChats)
      .where(and(eq(projectChats.projectId, pid), eq(projectChats.chatName, chatName)));
    for (const r of rows) {
      await db.delete(projectChats).where(eq(projectChats.id, r.id));
    }
  } else {
    rows = await db.select().from(projectChats).where(eq(projectChats.projectId, pid));
    for (const r of rows) {
      await db.delete(projectChats).where(eq(projectChats.id, r.id));
    }
  }
  return { deleted: rows.length };
}

// ─── File upload (replaces Convex uploadChatImage action) ──
// Uploads base64 data URL to files table, returns { storageId } like Convex
export async function uploadChatImage(dataUrl: string, userId: string) {
  const db = getDb();
  if (!dataUrl.startsWith("data:")) {
    throw new Error("Not a data URL: " + dataUrl.slice(0, 50));
  }
  const mimeMatch = dataUrl.match(/^data:([^;]+);/);
  const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";
  const base64Data = dataUrl.split(",")[1] ?? "";

  const dec = Buffer.from(base64Data, "base64");
  const res = await db
    .insert(files)
    .values({
      userId,
      name: `chat-${Date.now()}.${mimeType.split("/")[1] || "jpg"}`,
      mimeType,
      size: dec.length,
      data: dataUrl, // store full data URL
      createdAt: Date.now(),
    })
    .returning();
  return res[0].id;
}

// ─── Resolve storage: refs back to URLs ────────────────────
// After migration, chat images will be /api/files/{id} URLs stored directly.
// This function keeps old "storage:" entries working by returning api path,
// but they only exist if Convex data was imported with storage IDs that
// are no longer valid — those are dropped by the migration script.
export function resolveStoredImages(imagesJson: string | undefined): string | undefined {
  if (!imagesJson) return undefined;
  try {
    const urls: string[] = JSON.parse(imagesJson);
    if (!Array.isArray(urls)) return imagesJson;
    const resolved = urls.map((url) =>
      url.startsWith("storage:") ? `/api/files/${url.slice(8)}` : url
    );
    return JSON.stringify(resolved);
  } catch {
    return imagesJson;
  }
}