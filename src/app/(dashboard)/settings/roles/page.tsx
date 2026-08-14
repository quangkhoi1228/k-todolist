"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRoles, useRoleUsageCounts, useRoleMutations } from "@/hooks/useDomain";
import { CAPABILITY_CATALOG, type RoleCapability } from "@/lib/roleCapabilities";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Cog,
  Plus,
  Trash2,
  Edit3,
  Save,
  AlertTriangle,
  Users,
  Palette,
  ShieldCheck,
} from "lucide-react";

const ROLE_COLORS = [
  { name: "Xanh lá", value: "#10b981" },
  { name: "Xanh dương", value: "#3b82f6" },
  { name: "Vàng", value: "#f59e0b" },
  { name: "Tím", value: "#8b5cf6" },
  { name: "Hồng", value: "#ec4899" },
  { name: "Đỏ", value: "#ef4444" },
  { name: "Cam", value: "#f97316" },
  { name: "Xanh cyan", value: "#06b6d4" },
  { name: "Xám", value: "#6b7280" },
];

export default function RolesSettingsPage() {
  const { userId } = useAuth();
  const { data: roles } = useRoles(userId);
  const { data: usageCounts } = useRoleUsageCounts(userId);
  const rm = useRoleMutations();

  const [editingRole, setEditingRole] = useState<any | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("#10b981");
  const [editOrder, setEditOrder] = useState(0);
  const [editCapabilities, setEditCapabilities] = useState<RoleCapability[]>([]);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#10b981");
  const [newCapabilities, setNewCapabilities] = useState<RoleCapability[]>(
    CAPABILITY_CATALOG.map((c) => ({ ...c, enabled: false }))
  );

  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Ngăn seed lặp: sau khi seed, không seed lại trong cùng phiên dù roles refetch
  const seededRef = useRef(false);

  // Seed roles on first load if empty
  useEffect(() => {
    if (roles !== undefined && userId && !seededRef.current) {
      const defaultNames = ["Sale", "Pre-sale", "Tech Infras", "Project Manager", "Khách hàng", "Firewall License Manager"];
      const hasAllDefaults = defaultNames.every((n) =>
        roles.some((r) => r.name === n)
      );
      // Seed khi chưa có role nào HOẶC thiếu role mặc định (backfill role mới
      // như "Khách hàng" cho user đã có sẵn role cũ)
      if (roles.length === 0 || !hasAllDefaults) {
        seededRef.current = true;
        rm.seedDefaultRoles(userId);
      }
    }
  }, [roles, userId, rm]);

  const openEdit = useCallback((role: any) => {
    setEditingRole(role);
    setEditName(role.name);
    setEditColor(role.color || "#10b981");
    setEditOrder(role.order ?? 0);
    setEditCapabilities(
      Array.isArray(role.capabilities) && role.capabilities.length > 0
        ? CAPABILITY_CATALOG.map((c) => {
            const found = role.capabilities.find((rc: any) => rc.key === c.key);
            return { ...c, enabled: found ? !!found.enabled : !!c.enabled };
          })
        : CAPABILITY_CATALOG.map((c) => ({ ...c, enabled: false }))
    );
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editingRole || !editName.trim()) return;
    await rm.updateRole(editingRole._id, {
      name: editName.trim(),
      color: editColor,
      order: editOrder,
      capabilities: editCapabilities,
    });
    setEditingRole(null);
  }, [editingRole, editName, editColor, editOrder, editCapabilities, rm]);

  const handleCreate = useCallback(async () => {
    if (!newName.trim() || !userId) return;
    await rm.createRole({
      userId,
      name: newName.trim(),
      color: newColor,
      order: (roles ?? []).length,
      capabilities: newCapabilities,
    });
    setNewName("");
    setNewColor("#10b981");
    setNewCapabilities(CAPABILITY_CATALOG.map((c) => ({ ...c, enabled: false })));
    setIsCreateOpen(false);
  }, [newName, newColor, userId, rm, roles, newCapabilities]);

  const handleDelete = useCallback(
    async (roleId: string) => {
      try {
        await rm.deleteRole(roleId);
        setDeleteConfirm(null);
      } catch (err: any) {
        alert(err.message || "Không thể xoá role");
      }
    },
    [rm]
  );

  const toggleCapability = useCallback((key: string, list: RoleCapability[], set: (v: RoleCapability[]) => void) => {
    set(
      list.map((c) =>
        c.key === key ? { ...c, enabled: !c.enabled } : c
      )
    );
  }, []);

  const isDefaultRole = (name: string) =>
    ["Sale", "Pre-sale", "Tech Infras", "Project Manager", "Khách hàng", "Firewall License Manager"].includes(name);

  return (
    <div className="p-3 h-full min-h-0 flex flex-col gap-3">
      {/* Header */}
      <div className="glass p-3 rounded-xl border border-border/60 shadow-md shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cog className="w-4 h-4 text-primary" />
            <div>
              <h1 className="text-sm font-bold text-foreground">Cấu hình</h1>
              <p className="text-[9px] text-muted-foreground/60">
                Quản lý danh sách vai trò thành viên dự án
              </p>
            </div>
          </div>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <Button
              size="sm"
              className="h-7 text-[10px] rounded-lg cursor-pointer"
              onClick={() => setIsCreateOpen(true)}
            >
              <Plus className="w-3 h-3 mr-1" />
              Thêm role
            </Button>
            <DialogContent className="sm:max-w-sm bg-card border-border">
              <DialogHeader>
                <DialogTitle>Thêm vai trò mới</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-3 py-2">
                <div>
                  <label className="text-[10px] font-semibold text-muted-foreground mb-1 block">
                    Tên vai trò
                  </label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="VD: QA Tester"
                    className="w-full h-8 px-2.5 text-xs rounded-lg bg-muted border border-border text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/50"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-muted-foreground mb-1 block">
                    Màu sắc
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {ROLE_COLORS.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => setNewColor(c.value)}
                        className="w-6 h-6 rounded-full border-2 transition-all cursor-pointer"
                        style={{
                          backgroundColor: c.value,
                          borderColor: newColor === c.value ? "white" : "transparent",
                          boxShadow:
                            newColor === c.value
                              ? `0 0 0 2px ${c.value}`
                              : undefined,
                        }}
                        title={c.name}
                      />
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-muted-foreground mb-1 block">
                    Chức năng role được thực hiện
                  </label>
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-border/50 bg-background/60 divide-y divide-border/40">
                    {CAPABILITY_CATALOG.map((c) => {
                      const item = newCapabilities.find((nc) => nc.key === c.key);
                      const enabled = item?.enabled ?? false;
                      return (
                        <button
                          key={c.key}
                          type="button"
                          onClick={() =>
                            setNewCapabilities((prev) =>
                              prev.map((p) =>
                                p.key === c.key ? { ...p, enabled: !enabled } : p
                              )
                            )
                          }
                          className={`w-full flex items-center gap-2 px-2 py-1.5 text-left transition-colors cursor-pointer ${
                            enabled ? "bg-primary/5" : "hover:bg-muted/40"
                          }`}
                        >
                          <span
                            className={`w-3 h-3 rounded border flex items-center justify-center shrink-0 transition-colors ${
                              enabled
                                ? "bg-emerald-500 border-emerald-500 text-white"
                                : "border-border bg-transparent"
                            }`}
                          >
                            {enabled && (
                              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4">
                                <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </span>
                          <span className={`text-[10px] ${enabled ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                            {c.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-2">
                <DialogClose
                  render={
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-[10px] cursor-pointer"
                    >
                      Hủy
                    </Button>
                  }
                />
                <Button
                  size="sm"
                  className="h-7 text-[10px] cursor-pointer"
                  disabled={!newName.trim()}
                  onClick={handleCreate}
                >
                  <Save className="w-3 h-3 mr-1" />
                  Lưu
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Role list */}
      <div className="flex-1 min-h-0 overflow-auto">
        {!roles ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : roles.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-16">
            <Cog className="w-12 h-12 text-muted-foreground/20 mb-4" />
            <p className="text-xs font-bold text-foreground/80">
              Chưa có vai trò nào
            </p>
            <p className="text-[10px] text-muted-foreground/60 mt-1 mb-6 max-w-xs">
              Thêm vai trò đầu tiên để bắt đầu quản lý thành viên dự án
            </p>
          </div>
        ) : (
          <div className="grid gap-2">
            {roles.map((role) => {
              const usageCount = usageCounts?.[role._id] ?? 0;
              const isDefault = isDefaultRole(role.name);
              const isEditing = editingRole?._id === role._id;

              return (
                <div
                  key={role._id}
                  className="glass p-3 rounded-xl border border-border/40 shadow-sm flex items-center gap-3"
                >
                  {/* Color dot */}
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{
                      backgroundColor: (role.color || "#10b981") + "20",
                      color: role.color || "#10b981",
                    }}
                  >
                    <Users className="w-4 h-4" />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <div className="flex flex-col gap-2">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full h-7 px-2 text-xs rounded-lg bg-muted border border-border text-foreground outline-none focus:border-primary/50"
                        />
                        <div className="flex items-center gap-2">
                          <div className="flex flex-wrap gap-1">
                            {ROLE_COLORS.map((c) => (
                              <button
                                key={c.value}
                                type="button"
                                onClick={() => setEditColor(c.value)}
                                className="w-5 h-5 rounded-full border-2 transition-all cursor-pointer"
                                style={{
                                  backgroundColor: c.value,
                                  borderColor:
                                    editColor === c.value ? "white" : "transparent",
                                  boxShadow:
                                    editColor === c.value
                                      ? `0 0 0 2px ${c.value}`
                                      : undefined,
                                }}
                                title={c.name}
                              />
                            ))}
                          </div>
                          <div className="flex gap-1 ml-auto">
                            <Button
                              size="xs"
                              variant="ghost"
                              className="cursor-pointer text-emerald-500"
                              onClick={handleSaveEdit}
                            >
                              <Save className="w-3 h-3" />
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              className="cursor-pointer"
                              onClick={() => setEditingRole(null)}
                            >
                              Hủy
                            </Button>
                          </div>
                        </div>
                        <div>
                          <label className="text-[9px] font-semibold text-muted-foreground mb-1 block flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3" />
                            Chức năng role được thực hiện
                          </label>
                          <div className="grid grid-cols-1 gap-0.5 max-h-36 overflow-y-auto rounded-md border border-border/40 bg-background/60 divide-y divide-border/30">
                            {CAPABILITY_CATALOG.map((c) => {
                              const item = editCapabilities.find((ec) => ec.key === c.key);
                              const enabled = item?.enabled ?? false;
                              return (
                                <button
                                  key={c.key}
                                  type="button"
                                  onClick={() =>
                                    toggleCapability(c.key, editCapabilities, setEditCapabilities)
                                  }
                                  className={`w-full flex items-center gap-1.5 px-1.5 py-1 text-left transition-colors cursor-pointer ${
                                    enabled ? "bg-primary/5" : "hover:bg-muted/40"
                                  }`}
                                >
                                  <span
                                    className={`w-2.5 h-2.5 rounded border flex items-center justify-center shrink-0 ${
                                      enabled
                                        ? "bg-emerald-500 border-emerald-500 text-white"
                                        : "border-border bg-transparent"
                                    }`}
                                  >
                                    {enabled && (
                                      <svg width="6" height="6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4">
                                        <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                                      </svg>
                                    )}
                                  </span>
                                  <span className={`text-[9px] ${enabled ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                                    {c.label}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-xs font-bold text-foreground">
                            {role.name}
                          </span>
                          {isDefault && (
                            <span className="ml-1.5 text-[8px] px-1 py-0.5 rounded bg-primary/10 text-primary">
                              Mặc định
                            </span>
                          )}
                          <div className="flex items-center gap-2 mt-0.5">
                            <span
                              className="text-[9px] px-1.5 py-0.5 rounded-full font-medium"
                              style={{
                                backgroundColor: (role.color || "#10b981") + "20",
                                color: role.color || "#10b981",
                              }}
                            >
                              {usageCount} thành viên
                            </span>
                            {(() => {
                              const caps = Array.isArray(role.capabilities)
                                ? role.capabilities
                                : [];
                              const enabledCount = caps.filter((c: any) => c.enabled).length;
                              if (caps.length === 0) return null;
                              return (
                                <span
                                  className="text-[9px] px-1.5 py-0.5 rounded-full font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1"
                                  title={caps
                                    .filter((c: any) => c.enabled)
                                    .map((c: any) => c.label)
                                    .join(", ")}
                                >
                                  <ShieldCheck className="w-2.5 h-2.5" />
                                  {enabledCount}/{caps.length} chức năng
                                </span>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  {!isEditing && (
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        className="cursor-pointer"
                        onClick={() => openEdit(role)}
                        title="Sửa"
                      >
                        <Edit3 className="w-3 h-3" />
                      </Button>

                      {deleteConfirm === role._id ? (
                        <div className="flex items-center gap-1">
                          <Button
                            size="xs"
                            variant="destructive"
                            className="cursor-pointer text-[9px] h-6"
                            onClick={() => handleDelete(role._id)}
                          >
                            <AlertTriangle className="w-3 h-3 mr-0.5" />
                            Xác nhận
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost"
                            className="cursor-pointer text-[9px] h-6"
                            onClick={() => setDeleteConfirm(null)}
                          >
                            Hủy
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          className="cursor-pointer text-rose-500"
                          onClick={() => setDeleteConfirm(role._id)}
                          title="Xoá"
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
