/* Hostname normalisation for custom-domain claims — B5. Shared by the
 * domains route and its tests; route files may export only handlers. */

/** RFC-ish hostname: dotted labels, letters/digits/hyphens, real TLD. */
const HOSTNAME = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function normalizeDomain(raw: string): string | null {
  const host = raw.trim().toLowerCase().replace(/\.$/, "");
  if (!HOSTNAME.test(host)) return null;
  // The platform's own surfaces can never be claimed: a tenant "verifying"
  // the deployment's hostname would swallow every other tenant's traffic.
  if (host === "onrender.com" || host.endsWith(".onrender.com")) return null;
  if (host === "localhost" || host.endsWith(".localhost")) return null;
  return host;
}
