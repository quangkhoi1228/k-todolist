import { asc, eq } from "drizzle-orm";
import { getDb } from "../db";
import { projectRoles, projectMembers } from "../db";
import {
  CAPABILITY_CATALOG,
  defaultCapabilitiesFor,
  type RoleCapability,
} from "../roleCapabilities";

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
];

export async function seedDefaultRoles(userId: string) {
  const db = getDb();
  const existing = await db.select().from(projectRoles).where(eq(projectRoles.userId, userId));
  const existingNames = new Set(existing.map((r) => r.name));
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
      const existingRole = existing.find((r) => r.name === role.name);
      if (existingRole && !existingRole.capabilities) {
        await db
          .update(projectRoles)
          .set({ capabilities: defaultCapabilitiesFor(role.name) })
          .where(eq(projectRoles.id, existingRole.id));
      }
    }
  }
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