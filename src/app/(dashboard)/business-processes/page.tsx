"use client";

import { useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  useBusinessProcesses,
  useBusinessProcessMutations,
} from "@/hooks/useDomain";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Workflow,
  Plus,
  Trash2,
  Pencil,
  ChevronDown,
  ChevronUp,
  Search,
  Loader2,
  AlertTriangle,
  Save,
  ListOrdered,
  Zap,
  Target,
} from "lucide-react";

const CATEGORY_OPTIONS = [
  { value: "kickoff", label: "Kickoff" },
  { value: "sow", label: "SOW" },
  { value: "delivery", label: "Triển khai" },
  { value: "handover", label: "Bàn giao" },
  { value: "general", label: "Chung" },
];

const DEFAULT_STEPS = [
  { order: 1, title: "", description: "", owner: "", duration: "" },
];

interface StepEditorProps {
  steps: any[];
  onChange: (steps: any[]) => void;
}

function StepEditor({ steps, onChange }: StepEditorProps) {
  const update = (index: number, field: string, value: string) => {
    onChange(
      steps.map((s, i) => (i === index ? { ...s, [field]: value } : s))
    );
  };

  return (
    <div className="space-y-2">
      {steps.map((step, index) => (
        <div
          key={index}
          className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/30 p-2"
        >
          <span className="mt-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
            {index + 1}
          </span>
          <div className="grid flex-1 grid-cols-2 gap-2">
            <Input
              placeholder="Tiêu đề bước (vd: Gửi mail kickoff)"
              value={step.title}
              onChange={(e) => update(index, "title", e.target.value)}
              className="col-span-2"
            />
            <Textarea
              placeholder="Mô tả bước"
              value={step.description}
              onChange={(e) => update(index, "description", e.target.value)}
              className="col-span-2 min-h-12 text-xs"
            />
            <Input
              placeholder="Người thực hiện"
              value={step.owner}
              onChange={(e) => update(index, "owner", e.target.value)}
            />
            <Input
              placeholder="Thời lượng"
              value={step.duration}
              onChange={(e) => update(index, "duration", e.target.value)}
            />
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onChange(steps.filter((_, i) => i !== index))}
            disabled={steps.length === 1}
            className="shrink-0 text-destructive hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          onChange([
            ...steps,
            { order: steps.length + 1, title: "", description: "", owner: "", duration: "" },
          ])
        }
      >
        <Plus className="size-3.5" />
        Thêm bước
      </Button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
        <Workflow className="h-8 w-8 text-primary" />
      </div>
      <div>
        <p className="text-sm font-semibold text-foreground">
          Chưa có quy trình nào
        </p>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">
          Tạo quy trình đầu tiên — ví dụ quy trình Kickoff, SOW, Bàn giao… Khi
          phân tích tin nhắn, PM Agent sẽ tham khảo kho này để đưa ra gợi ý phù
          hợp với quy trình.
        </p>
      </div>
    </div>
  );
}

export default function BusinessProcessesPage() {
  const { userId } = useAuth();
  const [includeInactive, setIncludeInactive] = useState(false);
  const { data: processes, isLoading, error } = useBusinessProcesses(userId, includeInactive);
  const pm = useBusinessProcessMutations();

  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Dialog state — create vs edit (editingProcess != null)
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProcess, setEditingProcess] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<any | null>(null);

  // Form fields
  const [form, setForm] = useState({
    name: "",
    category: "general",
    description: "",
    steps: JSON.parse(JSON.stringify(DEFAULT_STEPS)),
    triggers: "",
    outcome: "",
  });

  const setFormField = (field: string, value: any) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const filtered = useMemo(() => {
    let list = processes ?? [];
    if (categoryFilter) list = list.filter((p) => p.category === categoryFilter);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (p) =>
          (p.name || "").toLowerCase().includes(q) ||
          (p.description || "").toLowerCase().includes(q) ||
          (p.category || "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [processes, categoryFilter, query]);

  const openCreate = () => {
    setEditingProcess(null);
    setForm({
      name: "",
      category: "general",
      description: "",
      steps: JSON.parse(JSON.stringify(DEFAULT_STEPS)),
      triggers: "",
      outcome: "",
    });
    setDialogOpen(true);
  };

  const openEdit = (p: any) => {
    setEditingProcess(p);
    setForm({
      name: p.name ?? "",
      category: p.category ?? "general",
      description: p.description ?? "",
      steps: (p.steps ?? []).length > 0 ? JSON.parse(JSON.stringify(p.steps)) : JSON.parse(JSON.stringify(DEFAULT_STEPS)),
      triggers: Array.isArray(p.triggers) ? p.triggers.join("\n") : "",
      outcome: p.outcome ?? "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !userId || saving) return;
    setSaving(true);
    try {
      const steps = form.steps
        .filter((s: any) => s.title?.trim())
        .map((s: any, i: number) => ({
          order: i + 1,
          title: s.title.trim(),
          description: s.description?.trim() ?? "",
          owner: s.owner?.trim() ?? "",
          duration: s.duration?.trim() ?? "",
        }));
      const triggers = form.triggers
        .split("\n")
        .map((t) => t.trim())
        .filter(Boolean);
      const payload = {
        userId,
        name: form.name.trim(),
        category: form.category || null,
        description: form.description.trim(),
        steps,
        triggers,
        outcome: form.outcome.trim() || undefined,
      };
      if (editingProcess) {
        await pm.updateBusinessProcess({
          id: editingProcess._id,
          updates: { ...payload, isActive: editingProcess.isActive },
        });
      } else {
        await pm.createBusinessProcess(payload);
      }
      setDialogOpen(false);
    } catch (err: any) {
      alert(err?.message || "Không thể lưu quy trình");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await pm.deleteBusinessProcess({ userId, id: deleteConfirm._id });
      setDeleteConfirm(null);
    } catch (err: any) {
      alert(err?.message || "Không thể xoá quy trình");
    }
  };

  const toggleActive = async (p: any) => {
    try {
      await pm.updateBusinessProcess({
        id: p._id,
        updates: { isActive: !p.isActive },
      });
    } catch (err: any) {
      alert(err?.message || "Không thể đổi trạng thái");
    }
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-4 md:p-6">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Workflow className="h-5 w-5 text-primary" />
            Kho quy trình
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Mô tả cách xử lý một tình huống nghiệp vụ — PM Agent tham khảo kho
            này cùng lịch sử chat để đưa ra gợi ý.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="size-4" />
          Thêm quy trình
        </Button>
      </div>

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Tìm quy trình…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={categoryFilter || "all"} onValueChange={(v) => setCategoryFilter(v === "all" ? "" : (v ?? ""))}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Tất cả nhóm" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tất cả nhóm</SelectItem>
            {CATEGORY_OPTIONS.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
            className="accent-primary"
          />
          Hiện quy trình tạm ẩn
        </label>
      </div>

      {/* List */}
      <div className="space-y-2">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Đang tải…
          </div>
        ) : error ? (
          <div className="flex items-center justify-center gap-2 py-16 text-xs text-red-500">
            <AlertTriangle className="h-4 w-4" />
            {error?.message ?? "Không thể tải danh sách"}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState />
        ) : (
          filtered.map((p) => {
            const isOpen = expanded.has(p._id);
            const stepCount = (p.steps ?? []).length;
            return (
              <div
                key={p._id}
                className={`rounded-xl border bg-card/50 transition-colors ${
                  p.isActive === false ? "border-dashed opacity-70" : "border-border/60"
                }`}
              >
                <div className="flex items-center gap-3 p-3">
                  <button
                    onClick={() => toggleExpand(p._id)}
                    className="flex flex-1 cursor-pointer items-center gap-3 text-left"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <ListOrdered className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-foreground">
                          {p.name}
                        </span>
                        {p.category && (
                          <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground uppercase">
                            {CATEGORY_OPTIONS.find((c) => c.value === p.category)?.label ?? p.category}
                          </span>
                        )}
                        {p.isActive === false && (
                          <span className="shrink-0 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                            Tạm ẩn
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                        {p.description}
                      </p>
                    </div>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {stepCount} bước
                      {p.triggers?.length > 0 ? ` · ${p.triggers.length} trigger` : ""}
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="ghost" size="icon-sm" onClick={() => toggleActive(p)} title={p.isActive === false ? "Kích hoạt lại" : "Tạm ẩn"}>
                      {p.isActive === false ? <Zap className="size-3.5" /> : <Target className="size-3.5 text-muted-foreground" />}
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => openEdit(p)} title="Sửa">
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleteConfirm(p)}
                      title="Xoá"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => toggleExpand(p._id)} title={isOpen ? "Thu gọn" : "Mở rộng"}>
                      {isOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                    </Button>
                  </div>
                </div>

                {isOpen && (
                  <div className="border-t border-border/40 px-4 py-3">
                    {(p.steps ?? []).length > 0 && (
                      <div className="mb-3">
                        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          Các bước thực hiện
                        </p>
                        <div className="space-y-1.5">
                          {(p.steps ?? []).map((s: any, i: number) => (
                            <div key={i} className="flex items-start gap-2">
                              <span className="mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] font-bold text-primary">
                                {s.order ?? i + 1}
                              </span>
                              <div className="min-w-0 flex-1">
                                <span className="text-xs font-semibold text-foreground">
                                  {s.title}
                                </span>
                                {s.description && (
                                  <p className="text-[11px] text-muted-foreground whitespace-pre-wrap">
                                    {s.description}
                                  </p>
                                )}
                                {(s.owner || s.duration) && (
                                  <p className="text-[10px] text-muted-foreground/70">
                                    {s.owner ? `Người thực hiện: ${s.owner}` : ""}
                                    {s.owner && s.duration ? " · " : ""}
                                    {s.duration ? `Thời lượng: ${s.duration}` : ""}
                                  </p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {(p.triggers ?? []).length > 0 && (
                      <div className="mb-3">
                        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          Điều kiện kích hoạt
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {(p.triggers ?? []).map((t: string, i: number) => (
                            <span key={i} className="rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-600 dark:text-blue-400">
                              {t}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {p.outcome && (
                      <div>
                        <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          Kết quả mong đợi
                        </p>
                        <p className="text-[11px] text-muted-foreground whitespace-pre-wrap">
                          {p.outcome}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingProcess ? "Sửa quy trình" : "Thêm quy trình mới"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Tên quy trình <span className="text-destructive">*</span>
              </label>
              <Input
                placeholder="vd: Kickoff dự án Cloud"
                value={form.name}
                onChange={(e) => setFormField("name", e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Nhóm
                </label>
                <Select
                  value={form.category || "general"}
                  onValueChange={(v) => setFormField("category", v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Chọn nhóm" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORY_OPTIONS.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Điều kiện kích hoạt
                  <span className="ml-1 text-[10px] text-muted-foreground/60">
                    (mỗi dòng 1 từ khoá)
                  </span>
                </label>
                <Textarea
                  placeholder={"vd: kickoff\nđã ký hợp đồng\nkhởi tạo dự án"}
                  value={form.triggers}
                  onChange={(e) => setFormField("triggers", e.target.value)}
                  className="min-h-16 text-xs"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Mô tả
              </label>
              <Textarea
                placeholder="Mô tả ngắn quy trình này dùng khi nào…"
                value={form.description}
                onChange={(e) => setFormField("description", e.target.value)}
                className="min-h-16 text-xs"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Các bước thực hiện
              </label>
              <StepEditor
                steps={form.steps}
                onChange={(steps) => setFormField("steps", steps)}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Kết quả mong đợi
              </label>
              <Textarea
                placeholder="Khi hoàn thành quy trình này, trạng thái mong muốn là gì?"
                value={form.outcome}
                onChange={(e) => setFormField("outcome", e.target.value)}
                className="min-h-12 text-xs"
              />
            </div>
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Huỷ</DialogClose>
            <Button onClick={handleSave} disabled={saving || !form.name.trim()}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              {editingProcess ? "Lưu thay đổi" : "Tạo quy trình"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={deleteConfirm !== null} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Xoá quy trình</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Bạn có chắc muốn xoá{" "}
            <span className="font-semibold text-foreground">{deleteConfirm?.name}</span>?
            Hành động này không thể hoàn tác.
          </p>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Huỷ</DialogClose>
            <Button variant="destructive" onClick={handleDelete}>
              <Trash2 className="size-4" />
              Xoá
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
