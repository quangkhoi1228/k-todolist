import { NextRequest, NextResponse } from "next/server";

/**
 * Convert Jira wiki markup to HTML.
 *
 * Handles common Jira syntax:
 *   h1./h2./h3. → <h1>/<h2>/<h3>
 *   *bold*       → <strong>
 *   _italic_     → <em>
 *   [text|url]   → <a href="url">
 *   {code}       → <pre><code>
 *   {quote}      → <blockquote>
 *   {color}      → <span>
 *   -/* item     → <ul><li>
 *   # item       → <ol><li>
 *   ||head||head|| → <th>
 *   |cell|cell|    → <td>
 *   !image.png!  → <img>
 *   ----         → <hr>
 *   \n\n         → </p><p>
 */
function jiraToHtml(md: string): string {
  if (!md) return "";

  let s = md;

  // Strip HTML already in the text
  s = s.replace(/<\/?[^>]+(>|$)/g, "");

  // Escape HTML entities
  s = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // {code:lang} ... {code} → pre/code
  s = s.replace(/\{code(?::[^}]*)?\}([\s\S]*?)\{code\}/g, (_m, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });

  // {noformat} ... {noformat} → pre
  s = s.replace(/\{noformat\}([\s\S]*?)\{noformat\}/g, (_m, code) => {
    return `<pre>${code.trim()}</pre>`;
  });

  // {quote} ... {quote} → blockquote
  s = s.replace(/\{quote\}([\s\S]*?)\{quote\}/g, (_m, q) => {
    return `<blockquote>${q.trim()}</blockquote>`;
  });

  // {color:xxx} ... {color} → span
  s = s.replace(/\{color:[^}]+\}([\s\S]*?)\{color\}/g, (_m, text) => text);

  // !!image.png!! → img (keep as placeholder)
  s = s.replace(/!!([^!]+)!!/g, (_m, src) => {
    return `<img src="${src.trim()}" alt="" style="max-width:100%">`;
  });

  // ---- → hr
  s = s.replace(/^-{4,}\s*$/gm, "<hr>");

  // [text|url] → <a href="url">
  s = s.replace(/\[([^|[\]]+)\|([^|[\]]+)\]/g, (_m, text, url) => {
    const href = url.trim();
    return `<a href="${href}">${text.trim()}</a>`;
  });

  // *bold* → **bold** (convert to standard markdown bold)
  s = s.replace(/\*([^*\n]+?)\*/g, "**$1**");

  // _italic_ → *italic* (convert to standard markdown italic)
  s = s.replace(/(?<!\w)_(.+?)_(?!\w)/g, "*$1*");

  // h1. … h6. → markdown headings
  s = s.replace(/^h([1-6])\.\s+(.*)$/gm, (_m, level, text) => {
    return `${"#".repeat(parseInt(level))} ${text}`;
  });

  // bullet lists: -* spaces → markdown -
  s = s.replace(/^(\s*)[-*]\s+/gm, "$1- ");

  // numbered lists: # → markdown 1.
  s = s.replace(/^(\s*)#\s+/gm, "$11. ");

  // Table rows: ||head||head|| → markdown |head|head|
  s = s.replace(/^\|\|(.+)\|\|$/gm, (_m, row) => {
    const cells = row.split("||").map((c: string) => c.trim());
    return `| ${cells.join(" | ")} |`;
  });
  s = s.replace(/^\|(.+)\|$/gm, (_m, row) => {
    const cells = row.split("|").map((c: string) => c.trim());
    return `| ${cells.join(" | ")} |`;
  });

  // Convert to HTML via workaround (inline conversion instead of marked)
  // since marked doesn't handle Jira well even after preprocessing.
  // We do a simple block-level HTML conversion:

  const lines = s.split("\n");
  const html: string[] = [];
  let inParagraph = false;

  const flushParagraph = () => {
    if (inParagraph) {
      html.push("</p>");
      inParagraph = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) {
      flushParagraph();
      continue;
    }

    // Block-level items
    if (trimmed.startsWith("### ")) {
      flushParagraph();
      html.push(`<h3>${trimmed.slice(4)}</h3>`);
      continue;
    }
    if (trimmed.startsWith("## ")) {
      flushParagraph();
      html.push(`<h2>${trimmed.slice(3)}</h2>`);
      continue;
    }
    if (trimmed.startsWith("# ")) {
      flushParagraph();
      html.push(`<h1>${trimmed.slice(2)}</h1>`);
      continue;
    }
    if (trimmed.startsWith("<pre>")) {
      flushParagraph();
      // Eat until </pre>
      let preLines: string[] = [trimmed.slice(5)];
      while (i + 1 < lines.length && !preLines[preLines.length - 1].includes("</pre>")) {
        i++;
        preLines.push(lines[i]);
      }
      html.push(`<pre><code>${preLines.join("\n").replace(/<\/?pre>/g, "").replace(/<\/?code>/g, "").trim()}</code></pre>`);
      continue;
    }
    if (trimmed.startsWith("<blockquote>")) {
      flushParagraph();
      html.push(`<blockquote>${trimmed.replace(/<\/?blockquote>/g, "")}</blockquote>`);
      continue;
    }
    if (trimmed.startsWith("<hr>")) {
      flushParagraph();
      html.push("<hr>");
      continue;
    }
    if (trimmed.startsWith("<img")) {
      flushParagraph();
      html.push(trimmed);
      continue;
    }
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      // Simple list — group consecutive list items
      flushParagraph();
      html.push("<ul>");
      html.push(`<li>${trimmed.slice(2)}</li>`);
      while (i + 1 < lines.length) {
        const next = lines[i + 1].trim();
        if (next.startsWith("- ") || next.startsWith("* ")) {
          i++;
          html.push(`<li>${next.slice(2)}</li>`);
        } else if (next === "") {
          // blank line separates lists
          break;
        } else if (next.startsWith("  ") || next.startsWith("\t")) {
          // continuation line
          html[html.length - 1] += ` ${next.trim()}`;
          i++;
        } else {
          break;
        }
      }
      html.push("</ul>");
      continue;
    }

    // Ordinary paragraph
    if (!inParagraph) {
      html.push("<p>");
      inParagraph = true;
    } else {
      html.push("<br>");
    }
    // Inline formatting
    let inline = trimmed;
    // **bold**
    inline = inline.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    // *italic*
    inline = inline.replace(/(?<!\w)\*(.+?)\*(?!\w)/g, "<em>$1</em>");
    // Links
    inline = inline.replace(/<a href="([^"]+)">([^<]+)<\/a>/g, '<a href="$1">$2</a>');
    html.push(inline);
  }

  flushParagraph();

  return html.join("\n");
}

/**
 * Proxy route to fetch ISD ticket data.
 * Runs on the Next.js server so it can reach the internal Jira network.
 *
 * POST /api/agents/fetch-isd
 * Body: { ticketId: string }
 */
export async function POST(req: NextRequest) {
  try {
    const { ticketId } = await req.json();

    if (!ticketId || typeof ticketId !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid ticketId" },
        { status: 400 }
      );
    }

    const endpoint = process.env.NEXT_PUBLIC_ISD_ENDPOINT;
    const token = process.env.NEXT_PUBLIC_ISD_TOKEN;

    if (!endpoint || !token) {
      return NextResponse.json(
        { error: "ISD endpoint or token not configured" },
        { status: 500 }
      );
    }

    const base = endpoint.replace(/\/$/, "");
    const url = `${base}/api/2/issue/${ticketId}?fields=summary,status,priority,assignee,reporter,creator,description,created,updated,issuetype,components,labels,project,customfield_14011,customfield_14012,customfield_14730,customfield_14731`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`[fetch-isd] ISD API error (${res.status}):`, text.slice(0, 300));
      return NextResponse.json(
        {
          error: `ISD API error: ${res.status}`,
          ticketId,
          success: false,
        },
        { status: 502 }
      );
    }

    const data = await res.json();
    const f = data.fields || {};

    // Extract owner contact info from assignee
    const ownerName = f.assignee?.displayName || "";
    const ownerEmail = f.assignee?.emailAddress || "";
    const ownerContact = ownerEmail
      ? `${ownerName} (${ownerEmail})`
      : ownerName || "";

    const ticketData = {
      ticketId,
      summary: f.summary || "",
      status: f.status?.name || "Unknown",
      priority: f.priority?.name || "Normal",
      assignee: ownerName,
      assigneeEmail: ownerEmail,
      reporter: f.reporter?.displayName || "",
      reporterEmail: f.reporter?.emailAddress || "",
      creator: f.creator?.displayName || "",
      creatorEmail: f.creator?.emailAddress || "",
      description: typeof f.description === "string"
        ? jiraToHtml(f.description.trim().slice(0, 2000))
        : "",
      createdDate: f.created || "",
      updatedDate: f.updated || "",
      issueType: f.issuetype?.name || "",
      components: (f.components || []).map((c: { name: string }) => c.name),
      labels: f.labels || [],
      projectKey: f.project?.key || "",
      // Ticket tư vấn (customfield_14011)
      consultingTicketId: typeof f.customfield_14011 === "string"
        ? f.customfield_14011.trim()
        : "",
      // Ticket Tài Nguyên (customfield_14012)
      resourceTicketIds: typeof f.customfield_14012 === "string"
        ? f.customfield_14012.split(/[\s,]+/).filter(Boolean)
        : [],
      // Ticket triển khai (the current ticket)
      deploymentTicketId: ticketId,
      // Người phụ trách / Owner
      owner: ownerName,
      ownerEmail: ownerEmail,
      ownerContact,
      // Teams / Zalo groups
      internalGroupUrl: f.customfield_14730 || null,
      customerGroupUrl: f.customfield_14731 || null,
      success: true,
    };

    return NextResponse.json(ticketData);
  } catch (err) {
    console.error("[fetch-isd] Unexpected error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
