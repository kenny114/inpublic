import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false, // Excalidraw double-mounts badly under StrictMode
  devIndicators: false, // the dev badge sits exactly where the control bar goes

  // Keep the production build out of the dev server's output directory.
  // Sharing .next means a `next build` run while `next dev` is up overwrites
  // the chunks the running server is serving, and the page dies with
  // "Cannot find module './331.js'". `next build` and `next start` both run
  // with NODE_ENV=production, so they agree on .next-build; dev keeps .next.
  distDir: process.env.NODE_ENV === "production" ? ".next-build" : ".next",
};

export default nextConfig;
