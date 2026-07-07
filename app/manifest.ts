import type { MetadataRoute } from "next";
import { BRAND, SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/?source=pwa",
    name: `${SITE_NAME} — ${SITE_TAGLINE}`,
    short_name: "FundExecs",
    description: SITE_DESCRIPTION,
    // Installed launches open straight into the mobile command center.
    start_url: "/home?source=pwa",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "portrait",
    background_color: BRAND.background,
    theme_color: BRAND.background,
    categories: ["business", "finance", "productivity"],
    icons: [
      { src: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { src: "/icon-512.png", type: "image/png", sizes: "512x512" },
      {
        src: "/icon-512.png",
        type: "image/png",
        sizes: "512x512",
        purpose: "maskable",
      },
    ],
    // Long-press app-icon shortcuts (Android / desktop PWA) into the most
    // frequent app destinations.
    shortcuts: [
      {
        name: "Ask Earn",
        short_name: "Earn",
        description: "Open the Earn AI copilot",
        url: "/earn?source=pwa-shortcut",
      },
      {
        name: "Deals",
        short_name: "Deals",
        description: "Your deal pipeline",
        url: "/deals/feed?source=pwa-shortcut",
      },
      {
        name: "Approvals",
        short_name: "Approvals",
        description: "Review pending approvals",
        url: "/approvals?source=pwa-shortcut",
      },
    ],
  };
}
