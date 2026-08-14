import { asc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { projectRoles, projectMembers } from "../db";
import {
  CAPABILITY_CATALOG,
  defaultCapabilitiesFor,
  type RoleCapability,
} from "../roleCapabilities";

// ─── Danh sách role mặc định (dùng chung cho seed + backfill) ───
export const DEFAULT_ROLE_NAMES = [
  "Sale",
  "Pre-sale",
  "Tech Infras",
  "Project Manager",
  "Khách hàng",
  "Firewall License Manager",
];

// ─── Lock trong-process: chỉ 1 seed chạy cho 1 user tại 1 thời điểm ───
// Chống race: useEffect + StrictMode + invalidate có thể gọi seedDefaultRoles
// nhiều lần cùng lúc → nếu không lock, 2 lần đều thấy "thiếu role" và cùng
// INSERT → tạo duplicate (triple data).
const seedingInProgress = new Set<string>();

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function mapRole(r: any): any {
  return {
    ...r,
    _id: String(r.id),
    _creationTime: r.createdAt ?? 0,
  };
}

export type { RoleCapability };

export async function getRoles(userId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(projectRoles)
    .where(eq(projectRoles.userId, userId))
    .orderBy(asc(projectRoles.order));
  return rows.map(mapRole);
}

export async function getRoleUsageCounts(userId: string) {
  const db = getDb();
  const roles = await db.select().from(projectRoles).where(eq(projectRoles.userId, userId));
  const allMembers = await db
    .select()
    .from(projectMembers)
    .where(eq(projectMembers.userId, userId));

  const counts: Record<string, number> = {};
  for (const role of roles) {
    counts[String(role.id)] = allMembers.filter(
      (m) => m.roleId !== null && m.roleId === role.id
    ).length;
  }
  return counts;
}

const DEFAULT_ROLES = [
  { name: "Sale", color: "#10b981" },
  { name: "Pre-sale", color: "#3b82f6" },
  { name: "Tech Infras", color: "#f59e0b" },
  { name: "Project Manager", color: "#8b5cf6" },
  { name: "Khách hàng", color: "#ec4899" },
  { name: "Firewall License Manager", color: "#f97316" },
];

export async function seedDefaultRoles(userId: string) {
  const db = getDb();

  // Chờ nếu seed khác đang chạy cho user này (race guard)
  while (seedingInProgress.has(userId)) {
    await sleep(50);
  }
  seedingInProgress.add(userId);
  try {
    // 1) Dedupe dữ liệu trùng tên (do race cũ tạo ra) — giữ bản có id nhỏ nhất
    const existing = await db.select().from(projectRoles).where(eq(projectRoles.userId, userId));
    const byName = new Map<string, typeof existing[number]>();
    for (const r of existing) {
      const cur = byName.get(r.name);
      if (!cur || r.id < cur.id) byName.set(r.name, r);
    }
    for (const r of existing) {
      const keeper = byName.get(r.name);
      if (keeper && r.id !== keeper.id) {
        await db.delete(projectRoles).where(eq(projectRoles.id, r.id));
      }
    }

    // 2) Seed các role mặc định còn thiếu
    const existingNames = new Set(byName.keys());
    const now = Date.now();
    for (let i = 0; i < DEFAULT_ROLES.length; i++) {
      const role = DEFAULT_ROLES[i];
      if (!existingNames.has(role.name)) {
        await db.insert(projectRoles).values({
          userId,
          name: role.name,
          color: role.color,
          order: i,
          capabilities: defaultCapabilitiesFor(role.name),
          createdAt: now,
        });
      } else {
        // Backfill capabilities cho role mặc định đã tồn tại từ trước (chưa có capabilities)
        const existingRole = byName.get(role.name)!;
        if (!existingRole.capabilities) {
          await db
            .update(projectRoles)
            .set({ capabilities: defaultCapabilitiesFor(role.name) })
            .where(eq(projectRoles.id, existingRole.id));
        }
      }
    }
  } finally {
    seedingInProgress.delete(userId);
  }
}

/**
 * Dọn duplicate role cho TẤT CẢ user — giữ bản có id nhỏ nhất cho mỗi (userId, name).
 * Chạy 1 lần trước khi thêm unique index (userId, name) để tránh lỗi push schema.
 * Trả về số role đã xoá.
 */
export async function dedupeAllRoles(): Promise<number> {
  const db = getDb();
  const all = await db.select().from(projectRoles);
  const keepers = new Map<string, number>(); // key `${userId}|${name}` → keeper id
  const toDelete: number[] = [];
  for (const r of all) {
    const key = `${r.userId}|${r.name}`;
    const cur = keepers.get(key);
    if (cur === undefined) {
      keepers.set(key, r.id);
    } else if (r.id < cur) {
      toDelete.push(cur);
      keepers.set(key, r.id);
    } else {
      toDelete.push(r.id);
    }
  }
  for (const id of toDelete) {
    await db.delete(projectRoles).where(eq(projectRoles.id, id));
  }
  return toDelete.length;
}

export async function createRole(args: {
  userId: string;
  name: string;
  color?: string;
  order?: number;
  capabilities?: RoleCapability[];
}) {
  const db = getDb();
  const res = await db
    .insert(projectRoles)
    .values({
      userId: args.userId,
      name: args.name,
      color: args.color ?? null,
      order: args.order ?? null,
      capabilities: args.capabilities ?? CAPABILITY_CATALOG.map((c) => ({ ...c, enabled: false })),
      createdAt: Date.now(),
    })
    .returning();
  return mapRole(res[0]);
}

export async function updateRole(id: number | string, updates: {
  name?: string;
  color?: string;
  order?: number;
  capabilities?: RoleCapability[];
}) {
  const db = getDb();
  const patch: any = {};
  if (updates.name !== undefined) patch.name = updates.name;
  if (updates.color !== undefined) patch.color = updates.color;
  if (updates.order !== undefined) patch.order = updates.order;
  if (updates.capabilities !== undefined) patch.capabilities = updates.capabilities;
  await db.update(projectRoles).set(patch).where(eq(projectRoles.id, Number(id)));
}

export async function deleteRole(id: number | string) {
  const db = getDb();
  const rid = Number(id);
  const role = await db.query.projectRoles.findFirst({ where: eq(projectRoles.id, rid) });
  if (!role) return;

  const allMembers = await db
    .select()
    .from(projectMembers)
    .where(eq(projectMembers.userId, role.userId));
  const inUse = allMembers.some((m) => m.roleId !== null && m.roleId === rid);
  if (inUse) {
    throw new Error("Không thể xoá role đang được sử dụng bởi member");
  }

  await db.delete(projectRoles).where(eq(projectRoles.id, rid));
}