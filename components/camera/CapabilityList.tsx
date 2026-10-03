"use client";

import { Check, Minus } from "lucide-react";
import { describeCapabilities, type CameraCapabilities } from "@/camera/capabilities";

/** Table of every camera capability and whether this device/browser really exposes it. */
export function CapabilityList({ caps, imageCapture }: { caps: CameraCapabilities; imageCapture: boolean }) {
  const rows = describeCapabilities(caps, imageCapture);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs" data-testid="capability-list">
        <caption className="sr-only">Camera capabilities reported by this browser</caption>
        <thead className="text-white/60">
          <tr>
            <th scope="col" className="py-1 pr-2 font-medium">
              Capability
            </th>
            <th scope="col" className="py-1 pr-2 font-medium">
              Status
            </th>
            <th scope="col" className="py-1 font-medium">
              Range
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-white/10 align-top">
              <th scope="row" className="py-1.5 pr-2 font-normal">
                {r.label}
              </th>
              <td className="py-1.5 pr-2">
                {r.supported ? (
                  <span className="inline-flex items-center gap-1 text-emerald-300">
                    <Check className="size-3.5" aria-hidden /> Supported
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-white/60">
                    <Minus className="size-3.5" aria-hidden /> Not available on this device/browser
                  </span>
                )}
              </td>
              <td className="py-1.5 text-white/70">{r.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
