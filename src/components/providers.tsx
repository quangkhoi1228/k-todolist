"use client";

import { ReactNode, useEffect } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { shadcn } from "@clerk/ui/themes";

import { ThemeProvider } from "next-themes";
import { PwaProvider } from "@/context/PwaContext";

export default function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      // Register service worker immediately
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => console.log("SW registered successfully on scope:", reg.scope))
        .catch((err) => console.error("SW registration failed:", err));
    }
  }, []);

  return (
    <ClerkProvider appearance={{ theme: shadcn as any }}>
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
        <PwaProvider>
          {children}
        </PwaProvider>
      </ThemeProvider>
    </ClerkProvider>
  );
}