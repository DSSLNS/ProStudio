"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { useEditorStore } from "@/store/editorStore";
import { useLoadProject } from "@/hooks/useProject";
import { buttonVariants } from "@/components/ui/button";
import { ErrorBoundary } from "@/components/app/ErrorBoundary";
import { EditorShell } from "./EditorShell";
import { EditorStart } from "./EditorStart";

export function EditorRoute() {
  const projectId = useSearchParams().get("project");
  useLoadProject(projectId);
  const status = useEditorStore((s) => s.status);
  const error = useEditorStore((s) => s.error);
  const loadedId = useEditorStore((s) => s.project?.id);

  if (!projectId) return <EditorStart />;
  if (status === "error") {
    return (
      <main id="main" role="alert" className="m-auto flex max-w-md flex-col items-center gap-3 p-8 text-center">
        <h1 className="text-lg font-semibold">Could not open this photo</h1>
        <p className="text-sm text-muted-foreground">{error}</p>
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          Back to home
        </Link>
      </main>
    );
  }
  if (status !== "ready" || loadedId !== projectId) {
    return (
      <main id="main" className="m-auto flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Processing image…
      </main>
    );
  }
  return (
    <ErrorBoundary fallbackTitle="The editor hit an unexpected error">
      <EditorShell />
    </ErrorBoundary>
  );
}
