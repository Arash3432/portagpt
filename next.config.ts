import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Pin the workspace root so a parent folder containing another lockfile
  // (common after extracting the source ZIP next to other projects) can never
  // make Next.js infer the wrong root during a Liara Docker build.
  outputFileTracingRoot: path.join(import.meta.dirname),
  poweredByHeader: false,
  compress: true,
  images: { unoptimized: true },
};

export default nextConfig;
