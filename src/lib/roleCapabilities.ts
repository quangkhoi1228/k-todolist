/**
 * Danh mục chức năng (capabilities) mà một role trong dự án có thể thực hiện.
 * File thuần — KHÔNG import DB, dùng chung được cho cả server (repo) và client (UI).
 */
export type RoleCapability = {
  key: string;
  label: string;
  enabled?: boolean;
  note?: string;
};

export const CAPABILITY_CATALOG: RoleCapability[] = [
  { key: "track_project", label: "Theo dõi tiến độ dự án" },
  { key: "update_timeline", label: "Cập nhật tiến độ / timeline" },
  { key: "create_task", label: "Tạo / giao task triển khai" },
  { key: "approve_sow", label: "Duyệt SOW / phạm vi công việc" },
  { key: "review_deliverable", label: "Review / xác nhận kết quả bàn giao" },
  { key: "manage_members", label: "Quản lý thành viên trong dự án" },
  { key: "contact_customer", label: "Liên hệ / trao đổi với khách hàng" },
  { key: "approve_manday", label: "Duyệt manday / chi phí triển khai" },
  { key: "technical_exec", label: "Thực hiện kỹ thuật (triển khai, xử lý vấn đề)" },
  { key: "handover_ops", label: "Bàn giao vận hành sau triển khai" },
];

export const DEFAULT_ROLE_CAPABILITIES: Record<string, string[]> = {
  Sale: ["track_project", "contact_customer", "approve_manday", "review_deliverable"],
  "Pre-sale": ["track_project", "approve_sow", "technical_exec", "contact_customer"],
  "Tech Infras": ["track_project", "create_task", "technical_exec", "update_timeline"],
  "Project Manager": [
    "track_project", "update_timeline", "create_task", "review_deliverable",
    "manage_members", "contact_customer", "approve_sow", "approve_manday", "handover_ops",
  ],
};

export function defaultCapabilitiesFor(name: string): RoleCapability[] {
  const keys = DEFAULT_ROLE_CAPABILITIES[name] ?? [];
  return CAPABILITY_CATALOG.map((c) => ({
    ...c,
    enabled: keys.includes(c.key),
  }));
}

/**
 * Hợp nhất capabilities của role với permissions ghi đè của member.
 * - role chưa có capabilities → dùng catalog (tất cả disabled).
 * - member không có permissions → dùng capabilities của role.
 * - member có permissions → mỗi mục trong catalog lấy enable từ permissions
 *   (entry đầu tiên theo key), fallback về capabilities của role.
 */
export function resolveMemberCapabilities(
  role?: { capabilities?: any } | null,
  memberPermissions?: any
): RoleCapability[] {
  const roleCaps = Array.isArray(role?.capabilities)
    ? (role.capabilities as RoleCapability[])
    : CAPABILITY_CATALOG.map((c) => ({ ...c, enabled: false }));
  const perms = Array.isArray(memberPermissions)
    ? (memberPermissions as RoleCapability[])
    : null;

  return CAPABILITY_CATALOG.map((c) => {
    const inRole = roleCaps.find((r) => r.key === c.key);
    const inPerm = perms?.find((p) => p.key === c.key);
    return {
      ...c,
      enabled: inPerm !== undefined ? !!inPerm.enabled : !!inRole?.enabled,
      note: inPerm !== undefined ? (inPerm.note ?? inRole?.note) : inRole?.note,
    };
  });
}