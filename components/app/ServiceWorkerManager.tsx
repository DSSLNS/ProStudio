"use client";

import { useEffect } from "react";
import { toast } from "sonner";

/**
 * Registers /sw.js (production builds only, unless NEXT_PUBLIC_ENABLE_SW_IN_DEV=1)
 * and offers a safe, user-initiated update when a new version is waiting.
 */
export function ServiceWorkerManager() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const enabled = process.env.NODE_ENV === "production" || process.env.NEXT_PUBLIC_ENABLE_SW_IN_DEV === "1";
    if (!enabled) return;

    let reloading = false;
    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };

    const promptUpdate = (worker: ServiceWorker) => {
      toast("A new version of ProStudio is available.", {
        duration: Infinity,
        action: {
          label: "Update",
          onClick: () => {
            navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
            worker.postMessage({ type: "SKIP_WAITING" });
          },
        },
      });
    };

    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((reg) => {
        if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg.waiting);
        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            // Only prompt when replacing an existing controller (not on first install).
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              promptUpdate(installing);
            }
          });
        });
        const interval = window.setInterval(() => reg.update().catch(() => undefined), 60 * 60 * 1000);
        return () => window.clearInterval(interval);
      })
      .catch((err) => console.warn("[ProStudio] Service worker registration failed", err));

    return () => navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
  }, []);

  return null;
}
