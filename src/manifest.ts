import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "WheelDesk Control Center",
    short_name: "WheelDesk",
    description: "Options structure, wheel strategy, and Control Center analytics.",
    start_url: "/control-center",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#020b14",
    theme_color: "#071523",
    categories: ["finance", "productivity"],
    icons: [
      {
        src: "/icons/wheeldesk-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/wheeldesk-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
