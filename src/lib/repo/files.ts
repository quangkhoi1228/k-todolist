import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { files } from "../db";

export interface FileRow {
  id: number;
  userId: string;
  name: string;
  mimeType: string;
  size: number;
  data: string; // base64 data URL
  createdAt: number;
}

// Lưu một data URL vào bảng files, trả về id (kiểu "storage" thay thế Convex)
export async function storeDataUrl(opts: {
  userId: string;
  name: string;
  mimeType?: string;
  dataUrl: string;
}) {
  const db = getDb();
  const mimeMatch = opts.dataUrl.match(/^data:([^;]+);/);
  const mimeType = opts.mimeType ?? (mimeMatch ? mimeMatch[1] : "application/octet-stream");
  const base64Data = opts.dataUrl.split(",")[1] ?? "";
  const size = Buffer.from(base64Data, "base64").length;

  const res = await db
    .insert(files)
    .values({
      userId: opts.userId,
      name: opts.name,
      mimeType,
      size,
      data: opts.dataUrl,
      createdAt: Date.now(),
    })
    .returning();
  return res[0];
}

export async function getFile(id: number | string) {
  const db = getDb();
  return await db.query.files.findFirst({ where: eq(files.id, Number(id)) });
}

export async function deleteFile(id: number | string) {
  const db = getDb();
  await db.delete(files).where(eq(files.id, Number(id)));
}