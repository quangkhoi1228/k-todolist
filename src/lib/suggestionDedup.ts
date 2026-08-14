/**
 * Dedup gợi ý theo chủ đề — nếu đã có gợi ý cùng topic mà CHƯA thực hiện
 * (isResolved=false và checklist chưa done) thì không tạo/báo lại.
 */

export type SuggestionLike = {
  id?: number | string;
  _id?: string;
  type?: string;
  title?: string;
  description?: string;
  sourceMessage?: string | null;
  isResolved?: boolean;
  suggestionData?: string | null;
  checklist?: any[];
  createdAt?: number;
};

function blobOf(s: SuggestionLike): string {
  return `${s?.title || ""} ${s?.description || ""} ${s?.sourceMessage || ""}`;
}

export function isLicenseRelated(s: SuggestionLike): boolean {
  const blob = blobOf(s);
  if (!blob.trim()) return false;
  const hasProduct = /license|pall?o\s*alto|fortinet|fortigate|firewall/i.test(blob);
  const hasExpiry = /hết\s*hạn|het han|expir|gia\s*hạn|gia han|renewal|sắp hết|extend/i.test(blob);
  return hasProduct && (hasExpiry || (/license/i.test(blob) && /palo|fortinet|firewall/i.test(blob)));
}

function licenseProduct(blob: string): string {
  if (/pall?o\s*alto/i.test(blob)) return "palo-alto";
  if (/fortinet|fortigate/i.test(blob)) return "fortinet";
  return "firewall";
}

export function normalizeText(text: string): string {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(text: string): string[] {
  return normalizeText(text)
    .split(" ")
    .filter((t) => t.length > 2);
}

export function tokenOverlap(haystack: string, needle: string): number {
  const hay = new Set(tokenize(haystack));
  const needles = tokenize(needle);
  if (hay.size === 0 || needles.length === 0) return 0;
  return needles.filter((t) => hay.has(t)).length / needles.length;
}

/** Khóa chủ đề: mọi card gia hạn Palo Alto cùng 1 key, Fortinet key khác. */
export function suggestionTopic(s: SuggestionLike): string {
  const blob = blobOf(s);
  if (isLicenseRelated(s)) return `license-renewal:${licenseProduct(blob)}`;
  const title = normalizeText(s.title || "");
  return title ? `title:${title.slice(0, 80)}` : `desc:${normalizeText(s.description || "").slice(0, 80)}`;
}

export function isChecklistExecuted(suggestionData?: string | null, checklist?: any[]): boolean {
  let cl = checklist;
  if (!cl && suggestionData) {
    try {
      const parsed = typeof suggestionData === "string" ? JSON.parse(suggestionData) : suggestionData;
      cl = parsed?.checklist;
    } catch {
      /* ignore */
    }
  }
  if (!Array.isArray(cl) || cl.length === 0) return false;
  return cl.every((c: any) => c?.execStatus === "done");
}

/** Chưa xử lý: chưa mark resolved và checklist chưa chạy xong. */
export function isPendingItem(s: SuggestionLike): boolean {
  if (s?.isResolved) return false;
  if (isChecklistExecuted(s?.suggestionData, s?.checklist)) return false;
  return true;
}

export function isPendingDuplicate(candidate: SuggestionLike, existing: SuggestionLike[]): boolean {
  const pending = (existing || []).filter(isPendingItem);
  if (pending.length === 0) return false;
  const topic = suggestionTopic(candidate);
  if (pending.some((e) => suggestionTopic(e) === topic)) return true;
  const cTitle = candidate.title || "";
  if (cTitle.length >= 12) {
    return pending.some((e) => {
      const t = e.title || "";
      return t.length >= 12 && tokenOverlap(t, cTitle) >= 0.7 && tokenOverlap(cTitle, t) >= 0.7;
    });
  }
  return pending.some(
    (e) => (e.title || "") === cTitle && (e.description || "") === (candidate.description || "")
  );
}

function rank(s: SuggestionLike): number {
  const id = Number(s.id);
  if (Number.isFinite(id) && id > 0) return id;
  return Number(s.createdAt || 0);
}

function itemKey(s: SuggestionLike): string {
  if (s.id != null && s.id !== "") return `id:${s.id}`;
  if (s._id) return `_id:${s._id}`;
  return `t:${suggestionTopic(s)}|${s.title || ""}`;
}

/** Giữ bản mới nhất mỗi topic (id lớn hơn). So khớp theo id, không theo object identity. */
export function keepNewestPendingPerTopic<T extends SuggestionLike>(items: T[]): T[] {
  const best = new Map<string, T>();
  for (const item of items) {
    const topic = suggestionTopic(item);
    const prev = best.get(topic);
    if (!prev || rank(item) >= rank(prev)) best.set(topic, item);
  }
  const keepKeys = new Set(Array.from(best.values()).map(itemKey));
  return items.filter((i) => keepKeys.has(itemKey(i)));
}

export function olderPendingDuplicates<T extends SuggestionLike>(items: T[]): T[] {
  const pending = items.filter(isPendingItem);
  const newestKeys = new Set(keepNewestPendingPerTopic(pending).map(itemKey));
  if (newestKeys.size === 0 && pending.length > 0) return [];
  return pending.filter((i) => !newestKeys.has(itemKey(i)));
}

/** Tin chat suggestion_notification cũ hơn (cùng project + topic) — ẩn khỏi UI. */
export function supersededSuggestionMessageIds(
  messages: Array<{ _id?: string; id?: number | string; metadata?: string | null; createdAt?: number }>
): Set<string> {
  const seen = new Set<string>();
  const superseded = new Set<string>();
  const sorted = [...messages].sort((a, b) => {
    const dt = Number(b.createdAt || 0) - Number(a.createdAt || 0);
    if (dt !== 0) return dt;
    return Number(b.id || 0) - Number(a.id || 0);
  });
  for (const m of sorted) {
    if (!m.metadata) continue;
    let meta: any;
    try {
      meta = JSON.parse(m.metadata);
    } catch {
      continue;
    }
    if (meta?.action !== "suggestion_notification" || !Array.isArray(meta.suggestions)) continue;
    const first = meta.suggestions[0] || {};
    const key = `${meta.projectId || ""}|${suggestionTopic(first)}`;
    const id = String(m._id ?? m.id ?? "");
    if (!id) continue;
    if (seen.has(key)) superseded.add(id);
    else seen.add(key);
  }
  return superseded;
}
