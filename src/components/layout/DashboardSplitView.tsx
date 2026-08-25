"use client";

import React from "react";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";
import { ThemeToggle } from "@/components/theme-toggle";
import MobileSidebar from "@/components/layout/MobileSidebar";

export function DashboardSplitView({ children }: { children: React.ReactNode }) {
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
          <Panel defaultSize={100} minSize={30} className="h-full flex flex-col overflow-hidden">
            <main className="flex-1 min-h-0 overflow-hidden flex flex-col bg-background/50">
              {children}
            </main>
          </Panel>
        </PanelGroup>

        {/* Mobile View */}
        <div className="h-full w-full flex flex-col md:hidden overflow-hidden">
          <main className="flex-1 min-h-0 overflow-hidden flex flex-col">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
