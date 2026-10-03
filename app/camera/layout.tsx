import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Camera" };

export default function CameraLayout({ children }: { children: ReactNode }) {
  return children;
}
