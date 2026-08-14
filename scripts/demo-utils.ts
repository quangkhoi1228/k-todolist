/**
 * Demo utilities — snapshot/restore/reset project state for repeatable demos.
 *
 * Usage (see individual scripts):
 *   npx tsx scripts/demo-snapshot.ts   --projectId=12
 *   npx tsx scripts/demo-restore.ts    --file=demo-snapshots/project-12.json
 *   npx tsx scripts/demo-reset.ts      --projectId=12
 */
import { getPool } from "../src/lib/db/pool";

export function parseCliArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (const a of argv.slice(2)) {
    if (a.startsWith("--")) {
      const [k, ...rest] = a.slice(2).split("=");
      args[k] = rest.join("=");
    }
  }
  return args;
}

export async function closePool(): Promise<void> {
  const pool = getPool();
  await pool.end();
}

export interface DemoSnapshot {
  version: 1;
  exportedAt: number;
  sourceProjectId: number;
  sourceUserId: string;
  project: {
    name: string;
    color: string | null;
    order: number | null;
    notes: string | null;
    teamsGroups: any[] | null;
    ticketId: string | null;
    phase: string | null;
  };
  members: Array<{
    name: string;
    email: string | null;
    roleName: string;
    source: string;
    roleId: number | null;
    permissions: any;
  }>;
  chats: Array<{
    chatName: string;
    messageId: string;
    sender: string;
    senderAvatar: string | null;
    content: string;
    images: string | null;
    timestamp: string;
    timestampMs: number | null;
    platform: string | null;
    isMine: boolean | null;
  }>;
  suggestions: Array<{
    type: string;
    title: string;
    description: string;
    sourceMessage: string | null;
    sourceSender: string | null;
    sourceChatName: string | null;
    sourceTimestamp: string | null;
    actionLabel: string | null;
    actionUrl: string | null;
    suggestionData: string | null;
    isRead: boolean;
    isResolved: boolean;
  }>;
  workflow: {
    phase: string;
    steps: any;
    initData: any;
    requirements: any;
    kickoffQuestions: any;
    taskIds: any;
    sowPlan: any;
    preinfoAnalysis: any;
  } | null;
  tasks: Array<{
    title: string;
    estimatedTime: number;
    startDate: number | null;
    endDate: number | null;
    status: string | null;
    isCompleted: boolean | null;
    order: number | null;
    pic: string | null;
    support: string | null;
    path: string | null;
    priority: string | null;
    notes: string | null;
  }>;
  summaries: Array<{
    version: number;
    trigger: string;
    summaryText: string;
    summaryData: any;
  }>;
}
