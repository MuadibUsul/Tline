import type { MetadataRoute } from "next";
import { SITE_NAME } from "@/lib/site";

/**
 * The web app manifest.
 *
 * Served for the whole origin rather than per language: a manifest is fetched before any page
 * is chosen, so it carries the brand name in both scripts instead of one locale's.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: "Tlines",
    description: "Public institutional research, structured into comparable, source-linked market views.",
    start_url: "/",
    display: "standalone",
    background_color: "#111318",
    theme_color: "#111318",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
