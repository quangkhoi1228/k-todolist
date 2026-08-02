import { NextRequest, NextResponse } from "next/server";
import { getFile } from "@/lib/repo/files";

export const runtime = "nodejs";

// GET /api/data/files/[id] — trả về nội dung file (data URL)
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const file = await getFile(id);
    if (!file) {
      return new NextResponse("Not found", { status: 404 });
    }
    // dataUrl stored fully; return directly
    return new NextResponse(file.data, {
      headers: { "Content-Type": file.mimeType },
    });
  } catch (err: any) {
    console.error("[api] file error:", err);
    return new NextResponse("Not found", { status: 404 });
  }
}