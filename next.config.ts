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
};

export default nextConfig;
