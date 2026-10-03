"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Camera, ImageIcon, MoreVertical } from "lucide-react";
import { getThumbnail, type ProjectSummary } from "@/storage/projects";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface ProjectActions {
  onRename?: (p: ProjectSummary) => void;
  onDuplicate?: (p: ProjectSummary) => void;
  onExport?: (p: ProjectSummary) => void;
  onDelete?: (p: ProjectSummary) => void;
}

function useThumbnail(id: string, version: number) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    getThumbnail(id)
      .then((b) => {
        if (revoked || !b) return;
        objectUrl = URL.createObjectURL(b);
        setUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, version]);
  return url;
}

export function ProjectCard({ project, actions }: { project: ProjectSummary; actions?: ProjectActions }) {
  const thumb = useThumbnail(project.id, project.modifiedAt);
  const date = new Date(project.modifiedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  return (
    <div
      className="group relative overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-foreground/30"
      data-testid="project-card"
    >
      <Link
        href={`/editor?project=${project.id}`}
        className="block focus-visible:outline-2 focus-visible:outline-ring"
        aria-label={`Open ${project.name}`}
      >
        <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted">
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element -- local blob URL
            <img src={thumb} alt="" className="size-full object-cover" />
          ) : (
            <ImageIcon className="size-8 text-muted-foreground" aria-hidden />
          )}
        </div>
        <div className="p-3 pr-10">
          <p className="truncate text-sm font-medium">{project.name}</p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            {project.origin === "camera" && <Camera className="size-3" aria-label="Captured with camera" />}
            {project.width} × {project.height} · {date}
          </p>
        </div>
      </Link>
      {actions && (
        <div className="absolute bottom-2.5 right-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for ${project.name}`} />}
            >
              <MoreVertical />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {actions.onRename && (
                <DropdownMenuItem onClick={() => actions.onRename?.(project)}>Rename</DropdownMenuItem>
              )}
              {actions.onDuplicate && (
                <DropdownMenuItem onClick={() => actions.onDuplicate?.(project)}>Duplicate</DropdownMenuItem>
              )}
              {actions.onExport && (
                <DropdownMenuItem onClick={() => actions.onExport?.(project)}>Export .prostudio file</DropdownMenuItem>
              )}
              {actions.onDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => actions.onDelete?.(project)}>
                    Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}
