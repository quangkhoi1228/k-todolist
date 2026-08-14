"use client";

/**
 * Tiến độ checklist hành động (các bước quy trình nghiệp vụ khớp) của một gợi ý.
 *
 * Lưu trong localStorage để:
 *  - PM tick "làm đến đâu check đến đó" sau khi bấm Duyệt
 *  - Trạng thái được chia sẻ giữa thông báo gợi ý (SuggestionNotificationCard)
 *    và panel Gợi ý (SuggestionsQuickView) của cùng một gợi ý.
 */

export interface ChecklistItem {
  title: string;
  description?: string;
  /** Nhóm sẽ gửi tin (VD: "Nhóm KH [FPT Cloud] Triển khai dự án Domesco HKT" / "Nhóm nội bộ FCI") */
  targetGroup?: string;
  /** Nội dung message đã soạn sẵn để gửi tới targetGroup */
  messageContent?: string;
  /** Trạng thái thực thi của agent — "pending" | "running" | "done" | "failed" */
  execStatus?: "pending" | "running" | "done" | "failed";
  /** Thông điệp lỗi nếu execStatus = "failed" */
  execError?: string;
}

const STORAGE_PREFIX = "pm-checklist-progress:v1:";

/** Tạo key ổn định cho một gợi ý dựa trên tiêu đề + danh sách checklist. */
export function checklistKey(title: string, checklist: ChecklistItem[]): string {
  const sig = [title, ...(checklist || []).map((c) => c.title)].join("|");
  let hash = 0;
  for (let i = 0; i < sig.length; i++) {
    hash = (hash * 31 + sig.charCodeAt(i)) >>> 0;
  }
  return `${STORAGE_PREFIX}${hash}`;
}

/** Đọc trạng thái đã tick của checklist (index -> checked). */
export function loadChecklistProgress(key: string): boolean[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((v) => Boolean(v));
  } catch { /* ignore */ }
  return [];
}

/** Ghi trạng thái tick của checklist. */
export function saveChecklistProgress(key: string, checked: boolean[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(checked));
  } catch { /* ignore */ }
}