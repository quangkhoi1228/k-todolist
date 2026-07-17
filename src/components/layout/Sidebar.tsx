"use client";

import { UserButton } from "@clerk/nextjs";
import { LayoutDashboard, ListTodo, BarChartHorizontal, Folder, Download, FileText } from "lucide-react";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { Logo } from "@/components/ui/Logo";
import { usePwaInstall } from "@/context/PwaContext";

export default function Sidebar() {
  const { isInstallable, installApp } = usePwaInstall();

  return (
    <div className="w-48 glass-panel border-r border-border h-screen hidden md:flex flex-col relative z-10 shrink-0">
      <div className="h-14 flex items-center px-4 border-b border-border bg-muted/20">
        <div className="flex items-center gap-2">
          <Logo size={28} className="glow-primary" />
          <h1 className="text-lg font-extrabold text-foreground tracking-tight">KFlow</h1>
        </div>
      </div>
      
      <nav className="flex-1 px-2.5 py-6 space-y-2">
        <p className="px-2.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2">Chế độ xem</p>
        <Link href="/board" className="group flex items-center gap-2 px-2.5 py-2 text-xs font-semibold rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 hover:shadow-md transition-all duration-300">
          <LayoutDashboard className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
          Kanban
        </Link>
        <Link href="/list" className="group flex items-center gap-2 px-2.5 py-2 text-xs font-semibold rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 hover:shadow-md transition-all duration-300">
          <ListTodo className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
          Danh sách
        </Link>
        <Link href="/gantt" className="group flex items-center gap-2 px-2.5 py-2 text-xs font-semibold rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 hover:shadow-md transition-all duration-300">
          <BarChartHorizontal className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
          Biểu đồ Gantt
        </Link>
        <Link href="/notes" className="group flex items-center gap-2 px-2.5 py-2 text-xs font-semibold rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 hover:shadow-md transition-all duration-300">
          <FileText className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
          Ghi chú
        </Link>
        <p className="px-2.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2 mt-4">Quản lý</p>
        <Link href="/projects" className="group flex items-center gap-2 px-2.5 py-2 text-xs font-semibold rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 hover:shadow-md transition-all duration-300">
          <Folder className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
          Dự án
        </Link>

        {isInstallable && (
          <button
            onClick={installApp}
            className="w-full flex items-center gap-2 px-2.5 py-2 text-xs font-semibold rounded-lg text-primary hover:text-primary-foreground bg-primary/10 hover:bg-primary border border-primary/20 hover:border-primary transition-all duration-300 cursor-pointer shadow-sm hover:shadow-md mt-4"
          >
            <Download className="w-4 h-4" />
            Cài đặt App
          </button>
        )}
      </nav>

      <div className="p-3 border-t border-border bg-muted/20 flex items-center justify-between transition-colors rounded-b-xl gap-2">
        <UserButton appearance={{ elements: { avatarBox: "w-8 h-8 border border-border" } }} />
        <ThemeToggle />
      </div>
    </div>
  );
}
