import { NextRequest, NextResponse } from "next/server";

/**
 * Batch refresh ISD ticket statuses for all projects that have a ticketId.
 *
 * POST /api/agents/refresh-isd-statuses
 * Body: { projects: Array<{ _id: string, ticketId: string }> }
 */
export async function POST(req: NextRequest) {
  try {
    const endpoint = process.env.NEXT_PUBLIC_ISD_ENDPOINT;
    const token = process.env.NEXT_PUBLIC_ISD_TOKEN;

    if (!endpoint || !token) {
      return NextResponse.json({
        ok: false,
        error: "ISD endpoint or token not configured",
      }, { status: 500 });
    }

    const { projects } = await req.json();
    if (!Array.isArray(projects) || projects.length === 0) {
      return NextResponse.json({ ok: true, results: [] });
    }

    const base = endpoint.replace(/\/$/, "");
    const results: Array<{ _id: string; ticketId: string; status: string; ok: boolean; error?: string }> = [];

    for (const project of projects) {
      const { _id, ticketId } = project;
      if (!_id || !ticketId) continue;

      try {
        const url = `${base}/api/2/issue/${ticketId}?fields=status`;
        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(10_000),
        });

        if (!res.ok) {
          const text = await res.text();
          results.push({ _id, ticketId, status: "", ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` });
          continue;
        }

        const data = await res.json();
        const statusName = data.fields?.status?.name || "Unknown";
        results.push({ _id, ticketId, status: statusName, ok: true });
      } catch (err: any) {
        results.push({ _id, ticketId, status: "", ok: false, error: err.message || "Unknown error" });
      }
    }

    return NextResponse.json({ ok: true, results });
  } catch (err) {
    console.error("[refresh-isd-statuses] Error:", err);
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : "Internal error",
    }, { status: 500 });
  }
}
