import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { projectIsdData } from "../db";

function mapIsd(d: any): any {
  return {
    ...d,
    _id: String(d.id),
    _creationTime: 0,
    projectId: String(d.projectId),
  };
}

export async function getByProject(projectId: number | string) {
  const db = getDb();
  const row = await db.query.projectIsdData.findFirst({
    where: eq(projectIsdData.projectId, Number(projectId)),
  });
  return row ? mapIsd(row) : null;
}

export async function getByTicketId(ticketId: string) {
  const db = getDb();
  const row = await db.query.projectIsdData.findFirst({
    where: eq(projectIsdData.ticketId, ticketId),
  });
  return row ? mapIsd(row) : null;
}

export async function upsertByProject(args: {
  projectId: number | string;
  userId: string;
  ticketId: string;
  summary: string;
  status?: string;
  priority?: string;
  description?: string;
  assignee?: string;
  assigneeEmail?: string;
  reporter?: string;
  reporterEmail?: string;
  creator?: string;
  creatorEmail?: string;
  owner?: string;
  ownerEmail?: string;
  ownerContact?: string;
  issueType?: string;
  projectKey?: string;
  components?: string[];
  labels?: string[];
  createdDate?: string;
  updatedDate?: string;
  consultingTicketId?: string;
  deploymentTicketId?: string;
  resourceTicketIds?: string[];
  internalGroupUrl?: string;
  customerGroupUrl?: string;
}) {
  const db = getDb();
  const pid = Number(args.projectId);
  const existing = await db.query.projectIsdData.findFirst({
    where: eq(projectIsdData.projectId, pid),
  });

  const data = {
    projectId: pid,
    userId: args.userId,
    ticketId: args.ticketId,
    summary: args.summary,
    status: args.status ?? null,
    priority: args.priority ?? null,
    description: args.description ?? null,
    assignee: args.assignee ?? null,
    assigneeEmail: args.assigneeEmail ?? null,
    reporter: args.reporter ?? null,
    reporterEmail: args.reporterEmail ?? null,
    creator: args.creator ?? null,
    creatorEmail: args.creatorEmail ?? null,
    owner: args.owner ?? null,
    ownerEmail: args.ownerEmail ?? null,
    ownerContact: args.ownerContact ?? null,
    issueType: args.issueType ?? null,
    projectKey: args.projectKey ?? null,
    components: args.components ?? null,
    labels: args.labels ?? null,
    createdDate: args.createdDate ?? null,
    updatedDate: args.updatedDate ?? null,
    consultingTicketId: args.consultingTicketId ?? null,
    deploymentTicketId: args.deploymentTicketId ?? null,
    resourceTicketIds: args.resourceTicketIds ?? null,
    internalGroupUrl: args.internalGroupUrl ?? null,
    customerGroupUrl: args.customerGroupUrl ?? null,
    fetchedAt: Date.now(),
  };

  if (existing) {
    await db.update(projectIsdData).set(data).where(eq(projectIsdData.id, existing.id));
    return existing.id;
  } else {
    const res = await db.insert(projectIsdData).values(data).returning();
    return res[0].id;
  }
}

export async function removeByProject(projectId: number | string) {
  const db = getDb();
  const existing = await db.query.projectIsdData.findFirst({
    where: eq(projectIsdData.projectId, Number(projectId)),
  });
  if (existing) {
    await db.delete(projectIsdData).where(eq(projectIsdData.id, existing.id));
  }
}