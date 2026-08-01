import { query, mutation, action } from "./_generated/server";
import { v } from "convex/values";

export const getMessagesByProject = query({
  args: {
    projectId: v.id("projects"),
    chatNames: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const chatNames = args.chatNames;

    // Helper: resolve storage: references to signed URLs in the images array
    function resolveStorageIds(imagesJson: string | undefined): string | undefined {
      if (!imagesJson) return undefined;
      try {
        const urls: string[] = JSON.parse(imagesJson);
        if (!Array.isArray(urls)) return imagesJson;
        let changed = false;
        const resolved = urls.map((url: string) => {
          if (url.startsWith('storage:')) {
            changed = true;
            const storageId = url.slice('storage:'.length);
            const signed = ctx.storage.getUrl(storageId as any);
            return signed || url;
          }
          return url;
        });
        return changed ? JSON.stringify(resolved) : imagesJson;
      } catch {
        return imagesJson;
      }
    }

    if (!chatNames || chatNames.length === 0) {
      const messages = await ctx.db
        .query("projectChats")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .order("desc")
        .take(200);
      for (const msg of messages) {
        if (typeof msg.images === 'string' && msg.images.includes('storage:')) {
          (msg as any).images = resolveStorageIds(msg.images);
        }
      }
      return messages.reverse();
    }

    const allMessages: any[] = [];
    for (const chatName of chatNames) {
      const groupMessages = await ctx.db
        .query("projectChats")
        .withIndex("by_project_chat", (q) =>
          q.eq("projectId", args.projectId).eq("chatName", chatName)
        )
        .order("desc")
        .take(200);
      allMessages.push(...groupMessages);
    }

    for (const msg of allMessages) {
      if (typeof msg.images === 'string' && msg.images.includes('storage:')) {
        msg.images = resolveStorageIds(msg.images);
      }
    }

    allMessages.sort((a, b) => {
      const aTime = Number(a.timestamp) || a._creationTime;
      const bTime = Number(b.timestamp) || b._creationTime;
      return aTime - bTime;
    });

    return allMessages;
  },
});

export const saveMessages = mutation({
  args: {
    projectId: v.id("projects"),
    chatName: v.string(),
    platform: v.optional(v.string()), // "teams" | "zalo" — default "teams"
    messages: v.array(
      v.object({
        sender: v.string(),
        senderAvatar: v.optional(v.string()),
        content: v.string(),
        images: v.optional(v.array(v.string())),
        timestamp: v.string(),
        timestampMs: v.optional(v.number()),
        isMine: v.optional(v.boolean()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const scrapedAt = Date.now();
    const platform = args.platform || "teams";
    let savedCount = 0;
    let updatedCount = 0;

    // Helper: keep only valid image URL strings (drop null/objects/empty from failed conversions)
    function cleanImages(images: string[] | undefined): string[] | undefined {
      if (!images) return undefined;
      const cleaned = images.filter(
        (img) => typeof img === 'string' && img.length > 0
      );
      return cleaned.length > 0 ? cleaned : undefined;
    }

    for (const msg of args.messages) {
      // Stable dedup key: use timestampMs (numeric) if available, fallback to display timestamp
      const contentPrefix = msg.content.substring(0, 30).replace(/\s+/g, "") || "no-text";
      const timeKey = msg.timestampMs !== undefined ? String(msg.timestampMs) : msg.timestamp;
      const messageId = `${args.projectId}_${platform}_${timeKey}_${msg.sender}_${contentPrefix}`;

      const existing = await ctx.db
        .query("projectChats")
        .withIndex("by_messageId", (q) => q.eq("messageId", messageId))
        .first();

      if (existing) {
        // Update existing — always refresh content, scrapedAt
        // BUT only overwrite images IF new images were actually found
        // (re-sync with no images shouldn't wipe previously extracted images)
        const patchData: Record<string, any> = {
          content: msg.content,
          senderAvatar: msg.senderAvatar,
          scrapedAt,
        };
        const cleanImagesArr = cleanImages(msg.images);
        if (cleanImagesArr && cleanImagesArr.length > 0) {
          patchData.images = JSON.stringify(cleanImagesArr);
        }
        if (msg.timestampMs !== undefined) {
          patchData.timestampMs = msg.timestampMs;
        }
        if (msg.isMine !== undefined) {
          patchData.isMine = msg.isMine;
        }
        await ctx.db.patch(existing._id, patchData);
        updatedCount++;
      } else {
        const cleanImagesArr = cleanImages(msg.images);
        await ctx.db.insert("projectChats", {
          projectId: args.projectId,
          chatName: args.chatName,
          messageId,
          sender: msg.sender,
          senderAvatar: msg.senderAvatar,
          content: msg.content,
          images: cleanImagesArr && cleanImagesArr.length > 0 ? JSON.stringify(cleanImagesArr) : undefined,
          timestamp: msg.timestamp,
          timestampMs: msg.timestampMs,
          scrapedAt,
          platform,
          isMine: msg.isMine,
        });
        savedCount++;
      }
    }

    return { saved: savedCount, updated: updatedCount };
  },
});

/** Overwrite the images JSON for a specific message (used for data cleanup) */
export const updateImages = mutation({
  args: {
    projectId: v.id("projects"),
    messageId: v.string(),
    images: v.optional(v.string()), // JSON array of valid image URL strings
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("projectChats")
      .withIndex("by_messageId", (q) => q.eq("messageId", args.messageId))
      .first();
    if (!existing || existing.projectId !== args.projectId) {
      return { updated: 0 };
    }
    await ctx.db.patch(existing._id, {
      images: args.images || undefined,
    });
    return { updated: 1 };
  },
});

export const clearProjectMessages = mutation({
  args: {
    projectId: v.id("projects"),
    chatName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.chatName) {
      // Clear messages for a specific chat group only
      const messages = await ctx.db
        .query("projectChats")
        .withIndex("by_project_chat", (q) =>
          q.eq("projectId", args.projectId).eq("chatName", args.chatName!)
        )
        .collect();

      for (const msg of messages) {
        await ctx.db.delete(msg._id);
      }

      return { deleted: messages.length };
    } else {
      // Clear ALL messages for the project
      const messages = await ctx.db
        .query("projectChats")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .collect();

      for (const msg of messages) {
        await ctx.db.delete(msg._id);
      }

      return { deleted: messages.length };
    }
  },
});

/**
 * Upload a data: URL image to Convex storage.
 * This is called from the sync scripts (Node.js) for large images
 * that would bloat the document if stored as data URLs.
 * Returns the storage ID (e.g. "storage:abc123").
 */
export const uploadChatImage = action({
  args: {
    dataUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const { dataUrl } = args;
    if (!dataUrl.startsWith('data:')) {
      throw new Error('Not a data URL: ' + dataUrl.slice(0, 50));
    }

    // Parse MIME type from the data URL (e.g. "data:image/jpeg;base64,...")
    const mimeMatch = dataUrl.match(/^data:([^;]+);/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';

    // Decode base64 manually — fetch() doesn't support data: URLs in Convex V8 runtime
    const base64Data = dataUrl.split(',')[1];
    if (!base64Data) throw new Error('Invalid data URL: no base64 content');

    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: mimeType });

    // Store in Convex storage — returns a storage ID
    const storageId = await ctx.storage.store(blob);
    return storageId;
  },
});
