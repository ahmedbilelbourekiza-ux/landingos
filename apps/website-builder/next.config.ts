import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  // Pin the tracing root to the workspace root rather than letting Next infer
  // it. Inference works today, but it is a heuristic over lockfile location —
  // and it decides the SHAPE of .next/standalone: with a workspace root the
  // server lands at standalone/apps/website-builder/server.js with node_modules
  // hoisted beside it, without one it lands at standalone/server.js. The
  // Dockerfile and the entrypoint both hard-code that path, so an inference
  // that changes silently relocates the server and the container starts
  // failing with MODULE_NOT_FOUND.
  outputFileTracingRoot: path.join(import.meta.dirname, "../../"),
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

// The plugin is what makes src/i18n/request.ts reachable. Without it every
// server component using a next-intl API throws at runtime while the build
// still reports success.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

export default withNextIntl(nextConfig);
