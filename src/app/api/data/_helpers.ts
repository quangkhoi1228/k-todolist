import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getPool } from "@/lib/db/pool";

/**
 * Wrap an API handler with try/catch + JSON error handling.
 */
export async function handleRoute(
  req: NextRequest,
  handler: (req: NextRequest) => Promise<NextResponse | Response | unknown>
): Promise<NextResponse> {
  try {
    const result = await handler(req);
    if (result instanceof NextResponse) return result;
    if (result instanceof Response) return NextResponse.json({ ok: true }, { status: result.status });
    return NextResponse.json(result ?? { ok: true });
  } catch (err: any) {
    console.error("[api] route error:", err);
    return NextResponse.json(
      { error: err?.message || "Internal Server Error" },
      { status: err?.status || 500 }
    );
  }
}

/**
 * Serve GET requests for simple queries.
 */
export function makeGetHandler(fn: (searchParams: URLSearchParams, req: NextRequest) => Promise<unknown>) {
  return async (req: NextRequest) =>
    getRoute(req, (req) => fn(new URL(req.url).searchParams, req));
}

async function getRoute(
  req: NextRequest,
  fn: (req: NextRequest) => Promise<unknown>
): Promise<NextResponse> {
  try {
    const result = await fn(req);
    return NextResponse.json(result ?? { ok: true });
  } catch (err: any) {
    console.error("[api] route error:", err);
    return NextResponse.json(
      { error: err?.message || "Internal Server Error" },
      { status: err?.status || 500 }
    );
  }
}

/**
 * Đọc body JSON của request (hỗ trợ array / object).
 */
export async function readJsonBody(req: NextRequest): Promise<any> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

/**
 * Lấy userId từ query param (server-side drizzle DB backend).
 * NOTE: Các hàm backend (automator) chạy ngoài Next nên không dùng Clerk auth.
 * Ở đây ta tin vào {userId} truyền vào — matching behavior của Convex lúc trước
 * (vốn cũng dựa vào userId caller-truyền).
 */
export function requireUserId(args: any): string {
  const userId = args?.userId ?? args?.user?._id ?? args?.user?.id;
  if (!userId) {
    const err: any = new Error("Missing userId");
    err.status = 400;
    throw err;
  }
  return String(userId);
}