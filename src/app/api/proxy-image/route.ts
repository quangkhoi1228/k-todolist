/**
 * Image Proxy API
 *
 * Fetches images from Teams/Zalo CDN server-side to bypass:
 * - CORS restrictions
 * - Referrer checks
 * - Expired auth tokens (by re-requesting with fresh browser cookies)
 *
 * Usage:  /api/proxy-image?url=https://...
 *
 * The proxy works by:
 *   1. Fetching the image server-side with a real browser User-Agent
 *   2. Optionally forwarding cookies from the stored Teams session
 *   3. Piping the response back to the client
 */

import { NextResponse, type NextRequest } from "next/server";
import * as fs from "fs";
import * as path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_HOSTS = [
  "s.microsoft.com",
  "teams.microsoft.com",
  "statics.teams.cdn.office.net",
  "stc-zaloprofile.zdn.vn",
  "s120-avatar-zpc.zdn.vn",
  "s120-avatar-login.zdn.vn",
  "stc-zaloshare.zdn.vn",
  "stc-zalosearch.zdn.vn",
  "microsoft.com",
  "*.microsoft.com",
  "*.sharepoint.com",
  "*.zdn.vn",
  "logincdn.zdn.vn",
  "avatars.zdn.vn",
  "*.akamaized.net",
  "*.office.net",
  "*.cdn.office.net",
  "*.cloud.microsoft",
  "*.sharepointonline.com",
  "*.microsoftonline.com",
  "chat.zalo.me",
  "*.chat.zalo.me",
  "*.mmlive.me",
  "*.mstea.ms",
  "*.teams.cloud.microsoft",
  "picsum.photos",
  "via.placeholder.com",
];

function isAllowedHost(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    return ALLOWED_HOSTS.some((pattern) => {
      if (pattern.startsWith("*.")) {
        return hostname.endsWith(pattern.slice(1));
      }
      if (pattern.includes("*.")) {
        const suffix = pattern.slice(pattern.indexOf("*.") + 2);
        return hostname.endsWith("." + suffix) || hostname === suffix;
      }
      return hostname === pattern;
    });
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return new NextResponse("Missing 'url' parameter", { status: 400 });
  }

  // Security: validate URL
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return new NextResponse("Invalid URL scheme", { status: 400 });
  }

  if (!isAllowedHost(url)) {
    console.warn(`[ImageProxy] Blocked request to: ${url.slice(0, 80)}`);
    return new NextResponse("Domain not allowed", { status: 403 });
  }

  // Determine referrer based on URL host
  let referrer: string | undefined;
  if (url.includes("teams.microsoft.com") || url.includes("microsoft.com")) {
    referrer = "https://teams.microsoft.com/";
  } else if (url.includes("zdn.vn") || url.includes("zalo.me")) {
    referrer = "https://chat.zalo.me/";
  }

  try {
    const headers: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
      Accept:
        "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.9",
      "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
      "Sec-Fetch-Dest": "image",
      "Sec-Fetch-Mode": "no-cors",
      "Sec-Fetch-Site": "cross-site",
    };

    if (referrer) {
      headers["Referer"] = referrer;
    }

    // Collect ALL cookies from ALL session files
    const allCookies: string[] = [];

    // 1. Teams cookies
    try {
      const teamsStatePath = path.join(process.cwd(), ".teams-session", "state.json");
      if (fs.existsSync(teamsStatePath)) {
        const state = JSON.parse(fs.readFileSync(teamsStatePath, "utf-8"));
        if (state.cookies && Array.isArray(state.cookies)) {
          state.cookies
            .filter((c: any) => c.name && c.value)
            .map((c: any) => `${c.name}=${c.value}`)
            .forEach((c: string) => { if (!allCookies.includes(c)) allCookies.push(c); });
        }
      }
    } catch { /* ignore */ }

    // 2. Zalo cookies
    try {
      const zaloStatePath = path.join(process.cwd(), ".zalo-session", "state.json");
      if (fs.existsSync(zaloStatePath)) {
        const state = JSON.parse(fs.readFileSync(zaloStatePath, "utf-8"));
        if (state.cookies && Array.isArray(state.cookies)) {
          state.cookies
            .filter((c: any) => c.name && c.value)
            .map((c: any) => `${c.name}=${c.value}`)
            .forEach((c: string) => { if (!allCookies.includes(c)) allCookies.push(c); });
        }
      }
    } catch { /* ignore */ }

    const cookieHeader = allCookies.length > 0 ? allCookies.join("; ") : "";

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    // Try fetching: first without cookies (CDN cache may still serve), then with cookies
    let response: Response | null = null;
    for (const withCookies of [false, true]) {
      if (withCookies && !cookieHeader) break; // skip if no cookies to add
      const hdrs = { ...headers };
      if (withCookies && cookieHeader) {
        hdrs["Cookie"] = cookieHeader;
      }
      try {
        const res = await fetch(url, {
          headers: hdrs,
          signal: controller.signal,
          redirect: "follow",
        });
        // Verify it's actually an image, not a redirect to a login page
        // Some CDNs return 200 with HTML login page masked as image/png
        const ct = res.headers.get("content-type") || "";
        if (res.ok && ct.startsWith("image/")) {
          // Peek at the first bytes to confirm it's binary image data, not HTML
          const buffer = await res.arrayBuffer();
          const firstBytes = new Uint8Array(buffer.slice(0, Math.min(buffer.byteLength, 512)));
          const textHint = new TextDecoder().decode(firstBytes).trimStart().substring(0, 10);
          const isHtml = textHint.startsWith("<") || textHint.startsWith("<!") || textHint.startsWith("&lt;");
          if (!isHtml && buffer.byteLength > 0) {
            // Reconstruct response from verified buffer
            response = new Response(buffer, {
              headers: {
                "content-type": ct,
                "content-length": buffer.byteLength.toString(),
              },
            });
            break;
          }
          console.warn(`[ImageProxy] response looks like HTML, not image (${withCookies ? "with cookies" : "no cookies"}): ${url.slice(0, 80)}`);
        } else if (res.ok && !ct.startsWith("image/")) {
          console.warn(`[ImageProxy] ${res.status} non-image content-type: ${ct} (${withCookies ? "with cookies" : "no cookies"}): ${url.slice(0, 80)}`);
        } else {
          console.warn(`[ImageProxy] ${res.status} (${withCookies ? "with cookies" : "no cookies"}): ${url.slice(0, 80)}`);
        }
      } catch {
        console.warn(`[ImageProxy] fetch failed (${withCookies ? "with cookies" : "no cookies"}): ${url.slice(0, 80)}`);
      }
    }

    clearTimeout(timeout);

    if (!response) {
      console.warn(`[ImageProxy] Failed all attempts for: ${url.slice(0, 80)}`);
      return new NextResponse("Image unavailable", { status: 404 });
    }

    const contentType =
      response.headers.get("content-type") || "image/jpeg";
    const buffer = await response.arrayBuffer();

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
        "Content-Length": buffer.byteLength.toString(),
        // Allow embedding in any context
        "Access-Control-Allow-Origin": "*",
        // Prevent browser from re-checking with auth
        "Cross-Origin-Resource-Policy": "cross-origin",
      },
    });
  } catch (err) {
    console.error("[ImageProxy] Error:", err);
    return new NextResponse("Internal proxy error", { status: 500 });
  }
}
