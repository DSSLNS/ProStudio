"use client";

import { AppHeader } from "@/components/app/AppHeader";
import { CameraSetup } from "@/components/camera/CameraSetup";

export default function ChooseCameraModePage() {
  return (
    <>
      <AppHeader />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 pt-8 pb-[calc(env(safe-area-inset-bottom)+3rem)]">
        <h1 className="text-2xl font-semibold">Choose Camera Mode</h1>
        <CameraSetup />
      </main>
    </>
  );
}
