"use client";

import { useState, useMemo } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Loader2,
  ListPlus,
  Package,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useProjects, useTaskTemplates } from "@/hooks/useDomain";
import { useInvalidate } from "@/hooks/useData";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Template {
  id: string | number;
  name: string;
  category?: string;
  items?: any[];
}

export function ImportTemplatesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { userId } = useAuth();
  const invalidate = useInvalidate();
  const { data: templates } = useTaskTemplates(undefined, true);
  const { data: projects } = useProjects(userId);

  const [projectId, setProjectId] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<Array<string | number>>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ created: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const orderedTemplates = useMemo(() => {
    return (selectedIds
      .map((id) => templates?.find((t) => String(t.id) === String(id)))
      .filter(Boolean) as Template[]);
  }, [selectedIds, templates]);

  const totalTasks = useMemo(
    () =>
      orderedTemplates.reduce(
        (sum, t) => sum + (t.items ?? []).filter((i: any) => !i.isGroup && i.title).length,
        0
      ),
    [orderedTemplates]
  );

  const reset = () => {
    setProjectId("");
    setSelectedIds([]);
    setResult(null);
    setError(null);
  };

  const handleClose = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const toggleTemplate = (id: string | number) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
    setResult(null);
    setError(null);
  };

  const moveUp = (idx: number) => {
    if (idx === 0) return;
    setSelectedIds((prev) => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  };

  const moveDown = (idx: number) => {
    setSelectedIds((prev) => {
      if (idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
      return next;
    });
  };

  const handleImport = async () => {
    if (!projectId) {
      setError("Chọn dự án trước");
      return;
    }
    if (selectedIds.length === 0) {
      setError("Chọn ít nhất 1 template");
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const res = await fetch("/api/data/task-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "createFromTemplates",
          userId,
          projectId,
          templateIds: selectedIds,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || "Import thất bại");
        return;
      }
      setResult({ created: data.createdTasks ?? 0 });
      await invalidate(["tasks", "tasksByProject"]);
    } catch (err: any) {
      setError(err?.message || "Lỗi khi import");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col bg-popover border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <ListPlus className="w-4 h-4 text-primary" />
            Import template vào dự án
          </DialogTitle>
          <button
            type="button"
            onClick={() => handleClose(false)}
            className="absolute right-4 top-4 p-1 rounded-md hover:bg-muted text-muted-foreground cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </DialogHeader>

        <div className="flex flex-col gap-3 overflow-y-auto pr-1">
          {/* Project selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold text-muted-foreground">
              Chọn dự án
            </label>
            <Select value={projectId} onValueChange={(v) => { setProjectId(v || ""); setResult(null); setError(null); }}>
              <SelectTrigger className="bg-background border-border text-foreground h-9 rounded-lg text-xs cursor-pointer">
                <SelectValue placeholder="— Chọn dự án —" />
              </SelectTrigger>
              <SelectContent className="bg-card/95 backdrop-blur-xl border-border">
                {projects?.map((p) => (
                  <SelectItem key={p._id} value={p._id} className="text-xs cursor-pointer">
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Template picker */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold text-muted-foreground">
              Chọn 1 hoặc nhiều template
            </label>
            <div className="flex flex-wrap gap-1.5">
              {(templates ?? []).map((t: Template) => {
                const active = selectedIds.includes(t.id);
                return (
                  <button
                    key={String(t.id)}
                    type="button"
                    onClick={() => toggleTemplate(t.id)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-medium border transition-all cursor-pointer ${
                      active
                        ? "border-primary/60 bg-primary/10 text-primary"
                        : "border-border/50 hover:border-primary/30 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t.name}
                    <span className="ml-1 text-[9px] opacity-60">
                      ({(t.items ?? []).filter((i: any) => !i.isGroup && i.title).length})
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Ordered list */}
          {orderedTemplates.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-semibold text-muted-foreground">
                  Thứ tự import (trên xuống dưới)
                </label>
                <span className="text-[9px] text-muted-foreground">
                  {orderedTemplates.length} template · {totalTasks} task
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                {orderedTemplates.map((tmpl, idx) => (
                  <div
                    key={String(tmpl.id)}
                    className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/30 px-2.5 py-2"
                  >
                    <span className="text-[10px] font-bold text-muted-foreground w-5 text-center shrink-0">
                      {idx + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-foreground truncate">{tmpl.name}</div>
                      <div className="text-[9px] text-muted-foreground">
                        {(tmpl.items ?? []).filter((i: any) => !i.isGroup && i.title).length} task
                        {tmpl.category ? ` · ${tmpl.category}` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => moveUp(idx)}
                        disabled={idx === 0}
                        className="p-1 rounded-md hover:bg-muted text-muted-foreground disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                        title="Lên"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveDown(idx)}
                        disabled={idx === orderedTemplates.length - 1}
                        className="p-1 rounded-md hover:bg-muted text-muted-foreground disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                        title="Xuống"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleTemplate(tmpl.id)}
                        className="p-1 rounded-md hover:bg-rose-500/10 text-rose-500 cursor-pointer"
                        title="Bỏ chọn"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground/70 mt-0.5">
                <Package className="w-3 h-3" />
                Thứ tự trên→dưới quyết định giá trị <code className="font-mono">order</code> của task:
                task từ template #1 có order nhỏ hơn template #2 → hiển thị trước trong Danh sách & Gantt.
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-1.5 text-[10px] text-red-600 dark:text-red-400 bg-red-500/5 border border-red-500/20 rounded-lg px-2.5 py-1.5">
              <X className="w-3 h-3" />
              {error}
            </div>
          )}

          {result && (
            <div className="flex items-center gap-1.5 text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-2.5 py-1.5">
              <CheckCircle2 className="w-3 h-3" />
              Đã tạo {result.created} task vào dự án.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 pt-3 border-t border-border/30 mt-2">
          <Badge variant="secondary">
            {totalTasks} task sẽ được tạo
          </Badge>
          <div className="flex items-center gap-2">
            <DialogClose
              render={
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-lg text-[10px] font-medium text-muted-foreground hover:bg-muted cursor-pointer"
                >
                  Đóng
                </button>
              }
            />
            <button
              type="button"
              onClick={handleImport}
              disabled={importing || !projectId || selectedIds.length === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[10px] font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {importing ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <ListPlus className="w-3 h-3" />
              )}
              {selectedIds.length > 0
                ? `Tạo ${totalTasks} task từ ${selectedIds.length} template`
                : "Import"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
