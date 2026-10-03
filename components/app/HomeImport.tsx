"use client";

import { useRef } from "react";
import Link from "next/link";
import { FolderOpen, ImagePlus, Plus, Layers } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { useImportFiles } from "@/hooks/useImportFiles";
import { ACCEPT_ATTR } from "@/lib/fileUtils";

export function EditPhotoCard() {
  const input = useRef<HTMLInputElement>(null);
  const { importFiles, busy } = useImportFiles();
  return (
    <>
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        className="group flex flex-col items-start gap-4 rounded-xl border border-border bg-card p-6 text-left transition-colors hover:border-brand/60 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60 sm:p-8"
        data-testid="edit-photo"
      >
        <span className="flex size-12 items-center justify-center rounded-full bg-brand/15 text-brand">
          <ImagePlus className="size-6" aria-hidden />
        </span>
        <span>
          <span className="block text-xl font-semibold tracking-wide">EDIT PHOTO</span>
          <span className="mt-1 block text-sm text-muted-foreground">
            {busy ? "Importing…" : "Import one or more images — JPEG, PNG, WebP, AVIF, TIFF, HEIC and more."}
          </span>
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept={ACCEPT_ATTR}
        multiple
        hidden
        data-testid="edit-photo-input"
        onChange={(e) => {
          if (e.target.files) void importFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </>
  );
}

export function HomeImportActions() {
  const newInput = useRef<HTMLInputElement>(null);
  const openInput = useRef<HTMLInputElement>(null);
  const { importFiles, busy } = useImportFiles();
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => newInput.current?.click()} disabled={busy}>
        <Plus aria-hidden /> New project
      </Button>
      <Button variant="outline" size="sm" onClick={() => openInput.current?.click()} disabled={busy}>
        <FolderOpen aria-hidden /> Open project
      </Button>
      <Link href="/projects" className={buttonVariants({ variant: "ghost", size: "sm" })}>
        <Layers aria-hidden /> All projects
      </Link>
      <input
        ref={newInput}
        type="file"
        accept={ACCEPT_ATTR}
        hidden
        onChange={(e) => {
          if (e.target.files) void importFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={openInput}
        type="file"
        accept=".prostudio"
        hidden
        data-testid="open-project-input"
        onChange={(e) => {
          if (e.target.files) void importFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </>
  );
}
