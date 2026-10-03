import Link from "next/link";
import type { ReactNode } from "react";
import { Settings } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn("flex items-center gap-2 font-semibold tracking-[0.2em]", className)}
      aria-label="ProStudio home"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- static SVG logo */}
      <img src="/icons/icon.svg" alt="" className="size-7" />
      <span className="text-sm">PROSTUDIO</span>
    </Link>
  );
}

export function AppHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
        <Logo />
        <div className="ml-auto flex items-center gap-2">
          {children}
          <Link href="/settings" className={buttonVariants({ variant: "ghost", size: "icon" })} aria-label="Settings">
            <Settings />
          </Link>
        </div>
      </div>
    </header>
  );
}
