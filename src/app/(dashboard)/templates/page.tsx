"use client";

import { useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  ArrowLeft,
  Boxes,
  CalendarRange,
  Clock,
  Layers,
  ListPlus,
  Package,
  Pencil,
  Plus,
  Tags,
  Trash2,
  Users,
} from "lucide-react";
import {
  useTaskTemplates,
  useTaskModules,
  useTaskTemplateMutations,
  useTaskModuleMutations,
} from "@/hooks/useDomain";
import { useInvalidate } from "@/hooks/useData";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ImportTemplatesDialog } from "@/components/templates/ImportTemplatesDialog";
import { ItemEditorDialog } from "@/components/templates/ItemEditorDialog";

interface TemplateItem {
  phase?: string;
  title?: string;
  details?: string;
  support?: string;
  manday?: number;
  startOffsetDays?: number;
  endOffsetDays?: number;
  isGroup?: boolean;
  type?: "module" | "task";
  moduleId?: string | number;
  _isGroupHeader?: boolean;
}

interface Template {
  id: string | number;
  name: string;
  category?: string;
  description?: string;
  items?: TemplateItem[];
  triggers?: string[];
  isActive?: boolean;
}

interface Module {
  id: string | number;
  name: string;
  description?: string;
  items?: TemplateItem[];
}

function formatDay(offset?: number) {
  if (offset === undefined || offset === null) return null;
  if (offset === 0) return "Ngày 0";
  return `Ngày ${offset > 0 ? "+" : ""}${offset}`;
}

function CategoryBadge({ category }: { category?: string }) {
  if (!category) return null;
  const colors: Record<string, string> = {
    migration: "bg-sky-500/15 text-sky-600 dark:text-sky-300",
    security: "bg-rose-500/15 text-rose-600 dark:text-rose-300",
    waf: "bg-violet-500/15 text-violet-600 dark:text-violet-300",
    general: "bg-neutral-500/15 text-neutral-600 dark:text-neutral-300",
  };
  return (
    <Badge variant="outline" className={`capitalize ${colors[category] ?? "bg-primary/10 text-primary"}`}>
      {category}
    </Badge>
  );
}

export default function TemplatesPage() {
  const { userId } = useAuth();
  const invalidate = useInvalidate();
  const { data: templates, isLoading } = useTaskTemplates(undefined, true);
  const { data: modules } = useTaskModules();
  const ttm = useTaskTemplateMutations();
  const mtm = useTaskModuleMutations();

  const [tab, setTab] = useState<"templates" | "modules">("templates");
  const [selectedId, setSelectedId] = useState<string | number | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<{
    mode: "template" | "module";
    record: any;
  } | null>(null);

  const selected = useMemo(
    () => templates?.find((t) => String(t.id) === String(selectedId)) ?? null,
    [templates, selectedId]
  );

  const modulesById = useMemo(() => {
    const m: Record<string, Module> = {};
    for (const mod of modules ?? []) m[String(mod.id)] = mod;
    return m;
  }, [modules]);

  // Nhóm task theo phase, giữ thứ tự xuất hiện; expand module refs inline.
  // Giữ group header con (isGroup) bên trong module làm tiểu mục (subGroup).
  // Đánh số thứ tự liên tục cho task thật (bỏ qua isGroup).
  const grouped = useMemo(() => {
    if (!selected?.items) return [] as { phase: string; isModule?: boolean; rows: TemplateItem[] }[];
    const groups: { phase: string; isModule?: boolean; rows: TemplateItem[] }[] = [];
    for (const item of selected.items) {
      if (item.type === "module") {
        const mod = modulesById[String(item.moduleId)];
        if (!mod) continue;
        const phase = mod.name;
        let g = groups.find((x) => x.phase === phase && x.isModule);
        if (!g) {
          g = { phase, isModule: true, rows: [] };
          groups.push(g);
        }
        for (const mi of mod.items ?? []) {
          g.rows.push({ ...mi, _isGroupHeader: mi.isGroup === true });
        }
      } else {
        const phase = item.phase || "Khác";
        let g = groups.find((x) => x.phase === phase && !x.isModule);
        if (!g) {
          g = { phase, rows: [] };
          groups.push(g);
        }
        g.rows.push({ ...item, _isGroupHeader: item.isGroup === true });
      }
    }
    return groups;
  }, [selected, modulesById]);

  // Flat list số thứ tự liên tục cho task thật (bỏ qua isGroup header)
  const taskNumber = useMemo(() => {
    const map = new Map<string, number>();
    let n = 0;
    for (const g of grouped) {
      for (const r of g.rows) {
        if (r._isGroupHeader) continue;
        n++;
        const key = `${g.phase}|${r.title}`;
        map.set(key, n);
      }
    }
    return map;
  }, [grouped]);

  const totalMandays = useMemo(
    () =>
      grouped.reduce(
        (sum, g) => sum + (g.rows ?? []).reduce((s: number, it: TemplateItem) => s + (it.manday ?? 0), 0),
        0
      ),
    [grouped]
  );

  const openNewTemplate = () => {
    setEditing({ mode: "template", record: { items: [] } });
    setEditorOpen(true);
  };
  const openEditTemplate = (t: Template) => {
    setEditing({ mode: "template", record: t });
    setEditorOpen(true);
  };
  const openNewModule = () => {
    setEditing({ mode: "module", record: { items: [] } });
    setEditorOpen(true);
  };
  const openEditModule = (m: Module) => {
    setEditing({ mode: "module", record: m });
    setEditorOpen(true);
  };

  const handleSave = async (payload: any) => {
    if (editing?.mode === "template") {
      if (payload.id) {
        await ttm.updateTaskTemplate({ id: payload.id, updates: payload });
      } else {
        await ttm.createTaskTemplate({ ...payload, userId });
      }
    } else {
      if (payload.id) {
        await mtm.updateTaskModule({ id: payload.id, updates: payload });
      } else {
        await mtm.createTaskModule({ ...payload, userId });
      }
    }
    await invalidate(["task-templates", "task-modules"]);
  };

  const handleDeleteTemplate = async (t: Template) => {
    if (!confirm(`Xoá template "${t.name}"?`)) return;
    await ttm.deleteTaskTemplate({ id: t.id, userId });
    setSelectedId(null);
    await invalidate(["task-templates"]);
  };

  const handleDeleteModule = async (m: Module) => {
    if (!confirm(`Xoá module "${m.name}"?`)) return;
    await mtm.deleteTaskModule({ id: m.id, userId });
    await invalidate(["task-modules"]);
  };

  return (
    <div className="p-4 md:p-6 h-full min-h-0 flex flex-col gap-4 overflow-hidden">
      <header className="flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-2.5">
          <Boxes className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-bold text-foreground">Task Templates</h1>
        </div>
        {/* Tabs */}
        <div className="flex items-center gap-1 rounded-lg bg-muted/40 p-0.5">
          <button
            onClick={() => setTab("templates")}
            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
              tab === "templates"
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Templates
          </button>
          <button
            onClick={() => setTab("modules")}
            className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
              tab === "modules"
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Modules
          </button>
        </div>
        <Badge variant="secondary">
          {tab === "templates" ? `${templates?.length ?? 0} template` : `${modules?.length ?? 0} module`}
        </Badge>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={openNewTemplate}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-all cursor-pointer shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            {tab === "templates" ? "Tạo template" : "Tạo module"}
          </button>
          {tab === "templates" && (
            <button
              onClick={() => setImportOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-all cursor-pointer shadow-sm"
            >
              <ListPlus className="w-3.5 h-3.5" />
              Import vào dự án
            </button>
          )}
        </div>
      </header>

      {tab === "templates" ? (
        isLoading ? (
          <div className="text-sm text-muted-foreground">Đang tải template...</div>
        ) : !templates || templates.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            Chưa có template nào. Click "Tạo template" để tạo mới, hoặc import file SOW (.xlsx)
            trong tab "Thông tin dự án" của một dự án trên trang Board.
          </Card>
        ) : (
          <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4 overflow-hidden">
            {/* ── Danh sách template ── */}
            <aside className="min-h-0 overflow-y-auto pr-1 space-y-2">
              {templates.map((t: Template) => {
                const active = String(t.id) === String(selectedId);
                const taskCount = (t.items ?? []).filter(
                  (it) => it.type === "module" || (!it.isGroup && it.title)
                ).length;
                return (
                  <div
                    key={String(t.id)}
                    className={`w-full rounded-xl border p-3 transition-all ${
                      active
                        ? "border-primary/60 bg-primary/10 shadow-sm"
                        : "border-border/60 bg-card hover:border-primary/40 hover:bg-muted/40"
                    }`}
                  >
                    <div
                      onClick={() => setSelectedId(t.id)}
                      className="cursor-pointer"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold text-sm text-foreground">{t.name}</span>
                        <CategoryBadge category={t.category} />
                      </div>
                      {t.description && (
                        <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{t.description}</p>
                      )}
                      <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Layers className="w-3 h-3" />
                          {taskCount}
                        </span>
                        {(t.triggers ?? []).length > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <Tags className="w-3 h-3" />
                            {(t.triggers ?? []).slice(0, 2).join(", ")}
                          </span>
                        )}
                        {(t.items ?? []).some((it) => it.type === "module") && (
                          <span className="inline-flex items-center gap-1 text-violet-500">
                            <Package className="w-3 h-3" />
                            {(t.items ?? []).filter((it) => it.type === "module").length} module
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-1 border-t border-border/40 pt-1.5">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => openEditTemplate(t)}
                        className="text-muted-foreground hover:text-primary cursor-pointer"
                        title="Sửa"
                      >
                        <Pencil className="w-3 h-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => handleDeleteTemplate(t)}
                        className="text-muted-foreground hover:text-destructive cursor-pointer"
                        title="Xoá"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </aside>

            {/* ── Chi tiết template ── */}
            <section className="min-h-0 overflow-y-auto">
              {!selected ? (
                <Card className="p-8 text-center text-sm text-muted-foreground">
                  Chọn một template bên trái để xem chi tiết.
                </Card>
              ) : (
                <Card size="sm" className="gap-0">
                  <CardHeader className="border-b border-border/60 pb-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <ArrowLeft
                          className="w-4 h-4 text-muted-foreground cursor-pointer hover:text-foreground"
                          onClick={() => setSelectedId(null)}
                        />
                        <CardTitle>{selected.name}</CardTitle>
                        <CategoryBadge category={selected.category} />
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="secondary">
                          <Package className="mr-1 w-3 h-3" />
                          {grouped.reduce((s, g) => s + (g.rows ?? []).filter((r) => !r._isGroupHeader).length, 0)} task
                        </Badge>
                        {totalMandays > 0 && (
                          <Badge variant="secondary">
                            <Clock className="mr-1 w-3 h-3" />
                            {totalMandays} manday
                          </Badge>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEditTemplate(selected)}
                          className="cursor-pointer"
                        >
                          <Pencil className="w-3 h-3 mr-1" />
                          Sửa
                        </Button>
                      </div>
                    </div>
                    {selected.description && (
                      <p className="text-sm text-muted-foreground">{selected.description}</p>
                    )}
                  </CardHeader>

                  <CardContent className="space-y-4 pt-4">
                    {grouped.map((group, gidx) => {
                      const taskCount = group.rows.filter((r) => !r._isGroupHeader).length;
                      return (
                      <div key={`${group.phase}-${gidx}`}>
                        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-primary">
                          <CalendarRange className="w-3.5 h-3.5" />
                          {group.phase}
                          {group.isModule && (
                            <Badge variant="outline" className="ml-1 text-violet-600 border-violet-500/30 normal-case">
                              <Package className="mr-1 w-2.5 h-2.5" />Module
                            </Badge>
                          )}
                          <span className="ml-auto font-medium text-muted-foreground normal-case">
                            {taskCount} task
                          </span>
                        </h3>
                        <div className="space-y-2">
                          {group.rows.map((item, idx) => {
                            if (item._isGroupHeader) {
                              return (
                                <div
                                  key={idx}
                                  className="flex items-center gap-2 pt-1"
                                >
                                  <div className="h-px flex-1 bg-border/40" />
                                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80 px-1">
                                    {item.title}
                                  </span>
                                  <div className="h-px flex-1 bg-border/40" />
                                </div>
                              );
                            }
                            const num = taskNumber.get(`${group.phase}|${item.title}`);
                            return (
                              <div
                                key={idx}
                                className="rounded-lg border border-border/60 bg-muted/30 p-3"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex items-start gap-2 min-w-0">
                                    <span className="shrink-0 text-[10px] font-mono font-bold text-primary/60 bg-primary/5 rounded px-1.5 py-0.5 tabular-nums">
                                      {num ?? ""}
                                    </span>
                                    <span className="font-medium text-sm text-foreground">
                                      {item.title || "(Chưa có tiêu đề)"}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    {item.manday ? (
                                      <Badge variant="outline">
                                        <Clock className="mr-1 w-3 h-3" />
                                        {item.manday} md
                                      </Badge>
                                    ) : null}
                                    {formatDay(item.startOffsetDays) && (
                                      <Badge variant="outline">{formatDay(item.startOffsetDays)}</Badge>
                                    )}
                                  </div>
                                </div>
                                {item.details && (
                                  <p className="mt-1 text-xs text-muted-foreground">{item.details}</p>
                                )}
                                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                                  {item.support && (
                                    <span className="inline-flex items-center gap-1">
                                      <Users className="w-3 h-3" /> Hỗ trợ: {item.support}
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      );
                    })}
                  </CardContent>
                </Card>
              )}
            </section>
          </div>
        )
      ) : (
        /* ── Modules tab ── */
        <div className="flex-1 min-h-0 overflow-y-auto">
          {!modules || modules.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              Chưa có module nào. Module là nhóm task dùng chung — tạo module (vd: "Thống nhất yêu
              cầu", "Nghiệm thu/Bàn giao") rồi chèn vào template để tái sử dụng.
              <div className="mt-3">
                <Button onClick={openNewModule} className="cursor-pointer">
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Tạo module đầu tiên
                </Button>
              </div>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {modules.map((m: Module) => (
                <Card key={String(m.id)} size="sm">
                  <CardHeader className="border-b border-border/40 pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Package className="w-4 h-4 text-violet-500 shrink-0" />
                        <CardTitle className="truncate">{m.name}</CardTitle>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => openEditModule(m)}
                          className="text-muted-foreground hover:text-primary cursor-pointer"
                          title="Sửa"
                        >
                          <Pencil className="w-3 h-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => handleDeleteModule(m)}
                          className="text-muted-foreground hover:text-destructive cursor-pointer"
                          title="Xoá"
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                    {m.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2 pt-1">{m.description}</p>
                    )}
                  </CardHeader>
                  <CardContent className="pt-2">
                    <div className="text-[10px] text-muted-foreground mb-1.5">
                      {(m.items ?? []).length} task
                    </div>
                    <div className="space-y-1">
                      {(m.items ?? []).slice(0, 4).map((it, idx) => (
                        <div key={idx} className="text-[10px] text-foreground/80 truncate">
                          • {it.phase ? `${it.phase}: ` : ""}{it.title}
                        </div>
                      ))}
                      {(m.items ?? []).length > 4 && (
                        <div className="text-[10px] text-muted-foreground">
                          +{(m.items ?? []).length - 4} task khác
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      <ImportTemplatesDialog open={importOpen} onOpenChange={setImportOpen} />
      {editing && (
        <ItemEditorDialog
          open={editorOpen}
          onOpenChange={setEditorOpen}
          mode={editing.mode}
          record={editing.record}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
