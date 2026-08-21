# SECURITY_PASS_AUG22 — the overnight security pass, consolidated

**Written:** 22 August 2026 (overnight, unattended) · **For:** Bilel, on return.
**State: BUILT, TESTED, COMMITTED LOCALLY. NOT PUSHED, NOT DEPLOYED — production
untouched in every way** (no push, no migration, no Render env change, no
database contact beyond the ordinary dev-suite runs against the dev project).
`origin/main` is still `f0e2084`; local main leads by **three code commits**:

| Commit | Slice |
|---|---|
| `72f89fa` | **SEC.7** — SSRF: outbound destinations checked as *resolved*, redirects re-checked |
| `304a547` | **SEC.8** — AI spend split out of "edit pages" into its own SENSITIVE permission |
| `796362e` | **SEC.9** — fresh review of the LB.23 surface: two gaps closed, guarantees pinned |

**The range is code-only: zero `.prisma`, zero migrations, zero `.sql`** —
asserted with a diff over the range, so deploying it is a push with **no
database step**. Deploying is your decision and is NOT done.

---

## 1. SEC.7 — the SSRF fix (finding #1 from the earlier review)

**What was wrong.** Two surfaces let a tenant point *this server* at an address
of their choosing:

- **Webhooks** — `url-guard.ts` refused private hosts **as written**, at
  configuration time only, and said so honestly in its header: DNS rebinding
  (a public name later repointed at `169.254.169.254` or `10.x`) walked past a
  check that only ever read the string. Delivery never re-checked.
- **AI provider `baseUrl`** — worse than the finding stated: it had **no
  validation at all** (any string ≤ 500 chars, not even URL-parsed), it is
  fetched server-side **with the tenant's credential attached**, and both AI
  fetch paths followed redirects blind. Node strips `authorization` on a
  cross-origin redirect but **not `x-api-key`** — so a hostile
  "OpenAI-compatible" endpoint answering 302 could walk an Anthropic-shaped
  key, and the request, anywhere it liked, including the cloud metadata
  service.

**The fix** — one authority, `apps/website-builder/src/lib/net/outbound-guard.ts`,
three gates:

1. **As written** — parse, protocol policy (webhooks stay https-only; AI
   allows http for self-hosted public endpoints), no embedded credentials,
   literal IPs judged by `isPrivateIp` (one classifier for every spelling:
   dotted/decimal/hex/octal IPv4, and the IPv6 mapped/NAT64/6to4/compat forms
   judged by their **embedded** IPv4), names judged by the block patterns
   (+ `.home.arpa`).
2. **As resolved, at request time** — `dns.lookup(host, {all})` immediately
   before the connection; **any** private A/AAAA record refuses. Webhook
   delivery re-resolves before **every attempt** (between retry waits is
   exactly when a hostile record flips); a refusal is terminal (never
   retried), logged with its reason, and the "send test" button gets the same
   answer production would give.
3. **After redirects** — the runtime never follows a `Location` on its own
   anywhere anymore. Webhooks keep their never-follow rule (a 3xx is a
   failure, unchanged). The AI paths follow at most 3 **same-origin** hops,
   each re-checked through gates 1–2; **cross-origin hops are refused
   outright** (that is the `x-api-key` leak above); a 301/302/303 answering a
   POST is returned as the terminal answer rather than silently retried as
   GET.

Config-time, the AI provider routes (POST + PUT) now 422 a private/internal/
non-http(s)/credentialed `baseUrl` with a message naming the rule. An empty
string still means "use the preset".

**The seam, and its rule.** `OUTBOUND_PRIVATE_ALLOWLIST` — comma-separated
**exact hostnames** that skip the privacy refusals (not the protocol rule).
It exists because every delivery suite stands its receiver up on `127.0.0.1`;
the test server now runs with `OUTBOUND_PRIVATE_ALLOWLIST=127.0.0.1`.
**Production leaves it unset and unset means fully strict — no Render env
change is needed to deploy this.** It is an allow-list, never an off-switch.

**Honest limit, stated in the module header:** gate 2 checks the resolution
*this process* observed. A racing resolver serving sub-second TTLs can still
flip between our lookup and the socket's own (classic rebinding's last inch).
Closing that fully requires the lookup to happen *inside* the connection (an
undici `Agent` with a checking `lookup` in its connect options) — recorded as
further hardening, not done tonight; the fix delivered is exactly the one the
finding asked for and reduces the attack from "any public name, any time" to
"a racing resolver within a request".

**Proof.** `test/outbound-guard.test.ts` — **29 new tests**: the IP classifier
table (including `::ffff:7f00:1`, NAT64, 6to4, zone ids), the as-written gate
(every historical spelling still refused, allowlist admits exactly what it
names), the resolve gate with an injected lookup (the rebinding case, one
private among many public, private AAAA), and redirect discipline against real
listeners (followed/refused/capped, POST-vs-307 body preservation, cross-origin
never contacted, refusal before any socket opens). Plus: webhooks suite +1 —
an endpoint whose hostname (`localhost`) *resolves* to the loopback **where the
suite's own receiver is listening** is refused at delivery time: zero hits on
the receiver, one attempt, reason in the delivery log. erp/ai suite +2 —
config-time 422s, and a DB-seeded row that dodged the config guard is refused
at *test* time, fast (the speed is itself proof no connection to
`169.254.169.254` was attempted).

---

## 2. SEC.8 — the AI-spend permission (finding #2), and why permission over quota

**What was wrong.** Both AI spenders — `POST /api/builder/landings/generate`
and `POST /api/builder/landings/[id]/analyze` — were gated on
`website-builder:pages:write`, which MANAGER holds through the `*:*:write`
glob. Anyone who could edit a page could bill the tenant's own provider key,
silently, up to the whole monthly quota (200 calls).

**The call: a distinct permission, quota left as is.** Reasoning:

- The two controls answer different questions. The quota (AQ.1) bounds **how
  much**; it cannot say **who**. Lowering the default would shrink the
  legitimate owner's ceiling while the asymmetry — an editor spending the
  owner's money — survives at any quota above zero.
- The platform already has doctrine for exactly this. `rbac.ts`'s SENSITIVE
  list exists for "the ones where *probably fine* is the wrong default: …
  **spending money**, the customer list, and the books." AI spend *is*
  spending money. `*:ai:spend` slots in beside `*:finance:read`,
  product-agnostic, so a future ERP spender inherits the rule unbuilt.
- LB.24's route header had recorded the question openly ("whether AI spend
  deserves its own permission … is an open product question, recorded in
  NEXT_STEPS §LB.24"). This closes it consistently with the codebase's own
  rules rather than inventing a new mechanism.

**What changed.** `website-builder:ai:spend` declared in the product manifest;
`*:ai:spend` added to SENSITIVE (OWNER/ADMIN by role `*`, everyone else by
named grant — the `erp:agents:manage` shape). Both spender routes check it
in-handler beside the wrapper's `pages:write`, **before** provider/cooldown
logic, answering `403 AI_SPEND_FORBIDDEN`. The screens follow the
reachability rule: the generate panel (and its "configure AI" pointer) and the
analyze button simply don't render for non-spenders — no controls whose click
can only 403. The quota, ledger and 429 behaviour are untouched.

**Impact tonight: zero.** Every production operator is OWNER (holds `*`), and
no production `AiProvider` row exists, so nothing anyone can currently do
changes. The one real cost, recorded deliberately: **no console surface
writes membership permission grants yet**, so giving a MANAGER `ai:spend` is
a database act until the team screen learns to edit `Membership.permissions`.
That is a product decision for daylight (it would also unlock granting
`erp:clients:read` etc. from the console — the same gap).

**Proof.** packages/auth +1 describe (the glob does not grant it; the named
grant does; OWNER/ADMIN unchanged; a MEMBER holding `pages:write` by grant
still cannot spend). builder-ai +2: a MANAGER is 403 `AI_SPEND_FORBIDDEN`
*before any provider logic* (asserted by running it while no provider exists),
their screen renders neither panel nor pointer; the granted manager generates
a real page through the stub, and the bare manager stays refused even with a
provider configured. builder-insights +1: the 403 consumes **no ledger row**,
the analyze button is absent for non-spenders, and the grant flips the answer
to the data floor (422), proving the ordering permission → floor → provider.

---

## 3. SEC.9 — the fresh review of the LB.23 surface (what the audit never saw)

Scope: intake route, encrypted storage, connect form, refresh route,
`AdAccount.accessToken`, RLS scoping. Findings in priority order — **fixed
first, then verified-held, then accepted-and-recorded.**

### Fixed

**F1 — Dead controls for most roles (medium, UX-security).** The analytics
screen rendered the connect-token form and the Refresh button for everyone it
admits (`orders:read` — MEMBER and VIEWER included), while the routes they
call demand `platform:integrations:manage` (OWNER/ADMIN only by role). A
VIEWER was being offered a **credential input** whose save could only answer
403 — LB.23c's reachability defect in reverse, and a screen teaching people
to paste secrets into fields that don't work for them. Both controls are now
gated on the same permission as their routes; the spend numbers stay readable
for everyone the screen admits. *(Screen edit rode in the SEC.8 commit — same
file; tests in SEC.9's.)*

**F2 — The documented disconnect did not exist (medium).** The intake route's
own comment promised "clearing a token is a separate, explicit act (DELETE
the row)" — and no DELETE route existed anywhere. A compromised or expired
credential could only be *overwritten* from the console, never removed;
revocation of the stored copy required database access. That is LB.23c's dead
end at the exit instead of the entrance. `DELETE
/api/platform/integrations/ad-accounts/[id]` now exists: manage-gated,
`deleteMany`+count so a cross-tenant id gets the same 404 as a nonexistent one
(no existence oracle), and the schema's own `onDelete: Cascade` takes the
spend history with the account — stated in the route header, with the
re-connect path (the sync is an idempotent 90-day upsert on demand).

**F3 — accountId path-injection hardening (low).** `buildInsightsRequest`
interpolates the account id into the Graph request *path* but only refused
the `act_` prefix — the intake route regexes `^\d{5,25}$`, but the
`PlatformCredential` config path (written by an attended script) did not share
that rule, so `123/../x` or `123?fields=…` would have built a different URL.
Digits-only is now enforced where the URL is built, throwing like the
existing shape checks.

### Probed and held (now pinned by tests so they keep holding)

- **The encrypted-only guarantee holds under every edge probed.** Empty
  string, whitespace-only, and >500-char tokens are 422 at the route, change
  nothing at rest, and **no refusal echoes the credential**. At the reader:
  a four-segment hex value is refused *before* `decryptToken`'s lenient
  3-part split could quietly drop the tail; a tampered IV, tag, or
  ciphertext (one flipped nibble anywhere) reads as null via GCM's auth, not
  a throw; the 500-char maximum round-trips; a megabyte of junk answers null
  in bounded time; a value sealed under a different `AUTH_SECRET` reads as
  "not connected" (the known laptop/prod mismatch, as a unit test — already
  covered, kept).
- **No token egress found anywhere**: the GET/POST responses mask to
  presence (`••••••••`/null), no other select touches `accessToken`
  (verified by grep across `src/` and the panel/read paths), no log line can
  carry it (the Meta wire request puts it in the `Authorization` header,
  never the URL; error paths return Meta's message or a status only), the
  screen never renders it (pinned), and the client form is `type="password"`,
  autocomplete off, state cleared on success.
- **RLS scoping is real**: `AdAccount`/`AdSpendDaily` carry `tenantId` and the
  derived policy (prod verified 57/57 on 21 Aug); cross-tenant list/refresh/
  overwrite/delete all pinned as 404-or-invisible.
- **CSRF posture**: session cookie is `httpOnly` + `SameSite=Lax` and every
  mutation is a non-GET, so cross-site form posts don't carry the session.

### Accepted, not changed (recorded so they're decisions, not oversights)

- **Read-tier sees account metadata + the presence mask** (`integrations:read`
  — MEMBER/VIEWER by glob): account id, name, currency, whether a token
  exists. Matches the tracking-integrations precedent; no secret material.
- **Meta upstream error text reaches the authorized manager verbatim** on
  refresh 502 — deliberate since LB.23b ("Meta's own words, not ours"); the
  URL is fixed (`graph.facebook.com`), not tenant-controlled, so this is not
  an SSRF read oracle.
- **No per-route rate limit on refresh/intake** beyond auth: manage-tier,
  human-paced, and Meta rate-limits per token on its side.
- **MANAGER's exclusion from the credential is now pinned** (`manage` matches
  no role glob below ADMIN) — was true, is now a test.

---

## 4. Verification — everything ran against the freshly built server

Server: stop → build (twice: exit 0, fresh BUILD_ID both times) → standalone
start with the documented stub env **plus** `OUTBOUND_PRIVATE_ALLOWLIST=127.0.0.1`
(now part of the required suite env — memory updated). Suites sequential, per
file, judged per the rerun rule (three runs hit the known one-off Neon
transients — a mid-suite abort cascade and one cold-start "can't reach
database"; every one passed clean on rerun, and no failure ever recurred).

| Suite | Result |
|---|---|
| outbound-guard (new) | **29/29** |
| hardening (url-guard pure + routes) | 19/19 |
| webhooks (incl. new delivery-time refusal) | 11/11 |
| ads-credential + ads-spend (pure) | 31/31 |
| ads-routes (incl. SEC.9 gates + disconnect) | 25/25 |
| builder-ai (incl. SEC.8) | 31/31 |
| builder-insights (incl. SEC.8) | 14/14 |
| erp/ai (incl. SEC.7 config + request-time) | 33/33 |
| ads-panel / builder-api / tracking / storefront | 8 + 49 + 16 + 95, all green |
| erp/integrations + erp/access (regression) | 80 + 205, all green |
| packages/auth (incl. SEC.8 rbac) | 37/37 |
| packages/product-registry | 36/36 |

`tsc --noEmit`: identical 269-error baseline before and after — **zero new
type errors** (the baseline is the known `ignoreBuildErrors` debt). Test
tenants were the suites' own throwaway tenants with their standard cleanup
hooks; all runs were against the **dev** Neon project.

---

## 5. What is deliberately NOT done, and what's open for you

1. **Nothing is deployed.** `origin/main` = `f0e2084`; the three commits are
   local only. When you choose to ship: the range is code-only (no migration
   step), rollback is `f0e2084`, and **no Render env change is needed** —
   the allowlist seam defaults to strict when unset. Standard ref-mapped push
   + build-id marker applies. **Verify-live is therefore still owed** for all
   three slices after any deploy.
2. **Granting `ai:spend` to a non-admin has no UI** — `Membership.permissions`
   has no console writer (pre-existing gap, now load-bearing). Decide whether
   the team screen should learn permission grants.
3. **Undici-level DNS pinning** (lookup inside the connection) — the last
   inch of rebinding; recorded in the guard's header as further hardening.
4. **`.env` files** in `apps/website-builder` don't need the allowlist for
   PURE suites (the guard tests set/clear it themselves); only the **server**
   process needs it, and only for suites — the start command in
   [[test-harness-env]] is updated.
5. Everything previously open stays open: Supabase cutover, scheduled spend
   refresh, LB.14a.2, campaign-level UTM tagging.

*Session hygiene: the dev server started for the suites was stopped at the end
of the pass; port 3000 is free.*
