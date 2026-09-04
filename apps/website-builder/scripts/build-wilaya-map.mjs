/* =============================================================================
 * WM.1 — regenerate `src/lib/builder/algeria-wilaya-map.ts` from OpenStreetMap.
 *
 * WHAT THIS PRODUCES. One vendored TypeScript module holding every Algerian
 * wilaya boundary as an SVG path, projected into a fixed viewBox. The Traffic
 * screen renders it server-side; nothing fetches at runtime.
 *
 * WHY 68 SHAPES KEYED TO 58 CODES. Algeria's April 2026 reform (law 26-06)
 * created 11 new wilayas (59–69). OpenStreetMap has ALREADY carved ten of
 * them out of their parents — measured on 4 Sep 2026: every new-wilaya
 * centroid falls inside NO old polygon, so drawing only the 58 old shapes
 * leaves ten holes. The platform's reference data, its checkout dropdown and
 * therefore every order it can record are still on the 58-wilaya vocabulary.
 * So each shape carries TWO codes: its own (`code`) and the one the data
 * joins on (`displayCode` — the documented parent for a post-reform shape,
 * itself otherwise). Each parent pairing below was verified geometrically:
 * child-to-parent minimum vertex distance < 0.02°, i.e. truly adjacent.
 * DZ-63 (El Aricha) has no OSM relation yet, and its territory is still
 * inside Tlemcen's polygon (point-in-polygon, 4 Sep 2026), so its absence
 * leaves no gap. When the platform's reference moves to 69, delete PARENT
 * entries as OSM completes, and re-run this.
 *
 * SOURCE AND LICENCE. Relation ids come from Overpass
 * (ISO3166-2 ~ ^DZ-, admin_level 4); geometry from
 * polygons.openstreetmap.fr's simplification service (Douglas-Peucker,
 * 0.01°). Data © OpenStreetMap contributors, ODbL — the rendered map must
 * keep a visible "© OpenStreetMap contributors" credit, which the Traffic
 * screen carries. Be polite to the volunteer-run polygon service: this
 * script sleeps between requests and caches downloads in --cache.
 *
 * USAGE
 *   node scripts/build-wilaya-map.mjs --cache /tmp/wilayas
 * ========================================================================== */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "..", "src", "lib", "builder", "algeria-wilaya-map.ts");

const cacheArg = process.argv.indexOf("--cache");
const CACHE = cacheArg > -1 ? process.argv[cacheArg + 1] : path.join(HERE, ".wilaya-cache");
fs.mkdirSync(CACHE, { recursive: true });

/** The reform's parent per new wilaya (decree 26-206) — geometry-verified. */
const PARENT = {
  59: "03", // Aflou ← Laghouat
  60: "05", // Barika ← Batna
  61: "07", // El Kantara ← Biskra
  62: "12", // Bir El Ater ← Tébessa
  // 63 El Aricha ← Tlemcen: no OSM relation yet; area still inside DZ-13.
  64: "14", // Ksar Chellala ← Tiaret
  65: "17", // Aïn Oussera ← Djelfa
  66: "17", // Messaad ← Djelfa
  67: "26", // Ksar El Boukhari ← Médéa
  68: "28", // Boussaâda ← M'Sila
  69: "32", // El Abiodh Sidi Cheikh ← El Bayadh
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, file) {
  const cached = path.join(CACHE, file);
  if (fs.existsSync(cached) && fs.statSync(cached).size > 200) {
    return JSON.parse(fs.readFileSync(cached, "utf8"));
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  const text = await res.text();
  const json = JSON.parse(text); // throws on an error page
  fs.writeFileSync(cached, text);
  await sleep(700);
  return json;
}

// 1. Every DZ wilaya relation.
const overpass = await fetchJson(
  "https://overpass-api.de/api/interpreter?data=" +
    encodeURIComponent(
      '[out:json][timeout:50];relation["boundary"="administrative"]["admin_level"="4"]["ISO3166-2"~"^DZ-"];out ids tags;',
    ),
  "relations.json",
);
const relations = overpass.elements
  .map((e) => ({
    id: e.id,
    code: e.tags["ISO3166-2"].slice(3),
    name: e.tags["name:fr"] ?? e.tags.name,
  }))
  .sort((a, b) => a.code.localeCompare(b.code));

// 2. Simplified geometry per relation.
const shapes = [];
for (const r of relations) {
  const j = await fetchJson(
    `https://polygons.openstreetmap.fr/get_geojson.py?id=${r.id}&params=0.010000-0.002000-0.002000`,
    `geo-${r.code}.json`,
  );
  const g = j.geometries ? j.geometries[0] : j;
  const polys = g.type === "MultiPolygon" ? g.coordinates : [g.coordinates];
  shapes.push({ ...r, polys });
}

// 3. Project: equirectangular, x compressed by cos(mid-latitude) so the
//    country keeps its shape; y flipped (SVG grows downward).
let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
for (const s of shapes)
  for (const poly of s.polys)
    for (const ring of poly)
      for (const [lon, lat] of ring) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
const midLat = ((minLat + maxLat) / 2) * (Math.PI / 180);
const W = 800;
const k = W / ((maxLon - minLon) * Math.cos(midLat));
const H = Math.ceil((maxLat - minLat) * k);
const px = (lon) => (lon - minLon) * Math.cos(midLat) * k;
const py = (lat) => (maxLat - lat) * k;

// 4. Compact relative path data. Integer coordinates: at 800 px width the
//    rounding error is under half a pixel, invisible on a fixed-size map,
//    and it cuts the vendored module by a third.
const r1 = (n) => Math.round(n);
function pathFor(polys) {
  let d = "";
  for (const poly of polys) {
    for (const ring of poly) {
      let lx = 0, ly = 0;
      ring.forEach(([lon, lat], i) => {
        const x = r1(px(lon)), y = r1(py(lat));
        if (i === 0) d += `M${x} ${y}`;
        else {
          const dx = r1(x - lx), dy = r1(y - ly);
          if (dx !== 0 || dy !== 0) d += `l${dx} ${dy}`;
        }
        lx = x; ly = y;
      });
      d += "Z";
    }
  }
  return d;
}

const entries = shapes.map((s) => ({
  code: s.code,
  displayCode: PARENT[Number(s.code)] ?? s.code,
  d: pathFor(s.polys),
}));

// 5. Sanity before writing: complete 01–69 minus 63, every displayCode ≤ 58.
const have = new Set(entries.map((e) => Number(e.code)));
for (let i = 1; i <= 69; i += 1) {
  if (i === 63) continue;
  if (!have.has(i)) throw new Error(`missing wilaya ${i} — refusing to write a map with holes`);
}
for (const e of entries) {
  if (Number(e.displayCode) > 58) throw new Error(`displayCode ${e.displayCode} is not in the 58-code vocabulary`);
}

const stamp = new Date().toISOString().slice(0, 10);
const body = `/* =============================================================================
 * GENERATED FILE — do not edit by hand. Regenerate with:
 *   node scripts/build-wilaya-map.mjs
 *
 * Algeria's wilaya boundaries as SVG paths, for the Traffic screen's
 * orders-by-wilaya map. ${entries.length} shapes (post-2026-reform boundaries as
 * OpenStreetMap has them; DZ-63 El Aricha is unmapped upstream and its
 * territory is still covered by Tlemcen). \`displayCode\` keys each shape to
 * the 58-wilaya vocabulary the platform's reference data and checkout use:
 * a post-reform shape carries its geometry-verified parent's code. The
 * generator's header records the full reasoning.
 *
 * Geodata © OpenStreetMap contributors (ODbL) — any screen rendering these
 * paths must keep a visible "© OpenStreetMap contributors" credit.
 * Extracted ${stamp}, simplified 0.01°, integer coordinates at 800 px width.
 * ========================================================================== */

export const WILAYA_MAP_VIEWBOX = "0 0 ${W} ${H}";

export interface WilayaShape {
  /** The shape's own ISO 3166-2:DZ number, "01".."69". */
  readonly code: string;
  /** The 58-vocabulary code the ORDER DATA joins on (parent for post-reform
   * shapes). Several shapes may share one displayCode. */
  readonly displayCode: string;
  readonly d: string;
}

export const WILAYA_SHAPES: readonly WilayaShape[] = [
${entries.map((e) => `  { code: ${JSON.stringify(e.code)}, displayCode: ${JSON.stringify(e.displayCode)}, d: ${JSON.stringify(e.d)} },`).join("\n")}
];
`;
fs.writeFileSync(OUT, body);
console.log(`wrote ${OUT}: ${entries.length} shapes, viewBox 0 0 ${W} ${H}, ${(body.length / 1024).toFixed(0)} KB`);
