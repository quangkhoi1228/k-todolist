import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { projectMembers } from "../db";

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
      createdAt: Date.now(),
    })
    .returning();
  return mapMember(res[0]);
}

export async function updateMember(id: number | string, updates: {
  name?: string;
  email?: string;
  roleId?: number | string;
  roleName?: string;
}) {
  const db = getDb();
  const patch: any = {};
  if (updates.name !== undefined) patch.name = updates.name;
  if (updates.email !== undefined) patch.email = updates.email;
  if (updates.roleId !== undefined) patch.roleId = Number(updates.roleId);
  if (updates.roleName !== undefined) patch.roleName = updates.roleName;
  await db.update(projectMembers).set(patch).where(eq(projectMembers.id, Number(id)));
}

export async function removeMember(id: number | string) {
  const db = getDb();
  await db.delete(projectMembers).where(eq(projectMembers.id, Number(id)));
}