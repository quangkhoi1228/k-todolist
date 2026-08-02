import { and, asc, desc, eq } from "drizzle-orm";
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

  allMessages.sort((a, b) => {
    const aTime = Number(a.timestamp) || 0;
    const bTime = Number(b.timestamp) || 0;
    return aTime - bTime;
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
    const timeKey = msg.timestampMs !== undefined ? String(msg.timestampMs) : msg.timestamp;
    const messageId = `${pid}_${platform}_${timeKey}_${msg.sender}_${contentPrefix}`;

    const existing = await db.query.projectChats.findFirst({
      where: eq(projectChats.messageId, messageId),
    });

    if (existing) {
      const patchData: any = {
        content: msg.content,
        senderAvatar: msg.senderAvatar ?? null,
        scrapedAt,
      };
      const clean = cleanImages(msg.images);
      if (clean && clean.length > 0) {
        patchData.images = JSON.stringify(clean);
      }
      if (msg.timestampMs !== undefined) patchData.timestampMs = msg.timestampMs;
      if (msg.isMine !== undefined) patchData.isMine = msg.isMine;
      await db.update(projectChats).set(patchData).where(eq(projectChats.id, existing.id));
      updated++;
    } else {
      const clean = cleanImages(msg.images);
      await db.insert(projectChats).values({
        projectId: pid,
        chatName: args.chatName,
        messageId,
        sender: msg.sender,
        senderAvatar: msg.senderAvatar ?? null,
        content: msg.content,
        images: clean && clean.length > 0 ? JSON.stringify(clean) : null,
        timestamp: msg.timestamp,
        timestampMs: msg.timestampMs ?? null,
        scrapedAt,
        platform,
        isMine: msg.isMine ?? null,
      });
      saved++;
    }
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