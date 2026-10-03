"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ProjectCard } from "./ProjectCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  deleteProject,
  duplicateProject,
  getProject,
  listProjects,
  renameProject,
  type ProjectSummary,
} from "@/storage/projects";
import { exportProjectFile } from "@/storage/projectFile";
import { saveBlobAs } from "@/lib/fileUtils";

export function useProjects() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      setProjects(await listProjects());
    } catch (e) {
      setError((e as Error).message);
      setProjects([]);
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading from IndexedDB on mount
    void refresh();
  }, [refresh]);
  return { projects, error, refresh };
}

export function ProjectList({ limit, emptyHint }: { limit?: number; emptyHint?: string }) {
  const { projects, error, refresh } = useProjects();
  const [renaming, setRenaming] = useState<ProjectSummary | null>(null);
  const [newName, setNewName] = useState("");
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null);

  const actions = {
    onRename: (p: ProjectSummary) => {
      setNewName(p.name);
      setRenaming(p);
    },
    onDuplicate: async (p: ProjectSummary) => {
      await duplicateProject(p.id);
      toast.success(`Duplicated “${p.name}”`);
      void refresh();
    },
    onExport: async (p: ProjectSummary) => {
      const full = await getProject(p.id);
      if (!full) return;
      const blob = await exportProjectFile(full);
      const result = await saveBlobAs(blob, `${full.name}.prostudio`, "ProStudio project");
      if (result !== "cancelled") toast.success("Project file exported");
    },
    onDelete: (p: ProjectSummary) => setDeleting(p),
  };

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!projects) return <p className="text-sm text-muted-foreground">Loading projects…</p>;
  if (!projects.length) return <p className="text-sm text-muted-foreground">{emptyHint ?? "No projects yet."}</p>;

  const shown = limit ? projects.slice(0, limit) : projects;
  return (
    <>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="Projects">
        {shown.map((p) => (
          <li key={p.id}>
            <ProjectCard project={p} actions={actions} />
          </li>
        ))}
      </ul>

      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!renaming) return;
              await renameProject(renaming.id, newName);
              setRenaming(null);
              void refresh();
            }}
          >
            <DialogHeader>
              <DialogTitle>Rename project</DialogTitle>
            </DialogHeader>
            <div className="my-4 grid gap-2">
              <Label htmlFor="rename-input">Name</Label>
              <Input
                id="rename-input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={120}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenaming(null)}>
                Cancel
              </Button>
              <Button type="submit">Rename</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{deleting?.name}”?</DialogTitle>
            <DialogDescription>
              This removes the project, its edit history and its locally stored original from this device. This cannot
              be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!deleting) return;
                await deleteProject(deleting.id);
                toast.success("Project deleted");
                setDeleting(null);
                void refresh();
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
