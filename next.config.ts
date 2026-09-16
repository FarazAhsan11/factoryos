import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Memoizes components and hooks at build time, so a tab switch re-renders
   * the panel that changed rather than every mounted panel beside it. The
   * whole tree already passes the compiler's lint rules (eslint-config-next
   * enables them as errors), which is what makes switching it on safe.
   */
  reactCompiler: true,
  experimental: {
    serverActions: {
      // Server Actions default to a 1 MB request body, which an un-shrunk logo
      // exceeds — the POST 413s and the browser only reports "Failed to fetch".
      // Uploads are downscaled client-side (see lib/images/downscale-image.ts);
      // this is the backstop for anything that slips past that, e.g. an SVG.
      bodySizeLimit: "4mb",
    },
    /**
     * Reuse a visited page's server payload for 30s on the client, so moving
     * Pipeline → Shift log → Pipeline doesn't re-run the server render and
     * flash the loading skeleton each way. The payload is thin — the factory,
     * the role and the tab from the URL — and every list on the page is
     * React Query's, which refetches on its own clock. Server Actions that
     * change what the payload holds (company settings, onboarding, employees)
     * call `revalidatePath`, which clears this cache.
     */
    staleTimes: {
      dynamic: 30,
    },
  },
};

export default nextConfig;
