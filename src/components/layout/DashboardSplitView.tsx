"use client";

import React, { useState, useEffect } from "react";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import dynamic from "next/dynamic";
import { ThemeToggle } from "@/components/theme-toggle";
import MobileSidebar from "@/components/layout/MobileSidebar";
import { Bot, GripVertical } from "lucide-react";
import { NotificationBadge } from "../../../agents/pm/components/NotificationBadge";
import { usePathname } from "next/navigation";

const PMAgentPopup = dynamic(
  () => import("../../../agents/pm/components/PMAgentPopup").then((m) => ({ default: m.PMAgentPopup })),
  { ssr: false }
);

export function DashboardSplitView({ children }: { children: React.ReactNode }) {
  const [isAgentOpen, setIsAgentOpen] = useState(true);
  const pathname = usePathname();
  const isOmniPage = pathname === "/omni";

  useEffect(() => {
    const handler = (e: CustomEvent) => {
      if (e.detail && e.detail.open !== undefined) {
        setIsAgentOpen(e.detail.open);
      } else {
        setIsAgentOpen((prev) => !prev);
      }
    };
    window.addEventListener("pm-agent:toggle", handler as EventListener);
    return () => window.removeEventListener("pm-agent:toggle", handler as EventListener);
  }, []);

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative bg-background">
      {/* Mobile Header */}
      <header className="md:hidden h-16 border-b border-border/50 bg-background/80 dark:bg-zinc-900/80 backdrop-blur-xl flex items-center justify-between px-4 shrink-0 z-20 shadow-sm">
        <div className="flex items-center gap-3">
          <MobileSidebar />
          <h1 className="text-lg font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-foreground to-foreground/70">KFlow</h1>
        </div>
        <ThemeToggle />
      </header>

      <div className="flex-1 min-h-0 overflow-hidden">
        {/* Desktop View with Resizable Panels */}
        <PanelGroup orientation="horizontal" className="h-full w-full hidden md:flex">
          <Panel defaultSize={70} minSize={30} className="h-full flex flex-col overflow-hidden">
            <main className="flex-1 min-h-0 overflow-hidden flex flex-col bg-background/50">
              {children}
            </main>
          </Panel>
          
          {/* isAgentOpen && !isOmniPage && (
            <>
              <PanelResizeHandle className="w-1.5 hover:w-2 active:w-2 transition-all duration-200 flex flex-col items-center justify-center cursor-col-resize group relative z-50 hover:bg-primary/20 active:bg-primary/30">
                <div className="w-0 group-hover:w-[1px] group-active:w-[1px] h-full bg-border/30 absolute left-1/2 -translate-x-1/2 transition-all duration-200" />
                <div className="opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity duration-200 h-8 w-4 bg-background border border-border rounded-full flex items-center justify-center shadow-sm relative z-10">
                  <GripVertical className="w-3 h-3 text-muted-foreground" />
                </div>
              </PanelResizeHandle>
              <Panel defaultSize={30} minSize={20} className="h-full flex flex-col overflow-hidden bg-background border-l border-border/40">
                <PMAgentPopup isResizablePanel={true} onClose={() => setIsAgentOpen(false)} />
              </Panel>
            </>
          ) */}
        </PanelGroup>

        {/* Mobile View */}
        <div className="h-full w-full flex flex-col md:hidden overflow-hidden">
          <main className="flex-1 min-h-0 overflow-hidden flex flex-col">
            {children}
          </main>
          {/* {!isOmniPage && <PMAgentPopup isResizablePanel={false} onClose={() => setIsAgentOpen(false)} />} */}
        </div>
      </div>

      {/* Floating Action Button when Side Panel is closed on Desktop (only non-Omni) */}
      {/* !isAgentOpen && !isOmniPage && (
        <div className="hidden md:flex fixed bottom-6 right-6 z-[9999] animate-in fade-in slide-in-from-bottom-4 duration-500 flex-col items-end gap-3">
          <button
            type="button"
            onClick={() => setIsAgentOpen(true)}
            className="w-14 h-14 rounded-full bg-gradient-to-tr from-primary to-primary/80 text-primary-foreground shadow-lg shadow-primary/30 hover:shadow-xl hover:shadow-primary/40 hover:-translate-y-1 active:scale-95 transition-all duration-300 cursor-pointer flex items-center justify-center ring-4 ring-primary/20"
          >
            <Bot className="w-6 h-6" />
          </button>
        </div>
      ) */}
    </div>
  );
}
