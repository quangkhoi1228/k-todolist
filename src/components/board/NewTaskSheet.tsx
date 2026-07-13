"use client";

import { useState, useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useAuth } from "@clerk/nextjs";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { startOfDay, format } from "date-fns";

export interface TaskData {
  _id: string;
  title: string;
  estimatedTime: number;
  startDate: number;
  pic?: string;
  project?: string;
  status?: string;
  order?: number;
}

interface NewTaskSheetProps {
  children?: React.ReactNode;
  defaultDate?: Date;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  editTask?: TaskData;
}

export function NewTaskSheet({ children, defaultDate, open: controlledOpen, onOpenChange, editTask }: NewTaskSheetProps) {
  const { userId } = useAuth();
  const createTask = useMutation(api.tasks.createTask);
  const updateTask = useMutation(api.tasks.updateTask);
  const projects = useQuery(api.projects.getProjects, userId ? { userId } : "skip");
  const [internalOpen, setInternalOpen] = useState(false);

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? onOpenChange! : setInternalOpen;

  const [title, setTitle] = useState(editTask?.title || "");
  const [estimatedTime, setEstimatedTime] = useState(editTask?.estimatedTime?.toString() || "1");
  const [startDate, setStartDate] = useState(
    editTask?.startDate 
      ? format(new Date(editTask.startDate), "yyyy-MM-dd") 
      : defaultDate 
        ? format(defaultDate, "yyyy-MM-dd") 
        : format(new Date(), "yyyy-MM-dd")
  );
  const [pic, setPic] = useState(editTask?.pic || "");
  const [project, setProject] = useState(editTask?.project || "");
  const [status, setStatus] = useState(editTask?.status || "todo");

  useEffect(() => {
    if (editTask && open) {
      setTitle(editTask.title);
      setEstimatedTime(editTask.estimatedTime.toString());
      setStartDate(format(new Date(editTask.startDate), "yyyy-MM-dd"));
      setPic(editTask.pic || "");
      setProject(editTask.project || "");
      setStatus(editTask.status || "todo");
    }
  }, [editTask, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;

    if (editTask) {
      await updateTask({
        id: editTask._id as any,
        title,
        estimatedTime: parseFloat(estimatedTime),
        startDate: startOfDay(new Date(startDate)).getTime(),
        pic: pic || undefined,
        project: project && project !== "none" ? (project as any) : undefined,
        status: status,
      });
    } else {
      await createTask({
        userId,
        title,
        estimatedTime: parseFloat(estimatedTime),
        startDate: startOfDay(new Date(startDate)).getTime(),
        endDate: startOfDay(new Date(startDate)).getTime(),
        pic: pic || undefined,
        project: project && project !== "none" ? (project as any) : undefined,
        status: status,
        order: Date.now(), // default order is current timestamp to place at end
      });
    }

    setOpen(false);
    if (!editTask) {
      setTitle("");
      setEstimatedTime("1");
      setProject("");
      setStatus("todo");
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen} modal={false}>
      {children && <SheetTrigger>{children}</SheetTrigger>}
      <SheetContent side="right" hideOverlay className="bg-card text-foreground border-l border-border w-full sm:w-[600px] sm:max-w-none shadow-2xl p-8 overflow-y-auto">
        <SheetHeader className="mb-8">
          <SheetTitle className="text-2xl font-bold tracking-tight">
            {editTask ? "Sửa Công Việc" : "Thêm Công Việc Mới"}
          </SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-3">
            <Label htmlFor="title" className="text-sm font-semibold">Tên Công Việc</Label>
            <Textarea 
              id="title" 
              value={title} 
              onChange={(e) => {
                setTitle(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${e.target.scrollHeight}px`;
              }} 
              className="bg-muted/50 border-border text-foreground min-h-[80px] p-4 rounded-xl focus-visible:ring-primary/50 resize-none overflow-hidden"
              placeholder="Ví dụ: Thiết kế giao diện"
              required 
            />
          </div>
          
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-3">
              <Label htmlFor="estimatedTime" className="text-sm font-semibold">Thời gian dự kiến (Giờ)</Label>
              <Input 
                id="estimatedTime" 
                type="number" 
                min="0.5" 
                step="0.5" 
                value={estimatedTime} 
                onChange={(e) => setEstimatedTime(e.target.value)} 
                className="bg-muted/50 border-border text-foreground h-12 px-4 rounded-xl focus-visible:ring-primary/50"
                required 
              />
            </div>
            <div className="space-y-3">
              <Label htmlFor="startDate" className="text-sm font-semibold">Ngày thực hiện</Label>
              <Input 
                id="startDate" 
                type="date" 
                value={startDate} 
                onChange={(e) => setStartDate(e.target.value)} 
                className="bg-muted/50 border-border text-foreground block w-full h-12 px-4 rounded-xl focus-visible:ring-primary/50"
                required 
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-3">
              <Label htmlFor="project" className="text-sm font-semibold">Dự án / Nhóm việc (Tùy chọn)</Label>
              <Select value={project} onValueChange={(val) => setProject(val || "none")}>
                <SelectTrigger className="bg-muted/50 border-border text-foreground h-12 px-4 rounded-xl focus-visible:ring-primary/50">
                  <SelectValue placeholder="Chọn dự án" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" className="text-muted-foreground italic">Không có dự án</SelectItem>
                  {projects?.map(p => (
                    <SelectItem key={p._id} value={p._id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-3">
              <Label htmlFor="status" className="text-sm font-semibold">Trạng thái</Label>
              <Select value={status} onValueChange={(val) => setStatus(val || "todo")}>
                <SelectTrigger className="bg-muted/50 border-border text-foreground h-12 px-4 rounded-xl focus-visible:ring-primary/50">
                  <SelectValue placeholder="Chọn trạng thái" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todo">Chưa thực hiện (To do)</SelectItem>
                  <SelectItem value="processing">Đang xử lý (Processing)</SelectItem>
                  <SelectItem value="pending">Tạm dừng (Pending)</SelectItem>
                  <SelectItem value="done">Đã hoàn thành (Done)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-3">
            <Label htmlFor="pic" className="text-sm font-semibold">Người phụ trách (Tùy chọn)</Label>
            <Input 
              id="pic" 
              value={pic} 
              onChange={(e) => setPic(e.target.value)} 
              className="bg-muted/50 border-border text-foreground h-12 px-4 rounded-xl focus-visible:ring-primary/50"
              placeholder="Nhập tên người phụ trách"
            />
          </div>
          <div className="pt-8">
            <Button type="submit" className="w-full h-12 font-bold text-base rounded-xl shadow-lg shadow-primary/20 hover:shadow-primary/40 transition-all hover:-translate-y-0.5">
              {editTask ? "Lưu Thay Đổi" : "Tạo Công Việc"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
