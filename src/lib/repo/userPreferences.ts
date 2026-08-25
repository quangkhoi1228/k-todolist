import { eq } from "drizzle-orm";
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
  };
}

// ─── Mutations ─────────────────────────────────────────────
export async function updateUserPreferences(args: {
  userId: string;
  hideDoneTasks?: boolean;
}) {
  const db = getDb();
  const existing = await db.query.userPreferences.findFirst({
    where: eq(userPreferences.userId, args.userId),
  });

  const patch: any = {};
  if (args.hideDoneTasks !== undefined) patch.hideDoneTasks = args.hideDoneTasks;

  if (existing) {
    await db.update(userPreferences).set(patch).where(eq(userPreferences.id, existing.id));
  } else {
    await db.insert(userPreferences).values({
      userId: args.userId,
      hideDoneTasks: args.hideDoneTasks ?? false,
    });
  }
}