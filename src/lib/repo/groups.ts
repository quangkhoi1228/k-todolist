import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { scrapedGroups } from "../db";

function mapGroup(g: any): any {
  return {
    ...g,
    _id: String(g.id),
    _creationTime: g.scrapedAt ?? 0,
  };
}

// Convex syncGroups: normalize names, upsert, delete stale
export async function syncGroups(args: {
  userId: string;
  platform: string;
  groups: Array<{ name: string; url?: string }>;
}) {
  const db = getDb();
  const { userId, platform, groups } = args;
  const now = Date.now();

  const seen = new Set<string>();
  const uniqueGroups: Array<{ name: string; url?: string }> = [];
  for (const g of groups) {
    const normalized = g.name.trim().replace(/\s+/g, " ").replace(/\u00a0/g, " ");
    if (!normalized || normalized.length < 2) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    uniqueGroups.push({ ...g, name: normalized });
  }

  const existing = await db
    .select()
    .from(scrapedGroups)
    .where(
      and(
        eq(scrapedGroups.userId, userId),
        eq(scrapedGroups.platform, platform)
      )
    );

  const existingByName = new Map<string, any>();
  for (const g of existing) {
    const normalized = g.name.trim().replace(/\s+/g, " ").replace(/\u00a0/g, " ");
    const prev = existingByName.get(normalized);
    if (prev) {
      await db.delete(scrapedGroups).where(eq(scrapedGroups.id, g.id)).catch(() => {});
    } else {
      existingByName.set(normalized, g);
    }
  }

  // Chỉ xoá nhóm stale khi listing mới đủ lớn (>= 5) — nếu listing trả ít (bị
  // lỗi scroll/UI, ví dụ chỉ 1-2 nhóm) thì GIỮ nguyên dữ liệu cũ thay vì xoá
  // sạch toàn bộ nhóm đã sync trước đó.
  const staleRemoval = uniqueGroups.length >= 5;

  let added = 0;
  let updated = 0;
  let removed = 0;

  for (const group of uniqueGroups) {
    const existingGroup = existingByName.get(group.name);
    if (existingGroup) {
      await db
        .update(scrapedGroups)
        .set({ url: group.url ?? existingGroup.url, scrapedAt: now })
        .where(eq(scrapedGroups.id, existingGroup.id));
      existingByName.delete(group.name);
      updated++;
    } else {
      await db.insert(scrapedGroups).values({
        userId,
        platform,
        name: group.name,
        url: group.url ?? null,
        scrapedAt: now,
      });
      added++;
    }
  }

  if (staleRemoval) {
    for (const [_, stale] of existingByName) {
      await db.delete(scrapedGroups).where(eq(scrapedGroups.id, stale.id));
      removed++;
    }
  }

  return { ok: true, added, updated, removed };
}

export async function updateGroupSyncedAt(args: {
  userId: string;
  platform: string;
  groupName: string;
}) {
  const db = getDb();
  const existing = await db
    .select()
    .from(scrapedGroups)
    .where(
      and(
        eq(scrapedGroups.userId, args.userId),
        eq(scrapedGroups.platform, args.platform)
      )
    );
  const group = existing.find((g) => g.name === args.groupName);
  if (group) {
    await db.update(scrapedGroups).set({ syncedAt: Date.now() }).where(eq(scrapedGroups.id, group.id));
    return { ok: true };
  }
  return { ok: false, reason: "Group not found" };
}

export async function getScrapedGroups(userId: string, platform?: string) {
  const db = getDb();
  let rows: any[];
  if (platform) {
    rows = await db
      .select()
      .from(scrapedGroups)
      .where(
        and(
          eq(scrapedGroups.userId, userId),
          eq(scrapedGroups.platform, platform)
        )
      );
  } else {
    rows = await db.select().from(scrapedGroups).where(eq(scrapedGroups.userId, userId));
  }
  return rows.map(mapGroup);
}