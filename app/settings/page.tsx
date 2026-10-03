import type { Metadata } from "next";
import { AppHeader } from "@/components/app/AppHeader";
import { SettingsForm } from "@/components/app/SettingsForm";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <>
      <AppHeader />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <h1 className="mb-6 text-2xl font-semibold">Settings</h1>
        <SettingsForm />
      </main>
    </>
  );
}
