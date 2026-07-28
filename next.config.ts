import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Allow remote placeholder/sample images used by the demo-data seed. The
  // public storefront and dashboard render these via next/image, which
  // requires every remote hostname to be explicitly allow-listed.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "plus.unsplash.com" },
      { protocol: "https", hostname: "i.pravatar.cc" },
      { protocol: "https", hostname: "localhost" },
    ],
  },
  // Runtime-uploaded images cannot live in public/ — Next.js only serves
  // public/ files that existed at BUILD time, so a file written there after
  // deploy is saved but never served (it silently 404s). Uploads are stored
  // outside public/ and streamed back by the /api/uploads route instead.
  //
  // This is an `afterFiles` rewrite deliberately: it runs AFTER the static
  // file check, so the sample images committed under public/uploads are still
  // served statically exactly as before, and only URLs with no matching build
  // -time file fall through to the route handler. Existing /uploads/<file>
  // URLs already stored in the database keep working either way.
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [{ source: "/uploads/:path*", destination: "/api/uploads/:path*" }],
      fallback: [],
    };
  },
};

export default nextConfig;
