"use client";

import { useEffect, useState } from "react";
import { storageEstimate } from "@/storage/indexedDB";
import { formatBytes } from "@/lib/fileUtils";

export function StorageUsage() {
  const [est, setEst] = useState<{ usage: number; quota: number } | null>(null);
  useEffect(() => {
    void storageEstimate().then(setEst);
  }, []);
  if (!est) return null;
  return (
    <p className="mt-8 text-xs text-muted-foreground">
      Local storage used: {formatBytes(est.usage)} of ~{formatBytes(est.quota)} available to this site. Projects are
      stored only in this browser on this device.
    </p>
  );
}
