/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Prisma client is a server-only dependency. This option is stable in Next 15.
  serverExternalPackages: ["@prisma/client", "prisma"],
};

export default nextConfig;
