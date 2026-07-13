import { UserButton } from "@clerk/nextjs";
import { LayoutDashboard, ListTodo, BarChartHorizontal, Folder } from "lucide-react";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { ManageProjectsDialog } from "@/components/board/ManageProjectsDialog";

export default function Sidebar() {
  return (
    <div className="w-64 glass-panel border-r border-border h-screen hidden md:flex flex-col relative z-10 shrink-0">
      <div className="h-16 flex items-center px-6 border-b border-border bg-muted/20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center border border-primary/30 glow-primary">
            <span className="text-primary font-black">K</span>
          </div>
          <h1 className="text-xl font-extrabold text-foreground tracking-tight">KFlow</h1>
        </div>
      </div>
      
      <nav className="flex-1 px-4 py-8 space-y-3">
        <p className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Chế độ xem</p>
        <Link href="/board" className="group flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/50 hover:shadow-lg transition-all duration-300">
          <LayoutDashboard className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
          Bảng (Kanban)
        </Link>
        <Link href="/list" className="group flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/50 hover:shadow-lg transition-all duration-300">
          <ListTodo className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
          Danh sách
        </Link>
        <Link href="/gantt" className="group flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/50 hover:shadow-lg transition-all duration-300">
          <BarChartHorizontal className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
          Biểu đồ Gantt
        </Link>
        
        <div className="pt-4 hidden">
          <p className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Quản lý</p>
          <ManageProjectsDialog>
            <div className="w-full text-left group flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted/50 hover:shadow-lg transition-all duration-300 cursor-pointer">
              <Folder className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
              Dự án & Phân loại
            </div>
          </ManageProjectsDialog>
        </div>
      </nav>

      <div className="p-4 border-t border-border bg-muted/20 flex items-center gap-3 transition-colors rounded-b-xl">
        <UserButton appearance={{ elements: { avatarBox: "w-9 h-9 border border-border" } }} />
        <div className="flex flex-col cursor-default">
          <span className="text-sm font-medium text-foreground">Tài khoản của tôi</span>
          <span className="text-xs text-muted-foreground">Quản lý cài đặt</span>
        </div>
        <ThemeToggle />
      </div>
    </div>
  );
}
