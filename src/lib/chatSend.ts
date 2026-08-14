/**
 * Resolve người nhận / nhóm chat rồi gửi tin Teams hoặc Zalo (headfull).
 * Dùng chung cho PM Agent popup + trang chat.
 */

export type SendPlatform = "teams" | "zalo";

export interface SendMember {
  name: string;
  roleName?: string | null;
  email?: string | null;
}

export interface SendGroup {
  name: string;
  type?: string | null;
  platform?: string | null;
}

export interface ResolveSendTargetInput {
  memberName?: string;
  chatName?: string;
  platform?: SendPlatform | string;
  members?: SendMember[] | null;
  groups?: SendGroup[] | null;
  projectName?: string;
}

export interface ResolveSendTargetResult {
  chatName?: string;
  platform: SendPlatform;
  memberName?: string;
  foundMember?: SendMember;
  note?: string;
  error?: string;
}

function norm(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .trim();
}

function namesMatch(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

function isCustomerRole(roleName?: string | null): boolean {
  const r = (roleName || "").toLowerCase();
  return r.includes("khách") || r.includes("khach") || r.includes("customer");
}

function asPlatform(value?: string | null, fallback: SendPlatform = "teams"): SendPlatform {
  return value === "zalo" || value === "teams" ? value : fallback;
}

/** Tìm nhóm phù hợp theo loại (KH/nội bộ) + nền tảng. */
function pickGroup(
  groups: SendGroup[],
  groupType: "customer" | "internal",
  platform?: SendPlatform
): SendGroup | undefined {
  if (platform) {
    const typed = groups.find((g) => g.type === groupType && g.platform === platform);
    if (typed) return typed;
    const byPlat = groups.find((g) => g.platform === platform);
    if (byPlat) return byPlat;
  }
  return groups.find((g) => g.type === groupType);
}

/**
 * Quy người nhận (Kang Chan, hungdt43, …) về đúng nhóm Zalo/Teams của dự án.
 * Nếu `chatName` trùng tên thành viên thì coi như gửi cho người đó, không phải tên nhóm.
 */
export function resolveSendTarget(input: ResolveSendTargetInput): ResolveSendTargetResult {
  const groups = input.groups ?? [];
  const members = input.members ?? [];
  let platform: SendPlatform | undefined =
    input.platform === "zalo" || input.platform === "teams" ? input.platform : undefined;
  let chatName = (input.chatName || "").trim();
  let memberName = (input.memberName || "").trim();

  const matchedGroup = chatName ? groups.find((g) => namesMatch(g.name, chatName)) : undefined;
  if (matchedGroup) {
    return {
      chatName: matchedGroup.name,
      platform: asPlatform(platform || matchedGroup.platform),
      memberName: memberName || undefined,
      note: `Nhóm: **${matchedGroup.name}**`,
    };
  }

  // chatName là tên người (vd LLM nhét "Kang Chan" vào chatName)
  if (chatName) {
    const asMember = members.find((m) => namesMatch(m.name, chatName));
    if (asMember) {
      if (!memberName) memberName = asMember.name;
      chatName = "";
    }
  }

  if (memberName) {
    const found = members.find((m) => namesMatch(m.name, memberName));
    if (!found) {
      const roster = members.length > 0
        ? `\n\nDanh sách thành viên:\n${members.map((m) => `- ${m.name} (${m.roleName || "—"})`).join("\n")}`
        : "";
      return {
        platform: asPlatform(platform),
        memberName,
        error:
          `Không tìm thấy **${memberName}** trong danh sách thành viên` +
          (input.projectName ? ` dự án **${input.projectName}**` : "") +
          "." +
          roster,
      };
    }

    const customer = isCustomerRole(found.roleName);
    const groupType = customer ? "customer" : "internal";
    if (!platform) platform = customer ? "zalo" : "teams";

    const pick = pickGroup(groups, groupType, platform);
    if (!pick) {
      const list = groups.length > 0
        ? `\n\nCác nhóm có sẵn:\n${groups.map((g) => `- ${g.name} (${g.type || "—"}, ${g.platform || "teams"})`).join("\n")}`
        : "";
      return {
        platform,
        memberName: found.name,
        foundMember: found,
        error:
          `Tìm thấy member **${found.name}** (${found.roleName || "—"}) nhưng dự án không có nhóm ${customer ? "khách hàng" : "nội bộ"} phù hợp.` +
          list,
      };
    }

    const resolvedPlatform = asPlatform(pick.platform, platform);
    return {
      chatName: pick.name,
      platform: resolvedPlatform,
      memberName: found.name,
      foundMember: found,
      note: `Tìm thấy member **${found.name}** (${found.roleName || "—"}) → nhóm ${customer ? "khách hàng" : "nội bộ"}: **${pick.name}**`,
    };
  }

  if (chatName) {
    return {
      chatName,
      platform: asPlatform(platform),
      memberName: memberName || undefined,
    };
  }

  const list = groups.length > 0
    ? `\n\nCác nhóm có sẵn:\n${groups.map((g) => `- ${g.name} (${g.type || "—"}, ${g.platform || "teams"})`).join("\n")}`
    : "";
  return {
    platform: asPlatform(platform),
    error: "Tôi cần biết **gửi đến nhóm nào** hoặc **người nào**." + list,
  };
}

export async function sendChatMessage(opts: {
  platform: SendPlatform;
  chatName: string;
  message: string;
}): Promise<{ ok: boolean; error?: string; targetChat?: string }> {
  const endpoint = opts.platform === "zalo" ? "/api/agents/zalo-send" : "/api/agents/teams-send";
  const timeoutMs = 150_000;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "send",
        chatName: opts.chatName,
        message: opts.message,
        headless: false,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const result = await res.json().catch(() => ({} as { ok?: boolean; error?: string; targetChat?: string }));
    if (!res.ok || !result.ok) {
      return { ok: false, error: result.error || `HTTP ${res.status}` };
    }
    return { ok: true, targetChat: result.targetChat || opts.chatName };
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      return { ok: false, error: `Quá thời gian gửi (${timeoutMs / 1000}s). Thử lại.` };
    }
    return { ok: false, error: err instanceof Error ? err.message : "Lỗi không xác định" };
  }
}

export function platformLabel(platform: SendPlatform | string | undefined): string {
  return platform === "zalo" ? "Zalo" : "Teams";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ResolveEmailTargetInput {
  emailTo?: string[];
  memberName?: string;
  members?: SendMember[] | null;
  projectName?: string;
}

export interface ResolveEmailTargetResult {
  emailTo: string[];
  memberName?: string;
  foundMember?: SendMember;
  note?: string;
  error?: string;
}

/**
 * Quy người nhận email: địa chỉ tường minh, hoặc tên thành viên → email trong hồ sơ dự án.
 */
export function resolveEmailTarget(input: ResolveEmailTargetInput): ResolveEmailTargetResult {
  const members = input.members ?? [];
  const rawTo = (input.emailTo || []).map((e) => (e || "").trim()).filter(Boolean);
  const emails = rawTo.filter((e) => EMAIL_RE.test(e));
  const names = rawTo.filter((e) => !EMAIL_RE.test(e));
  const memberName = (input.memberName || "").trim() || names[0] || "";

  if (emails.length > 0 && !memberName) {
    return { emailTo: [...new Set(emails)] };
  }

  if (memberName) {
    const found = members.find((m) => namesMatch(m.name, memberName));
    if (found) {
      const memberEmail = (found.email || "").trim();
      if (memberEmail && EMAIL_RE.test(memberEmail)) {
        return {
          emailTo: [...new Set([...emails, memberEmail])],
          memberName: found.name,
          foundMember: found,
          note: `Tìm thấy member **${found.name}** (${found.roleName || "—"}) → email **${memberEmail}**`,
        };
      }
      if (emails.length > 0) {
        return { emailTo: [...new Set(emails)], memberName: found.name, foundMember: found };
      }
      const rosterHint = members
        .filter((m) => (m.email || "").trim())
        .map((m) => `- ${m.name} <${m.email}>`)
        .join("\n");
      return {
        emailTo: [],
        memberName: found.name,
        foundMember: found,
        error:
          `Tìm thấy member **${found.name}** nhưng chưa có địa chỉ email trong hồ sơ.` +
          (rosterHint ? `\n\nThành viên có email:\n${rosterHint}` : "") +
          `\n\nVD: "Gửi email đến abc@gmail.com với tiêu đề Test và nội dung Xin chào"`,
      };
    }
    if (emails.length > 0) {
      return { emailTo: [...new Set(emails)], memberName };
    }
    const roster = members.length > 0
      ? `\n\nDanh sách thành viên:\n${members.map((m) => `- ${m.name}${m.email ? ` <${m.email}>` : ""} (${m.roleName || "—"})`).join("\n")}`
      : "";
    return {
      emailTo: [],
      memberName,
      error:
        `Không tìm thấy **${memberName}** trong danh sách thành viên` +
        (input.projectName ? ` dự án **${input.projectName}**` : "") +
        "." +
        roster,
    };
  }

  if (emails.length > 0) {
    return { emailTo: [...new Set(emails)] };
  }

  return {
    emailTo: [],
    error:
      `Tôi cần địa chỉ email hoặc tên thành viên để gửi.` +
      `\n\nVD: "Gửi email đến abc@gmail.com với tiêu đề Test và nội dung Xin chào"`,
  };
}

export async function sendOutlookEmail(opts: {
  to: string[];
  subject: string;
  body: string;
}): Promise<{ ok: boolean; error?: string }> {
  const raw = (opts.body || "").trim();
  const htmlBody = /<[a-z][\s\S]*>/i.test(raw) ? raw : `<p>${raw.replace(/\n/g, "<br>")}</p>`;
  const res = await fetch("/api/agents/outlook-send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "send",
      to: opts.to,
      subject: opts.subject,
      body: htmlBody,
      headless: false,
    }),
  });
  const result = await res.json().catch(() => ({} as { ok?: boolean; error?: string }));
  if (!res.ok || !result.ok) {
    return { ok: false, error: result.error || `HTTP ${res.status}` };
  }
  return { ok: true };
}
