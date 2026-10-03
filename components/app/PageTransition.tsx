"use client";

/**
 * Wraps a page in a lightweight 200 ms opacity fade.
 * Uses a CSS animation keyed on the pathname so each navigation triggers a
 * fresh fade-in without any JS animation library.
 */
import { usePathname } from "next/navigation";

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="page-enter flex min-h-full flex-col">
      {children}
    </div>
  );
}
