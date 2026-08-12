"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Loader2,
  Package,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { useTaskModules } from "@/hooks/useDomain";
import { useInvalidate } from "@/hooks/useData";

export interface EditableItem {
  phase?: string;
  title?: string;
  details?: string;
  support?: string;
  manday?: number;
  startOffsetDays?: number;
  endOffsetDays?: number;
  isGroup?: boolean;
  type?: "task" | "module";
  moduleId?: string | number;
}

export interface ItemEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "template" cho phép chèn module; "module" không cho (tránh đệ quy) */
  mode: "template" | "module";
  /** Record đang sửa (id, name, category, description, items, triggers) */
  record: {
    id?: string | number;
    name?: string;
    category?: string;
    description?: string;
    items?: any[];
    triggers?: string[];
  } | null;
  /** Tên mặc định khi tạo mới */
  defaultName?: string;
  /** Callback lưu — nhận object đầy đủ (name, category?, description?, items, triggers?) */
  onSave: (payload: {
    id?: string | number;
    name: string;
    category?: string;
    description?: string;
    items: EditableItem[];
    triggers?: string[];
  }) => Promise<void>;
}

const EMPTY_ITEM: EditableItem = { phase: "", title: "", details: "", support: "", manday: 0 };

export function ItemEditorDialog({
  open,
  onOpenChange,
  mode,
  record,
  defaultName = "",
  onSave,
}: ItemEditorProps) {
  const { userId } = useAuth();
  const invalidate = useInvalidate();
  const { data: modules } = useTaskModules();

  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [triggers, setTriggers] = useState("");
  const [items, setItems] = useState<EditableItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingModule, setAddingModule] = useState(false);

  // Reset khi mở dialog hoặc đổi record
  useEffect(() => {
    if (!open) return;
    if (record && record.items) {
      setName(record.name ?? "");
      setCategory(record.category ?? "");
      setDescription(record.description ?? "");
      setTriggers((record.triggers ?? []).join(", "));
      setItems(normalizeItems(record.items));
    } else {
      setName(defaultName);
      setCategory("");
      setDescription("");
      setTriggers("");
      setItems([{ ...EMPTY_ITEM }]);
    }
    setError(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, record]);

  function normalizeItems(raw: any[]): EditableItem[] {
    if (!Array.isArray(raw)) return [{ ...EMPTY_ITEM }];
    const out: EditableItem[] = [];
    for (const it of raw) {
      if (it.type === "module" && it.moduleId) {
        out.push({ type: "module", moduleId: it.moduleId });
      } else if (it.title) {
        out.push({
          phase: it.phase ?? "",
          title: it.title,
          details: it.details ?? "",
          support: it.support ?? "",
          manday: it.manday ?? 0,
        });
      }
    }
    return out.length > 0 ? out : [{ ...EMPTY_ITEM }];
  }

  const updateItem = (idx: number, patch: Partial<EditableItem>) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const removeItem = (idx: number) => {
    setItems((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      return next.length > 0 ? next : [{ ...EMPTY_ITEM }];
    });
  };

  const addTask = () => {
    setItems((prev) => [...prev, { ...EMPTY_ITEM }]);
  };

  const insertModule = (moduleId: string | number) => {
    setItems((prev) => [...prev, { type: "module", moduleId }]);
    setAddingModule(false);
  };

  const moveItem = (idx: number, dir: -1 | 1) => {
    setItems((prev) => {
      const idx2 = idx + dir;
      if (idx2 < 0 || idx2 >= prev.length) return prev;
      const next = [...prev];
      [next[idx2], next[idx]] = [next[idx], next[idx2]];
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      if (!name.trim()) {
        setError("Tên không được để trống");
        setSaving(false);
        return;
      }
      // Lọc task rỗng + giữ module ref
      const cleanItems = items.filter(
        (it) =>
          (it.type === "module" && it.moduleId) ||
          (it.title && it.title.trim() !== "")
      );
      const payload: any = {
        id: record?.id,
        name: name.trim(),
        category: category.trim() || undefined,
        description: description.trim() || undefined,
        items: cleanItems,
        triggers: triggers.trim()
          ? triggers.split(",").map((s) => s.trim()).filter(Boolean)
          : undefined,
      };
      await onSave(payload);
      await invalidate(["task-templates", "task-modules"]);
      onOpenChange(false);
    } catch (err: any) {
      setError(err?.message || "Lỗi khi lưu");
    } finally {
      setSaving(false);
    }
  };

  const sortedModules = (modules ?? []) as any[];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[88vh] flex flex-col bg-popover border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <ClipboardList className="w-4 h-4 text-primary" />
            {record?.id ? "Sửa " : "Tạo "}
            {mode === "template" ? "template" : "module"}
          </DialogTitle>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="absolute right-4 top-4 p-1 rounded-md hover:bg-muted text-muted-foreground cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </DialogHeader>

        <div className="flex flex-col gap-3 overflow-y-auto pr-1">
          {/* Header info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground">Tên *</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={mode === "template" ? "VD: Migration Cloud" : "VD: Thống nhất yêu cầu"}
                className="h-8 px-2.5 text-xs rounded-lg bg-background border border-border outline-none focus:border-primary/50"
              />
            </div>
            {mode === "template" && (
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-semibold text-muted-foreground">Category</label>
                <input
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="migration / security / waf"
                  className="h-8 px-2.5 text-xs rounded-lg bg-background border border-border outline-none focus:border-primary/50"
                />
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-muted-foreground">Mô tả</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder={mode === "template" ? "Khi nào dùng template này" : "Module này chứa gì"}
              className="px-2.5 py-1.5 text-xs rounded-lg bg-background border border-border outline-none focus:border-primary/50 resize-none"
            />
          </div>

          {mode === "template" && (
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-muted-foreground">
                Triggers (từ khoá auto-detect, cách nhau dấu phẩy)
              </label>
              <input
                value={triggers}
                onChange={(e) => setTriggers(e.target.value)}
                placeholder="migrate, migration, onprem"
                className="h-8 px-2.5 text-xs rounded-lg bg-background border border-border outline-none focus:border-primary/50"
              />
            </div>
          )}

          {/* Items list */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-semibold text-muted-foreground">
                Danh sách task {mode === "template" ? "+ module" : ""}
              </label>
              <span className="text-[9px] text-muted-foreground">
                {items.filter((it) => it.type === "module").length} module ·{" "}
                {items.filter((it) => !it.type && it.title).length} task
              </span>
            </div>

            <div className="flex flex-col gap-2">
              {items.map((it, idx) => {
                if (it.type === "module") {
                  const mod = sortedModules.find((m) => String(m.id) === String(it.moduleId));
                  return (
                    <div
                      key={idx}
                      className="flex items-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/5 px-2.5 py-2"
                    >
                      <Package className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-foreground truncate">
                          {mod?.name ?? "(module đã xoá)"}
                        </div>
                        <div className="text-[9px] text-muted-foreground">
                          Module · {(mod?.items ?? []).length} task
                          {mod?.description ? ` · ${mod.description}` : ""}
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => moveItem(idx, -1)}
                          disabled={idx === 0}
                          className="p-1 rounded-md hover:bg-muted disabled:opacity-30 cursor-pointer"
                        >
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveItem(idx, 1)}
                          disabled={idx === items.length - 1}
                          className="p-1 rounded-md hover:bg-muted disabled:opacity-30 cursor-pointer"
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeItem(idx)}
                          className="p-1 rounded-md hover:bg-rose-500/10 text-rose-500 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={idx} className="rounded-lg border border-border/50 bg-muted/30 p-2.5">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <input
                        type="text"
                        value={it.phase ?? ""}
                        onChange={(e) => updateItem(idx, { phase: e.target.value })}
                        placeholder="Phase (vd: Chuẩn bị)"
                        className="h-7 px-2 text-[10px] rounded bg-background border border-border/50 outline-none focus:border-primary/40 w-32"
                      />
                      <input
                        type="text"
                        value={it.title ?? ""}
                        onChange={(e) => updateItem(idx, { title: e.target.value })}
                        placeholder="Tên task *"
                        className="h-7 px-2 text-[10px] rounded bg-background border border-border/50 outline-none focus:border-primary/40 flex-1"
                      />
                      <button
                        type="button"
                        onClick={() => moveItem(idx, -1)}
                        disabled={idx === 0}
                        className="p-1 rounded-md hover:bg-muted disabled:opacity-30 cursor-pointer"
                      >
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveItem(idx, 1)}
                        disabled={idx === items.length - 1}
                        className="p-1 rounded-md hover:bg-muted disabled:opacity-30 cursor-pointer"
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeItem(idx)}
                        className="p-1 rounded-md hover:bg-rose-500/10 text-rose-500 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <textarea
                      value={it.details ?? ""}
                      onChange={(e) => updateItem(idx, { details: e.target.value })}
                      placeholder="Chi tiết"
                      rows={2}
                      className="w-full px-2 py-1 text-[10px] rounded bg-background border border-border/50 outline-none focus:border-primary/40 resize-none mb-1.5"
                    />
                    <div className="flex flex-wrap items-center gap-1.5">
                      <input
                        type="text"
                        value={it.support ?? ""}
                        onChange={(e) => updateItem(idx, { support: e.target.value })}
                        placeholder="Hỗ trợ"
                        className="h-6 px-2 text-[10px] rounded bg-background border border-border/50 outline-none focus:border-primary/40 w-32"
                      />
                      <input
                        type="number"
                        min={0}
                        value={it.manday ?? 0}
                        onChange={(e) => updateItem(idx, { manday: e.target.value ? Number(e.target.value) : 0 })}
                        placeholder="md"
                        className="h-6 px-2 w-16 text-[10px] rounded bg-background border border-border/50 outline-none focus:border-primary/40"
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Add buttons */}
            <div className="flex items-center gap-1.5 mt-1">
              <button
                type="button"
                onClick={addTask}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium border border-border/50 text-foreground hover:bg-muted cursor-pointer"
              >
                <Plus className="w-3 h-3" /> Thêm task
              </button>
              {mode === "template" && (
                <button
                  type="button"
                  onClick={() => setAddingModule(true)}
                  disabled={!modules || modules.length === 0}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium border border-violet-500/30 text-violet-600 dark:text-violet-400 hover:bg-violet-500/10 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  <Package className="w-3 h-3" /> Chèn module
                </button>
              )}
            </div>

            {/* Module picker popover */}
            {addingModule && mode === "template" && (
              <div className="flex flex-col gap-1 rounded-lg border border-violet-500/30 bg-violet-500/5 p-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-muted-foreground">
                    Chọn module để chèn
                  </span>
                  <button
                    type="button"
                    onClick={() => setAddingModule(false)}
                    className="p-0.5 rounded hover:bg-muted cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <div className="flex flex-col gap-1 max-h-[160px] overflow-y-auto">
                  {sortedModules.map((m) => (
                    <button
                      key={String(m.id)}
                      type="button"
                      onClick={() => insertModule(m.id)}
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left hover:bg-violet-500/10 cursor-pointer"
                    >
                      <Package className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-foreground truncate">{m.name}</div>
                        <div className="text-[9px] text-muted-foreground">
                          {(m.items ?? []).length} task{m.description ? ` · ${m.description}` : ""}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-1.5 text-[10px] text-red-600 dark:text-red-400 bg-red-500/5 border border-red-500/20 rounded-lg px-2.5 py-1.5">
              <X className="w-3 h-3" />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-border/30 mt-2">
          <DialogClose
            render={
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg text-[10px] font-medium text-muted-foreground hover:bg-muted cursor-pointer"
              >
                Huỷ
              </button>
            }
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[10px] font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            Lưu
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
