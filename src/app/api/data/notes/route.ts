import { NextRequest, NextResponse } from "next/server";
import { getNotes, getNotesByProject, getNote, getNotesWithoutProject, createNote, updateNote, deleteNote, updateNoteOrders, moveNoteToProject, generateShareSlug, removeShareSlug, getNoteByShareSlug } from "@/lib/repo/notes";
import { requireUserId, readJsonBody, handleRoute } from "../_helpers";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return handleRoute(req, async (req) => {
    const sp = new URL(req.url).searchParams;
    const action = sp.get("action") ?? "getNotes";
    switch (action) {
      case "getNotes": {
        const userId = sp.get("userId") ?? "";
        return await getNotes(userId);
      }
      case "getNotesByProject": {
        const projectId = sp.get("projectId") ?? "";
        return await getNotesByProject(projectId);
      }
      case "getNote": {
        const id = sp.get("id") ?? "";
        return await getNote(id);
      }
      case "getNotesWithoutProject": {
        const userId = sp.get("userId") ?? "";
        return await getNotesWithoutProject(userId);
      }
      case "getNoteByShareSlug": {
        const slug = sp.get("slug") ?? "";
        return await getNoteByShareSlug(slug);
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
      case "createNote":
        requireUserId(body);
        return await createNote(body);
      case "updateNote":
        return await updateNote(body.id, body);
      case "deleteNote":
        return await deleteNote(body.id);
      case "updateNoteOrders":
        return await updateNoteOrders(body.updates ?? []);
      case "moveNoteToProject":
        return await moveNoteToProject(body.noteId, body.projectId);
      case "generateShareSlug":
        return await generateShareSlug(body.noteId);
      case "removeShareSlug":
        return await removeShareSlug(body.noteId);
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  });
}