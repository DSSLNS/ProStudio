"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ImagePlus } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { useImportFiles } from "@/hooks/useImportFiles";
import { ACCEPT_ATTR } from "@/lib/fileUtils";
import { cn } from "@/lib/utils";

/** Editor entry when no project is open: drag & drop, file picker, or paste. */
export function EditorStart() {
  const { importFiles, busy } = useImportFiles();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (files.length) void importFiles(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [importFiles]);

  return (
    <main id="main" className="flex flex-1 flex-col p-4">
      <Link href="/" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "self-start")}>
        <ArrowLeft aria-hidden /> Home
      </Link>
      <div
        className={cn(
          "m-auto flex w-full max-w-xl flex-col items-center gap-4 rounded-xl border-2 border-dashed border-border p-10 text-center transition-colors",
          over && "border-brand bg-brand/5",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          if (e.dataTransfer.files.length) void importFiles(e.dataTransfer.files);
        }}
        data-testid="drop-zone"
      >
        <ImagePlus className="size-10 text-brand" aria-hidden />
        <h1 className="text-xl font-semibold">Edit a photo</h1>
        <p className="text-sm text-muted-foreground">
          Drag and drop images here, paste from the clipboard, or choose files. JPEG, PNG, WebP, AVIF, GIF, BMP, TIFF,
          SVG, and HEIC (where your browser supports it).
        </p>
        <Button onClick={() => input.current?.click()} disabled={busy}>
          {busy ? "Importing…" : "Choose images"}
        </Button>
        <p className="text-xs text-muted-foreground">Files are opened locally and never uploaded.</p>
        <input
          ref={input}
          type="file"
          accept={ACCEPT_ATTR}
          multiple
          hidden
          data-testid="editor-file-input"
          onChange={(e) => {
            if (e.target.files) void importFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
    </main>
  );
}
