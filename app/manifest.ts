import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "ProStudio — Professional Camera & Photo Editor",
    short_name: "ProStudio",
    description:
      "Free, private, browser-based professional camera and non-destructive photo editor. Your photos stay on your device.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "any",
    background_color: "#141518",
    theme_color: "#141518",
    categories: ["photo", "productivity", "graphics"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    screenshots: [
      {
        src: "/icons/screenshot-wide.png",
        sizes: "1280x720",
        type: "image/png",
        form_factor: "wide",
        label: "ProStudio home",
      },
      {
        src: "/icons/screenshot-narrow.png",
        sizes: "720x1280",
        type: "image/png",
        form_factor: "narrow",
        label: "ProStudio on mobile",
      },
    ],
    shortcuts: [
      {
        name: "Take Photo",
        short_name: "Camera",
        url: "/camera",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Edit Photo",
        short_name: "Editor",
        url: "/editor",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      { name: "Projects", url: "/projects", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
