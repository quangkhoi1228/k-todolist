"use client";

import { useState, useRef, useMemo, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { Upload, FileSpreadsheet, X, Loader2, CheckCircle2, AlertTriangle, ListPlus, Sparkles, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useTaskTemplates, useTaskTemplateMutations, useTaskMutations } from "@/hooks/useDomain";
import { useInvalidate } from "@/hooks/useData";

interface SowPreviewItem {
  phase: string;
  title: string;
  details?: string;
  pic?: string;
  support?: string;
  manday?: number;
  isGroup?: boolean;
}

interface SowPreview {
  templateName: string;
  templateCategory: string;
  templateDescription?: string;
  triggers?: string[];
  items: SowPreviewItem[];
  rawRows?: number;
  skippedRows?: number;
}

export function SowImportDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  projectDescription,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
  projectDescription?: string;
}) {
  const { userId } = useAuth();
  const invalidate = useInvalidate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [preview, setPreview] = useState<SowPreview | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectedTemplateId, setDetectedTemplateId] = useState<string | null>(null);

  const { data: templates } = useTaskTemplates();
  const ttm = useTaskTemplateMutations();
  const tmx = useTaskMutations();

  // Auto-detect template từ mô tả dự án khi mở dialog
  useEffect(() => {
    if (!open) return;
    setDetecting(true);
    const text = `${projectName} ${projectDescription ?? ""}`;
    fetch(`/api/data/task-templates?action=detectTemplateForProject&text=${encodeURIComponent(text)}`)
      .then((r) => r.json())
      .then((data) => {
        setDetectedTemplateId(data && data.id ? String(data.id) : null);
      })
      .catch(() => setDetectedTemplateId(null))
      .finally(() => setDetecting(false));
  }, [open, projectName, projectDescription, userId]);

  // Reset state khi đóng
  useEffect(() => {
    if (!open) {
      setFileName(null);
      setPreview(null);
      setParseError(null);
      setCreated(null);
      setError(null);
      setSelectedTemplateId(null);
    }
  }, [open]);

  const handleFile = async (file: File) => {
    setFileName(file.name);
    setParseError(null);
    setPreview(null);
    setCreated(null);
    setParsing(true);
    try {
      const fd = new FormData();
      fd.append("userId", userId || "");
      fd.append("action", "previewSow");
      fd.append("file", file);
      const res = await fetch("/api/import-sow", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || data.error) {
        setParseError(data.error || "Không đọc được file");
        return;
      }
      setPreview(data);
      // Ưu tiên template detect từ file, nếu chưa có thì dùng template detect từ mô tả dự án
      const byFile = templates?.find((t) => t.category === data.templateCategory);
      setSelectedTemplateId(byFile ? String(byFile.id) : detectedTemplateId);
    } catch (err) {
      console.error(err);
      setParseError("Lỗi khi đọc file: " + (err instanceof Error ? err.message : "unknown"));
    } finally {
      setParsing(false);
    }
  };

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("userId", userId || "");
      fd.append("projectId", projectId);

      if (preview) {
        // Case 1: đã parse file SOW → import từ file (tạo/lấy template theo category + tạo tasks)
        fd.append("action", "importSow");
        fd.append("file", fileRef.current?.files?.[0] || new File([], ""));
      } else if (selectedTemplateId) {
        // Case 2: chọn template có sẵn → tạo task từ template
        fd.append("action", "createFromTemplate");
        fd.append("templateId", selectedTemplateId);
      } else {
        setError("Chưa có file SOW hoặc template nào được chọn");
        setCreating(false);
        return;
      }

      const res = await fetch("/api/import-sow", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok || data.error) {
        setError(data.error || "Tạo task thất bại");
        return;
      }
      setCreated(data.createdTasks ?? 0);
      await invalidate(["tasks", "task-templates"]);
    } catch (err) {
      console.error(err);
      setError("Lỗi: " + (err instanceof Error ? err.message : "unknown"));
    } finally {
      setCreating(false);
    }
  };

  const visibleItems = useMemo(() => {
    if (!preview) return [];
    return preview.items.filter((it) => !it.isGroup);
  }, [preview]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-4 h-4 text-emerald-500" />
            Import SOW / Template Task List
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
          {/* Upload zone */}
          <label className="flex flex-col items-center justify-center gap-1.5 border-2 border-dashed border-border/60 rounded-xl p-4 cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-all">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            <Upload className="w-4 h-4 text-muted-foreground" />
            <span className="text-[11px] font-medium text-muted-foreground">
              {fileName || "Chọn file SOW (.xlsx) — tự nhận diện template Migration / Security / WAF"}
            </span>
          </label>

          {detecting && (
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" />
              Đang tự nhận diện template theo mô tả dự án...
            </div>
          )}

          {parseError && (
            <div className="flex items-center gap-1.5 text-[10px] text-red-600 dark:text-red-400 bg-red-500/5 border border-red-500/20 rounded-lg px-2.5 py-1.5">
              <AlertTriangle className="w-3 h-3" />
              {parseError}
            </div>
          )}

          {error && (
            <div className="flex items-center gap-1.5 text-[10px] text-red-600 dark:text-red-400 bg-red-500/5 border border-red-500/20 rounded-lg px-2.5 py-1.5">
              <AlertTriangle className="w-3 h-3" />
              {error}
            </div>
          )}

          {created !== null && (
            <div className="flex items-center gap-1.5 text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-2.5 py-1.5">
              <CheckCircle2 className="w-3 h-3" />
              Đã tạo {created} task cho dự án {projectName}
            </div>
          )}

          {/* Template selector */}
          {templates && templates.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground">
                <Sparkles className="w-3 h-3" />
                Hoặc chọn template có sẵn:
              </div>
              <div className="flex flex-wrap gap-1.5">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setSelectedTemplateId(String(t.id));
                      setPreview(null);
                      setFileName(null);
                      setParseError(null);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-medium border transition-all cursor-pointer ${
                      selectedTemplateId === String(t.id)
                        ? "border-primary/60 bg-primary/10 text-primary"
                        : "border-border/50 hover:border-primary/30 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t.name}
                    {detectedTemplateId === String(t.id) && (
                      <span className="ml-1 text-[9px] text-emerald-600 dark:text-emerald-400">(phù hợp)</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Preview */}
          {parsing && (
            <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-[11px]">Đang đọc file SOW...</span>
            </div>
          )}

          {preview && !parsing && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-[11px] font-bold text-foreground">
                <span>Preview: {preview.templateName}</span>
                <span className="px-1.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 text-[9px] font-semibold">
                  {preview.templateCategory}
                </span>
                <span className="text-[9px] text-muted-foreground font-normal">
                  {visibleItems.length} tasks
                </span>
              </div>
              <div className="border border-border/50 rounded-lg overflow-hidden max-h-[280px] overflow-y-auto">
                <table className="w-full text-left text-[10px]">
                  <thead className="sticky top-0 bg-muted/60 backdrop-blur text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5 font-semibold">Phase</th>
                      <th className="px-2 py-1.5 font-semibold">Task</th>
                      <th className="px-2 py-1.5 font-semibold hidden sm:table-cell">Chi tiết</th>
                      <th className="px-2 py-1.5 font-semibold">PIC</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {visibleItems.map((it, idx) => (
                      <tr key={idx} className="hover:bg-muted/20">
                        <td className="px-2 py-1 text-muted-foreground whitespace-nowrap">{it.phase}</td>
                        <td className="px-2 py-1 font-medium">{it.title}</td>
                        <td className="px-2 py-1 text-muted-foreground hidden sm:table-cell truncate max-w-[260px]" title={it.details}>
                          {it.details || ""}
                        </td>
                        <td className="px-2 py-1 text-muted-foreground whitespace-nowrap">{it.pic || ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-border/30 mt-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="px-3 py-1.5 rounded-lg text-[10px] font-medium text-muted-foreground hover:bg-muted cursor-pointer"
          >
            Đóng
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={creating || (!preview && !selectedTemplateId)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[10px] font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {creating ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                Đang tạo...
              </>
            ) : (
              <>
                <ListPlus className="w-3 h-3" />
                {preview ? `Tạo ${visibleItems.length} task` : "Tạo task từ template"}
              </>
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
