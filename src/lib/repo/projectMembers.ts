import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { projectMembers } from "../db";
import { resolveMemberCapabilities, type RoleCapability } from "../roleCapabilities";

export { resolveMemberCapabilities };
export type { RoleCapability };

function mapMember(m: any): any {
  return {
    ...m,
    _id: String(m.id),
    _creationTime: m.createdAt ?? 0,
    projectId: String(m.projectId),
    roleId: m.roleId !== null ? String(m.roleId) : undefined,
  };
}

export async function getMembersByProject(projectId: number | string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(projectMembers)
    .where(eq(projectMembers.projectId, Number(projectId)));
  return rows.map(mapMember);
}

export async function addMember(args: {
  projectId: number | string;
  userId: string;
  name: string;
  email?: string;
  roleId?: number | string;
  roleName: string;
  source: string;
  permissions?: RoleCapability[];
}) {
  const db = getDb();
  const res = await db
    .insert(projectMembers)
    .values({
      projectId: Number(args.projectId),
      userId: args.userId,
      name: args.name,
      email: args.email ?? null,
      roleId: args.roleId !== undefined ? Number(args.roleId) : null,
      roleName: args.roleName,
      source: args.source,
      permissions: args.permissions ?? null,
      createdAt: Date.now(),
    })
    .returning();
  const created = mapMember(res[0]);

  return created;
}

/**
 * Thêm member nếu chưa tồn tại (cùng project + roleName + source + name/email),
 * ngược lại cập nhật thông tin mới nhất — tránh duplicate khi lưu preinfo nhiều lần.
 */
export async function addOrUpdateMember(args: {
  projectId: number | string;
  userId: string;
  name: string;
  email?: string;
  roleId?: number | string;
  roleName: string;
  source: string;
  permissions?: RoleCapability[];
}) {
  const db = getDb();
  const projectId = Number(args.projectId);
  const email = args.email?.trim() || undefined;
  const name = args.name.trim();

  const existing = await db
    .select()
    .from(projectMembers)
    .where(eq(projectMembers.projectId, projectId));

  // Match member cùng project: trùng role + source và (trùng name hoặc email)
  const same = existing.find((m) => {
    if (String(m.roleName || "").toLowerCase() !== args.roleName.toLowerCase()) return false;
    if ((m.source || "") !== args.source) return false;
    const sameName = m.name?.trim().toLowerCase() === name.toLowerCase();
    const sameEmail =
      email !== undefined &&
      m.email !== null &&
      String(m.email).trim().toLowerCase() === email.toLowerCase();
    return sameName || sameEmail;
  });

  if (same) {
    const patch: any = { name };
    if (email !== undefined) patch.email = email;
    await db
      .update(projectMembers)
      .set(patch)
      .where(eq(projectMembers.id, same.id));
    return mapMember({ ...same, ...patch });
  }

  return addMember(args);
}

export async function updateMember(id: number | string, updates: {
  name?: string;
  email?: string;
  roleId?: number | string;
  roleName?: string;
  permissions?: RoleCapability[] | null;
}) {
  const db = getDb();
  const patch: any = {};
  if (updates.name !== undefined) patch.name = updates.name;
  if (updates.email !== undefined) patch.email = updates.email;
  if (updates.roleId !== undefined) patch.roleId = Number(updates.roleId);
  if (updates.roleName !== undefined) patch.roleName = updates.roleName;
  if (updates.permissions !== undefined) patch.permissions = updates.permissions;
  await db.update(projectMembers).set(patch).where(eq(projectMembers.id, Number(id)));
}

export async function removeMember(id: number | string) {
  const db = getDb();
  await db.delete(projectMembers).where(eq(projectMembers.id, Number(id)));
}