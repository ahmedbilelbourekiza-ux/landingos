/* =============================================================================
 * test/support/tsx-loader.mjs — lets a node:test file import a REAL client
 * component (.tsx, `@/` aliases) instead of a replica of one.
 *
 * Node's --experimental-strip-types runs the .ts suites but (a) does not
 * transform JSX and (b) cannot resolve Next's `@/` alias — which is why the
 * dev-loop notes say suite imports must be relative .ts. That rule kept every
 * suite honest right up until the thing under test WAS a .tsx component: the
 * version-history dialog's render loop lived entirely in client code, and a
 * test that cannot mount the real component cannot catch a real render loop.
 *
 * Registered per-test-file via `module.register(...)`, so nothing about the
 * suite runner changes; only imports made AFTER registration flow through it.
 *
 *   resolve:  `@/x` → `<app>/src/x`, trying .ts/.tsx/index when extensionless
 *   load:     .tsx (and .ts reached through it) via esbuild, jsx automatic
 * ========================================================================== */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { transformSync } from "esbuild";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));

const candidates = (base) => [
  base,
  `${base}.tsx`,
  `${base}.ts`,
  path.join(base, "index.tsx"),
  path.join(base, "index.ts"),
];

function resolveFile(base) {
  for (const candidate of candidates(base)) {
    if (existsSync(candidate) && !candidate.endsWith(path.sep)) {
      try {
        return pathToFileURL(candidate).href;
      } catch {
        /* fall through */
      }
    }
  }
  return null;
}

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const resolved = resolveFile(path.join(SRC, specifier.slice(2)));
    if (resolved) return { url: resolved, shortCircuit: true };
  }
  // A relative import from inside src may point at a .tsx with no extension.
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    context.parentURL?.includes("/src/")
  ) {
    const parentDir = path.dirname(fileURLToPath(context.parentURL));
    const resolved = resolveFile(path.resolve(parentDir, specifier));
    if (resolved) return { url: resolved, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export function load(url, context, nextLoad) {
  if (url.endsWith(".tsx") || (url.includes("/src/") && url.endsWith(".ts"))) {
    const source = readFileSync(fileURLToPath(url), "utf8");
    const { code } = transformSync(source, {
      loader: url.endsWith(".tsx") ? "tsx" : "ts",
      jsx: "automatic",
      format: "esm",
      target: "es2022",
    });
    return { format: "module", source: code, shortCircuit: true };
  }
  return nextLoad(url, context);
}
