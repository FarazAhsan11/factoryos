import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Server Actions default to a 1 MB request body, which an un-shrunk logo
      // exceeds — the POST 413s and the browser only reports "Failed to fetch".
      // Uploads are downscaled client-side (see lib/images/downscale-image.ts);
      // this is the backstop for anything that slips past that, e.g. an SVG.
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
