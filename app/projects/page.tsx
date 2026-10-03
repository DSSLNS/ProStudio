import type { Metadata } from "next";
import { AppHeader } from "@/components/app/AppHeader";
import { HomeImportActions } from "@/components/app/HomeImport";
import { ProjectList } from "@/components/projects/ProjectList";
import { StorageUsage } from "@/components/projects/StorageUsage";

export const metadata: Metadata = { title: "Projects" };

export default function ProjectsPage() {
  return (
    <>
      <AppHeader />
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">Projects</h1>
          <div className="ml-auto flex flex-wrap gap-2">
            <HomeImportActions />
          </div>
        </div>
        <ProjectList emptyHint="No projects yet. Import a photo or take one with the camera." />
        <StorageUsage />
      </main>
    </>
  );
}
