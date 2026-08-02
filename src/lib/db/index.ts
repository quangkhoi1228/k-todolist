import { drizzle } from "drizzle-orm/node-postgres";
import { getPool } from "./pool";
import * as schema from "./schema";

// Re-export schema for convenience
export * from "./schema";

// Drizzle ORM instance (singleton via global pool)
const globalForDb = globalThis as unknown as { pgDrizzle?: ReturnType<typeof createDb> };

function createDb() {
  return drizzle(getPool(), { schema });
}

export function getDb() {
  if (!globalForDb.pgDrizzle) {
    globalForDb.pgDrizzle = createDb();
  }
  return globalForDb.pgDrizzle;
}

export type Db = ReturnType<typeof getDb>;