import Link from "next/link";
import { Camera, ShieldCheck } from "lucide-react";
import { AppHeader } from "@/components/app/AppHeader";
import { InstallPrompt } from "@/components/app/InstallPrompt";
import { HomeImportActions, EditPhotoCard } from "@/components/app/HomeImport";
import { ProjectList } from "@/components/projects/ProjectList";

export default function HomePage() {
  return (
    <>
      <AppHeader>
        <InstallPrompt />
      </AppHeader>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-16">
        <section className="py-12 text-center sm:py-16">
          <h1 className="text-4xl font-semibold tracking-[0.3em] sm:text-5xl">PROSTUDIO</h1>
          <p className="mt-3 text-muted-foreground">Professional Photography &amp; Photo Editing</p>
        </section>

        <section aria-label="Start" className="grid gap-4 sm:grid-cols-2">
          <Link
            href="/camera"
            className="group flex flex-col items-start gap-4 rounded-xl border border-border bg-card p-6 transition-colors hover:border-brand/60 focus-visible:outline-2 focus-visible:outline-ring sm:p-8"
            data-testid="take-photo"
          >
            <span className="flex size-12 items-center justify-center rounded-full bg-brand/15 text-brand">
              <Camera className="size-6" aria-hidden />
            </span>
            <span>
              <span className="block text-xl font-semibold tracking-wide">TAKE PHOTO</span>
              <span className="mt-1 block text-sm text-muted-foreground">
                Open the professional camera — Auto or Manual.
              </span>
            </span>
          </Link>
          <EditPhotoCard />
        </section>

        <section className="mt-12" aria-labelledby="recent-heading">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <h2 id="recent-heading" className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Recent projects
            </h2>
            <div className="ml-auto flex flex-wrap gap-2">
              <HomeImportActions />
            </div>
          </div>
          <ProjectList limit={8} emptyHint="Your projects appear here. Take or import a photo to get started." />
        </section>

        <p className="mt-12 flex items-center justify-center gap-2 text-center text-xs text-muted-foreground">
          <ShieldCheck className="size-4" aria-hidden />
          Free, no account, no watermark. Photos are processed and stored only on this device.
        </p>
      </main>
    </>
  );
}
