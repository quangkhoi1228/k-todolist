import { UserButton } from "@clerk/nextjs";
import { LayoutDashboard, ListTodo, BarChartHorizontal, Folder } from "lucide-react";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { ManageProjectsDialog } from "@/components/board/ManageProjectsDialog";

export default function Sidebar() {
  return (
    <div className="w-48 glass-panel border-r border-border h-screen hidden md:flex flex-col relative z-10 shrink-0">
      <div className="h-14 flex items-center px-4 border-b border-border bg-muted/20">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center border border-primary/30 glow-primary">
            <span className="text-primary font-black text-sm">K</span>
          </div>
          <h1 className="text-lg font-extrabold text-foreground tracking-tight">KFlow</h1>
        </div>
      </div>
      
      <nav className="flex-1 px-2.5 py-6 space-y-2">
        <p className="px-2.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">Chế độ xem</p>
        <Link href="/board" className="group flex items-center gap-2 px-2.5 py-2 text-xs font-semibold rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 hover:shadow-md transition-all duration-300">
          <LayoutDashboard className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
          Bảng (Kanban)
        </Link>
        <Link href="/list" className="group flex items-center gap-2 px-2.5 py-2 text-xs font-semibold rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 hover:shadow-md transition-all duration-300">
          <ListTodo className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
          Danh sách
        </Link>
        <Link href="/gantt" className="group flex items-center gap-2 px-2.5 py-2 text-xs font-semibold rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 hover:shadow-md transition-all duration-300">
          <BarChartHorizontal className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
          Biểu đồ Gantt
        </Link>
        <ManageProjectsDialog>
          <div className="group flex items-center gap-2 px-2.5 py-2 text-xs font-semibold rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 hover:shadow-md transition-all duration-300 cursor-pointer">
            <Folder className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
            Dự án & Phân loại
          </div>
        </ManageProjectsDialog>
      </nav>

      <div className="p-3 border-t border-border bg-muted/20 flex items-center justify-between transition-colors rounded-b-xl gap-2">
        <UserButton appearance={{ elements: { avatarBox: "w-8 h-8 border border-border" } }} />
        <ThemeToggle />
      </div>
    </div>
  );
}
