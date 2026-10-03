"use client";

import { useEffect, type ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useUiStore } from "@/store/uiStore";
import { ServiceWorkerManager } from "./ServiceWorkerManager";
import { OfflineIndicator } from "./OfflineIndicator";
import { ErrorBoundary } from "./ErrorBoundary";

function HighContrastSync() {
  const highContrast = useUiStore((s) => s.highContrast);
  useEffect(() => {
    document.documentElement.classList.toggle("high-contrast", highContrast);
  }, [highContrast]);
  return null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <TooltipProvider delay={400}>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[100] focus:rounded-md focus:bg-background focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        <ErrorBoundary>{children}</ErrorBoundary>
        <HighContrastSync />
        <OfflineIndicator />
        <ServiceWorkerManager />
        <Toaster position="bottom-center" />
      </TooltipProvider>
    </ThemeProvider>
  );
}
