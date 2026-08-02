import { NextRequest, NextResponse } from "next/server";
import { storeDataUrl } from "@/lib/repo/files";
import { readJsonBody } from "../_helpers";

export const runtime = "nodejs";

// POST /api/data/files — body: { userId, name?, mimeType?, dataUrl }
// Trả về: { fileId, url } — url dùng được trong <img src>
export async function POST(req: NextRequest) {
  try {
    const body = await readJsonBody(req);
    const { userId, dataUrl, name, mimeType } = body;
    if (!userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }
    if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) {
      return NextResponse.json({ error: "Missing valid dataUrl (data:...)" }, { status: 400 });
    }
    const file = await storeDataUrl({
      userId,
      name: name || `upload-${Date.now()}`,
      mimeType,
      dataUrl,
    });
    return NextResponse.json({ fileId: String(file.id), url: `/api/data/files/${file.id}` });
  } catch (err: any) {
    console.error("[api] upload error:", err);
    return NextResponse.json({ error: err?.message || "Upload failed" }, { status: 500 });
  }
}