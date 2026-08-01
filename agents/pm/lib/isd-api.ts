/**
 * ISD (Jira Service Desk) API Client
 *
 * Endpoint: https://servicedesk.fci.vn/rest/
 * Auth: Bearer token (API token generated from Jira profile)
 *
 * API references:
 *   - Jira REST API v2: /api/2/
 *   - Service Desk API: /servicedeskapi/
 */

import type { ISDTicketData, ISDConfig } from "./types";

async function fetchISD<T>(config: ISDConfig, apiPath: string, options?: RequestInit): Promise<T> {
  const base = config.endpoint.replace(/\/$/, "");
  const path = apiPath.startsWith("/") ? apiPath.slice(1) : apiPath;
  const url = `${base}/${path}`;

  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...options?.headers,
    },
  });

  if (!res.ok) {
    let text = "";
    try { text = await res.text(); } catch { text = "Unknown error"; }
    throw new Error(`ISD API error (${res.status}): ${text.slice(0, 300)}`);
  }

  return res.json() as Promise<T>;
}

// ─── Jira API response shape ──────────────────────────────

interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    status: { name: string };
    priority?: { name: string };
    description?: string;
    reporter?: { displayName: string; emailAddress?: string };
    assignee?: { displayName: string; emailAddress?: string } | null;
    created: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };
}

/**
 * Fetch ticket details from ISD (Jira).
 * Uses /rest/api/2/issue/{ticketId}
 */
export async function getTicket(config: ISDConfig, ticketId: string): Promise<ISDTicketData> {
  try {
    const data = await fetchISD<JiraIssue>(config, `api/2/issue/${ticketId}`);

    const fields = data.fields || {};
    const descRaw = fields.description || "";
    const description = typeof descRaw === "string" ? descRaw : JSON.stringify(descRaw);

    return {
      id: data.id,
      key: data.key,
      summary: fields.summary || "",
      status: fields.status?.name || "Unknown",
      priority: fields.priority?.name || "Normal",
      description,
      requester: fields.reporter?.displayName || fields.reporter?.emailAddress || "",
      createdDate: fields.created || "",
      assignee: fields.assignee?.displayName || undefined,
    };
  } catch (err) {
    console.error("[ISD API] Failed to fetch ticket:", err);
    return {
      id: ticketId,
      key: ticketId,
      summary: "Khong the dong bo tu ISD",
      status: "unknown",
      priority: "normal",
      description: "",
      requester: "",
      createdDate: "",
    };
  }
}

/**
 * Get comments on an ISD ticket.
 * GET /rest/api/2/issue/{ticketId}/comment
 */
export async function getTicketComments(
  config: ISDConfig,
  ticketId: string
): Promise<Array<{ author: string; body: string; created: string }>> {
  try {
    const data = await fetchISD<{
      comments: Array<{
        author: { displayName: string };
        body: string;
        created: string;
      }>;
    }>(config, `api/2/issue/${ticketId}/comment`);

    return (data.comments || []).map((c) => ({
      author: c.author?.displayName || "Unknown",
      body: typeof c.body === "string" ? c.body : JSON.stringify(c.body),
      created: c.created,
    }));
  } catch {
    return [];
  }
}

/**
 * Add a comment to an ISD ticket.
 * POST /rest/api/2/issue/{ticketId}/comment
 */
export async function addTicketComment(
  config: ISDConfig,
  ticketId: string,
  comment: string
): Promise<boolean> {
  try {
    await fetchISD(config, `api/2/issue/${ticketId}/comment`, {
      method: "POST",
      body: JSON.stringify({ body: comment }),
    });
    return true;
  } catch (err) {
    console.error("[ISD API] Failed to add comment:", err);
    return false;
  }
}

/**
 * Transition ticket to a new status.
 * POST /rest/api/2/issue/{ticketId}/transitions
 *
 * Common transition IDs (may vary per project):
 *   11  - In Progress
 *   21  - Done
 *   31  - Close
 *   41  - Reopen
 *   51  - Suspend
 *   61  - Cancel
 */
export async function transitionTicket(
  config: ISDConfig,
  ticketId: string,
  transitionId: string,
  comment?: string
): Promise<boolean> {
  try {
    const body: Record<string, unknown> = {
      transition: { id: transitionId },
    };
    if (comment) {
      body.update = { comment: [{ add: { body: comment } }] };
    }
    await fetchISD(config, `api/2/issue/${ticketId}/transitions`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return true;
  } catch (err) {
    console.error("[ISD API] Failed to transition ticket:", err);
    return false;
  }
}

/**
 * Get available transitions for a ticket.
 * GET /rest/api/2/issue/{ticketId}/transitions
 */
export async function getTicketTransitions(
  config: ISDConfig,
  ticketId: string
): Promise<Array<{ id: string; name: string }>> {
  try {
    const data = await fetchISD<{
      transitions: Array<{ id: string; name: string }>;
    }>(config, `api/2/issue/${ticketId}/transitions`);
    return data.transitions || [];
  } catch {
    return [];
  }
}

/**
 * Search tickets by JQL.
 * GET /rest/api/2/search?jql={jql}
 */
export async function searchTickets(
  config: ISDConfig,
  jql: string,
  maxResults = 10
): Promise<Array<{ key: string; summary: string; status: string }>> {
  try {
    const data = await fetchISD<{ issues: JiraIssue[] }>(
      config,
      `api/2/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}`
    );
    return (data.issues || []).map((issue) => ({
      key: issue.key,
      summary: issue.fields?.summary || "",
      status: issue.fields?.status?.name || "",
    }));
  } catch {
    return [];
  }
}
