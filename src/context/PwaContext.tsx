"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

interface PwaContextType {
  isInstallable: boolean;
  installApp: () => Promise<void>;
  isInstalled: boolean;
}

const PwaContext = createContext<PwaContextType | undefined>(undefined);

export function PwaProvider({ children }: { children: React.ReactNode }) {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstallable, setIsInstallable] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // Check if the app is already running in standalone mode (installed)
    const isStandalone = 
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone ||
      document.referrer.includes("android-app://");

    if (isStandalone) {
      setIsInstalled(true);
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      // Prevent the browser's default install banner from showing
      e.preventDefault();
      // Save the event so it can be triggered later.
      setDeferredPrompt(e);
      // Update UI to let the user know the app can be installed
      setIsInstallable(true);
    };

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setIsInstallable(false);
      setIsInstalled(true);
      console.log("KFlow was successfully installed!");
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const installApp = async () => {
    if (!deferredPrompt) {
      console.warn("Installation prompt is not available yet.");
      return;
    }
    
    // Show the native browser install prompt
    deferredPrompt.prompt();
    
    // Wait for the user to respond to the prompt
    try {
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`User response to PWA install: ${outcome}`);
      
      // Clean up the deferred prompt
      setDeferredPrompt(null);
      setIsInstallable(false);
    } catch (err) {
      console.error("Error during PWA installation:", err);
    }
  };

  return (
    <PwaContext.Provider value={{ isInstallable, installApp, isInstalled }}>
      {children}
    </PwaContext.Provider>
  );
}

export function usePwaInstall() {
  const context = useContext(PwaContext);
  if (context === undefined) {
    throw new Error("usePwaInstall must be used within a PwaProvider");
  }
  return context;
}
