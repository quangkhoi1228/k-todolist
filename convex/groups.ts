import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const syncGroups = mutation({
  args: {
    userId: v.string(),
    platform: v.string(),
    groups: v.array(
      v.object({
        name: v.string(),
        url: v.optional(v.string()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const { userId, platform, groups } = args;
    const now = Date.now();

    // 1. Normalize group names (trim, collapse whitespace) and deduplicate input
    const seen = new Set<string>();
    const uniqueGroups: Array<{ name: string; url?: string }> = [];
    for (const g of groups) {
      const normalized = g.name.trim().replace(/\s+/g, " ").replace(/\u00a0/g, " ");
      if (!normalized || normalized.length < 2) continue;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      uniqueGroups.push({ ...g, name: normalized });
    }

    // 2. Fetch existing groups for this user and platform
    const existing = await ctx.db
      .query("scrapedGroups")
      .withIndex("by_user_platform", (q) =>
        q.eq("userId", userId).eq("platform", platform)
      )
      .collect();

    // Build map: key by normalized name
    const existingByName = new Map<string, typeof existing[0]>();
    for (const g of existing) {
      const normalized = g.name.trim().replace(/\s+/g, " ").replace(/\u00a0/g, " ");
      // If a normalized key already exists (from a previous entry with different whitespace), merge
      const prev = existingByName.get(normalized);
      if (prev) {
        // Duplicate in DB — delete one
        await ctx.db.delete(g._id).catch(() => {});
      } else {
        existingByName.set(normalized, g);
      }
    }

    // 3. Upsert: update existing groups, insert new ones
    let addedCount = 0;
    let updatedCount = 0;
    let removedCount = 0;

    for (const group of uniqueGroups) {
      const existingGroup = existingByName.get(group.name);
      if (existingGroup) {
        // Update scrapedAt but preserve syncedAt
        await ctx.db.patch(existingGroup._id, {
          url: group.url ?? existingGroup.url,
          scrapedAt: now,
        });
        existingByName.delete(group.name);
        updatedCount++;
      } else {
        await ctx.db.insert("scrapedGroups", {
          userId,
          platform,
          name: group.name,
          url: group.url,
          scrapedAt: now,
        });
        addedCount++;
      }
    }

    // 4. Delete groups that no longer exist (stale)
    for (const [_, stale] of existingByName) {
      await ctx.db.delete(stale._id);
      removedCount++;
    }

    return { ok: true, added: addedCount, updated: updatedCount, removed: removedCount };
  },
});

export const updateGroupSyncedAt = mutation({
  args: {
    userId: v.string(),
    platform: v.string(),
    groupName: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("scrapedGroups")
      .withIndex("by_user_platform", (q) =>
        q.eq("userId", args.userId).eq("platform", args.platform)
      )
      .collect();

    const group = existing.find((g) => g.name === args.groupName);
    if (group) {
      await ctx.db.patch(group._id, {
        syncedAt: Date.now(),
      });
      return { ok: true };
    }
    return { ok: false, reason: "Group not found" };
  },
});

export const getScrapedGroups = query({
  args: {
    userId: v.string(),
    platform: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, platform } = args;

    if (platform) {
      return await ctx.db
        .query("scrapedGroups")
        .withIndex("by_user_platform", (q) =>
          q.eq("userId", userId).eq("platform", platform)
        )
        .collect();
    } else {
      const all = await ctx.db
        .query("scrapedGroups")
        .withIndex("by_user_platform", (q) => q.eq("userId", userId))
        .collect();
      return all;
    }
  },
});
