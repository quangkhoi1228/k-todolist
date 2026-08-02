"use client";

import { useState } from "react";
import { UserButton } from "@clerk/nextjs";
import { LayoutDashboard, ListTodo, BarChartHorizontal, Folder, Download, FileText, Bot, MessageSquare, Sparkles, Headset, ChevronLeft, ChevronRight, Mail, Cog } from "lucide-react";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { Logo } from "@/components/ui/Logo";
import { usePwaInstall } from "@/context/PwaContext";
import { useUnresolvedCountByUser } from "@/hooks/useDomain";
import { useAuth } from "@clerk/nextjs";

export default function Sidebar() {
  const { isInstallable, installApp } = usePwaInstall();
  const { userId } = useAuth();
  const [isHidden, setIsHidden] = useState(false);

  // Count unresolved suggestions for badge
  const { data: unresolvedCount } = useUnresolvedCountByUser(userId);

  const openPMAgent = () => {
    window.dispatchEvent(new CustomEvent("pm-agent:toggle", { detail: { open: true } }));
  };

  const openSuggestions = () => {
    window.dispatchEvent(new CustomEvent("suggestions:toggle", { detail: { open: true } }));
  };

  if (isHidden) {
    return (
      <div className="hidden md:flex h-screen w-0 relative shrink-0 transition-all duration-300">
        <button 
          onClick={() => setIsHidden(false)}
          className="absolute top-1/2 left-0 -translate-y-1/2 z-50 p-1.5 bg-background border border-l-0 border-border shadow-md rounded-r-lg text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-all cursor-pointer"
          title="Hiện menu"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="w-44 bg-background/60 dark:bg-zinc-900/40 backdrop-blur-2xl border-r border-border/50 h-screen hidden md:flex flex-col relative z-10 shrink-0 shadow-[4px_0_24px_rgba(0,0,0,0.02)] dark:shadow-[4px_0_24px_rgba(0,0,0,0.2)] transition-all duration-300">
      <div className="h-16 flex items-center justify-between px-3 border-b border-border/40 bg-transparent">
        <div className="flex items-center gap-2">
          <Logo size={24} className="glow-primary shadow-sm rounded-lg" />
          <h1 className="text-base font-black text-foreground tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">KFlow</h1>
        </div>
        <button 
          onClick={() => setIsHidden(true)}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
          title="Ẩn menu"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>
      
      <nav className="flex-1 px-2 py-6 space-y-1 overflow-y-auto">
        <p className="px-3 text-[9px] font-bold text-muted-foreground/70 uppercase tracking-widest mb-3">Chế độ xem</p>
        <Link href="/board" className="group flex items-center gap-2.5 px-3 py-2 text-[12px] font-semibold rounded-xl text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all duration-300">
          <LayoutDashboard className="w-4 h-4 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
          Kanban
        </Link>
        <Link href="/list" className="group flex items-center gap-2.5 px-3 py-2 text-[12px] font-semibold rounded-xl text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all duration-300">
          <ListTodo className="w-4 h-4 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
          Danh sách
        </Link>
        <Link href="/gantt" className="group flex items-center gap-2.5 px-3 py-2 text-[12px] font-semibold rounded-xl text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all duration-300">
          <BarChartHorizontal className="w-4 h-4 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
          Biểu đồ Gantt
        </Link>
        <Link href="/notes" className="group flex items-center gap-2.5 px-3 py-2 text-[12px] font-semibold rounded-xl text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all duration-300">
          <FileText className="w-4 h-4 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
          Ghi chú
        </Link>
        <p className="px-3 text-[9px] font-bold text-muted-foreground/70 uppercase tracking-widest mb-3 mt-5">Quản lý</p>
        <Link href="/projects" className="group flex items-center gap-2.5 px-3 py-2 text-[12px] font-semibold rounded-xl text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all duration-300">
          <Folder className="w-4 h-4 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
          Dự án
        </Link>
        <Link href="/email" className="group flex items-center gap-2.5 px-3 py-2 text-[12px] font-semibold rounded-xl text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all duration-300">
          <Mail className="w-4 h-4 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
          Email
        </Link>

        {/* PM Agent - click mo popup */}
        <button
          onClick={openPMAgent}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] font-semibold rounded-xl text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all duration-300 cursor-pointer group mt-2"
        >
          <Bot className="w-4 h-4 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
          PM Agents
          <span className="ml-auto w-2 h-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
        </button>

        {/* Suggestions - click mo popup */}
        <button
          onClick={openSuggestions}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] font-semibold rounded-xl text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10 transition-all duration-300 cursor-pointer group"
        >
          <Sparkles className="w-4 h-4 shrink-0 text-muted-foreground group-hover:text-amber-500 transition-colors" />
          <span className="truncate">Gợi ý</span>
          {unresolvedCount !== undefined && unresolvedCount > 0 && (
            <span className="ml-auto min-w-[18px] h-[18px] shrink-0 rounded-full bg-amber-500 text-white text-[9px] font-bold flex items-center justify-center px-1 shadow-sm ring-2 ring-background">
              {unresolvedCount > 9 ? "9+" : unresolvedCount}
            </span>
          )}
        </button>

        <Link href="/omni" className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] font-semibold rounded-xl text-muted-foreground hover:text-blue-500 hover:bg-blue-500/10 transition-all duration-300 cursor-pointer group mt-2">
          <Headset className="w-4 h-4 shrink-0 text-muted-foreground group-hover:text-blue-500 transition-colors" />
          <span className="truncate">Omni Platform</span>
        </Link>

        <Link href="/settings/roles" className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] font-semibold rounded-xl text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all duration-300 cursor-pointer group">
          <Cog className="w-4 h-4 shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
          <span className="truncate">Cấu hình</span>
        </Link>

        {isInstallable && (
          <button
            onClick={installApp}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-[12px] font-semibold rounded-xl text-primary hover:text-primary-foreground bg-primary/10 hover:bg-primary border border-primary/20 hover:border-transparent transition-all duration-300 cursor-pointer shadow-sm hover:shadow-md mt-5"
          >
            <Download className="w-4 h-4 shrink-0" />
            Cài đặt App
          </button>
        )}
      </nav>

      <div className="p-3 border-t border-border/40 bg-background/50 dark:bg-zinc-900/50 backdrop-blur-md flex items-center justify-between transition-colors shrink-0">
        <UserButton appearance={{ elements: { avatarBox: "w-8 h-8 shadow-sm" } }} />
        <ThemeToggle />
      </div>
    </div>
  );
}
