"use client";

import { useState, useEffect } from "react";
import { SuggestionsQuickView } from "./SuggestionsQuickView";

export function SuggestionsPopupClient() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handler = (e: CustomEvent) => {
      setIsOpen(e.detail?.open === true);
    };
    window.addEventListener("suggestions:toggle", handler as EventListener);
    return () => window.removeEventListener("suggestions:toggle", handler as EventListener);
  }, []);

  if (!isOpen) return null;

  return (
    <div className="
      fixed bottom-0 right-0 left-0 top-16 z-[9999] animate-in slide-in-from-bottom-full duration-300
      sm:top-auto sm:left-auto sm:bottom-6 sm:right-6 sm:slide-in-from-bottom-8
      lg:static lg:z-40 lg:flex lg:h-full lg:shrink-0 lg:animate-in lg:slide-in-from-right-8 lg:duration-300
    ">
      <div className="flex h-full lg:h-full w-full">
        <div className="
          flex flex-col overflow-hidden bg-background/95 dark:bg-zinc-900/95 backdrop-blur-2xl
          w-full h-full rounded-t-3xl border-t border-border/50 shadow-2xl
          sm:w-[420px] sm:h-[600px] sm:max-h-[80vh] sm:rounded-[2rem] sm:border sm:border-border/50 sm:shadow-black/20
          lg:w-[420px] lg:h-full lg:max-h-full lg:rounded-none lg:border-0 lg:border-l lg:border-border/50 lg:shadow-xl
        ">
          <SuggestionsQuickView isOpen={true} onClose={() => setIsOpen(false)} />
        </div>
      </div>
    </div>
  );
}
