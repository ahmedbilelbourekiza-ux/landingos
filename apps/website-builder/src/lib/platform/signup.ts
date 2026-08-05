import "server-only";

import { asPlatform, withTenant } from "@landingos/db";
import { hashPassword } from "@landingos/auth";

import { isReservedSlug } from "@/lib/storefront/resolve-tenant";

/* =============================================================================
 * Self-serve signup — Phase 7.3.
 *
 * The first PUBLIC, unauthenticated write path on the platform. Every prior
 * write is session-gated; this one creates a Tenant, a User, a Membership and a
 * Subscription from a signed-out visitor, because that is what "sign up" means.
 *
 * R-08 — the slug. `Tenant.slug` is a public-namespace unique that appears in
 * every storefront URL. A reserved-word list already guards the READ path
 * (`isReservedSlug`); this slice enforces it at CREATION, so a customer cannot
 * claim `api`, `console`, `login`, `_next` and shadow the platform for everyone.
 *
 * The four writes span two binding contexts, because the rows live in two RLS
 * worlds: Tenant and User are platform-side (no tenantId, no policy), while
 * Membership and Subscription are tenant-scoped (RLS, must be bound). So the
 * first two are written through `asPlatform()`, the second two through
 * `withTenant(newTenantId)`. If the second half fails the tenant+user are
 * orphaned — acceptable for a first slice (cleanup is Phase 8), and rare in
 * practice because the only failure mode is a concurrent slug collision, which
 * the unique constraint catches at the first `tenant.create`.
 * ========================================================================== */

/** The minimum password length. Not a strength meter — a floor. */
export const MIN_PASSWORD_LENGTH = 8;

/** A new tenant starts on trial with BOTH products. A trial that shows an empty console teaches nothing. */
export const TRIAL_ENTITLEMENTS = ["product.website-builder", "product.erp"] as const;

/**
 * The kebab-case slug shape, matching the registry's `ID_PATTERN`.
 * The storefront lowercases before lookup, so lowercase on store too.
 */
const SLUG_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const SLUG_MIN = 2;
const SLUG_MAX = 40;

export interface SignUpInput {
  readonly slug: string;
  readonly companyName: string;
  readonly name: string;
  readonly email: string;
  readonly password: string;
}

export interface SignUpResult {
  readonly userId: string;
  readonly tenantId: string;
  readonly tenantSlug: string;
  readonly role: "OWNER";
}

export interface SignUpRefusal {
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

/**
 * Validate + normalise the slug. Returns the lowercased slug, or a refusal.
 *
 * `isReservedSlug` is the R-08 list — the same function the storefront read
 * path uses. Enforcing it here means a reserved slug is refused at creation,
 * not silently shadowed when somebody types the URL.
 */
function checkSlug(raw: string): string | SignUpRefusal {
  const slug = String(raw ?? "").trim().toLowerCase();
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX) {
    return { status: 422, code: "INVALID_INPUT", message: "The slug must be 2–40 characters." };
  }
  if (!SLUG_PATTERN.test(slug)) {
    return { status: 422, code: "INVALID_INPUT", message: "The slug must be lowercase kebab-case (letters, digits, hyphens)." };
  }
  if (isReservedSlug(slug)) {
    return { status: 422, code: "RESERVED_SLUG", message: "That web address is reserved. Choose another." };
  }
  return slug;
}

/**
 * Create a tenant, its OWNER, a membership and a TRIALING subscription.
 *
 * Refuses before any write when the slug or email is already taken — the
 * unique constraints would catch these at insert, but naming the collision
 * (SLUG_TAKEN / EMAIL_TAKEN) is the honest answer and avoids leaking the
 * partial-create on a constraint violation mid-way.
 */
export async function signUp(input: SignUpInput): Promise<SignUpRefusal | SignUpResult> {
  const slug = checkSlug(input.slug);
  if (typeof slug !== "string") return slug;

  const email = String(input.email ?? "").trim().toLowerCase();
  const name = String(input.name ?? "").trim();
  const companyName = String(input.companyName ?? "").trim() || slug;
  const password = String(input.password ?? "");

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { status: 422, code: "INVALID_INPUT", message: "A valid email is required." };
  }
  if (!name) {
    return { status: 422, code: "INVALID_INPUT", message: "Your name is required." };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { status: 422, code: "INVALID_INPUT", message: `The password must be at least ${MIN_PASSWORD_LENGTH} characters.` };
  }

  // Pre-check collisions. The unique constraints are the backstop; these reads
  // turn a P2002 into a named refusal the caller can act on.
  const slugTaken = await asPlatform().tenant.findUnique({ where: { slug }, select: { id: true } });
  if (slugTaken) {
    return { status: 409, code: "SLUG_TAKEN", message: "That web address is already taken." };
  }
  const emailTaken = await asPlatform().user.findUnique({ where: { email }, select: { id: true } });
  if (emailTaken) {
    return { status: 409, code: "EMAIL_TAKEN", message: "An account with that email already exists." };
  }

  // --- The four writes ----------------------------------------------------
  // 1. Tenant (platform-side; no RLS).
  const tenant = await asPlatform().tenant.create({
    data: { slug, name: companyName },
  });

  // 2. User (platform-side; global identity).
  const passwordHash = await hashPassword(password);
  const user = await asPlatform().user.create({
    data: { email, name, passwordHash, mustChangePassword: false },
  });

  // 3 + 4. Membership + Subscription (tenant-scoped; RLS). Both inside one
  // `withTenant` transaction so they are atomic with respect to each other.
  await withTenant(tenant.id, async (tx) => {
    await tx.membership.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        role: "OWNER",
      },
    });
    await tx.subscription.create({
      data: {
        tenantId: tenant.id,
        // status defaults to TRIALING in the schema — do NOT set ACTIVE.
        entitlements: [...TRIAL_ENTITLEMENTS],
      },
    });
    await tx.auditEvent.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        product: "platform",
        entity: "tenant",
        entityId: tenant.id,
        action: "signup",
        payload: { slug, email },
      },
    });
  });

  return { userId: user.id, tenantId: tenant.id, tenantSlug: tenant.slug, role: "OWNER" };
}
