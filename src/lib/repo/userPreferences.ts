import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "../db";
import { userPreferences } from "../db";

// ─── Queries ───────────────────────────────────────────────
export async function getUserPreferences(userId: string) {
  const db = getDb();
  const prefs = await db.query.userPreferences.findFirst({
    where: eq(userPreferences.userId, userId),
  });
  return {
    hideDoneTasks: prefs?.hideDoneTasks ?? false,
    autoSyncInterval: prefs?.autoSyncInterval ?? 0,
    lastSyncTime: prefs?.lastSyncTime ?? 0,
    chatSyncMode: prefs?.chatSyncMode ?? "incremental",
  };
}

// ─── Mutations ─────────────────────────────────────────────
export async function updateUserPreferences(args: {
  userId: string;
  hideDoneTasks?: boolean;
  autoSyncInterval?: number;
  lastSyncTime?: number;
  chatSyncMode?: string;
}) {
  const db = getDb();
  const existing = await db.query.userPreferences.findFirst({
    where: eq(userPreferences.userId, args.userId),
  });

  const patch: any = {};
  if (args.hideDoneTasks !== undefined) patch.hideDoneTasks = args.hideDoneTasks;
  if (args.autoSyncInterval !== undefined) patch.autoSyncInterval = args.autoSyncInterval;
  if (args.lastSyncTime !== undefined) patch.lastSyncTime = args.lastSyncTime;
  if (args.chatSyncMode !== undefined) patch.chatSyncMode = args.chatSyncMode;

  if (existing) {
    await db.update(userPreferences).set(patch).where(eq(userPreferences.id, existing.id));
  } else {
    await db.insert(userPreferences).values({
      userId: args.userId,
      hideDoneTasks: args.hideDoneTasks ?? false,
      autoSyncInterval: args.autoSyncInterval ?? 0,
      lastSyncTime: args.lastSyncTime ?? 0,
      chatSyncMode: args.chatSyncMode ?? "incremental",
    });
  }
}