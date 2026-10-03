"use client";

import { useEffect } from "react";

export interface Shortcut {
  keys: string; // display, e.g. "Mod+Z"
  description: string;
  group: "File" | "Edit" | "Tools" | "View";
  match: (e: KeyboardEvent) => boolean;
  run: (e: KeyboardEvent) => void;
}

export const isMac = () =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const modLabel = () => (isMac() ? "⌘" : "Ctrl");
export const displayKeys = (k: string) => k.replace("Mod", modLabel());

const mod = (e: KeyboardEvent) => e.metaKey || e.ctrlKey;
export const key =
  (k: string, opts: { mod?: boolean; shift?: boolean; alt?: boolean } = {}) =>
  (e: KeyboardEvent) =>
    e.key.toLowerCase() === k.toLowerCase() &&
    mod(e) === !!opts.mod &&
    e.shiftKey === !!opts.shift &&
    e.altKey === !!opts.alt;

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable;
}

/** Registers global shortcuts; single-key shortcuts are ignored while typing. */
export function useKeyboardShortcuts(shortcuts: Shortcut[], enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const typing = isTyping(e);
      for (const s of shortcuts) {
        if (!s.match(e)) continue;
        if (typing && !(e.metaKey || e.ctrlKey)) return;
        // Don't steal Ctrl+Z etc. from text fields.
        if (typing && ["z", "y", "a", "c", "v", "x"].includes(e.key.toLowerCase())) return;
        e.preventDefault();
        s.run(e);
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcuts, enabled]);
}
