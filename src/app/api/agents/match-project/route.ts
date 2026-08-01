import { NextRequest, NextResponse } from "next/server";

const LLM_KEY = process.env.OPENAI_API_KEY || "";
const LLM_MODEL = process.env.LLM_MODEL || "deepsseek-v4_mimo_combo";
const LLM_BASE = process.env.OPENAI_BASE_URL;

function tryParseJson(text: string): { parsed: Record<string, unknown> | null; rawContent: string | null } {
  try {
    return { parsed: JSON.parse(text), rawContent: null };
  } catch {}

  let depth = 0, start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") { if (start === -1) start = i; depth++; }
    else if (text[i] === "}") { depth--; if (depth === 0 && start !== -1) { try { return { parsed: JSON.parse(text.slice(start, i + 1)), rawContent: null }; } catch {} } }
  }

  const m = text.match(/"content"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (m) return { parsed: null, rawContent: m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\") };
  return { parsed: null, rawContent: null };
}

function extractLLMContent(rawText: string): string | null {
  const { parsed, rawContent } = tryParseJson(rawText);
  if (rawContent) return rawContent;
  if (parsed) {
    const choices = parsed.choices as Array<Record<string, unknown>> | undefined;
    const msg = (choices?.[0]?.message as Record<string, unknown> | undefined);
    const content = msg?.content as string | undefined;
    if (content) return content;
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const { query, projects } = await req.json();

    if (!query || typeof query !== "string") {
      return NextResponse.json({ error: "Missing query" }, { status: 400 });
    }
    if (!Array.isArray(projects) || projects.length === 0) {
      return NextResponse.json({ matched: false, projectId: null, projectName: null });
    }

    // ── Rule-based matching (always runs first) ──
    const q = query.toLowerCase();

    const ticketMatch = query.match(/ISD[-\s]?(\d+)/i);
    if (ticketMatch) {
      const ticketId = `ISD-${ticketMatch[1]}`.toUpperCase();
      const match = projects.find(
        (p: { id: string; name: string; ticketId: string | null }) =>
          p.ticketId != null && p.ticketId.toUpperCase() === ticketId
      );
      if (match) return NextResponse.json({ matched: true, projectId: match.id, projectName: match.name });
    }

    const stopWords = /^(?:chuyển|sang|đến|qua|tới|đi|tìm|mở|xem|về|dự|án|project|projects|dự án)$/i;
    const words = q.split(/\s+/).filter((w) => w.length > 1 && !stopWords.test(w));

    let bestScore = 0;
    let bestMatch: { id: string; name: string; ticketId: string | null } | null = null;
    for (const p of projects as Array<{ id: string; name: string; ticketId: string | null }>) {
      const nl = (p.name || "").toLowerCase();
      let score = 0;
      for (const w of words) if (nl.includes(w)) score++;
      if (nl === q || nl.includes(q)) score += 5;
      if (p.ticketId && query.toUpperCase().includes(p.ticketId.toUpperCase())) score += 3;
      if (score > bestScore) { bestScore = score; bestMatch = p; }
    }
    if (bestMatch && bestScore > 0) {
      return NextResponse.json({ matched: true, projectId: bestMatch.id, projectName: bestMatch.name });
    }

    // ── LLM-powered matching (only when rule-based failed) ──
    if (!LLM_KEY || !LLM_BASE) {
      return NextResponse.json({ matched: false, projectId: null, projectName: null });
    }

    const systemPrompt = `You are a project matcher. Given a user query and a list of projects, pick the best match.
Match by project name (fuzzy, supports Vietnamese) or ticket ID (ISD-xxxxx).
If a clear match: { "matched": true, "projectId": "...", "projectName": "..." }
If no match: { "matched": false, "projectId": null, "projectName": null }
Output ONLY valid JSON.`;

    const projectList = projects
      .map((p: { id: string; name: string; ticketId: string | null }) =>
        `- ID: ${p.id}, Name: ${p.name}${p.ticketId ? `, Ticket: ${p.ticketId}` : ""}`
      )
      .join("\n");

    const body = {
      model: LLM_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `User query: "${query}"\n\nProjects:\n${projectList}\n\nWhich project matches? Respond with JSON only.` },
      ],
      temperature: 0.1,
      max_tokens: 256,
    };

    const res = await fetch(`${LLM_BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LLM_KEY}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    });

    if (!res.ok) return NextResponse.json({ matched: false, projectId: null, projectName: null });

    const rawText = await res.text();
    const content = extractLLMContent(rawText);
    if (!content) return NextResponse.json({ matched: false, projectId: null, projectName: null });

    const { parsed } = tryParseJson(content);
    if (parsed) {
      return NextResponse.json({
        matched: parsed.matched === true,
        projectId: parsed.projectId || null,
        projectName: parsed.projectName || null,
      });
    }

    return NextResponse.json({ matched: false, projectId: null, projectName: null });
  } catch (error) {
    console.error("[Match Project Error]", error);
    return NextResponse.json({ matched: false, projectId: null, projectName: null });
  }
}
