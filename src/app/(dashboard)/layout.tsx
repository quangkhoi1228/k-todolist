import { auth } from "@clerk/nextjs/server";
import Sidebar from "@/components/layout/Sidebar";
import MobileSidebar from "@/components/layout/MobileSidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { SuggestionsPopupClient } from "@/components/layout/SuggestionsPopupClient";
import { GlobalSyncManager } from "@/components/layout/GlobalSyncManager";
import { DashboardSplitView } from "@/components/layout/DashboardSplitView";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await auth.protect({ unauthenticatedUrl: "/sign-in" });

  return (
    <div className="flex h-screen bg-gradient-to-br from-background via-background to-primary/5 dark:to-primary/10 text-foreground overflow-hidden">
      <Sidebar />
      <DashboardSplitView>
        {children}
      </DashboardSplitView>
      <SuggestionsPopupClient />
      <GlobalSyncManager />
    </div>
  );
}
