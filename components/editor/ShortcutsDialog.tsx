"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { displayKeys, type Shortcut } from "@/hooks/useKeyboardShortcuts";

export function ShortcutsDialog({
  open,
  onOpenChange,
  shortcuts,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  shortcuts: Shortcut[];
}) {
  const groups = ["File", "Edit", "Tools", "View"] as const;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          {groups.map((g) => (
            <section key={g}>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{g}</h3>
              <dl className="grid gap-1 text-sm">
                {shortcuts
                  .filter((s) => s.group === g)
                  .map((s) => (
                    <div key={s.keys + s.description} className="flex justify-between gap-3">
                      <dt>{s.description}</dt>
                      <dd>
                        <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                          {displayKeys(s.keys)}
                        </kbd>
                      </dd>
                    </div>
                  ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
