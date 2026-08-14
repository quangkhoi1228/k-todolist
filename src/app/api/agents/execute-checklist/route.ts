/**
 * POST /api/agents/execute-checklist
 *
 * Khi PM bấm "Duyệt" một gợi ý, agent tự thực thi từng bước trong checklist:
 * - Với mỗi bước có `targetGroup` + `messageContent`, spawn script gửi tin THẬT
 *   (Teams hoặc Zalo) — KHÔNG HTTP-loopback tới chính server (HOSTNAME/PORT
 *   trên macOS hay trỏ sai → gửi fail im lặng).
 * - Mở browser thật (headfull) để PM quan sát.
 * - Cập nhật trạng thái từng bước (running/done/failed) vào metadata.
 */

import { NextResponse, type NextRequest } from "next/server";
import { spawn } from "child_process";
import path from "path";
import { getMessage, updateMessageMetadata } from "@/lib/repo/agentsPm";
import { getProject } from "@/lib/repo/projects";
import { getSuggestionsByProject, markSuggestionAsResolved } from "@/lib/repo/projectSuggestions";
import { suggestionTopic } from "@/lib/suggestionDedup";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

interface ExecItem {
  title: string;
  targetGroup?: string;
  messageContent?: string;
  originalIndex?: number;
}

interface ExecResult {
  title: string;
  targetGroup?: string;
  ok: boolean;
  error?: string;
  platform?: string;
  resolvedName?: string;
}

function normName(s: string): string {
  return (s || "")
    .replace(/[\[\]]/g, "")
    .replace(/\(nhóm[^)]*\)/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Map tên nhóm -> { platform, resolvedName } dựa trên project.teamsGroups. */
function resolveGroup(
  project: any,
  targetGroup: string
): { platform: string; resolvedName: string } {
  const groups: Array<{ name: string; platform?: string; type?: string }> =
    Array.isArray(project?.teamsGroups) ? project.teamsGroups : [];
  const target = (targetGroup || "").trim();
  const targetLower = target.toLowerCase();
  const targetNorm = normName(target);

  const platformOf = (g: { platform?: string }) =>
    g.platform === "zalo" ? "zalo" : "teams";

  // 1. Khớp chính xác tên
  const exact = groups.find((g) => g.name && g.name.trim().toLowerCase() === targetLower);
  if (exact) return { platform: platformOf(exact), resolvedName: exact.name };

  // 2. Khớp chứa / token (bỏ ngoặc [ ], "(nhóm KH)", placeholder <...>)
  let best: { g: (typeof groups)[0]; score: number } | null = null;
  for (const g of groups) {
    if (!g.name) continue;
    const gn = normName(g.name);
    if (!gn || !targetNorm) continue;
    if (gn.includes(targetNorm) || targetNorm.includes(gn)) {
      const score = Math.min(gn.length, targetNorm.length);
      if (!best || score > best.score) best = { g, score };
    }
  }
  if (best) return { platform: platformOf(best.g), resolvedName: best.g.name };

  // 3. Suy từ loại nhóm trong tên bước (KH / nội bộ)
  const wantCustomer = /khách|\bkh\b|customer/i.test(target);
  const wantInternal = /nội bộ|internal|\bfci\b/i.test(target);
  const typed = groups.find((g) => {
    if (wantCustomer) return g.type === "customer";
    if (wantInternal) return g.type === "internal";
    return false;
  });
  if (typed) return { platform: platformOf(typed), resolvedName: typed.name };

  // 4. Suy platform từ chữ "Zalo"/"Teams" trong tên bước
  if (/zalo/i.test(target)) {
    const zalo =
      groups.find((g) => g.platform === "zalo") ||
      groups.find((g) => g.type === "customer");
    if (zalo) return { platform: "zalo", resolvedName: zalo.name };
    return { platform: "zalo", resolvedName: target };
  }
  if (/teams/i.test(target)) {
    const teams =
      groups.find((g) => g.platform !== "zalo") ||
      groups.find((g) => g.type === "internal");
    if (teams) return { platform: platformOf(teams), resolvedName: teams.name };
    return { platform: "teams", resolvedName: target };
  }

  // 5. Chỉ có 1 nhóm → dùng nhóm đó
  if (groups.length === 1) {
    return { platform: platformOf(groups[0]), resolvedName: groups[0].name };
  }

  // 6. Bước KH mà có nhóm Zalo → ưu tiên Zalo, không mặc định Teams
  if (wantCustomer) {
    const zalo = groups.find((g) => g.platform === "zalo" && g.type === "customer")
      || groups.find((g) => g.type === "customer")
      || groups.find((g) => g.platform === "zalo");
    if (zalo) return { platform: platformOf(zalo), resolvedName: zalo.name };
  }

  return { platform: "teams", resolvedName: target };
}

/** Spawn script gửi tin (cùng cách /api/agents/zalo-send và teams-send). */
function spawnSend(
  platform: string,
  chatName: string,
  message: string
): Promise<{ ok: boolean; error?: string }> {
  const scriptRel =
    platform === "zalo" ? "agents/pm/scripts/zalo-send.ts" : "agents/pm/scripts/teams-send.ts";
  const scriptPath = path.join(/* turbopackIgnore: true */ process.cwd(), scriptRel);
  const args = [scriptPath, "--chat", chatName, "--message", message, "--yes"];
  // Luôn headfull — PM cần thấy Chrome mở Zalo/Teams
  const env: Record<string, string | undefined> = {
    ...process.env,
    // Zalo không CDP (9222 = profile Teams). Teams CDP nếu Chrome thật đang mở.
    USE_CDP: platform === "zalo" ? "0" : (process.env.USE_CDP ?? "1"),
    CDP_PORT: process.env.CDP_PORT ?? "9222",
  };

  return new Promise((resolve) => {
    const opts: Record<string, unknown> = {
      env,
      stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"],
    };
    const child = spawn("npx", ["tsx", ...args], opts);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    const TIMEOUT_MS = 180_000;
    const killTimer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* */
      }
      resolve({
        ok: false,
        error: `Quá thời gian gửi (${TIMEOUT_MS / 1000}s) tới "${chatName}" trên ${platform}.`,
      });
    }, TIMEOUT_MS);
    killTimer.unref();

    child.on("exit", (code: number | null) => {
      clearTimeout(killTimer);
      if (stderr) {
        console.log(`[ExecuteChecklist] ${platform} stderr: ${stderr.slice(-800)}`);
      }
      // Script in pretty-print JSON (`{\n  "ok": ...}`) — tìm object có field ok.
      const parsed = parseSendResult(stdout);
      if (parsed) {
        resolve({
          ok: Boolean(parsed.ok),
          error: parsed.ok ? undefined : parsed.error || parsed.message,
        });
        return;
      }
      if (code === 0) {
        resolve({ ok: true });
        return;
      }
      resolve({
        ok: false,
        error: stderr.trim().slice(-400) || `Process exited with code ${code}`,
      });
    });

    child.on("error", (err) => {
      clearTimeout(killTimer);
      resolve({ ok: false, error: err.message });
    });
  });
}

/** Parse JSON kết quả từ stdout script send (compact hoặc pretty-print). */
function parseSendResult(stdout: string): { ok?: boolean; error?: string; message?: string } | null {
  const idx = stdout.lastIndexOf("{");
  if (idx < 0) return null;
  const slice = stdout.slice(idx);
  try {
    const parsed = JSON.parse(slice);
    if (typeof parsed?.ok === "boolean") return parsed;
  } catch {
    /* pretty-print có log sau JSON — cắt tới dấu } cuối */
  }
  const end = slice.lastIndexOf("}");
  if (end > 0) {
    try {
      const parsed = JSON.parse(slice.slice(0, end + 1));
      if (typeof parsed?.ok === "boolean") return parsed;
    } catch {
      /* */
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const messageId = body.messageId as string | undefined;
  const projectId = body.projectId as string | undefined;
  const suggestionIndex = body.suggestionIndex as number | undefined;
  const items = (body.items as ExecItem[]) || [];

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Missing items" },
      { status: 400 }
    );
  }

  let project: any = null;
  if (projectId) {
    try {
      project = await getProject(projectId);
    } catch {
      /* ignore */
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (obj: unknown) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      };
      const results: ExecResult[] = [];
      try {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const stepIdx = typeof item.originalIndex === "number" ? item.originalIndex : i;

          emit({ type: "step", index: stepIdx, status: "running", title: item.title });
          if (messageId) {
            await markStep(messageId, suggestionIndex, stepIdx, "running", undefined);
          }

          if (!item.targetGroup || !item.messageContent) {
            if (messageId) {
              await markStep(messageId, suggestionIndex, stepIdx, "done", undefined);
            }
            const result: ExecResult = { title: item.title, ok: true };
            results.push(result);
            emit({ type: "step", index: stepIdx, status: "done", ...result });
            continue;
          }

          const { platform, resolvedName } = resolveGroup(project, item.targetGroup);
          console.log(
            `[ExecuteChecklist] step=${i} title="${item.title}" target="${item.targetGroup}" → ${platform} "${resolvedName}"`
          );

          const sendResult = await spawnSend(platform, resolvedName, item.messageContent);

          if (sendResult.ok) {
            if (messageId) {
              await markStep(messageId, suggestionIndex, stepIdx, "done", undefined);
            }
            const result: ExecResult = {
              title: item.title,
              targetGroup: item.targetGroup,
              ok: true,
              platform,
              resolvedName,
            };
            results.push(result);
            emit({ type: "step", index: stepIdx, status: "done", ...result });
          } else {
            if (messageId) {
              await markStep(messageId, suggestionIndex, stepIdx, "failed", sendResult.error);
            }
            const result: ExecResult = {
              title: item.title,
              targetGroup: item.targetGroup,
              ok: false,
              platform,
              resolvedName,
              error: sendResult.error,
            };
            results.push(result);
            emit({
              type: "step",
              index: stepIdx,
              status: "failed",
              error: sendResult.error,
              ...result,
            });
          }
        }
        if (results.length > 0 && results.every((r) => r.ok)) {
          await resolvePendingSuggestionsForChecklist(projectId, messageId, suggestionIndex);
        }
        emit({ type: "done", ok: true, results });
      } catch (err: any) {
        console.error("[ExecuteChecklist API] Error:", err);
        emit({ type: "done", ok: false, error: err?.message || "Internal error", results });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

async function markStep(
  messageId: string,
  suggestionIndex: number | undefined,
  stepIndex: number,
  status: "running" | "done" | "failed",
  error: string | undefined
): Promise<void> {
  try {
    const msg = await getMessage(messageId);
    if (!msg?.metadata) return;

    const meta = JSON.parse(msg.metadata);
    const suggestions = Array.isArray(meta.suggestions) ? meta.suggestions : [];
    const si = typeof suggestionIndex === "number" ? suggestionIndex : 0;
    const sug = suggestions[si];
    if (!sug || !Array.isArray(sug.checklist)) return;

    const step = sug.checklist[stepIndex];
    if (!step) return;

    step.execStatus = status;
    if (status === "failed") step.execError = error;
    else delete step.execError;

    await updateMessageMetadata(messageId, JSON.stringify(meta));
  } catch (err) {
    console.warn("[ExecuteChecklist] markStep failed:", err);
  }
}

/** Checklist chạy xong hết → đánh dấu gợi ý cùng chủ đề là đã xử lý để không spam lại. */
async function resolvePendingSuggestionsForChecklist(
  projectId: string | undefined,
  messageId: string | undefined,
  suggestionIndex: number | undefined
): Promise<void> {
  if (!projectId) return;
  try {
    let topic: string | null = null;
    if (messageId) {
      const msg = await getMessage(messageId);
      if (msg?.metadata) {
        const meta = JSON.parse(msg.metadata);
        const sug = Array.isArray(meta?.suggestions)
          ? meta.suggestions[typeof suggestionIndex === "number" ? suggestionIndex : 0]
          : null;
        if (sug) topic = suggestionTopic(sug);
      }
    }
    if (!topic) return;
    const existing = await getSuggestionsByProject(projectId);
    for (const s of existing || []) {
      if (s.isResolved) continue;
      if (suggestionTopic(s) !== topic) continue;
      await markSuggestionAsResolved(s.id ?? s._id);
    }
  } catch (err) {
    console.warn("[ExecuteChecklist] resolve pending suggestions failed:", err);
  }
}

