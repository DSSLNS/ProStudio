"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createProjectFromFile } from "@/storage/projects";
import { importProjectFile } from "@/storage/projectFile";
import { MAX_FILE_BYTES, formatBytes, sniffFormat } from "@/lib/fileUtils";

/**
 * Imports one or more files: images become new projects (original stored
 * untouched), .prostudio files are restored. Opens the first in the editor.
 */
export function useImportFiles() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const importFiles = useCallback(
    async (files: File[] | FileList, { open = true }: { open?: boolean } = {}) => {
      const list = Array.from(files);
      if (!list.length) return [];
      setBusy(true);
      const ids: string[] = [];
      const toastId = toast.loading(list.length > 1 ? `Importing ${list.length} files…` : "Importing…");
      try {
        for (const file of list) {
          if (file.size > MAX_FILE_BYTES) {
            toast.error(
              `${file.name} is too large (${formatBytes(file.size)}). Maximum is ${formatBytes(MAX_FILE_BYTES)}.`,
            );
            continue;
          }
          try {
            const format = await sniffFormat(file, file.name);
            const project =
              format === "prostudio" ? await importProjectFile(file) : await createProjectFromFile(file, { format });
            ids.push(project.id);
          } catch (e) {
            toast.error(`${file.name}: ${(e as Error).message}`);
          }
        }
        if (ids.length > 1) toast.success(`${ids.length} photos imported. Opening the first one.`);
        if (open && ids[0]) router.push(`/editor?project=${ids[0]}`);
        return ids;
      } finally {
        toast.dismiss(toastId);
        setBusy(false);
      }
    },
    [router],
  );

  return { importFiles, busy };
}
