"use client";

import { ReactNode, useEffect } from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { shadcn } from "@clerk/ui/themes";

import { ThemeProvider } from "next-themes";
import { PwaProvider } from "@/context/PwaContext";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

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
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          <PwaProvider>
            {children}
          </PwaProvider>
        </ThemeProvider>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
