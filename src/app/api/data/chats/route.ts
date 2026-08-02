import { NextRequest, NextResponse } from "next/server";
import { getMessagesByProject, saveMessages, updateImages, clearProjectMessages, uploadChatImage } from "@/lib/repo/projectChats";
import { readJsonBody, handleRoute } from "../_helpers";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return handleRoute(req, async (req) => {
    const sp = new URL(req.url).searchParams;
    const action = sp.get("action") ?? "getMessagesByProject";
    switch (action) {
      case "getMessagesByProject": {
        const projectId = sp.get("projectId") ?? "";
        const chatNamesParam = sp.get("chatNames");
        const chatNames = chatNamesParam ? JSON.parse(chatNamesParam) : undefined;
        return await getMessagesByProject(projectId, chatNames);
      }
      default:
        return { error: `Unknown action: ${action}` };
    }
  });
}

export async function POST(req: NextRequest) {
  return handleRoute(req, async (req) => {
    const body = await readJsonBody(req);
    const action = body.action;
    switch (action) {
      case "saveMessages":
        return await saveMessages(body);
      case "updateImages":
        return await updateImages(body);
      case "clearProjectMessages":
        return await clearProjectMessages(body.projectId, body.chatName);
      case "uploadChatImage":
        return await uploadChatImage(body.dataUrl, body.userId);
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  });
}