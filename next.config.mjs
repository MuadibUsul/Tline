/** @type {import('next').NextConfig} */

// No external origin is loaded: fonts are built into the bundle. Next's App Router injects
// inline bootstrap/hydration scripts and React emits inline styles, so those two
// directives keep 'unsafe-inline'; every other origin is closed.
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"),
  "style-src 'self' 'unsafe-inline'",
  // Fonts are self-hosted now, so no third-party origin is admitted. blob: is for pdf.js,
  // which materialises a PDF's embedded fonts as blob URLs to render it; without it the
  // font never loads and the render silently never finishes.
  "font-src 'self' data: blob:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
];

const nextConfig = {
  reactStrictMode: true,
  // Prisma client is a server-only dependency. This option is stable in Next 15.
  serverExternalPackages: ["@prisma/client", "prisma"],
  // Allow an isolated build dir so a second dev server (e.g. another tool on the same
  // repo) can't corrupt this one's .next. Defaults to the standard .next when unset.
  distDir: process.env.TLINE_DIST_DIR || ".next",
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/api/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
    ];
  },
};

export default nextConfig;
