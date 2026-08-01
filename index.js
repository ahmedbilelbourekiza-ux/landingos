const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const webpush = require('web-push');

/* =============================================================================
 * Web Push (real OS-level notifications — work even when the app is closed,
 * unlike the existing SSE-based in-app ones). VAPID keys MUST be fixed/stable
 * — set as Render environment variables, never regenerated at boot — because
 * regenerating them would invalidate every agent's existing subscription on
 * every redeploy (per web-push's own documented usage pattern).
 * ========================================================================== */
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails('mailto:admin@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
} else {
  console.log('[push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set — push notifications are disabled until configured');
}

/** Sends a real push notification to every device the given agent has
 *  subscribed from. Silently does nothing if VAPID isn't configured yet, or
 *  the agent has no subscriptions — this is always an ADDITION alongside the
 *  existing SSE broadcast, never a replacement, so nothing breaks if push
 *  isn't set up. Cleans up subscriptions the push service reports as gone
 *  (404/410 — e.g. the agent uninstalled the app). */
async function sendPushToAgent(agentName, { title, body, url }) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !agentName) return;
  let subs = [];
  try { subs = db.getPushSubscriptionsForAgent(agentName); } catch (e) { return; }
  const payload = JSON.stringify({ title, body, url: url || './agent.html' });
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        try { db.deletePushSubscriptionByEndpoint(sub.endpoint); } catch (e2) {}
      } else {
        logError('push', 'send failed', { agent: agentName, err: e.message, statusCode: e.statusCode });
      }
    }
  }
}

/* =============================================================================
 * Data layer is now SQLite (lib/db.js) — transactional, with append-only tables
 * for shipment_events and audit_log so shipment history can never be overwritten.
 * Legacy JSON files are imported once on first boot, then renamed *.legacy.
 * ========================================================================== */
const db = require('./lib/db');
const notifications = require('./lib/notifications');
const providers = require('./lib/providers');
const platforms = require('./lib/platforms');
const aiProviders = require('./lib/ai/providers');
const aiAgents = require('./lib/ai/agents');
const aiContext = require('./lib/ai/context');
const aiInsights = require('./lib/ai/insights');
const conversations = require('./lib/ai/conversations');
const jobs = require('./lib/jobs');
const inventory = require('./lib/inventory');
const followup = require('./lib/followup');
const auth = require('./lib/auth');
const path = require('path');

const app = express();

/* Express matches routes case-INSENSITIVELY by default, so POST /api/AGENTS
 * reaches the same handler as POST /api/agents. The authorization table below
 * matches on the path with regexes, which ARE case-sensitive — so a plain agent
 * could bypass every manager-only rule simply by changing the capitalisation of
 * the URL. Verified: an agent created an account via POST /api/AGENTS and
 * rewrote settings via PUT /api/Settings.
 *
 * Two independent defences, because either alone would be enough and neither
 * should be the only thing standing there:
 *   1. Case-sensitive routing, so an odd-cased path matches no route at all.
 *   2. The gate lowercases before matching (see normalizedPath below), so the
 *      policy still holds if anyone ever turns setting 1 back off. */
app.set('case sensitive routing', true);
app.set('strict routing', false);
app.set('x-powered-by', false);   // don't advertise the stack

const PORT = process.env.PORT || 3000;
const SHOPIFY_SECRET = process.env.SHOPIFY_SECRET || '';

/* =============================================================================
 * CORS (audit SEC-01).
 *
 * This was `app.use(cors())` — every origin allowed, on an API that had no
 * authentication, which made the whole dataset readable from any web page the
 * user happened to visit.
 *
 * The clients are now served by this same app (see express.static below), so
 * the normal case is same-origin and needs no CORS at all. ALLOWED_ORIGINS
 * exists for the separately-hosted copy during the switchover: a comma-
 * separated allowlist, e.g.
 *     ALLOWED_ORIGINS=https://mycrm.netlify.app,https://admin.example.com
 * Credentials are enabled so the session cookie travels, which is precisely why
 * the allowlist can never be `*` — browsers reject that combination anyway.
 * ========================================================================== */
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const CROSS_SITE = ALLOWED_ORIGINS.length > 0;

app.use(cors({
  credentials: true,
  origin(origin, cb) {
    // Same-origin and non-browser callers (curl, carrier webhooks, the mobile
    // PWA's service worker) send no Origin header at all — those are not CORS
    // requests and must not be rejected here.
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(null, false);   // no CORS headers => the browser blocks it
  },
}));

app.use('/webhook/shopify', express.raw({ type: 'application/json' }));
// Default 100KB limit is far too small for variant images, which are stored
// as base64 data URLs and can be several MB each.
app.use(express.json({ limit: '25mb' }));

/* Resolve the caller's session before any /api route runs. Never rejects.
 * Mounted on /api rather than globally: every call costs a session lookup plus
 * an agent lookup, and running that for each static asset request was pure
 * waste — none of those routes read req.user. */
app.use('/api', auth.attachUser);

/* =============================================================================
 * API GATE (audit SEC-01) — everything under /api requires a session unless it
 * is explicitly listed as public.
 *
 * Registered here, ahead of every route, so protection does not depend on the
 * order routes happen to be declared in: a route added later is covered the
 * moment it exists rather than only if somebody remembers to guard it.
 * Deny-by-default is the whole point — the previous state was 117 open routes.
 *
 * Webhooks live under /webhook, not /api, and authenticate by HMAC signature
 * instead (see SEC-04).
 * ========================================================================== */
const PUBLIC_API_PATHS = new Set([
  '/auth/login',              // the way in
  '/auth/logout',             // must work even with an already-invalid session
  '/auth/me',                 // answers 401 itself so clients can probe cheaply
  '/push/vapid-public-key',   // a public key by definition; the PWA needs it pre-login
  '/statuses',                // static vocabulary, no business data
  '/delivery/statuses',       // ditto
]);

/* =============================================================================
 * CSRF.
 *
 * CORS does not prevent a cross-site request — it only stops the attacker
 * READING the response. The request still reaches the handler and its side
 * effects still happen.
 *
 * Same-origin deployments are covered by the session cookie's SameSite=Lax,
 * which browsers refuse to attach to a cross-site POST. But the moment
 * ALLOWED_ORIGINS is set the cookie becomes SameSite=None (it has to, to travel
 * at all), and that protection is gone: any page could POST to this API with
 * the user's session attached and, say, delete orders.
 *
 * So state-changing requests must carry an Origin this server recognises. A
 * missing Origin is allowed because non-browser callers (curl, carrier
 * webhooks, the smoke test) do not send one — and those are not the CSRF
 * threat, since an attacker's leverage here is precisely the victim's browser
 * attaching the cookie automatically.
 * ========================================================================== */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
app.use('/api', (req, res, next) => {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return next();
  const origin = req.headers.origin;
  if (!origin) return next();
  if (ALLOWED_ORIGINS.includes(origin)) return next();

  // Same-origin: the browser sends Origin on same-origin POSTs too.
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  if (host && origin === `${proto}://${host}`) return next();

  logError('csrf', 'blocked a state-changing request from an unrecognised origin', {
    origin, method: req.method, path: req.originalUrl,
  });
  return res.status(403).json({ error: 'Cross-origin request refused', code: 'CSRF_ORIGIN' });
});

/* Lowercased and stripped of any trailing slash, so '/Agents/' and '/agents'
 * cannot be treated differently from '/agents' by the rules below. */
function normalizedPath(req) {
  const p = String(req.path || '').toLowerCase();
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}

app.use('/api', (req, res, next) => {
  if (PUBLIC_API_PATHS.has(normalizedPath(req))) return next();
  return auth.requireAuth(req, res, next);
});

/* =============================================================================
 * AUTHORIZATION (audit SEC-01) — which signed-in accounts may do what.
 *
 * Expressed as one table rather than a `requireManager` argument scattered over
 * forty route declarations: the whole privilege model is reviewable in one
 * screen, and a route cannot quietly disagree with the policy because the
 * policy IS the enforcement.
 *
 * Paths are matched RELATIVE to /api. Anything not listed is available to any
 * authenticated account — that is correct here because the gate above has
 * already established there IS an account; this table only separates
 * manager work (configuration, staff, money, destructive bulk actions) from
 * agent work (their own orders, calls, follow-ups).
 * ========================================================================== */
const MANAGER_ONLY = [
  // Staff administration and anything payroll-shaped.
  [/^\/agents(\/|$)/, ['GET', 'POST', 'PUT', 'DELETE']],

  // Platform configuration. Reading the carrier/store list stays open because
  // an agent picks a carrier when creating a shipment.
  [/^\/settings$/, ['PUT']],
  [/^\/providers(\/|$)/, ['POST', 'PUT', 'DELETE']],
  [/^\/stores(\/|$)/, ['POST', 'PUT', 'DELETE']],

  // AI configuration (provider keys, agent prompts and permissions).
  // /ai/agents/enabled is deliberately excluded below — the agent PWA needs it.
  [/^\/ai\/providers(\/|$)/, ['GET', 'POST', 'PUT', 'DELETE']],
  [/^\/ai\/agents(\/|$)/, ['POST', 'PUT', 'DELETE']],

  // Money.
  [/^\/financial-records(\/|$)/, ['GET', 'POST', 'PUT', 'DELETE']],
  [/^\/unexpected-charges(\/|$)/, ['GET', 'POST', 'PUT', 'DELETE']],

  // The customer registry is the densest PII in the system — every client's
  // name, phone, address and full lifetime order history. The agent PWA never
  // touches it (it works from the order record it already has), so there is no
  // reason for a confirmation agent to be able to enumerate it.
  [/^\/clients(\/|$)/, ['GET', 'POST', 'PUT', 'DELETE']],

  // The Suivi dashboard groups EVERY confirmed order in the business into
  // buckets. Also console-only.
  [/^\/followup\/dashboard$/, ['GET']],
  [/^\/followup\/assign$/, ['POST']],

  // Catalogue and stock are managed, not edited by confirmation agents.
  [/^\/products(\/|$)/, ['POST', 'PUT', 'DELETE']],

  // Destructive or fleet-wide actions.
  [/^\/orders\/bulk$/, ['POST']],
  [/^\/orders\/[^/]+$/, ['DELETE']],
  [/^\/clients\/import/, ['POST']],
];

/** Exceptions that outrank the table above. */
const MANAGER_EXEMPT = [
  [/^\/ai\/agents\/enabled$/, ['GET']],   // the agent PWA lists assistants it may use
];

function isManagerOnly(method, path) {
  if (MANAGER_EXEMPT.some(([re, methods]) => re.test(path) && methods.includes(method))) return false;
  return MANAGER_ONLY.some(([re, methods]) => re.test(path) && methods.includes(method));
}

app.use('/api', (req, res, next) => {
  if (!isManagerOnly(req.method.toUpperCase(), normalizedPath(req))) return next();
  return auth.requireManager(req, res, next);
});

/* =============================================================================
 * RECORD-LEVEL AUTHORIZATION for a single order.
 *
 * Scoping GET /api/orders was cosmetic on its own: every per-order route takes
 * the id straight from the URL, so any signed-in agent could read, edit,
 * reassign or log a call against ANY order just by naming it. Logging a
 * confirmed call on someone else's order is payroll fraud — it credits
 * payPerConfirmedOrder to whoever made the request — and /audit exposed the
 * customer's name and full call history.
 *
 * The rule matches the list scoping exactly: your own order, an order you are
 * the follow-up agent for, or an unassigned one (which anybody may pick up).
 * ========================================================================== */
const ORDER_SCOPED_PATH = /^\/orders\/([^/]+)(\/.*)?$/;

/* The single definition of "this order is mine". The list filter and the
 * per-order gate below MUST agree — if the gate were stricter than the filter,
 * an agent would see rows in their list that they then could not open; if it
 * were looser, the list would be hiding records they can still reach by id
 * (which is exactly the bug this replaced). Defining it once removes the
 * possibility of the two drifting apart. */
function agentOwnsOrder(order, agentName) {
  if (!order) return false;
  return order.agent === agentName || order.followupAgent === agentName || !order.agent;
}

app.use('/api', (req, res, next) => {
  if (req.user?.isManager) return next();
  const m = ORDER_SCOPED_PATH.exec(normalizedPath(req));
  if (!m) return next();
  if (m[1] === 'bulk') return next();          // handled by the manager table

  // The id in the URL is lowercased by normalizedPath, so re-read it from the
  // raw path to look the order up with its real casing.
  const rawId = decodeURIComponent((ORDER_SCOPED_PATH.exec(req.path) || [])[1] || '');
  const order = db.getOrder(rawId);
  if (!order) return res.status(404).json({ error: 'Not found' });

  const me = req.user.name;
  if (!agentOwnsOrder(order, me)) {
    logError('authz', 'agent attempted to act on an order that is not theirs', {
      actor: me, orderId: order.id, owner: order.agent, method: req.method, path: req.path,
    });
    return res.status(403).json({ error: 'This order is not assigned to you', code: 'NOT_YOUR_ORDER' });
  }

  // Reassigning an order is a manager action. Without this an agent could
  // hand themselves someone else's work — or dump their own — via PUT.
  if (req.method === 'PUT' && req.body && typeof req.body === 'object') {
    for (const field of ['agent', 'followupAgent']) {
      if (req.body[field] !== undefined && req.body[field] !== order[field]) {
        return res.status(403).json({ error: 'Only a manager can reassign an order', code: 'FORBIDDEN_FIELD', field });
      }
    }
  }
  next();
});

/* ---------------------------------------------------------------------------
 * Canonical status / call-result sets.
 * The data layer stores status as a free-form string (back-compat), but we
 * validate call results against VALID_RESULTS so the new statuses
 * (tentative1/2/3, unreachable) are first-class everywhere.
 * ------------------------------------------------------------------------- */
const ORDER_STATUSES = [
  'pending', 'no_answer', 'callback', 'confirmed', 'cancelled',
  'tentative1', 'tentative2', 'tentative3', 'unreachable', 'abandoned'
];
const VALID_RESULTS = [
  'no_answer', 'callback', 'confirmed', 'cancelled',
  'tentative1', 'tentative2', 'tentative3', 'unreachable'
];

/* Lightweight structured logger (Render reads stdout). */
function log(level, scope, msg, extra) {
  const line = `[${new Date().toISOString()}] [${level}] [${scope}] ${msg}`;
  console[level === 'error' ? 'error' : 'log'](extra !== undefined ? line + ' ' + JSON.stringify(extra) : line);
}
const logInfo  = (scope, msg, extra) => log('info',  scope, msg, extra);
const logError = (scope, msg, extra) => log('error', scope, msg, extra);

/* ---- SSE (audit ARCH-01) ----
 * A Map of channel -> SET of writers, not channel -> single writer.
 *
 * Previously one connection per name was kept, so a second browser tab evicted
 * the first, and `req.on('close')` deleted the entry regardless of WHICH
 * connection had closed — meaning closing either tab killed live updates for
 * both. Two managers on the dashboard, or one agent on phone and laptop, was a
 * broken state. Each connection now owns its own entry and removes only itself.
 */
const sseClients = new Map();   // channel -> Set<send>

function addSseClient(channel, send) {
  if (!sseClients.has(channel)) sseClients.set(channel, new Set());
  const set = sseClients.get(channel);
  set.add(send);
  return function unsubscribe() {
    set.delete(send);
    if (set.size === 0) sseClients.delete(channel);
  };
}

function sendToChannel(channel, msg) {
  const set = sseClients.get(channel);
  if (set) for (const send of set) send(msg);
}

/**
 * Publish an event.
 * @param {Object} payload  MUST be an object carrying a `type` — clients switch
 *                          on payload.type. Passing the event name as a first
 *                          string argument was audit BUG-04.
 * @param {string|null} target  agent channel, or null to reach everyone.
 */
function broadcast(payload, target = null) {
  if (typeof payload !== 'object' || payload === null) {
    // Loud rather than silent: the previous signature bug produced a bare
    // string frame that clients parsed and then quietly ignored.
    logError('sse', 'broadcast() called with a non-object payload — event dropped', { payload: String(payload) });
    return;
  }
  /* A stored notification carries an `id:` line so the browser records it as
   * Last-Event-ID and can ask for everything after it on reconnect. Transient
   * data-changed events (new_order, call_logged…) deliberately do NOT get an
   * id — they are not replayable and setting one would make the client skip
   * real notifications after a reconnect. */
  const idLine = payload.notificationId ? `id: ${payload.notificationId}\n` : '';
  const msg = `${idLine}data: ${JSON.stringify(payload)}\n\n`;
  if (target) {
    sendToChannel(target, msg);
    if (target !== 'manager') sendToChannel('manager', msg);   // managers see everything
  } else {
    for (const set of sseClients.values()) for (const send of set) send(msg);
  }
}
// Notifications module shares this broadcast fn so stored notifs also push live.
notifications.setBroadcaster(broadcast);

// ---- BOOT: migrate legacy JSON once, then start background sync ----
try {
  db.migrateFromLegacy();
} catch (e) {
  logError('db', 'legacy migration failed (continuing with empty DB)', { err: e.message });
}

// The delivery-outcome backfill (audit BUG-02) runs just after listen() rather
// than here — see the comment at the bottom of this file.

/* ---- Authentication bootstrap (audit SEC-02) ----
 * Rewrites every legacy plaintext password as a scrypt hash, then makes sure a
 * manager account exists so the console is reachable. Both are idempotent. */
async function bootstrapAuth() {
  try {
    await auth.migratePlaintextPasswords(log);
    await auth.ensureManagerAccount(log);
  } catch (e) {
    logError('auth', 'authentication bootstrap failed', { err: e.message, stack: e.stack });
  }
}

/* ---- Webhook signature posture (audit SEC-04) ----
 * Signature checks now fail closed, but only where a secret actually exists.
 * Anything still accepting unsigned payloads is named at boot so the gap is
 * visible rather than implicit. */
try {
  const unsigned = [];
  // rowToStore/rowToProvider mask the secret to '••••' — a non-empty value
  // therefore means "a secret is set", which is all this check needs.
  for (const s of db.getStores()) {
    if (s.webhookEnabled !== false && !s.webhookSecret) unsigned.push(`store:${s.name}`);
  }
  for (const p of db.getProviders()) {
    if (p.webhookEnabled !== false && !p.webhookSecret) unsigned.push(`carrier:${p.name}`);
  }
  if (!SHOPIFY_SECRET) unsigned.push('shopify:/webhook/shopify (SHOPIFY_SECRET unset)');
  if (unsigned.length) {
    logError('security', 'these integrations accept UNSIGNED webhooks — anyone who knows the URL can inject orders or delivery events. Set a webhook secret for each, then set REQUIRE_WEBHOOK_SIGNATURES=1', { unsigned });
  }
} catch (e) { logError('security', 'webhook posture check failed', { err: e.message }); }

// Expired sessions are pruned hourly; the row is only a revocation record, so
// letting them accumulate serves no purpose.
setInterval(() => {
  try {
    const n = db.deleteExpiredSessions();
    if (n) logInfo('auth', 'pruned expired sessions', { count: n });
  } catch (e) { logError('auth', 'session prune failed', { err: e.message }); }
  try {
    // Notifications are a feed, not an audit record — audit_log is that. The
    // table had no retention policy at all and grew forever.
    const n = db.pruneNotifications(Number(process.env.NOTIFICATION_RETENTION) || 5000);
    if (n) logInfo('notifications', 'pruned old notifications', { count: n });
  } catch (e) { logError('notifications', 'prune failed', { err: e.message }); }
}, 60 * 60 * 1000);
jobs.start(broadcast, log);

// Overdue-order reassignment/accountability sweep (spec §4-§7). Runs every
// minute; each run only touches orders that just crossed the configured
// threshold, so a 1-minute cadence is precise enough without extra load.
// (Kept as its own interval rather than folded into jobs.js so this feature
// stays self-contained; safe to move into jobs.js later if preferred.)
// Interval is overridable so the integration tests can drive the sweep without
// waiting a real minute; production always uses the 60s default.
const OVERDUE_SWEEP_INTERVAL_MS = Number(process.env.CRM_SWEEP_INTERVAL_MS) || 60 * 1000;
setInterval(() => {
  try { runOverdueSweep(); } catch (e) { logError('overdue-sweep', 'run failed', { err: e.message, stack: e.stack }); }
}, OVERDUE_SWEEP_INTERVAL_MS);

// ---- DATA HELPERS (thin wrappers over the SQLite layer) ----
// Kept as local functions so the route handlers read almost exactly like before.
function loadData() { return db.loadOrdersData(); }
function loadSettings() { return db.getSettings(); }
function saveSettings(s) { return db.setSettings(s); }
function loadProducts() { return db.getProducts(); }

function normalizePhone(p) {
  if (!p) return '';
  p = String(p).replace(/\s/g, '');
  if (p.startsWith('+213')) return '0' + p.slice(4);
  if (p.startsWith('213')) return '0' + p.slice(3);
  return p;
}

/* ---------------------------------------------------------------------------
 * Algerian standard wilaya code (1-58) -> wilaya name (French spelling).
 * Shopify's address.province often arrives mixed-script (e.g. "جيجل Jijel")
 * via the WebiLeadForm app's custom wilaya dropdown, which the ZR Express
 * adapter cannot reliably name-match. address.province_code (numeric "1"-"58")
 * is reliable, so we resolve from the code first and fall back to the raw
 * province text only if the code is missing or unrecognized.
 * ------------------------------------------------------------------------- */
const WILAYA_CODE_TO_NAME = {
  1: 'Adrar', 2: 'Chlef', 3: 'Laghouat', 4: 'Oum El Bouaghi', 5: 'Batna',
  6: 'Béjaïa', 7: 'Biskra', 8: 'Béchar', 9: 'Blida', 10: 'Bouira',
  11: 'Tamanrasset', 12: 'Tébessa', 13: 'Tlemcen', 14: 'Tiaret', 15: 'Tizi Ouzou',
  16: 'Alger', 17: 'Djelfa', 18: 'Jijel', 19: 'Sétif', 20: 'Saïda',
  21: 'Skikda', 22: 'Sidi Bel Abbès', 23: 'Annaba', 24: 'Guelma', 25: 'Constantine',
  26: 'Médéa', 27: 'Mostaganem', 28: "M'Sila", 29: 'Mascara', 30: 'Ouargla',
  31: 'Oran', 32: 'El Bayadh', 33: 'Illizi', 34: 'Bordj Bou Arréridj', 35: 'Boumerdès',
  36: 'El Tarf', 37: 'Tindouf', 38: 'Tissemsilt', 39: 'El Oued', 40: 'Khenchela',
  41: 'Souk Ahras', 42: 'Tipaza', 43: 'Mila', 44: 'Aïn Defla', 45: 'Naâma',
  46: 'Aïn Témouchent', 47: 'Ghardaïa', 48: 'Relizane', 49: 'Timimoun',
  50: 'Bordj Badji Mokhtar', 51: 'Ouled Djellal', 52: 'Béni Abbès', 53: 'In Salah',
  54: 'In Guezzam', 55: 'Touggourt', 56: 'Djanet', 57: "M'Ghair", 58: 'El Meniaa',
};
function wilayaCodeToName(code) {
  const n = parseInt(code, 10);
  if (!n || !WILAYA_CODE_TO_NAME[n]) return '';
  return WILAYA_CODE_TO_NAME[n];
}
/** WebiLeadForm sends mixed-script values like "Jijel جيجل" — keep only the
 *  Latin-script part so downstream name-matching (ZR Express search) works. */
function stripArabic(s) {
  if (!s) return '';
  return String(s).replace(/[\u0600-\u06FF\s]+$/g, '').replace(/^[\u0600-\u06FF\s]+/g, '').trim();
}
function genId(orders) {
  // Collision-safe: length-based start, then bump until free (deletes can
  // otherwise recycle a primary key and crash the INSERT).
  let n = orders.length + 1, id;
  do { id = 'ORD-' + String(n++).padStart(4, '0'); } while (db.getOrder(id));
  return id;
}
function genProdId(products) {
  let n = products.length + 1, id;
  do { id = 'PRD-' + String(n++).padStart(3, '0'); } while (db.getProduct(id));
  return id;
}

/* Shopify webhook signature (audit SEC-04).
 *
 * `if (!SHOPIFY_SECRET) return true` is retained deliberately: this endpoint
 * predates the multi-store registry and many deployments run it with no secret
 * configured, so demanding one unconditionally would drop every live order on
 * the next deploy. What IS fixed is the bypass — with a secret configured, a
 * missing header is now a rejection rather than a pass. Set
 * REQUIRE_WEBHOOK_SIGNATURES=1 (and SHOPIFY_SECRET) to refuse unsigned
 * payloads entirely; that is the recommended production setting. */
function verifyHmac(body, header) {
  const strict = /^(1|true|yes)$/i.test(String(process.env.REQUIRE_WEBHOOK_SIGNATURES || ''));
  if (!SHOPIFY_SECRET) {
    if (strict) {
      logError('shopify', 'refused an unsigned webhook — SHOPIFY_SECRET is not set and REQUIRE_WEBHOOK_SIGNATURES is on');
      return false;
    }
    return true;
  }
  if (!header) return false;   // the bypass: previously an absent header passed
  const expected = crypto.createHmac('sha256', SHOPIFY_SECRET).update(body).digest('base64');
  const a = Buffer.from(String(header), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Decide which agent a new order should go to.
 * Returns "" when auto-assign is off, when there are no agents, or on error —
 * and ALWAYS explains its decision in the logs so failures are diagnosable.
 *
 * NOTE: callers must treat empty-string as "not assigned" (do NOT bypass this
 * when the inbound agent is "" — that was the original bug).
 */
/** Today's day-of-week (0=Sunday..6=Saturday) in Algeria local time — same
 *  fixed UTC+1 shift already used by computeEligibleAt/isWithinWorkingHours
 *  further below, so an agent's weekly day off lines up with the same
 *  calendar day the manager and agents actually see, not the server's own
 *  (likely UTC) day. Algeria has no DST, so a flat +1h shift is exact
 *  year-round (verified in computeEligibleAt's own comment). */
function algeriaDayOfWeek(ts = Date.now()) {
  return new Date(ts + 60 * 60 * 1000).getUTCDay();
}

/** True when this agent's recurring weekly schedule marks TODAY as a day
 *  off — auto-assign and the overdue-sweep's reassignment pool both use
 *  this so no new order (initial or reassigned) ever lands on an agent's
 *  day off, automatically, every week, with no manager action needed. */
function isAgentOffToday(agent, ts = Date.now()) {
  const days = Array.isArray(agent.weeklyDaysOff) ? agent.weeklyDaysOff : [];
  return days.includes(algeriaDayOfWeek(ts));
}

function autoAssign() {
  try {
    const s = loadSettings();
    const data = loadData();
    // Only non-suspended agents whose role can handle confirmation-stage
    // orders, and who are not on their day off TODAY, are eligible — a
    // suspended agent must never receive new work, and a followup-only
    // agent isn't part of this pipeline.
    const agents = (data.agents || []).filter(a => !a.suspended && (a.role === 'confirmation' || a.role === 'both' || !a.role) && !isAgentOffToday(a));
    if (!s.autoAssign) {
      logInfo('auto-assign', 'skipped — autoAssign is disabled in settings');
      return '';
    }
    if (!agents.length) {
      logInfo('auto-assign', 'skipped — no eligible (non-suspended, confirmation-capable) agents configured');
      return '';
    }
    const activeStatuses = ['pending', 'no_answer', 'callback', 'tentative1', 'tentative2', 'tentative3', 'unreachable'];
    const counts = {};
    agents.forEach(a => counts[a.name] = 0);
    (data.orders || []).forEach(o => {
      if (activeStatuses.includes(o.status) && counts[o.agent] !== undefined) counts[o.agent]++;
    });
    const chosen = agents.reduce((min, a) => counts[a.name] < counts[min.name] ? a : min, agents[0]).name;
    logInfo('auto-assign', 'assigned', { chosen, load: counts });
    return chosen;
  } catch (e) {
    logError('auto-assign', 'failed, leaving order unassigned', { err: e.message });
    return '';
  }
}


/* A new order is the single most important thing that happens in this system,
 * and it was broadcast only — so it disappeared on refresh, and anything that
 * arrived while the console was closed was never seen at all. Raised through
 * notifications.push() it is stored, replayable and counted by the badge.
 * `extra` carries the full order object the client's existing handler expects. */
function notifyNewOrder(saved, agent, kind = 'new_order') {
  notifications.push({
    type: kind,
    title: kind === 'abandoned_cart' ? '🛒 Panier abandonné' : '🆕 Nouvelle commande',
    body: [saved.client, saved.phone].filter(Boolean).join(' — '),
    orderId: saved.id,
    target: agent || notifications.EVERYONE,
    extra: { order: saved },
  });
}

/** Resolve the agent for an inbound order: explicit non-empty value wins, else auto-assign. */
function resolveAgent(requestedAgent) {
  if (requestedAgent && String(requestedAgent).trim() !== '') return requestedAgent;
  return autoAssign();
}

/**
 * Create the delivery shipment for a just-confirmed order, if enabled and not
 * already created. Failures are logged + notified but never block the confirm
 * (the agent already recorded the call result) — shipment creation is retried
 * or done manually later.
 */
async function tryAutoCreateShipment(order, actor) {
  const s = loadSettings();
  if (!s.autoCreateShipment) return null;
  try {
    const shipment = await providers.createShipmentForOrder(order, { actor });
    logInfo('shipment', 'auto-created on confirm', { orderId: order.id, shipmentId: shipment.id, tracking: shipment.trackingNumber });
    notifications.push({
      type: 'shipment_created',
      title: '📦 Shipment created',
      body: [order.id, shipment.trackingNumber].filter(Boolean).join(' · '),
      orderId: order.id,
      shipmentId: shipment.id,
      target: order.agent || notifications.MANAGER_ONLY,
    });
    broadcast({ type: 'shipment_created', orderId: order.id, shipmentId: shipment.id, trackingNumber: shipment.trackingNumber }, order.agent || null);
    return shipment;
  } catch (e) {
    logError('shipment', 'auto-create failed (order stays confirmed, no shipment)', { orderId: order.id, err: e.message });
    notifications.push({
      type: 'shipment_failed',
      title: '⚠️ Shipment creation failed',
      body: [order.id, e.message].filter(Boolean).join(' · '),
      orderId: order.id,
      target: order.agent || notifications.MANAGER_ONLY,
    });
    return null;
  }
}

/**
 * Overdue reassignment + accountability sweep (Confirmation Agent Dashboard
 * spec §4-§7). Runs on a timer (see setInterval near boot, below). For every
 * order that has sat with an agent for longer than settings.reassignMinutes
 * with zero calls logged and no call in progress:
 *   1. ALWAYS: increments that agent's permanent missedOrders counter,
 *      notifies the manager (manager-only — never broadcast to agents),
 *      writes an audit entry, and flags the order so this SAME timeout is
 *      never counted twice.
 *   2. IF settings.autoReassign is on: hands the order to the next eligible,
 *      non-suspended confirmation agent (least-loaded among candidates), or
 *      — if none are available — clears its agent so it lands in the
 *      "Unassigned Overdue Orders" queue (any order with agent:'' and
 *      overdueFlaggedAt set; distinguishes it from an order that was simply
 *      never assigned in the first place).
 *   3. IF the agent's missedOrders now meets settings.suspendThreshold AND
 *      settings.autoSuspend is on: suspends the agent's account (blocks
 *      login; existing assignments are left untouched).
 * When autoReassign is off, the order stays with the same agent (spec §5)
 * but is still flagged so the counter/alert fire exactly once per timeout.
 */
/** True when `ts` falls within the manager-configured working-hours window,
 *  evaluated in Algeria local time (Africa/Algiers, fixed UTC+1, no DST) —
 *  NOT the server's own timezone, which on Render defaults to UTC. Uses
 *  hourCycle:'h23' explicitly since hour12:false alone can report midnight
 *  as "24" instead of "0" in some ICU builds. */
function isWithinWorkingHours(settings, ts = Date.now()) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Algiers', hour: 'numeric', hourCycle: 'h23' }).format(ts));
  const start = Number(settings.workHoursStart);
  const end = Number(settings.workHoursEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return true; // misconfigured — fail open, don't silently disable the feature
  if (end <= start) {
    // Invalid range (e.g. "10 to 9") — mathematically matches no hour at
    // all, which would silently disable reassignment/suspension entirely
    // with zero visible symptom. Fail OPEN (act as if always working hours)
    // rather than fail closed, and log loudly so this misconfiguration is
    // actually discoverable instead of looking like a different bug.
    logError('overdue-sweep', 'workHoursEnd must be greater than workHoursStart — ignoring the working-hours restriction until fixed', { workHoursStart: start, workHoursEnd: end });
    return true;
  }
  return hour >= start && hour < end;
}

// Africa/Algiers is a FIXED UTC+1 offset year-round (no daylight saving),
// verified earlier — this lets us do exact local-calendar-day arithmetic
// with plain Date.UTC() by shifting into "local-as-if-UTC" milliseconds,
// rather than fighting the server's own (likely UTC) timezone.
const ALGERIA_UTC_OFFSET_MS = 60 * 60 * 1000;

/** The exact moment a given order becomes eligible for the overdue sweep.
 *  - Created DURING working hours: the plain, original rule — createdAt +
 *    reassignMinutes (unchanged from before).
 *  - Created OUTSIDE working hours (the night case): NOT counted from
 *    creation time at all (that would catch it almost instantly once the
 *    working-hours gate reopens, since it already sat all night) — instead
 *    eligible at (the next working-hours-start + nightGraceMinutes), per
 *    the manager's explicit request. */
function computeEligibleAt(createdAt, settings) {
  const start = Number(settings.workHoursStart);
  const end = Number(settings.workHoursEnd);
  const reassignMs = (Number(settings.reassignMinutes) || 5) * 60000;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return createdAt + reassignMs; // working hours misconfigured — fall back to the simple rule
  }
  const localMs = createdAt + ALGERIA_UTC_OFFSET_MS;
  const localDate = new Date(localMs);
  const hour = localDate.getUTCHours();

  if (hour >= start && hour < end) {
    return createdAt + reassignMs; // created during working hours — normal rule
  }

  const graceMs = (Number(settings.nightGraceMinutes) || 120) * 60000;
  const dayStartLocal = Date.UTC(localDate.getUTCFullYear(), localDate.getUTCMonth(), localDate.getUTCDate(), start, 0, 0, 0);
  const nextStartLocal = hour >= end ? dayStartLocal + 24 * 3600000 : dayStartLocal;
  const nextStartUtc = nextStartLocal - ALGERIA_UTC_OFFSET_MS;
  return nextStartUtc + graceMs;
}

function runOverdueSweep() {
  const s = loadSettings();
  if (!isWithinWorkingHours(s)) return; // nobody's expected to be working — never count/act outside this window
  let candidates;
  try { candidates = db.listOverdueUnansweredOrders(); }
  catch (e) { logError('overdue-sweep', 'query failed', { err: e.message }); return; }
  const now = Date.now();
  const overdue = candidates.filter(o => now >= computeEligibleAt(o.createdAt, s));
  if (!overdue.length) return;

  for (const order of overdue) {
    const originalAgent = order.agent;
    const newCount = db.incrementMissedOrders(originalAgent);
    // How long this order actually sat with no call logged, and the threshold
    // that was in force at the time. `minutes` used to be referenced here
    // without ever being declared anywhere in this file, so EVERY sweep threw
    // ReferenceError on its first overdue order — the interval below caught and
    // logged it, so the only symptom was that reassignment, the missed-order
    // alert and auto-suspend never happened at all. Recording the threshold
    // alongside the elapsed time means an old audit entry stays explicable even
    // after the setting is changed (same reasoning as call.threshold).
    const minutes = Math.round((now - (order.createdAt || now)) / 60000);
    db.audit('order', order.id, 'overdue_missed', 'system', {
      agent: originalAgent, minutes, thresholdMinutes: Number(s.reassignMinutes) || 5, missedOrders: newCount,
    });
    // MANAGER_ONLY, not null. `target: null` meant "everyone", so this alert
    // about an agent's own missed order was stored for that agent to read.
    // push() already broadcasts; the extra broadcast() here was a duplicate
    // that arrived without a notificationId and so could not be replayed.
    notifications.push({
      type: 'agent_overdue',
      title: '🚨 Overdue order',
      body: order.id + ' · ' + originalAgent + ' (' + newCount + ' missed)',
      orderId: order.id,
      target: notifications.MANAGER_ONLY,
    });

    if (s.autoReassign) {
      try {
        const allAgents = db.getAgents();
        const confirmationAgents = db.getAgentsByRole('confirmation');
        const candidates = confirmationAgents.filter(a => a.name !== originalAgent && !a.suspended && !isAgentOffToday(a));
        // Diagnostic log — shows exactly what the sweep saw at decision time,
        // so a failed reassignment can be root-caused from Render logs
        // instead of guessed at.
        logInfo('overdue-sweep', 'reassign candidate check', {
          orderId: order.id, originalAgent,
          allAgents: allAgents.map(a => ({ name: a.name, role: a.role, suspended: a.suspended })),
          confirmationRoleCount: confirmationAgents.length,
          eligibleCandidates: candidates.map(a => a.name),
        });
        if (candidates.length) {
          const data = loadData();
          const counts = {};
          candidates.forEach(a => counts[a.name] = 0);
          (data.orders || []).forEach(o => { if (o.status === 'pending' && counts[o.agent] !== undefined) counts[o.agent]++; });
          const chosen = candidates.reduce((min, a) => counts[a.name] < counts[min.name] ? a : min, candidates[0]).name;
          db.patchOrder(order.id, { agent: chosen, overdueFlaggedAt: null });
          db.audit('order', order.id, 'auto_reassign', 'system', { from: originalAgent, to: chosen });
          broadcast({ type: 'order_assigned', order: db.getOrder(order.id) }, chosen);
          sendPushToAgent(chosen, { title: '📦 طلب جديد', body: order.id + ' — ' + (order.client || '') });
          logInfo('overdue-sweep', 'reassigned', { orderId: order.id, from: originalAgent, to: chosen });
        } else {
          db.patchOrder(order.id, { agent: '', overdueFlaggedAt: Date.now() });
          db.audit('order', order.id, 'moved_to_unassigned_queue', 'system', { from: originalAgent });
          logInfo('overdue-sweep', 'moved to unassigned queue (no eligible agent)', { orderId: order.id, from: originalAgent });
        }
      } catch (e) {
        logError('overdue-sweep', 'reassignment step crashed — order left as-is, will retry next sweep', { orderId: order.id, err: e.message, stack: e.stack });
      }
    } else {
      db.patchOrder(order.id, { overdueFlaggedAt: Date.now() });
    }

    if (s.autoSuspend && newCount >= (Number(s.suspendThreshold) || 5)) {
      const current = db.getAgents().find(a => a.name === originalAgent);
      if (current && !current.suspended) {
        db.suspendAgent(originalAgent);
        // Same revocation the manual suspend route performs — otherwise an
        // auto-suspended agent keeps working until their cookie expires.
        try { auth.destroySessionsFor(originalAgent); } catch (e) { logError('auth', 'session revoke on auto-suspend failed', { agent: originalAgent, err: e.message }); }
        db.audit('agent', originalAgent, 'auto_suspend', 'system', { missedOrders: newCount, threshold: s.suspendThreshold });
        notifications.push({
          type: 'agent_suspended',
          title: '⛔ Agent auto-suspended',
          body: originalAgent + ' — ' + newCount + ' missed orders',
          target: notifications.MANAGER_ONLY,
        });
        logInfo('overdue-sweep', 'agent auto-suspended', { agent: originalAgent, missedOrders: newCount });
      }
    }
  }
}

/* =============================================================================
 * AUTHENTICATION (audit SEC-01, SEC-02).
 *
 * There was previously no login endpoint anywhere in this codebase. The agent
 * PWA fetched GET /api/agents — which returned every password in cleartext —
 * and compared the password in the browser; the manager console had no login at
 * all. Both are now real server-side sessions.
 * ========================================================================== */
const cookieOpts = () => ({ crossSite: CROSS_SITE, secure: process.env.NODE_ENV === 'production' });

/** Deliberately uniform failure: never reveal whether the account exists. */
const BAD_CREDENTIALS = { error: 'Incorrect name or password', code: 'BAD_CREDENTIALS' };

app.post('/api/auth/login', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const password = String(req.body?.password ?? req.body?.pass ?? '');
  if (!name) return res.status(400).json({ error: 'name required' });

  const account = db.getAgentRaw(name);
  if (!account) {
    // Spend comparable time on a miss so response timing does not enumerate
    // valid account names.
    await auth.verifyAgainstDecoy(password);
    logError('auth', 'login failed — unknown account', { name });
    return res.status(401).json(BAD_CREDENTIALS);
  }
  if (!(await auth.verifyPassword(password, account.pass))) {
    logError('auth', 'login failed — wrong password', { name });
    return res.status(401).json(BAD_CREDENTIALS);
  }
  if (account.suspended) {
    logInfo('auth', 'login refused — account suspended', { name });
    return res.status(403).json({ error: 'This account is suspended. Please contact your manager.', code: 'SUSPENDED' });
  }

  const token = auth.createSession(name, {
    userAgent: req.headers['user-agent'], ip: req.ip,
  });
  db.audit('agent', name, 'login', name, {});
  res.setHeader('Set-Cookie', auth.buildSessionCookie(token, cookieOpts()));
  logInfo('auth', 'login', { name, accountRole: account.accountRole || 'agent' });
  res.json({
    ok: true,
    // Returned as well as set as a cookie so a non-browser client, or a client
    // on an origin where third-party cookies are blocked, can use the Bearer
    // header instead.
    token,
    user: {
      name: account.name,
      role: account.role || 'confirmation',
      accountRole: account.accountRole || 'agent',
      isManager: (account.accountRole || 'agent') === 'manager',
    },
  });
});

app.post('/api/auth/logout', (req, res) => {
  auth.destroySession(auth.tokenFromRequest(req));
  res.setHeader('Set-Cookie', auth.buildClearCookie(cookieOpts()));
  res.json({ ok: true });
});

/** Who am I? Used by both clients on boot to decide login screen vs app. */
app.get('/api/auth/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not signed in', code: 'UNAUTHENTICATED' });
  res.json({ ok: true, user: req.user });
});

/** Change your own password. Requires the current one — a stolen session alone
 *  must not be enough to take over the account permanently. */
app.post('/api/auth/change-password', auth.requireAuth, async (req, res) => {
  const current = String(req.body?.currentPassword ?? '');
  const next = String(req.body?.newPassword ?? '');
  if (next.length < 6) return res.status(400).json({ error: 'The new password must be at least 6 characters', code: 'WEAK_PASSWORD' });

  const account = db.getAgentRaw(req.user.name);
  if (!account || !(await auth.verifyPassword(current, account.pass))) {
    return res.status(401).json({ error: 'Current password is incorrect', code: 'BAD_CREDENTIALS' });
  }
  db.setAgentPasswordHash(req.user.name, await auth.hashPassword(next), true);
  db.audit('agent', req.user.name, 'change_password', req.user.name, {});

  // Every other session for this account is dropped, then a fresh one issued —
  // changing your password is how you evict someone who already has access.
  auth.destroySessionsFor(req.user.name);
  const token = auth.createSession(req.user.name, { userAgent: req.headers['user-agent'], ip: req.ip });
  res.setHeader('Set-Cookie', auth.buildSessionCookie(token, cookieOpts()));
  res.json({ ok: true, token });
});

/** Manager-only: set another account's password (a forgotten-password reset). */
app.post('/api/agents/:name/password', auth.requireManager, async (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const next = String(req.body?.newPassword ?? '');
  if (!db.getAgentRaw(name)) return res.status(404).json({ error: 'Not found' });
  if (next.length < 6) return res.status(400).json({ error: 'The new password must be at least 6 characters', code: 'WEAK_PASSWORD' });
  db.setAgentPasswordHash(name, await auth.hashPassword(next), true);
  auth.destroySessionsFor(name);   // force them to sign in again
  db.audit('agent', name, 'password_reset_by_manager', req.user.name, {});
  res.json({ ok: true });
});

/** Manager-only: grant or revoke manager privilege. */
app.put('/api/agents/:name/account-role', auth.requireManager, (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const accountRole = req.body?.accountRole;
  if (!['agent', 'manager'].includes(accountRole)) {
    return res.status(400).json({ error: 'invalid accountRole', valid: ['agent', 'manager'] });
  }
  if (!db.getAgentRaw(name)) return res.status(404).json({ error: 'Not found' });
  // Refuse to remove the last manager — that would lock everyone out of the
  // console with no way back in short of editing the database by hand.
  if (accountRole === 'agent' && db.countManagers() <= 1) {
    return res.status(400).json({ error: 'This is the only manager account — promote someone else first', code: 'LAST_MANAGER' });
  }
  db.setAccountRole(name, accountRole);
  db.audit('agent', name, 'set_account_role', req.user.name, { accountRole });
  res.json({ ok: true, name, accountRole });
});

// ---- HEALTH ----
app.get('/', (req, res) => res.json({ status: 'ok', message: 'CRM Server running', time: new Date().toISOString() }));
app.get('/api/statuses', (req, res) => res.json({ order: ORDER_STATUSES, results: VALID_RESULTS }));

/* ---- SSE SUBSCRIBE ----
 * The subscriber identity now comes from the SESSION, not from `?agent=`
 * (audit SEC-01/ARCH-01). Previously anyone could subscribe as "manager" and
 * receive the live order feed — and because the client map held one writer per
 * name, doing so also silently evicted the real manager's stream.
 *
 * A manager still sees everything; an agent sees only their own channel.
 * EventSource cannot set an Authorization header, so lib/auth.js also accepts
 * ?token= for exactly this route's benefit. */
app.get('/api/notifications/subscribe', (req, res) => {
  const channel = req.user.isManager ? 'manager' : req.user.name;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');   // stop reverse proxies buffering the stream
  res.flushHeaders();
  const send = (msg) => { try { res.write(msg); } catch (e) { logError('sse', 'write failed', { channel, err: e.message }); } };

  /* Replay anything stored while this client was disconnected.
   *
   * An SSE connection drops constantly in normal use — a phone locking, a
   * tunnel timing out, a redeploy — and EventSource reconnects silently. Every
   * notification raised in that window used to be lost from the live feed, and
   * because nothing read the table, lost entirely. The browser sends back the
   * last id it saw in the Last-Event-ID header; ?lastEventId= covers clients
   * that reconnect by opening a fresh EventSource instead. */
  const lastSeen = Number(req.headers['last-event-id'] || req.query.lastEventId || 0);
  send(`data: ${JSON.stringify({ type: 'connected', channel, replayFrom: lastSeen || null })}\n\n`);
  if (lastSeen > 0) {
    try {
      const missed = db.getNotificationsSince(req.user, lastSeen);
      for (const n of missed) {
        send(`id: ${n.id}\ndata: ${JSON.stringify({
          type: n.type ? 'notif_' + n.type : 'notification',
          notificationId: n.id, notifType: n.type, title: n.title, body: n.body,
          orderId: n.orderId, shipmentId: n.shipmentId, time: n.createdAt, replayed: true,
        })}\n\n`);
      }
      if (missed.length) logInfo('sse', 'replayed missed notifications', { channel, count: missed.length, since: lastSeen });
    } catch (e) {
      logError('sse', 'replay failed', { channel, err: e.message });
    }
  }

  const unsubscribe = addSseClient(channel, send);
  // Keep-alive comment frame: proxies and mobile networks drop idle connections.
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* gone */ } }, 25000);
  req.on('close', () => { clearInterval(ping); unsubscribe(); });
});

// ---- SHOPIFY WEBHOOK ----
app.post('/webhook/shopify', (req, res) => {
  if (!verifyHmac(req.body, req.headers['x-shopify-hmac-sha256'])) {
    logError('shopify', 'webhook HMAC verification failed');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  let order;
  try { order = JSON.parse(req.body.toString()); }
  catch { logError('shopify', 'webhook bad JSON'); return res.status(400).json({ error: 'Bad JSON' }); }

  // Abandoned checkouts carry a DIFFERENT payload shape (no order id, no
  // financial_status) — route them to their own handler so they land as
  // 'abandoned' cart rows instead of being force-fit into the order pipeline.
  const topic = String(req.headers['x-shopify-topic'] || '').toLowerCase();
  if (topic === 'checkouts/create' || topic === 'checkouts/update') {
    return handleAbandonedCheckout(order, res);
  }
  if (topic === 'draft_orders/create') {
    return handleDraftOrder(order, res);
  }
  if (topic === 'products/create') {
    return handleShopifyProductCreate(order, res);
  }

  const data = loadData();
  const existingOrder = data.orders.find(o => o.shopifyId === String(order.id));
  if (existingOrder) {
    // A later Shopify webhook for an order we already imported (e.g. the
    // WebiLeadForm app attaches the wilaya/commune custom fields to the order
    // a few seconds AFTER the initial orders/create webhook fires, so the
    // first webhook we see often has empty address.province/province_code).
    // Re-resolve the address from this newer payload and patch only the
    // address fields if we now have better data than what's stored.
    const billing2 = order.billing_address || {};
    const shipping2 = order.shipping_address || {};
    const addr2 = shipping2.address1 ? shipping2 : billing2;
    const newWilaya = wilayaCodeToName(addr2.province_code) || addr2.province || '';
    const newCommune = addr2.city || '';
    const patch = {};
    if (newWilaya && !existingOrder.wilaya) patch.wilaya = newWilaya;
    if (newCommune && !existingOrder.commune) patch.commune = newCommune;
    if (Object.keys(patch).length) {
      db.patchOrder(existingOrder.id, patch);
      logInfo('shopify', 'address patched from later webhook', { id: existingOrder.id, shopifyId: order.id, patch });
    } else {
      logInfo('shopify', 'duplicate webhook ignored (nothing new to patch)', { shopifyId: order.id });
    }
    return res.status(200).json({ message: 'duplicate' });
  }

  const billing = order.billing_address || {};
  const shipping = order.shipping_address || {};
  const addr = shipping.address1 ? shipping : billing;
  const phone = normalizePhone(order.phone || billing.phone || shipping.phone || '');
  const client = addr.name || billing.name || order.email || 'Client';

  const lineItems = (order.line_items || []).map(item => ({
    name: item.name,
    variant: item.variant_title || '',
    quantity: item.quantity || 1,
    unitPrice: parseFloat(item.price || 0),
    total: parseFloat(item.price || 0) * (item.quantity || 1)
  }));

  // Draft Orders and completed Orders get UNRELATED Shopify IDs (no shared
  // numbering), so a customer who starts a Draft (captured the moment they
  // type their phone number) and later completes it into a real order would
  // otherwise land in the CRM as two separate rows. If an earlier, still-
  // untouched (status still 'pending') row exists for this exact phone
  // number within the last 2 hours, treat this new order as that same
  // customer finishing up: drop the earlier row AND keep its SAME agent —
  // running a fresh auto-assign here would hand the completed order to a
  // different agent than the one who already had the lead, which is the
  // "draft goes to agent A, completed order jumps to agent B" bug.
  let agent;
  let staleLead = null;
  if (phone) {
    staleLead = data.orders.find(o =>
      o.status === 'pending' &&
      o.phone === phone &&
      o.shopifyId !== String(order.id) &&
      (Date.now() - (o.createdAt || 0)) < 2 * 60 * 60 * 1000
    );
  }
  if (staleLead) {
    agent = staleLead.agent || resolveAgent('');
    db.deleteOrder(staleLead.id);
    logInfo('shopify', 'merged completed order over stale pending lead (same phone, kept same agent)', { staleId: staleLead.id, phone, newShopifyId: String(order.id), agent });
  } else {
    agent = resolveAgent('');   // Shopify orders are never pre-assigned
  }

  // WebiLeadForm writes its custom wilaya/commune dropdown selections into
  // order.note_attributes (shown as "Additional details" in Shopify admin),
  // NOT into the standard shipping_address.province/city fields — those stay
  // null for every WebiLeadForm order. note_attributes IS present from the
  // very first orders/create webhook (no timing issue), so this is a direct
  // fix rather than a wait-and-retry workaround.
  const noteAttrs = Array.isArray(order.note_attributes) ? order.note_attributes : [];
  function getNoteAttr(name) {
    const hit = noteAttrs.find(a => String(a.name || '').toLowerCase() === name.toLowerCase());
    return hit ? String(hit.value || '').trim() : '';
  }
  const noteProvinceCode = getNoteAttr('Province Code');
  const noteProvince     = getNoteAttr('Province');
  const noteCommune      = getNoteAttr('Commune');

  const resolvedWilaya  = wilayaCodeToName(noteProvinceCode) || stripArabic(noteProvince) || wilayaCodeToName(addr.province_code) || addr.province || '';
  const resolvedCommune = noteCommune || addr.city || '';

  // Was three DEBUG lines dumping the raw address block and every
  // note_attribute — i.e. customer PII — to stdout on every inbound order,
  // marked "temporary" and shipped anyway. What made them useful for
  // diagnosing the WebiLeadForm wilaya problem was knowing WHICH fields
  // arrived and whether resolution succeeded, not their contents.
  if (!resolvedWilaya) {
    logInfo('shopify', 'address resolution incomplete', {
      shopifyId: String(order.id),
      sawProvinceCode: !!addr.province_code, sawProvince: !!addr.province,
      noteAttributeNames: noteAttrs.map(a => a.name),
      resolvedCommune: !!resolvedCommune,
    });
  }

  const newOrder = {
    id: genId(data.orders),
    shopifyId: String(order.id),
    shopifyName: order.name || '',
    client, phone,
    city: addr.city || '',
    wilaya: resolvedWilaya,
    commune: resolvedCommune,
    lineItems,
    product: lineItems[0]?.name || '',
    productVariant: lineItems[0]?.variant || '',
    shopifyProductId: order.line_items?.[0]?.product_id ? String(order.line_items[0].product_id) : null,
    shopifyVariantId: order.line_items?.[0]?.variant_id ? String(order.line_items[0].variant_id) : null,
    quantity: lineItems[0]?.quantity || 1,
    unitPrice: lineItems[0]?.unitPrice || 0,
    price: parseFloat(order.total_price || 0),
    subtotal: parseFloat(order.subtotal_price || 0),
    discount: parseFloat(order.total_discounts || 0),
    shippingCost: parseFloat(order.total_shipping_price_set?.shop_money?.amount || 0),
    agent,
    delivery: 'zr',
    deliveryMethod: 'COD',
    expressDelivery: false,
    status: 'pending',
    deliveryStatus: '',
    trackingNumber: '',
    managerNote: '',
    shippingNote: '',
    note: order.note || '',
    createdAt: Date.now(),
    shopifyCreatedAt: order.created_at || null,
    source: 'shopify'
  };

  const saved = db.insertOrder(newOrder);
  logInfo('shopify', 'order imported', { id: newOrder.id, agent });
  // Inventory: reserve stock immediately if the policy is 'immediate' (req §9).
  try { inventory.reserveOnOrder(saved, 'system'); }
  catch (e) { logError('inventory', 'reserve on import failed', { orderId: saved.id, err: e.message }); }
  notifyNewOrder(saved, agent);
  if (agent) sendPushToAgent(agent, { title: '📦 طلب جديد', body: saved.id + ' — ' + (saved.client || '') });

  res.status(200).json({ message: 'received', id: newOrder.id, agent });
});

/**
 * Handle Shopify's checkouts/create and checkouts/update webhook topics.
 * A "checkout" only becomes a real order once the customer pays; until then
 * Shopify fires checkouts/update on nearly every field change (email typed,
 * address filled in, etc.), so this UPSERTS by checkout id instead of
 * inserting a fresh row per webhook — otherwise one visitor abandoning their
 * cart would flood the CRM with dozens of duplicate "abandoned" rows.
 */
function handleAbandonedCheckout(checkout, res) {
  const billing = checkout.billing_address || {};
  const shipping = checkout.shipping_address || {};
  const addr = shipping.address1 ? shipping : billing;
  const phone = normalizePhone(checkout.phone || billing.phone || shipping.phone || '');
  const client = addr.name || billing.name || checkout.email || (phone ? 'Client' : '');

  // No usable contact info yet (visitor just landed on checkout, hasn't
  // typed anything) — nothing worth tracking, acknowledge and skip.
  if (!client && !phone) {
    return res.status(200).json({ message: 'skipped (no contact info yet)' });
  }

  const lineItems = (checkout.line_items || []).map(item => ({
    name: item.title || item.name || '',
    variant: item.variant_title || '',
    quantity: item.quantity || 1,
    unitPrice: parseFloat(item.price || 0),
    total: parseFloat(item.price || 0) * (item.quantity || 1),
  }));

  // Same WebiLeadForm custom-field extraction used for real orders above —
  // checkout-level note_attributes carry the wilaya/commune dropdown
  // selections before the checkout ever becomes a real order.
  const noteAttrs = Array.isArray(checkout.note_attributes) ? checkout.note_attributes : [];
  function getNoteAttr(name) {
    const hit = noteAttrs.find(a => String(a.name || '').toLowerCase() === name.toLowerCase());
    return hit ? String(hit.value || '').trim() : '';
  }
  const noteProvinceCode = getNoteAttr('Province Code');
  const noteProvince     = getNoteAttr('Province');
  const noteCommune      = getNoteAttr('Commune');

  const resolvedWilaya  = wilayaCodeToName(noteProvinceCode) || stripArabic(noteProvince) || wilayaCodeToName(addr.province_code) || addr.province || '';
  const resolvedCommune = noteCommune || addr.city || '';

  const checkoutId = String(checkout.id || checkout.token || '');
  const existing = checkoutId
    ? db.findOrder(o => o.shopifyId === checkoutId && o.source === 'shopify_abandoned')
    : null;

  const fields = {
    client: client || 'Client',
    phone,
    product: lineItems[0]?.name || '',
    productVariant: lineItems[0]?.variant || '',
    quantity: lineItems[0]?.quantity || 1,
    price: parseFloat(checkout.total_price || 0),
    wilaya: resolvedWilaya,
    commune: resolvedCommune,
  };

  if (existing) {
    // checkouts/update — patch with whatever new info arrived, never
    // overwriting an already-filled field with an empty one.
    const patch = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v && !existing[k]) patch[k] = v;
    }
    if (Object.keys(patch).length) {
      db.patchOrder(existing.id, patch);
      logInfo('abandoned', 'cart updated from checkout webhook', { id: existing.id, checkoutId, patch });
    } else {
      logInfo('abandoned', 'checkout webhook ignored (nothing new to patch)', { checkoutId });
    }
    return res.status(200).json({ message: 'updated', id: existing.id });
  }

  const agent = resolveAgent('');
  const data = loadData();
  const cart = {
    id: genId(data.orders),
    shopifyId: checkoutId,
    shopifyName: checkout.name || '',
    ...fields,
    agent,
    orderType: 'abandoned',
    status: 'abandoned',
    note: checkout.note || '', managerNote: '',
    delivery: 'zr', deliveryStatus: '', trackingNumber: '',
    source: 'shopify_abandoned',
    createdAt: Date.now(),
  };
  const saved = db.insertOrder(cart);
  logInfo('abandoned', 'cart imported from checkout webhook', { id: cart.id, checkoutId, agent });
  notifyNewOrder(saved, agent, 'abandoned_cart');
  return res.status(200).json({ message: 'received', id: cart.id, agent });
}

/**
 * Handle Shopify's draft_orders/create webhook topic (e.g. from the WEBI
 * LeadForm app, which writes leads directly as Draft Orders).
 *
 * Deliberately built to be a FULL member of the normal order pipeline:
 * status starts at 'pending' — exactly like a regular Shopify order — so it
 * is picked up by auto-assign, ages into overdue follow-ups on the same
 * clock, and (once an agent confirms it) triggers automatic shipment
 * creation via tryAutoCreateShipment exactly like any other confirmed order.
 * orderType: 'draft' / source: 'shopify_draft' exist ONLY so the CRM's order
 * card can show a "Draft Order" badge instead of "Commande normale" — they
 * carry no special-case behavior anywhere else in the pipeline.
 *
 * If a draft is missing fields (wilaya, commune, phone…) because the lead
 * form captured less than a full checkout would, the agent fills them in via
 * the existing "Modifier" order screen before confirming — no new UI needed.
 */
function handleDraftOrder(draft, res) {
  const draftId = String(draft.id || '');
  const existing = draftId
    ? db.findOrder(o => o.shopifyId === draftId && o.orderType === 'draft')
    : null;
  if (existing) {
    return res.status(200).json({ message: 'duplicate', id: existing.id });
  }

  const billing = draft.billing_address || {};
  const shipping = draft.shipping_address || {};
  const addr = shipping.address1 ? shipping : billing;
  const customer = draft.customer || {};
  const phone = normalizePhone(draft.phone || billing.phone || shipping.phone || customer.phone || '');
  const client = addr.name || billing.name
    || [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim()
    || draft.email || 'Client';

  const lineItems = (draft.line_items || []).map(item => ({
    name: item.title || item.name || '',
    variant: item.variant_title || '',
    quantity: item.quantity || 1,
    unitPrice: parseFloat(item.price || 0),
    total: parseFloat(item.price || 0) * (item.quantity || 1),
  }));

  // Same WebiLeadForm custom-field extraction as regular orders (see the
  // main /webhook/shopify handler above) — the app writes its wilaya/commune
  // dropdown selections into note_attributes on the draft order exactly like
  // it does on completed orders.
  const noteAttrs = Array.isArray(draft.note_attributes) ? draft.note_attributes : [];
  function getNoteAttr(name) {
    const hit = noteAttrs.find(a => String(a.name || '').toLowerCase() === name.toLowerCase());
    return hit ? String(hit.value || '').trim() : '';
  }
  const noteProvinceCode = getNoteAttr('Province Code');
  const noteProvince     = getNoteAttr('Province');
  const noteCommune      = getNoteAttr('Commune');

  // Incomplete/abandoned submissions (customer never reached the final
  // "purchase" step) only carry a bare "Province" attribute holding the raw
  // numeric wilaya code (e.g. "22") — there is no separate "Province Code"
  // attribute yet, unlike completed orders which have both. Try resolving
  // noteProvince AS a code too, before falling back to stripArabic (which
  // would otherwise pass the raw "22" straight through as a fake wilaya name).
  const resolvedWilaya  = wilayaCodeToName(noteProvinceCode) || wilayaCodeToName(noteProvince) || stripArabic(noteProvince) || wilayaCodeToName(addr.province_code) || addr.province || '';
  const resolvedCommune = noteCommune || addr.city || '';

  const agent = resolveAgent('');   // identical auto-assign path as regular orders
  const data = loadData();

  const newOrder = {
    id: genId(data.orders),
    shopifyId: draftId,
    shopifyName: draft.name || '',
    client, phone,
    city: addr.city || '',
    wilaya: resolvedWilaya,
    commune: resolvedCommune,
    lineItems,
    product: lineItems[0]?.name || '',
    productVariant: lineItems[0]?.variant || '',
    shopifyProductId: draft.line_items?.[0]?.product_id ? String(draft.line_items[0].product_id) : null,
    shopifyVariantId: draft.line_items?.[0]?.variant_id ? String(draft.line_items[0].variant_id) : null,
    quantity: lineItems[0]?.quantity || 1,
    unitPrice: lineItems[0]?.unitPrice || 0,
    price: parseFloat(draft.total_price || 0),
    subtotal: parseFloat(draft.subtotal_price || 0),
    discount: parseFloat(draft.total_discounts || 0),
    shippingCost: 0,
    agent,
    delivery: 'zr',
    deliveryMethod: 'COD',
    expressDelivery: false,
    status: 'pending',
    deliveryStatus: '',
    trackingNumber: '',
    managerNote: '',
    shippingNote: '',
    note: draft.note || '',
    createdAt: Date.now(),
    shopifyCreatedAt: draft.created_at || null,
    orderType: 'draft',
    source: 'shopify_draft',
  };

  const saved = db.insertOrder(newOrder);
  logInfo('shopify', 'draft order imported', { id: newOrder.id, agent, draftId });
  try { inventory.reserveOnOrder(saved, 'system'); }
  catch (e) { logError('inventory', 'reserve on draft import failed', { orderId: saved.id, err: e.message }); }
  notifyNewOrder(saved, agent);
  if (agent) sendPushToAgent(agent, { title: '📦 طلب جديد', body: saved.id + ' — ' + (saved.client || '') });

  return res.status(200).json({ message: 'received', id: newOrder.id, agent });
}

/**
 * Handle Shopify's products/create webhook topic: automatically create a
 * matching CRM product and record the link (see the product_links table
 * comment in db.js for the multi-store rationale). Purely ADDITIVE — never
 * touches or duplicates a manually-created product; if this exact Shopify
 * product id is already linked (e.g. a re-delivered webhook — Shopify's own
 * dedup is best-effort only), this is a silent no-op.
 *
 * Deliberately scoped to CREATE only for now: products/update (keeping name/
 * price/variants in sync on later edits) and inventory_levels/update (real
 * stock-quantity sync) are separate, not-yet-built webhooks.
 */
function handleShopifyProductCreate(product, res) {
  const externalId = String(product.id || '');
  if (!externalId) return res.status(200).json({ message: 'skipped (no product id)' });

  const already = db.findProductByExternalId({ storeId: null, platform: 'shopify', externalProductId: externalId });
  if (already) {
    return res.status(200).json({ message: 'duplicate (already linked)', productId: already.id });
  }

  const shopifyVariants = Array.isArray(product.variants) ? product.variants : [];
  // CRM products carry ONE flat price, unlike Shopify where each variant can
  // price independently — the first variant's price is used as the closest
  // available approximation; this is a known, intentional simplification.
  const price = shopifyVariants.length ? parseFloat(shopifyVariants[0].price || 0) : 0;
  const variants = shopifyVariants.length > 1
    ? shopifyVariants.map(v => ({ name: v.title || v.sku || String(v.id), image: '', stock: null, threshold: null }))
    : []; // a single "Default Title" variant is really "no variants" from the CRM's point of view
  const image = (Array.isArray(product.images) && product.images[0]?.src)
    || (product.image && product.image.src) || '';

  const newProduct = db.insertProduct({
    id: genProdId(loadProducts()),
    name: product.title || externalId,
    sku: shopifyVariants[0]?.sku || '',
    description: product.body_html || '',
    price,
    variants,
    image,
    threshold: 24,
    stock: 0, // real stock quantity is a separate sync (inventory_levels/update) — not built yet, manager sets it manually for now
    createdAt: Date.now(),
  });

  db.linkProductToExternal({
    productId: newProduct.id,
    storeId: null,
    platform: 'shopify',
    externalProductId: externalId,
    externalVariantId: shopifyVariants[0]?.id ? String(shopifyVariants[0].id) : null,
  });

  logInfo('shopify', 'product auto-created from products/create webhook', { productId: newProduct.id, shopifyProductId: externalId, name: newProduct.name });
  return res.status(200).json({ message: 'received', productId: newProduct.id });
}

/* ---- ORDERS ----
 * Scoped per caller (audit SEC-01, record-level half). Authenticating the route
 * stopped strangers reading the order book, but every signed-in agent could
 * still pull EVERY order in the business — customer names, phone numbers and
 * revenue for accounts that are none of their concern. The agent PWA only ever
 * displayed its own rows, so it was filtering client-side over data it should
 * never have received.
 *
 * A manager sees everything. Anyone else sees the orders assigned to them,
 * either as the confirmation agent or as the follow-up agent, plus unassigned
 * orders — the unassigned-overdue queue exists precisely so somebody can pick
 * them up. */
app.get('/api/orders', (req, res) => {
  const all = loadData().orders;
  if (req.user.isManager) return res.json(all);
  res.json(all.filter(o => agentOwnsOrder(o, req.user.name)));
});

app.post('/api/orders', (req, res) => {
  const data = loadData();
  const o = req.body || {};
  if (!o.client || !o.phone) return res.status(400).json({ error: 'client+phone required' });
  const agent = resolveAgent(o.agent);   // FIX: "" no longer bypasses auto-assign
  const newOrder = {
    id: genId(data.orders),
    client: o.client, phone: normalizePhone(o.phone),
    city: o.city || o.commune || '',
    wilaya: o.wilaya || '', commune: o.commune || '',
    product: o.product || '', productVariant: o.productVariant || '',
    quantity: o.quantity || 1, unitPrice: o.unitPrice || o.price || 0,
    price: Number(o.price) || 0,
    subtotal: Number(o.subtotal) || Number(o.price) || 0,
    discount: Number(o.discount) || 0,
    shippingCost: Number(o.shippingCost) || 0,
    lineItems: o.lineItems || [],
    agent, delivery: o.delivery || 'zr',
    deliveryMethod: 'COD', expressDelivery: false,
    status: 'pending', deliveryStatus: '', trackingNumber: '',
    managerNote: o.managerNote || '', shippingNote: '',
    note: o.note || '', createdAt: Date.now(), source: o.source || 'manual'
  };
  const saved = db.insertOrder(newOrder);
  logInfo('orders', 'created', { id: newOrder.id, agent });
  // Inventory: reserve stock immediately if the policy is 'immediate' (req §9).
  try { inventory.reserveOnOrder(saved, 'system'); }
  catch (e) { logError('inventory', 'reserve on create failed', { orderId: saved.id, err: e.message }); }
  notifyNewOrder(saved, agent);
  if (agent) sendPushToAgent(agent, { title: '📦 طلب جديد', body: saved.id + ' — ' + (saved.client || '') });
  res.json(saved);
});

/* =============================================================================
 * WRITABLE ORDER FIELDS (audit §4 — mass assignment).
 *
 * This route used to spread req.body straight into patchOrder(), so a client
 * could write ANY column. Verified against a running server: one PUT setting
 * {"deliveryOutcome":"delivered","price":999999} fabricated 999,999 of client
 * lifetime revenue, because upsertClientFromOrder() correctly treats the
 * transition into 'delivered' as a real sale. The same field drives
 * delivered-pay payroll and the profit calculator.
 *
 * Three tiers, deny-by-default:
 *   AGENT_WRITABLE    — the order details an agent legitimately corrects
 *                       before confirming (the customer gave a wrong commune,
 *                       wants two instead of one).
 *   MANAGER_WRITABLE  — assignment, internal notes and commercial fields.
 *   nothing else      — identity (id, createdAt, shopifyId), machine-derived
 *                       state (deliveryOutcome, phoneNormalized, shipmentId),
 *                       and sweep bookkeeping (overdueFlaggedAt,
 *                       pendingCallStart) are not client-writable at all.
 *                       They are set by the code paths that own them.
 * ========================================================================== */
const AGENT_WRITABLE_ORDER_FIELDS = new Set([
  'client', 'phone', 'city', 'wilaya', 'commune',
  'product', 'productVariant', 'quantity', 'unitPrice', 'price',
  'subtotal', 'discount', 'shippingCost', 'lineItems',
  'note', 'shippingNote', 'status',
  'delivery', 'deliveryMethod', 'expressDelivery', 'trackingNumber',
]);
const MANAGER_WRITABLE_ORDER_FIELDS = new Set([
  ...AGENT_WRITABLE_ORDER_FIELDS,
  'agent', 'followupAgent', 'managerNote', 'marketer',
  'storeId', 'storeName', 'brand', 'providerId', 'deliveryStatus',
]);

/** Keep only what this caller may write; report anything else that was sent. */
function pickWritableOrderFields(body, user) {
  const allowed = user.isManager ? MANAGER_WRITABLE_ORDER_FIELDS : AGENT_WRITABLE_ORDER_FIELDS;
  const patch = {};
  const rejected = [];
  for (const [k, v] of Object.entries(body || {})) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    if (allowed.has(k)) patch[k] = v;
    else rejected.push(k);
  }
  return { patch, rejected };
}

app.put('/api/orders/:id', async (req, res) => {
  const order = db.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Not found' });
  // Validate status if it's being changed (manual status change feature)
  if (req.body.status !== undefined && !ORDER_STATUSES.includes(req.body.status)) {
    return res.status(400).json({ error: 'invalid status', valid: ORDER_STATUSES });
  }
  const { patch, rejected } = pickWritableOrderFields(req.body, req.user);
  if (rejected.length) {
    // Logged rather than 400'd: existing clients send whole order objects back,
    // and failing those would break the edit screen. The fields are dropped.
    logInfo('orders', 'ignored non-writable fields on update', {
      orderId: order.id, actor: req.user.name, rejected,
    });
  }
  const oldStatus = order.status;
  const newStatus = patch.status;
  const updated = db.patchOrder(req.params.id, patch);

  // A status change through this generic endpoint (e.g. the quick status
  // dropdown in the order list, as opposed to logging a call result via
  // /call) must trigger the SAME inventory + shipment side effects — two
  // different ways to reach "confirmed" silently behaving differently is
  // exactly what caused stock to not move for a manually-confirmed order.
  if (newStatus !== undefined && newStatus !== oldStatus) {
    if (newStatus === 'confirmed') {
      try { inventory.decrementOnConfirm(updated, updated.agent || 'agent'); }
      catch (e) { logError('inventory', 'decrement on manual confirm failed', { orderId: updated.id, err: e.message }); }
      try { await tryAutoCreateShipment(updated, updated.agent || 'agent'); }
      catch (e) { logError('shipment', 'auto-create on manual confirm failed', { orderId: updated.id, err: e.message }); }
      try {
        const fuAgent = followup.assignFollowup(updated.id, { auto: true, actor: updated.agent || 'agent' });
        if (fuAgent) broadcast({ type: 'followup_assigned', orderId: updated.id, agent: fuAgent }, fuAgent);
      } catch (e) { logError('followup', 'auto-assign failed', { orderId: updated.id, err: e.message }); }
    } else if (newStatus === 'cancelled') {
      try { inventory.releaseOnCancel(updated, updated.agent || 'agent'); }
      catch (e) { logError('inventory', 'release on manual cancel failed', { orderId: updated.id, err: e.message }); }
    }
  }

  const finalOrder = db.getOrder(req.params.id);
  // Read from the FILTERED patch, not req.body — otherwise a rejected field
  // could still trigger a reassignment broadcast and a push notification.
  if (patch.agent) {
    broadcast({ type: 'order_assigned', order: finalOrder }, patch.agent);
    sendPushToAgent(patch.agent, { title: '📦 طلب جديد', body: finalOrder.id + ' — ' + (finalOrder.client || '') });
  }
  if (patch.deliveryStatus) broadcast({ type: 'delivery_update', order: finalOrder }, finalOrder.agent);
  res.json(finalOrder);
});

// DELETE order
app.delete('/api/orders/:id', (req, res) => {
  const order = db.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Not found' });
  db.deleteOrder(req.params.id);
  res.json({ message: 'deleted' });
});

// Call start
app.post('/api/orders/:id/call-start', (req, res) => {
  const order = db.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Not found' });
  db.patchOrder(req.params.id, { pendingCallStart: Date.now() });
  res.json({ callStartTime: Date.now() });
});

// Call result — validates against VALID_RESULTS, stores the threshold used so the
// audit trail can always explain a "manipulation" flag even if settings change.
app.post('/api/orders/:id/call', async (req, res) => {
  const { result, note } = req.body || {};
  if (!result) return res.status(400).json({ error: 'result required' });
  if (!VALID_RESULTS.includes(result)) {
    logError('call', 'rejected unknown result', { id: req.params.id, result });
    return res.status(400).json({ error: 'invalid result', valid: VALID_RESULTS });
  }
  const settings = loadSettings();
  const order = db.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Not found' });

  const now = Date.now();
  const threshold = Number(settings.minCallSeconds) || 40;
  const callStartTime = order.pendingCallStart || null;
  const duration = callStartTime ? Math.max(0, Math.round((now - callStartTime) / 1000)) : null;
  // If the agent never pressed "Call" at all (no pendingCallStart), that is
  // AT LEAST as suspicious as a too-short call — arguably more so — so it
  // must flag, not silently pass through as "unknown". Previously this
  // case produced `null` here, and `if (null)` below never fires, so a
  // result logged with zero call attempt was never flagged at all.
  const suspicious = callStartTime ? (duration < threshold) : true;

  const call = {
    time: now,
    callStartTime,
    duration,
    threshold,            // threshold that was applied (for audit explanation)
    suspicious,
    result,
    note: note || '',
    agent: order.agent || ''
  };
  db.addCall(order.id, call);
  const updated = db.patchOrder(order.id, { status: result, pendingCallStart: null });

  if (suspicious) {
    notifications.push({
      type: 'suspicious_call',
      title: '⚠️ Appel suspect',
      body: [order.id, order.agent, (duration === null ? 'aucun appel' : duration + 's')].filter(Boolean).join(' · '),
      orderId: order.id,
      target: notifications.MANAGER_ONLY,
      extra: { order: updated, call: { duration, threshold, result, agent: order.agent } },
    });
  }
  broadcast({ type: 'call_logged', orderId: order.id, result, duration, suspicious }, order.agent);

  // ---- DELIVERY WORKFLOW: auto-create the shipment on confirm ----
  let shipment = null;
  if (result === 'confirmed') {
    // Inventory: decrement stock for the confirmed order (req §8).
    try { inventory.decrementOnConfirm(updated, order.agent || 'agent'); }
    catch (e) { logError('inventory', 'decrement on confirm failed', { orderId: order.id, err: e.message }); }

    shipment = await tryAutoCreateShipment(updated, order.agent || 'agent');

    // Follow-up: assign a Suivi agent to the now-confirmed + shipped order (req §1).
    try {
      const fuAgent = followup.assignFollowup(order.id, { auto: true, actor: order.agent || 'agent' });
      if (fuAgent) broadcast({ type: 'followup_assigned', orderId: order.id, agent: fuAgent }, fuAgent);
    } catch (e) { logError('followup', 'auto-assign failed', { orderId: order.id, err: e.message }); }
  } else if (result === 'cancelled') {
    // Restore any reserved/confirmed stock when a confirmation is cancelled (req §8).
    try { inventory.releaseOnCancel(updated, order.agent || 'agent'); }
    catch (e) { logError('inventory', 'release on cancel failed', { orderId: order.id, err: e.message }); }
  }

  res.json({ message: 'logged', duration, threshold, suspicious, shipmentId: shipment?.id || null });
});

// Standalone notes — for when the CLIENT calls back, or anything else
// happens, WITHOUT the agent having made a confirmation call. Deliberately
// separate from /call: never sets a result/status, never touches
// pendingCallStart, and is never fed into the manipulation-detection system
// (result-without-a-call is a DIFFERENT, suspicious scenario handled by
// /call itself when pendingCallStart is missing).
const VALID_NOTE_TYPES = ['client_called_back', 'complaint', 'address_change', 'client_instructions', 'other'];
app.post('/api/orders/:id/note', (req, res) => {
  const { noteType, note } = req.body || {};
  if (!note || !note.trim()) return res.status(400).json({ error: 'note text required' });
  if (!VALID_NOTE_TYPES.includes(noteType)) {
    return res.status(400).json({ error: 'invalid noteType', valid: VALID_NOTE_TYPES });
  }
  const order = db.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Not found' });

  const call = {
    time: Date.now(), callStartTime: null, duration: null, threshold: null, suspicious: null,
    result: null, note: note.trim(), noteType, agent: order.agent || '',
  };
  db.addCall(order.id, call);
  db.audit('order', order.id, 'note_added', order.agent || 'agent', { noteType });
  const updated = db.getOrder(order.id);
  broadcast({ type: 'note_added', orderId: order.id, noteType, note: note.trim() }, order.agent);
  res.json({ message: 'note added', order: updated });
});

// Full audit trail for an order (every call + order meta). Used by the clickable
// "manipulation" warning to explain exactly why a flag exists.
app.get('/api/orders/:id/audit', (req, res) => {
  const order = db.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Not found' });
  const settings = loadSettings();
  res.json({
    orderId: order.id,
    client: order.client,
    assignedAgent: order.agent || '',
    currentStatus: order.status,
    currentThreshold: Number(settings.minCallSeconds) || 40,
    calls: (order.calls || []).map((c, i) => ({
      index: i + 1,
      agent: c.agent || '',
      result: c.result,
      resultLabel: c.result,
      time: c.time,
      callStartTime: c.callStartTime,
      duration: c.duration,
      threshold: c.threshold ?? null,
      suspicious: c.suspicious,
      note: c.note || '',
      noStart: !c.callStartTime
    }))
  });
});

// Abandoned cart — ingested from Shopify (POST /api/abandoned) or via webhook.
// Stored as an order with status 'abandoned' so it appears in the same list,
// is filterable, and can be assigned + followed-up like any order.
app.post('/api/abandoned', (req, res) => {
  const c = req.body || {};
  if (!c.client && !c.phone) return res.status(400).json({ error: 'client or phone required' });
  const dupKey = c.shopifyId ? db.findOrder(o => o.shopifyId === String(c.shopifyId)) : null;
  if (dupKey) return res.status(200).json({ message: 'duplicate' });
  const agent = resolveAgent(c.agent || '');
  const data = loadData();
  const cart = {
    id: genId(data.orders),
    shopifyId: c.shopifyId ? String(c.shopifyId) : '',
    shopifyName: c.shopifyName || '',
    client: c.client || (c.phone ? 'Client' : ''),
    phone: normalizePhone(c.phone || ''),
    product: c.product || '',
    productVariant: c.productVariant || '',
    quantity: c.quantity || 1,
    price: Number(c.price) || 0,
    wilaya: c.wilaya || '', commune: c.commune || '',
    agent,
    // Abandoned cart is now METADATA (req §4): orderType='abandoned' instead of
    // a status. We keep status='abandoned' for back-compat with existing rows
    // and filters; both signals are honored in the order mapper.
    orderType: 'abandoned',
    status: 'abandoned',
    note: c.note || '', managerNote: '',
    delivery: 'zr', deliveryStatus: '', trackingNumber: '',
    source: 'shopify_abandoned',
    createdAt: Date.now()
  };
  const saved = db.insertOrder(cart);
  logInfo('abandoned', 'cart imported', { id: cart.id, agent });
  notifyNewOrder(saved, agent, 'abandoned_cart');
  res.status(200).json({ message: 'received', id: cart.id, agent });
});

/* =============================================================================
 * DELIVERY TRACKING — shipment lifecycle routes.
 * Every order's shipment + full event history is exposed here; the frontend
 * renders it as the tracking timeline. Events are append-only (never overwrite).
 * ========================================================================== */

// Shipment + full timeline for an order (oldest-first for display).
app.get('/api/orders/:id/shipment', (req, res) => {
  const order = db.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Not found' });
  const shipment = db.getShipmentByOrder(order.id);
  if (!shipment) return res.json({ shipment: null, events: [], provider: null });
  const events = db.getEvents(shipment.id);
  const provider = db.getProvider(shipment.providerId);
  res.json({ shipment, events, provider });
});

// Manually create a shipment for an order (fallback when auto-create is off or failed).
app.post('/api/orders/:id/shipment', async (req, res) => {
  const order = db.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Not found' });
  try {
    // Allow caller to override the provider + tracking number for inbound adapters.
    if (req.body.providerId || req.body.providerCode) {
      db.patchOrder(order.id, { providerId: req.body.providerId || '', delivery: req.body.providerCode || order.delivery });
    }
    if (req.body.trackingNumber) {
      db.patchOrder(order.id, { trackingNumber: req.body.trackingNumber });
    }
    const fresh = db.getOrder(order.id);
    const shipment = await providers.createShipmentForOrder(fresh, { actor: req.body.actor || 'agent' });
    res.json({ shipment, events: db.getEvents(shipment.id) });
  } catch (e) {
    logError('shipment', 'manual create failed', { orderId: order.id, err: e.message });
    res.status(400).json({ error: e.message });
  }
});

// Force a fresh tracking poll for the order's shipment.
app.post('/api/orders/:id/shipment/refresh', async (req, res) => {
  const order = db.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Not found' });
  const shipment = db.getShipmentByOrder(order.id);
  if (!shipment) return res.status(404).json({ error: 'No shipment for this order' });
  const result = await providers.refreshShipment(shipment.id, broadcast);
  res.json({ ...result, events: db.getEvents(shipment.id) });
});

/* ---------------------------------------------------------------------------
 * DELIVERY STATUS WEBHOOK — extended to be provider-aware + append events.
 * Providers POST { trackingNumber, status, orderId } (legacy shape still works)
 * and the matching adapter's parseWebhook() turns it into a tracking event that
 * is appended to the shipment history (never overwriting previous events).
 * ------------------------------------------------------------------------- */
app.post('/webhook/delivery', async (req, res) => {
  const body = req.body || {};
  // Identify the provider: explicit id/code header → fall back to lookup by tracking.
  let providerCode = req.headers['x-provider'] || req.headers['x-provider-code'] || body.provider || body.providerCode || '';
  let providerCfg = providerCode ? db.getProviderSecrets(providerCode) : null;

  const trackingNumber = body.trackingNumber || body.tracking_number || body.tracking || body.code_suivi || '';
  let shipment = trackingNumber ? db.getShipmentByTracking(trackingNumber) : null;

  // Legacy fall-back: match by orderId / shopifyName when no tracking hit yet.
  if (!shipment) {
    const orderId = body.orderId || body.order_id || '';
    const order = orderId ? db.findOrder(o => o.id === orderId || o.shopifyName === orderId) : null;
    if (order) shipment = db.getShipmentByOrder(order.id);
  }

  if (!shipment) {
    // No shipment yet — try to find the order and create a pending shipment, then
    // record the first event. This covers the inbound-only adapter flow where the
    // very first webhook carries the tracking number.
    const order = db.findOrder(o => o.trackingNumber === trackingNumber || o.id === (body.orderId || body.order_id));
    if (order) {
      try {
        shipment = await providers.createShipmentForOrder({ ...order, trackingNumber }, { actor: 'webhook' });
      } catch (e) {
        logError('webhook', 'delivery webhook could not create shipment', { err: e.message });
      }
    }
  }

  if (!shipment) return res.status(404).json({ error: 'Shipment/Order not found' });

  // Resolve the provider config from the shipment if we didn't already.
  if (!providerCfg && shipment.providerId) providerCfg = db.getProviderSecrets(shipment.providerId);
  const adapter = providerCfg ? providers.getAdapter(providerCfg.adapter) : providers.getAdapter('zr-webhook');

  const parsed = adapter.parseWebhook(req.headers, body, providerCfg || {});
  if (!parsed) {
    logError('webhook', 'delivery webhook payload not parseable', { body });
    return res.status(400).json({ error: 'Could not parse webhook payload' });
  }

  const events = Array.isArray(parsed) ? parsed : [parsed];
  const inserted = providers.ingestTrackingEvents(shipment, events, broadcast, { actor: 'webhook' });

  logInfo('webhook', 'delivery event ingested', { shipmentId: shipment.id, inserted: inserted.length });
  res.json({ message: 'updated', inserted: inserted.length });
});

// ---- AGENTS ----
app.get('/api/agents', (req, res) => res.json(db.getAgents()));

app.post('/api/agents', async (req, res) => {
  const { name, pass, role, baseSalaryMonthly, payPerConfirmedOrder, payPerDeliveredOrder } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  if (db.getAgents().find(a => a.name === name)) return res.status(400).json({ error: 'Exists' });
  const validRoles = ['confirmation', 'followup', 'both'];
  // Hashed here, never stored as given (audit SEC-02). An empty password is
  // still accepted so a manager can create the account first and set the
  // password after — hasPassword:false makes that state visible in the UI.
  db.addAgent(name, await auth.hashPassword(pass || ''), validRoles.includes(role) ? role : 'confirmation',
    { hasPassword: !!pass });
  if (baseSalaryMonthly !== undefined || payPerConfirmedOrder !== undefined || payPerDeliveredOrder !== undefined) {
    db.patchAgent(name, { baseSalaryMonthly, payPerConfirmedOrder, payPerDeliveredOrder });
  }
  db.audit('agent', name, 'create', 'admin', { role });
  res.json({ message: 'added' });
});

// Update an agent's payment configuration (payroll feature) — 3 independent
// rate fields, any combination valid. Separate from /role since the two are
// edited from different parts of the agent modal and can change independently.
app.put('/api/agents/:name/payment', (req, res) => {
  const name = decodeURIComponent(req.params.name);
  if (!db.getAgents().find(a => a.name === name)) return res.status(404).json({ error: 'Not found' });
  const { baseSalaryMonthly, payPerConfirmedOrder, payPerDeliveredOrder } = req.body || {};
  const updated = db.patchAgent(name, { baseSalaryMonthly, payPerConfirmedOrder, payPerDeliveredOrder });
  db.audit('agent', name, 'set-payment', 'admin', { baseSalaryMonthly, payPerConfirmedOrder, payPerDeliveredOrder });
  res.json({ message: 'updated', agent: updated });
});

// Update an agent's role (confirmation | followup | both) — req §1.
app.put('/api/agents/:name/role', (req, res) => {
  const validRoles = ['confirmation', 'followup', 'both'];
  const role = req.body?.role;
  if (!validRoles.includes(role)) return res.status(400).json({ error: 'invalid role', valid: validRoles });
  const name = decodeURIComponent(req.params.name);
  if (!db.getAgents().find(a => a.name === name)) return res.status(404).json({ error: 'Not found' });
  db.updateAgentRole(name, role);
  db.audit('agent', name, 'set-role', 'admin', { role });
  res.json({ message: 'updated', name, role });
});

app.delete('/api/agents/:name', (req, res) => {
  db.removeAgent(decodeURIComponent(req.params.name));
  res.json({ message: 'removed' });
});

// Manager-only: reset an agent's permanent missed-orders counter back to zero (spec §6/§8).
app.post('/api/agents/:name/reset-missed', (req, res) => {
  const name = decodeURIComponent(req.params.name);
  if (!db.getAgents().find(a => a.name === name)) return res.status(404).json({ error: 'Not found' });
  db.resetMissedOrders(name);
  db.audit('agent', name, 'reset_missed_orders', req.body?.actor || 'admin', {});
  res.json({ message: 'reset', agent: db.getAgents().find(a => a.name === name) });
});

// Manager-only: MANUAL suspension — unlike the automatic sweep-triggered
// suspend (which only fires past the missed-orders threshold), this can be
// used any time for any reason (day off not pre-scheduled, called in sick,
// etc.). Uses the exact same `suspended` flag auto-assign already checks,
// so a manually-suspended agent immediately stops receiving new orders —
// no separate mechanism needed.
app.post('/api/agents/:name/suspend', (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const target = db.getAgents().find(a => a.name === name);
  if (!target) return res.status(404).json({ error: 'Not found' });
  // Two lock-yourself-out guards. Suspension now genuinely blocks access
  // (before authentication existed it only affected auto-assign), so
  // suspending yourself — or the last account that can lift a suspension —
  // would leave nobody able to undo it without editing the database by hand.
  if (name === req.user.name) {
    return res.status(400).json({ error: 'You cannot suspend your own account', code: 'SELF_SUSPEND' });
  }
  if (target.accountRole === 'manager' && db.countManagers() <= 1) {
    return res.status(400).json({ error: 'This is the only manager account — promote someone else first', code: 'LAST_MANAGER' });
  }
  db.suspendAgent(name);
  // Revoke live sessions too, or a suspended agent keeps working until their
  // cookie happens to expire.
  auth.destroySessionsFor(name);
  db.audit('agent', name, 'manual_suspend', req.user.name, {});
  notifications.push({
    type: 'agent_suspended', title: '⛔ Agent suspended',
    body: name + ' — suspended by ' + req.user.name,
    target: notifications.MANAGER_ONLY,
  });
  res.json({ message: 'suspended', agent: db.getAgents().find(a => a.name === name) });
});

// Recurring weekly day(s) off (e.g. Friday every week) — auto-assign and
// the overdue-reassignment sweep both skip an agent on their configured
// day(s), automatically, every week, with no manager action needed. This is
// intentionally separate from suspend: a day off recurs on its own; a
// manual suspend stays off until someone reactivates it.
app.put('/api/agents/:name/days-off', (req, res) => {
  const name = decodeURIComponent(req.params.name);
  if (!db.getAgents().find(a => a.name === name)) return res.status(404).json({ error: 'Not found' });
  const days = Array.isArray(req.body?.weeklyDaysOff) ? req.body.weeklyDaysOff : [];
  const updated = db.patchAgent(name, { weeklyDaysOff: days });
  db.audit('agent', name, 'set-days-off', 'admin', { weeklyDaysOff: updated.weeklyDaysOff });
  res.json({ message: 'updated', agent: updated });
});

// Manager-only: lift an automatic suspension so the agent can log in again (spec §7/§8).
app.post('/api/agents/:name/reactivate', (req, res) => {
  const name = decodeURIComponent(req.params.name);
  if (!db.getAgents().find(a => a.name === name)) return res.status(404).json({ error: 'Not found' });
  db.reactivateAgent(name);
  db.audit('agent', name, 'reactivate', req.body?.actor || 'admin', {});
  broadcast({ type: 'agent_reactivated', agent: name });
  res.json({ message: 'reactivated', agent: db.getAgents().find(a => a.name === name) });
});

// Payroll for one agent over [since, until]. periodType (week/month/quarter/
// year/day) drives salary proration — omit it for a custom range (falls back
// to the /30.44*days approximation, same as the fixed-costs calculator).
app.get('/api/agents/:name/payroll', (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const { since, until, periodType } = req.query;
  const result = db.computeAgentPayroll(name, Number(since) || 0, Number(until) || Date.now(), periodType);
  if (!result) return res.status(404).json({ error: 'Not found' });
  res.json(result);
});

// Payroll for every agent over the same [since, until] window — one row per agent.
app.get('/api/agents/payroll', (req, res) => {
  const { since, until, periodType } = req.query;
  res.json({ items: db.computeAllAgentsPayroll(Number(since) || 0, Number(until) || Date.now(), periodType) });
});

// ---- PRODUCTS ----
// Archived products are hidden by default (declutters the working list);
// ?archived=true shows ONLY archived ones, for a dedicated "Archived" view.
// loadProducts() (used elsewhere for ID generation etc.) is untouched —
// internal logic must still see archived products to avoid ID collisions.
app.get('/api/products', (req, res) => {
  res.json(req.query.archived === 'true' ? db.getArchivedProducts() : db.getActiveProducts());
});

// Normalize variants to [{name, image, sku, options}] (back-compat with old string[] arrays)
function normalizeVariants(v){
  if(!Array.isArray(v)) return [];
  // Preserve per-variant stock + threshold (req §8) when present; the DB layer's
  // normalizeVariantStock() will backfill nulls for legacy shapes.
  // BUGFIX: this used to drop sku/options on the way in, which silently broke
  // the multi-dimensional variants feature (every save lost the per-variant
  // SKU and its Color/Size option map even though the client sent them).
  return v.map(x => typeof x === 'string'
    ? { name: x, image: '', sku: '', options: {} }
    : {
        name: x.name||x.label||'',
        image: x.image||x.img||'',
        stock: x.stock === undefined ? undefined : x.stock,
        threshold: x.threshold === undefined ? undefined : x.threshold,
        sku: x.sku || '',
        options: (x.options && typeof x.options === 'object' && !Array.isArray(x.options)) ? x.options : {},
      });
}

app.post('/api/products', (req, res) => {
  const products = loadProducts();
  // BUGFIX: costPrice, packagingCost, and optionDefs were missing from this
  // destructure, so newProduct never set them and they were silently
  // dropped on every product CREATE (they still worked on PUT/edit, since
  // that route spreads req.body directly — only POST/create had the bug).
  // Same class of bug just caught again for brand/niche/category/supplier
  // (phase C) — fixed here before it ever shipped this time.
  const { name, sku, variants, stock, price, description, image, threshold, costPrice, packagingCost, optionDefs, brand, niche, category, supplier } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const newProduct = {
    id: genProdId(products), name, sku: sku || '',
    description: description || '',
    price: Number(price) || 0,
    variants: normalizeVariants(variants),
    optionDefs: Array.isArray(optionDefs) ? optionDefs : [],
    image: image || '',
    threshold: (threshold === undefined || threshold === null || threshold === '') ? 24 : Number(threshold),
    costPrice: Number(costPrice) || 0,
    packagingCost: Number(packagingCost) || 0,
    stock: Number(stock) || 0,
    brand: brand || '', niche: niche || '', category: category || '', supplier: supplier || '',
    createdAt: Date.now()
  };
  const saved = db.insertProduct(newProduct);
  res.json(saved);
});

app.put('/api/products/:id', (req, res) => {
  const product = db.getProduct(req.params.id);
  if (!product) return res.status(404).json({ error: 'Not found' });
  if (req.body.variants !== undefined) req.body.variants = normalizeVariants(req.body.variants);
  const saved = db.saveProduct({ ...product, ...req.body, id: req.params.id });
  res.json(saved);
});

// Archives, never hard-deletes — "even if I archive it, I want a
// permanent product history" (req). True deletion (db.deleteProduct) is
// still available at the DB layer for direct/manual cleanup, just not
// through this normal app route anymore.
app.delete('/api/products/:id', (req, res) => {
  const p = db.archiveProduct(req.params.id, req.body?.actor || 'admin');
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json({ message: 'archived', product: p });
});
app.post('/api/products/:id/unarchive', (req, res) => {
  const p = db.unarchiveProduct(req.params.id, req.body?.actor || 'admin');
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(p);
});
// Permanent timeline (price/cost/variant/supplier changes, archive events)
// + which stores this product has ever been linked to.
app.get('/api/products/:id/history', (req, res) => {
  const p = db.getProduct(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(db.getProductHistory(req.params.id));
});

// ---- SETTINGS ----
/* =============================================================================
 * SETTINGS SCHEMA (audit §4 — validation).
 *
 * PUT /api/settings accepted arbitrary keys with arbitrary values, so
 * {"totallyMadeUpKey":"yes","autoSuspend":"not-a-boolean","suspendThreshold":-5}
 * was stored verbatim. A string where a boolean is expected is worse than it
 * looks: `if (s.autoSuspend)` is TRUE for the string "false", so a
 * misconfiguration silently enables account suspension.
 *
 * Each key declares its type and, where a nonsensical value would cause real
 * harm, its range. Unknown keys are rejected outright rather than stored — the
 * settings table is a fixed vocabulary, not a scratchpad.
 * ========================================================================== */
const SETTINGS_SCHEMA = {
  autoAssign:              { type: 'boolean' },
  autoCreateShipment:      { type: 'boolean' },
  autoReassign:            { type: 'boolean' },
  autoSuspend:             { type: 'boolean' },
  followupAutoAssign:      { type: 'boolean' },
  minCallSeconds:          { type: 'number', min: 0, max: 3600 },
  alertMinutes:            { type: 'number', min: 1, max: 10080 },
  trackingPollMinutes:     { type: 'number', min: 1, max: 1440 },
  followupReminderMinutes: { type: 'number', min: 1, max: 10080 },
  reassignMinutes:         { type: 'number', min: 0, max: 10080 },
  nightGraceMinutes:       { type: 'number', min: 0, max: 10080 },
  suspendThreshold:        { type: 'number', min: 1, max: 1000 },
  workHoursStart:          { type: 'number', min: 0, max: 23 },
  workHoursEnd:            { type: 'number', min: 1, max: 24 },
  reservationMode:         { type: 'enum', values: ['immediate', 'on_confirm', 'none'] },
  defaultCarrierByStore:   { type: 'object' },
  fixedCosts:              { type: 'array' },
  // Written by the delivery-outcome migration, not by a human.
  deliveryOutcomeBackfillAt: { type: 'number', internal: true },
};

function validateSettings(body) {
  const clean = {};
  const errors = [];
  for (const [key, value] of Object.entries(body || {})) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const spec = SETTINGS_SCHEMA[key];
    if (!spec) { errors.push(`unknown setting "${key}"`); continue; }
    if (spec.internal) { errors.push(`"${key}" is maintained by the system and cannot be set`); continue; }

    if (spec.type === 'boolean') {
      if (typeof value !== 'boolean') { errors.push(`"${key}" must be true or false`); continue; }
    } else if (spec.type === 'number') {
      const n = Number(value);
      if (typeof value === 'boolean' || !Number.isFinite(n)) { errors.push(`"${key}" must be a number`); continue; }
      if (spec.min !== undefined && n < spec.min) { errors.push(`"${key}" must be at least ${spec.min}`); continue; }
      if (spec.max !== undefined && n > spec.max) { errors.push(`"${key}" must be at most ${spec.max}`); continue; }
      clean[key] = n; continue;
    } else if (spec.type === 'enum') {
      if (!spec.values.includes(value)) { errors.push(`"${key}" must be one of: ${spec.values.join(', ')}`); continue; }
    } else if (spec.type === 'array') {
      if (!Array.isArray(value)) { errors.push(`"${key}" must be an array`); continue; }
    } else if (spec.type === 'object') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) { errors.push(`"${key}" must be an object`); continue; }
    }
    clean[key] = value;
  }
  return { clean, errors };
}

app.get('/api/settings', (req, res) => res.json(loadSettings()));

app.put('/api/settings', (req, res) => {
  const { clean, errors } = validateSettings(req.body);
  if (errors.length) {
    return res.status(400).json({ error: 'Invalid settings', code: 'INVALID_SETTINGS', details: errors });
  }
  // A window that matches no hour at all would silently disable the overdue
  // sweep — isWithinWorkingHours() already fails open and logs, but refusing
  // the value at the point it is entered is far better than discovering it
  // from a log line weeks later.
  const merged = { ...loadSettings(), ...clean };
  if (Number(merged.workHoursEnd) <= Number(merged.workHoursStart)) {
    return res.status(400).json({
      error: 'workHoursEnd must be greater than workHoursStart', code: 'INVALID_SETTINGS',
      details: [`got start=${merged.workHoursStart}, end=${merged.workHoursEnd}`],
    });
  }
  const updated = saveSettings(clean);
  db.audit('settings', 'settings', 'update', req.user.name, { keys: Object.keys(clean) });
  res.json(updated);
});

/* =============================================================================
 * DELIVERY INTEGRATIONS — provider registry CRUD.
 * Drives the admin "Delivery Integrations" page. The order form's delivery
 * dropdown is also populated from here (data-driven, no longer hardcoded).
 * ========================================================================== */
app.get('/api/providers', (req, res) => res.json(db.getProviders()));
app.get('/api/providers/adapters', (req, res) => res.json(providers.listAdapterKeys()));

app.post('/api/providers', (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.code) return res.status(400).json({ error: 'name+code required' });
  if (db.getProviderByCode(b.code)) return res.status(400).json({ error: 'code exists' });
  const saved = db.saveProvider(b);
  db.audit('provider', saved.id, 'create', 'admin', { code: b.code });
  res.json(saved);
});

app.put('/api/providers/:id', (req, res) => {
  const existing = db.getProvider(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const saved = db.saveProvider({ ...req.body, id: req.params.id });
  db.audit('provider', saved.id, 'update', 'admin', {});
  res.json(saved);
});

app.delete('/api/providers/:id', (req, res) => {
  db.deleteProvider(req.params.id);
  db.audit('provider', req.params.id, 'delete', 'admin', {});
  res.json({ message: 'deleted' });
});

app.post('/api/providers/:id/default', (req, res) => {
  if (!db.getProvider(req.params.id)) return res.status(404).json({ error: 'Not found' });
  db.setDefaultProvider(req.params.id);
  db.audit('provider', req.params.id, 'set-default', 'admin', {});
  res.json({ message: 'default set' });
});

// Test Connection — validate the provider's API credentials. Saves the last
// success/failure date and a log entry. Works for any adapter that implements
// testConnection(); adapters without one are validated structurally.
app.post('/api/providers/:id/test', async (req, res) => {
  const provider = db.getProvider(req.params.id);
  if (!provider) return res.status(404).json({ error: 'Not found' });
  const cfg = db.getProviderSecrets(req.params.id);
  const adapter = providers.getAdapter(cfg.adapter);
  const reqCtx = { url: cfg.apiUrl, method: 'test' };
  try {
    if (typeof adapter.testConnection === 'function') {
      const result = await adapter.testConnection(cfg);
      const ok = !!(result && result.ok !== false);
      db.markProviderTested(req.params.id, ok);
      db.logIntegration('provider', req.params.id, 'test_connection', ok ? 'success' : 'failure',
        ok ? (result.message || 'OK') : (result.message || 'Failed'), reqCtx, result);
      res.json({ ok, message: result.message || (ok ? 'Connection successful' : 'Connection failed'), testedAt: Date.now() });
    } else {
      // Structural validation: enough config to be usable?
      const ok = !!(cfg.apiUrl || cfg.apiKey || cfg.secretKey || adapter.key === 'mock' || adapter.key === 'zr-webhook');
      const message = ok ? 'Configured (adapter has no live test — validated structurally)' : 'Missing API URL / credentials';
      db.markProviderTested(req.params.id, ok);
      db.logIntegration('provider', req.params.id, 'test_connection', ok ? 'success' : 'failure', message, reqCtx, { ok, structural: true });
      res.json({ ok, message, structural: true, testedAt: Date.now() });
    }
  } catch (e) {
    db.markProviderTested(req.params.id, false);
    db.logIntegration('provider', req.params.id, 'auth_error', 'failure', e.message, reqCtx, { error: e.message });
    res.json({ ok: false, message: e.message, testedAt: Date.now() });
  }
});

// Sync Now — immediately re-poll every active shipment for this provider.
app.post('/api/providers/:id/sync', async (req, res) => {
  const provider = db.getProvider(req.params.id);
  if (!provider) return res.status(404).json({ error: 'Not found' });
  const cfg = db.getProviderSecrets(req.params.id);
  if (!cfg.apiEnabled) return res.status(400).json({ error: 'API disabled for this provider' });
  const adapter = providers.getAdapter(cfg.adapter);
  // Find every non-terminal shipment belonging to this provider.
  const shipments = db.raw.prepare(`SELECT id, trackingNumber FROM shipments WHERE providerId = ?`).all(req.params.id);
  let refreshed = 0, inserted = 0, errors = 0;
  for (const s of shipments) {
    try {
      let events = [];
      if (adapter.getTracking && adapter.canCreateOutbound !== false) {
        events = await adapter.getTracking(s.trackingNumber, cfg);
      }
      const ship = db.getShipment(s.id);
      if (ship && events.length) {
        const got = providers.ingestTrackingEvents(ship, events, broadcast, { actor: 'manual_sync' });
        inserted += got.length;
      }
      refreshed++;
    } catch (e) {
      errors++;
      db.logIntegration('provider', req.params.id, 'sync_error', 'failure', e.message, { shipmentId: s.id }, { error: e.message });
    }
  }
  db.markProviderSynced(req.params.id);
  db.logIntegration('provider', req.params.id, 'manual_sync', errors ? 'failure' : 'success',
    `Synced ${refreshed} shipment(s)`, { count: shipments.length }, { refreshed, inserted, errors });
  res.json({ ok: true, refreshed, inserted, errors, syncedAt: Date.now() });
});

// Provider integration logs.
app.get('/api/providers/:id/logs', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json(db.getIntegrationLogs('provider', req.params.id, limit));
});

// Status mapping for a provider.
app.get('/api/providers/:id/status-mappings', (req, res) => {
  res.json(db.getStatusMappings(req.params.id));
});
app.post('/api/providers/:id/status-mappings', (req, res) => {
  const { originalStatus, crmStatus } = req.body || {};
  if (!originalStatus || !crmStatus) return res.status(400).json({ error: 'originalStatus+crmStatus required' });
  db.setStatusMapping(req.params.id, originalStatus, crmStatus);
  res.json(db.getStatusMappings(req.params.id));
});
app.delete('/api/providers/:id/status-mappings/:mid', (req, res) => {
  db.deleteStatusMapping(req.params.mid);
  res.json({ message: 'deleted' });
});

/* =============================================================================
 * STORES — multi-store / multi-platform registry.
 * Each order carries storeId; the order form + admin let stores be managed here.
 * ========================================================================== */
app.get('/api/stores', (req, res) => res.json(db.getStores()));
app.get('/api/platforms', (req, res) => res.json(platforms.listPlatforms()));

app.post('/api/stores', (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name required' });
  const id = 'STR-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
  // Auto-generate the inbound webhook endpoint for this store.
  b.id = id;
  b.webhookEndpoint = b.webhookEndpoint || ('/webhook/store/' + id);
  const saved = db.saveStore(b);
  db.audit('store', id, 'create', 'admin', { name: b.name, platform: b.platform });
  res.json(saved);
});

app.put('/api/stores/:id', (req, res) => {
  const existing = db.getStore(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const saved = db.saveStore({ ...req.body, id: req.params.id });
  db.audit('store', req.params.id, 'update', 'admin', {});
  res.json(saved);
});

app.delete('/api/stores/:id', (req, res) => {
  db.deleteStore(req.params.id);
  db.audit('store', req.params.id, 'delete', 'admin', {});
  res.json({ message: 'deleted' });
});

// Store Test Connection — validate store credentials. Uses the platform adapter
// if one is registered, otherwise a structural check that credentials exist.
app.post('/api/stores/:id/test', async (req, res) => {
  const store = db.getStore(req.params.id);
  if (!store) return res.status(404).json({ error: 'Not found' });
  const cfg = db.getStoreSecrets(req.params.id);
  const reqCtx = { platform: cfg.platform, url: cfg.apiUrl };
  try {
    const adapter = platforms.getAdapter(cfg.platform);
    if (adapter && typeof adapter.testConnection === 'function') {
      const result = await adapter.testConnection(cfg);
      const ok = !!(result && result.ok !== false);
      db.markStoreTested(req.params.id);
      db.logIntegration('store', req.params.id, 'test_connection', ok ? 'success' : 'failure',
        ok ? (result.message || 'OK') : (result.message || 'Failed'), reqCtx, result);
      res.json({ ok, message: result.message || (ok ? 'Connection successful' : 'Connection failed'), testedAt: Date.now() });
    } else {
      // Structural validation for platforms without a live adapter yet.
      const ok = !!(cfg.apiUrl && (cfg.apiKey || cfg.apiSecret));
      const message = ok ? 'Configured (no live adapter — validated structurally)' : 'Missing API URL / credentials';
      db.markStoreTested(req.params.id);
      db.logIntegration('store', req.params.id, 'test_connection', ok ? 'success' : 'failure', message, reqCtx, { ok, structural: true });
      res.json({ ok, message, structural: true, testedAt: Date.now() });
    }
  } catch (e) {
    db.logIntegration('store', req.params.id, 'auth_error', 'failure', e.message, reqCtx, { error: e.message });
    res.json({ ok: false, message: e.message, testedAt: Date.now() });
  }
});

// Store integration logs.
app.get('/api/stores/:id/logs', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json(db.getIntegrationLogs('store', req.params.id, limit));
});

// Generic inbound webhook for any store platform. Identified by the store id in
// the path; the platform adapter parses + verifies the payload. Keeps the CRM
// platform-agnostic (Shopify is just one of many).
//
// Dedup: some platforms (LightFunnels included) fire more than one webhook
// for the SAME order as it progresses (e.g. created -> confirmed once the
// customer finishes adding upsells). Mirrors the /webhook/shopify handler's
// own existingOrder lookup below so a second delivery PATCHES the existing
// order instead of creating a duplicate. The adapter's returned externalId
// is stored in the reused `shopifyId` column regardless of platform (same
// column, generic meaning: "this platform's order id").
app.post('/webhook/store/:id', express.raw({ type: '*/*' }), async (req, res) => {
  const store = db.getStore(req.params.id);
  if (!store) return res.status(404).json({ error: 'store not found' });
  const cfg = db.getStoreSecrets(req.params.id);
  let body = req.body;
  try { body = JSON.parse(req.body.toString()); } catch { /* keep raw */ }
  db.logIntegration('store', req.params.id, 'webhook_received', 'success', store.platform, { headers: pickHeaders(req.headers) }, body);
  // Platform adapters can be registered to transform webhooks into orders;
  // without one, we simply acknowledge (and the log records the event).
  const adapter = platforms.getAdapter(cfg.platform);
  if (adapter && typeof adapter.parseWebhook === 'function') {
    try {
      const order = adapter.parseWebhook(req.headers, body, cfg);
      if (order) {
        const externalId = order.lightfunnelsId || order.shopifyId || '';
        const data = loadData();
        const existing = externalId
          ? data.orders.find(o => o.storeId === store.id && o.shopifyId === externalId)
          : null;

        if (existing) {
          // A later webhook for an order we already imported (e.g. the
          // customer added upsells and "order/confirmed" now carries more
          // items than the earlier "order/created" did) — patch instead of
          // duplicating. Never overwrite an already-filled field with an
          // empty one, and always take the newer lineItems/price wholesale
          // since those legitimately grow across the order's lifecycle.
          const patch = {};
          for (const k of ['client', 'phone', 'city', 'wilaya', 'commune']) {
            if (order[k] && !existing[k]) patch[k] = order[k];
          }
          if (order.lineItems && order.lineItems.length) {
            patch.lineItems = order.lineItems;
            patch.product = order.product || existing.product;
            patch.productVariant = order.productVariant || existing.productVariant;
            patch.quantity = order.quantity || existing.quantity;
          }
          if (order.price) patch.price = order.price;
          if (Object.keys(patch).length) {
            db.patchOrder(existing.id, patch);
            logInfo('store', 'order updated from later webhook', { id: existing.id, storeId: store.id, externalId, patch: Object.keys(patch) });
            db.logIntegration('store', req.params.id, 'webhook_order_updated', 'success', store.platform, {}, { orderId: existing.id });
          }
          return res.status(200).json({ ok: true, orderId: existing.id, message: 'updated' });
        }

        // No matching order by external id -- but check for an existing
        // ABANDONED LEAD with the same phone number first (from the
        // checkout/contact webhooks or the lead-capture script). Since
        // LightFunnels never links a checkout's id to its eventual order's
        // id (confirmed: they use unrelated "ch_..." vs "order_..."
        // formats, verified across every real payload captured), phone is
        // the only reliable link between "someone started typing their
        // number" and "that same someone finished the purchase". This is
        // what makes a draft become the real order instead of sitting
        // alongside it as a separate row.
        const normalizedPhone = normalizePhone(order.phone || '');
        const LEAD_UPGRADE_WINDOW_MS = 6 * 3600 * 1000; // 6h -- generous for checkout hesitation, short enough to not merge an unrelated later order from a repeat customer
        const existingLead = normalizedPhone
          ? data.orders.find(o => o.storeId === store.id && o.phone === normalizedPhone && o.status === 'abandoned' && (Date.now() - o.createdAt) < LEAD_UPGRADE_WINDOW_MS)
          : null;

        if (existingLead) {
          const upgrade = {
            status: 'pending', orderType: '', source: cfg.platform,
            client: order.client || existingLead.client, city: order.city || existingLead.city,
            wilaya: order.wilaya || existingLead.wilaya, commune: order.commune || existingLead.commune,
            product: order.product || existingLead.product, productVariant: order.productVariant || existingLead.productVariant,
            quantity: order.quantity || existingLead.quantity, unitPrice: order.price || 0,
            price: Number(order.price) || 0, subtotal: Number(order.price) || 0,
            lineItems: order.lineItems && order.lineItems.length ? order.lineItems : existingLead.lineItems,
            note: order.note || existingLead.note, shopifyId: externalId, shopifyName: order.shopifyName || '',
          };
          db.patchOrder(existingLead.id, upgrade);
          logInfo('store', 'lead upgraded to real order (matched by phone)', { id: existingLead.id, storeId: store.id, phone: normalizedPhone });
          db.logIntegration('store', req.params.id, 'webhook_lead_upgraded', 'success', store.platform, {}, { orderId: existingLead.id });
          notifyNewOrder(db.getOrder(existingLead.id), existingLead.agent);
          return res.status(200).json({ ok: true, orderId: existingLead.id, message: 'upgraded from lead' });
        }

        const agent = resolveAgent('');
        const newOrder = {
          id:             genId(data.orders),
          storeId:        store.id,
          source:         cfg.platform,
          agent:          agent,
          status:         'pending',
          delivery:       'zr',
          deliveryMethod: 'COD',
          expressDelivery: false,
          deliveryStatus: '',
          trackingNumber: '',
          createdAt:      Date.now(),
          client:         order.client || '',
          phone:          normalizePhone(order.phone || ''),
          city:           order.city || '',
          wilaya:         order.wilaya || '',
          commune:        order.commune || '',
          product:        order.product || '',
          productVariant: order.productVariant || '',
          quantity:       order.quantity || 1,
          unitPrice:      order.price || 0,
          price:          Number(order.price) || 0,
          subtotal:       Number(order.price) || 0,
          discount:       0,
          shippingCost:   0,
          lineItems:      order.lineItems || [],
          note:           order.note || '',
          shippingNote:   '',
          managerNote:    '',
          shopifyId:      externalId,
          shopifyName:    order.shopifyName || '',
        };
        const saved = db.insertOrder(newOrder);
        logInfo('store', 'webhook order saved', { id: saved.id, storeId: store.id });
        notifyNewOrder(saved, agent);
  if (agent) sendPushToAgent(agent, { title: '📦 طلب جديد', body: saved.id + ' — ' + (saved.client || '') });
        db.logIntegration('store', req.params.id, 'webhook_order_created', 'success', store.platform, {}, { orderId: saved.id });
        return res.status(200).json({ ok: true, orderId: saved.id });
      }
    } catch (e) {
      logError('store', 'webhook save failed', { err: e.message });
      db.logIntegration('store', req.params.id, 'webhook_received', 'failure', e.message, null, { error: e.message });
    }
  }
  res.json({ ok: true });
});

// "New checkout"-style events (abandoned checkout / lead capture, before the
// customer finishes buying). Deliberately a SEPARATE URL from the order
// webhook above -- see lightfunnels.js's file header: LightFunnels doesn't
// expose a topic header the way Shopify does, so distinguishing event types
// on one shared URL isn't reliable. Register this path as its own webhook
// in the platform's dashboard. Lands as an 'abandoned'-status row, mirroring
// handleAbandonedCheckout's Shopify behavior, so it never collides with the
// real order pipeline above.
app.post('/webhook/store/:id/checkout', express.raw({ type: '*/*' }), async (req, res) => {
  const store = db.getStore(req.params.id);
  if (!store) return res.status(404).json({ error: 'store not found' });
  const cfg = db.getStoreSecrets(req.params.id);
  let body = req.body;
  try { body = JSON.parse(req.body.toString()); } catch { /* keep raw */ }
  db.logIntegration('store', req.params.id, 'webhook_checkout_received', 'success', store.platform, { headers: pickHeaders(req.headers) }, body);

  const adapter = platforms.getAdapter(cfg.platform);
  if (!adapter || typeof adapter.parseCheckoutWebhook !== 'function') {
    return res.json({ ok: true, message: 'adapter does not support checkout capture' });
  }
  try {
    const checkout = adapter.parseCheckoutWebhook(req.headers, body, cfg);
    if (!checkout || checkout.skip) return res.status(200).json({ ok: true, message: checkout ? 'skipped (no contact info yet)' : 'invalid signature or payload' });

    const externalId = checkout.lightfunnelsId || checkout.shopifyId || '';
    const data = loadData();
    const existing = externalId
      ? data.orders.find(o => o.storeId === store.id && o.shopifyId === externalId && o.source === (cfg.platform + '_abandoned'))
      : null;

    const fields = {
      client: checkout.client || 'Client', phone: normalizePhone(checkout.phone || ''),
      product: checkout.product || '', productVariant: checkout.productVariant || '',
      quantity: checkout.quantity || 1, price: parseFloat(checkout.price || 0),
      wilaya: checkout.wilaya || '', commune: checkout.commune || '',
    };

    if (existing) {
      const patch = {};
      for (const [k, v] of Object.entries(fields)) { if (v && !existing[k]) patch[k] = v; }
      if (Object.keys(patch).length) db.patchOrder(existing.id, patch);
      return res.status(200).json({ ok: true, id: existing.id, message: 'updated' });
    }

    const agent = resolveAgent('');
    const cart = {
      id: genId(data.orders), storeId: store.id, shopifyId: externalId, shopifyName: '',
      ...fields, agent, orderType: 'abandoned', status: 'abandoned',
      note: checkout.note || '', managerNote: '',
      delivery: 'zr', deliveryStatus: '', trackingNumber: '',
      source: cfg.platform + '_abandoned', createdAt: Date.now(),
    };
    const saved = db.insertOrder(cart);
    logInfo('store', 'cart imported from checkout webhook', { id: cart.id, storeId: store.id, agent });
    notifyNewOrder(saved, agent, 'abandoned_cart');
    db.logIntegration('store', req.params.id, 'webhook_checkout_created', 'success', store.platform, {}, { orderId: cart.id });
    return res.status(200).json({ ok: true, id: cart.id });
  } catch (e) {
    logError('store', 'checkout webhook save failed', { err: e.message });
    db.logIntegration('store', req.params.id, 'webhook_checkout_received', 'failure', e.message, null, { error: e.message });
    return res.status(200).json({ ok: true }); // acknowledge anyway -- don't make the platform retry a bug on our end
  }
});

// "contact/updated"-style events -- CONFIRMED (from LightFunnels' own docs
// example) to carry the full Customer object (name/email/phone/address),
// unlike checkout/created and checkout/updated which are permanently
// bare-id-only pings (verified against their own documented example, not
// a guess). This is the real lead-capture path: register a THIRD webhook
// (event: "Contact updated", or "New sign up" / "New contact form" if that
// one turns out to be the actual match instead -- try contact/updated
// first) pointing at this URL. Lands as an 'abandoned'-status row, same as
// the checkout route above, so it's still clearly separated from real orders.
app.post('/webhook/store/:id/contact', express.raw({ type: '*/*' }), async (req, res) => {
  const store = db.getStore(req.params.id);
  if (!store) return res.status(404).json({ error: 'store not found' });
  const cfg = db.getStoreSecrets(req.params.id);
  let body = req.body;
  try { body = JSON.parse(req.body.toString()); } catch { /* keep raw */ }
  db.logIntegration('store', req.params.id, 'webhook_contact_received', 'success', store.platform, { headers: pickHeaders(req.headers) }, body);

  const adapter = platforms.getAdapter(cfg.platform);
  if (!adapter || typeof adapter.parseContactWebhook !== 'function') {
    return res.json({ ok: true, message: 'adapter does not support contact capture' });
  }
  try {
    const contact = adapter.parseContactWebhook(req.headers, body, cfg);
    if (!contact || contact.skip) return res.status(200).json({ ok: true, message: contact ? 'skipped (no contact info yet)' : 'invalid signature or payload' });

    const externalId = contact.lightfunnelsId || contact.shopifyId || '';
    const data = loadData();
    const existing = externalId
      ? data.orders.find(o => o.storeId === store.id && o.shopifyId === externalId && o.source === (cfg.platform + '_abandoned'))
      : null;

    const fields = {
      client: contact.client || 'Client', phone: normalizePhone(contact.phone || ''),
      wilaya: contact.wilaya || '', commune: contact.commune || '',
    };

    if (existing) {
      const patch = {};
      for (const [k, v] of Object.entries(fields)) { if (v && !existing[k]) patch[k] = v; }
      if (Object.keys(patch).length) db.patchOrder(existing.id, patch);
      return res.status(200).json({ ok: true, id: existing.id, message: 'updated' });
    }

    const agent = resolveAgent('');
    const lead = {
      id: genId(data.orders), storeId: store.id, shopifyId: externalId, shopifyName: '',
      ...fields, agent, orderType: 'abandoned', status: 'abandoned',
      product: '', productVariant: '', quantity: 1, price: 0,
      note: contact.note || '', managerNote: '',
      delivery: 'zr', deliveryStatus: '', trackingNumber: '',
      source: cfg.platform + '_abandoned', createdAt: Date.now(),
    };
    const saved = db.insertOrder(lead);
    logInfo('store', 'lead imported from contact webhook', { id: lead.id, storeId: store.id, agent });
    notifyNewOrder(saved, agent, 'abandoned_cart');
    db.logIntegration('store', req.params.id, 'webhook_contact_created', 'success', store.platform, {}, { orderId: lead.id });
    return res.status(200).json({ ok: true, id: lead.id });
  } catch (e) {
    logError('store', 'contact webhook save failed', { err: e.message });
    db.logIntegration('store', req.params.id, 'webhook_contact_received', 'failure', e.message, null, { error: e.message });
    return res.status(200).json({ ok: true });
  }
});

// Direct lead capture -- called from a small script embedded on the
// LightFunnels checkout page itself (see the companion snippet), NOT from
// a LightFunnels webhook. Built after confirming (via their own docs and
// six different real-webhook tests) that NO LightFunnels event exposes a
// phone number before the order is either completed or genuinely
// abandoned-and-forgotten. This bypasses their event system entirely: the
// moment a visitor types something phone-shaped into the checkout form,
// the page posts it here directly. CORS is open globally (see `app.use(cors())`
// above) so a cross-origin POST from the LightFunnels domain works as-is.
// Deliberately tiny surface: no signature/secret to configure on this one
// (nothing sensitive is being sent, and requiring a webhook secret here
// would mean embedding it in public page JS, defeating its purpose) --
// dedup and the 'abandoned' status tagging follow the exact same pattern
// as the contact/checkout routes above.
app.post('/webhook/store/:id/lead-capture', express.json(), async (req, res) => {
  const store = db.getStore(req.params.id);
  if (!store) return res.status(404).json({ error: 'store not found' });
  const b = req.body || {};
  const phone = normalizePhone(String(b.phone || '').trim());
  if (!phone || phone.length < 8) return res.status(200).json({ ok: true, message: 'no usable phone yet' });

  db.logIntegration('store', req.params.id, 'lead_capture_received', 'success', store.platform || '', {}, b);

  const data = loadData();
  const existing = data.orders.find(o => o.storeId === store.id && o.phone === phone && o.source === ((store.platform || '') + '_abandoned') && (Date.now() - o.createdAt) < 24 * 3600 * 1000);

  const fields = {
    client: b.name || 'Client', product: b.product || '', wilaya: b.wilaya || '', commune: b.commune || '',
  };

  if (existing) {
    const patch = {};
    for (const [k, v] of Object.entries(fields)) { if (v && !existing[k]) patch[k] = v; }
    if (Object.keys(patch).length) db.patchOrder(existing.id, patch);
    return res.status(200).json({ ok: true, id: existing.id });
  }

  const agent = resolveAgent('');
  const pageUrl = String(b.pageUrl || '').slice(0, 300);
  const lead = {
    id: genId(data.orders), storeId: store.id, shopifyId: '', shopifyName: '',
    phone, ...fields, agent, orderType: 'abandoned', status: 'abandoned',
    productVariant: '', quantity: 1, price: 0,
    note: 'Lead capturé depuis la page checkout (avant finalisation)' + (pageUrl ? ' — ' + pageUrl : ''),
    managerNote: '', delivery: 'zr', deliveryStatus: '', trackingNumber: '',
    source: (store.platform || 'lightfunnels') + '_abandoned', createdAt: Date.now(),
  };
  const saved = db.insertOrder(lead);
  logInfo('store', 'lead captured directly from checkout page script', { id: lead.id, storeId: store.id, agent });
  notifyNewOrder(saved, agent, 'abandoned_cart');
  return res.status(200).json({ ok: true, id: lead.id });
});

// "Create product" events -- mirrors handleShopifyProductCreate's dedup-by-
// externalId + linkProductToExternal pattern, generalized to any platform
// via the adapter's parseProductWebhook. Also a separate URL, same reasoning
// as the checkout route above.
app.post('/webhook/store/:id/product', express.raw({ type: '*/*' }), async (req, res) => {
  const store = db.getStore(req.params.id);
  if (!store) return res.status(404).json({ error: 'store not found' });
  const cfg = db.getStoreSecrets(req.params.id);
  let body = req.body;
  try { body = JSON.parse(req.body.toString()); } catch { /* keep raw */ }
  db.logIntegration('store', req.params.id, 'webhook_product_received', 'success', store.platform, { headers: pickHeaders(req.headers) }, body);

  const adapter = platforms.getAdapter(cfg.platform);
  if (!adapter || typeof adapter.parseProductWebhook !== 'function') {
    return res.json({ ok: true, message: 'adapter does not support product sync' });
  }
  try {
    const product = adapter.parseProductWebhook(req.headers, body, cfg);
    if (!product) return res.status(200).json({ ok: true, message: 'invalid signature or payload' });

    const already = db.findProductByExternalId({ storeId: store.id, platform: cfg.platform, externalProductId: product.externalId });
    if (already) {
      return res.status(200).json({ ok: true, message: 'duplicate (already linked)', productId: already.id });
    }

    const newProduct = db.insertProduct({
      id: genProdId(loadProducts()),
      name: product.name || product.externalId,
      sku: '', description: product.description || '',
      price: product.price || 0, variants: product.variants || [],
      image: product.image || '', threshold: 24, stock: 0,
      createdAt: Date.now(),
    });
    db.linkProductToExternal({
      productId: newProduct.id, storeId: store.id, platform: cfg.platform,
      externalProductId: product.externalId, externalVariantId: null,
    });
    logInfo('store', 'product auto-created from product webhook', { productId: newProduct.id, externalId: product.externalId, platform: cfg.platform });
    db.logIntegration('store', req.params.id, 'webhook_product_created', 'success', store.platform, {}, { productId: newProduct.id });
    return res.status(200).json({ ok: true, productId: newProduct.id });
  } catch (e) {
    logError('store', 'product webhook save failed', { err: e.message });
    db.logIntegration('store', req.params.id, 'webhook_product_received', 'failure', e.message, null, { error: e.message });
    return res.status(200).json({ ok: true });
  }
});
function pickHeaders(h) {
  const out = {};
  for (const k of ['x-shopify-topic','x-shopify-hmac-sha256','x-platform','x-event-type','user-agent']) {
    if (h && h[k] !== undefined) out[k] = h[k];
  }
  return out;
}

/* =============================================================================
 * AI PLATFORM — provider registry, agent configs, chat, insights.
 *
 * Mirrors the delivery/store CRUD exactly. No model is hardcoded: each provider
 * row points at a generic adapter + connection details. The AI can only READ
 * CRM data (via lib/ai/context.js, masked + permission-scoped) and is strictly
 * advisory — there is no write/execute capability anywhere in this surface.
 * ========================================================================== */

// ---- AI Providers CRUD ----
app.get('/api/ai/providers', (req, res) => res.json(db.getAiProviders()));
app.get('/api/ai/providers/adapters', (req, res) => res.json(aiProviders.listAdapterKeys()));
app.get('/api/ai/providers/presets/:type', (req, res) => res.json({ presets: aiProviders.getPreset(req.params.type) || null }));

app.post('/api/ai/providers', (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.type) return res.status(400).json({ error: 'name+type required' });
  const saved = db.saveAiProvider(b);
  db.audit('ai_provider', saved.id, 'create', 'admin', { type: b.type });
  res.json(saved);
});
app.put('/api/ai/providers/:id', (req, res) => {
  if (!db.getAiProvider(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const saved = db.saveAiProvider({ ...req.body, id: req.params.id });
  db.audit('ai_provider', saved.id, 'update', 'admin', {});
  res.json(saved);
});
app.delete('/api/ai/providers/:id', (req, res) => {
  db.deleteAiProvider(req.params.id);
  db.audit('ai_provider', req.params.id, 'delete', 'admin', {});
  res.json({ message: 'deleted' });
});
app.post('/api/ai/providers/:id/default', (req, res) => {
  if (!db.getAiProvider(req.params.id)) return res.status(404).json({ error: 'Not found' });
  db.setDefaultAiProvider(req.params.id);
  db.audit('ai_provider', req.params.id, 'set-default', 'admin', {});
  res.json({ message: 'default set' });
});

// Test Connection — validates the AI provider's credentials via its adapter.
app.post('/api/ai/providers/:id/test', async (req, res) => {
  if (!db.getAiProvider(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const cfg = db.getAiProviderSecrets(req.params.id);
  const reqCtx = { type: cfg.type, baseUrl: cfg.baseUrl };
  try {
    const result = await aiProviders.testProviderConnection(req.params.id);
    const ok = !!(result && result.ok !== false);
    db.markAiProviderTested(req.params.id, ok);
    db.logIntegration('ai_provider', req.params.id, 'test_connection', ok ? 'success' : 'failure',
      result.message || (ok ? 'OK' : 'Failed'), reqCtx, result);
    res.json({ ok, message: result.message || (ok ? 'Connection successful' : 'Connection failed'), testedAt: Date.now() });
  } catch (e) {
    db.markAiProviderTested(req.params.id, false);
    db.logIntegration('ai_provider', req.params.id, 'auth_error', 'failure', e.message, reqCtx, { error: e.message });
    res.json({ ok: false, message: e.message, testedAt: Date.now() });
  }
});

// AI provider integration logs (reuses the same integration_logs table).
app.get('/api/ai/providers/:id/logs', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json(db.getIntegrationLogs('ai_provider', req.params.id, limit));
});

// ---- AI Agents CRUD ----
app.get('/api/ai/agents', (req, res) => res.json(db.getAiAgents()));
app.get('/api/ai/agents/enabled', (req, res) => res.json(db.getEnabledAiAgents()));
app.get('/api/ai/permissions', (req, res) => res.json(aiContext.PERMISSIONS));

app.post('/api/ai/agents', (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name required' });
  const saved = db.saveAiAgent(b);
  db.audit('ai_agent', saved.id, 'create', 'admin', { role: b.role });
  res.json(saved);
});
app.put('/api/ai/agents/:id', (req, res) => {
  if (!db.getAiAgent(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const saved = db.saveAiAgent({ ...req.body, id: req.params.id });
  db.audit('ai_agent', saved.id, 'update', 'admin', {});
  res.json(saved);
});
app.delete('/api/ai/agents/:id', (req, res) => {
  db.deleteAiAgent(req.params.id);
  db.audit('ai_agent', req.params.id, 'delete', 'admin', {});
  res.json({ message: 'deleted' });
});

/* ---- AI Chat (full response, fallback) ----
 * Accepts { agentId, message, actor } where actor = { name, scopedAgent? }.
 * Resolves the agent + permissions, builds a grounded prompt from live CRM
 * data, records the turn, and returns the full answer. Used when the provider
 * doesn't stream or the client wants a single payload. */
/* actor and scopedAgent come from the SESSION, never from the request body or
 * query string (audit SEC-03). Both used to be caller-supplied, so the one
 * mechanism that limited an agent to their own orders could be disabled just by
 * omitting it, and any user could read anyone else's conversation history by
 * passing a different ?actor=. */
function aiActorFor(req) {
  return {
    name: req.user.name,
    // Managers see everything; everyone else is pinned to their own orders.
    scopedAgent: req.user.isManager ? undefined : req.user.name,
  };
}

app.post('/api/ai/chat', async (req, res) => {
  const b = req.body || {};
  const agent = aiAgents.resolveAgent(b.agentId, { isManager: req.user.isManager });
  const actor = aiActorFor(req);
  const history = conversations.load(actor.name, agent.id, { maxTokens: 3000, limit: 16 });
  let messages;
  try {
    ({ messages } = aiAgents.buildMessages({ agent, history, question: b.message, actor }));
  } catch (e) {
    return res.json({ ok: false, error: e.message, code: e.code || 'BUILD_ERROR' });
  }
  try {
    const result = await aiProviders.chat({ providerId: agent.providerId, messages, model: agent.model, temperature: 0.5 });
    conversations.record(actor.name, agent.id, 'user', b.message);
    conversations.record(actor.name, agent.id, 'assistant', result.text);
    res.json({ ok: true, text: result.text, usage: result.usage, model: result.model });
  } catch (e) {
    logError('ai-chat', 'chat failed', { err: e.message, code: e.code });
    db.logIntegration('ai_provider', agent.providerId || 'none', 'chat_error', 'failure', e.message, { agentId: agent.id }, { error: e.message });
    res.json({ ok: false, error: e.message, code: e.code || 'CHAT_ERROR' });
  }
});

/* ---- AI Chat (SSE streaming) ----
 * GET so it works with the browser EventSource API, like the notification
 * stream. Query: ?agentId=&message=&actor=&scopedAgent=. Streams tokens when the
 * provider supports it; otherwise performs a full call and emits one chunk. */
app.get('/api/ai/chat/stream', async (req, res) => {
  const agent = aiAgents.resolveAgent(req.query.agentId, { isManager: req.user.isManager });
  const { name: actorName, scopedAgent } = aiActorFor(req);   // never from the query string
  const message = req.query.message || '';
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();
  const send = (obj) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch (e) { /* client gone */ } };
  send({ type: 'connected', agent: agent.name });

  const history = conversations.load(actorName, agent.id, { maxTokens: 3000, limit: 16 });
  let messages;
  try {
    ({ messages } = aiAgents.buildMessages({ agent, history, question: message, actor: { name: actorName, scopedAgent } }));
  } catch (e) {
    send({ type: 'error', error: e.message, code: e.code }); return res.end();
  }

  const stream = aiProviders.streamChat({ providerId: agent.providerId, messages, model: agent.model, temperature: 0.5 });
  if (!stream) {
    // Provider can't stream — do a full call and emit it as a single chunk.
    try {
      const result = await aiProviders.chat({ providerId: agent.providerId, messages, model: agent.model, temperature: 0.5 });
      send({ type: 'delta', delta: result.text });
      send({ type: 'done', text: result.text, usage: result.usage });
      conversations.record(actorName, agent.id, 'user', message);
      conversations.record(actorName, agent.id, 'assistant', result.text);
    } catch (e) {
      send({ type: 'error', error: e.message, code: e.code });
    }
    return res.end();
  }

  // Provider streams — forward each delta, accumulate, persist on completion.
  let full = '';
  try {
    for await (const chunk of stream.generator) {
      if (chunk.delta) { full += chunk.delta; send({ type: 'delta', delta: chunk.delta }); }
      if (Object.prototype.hasOwnProperty.call(chunk, 'text')) {
        full = chunk.text || full;
        send({ type: 'done', text: full, usage: chunk.usage || null });
      }
    }
    conversations.record(actorName, agent.id, 'user', message);
    conversations.record(actorName, agent.id, 'assistant', full);
  } catch (e) {
    send({ type: 'error', error: e.message, code: e.code });
    logError('ai-chat', 'stream failed', { err: e.message });
  } finally {
    res.end();
  }
});

// ---- Conversation history management ----
// Your own history only — `actor` was previously a query parameter, so anyone
// could read anyone else's AI conversation by naming them (audit SEC-03).
app.get('/api/ai/conversations/:agentId', (req, res) => {
  res.json({ items: conversations.load(req.user.name, req.params.agentId, { maxTokens: 6000, limit: 40 }) });
});
app.delete('/api/ai/conversations/:agentId', (req, res) => {
  conversations.clear(req.user.name, req.params.agentId);
  res.json({ message: 'cleared' });
});

/* ---- AI Insights ----
 * Instant deterministic rules (no model): orders needing attention, low-confirm
 * agents, high-cancellation products, delivery delays, duplicates, summaries. */
app.get('/api/ai/insights', (req, res) => {
  const agent = aiAgents.resolveAgent(req.query.agentId, { isManager: req.user.isManager });
  res.json(aiInsights.computeInsights(agent.permissions || []));
});

// Deep AI analysis — model explains the deterministic insights + suggests actions.
app.post('/api/ai/insights/deep', async (req, res) => {
  const agent = aiAgents.resolveAgent(req.body?.agentId, { isManager: req.user.isManager });
  try {
    const text = await aiInsights.summarizeInsights({ providerId: agent.providerId, agent, permissions: agent.permissions || [] });
    res.json({ ok: true, text });
  } catch (e) {
    logError('ai-insights', 'deep analysis failed', { err: e.message });
    res.json({ ok: false, error: e.message, code: e.code });
  }
});

/* =============================================================================
 * NOTIFICATIONS — persistent store (also pushed live via SSE broadcast).
 * ========================================================================== */
/* History for the signed-in account, newest first. This endpoint existed but
 * had no caller, so notifications were live-only: everything vanished on
 * refresh and the badge reset to zero. Both clients now load this on boot. */
app.get('/api/notifications', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const beforeId = req.query.beforeId ? Number(req.query.beforeId) : null;
  res.json({
    items: db.getNotifications(req.user, { limit, beforeId }),
    unread: db.getUnreadCount(req.user),
    lastReadId: db.getLastReadNotificationId(req.user.name),
  });
});

/* Advance this account's read watermark. `upToId` is the newest id the client
 * has actually displayed — passing it (rather than "mark everything") means a
 * notification arriving between render and click is not silently swallowed. */
app.post('/api/notifications/read', (req, res) => {
  const upToId = req.body?.upToId ?? req.body?.olderThanId ?? null;
  const lastReadId = db.markNotificationsRead(req.user.name, upToId);
  res.json({ message: 'marked read', unread: db.getUnreadCount(req.user), lastReadId });
});

// --- Delivery status labels (for the UI) ---
app.get('/api/delivery/statuses', (req, res) => {
  const sm = require('./lib/statusMap');
  res.json({ statuses: sm.CRM_STATUSES, labels: sm.CRM_STATUS_LABEL, terminal: sm.TERMINAL_STATUSES });
});

/* =============================================================================
 * FAKE ORDERS — orthogonal classification (req §3).
 * 'fake' is NOT a status; it lives in orders.classification so it never touches
 * the existing confirmation/cancellation lifecycle. Stats, filters, and reports
 * key off this field separately.
 * ========================================================================== */
app.post('/api/orders/:id/classify', (req, res) => {
  const order = db.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Not found' });
  const { classification, reason, responsible } = req.body || {};
  const cls = classification === 'fake' ? 'fake' : '';
  const patch = {
    classification: cls,
    fakeReason: reason || '',
    fakeResponsible: responsible || '',
    fakeAt: cls === 'fake' ? Date.now() : null,
  };
  const updated = db.patchOrder(order.id, patch);
  db.audit('order', order.id, 'classify', req.body?.actor || 'admin', patch);
  broadcast({ type: 'order_classified', orderId: order.id, classification: cls }, updated.agent || null);
  res.json(updated);
});

/* =============================================================================
 * CONFIRMATION ATTEMPTS — Day 1-3 × Tentative 1-3 matrix (req §2).
 * Derived from the existing order_calls audit trail (the permanent record), so
 * no new table is needed. Each call maps to a (day, tentative) slot:
 *   day = ceil(callIndex/3),  tentative = ((callIndex-1) % 3) + 1
 * ========================================================================== */
app.get('/api/orders/:id/attempts', (req, res) => {
  const order = db.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Not found' });
  const calls = order.calls || [];
  // 9 slots: Day 1-3 × Tentative 1-3
  const matrix = [];
  for (let day = 1; day <= 3; day++) {
    for (let tentative = 1; tentative <= 3; tentative++) {
      matrix.push({ day, tentative, attempt: null });
    }
  }
  calls.forEach((c, i) => {
    const idx = i;                       // 0-based call index
    const day = Math.floor(idx / 3) + 1; // 1..3 (and beyond, clamped)
    const tentative = (idx % 3) + 1;     // 1..3
    if (day <= 3) {
      const slot = matrix.find(m => m.day === day && m.tentative === tentative);
      if (slot) {
        slot.attempt = {
          date: c.time,
          time: c.time,
          duration: c.duration,
          result: c.result,
          agent: c.agent || '',
          note: c.note || '',
          callStartTime: c.callStartTime,
          suspicious: c.suspicious,
        };
      }
    }
  });
  res.json({
    orderId: order.id,
    totalCalls: calls.length,
    matrix,
    // Flat history for the audit-style display
    calls: calls.map((c, i) => ({
      index: i + 1,
      day: Math.floor(i / 3) + 1,
      tentative: (i % 3) + 1,
      date: c.time, time: c.time, duration: c.duration,
      result: c.result, agent: c.agent || '', note: c.note || '',
      callStartTime: c.callStartTime, suspicious: c.suspicious,
    })),
  });
});

/* =============================================================================
 * INVENTORY — per-variant stock, thresholds, and the append-only ledger
 * (req §8, §10). The ledger is INSERT-ONLY: these routes read history and
 * record movements, never overwrite them.
 * ========================================================================== */
app.get('/api/products/:id/inventory', (req, res) => {
  const inv = inventory.getInventory(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Not found' });
  res.json(inv);
});

// Set per-variant stock + threshold (used by the inventory editor). Each stock
// change is appended to inventory_movements in the same transaction.
app.put('/api/products/:id/variants', (req, res) => {
  const product = db.getProduct(req.params.id);
  if (!product) return res.status(404).json({ error: 'Not found' });
  const { variants } = req.body || {};
  if (!Array.isArray(variants)) return res.status(400).json({ error: 'variants array required' });
  const actor = req.body?.actor || 'admin';
  for (const v of variants) {
    if (!v.name) continue;
    if (v.stock !== undefined && v.stock !== null) {
      inventory.setVariantStock({ productId: req.params.id, variantName: v.name, newQty: v.stock, actor });
    }
    if (v.threshold !== undefined && v.threshold !== null) {
      inventory.setVariantThreshold(req.params.id, v.name, v.threshold);
    }
  }
  res.json(inventory.getInventory(req.params.id));
});

// Two-mode restock (req #4 — "add stock" with either a new purchase price
// or a no-cost return). 'purchase' opens a fresh FIFO lot at the entered
// price; 'return' has no price to enter — it rejoins the oldest lot.
app.post('/api/products/:id/stock-lots', (req, res) => {
  const product = db.getProduct(req.params.id);
  if (!product) return res.status(404).json({ error: 'Not found' });
  const { variantName, mode, qty, unitCost, packagingCost, actor } = req.body || {};
  const qtyNum = Number(qty);
  if (!qtyNum || qtyNum <= 0) return res.status(400).json({ error: 'qty must be a positive number' });
  let result;
  if (mode === 'return') {
    result = inventory.addReturnStock({ productId: req.params.id, variantName: variantName || '', qty: qtyNum, actor: actor || 'admin' });
  } else if (mode === 'purchase') {
    result = inventory.addStockLot({ productId: req.params.id, variantName: variantName || '', qty: qtyNum, unitCost: Number(unitCost) || 0, packagingCost: Number(packagingCost) || 0, actor: actor || 'admin' });
  } else {
    return res.status(400).json({ error: "mode must be 'purchase' or 'return'" });
  }
  if (!result) return res.status(400).json({ error: 'variant not found or no change' });
  res.json({ ok: true, ...result, inventory: inventory.getInventory(req.params.id) });
});

// Active + exhausted cost lots for one variant — the "batches" panel.
app.get('/api/products/:id/stock-lots', (req, res) => {
  const product = db.getProduct(req.params.id);
  if (!product) return res.status(404).json({ error: 'Not found' });
  res.json(inventory.getLots(req.params.id, req.query.variantName || ''));
});

// Manual adjustment with a reason — always appends to the ledger.
app.post('/api/products/:id/inventory/adjust', (req, res) => {
  const product = db.getProduct(req.params.id);
  if (!product) return res.status(404).json({ error: 'Not found' });
  const { variantName, delta, reason, actor } = req.body || {};
  const result = inventory.applyMovement({
    productId: req.params.id,
    variantName: variantName || '',
    delta: Number(delta) || 0,
    reason: reason || 'adjustment',
    actor: actor || 'admin',
  });
  if (!result) return res.status(400).json({ error: 'variant not found or no change' });
  res.json({ ok: true, ...result, inventory: inventory.getInventory(req.params.id) });
});

// Append-only movement history (newest-first by default).
app.get('/api/products/:id/inventory/history', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  const variant = req.query.variant;
  res.json({ items: inventory.getHistory(req.params.id, variant === 'all' ? undefined : variant) });
});

// Low-stock alerts across all products/variants — feeds the dashboard + banner.
app.get('/api/inventory/low-stock', (req, res) => {
  const defaultThreshold = Number(req.query.threshold) || 24;
  res.json({ items: inventory.listLowStock(defaultThreshold) });
});

/* =============================================================================
 * CLIENTS — permanent customer registry (architecture upgrade, phase A).
 * Auto-populated by db.insertOrder/saveOrder on every order write; never
 * deleted by anything, including DELETE /api/orders/:id above.
 * ========================================================================== */
app.get('/api/clients', (req, res) => {
  const { search = '', sort = 'lastOrderAt', wilaya, product, niche, store, minOrders, minDelivered, since, until } = req.query;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;
  const filters = { search, sort, limit, offset, wilaya, product, niche, store, minOrders, minDelivered, since, until };
  res.json({
    items: db.getClients(filters),
    total: db.countClients(filters),
  });
});
app.get('/api/clients/filter-options', (req, res) => res.json(db.getClientFilterOptions()));

app.get('/api/clients/:id', (req, res) => {
  const client = db.getClient(req.params.id);
  if (!client) return res.status(404).json({ error: 'Not found' });
  res.json({ ...client, history: db.getClientOrderHistory(client.phone) });
});

// Manual correction of the fields that have no reliable auto-source
// (address) or might need a typo fix without waiting for the next order.
// Never touches the lifetime counters — those only ever move via orders.
app.put('/api/clients/:id', (req, res) => {
  const { name, wilaya, commune, address } = req.body || {};
  const updated = db.updateClientDetails(req.params.id, { name, wilaya, commune, address });
  if (!updated) return res.status(404).json({ error: 'Not found' });
  res.json(updated);
});

// Client import (phase B): the browser parses the CSV/Excel file and maps
// columns (see index.html) — this layer only ever receives clean records.
app.post('/api/clients/import/preview', (req, res) => {
  const records = Array.isArray(req.body?.records) ? req.body.records : [];
  if (!records.length) return res.status(400).json({ error: 'No records provided' });
  res.json(db.previewImportClients(records));
});
app.post('/api/clients/import', (req, res) => {
  const records = Array.isArray(req.body?.records) ? req.body.records : [];
  const source = req.body?.source || 'Import';
  if (!records.length) return res.status(400).json({ error: 'No records provided' });
  res.json(db.importClients(records, source));
});

/* =============================================================================
 * UNEXPECTED CHARGES — one-off dated expenses for the profit calculator.
 * Fixed (recurring) costs reuse the existing generic /api/settings endpoint
 * (fixedCosts is just another settings key) — no new route needed for those.
 * ========================================================================== */
/** Same normalization as lib/inventory.js's resolveLines (not exported from
 *  there, so duplicated here deliberately rather than cross-importing an
 *  internal helper) — keeps a ™ symbol / extra space / casing difference
 *  from silently breaking the product match. */
function normalizeProductNameForCalc(s) {
  return String(s || '').replace(/\u00A0/g, ' ').trim().toLowerCase().replace(/[™®©]/g, '').replace(/\s+/g, ' ');
}

/** Real sales summary for ONE product within a date range — the actual data
 * source for the profit calculator's auto-fill (spec: "Unités Vendues",
 * "Retours", "CA Réel"). Matches by Shopify product id first (exact), falls
 * back to normalized name (see product_links / normalizeProductNameForCalc)
 * — the SAME precedence used for stock decrementing, so the numbers the
 * calculator shows are consistent with what actually moved stock. */
app.get('/api/products/:id/sales-summary', (req, res) => {
  const product = db.getProduct(req.params.id);
  if (!product) return res.status(404).json({ error: 'Not found' });
  const since = req.query.since ? Number(req.query.since) : 0;
  const until = req.query.until ? Number(req.query.until) : Date.now();

  const matchesThisProduct = (order) => {
    if (order.shopifyProductId) {
      const link = db.findProductByExternalId({ storeId: order.storeId || null, platform: order.platform || 'shopify', externalProductId: order.shopifyProductId });
      if (link) return link.id === product.id;
    }
    return normalizeProductNameForCalc(order.product) === normalizeProductNameForCalc(product.name);
  };

  const delivered = db.getOrdersByDeliveryOutcome({ outcome: 'delivered', since, until }).filter(matchesThisProduct);
  const returned  = db.getOrdersByDeliveryOutcome({ outcome: 'returned',  since, until }).filter(matchesThisProduct);
  const realCA = delivered.reduce((s, o) => s + (Number(o.price) || 0), 0);

  // Real cost of goods for exactly these delivered orders (req #4): pull the
  // per-unit cost each order's 'reserve'/'confirm' movement actually
  // recorded (i.e. whichever FIFO lot(s) it consumed at the time), NOT the
  // product's current flat costPrice — a product bought at 1000 DA last
  // month and 1400 DA this month must show each sale at the price that was
  // TRUE when it sold, not today's price applied retroactively. Orders with
  // no cost on their movement (pre-dates the lot feature, or reservationMode
  // was 'none' when they were confirmed) fall back to the flat product cost
  // for exactly those units, so the number is always real, never zero.
  let costUnitTotal = 0, costPackTotal = 0, costedQty = 0, fallbackQty = 0;
  delivered.forEach(o => {
    const qty = Math.max(1, Number(o.quantity) || 1);
    const movements = db.getMovementsForOrder(o.id).filter(m => m.reason === 'reserve' || m.reason === 'confirm');
    if (movements.length) {
      movements.forEach(m => {
        const mQty = Math.abs(Number(m.delta) || 0);
        if (m.unitCost !== null && m.unitCost !== undefined) {
          costUnitTotal += mQty * m.unitCost;
          costPackTotal += mQty * (m.packagingCost || 0);
          costedQty += mQty;
        } else {
          costUnitTotal += mQty * (Number(product.costPrice) || 0);
          costPackTotal += mQty * (Number(product.packagingCost) || 0);
          fallbackQty += mQty;
        }
      });
    } else {
      // No movement at all for this order (reservationMode was 'none', or
      // it predates inventory tracking entirely) — still use the flat cost
      // for its quantity rather than silently excluding it from COGS.
      costUnitTotal += qty * (Number(product.costPrice) || 0);
      costPackTotal += qty * (Number(product.packagingCost) || 0);
      fallbackQty += qty;
    }
  });
  const totalCostedUnits = costedQty + fallbackQty;
  const avgBuyPrice = totalCostedUnits ? (costUnitTotal / totalCostedUnits) : (Number(product.costPrice) || 0);
  const avgPackagingCost = totalCostedUnits ? (costPackTotal / totalCostedUnits) : (Number(product.packagingCost) || 0);

  res.json({
    productId: product.id, productName: product.name,
    since, until,
    deliveredCount: delivered.length,
    returnedCount: returned.length,
    realCA,
    // Period-accurate buy/packaging price, blended from whatever FIFO lots
    // actually got sold in this window — this is what lets the profit
    // calculator auto-fill the RIGHT price even after a purchase-price
    // change, instead of the manager re-typing it by hand every time.
    avgBuyPrice, avgPackagingCost,
    totalCostOfGoods: costUnitTotal + costPackTotal,
    costTrackedUnits: costedQty, costFallbackUnits: fallbackQty,
  });
});

app.get('/api/push/vapid-public-key', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY || null });
});
app.post('/api/push/subscribe', (req, res) => {
  const { agent, subscription } = req.body || {};
  if (!agent || !subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return res.status(400).json({ error: 'agent + valid subscription required' });
  }
  const saved = db.addPushSubscription({
    agent, endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh, auth: subscription.keys.auth,
  });
  res.json({ message: 'subscribed', id: saved?.id });
});

app.get('/api/unexpected-charges', (req, res) => {
  const since = req.query.since ? Number(req.query.since) : undefined;
  const until = req.query.until ? Number(req.query.until) : undefined;
  res.json({ items: db.listUnexpectedCharges(since, until) });
});
app.post('/api/unexpected-charges', (req, res) => {
  const { label, amount, date } = req.body || {};
  if (!label || !amount) return res.status(400).json({ error: 'label+amount required' });
  const saved = db.addUnexpectedCharge({ label, amount, date: date || Date.now() });
  res.json(saved);
});
app.delete('/api/unexpected-charges/:id', (req, res) => {
  db.deleteUnexpectedCharge(req.params.id);
  res.json({ message: 'deleted' });
});

/* =============================================================================
 * FINANCIAL RECORDS — permanent P&L history + aggregation (architecture
 * upgrade, phase D). See lib/db.js's financial_records table comment for
 * the full immutability contract.
 * ========================================================================== */
app.get('/api/financial-records', (req, res) => {
  const periodType = req.query.periodType || undefined;
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Number(req.query.offset) || 0;
  res.json({ items: db.getFinancialRecords({ periodType, limit, offset }) });
});
app.get('/api/financial-records/versions', (req, res) => {
  const { periodType, startDate, endDate } = req.query;
  if (!periodType || !startDate || !endDate) return res.status(400).json({ error: 'periodType, startDate, endDate required' });
  res.json({ items: db.getFinancialRecordVersions(periodType, Number(startDate), Number(endDate)) });
});
app.post('/api/financial-records', (req, res) => {
  const { periodType, startDate, endDate, revenue, productCosts, shippingCosts, advertisingCosts,
    fixedExpenses, unexpectedExpenses, notes, source, productBreakdown, actor } = req.body || {};
  if (!periodType || startDate === undefined || endDate === undefined) {
    return res.status(400).json({ error: 'periodType, startDate, endDate required' });
  }
  const saved = db.saveFinancialRecord({
    periodType, startDate, endDate, revenue, productCosts, shippingCosts, advertisingCosts,
    fixedExpenses, unexpectedExpenses, notes, source, productBreakdown, actor: actor || 'admin',
  });
  res.json(saved);
});
// Rolls up already-saved sub-period records (weeks->month, months->quarter/
// year) — does NOT touch orders/inventory at all, per req §6 ("never
// recalculate old periods"). Returns a COMPUTED result; nothing is saved
// unless the manager then POSTs it via /api/financial-records themselves
// (with source:'aggregated').
app.get('/api/financial-records/aggregate', (req, res) => {
  const { periodType, startDate, endDate } = req.query;
  if (!periodType || !startDate || !endDate) return res.status(400).json({ error: 'periodType, startDate, endDate required' });
  res.json(db.aggregateFinancialPeriod(periodType, Number(startDate), Number(endDate)));
});
// The auto-prorated fixed-expense figure for a given period (req §7) — the
// calculator UI calls this instead of re-deriving the ÷4 / ×N / day-count
// rule itself, so the ONE rule lives in exactly one place.
app.get('/api/financial-records/prorate-fixed', (req, res) => {
  const { periodType, startDate, endDate } = req.query;
  if (!periodType) return res.status(400).json({ error: 'periodType required' });
  res.json({
    periodType,
    monthlyTotal: db.getMonthlyFixedCostsTotal(),
    prorated: db.prorateFixedExpenses(periodType, Number(startDate) || 0, Number(endDate) || 0),
  });
});

/* =============================================================================
 * FOLLOW-UP (SUIVI DES COMMANDES) department — req §1.
 * Dashboard buckets, assignment (auto/manual), and reminder resolution.
 * ========================================================================== */
app.get('/api/followup/dashboard', (req, res) => {
  res.json(followup.dashboard());
});

// Assign a follow-up agent: explicit agent (manual) or auto workload-balance.
app.post('/api/followup/assign', (req, res) => {
  const { orderId, agent, auto } = req.body || {};
  const order = db.getOrder(orderId);
  if (!order) return res.status(404).json({ error: 'order not found' });
  const chosen = followup.assignFollowup(orderId, { agent, auto, actor: req.body?.actor || 'admin' });
  if (chosen) broadcast({ type: 'followup_assigned', orderId, agent: chosen }, chosen);
  res.json({ ok: !!chosen, agent: chosen, order: db.getOrder(orderId) });
});

// Resolve a call-reminder task (the agent contacted the customer).
app.post('/api/followup/tasks/:id/resolve', (req, res) => {
  const task = db.getFollowupTask(req.params.id);
  if (!task) return res.status(404).json({ error: 'task not found' });
  // Resolving a reminder asserts "I contacted this customer" — an agent must
  // not be able to close out somebody else's task, whether by accident or to
  // hide an overdue one.
  if (!req.user.isManager && task.agent && task.agent !== req.user.name) {
    return res.status(403).json({ error: 'This follow-up task is not assigned to you', code: 'NOT_YOUR_TASK' });
  }
  followup.resolveReminder(task.orderId, task.id, req.user.name);
  broadcast({ type: 'followup_resolved', orderId: task.orderId, taskId: task.id }, task.agent || null);
  res.json({ ok: true, task: db.getFollowupTask(req.params.id) });
});

// Open follow-up tasks (optionally filtered by agent) — for the agent panel.
/* The `agent` filter was taken straight from the query string, so any agent
 * could list another agent's follow-up queue — or omit it entirely and get
 * every open task in the business. A manager may still filter freely; everyone
 * else is pinned to their own name regardless of what they asked for. */
app.get('/api/followup/tasks', (req, res) => {
  const filter = {};
  if (req.user.isManager) {
    if (req.query.agent) filter.agent = req.query.agent;
  } else {
    filter.agent = req.user.name;
  }
  if (req.query.status) filter.status = req.query.status;
  res.json({ items: db.getFollowupTasks(filter) });
});

/* =============================================================================
 * BULK OPERATIONS — professional multi-select actions (req §6).
 * A single transactional endpoint dispatches assign / status / delete /
 * createShipments / sendToDelivery / export / print, returning per-id results.
 * ========================================================================== */
app.post('/api/orders/bulk', async (req, res) => {
  const { ids, action, value, actor } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids[] required' });
  const results = [];
  for (const id of ids) {
    try {
      const order = db.getOrder(id);
      if (!order) { results.push({ id, ok: false, error: 'not found' }); continue; }

      if (action === 'assign') {
        const updated = db.patchOrder(id, { agent: value });
        broadcast({ type: 'order_assigned', order: updated }, value);
        sendPushToAgent(value, { title: '📦 طلب جديد', body: updated.id + ' — ' + (updated.client || '') });
        results.push({ id, ok: true });
      }
      else if (action === 'status') {
        if (!ORDER_STATUSES.includes(value)) { results.push({ id, ok: false, error: 'invalid status' }); continue; }
        // Restore stock if cancelling a confirmed order in bulk.
        if (value === 'cancelled' && order.status === 'confirmed') {
          try { inventory.releaseOnCancel(order, actor || 'admin'); } catch (e) {}
        }
        const updated = db.patchOrder(id, { status: value });
        results.push({ id, ok: true, status: value });
      }
      else if (action === 'classify') {
        const cls = value === 'fake' ? 'fake' : '';
        db.patchOrder(id, {
          classification: cls,
          fakeReason: req.body.reason || '',
          fakeResponsible: req.body.responsible || '',
          fakeAt: cls === 'fake' ? Date.now() : null,
        });
        results.push({ id, ok: true });
      }
      else if (action === 'assignFollowup') {
        const chosen = followup.assignFollowup(id, { agent: value, auto: !value, actor: actor || 'admin' });
        results.push({ id, ok: !!chosen, followupAgent: chosen });
      }
      else if (action === 'delete') {
        db.deleteOrder(id);
        results.push({ id, ok: true });
      }
      else if (action === 'createShipments') {
        const fresh = db.getOrder(id);
        const shipment = await providers.createShipmentForOrder(fresh, { actor: actor || 'admin' });
        results.push({ id, ok: true, shipmentId: shipment?.id, trackingNumber: shipment?.trackingNumber });
      }
      else if (action === 'sendToDelivery') {
        // value = provider code/id; stamp it on the order + (re)create shipment.
        if (value) db.patchOrder(id, { delivery: value, providerId: '' });
        const fresh = db.getOrder(id);
        const shipment = await providers.createShipmentForOrder(fresh, { actor: actor || 'admin' });
        results.push({ id, ok: true, shipmentId: shipment?.id });
      }
      else if (action === 'export' || action === 'print') {
        // No server-side mutation — the client collects the orders and builds the
        // file/label. We just confirm the ids are valid.
        results.push({ id, ok: true });
      }
      else {
        results.push({ id, ok: false, error: 'unknown action' });
      }
    } catch (e) {
      logError('bulk', 'action failed', { id, action, err: e.message });
      results.push({ id, ok: false, error: e.message });
    }
  }
  res.json({ action, processed: results.length, succeeded: results.filter(r => r.ok).length, results });
});

/* =============================================================================
 * DELIVERY COMPANY SELECTOR — default carrier per store (req §7).
 * The order form + confirm flow read the provider list from /api/providers;
 * this endpoint exposes the per-store default so the UI can preselect it.
 * ========================================================================== */
app.get('/api/stores/:id/default-carrier', (req, res) => {
  const store = db.getStore(req.params.id);
  if (!store) return res.status(404).json({ error: 'Not found' });
  const map = db.getSettings().defaultCarrierByStore || {};
  res.json({ storeId: store.id, carrier: map[store.id] || '' });
});
app.put('/api/stores/:id/default-carrier', (req, res) => {
  const store = db.getStore(req.params.id);
  if (!store) return res.status(404).json({ error: 'Not found' });
  const cur = db.getSettings();
  const map = { ...(cur.defaultCarrierByStore || {}) };
  map[req.params.id] = req.body?.carrier || '';
  db.setSettings({ defaultCarrierByStore: map });
  db.audit('store', req.params.id, 'set-default-carrier', 'admin', { carrier: req.body?.carrier || '' });
  res.json({ ok: true, storeId: req.params.id, carrier: map[req.params.id] });
});

/* =============================================================================
 * STATIC CLIENTS.
 *
 * The API previously served no HTML at all — the manager console and agent PWA
 * were hosted elsewhere and pointed at this origin, which forced open CORS and
 * made cookie-based sessions awkward. Serving them here makes the normal case
 * same-origin: the session cookie just works, CORS stops applying, and there is
 * one artefact to deploy.
 *
 * Registered LAST so it can never shadow an API or webhook route. The
 * separately-hosted copy keeps working via ALLOWED_ORIGINS during the
 * switchover.
 * ========================================================================== */
/* An EXPLICIT allowlist, not express.static(__dirname).
 *
 * Serving the application directory wholesale published every file in it —
 * including `crm.db` itself. `GET /crm.db` returned the entire database
 * (orders, customer phone numbers, password hashes, carrier API keys) to an
 * unauthenticated caller, along with `/lib/*.js`, `/package.json` and anything
 * else that happened to be on disk. That is strictly worse than the
 * unauthenticated API this work set out to close, so nothing is served unless
 * it is named here. */
const CLIENT_FILES = {
  '/index.html': 'index.html',
  '/agent.html': 'agent.html',
  '/calculateur_profit_perte.html': 'calculateur_profit_perte.html',
  '/manifest.json': 'manifest.json',
  '/service-worker.js': 'service-worker.js',
  '/cash-register.mp3': 'cash-register.mp3',
};
for (const [route, file] of Object.entries(CLIENT_FILES)) {
  app.get(route, (req, res) => {
    // The service worker must never be cached, or an old one pins the app.
    if (file === 'service-worker.js') res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(__dirname, file));
  });
}
// Icons are a whole directory, but a directory of nothing but PNGs.
app.use('/icons', express.static(path.join(__dirname, 'icons'), { index: false }));

// Convenience entry points.
app.get('/app', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/agent', (req, res) => res.sendFile(path.join(__dirname, 'agent.html')));

/* JSON 404 for unmatched API/webhook paths — previously these fell through to
 * Express's default HTML error page. */
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found', path: req.originalUrl }));
app.use('/webhook', (req, res) => res.status(404).json({ error: 'Not found', path: req.originalUrl }));

/* =============================================================================
 * GLOBAL ERROR HANDLER.
 * There was none, so an unhandled throw in any synchronous handler returned
 * Express's default HTML page — including a full stack trace to the client.
 * ========================================================================== */
app.use((err, req, res, next) => {
  logError('http', 'unhandled error', { method: req.method, url: req.originalUrl, err: err.message, stack: err.stack });
  if (res.headersSent) return next(err);
  // Body-parser rejects oversized or malformed payloads with a status already set.
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: status === 500 ? 'Internal server error' : (err.message || 'Request failed'),
    code: err.code || undefined,
  });
});

/* Password hashing is async now, so the bootstrap has to finish before the
 * first request can be served — otherwise a login could race the migration and
 * be checked against a half-rewritten agents table. The delivery-outcome
 * backfill is deliberately NOT awaited: it walks every order through
 * patchOrder(), which on a large database is minutes of synchronous work, and
 * blocking the port that long risks the host's health check killing the
 * container mid-migration. It is idempotent, so finishing a moment after the
 * server starts answering is harmless. */
bootstrapAuth().then(() => {
  const server = app.listen(PORT, () => {
    logInfo('server', `CRM Server listening on port ${PORT}`);
    logInfo('server', 'clients served at /app (manager) and /agent (confirmation agent)');
    if (CROSS_SITE) logInfo('server', 'CORS allowlist active', { origins: ALLOWED_ORIGINS });
    else logInfo('server', 'CORS: same-origin only (set ALLOWED_ORIGINS to permit a separately-hosted frontend)');

    setImmediate(() => {
      try {
        const r = db.backfillDeliveryOutcomes();
        if (!r.skipped) logInfo('db', 'delivery-outcome backfill complete', r);
      } catch (e) {
        logError('db', 'delivery-outcome backfill failed (continuing)', { err: e.message });
      }
    });
  });

  /* Graceful shutdown.
   *
   * A container host sends SIGTERM on every redeploy and SIGKILLs after a grace
   * period. Without this the process died mid-request, left SSE streams hanging
   * on a socket the client could not tell was dead, and could be killed between
   * a write and its WAL checkpoint.
   *
   * jobs.stop() has existed since the background loops were written and was
   * never called by anything — the audit listed it as dead code. It is not
   * dead, it was unwired: this is what it was for. */
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logInfo('server', 'shutting down', { signal });

    try { jobs.stop(); } catch (e) { logError('server', 'jobs.stop failed', { err: e.message }); }

    // Tell live SSE clients to reconnect now, rather than leaving them holding
    // a socket that will never produce another event.
    try {
      for (const set of sseClients.values()) {
        for (const send of set) send('data: ' + JSON.stringify({ type: 'server_shutdown' }) + '\n\n');
      }
    } catch (e) { /* best effort */ }

    server.close(() => {
      try {
        // Fold the WAL back into the main database file so a cold copy of
        // crm.db is complete and consistent — this matters for backups.
        db.raw.pragma('wal_checkpoint(TRUNCATE)');
        db.raw.close();
      } catch (e) { logError('server', 'database close failed', { err: e.message }); }
      logInfo('server', 'shutdown complete');
      process.exit(0);
    });

    // Never hang forever on a stuck connection — the host will SIGKILL anyway,
    // and exiting cleanly first is what preserves the checkpoint above.
    setTimeout(() => { logError('server', 'shutdown timed out, exiting anyway'); process.exit(0); }, 8000).unref();
  };
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => shutdown(signal));
});
