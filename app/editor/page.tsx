import type { Metadata } from "next";
import { Suspense } from "react";
import { EditorRoute } from "@/components/editor/EditorRoute";

export const metadata: Metadata = { title: "Editor" };

export default function EditorPage() {
  return (
    <Suspense fallback={<p className="m-auto text-sm text-muted-foreground">Loading editor…</p>}>
      <EditorRoute />
    </Suspense>
  );
}
