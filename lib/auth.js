/* =============================================================================
 * lib/auth.js — authentication and session management (audit SEC-01, SEC-02).
 *
 * Before this module the platform had NO authentication of any kind: all 117
 * API routes were open, there was no login endpoint anywhere in the codebase,
 * GET /api/agents returned every agent's password in cleartext, and the agent
 * PWA compared that password in the BROWSER. The manager console had no login
 * screen at all.
 *
 * DESIGN NOTES
 *
 * Opaque server-side sessions, not JWTs. A suspended agent must lose access
 * immediately, and a stolen token must be revocable — neither is possible with
 * a stateless signed token unless you add a revocation list, at which point you
 * have a session table anyway. Only the SHA-256 of the token is stored, so a
 * database leak does not hand over live sessions.
 *
 * scrypt from node:crypto rather than bcrypt. It is a memory-hard KDF that
 * needs no dependency at all, which matters here because the one native
 * dependency in this project (better-sqlite3) already breaks installs on
 * machines without a compiler. Hashes are self-describing (`scrypt$N$r$p$...`)
 * so the parameters can be raised later without invalidating existing users.
 *
 * Two separate notions of "role", deliberately:
 *   - agents.role        — the JOB: confirmation | followup | both. Already
 *                          existed; drives assignment and workload.
 *   - agents.accountRole — the PRIVILEGE: agent | manager. New. Drives access
 *                          control only.
 * Conflating them would have meant a follow-up agent could not be a manager.
 *
 * Kept free of Express types on purpose — the middleware factories at the
 * bottom are thin wrappers over pure functions, so the session core can move
 * into a shared package for the future LandingOS integration without dragging
 * this project's HTTP layer along.
 * ========================================================================== */

const crypto = require('node:crypto');
const db = require('./db');

/* ---------------------------------------------------------------------------
 * Password hashing
 * ------------------------------------------------------------------------- */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const PREFIX = 'scrypt';

/** Hash a plaintext password into a self-describing string. */
function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(plain ?? ''), salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p,
  });
  return [PREFIX, SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('hex'), key.toString('hex')].join('$');
}

/** True when `stored` is one of our hashes rather than a legacy plaintext value. */
function isHashed(stored) {
  return typeof stored === 'string' && stored.startsWith(PREFIX + '$');
}

/**
 * Verify a password against a stored value.
 *
 * Accepts legacy PLAINTEXT values so that an existing installation keeps
 * working through the upgrade — every agent's password predates hashing. The
 * boot-time migration below rewrites them, so this branch is only reachable for
 * a row written before the migration ran.
 */
function verifyPassword(plain, stored) {
  const candidate = String(plain ?? '');
  if (!isHashed(stored)) {
    // Legacy plaintext. Compare in constant time anyway.
    const a = Buffer.from(candidate);
    const b = Buffer.from(String(stored ?? ''));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  const [, N, r, p, saltHex, keyHex] = stored.split('$');
  let derived;
  try {
    derived = crypto.scryptSync(candidate, Buffer.from(saltHex, 'hex'), keyHex.length / 2, {
      N: Number(N), r: Number(r), p: Number(p),
    });
  } catch {
    return false;
  }
  const expected = Buffer.from(keyHex, 'hex');
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

/* ---------------------------------------------------------------------------
 * Sessions
 * ------------------------------------------------------------------------- */

const SESSION_COOKIE = 'crm_session';
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_HOURS || 24 * 14) * 3600 * 1000;

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/**
 * Issue a session. Returns the RAW token — the only time it exists in this
 * process; only its hash is persisted.
 */
function createSession(agentName, meta = {}) {
  const raw = crypto.randomBytes(32).toString('base64url');
  db.createSession({
    id: sha256(raw),
    agentName,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
    userAgent: String(meta.userAgent || '').slice(0, 300),
    ip: String(meta.ip || '').slice(0, 64),
  });
  return raw;
}

/**
 * Resolve a raw token to its live account, or null.
 *
 * Re-reads the agent on every request rather than trusting what was true at
 * login, so suspending or deleting an account takes effect immediately on the
 * next call instead of whenever the session happens to expire.
 */
function resolveSession(rawToken) {
  if (!rawToken) return null;
  const row = db.getSession(sha256(rawToken));
  if (!row) return null;
  if (row.expiresAt && row.expiresAt < Date.now()) {
    db.deleteSession(row.id);
    return null;
  }
  const agent = db.getAgentRaw(row.agentName);
  if (!agent) { db.deleteSession(row.id); return null; }
  if (agent.suspended) return null;   // session survives; access does not

  db.touchSession(row.id);
  return {
    name: agent.name,
    role: agent.role || 'confirmation',
    accountRole: agent.accountRole || 'agent',
    isManager: (agent.accountRole || 'agent') === 'manager',
    sessionId: row.id,
  };
}

function destroySession(rawToken) {
  if (rawToken) db.deleteSession(sha256(rawToken));
}

/** Drop every session belonging to an account (suspend, delete, password change). */
function destroySessionsFor(agentName) {
  db.deleteSessionsForAgent(agentName);
}

/* ---------------------------------------------------------------------------
 * Boot-time migration + bootstrap
 * ------------------------------------------------------------------------- */

/**
 * Rewrite every legacy plaintext password as a hash. Idempotent — rows already
 * hashed are skipped.
 *
 * An agent whose password was EMPTY keeps working exactly as before: the empty
 * string is hashed, so submitting a blank password still authenticates. That is
 * deliberate — silently locking out staff mid-shift is a worse failure than
 * preserving a weak password for one more release — but such accounts are
 * flagged via `hasPassword: false` in the agents list so a manager can see and
 * fix them. Enforcing a reset is queued for a later phase.
 */
function migratePlaintextPasswords(log) {
  const rows = db.listAgentSecrets();
  let migrated = 0, blank = 0;
  for (const a of rows) {
    if (isHashed(a.pass)) continue;
    db.setAgentPasswordHash(a.name, hashPassword(a.pass ?? ''));
    migrated++;
    if (!a.pass) blank++;
  }
  if (migrated && log) {
    log('info', 'auth', 'hashed legacy plaintext passwords', { migrated, blankPasswords: blank });
    if (blank) {
      log('error', 'auth', 'SOME ACCOUNTS HAVE A BLANK PASSWORD and can be accessed by submitting an empty field — set a password for each from the Agents page', { count: blank });
    }
  }
  return { migrated, blank };
}

/**
 * Ensure at least one manager account exists.
 *
 * Reads ADMIN_USERNAME / ADMIN_PASSWORD. Without them a fresh deployment would
 * have no way in at all, so the absence is logged loudly rather than silently
 * leaving the platform unreachable.
 */
function ensureManagerAccount(log) {
  if (db.countManagers() > 0) return { created: false };

  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) {
    if (log) log('error', 'auth', 'NO MANAGER ACCOUNT EXISTS and ADMIN_USERNAME / ADMIN_PASSWORD are not set — nobody can sign in to the manager console. Set both environment variables and restart.');
    return { created: false, missingEnv: true };
  }

  const existing = db.getAgentRaw(username);
  if (existing) {
    // The name is already an agent — promote it rather than failing, and reset
    // the password to the configured one so the operator is never locked out.
    db.setAgentPasswordHash(username, hashPassword(password));
    db.setAccountRole(username, 'manager');
    if (log) log('info', 'auth', 'promoted existing account to manager from ADMIN_USERNAME', { username });
    return { created: false, promoted: true };
  }

  db.addAgent(username, hashPassword(password), 'both');
  db.setAccountRole(username, 'manager');
  db.audit('agent', username, 'bootstrap_manager', 'system', {});
  if (log) log('info', 'auth', 'created the initial manager account from ADMIN_USERNAME', { username });
  return { created: true };
}

/* ---------------------------------------------------------------------------
 * Cookies
 * ------------------------------------------------------------------------- */

/* SameSite policy is derived rather than configured. With the frontend served
 * by this same app (the normal case) Lax is correct and works over plain HTTP
 * in local development. Only when ALLOWED_ORIGINS names a DIFFERENT origin does
 * the cookie need to travel cross-site, which browsers permit only with
 * SameSite=None AND Secure — so both are set together, never one without the
 * other, which would silently drop the cookie. */
function cookieAttributes({ crossSite, secure }) {
  const parts = ['Path=/', 'HttpOnly'];
  parts.push('SameSite=' + (crossSite ? 'None' : 'Lax'));
  if (secure || crossSite) parts.push('Secure');
  return parts;
}

function buildSessionCookie(token, opts) {
  return [`${SESSION_COOKIE}=${token}`, ...cookieAttributes(opts), `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`].join('; ');
}

function buildClearCookie(opts) {
  return [`${SESSION_COOKIE}=`, ...cookieAttributes(opts), 'Max-Age=0'].join('; ');
}

/** Minimal cookie-header parser — avoids a dependency for one header. */
function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

/**
 * Extract the token from a request: session cookie first, then
 * `Authorization: Bearer`, then `?token=` — the last only because EventSource
 * cannot set headers, so the SSE stream has no other way to authenticate.
 */
function tokenFromRequest(req) {
  const cookies = parseCookies(req.headers?.cookie);
  if (cookies[SESSION_COOKIE]) return cookies[SESSION_COOKIE];
  const auth = req.headers?.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  if (req.query && req.query.token) return String(req.query.token);
  return null;
}

/* ---------------------------------------------------------------------------
 * Express middleware
 * ------------------------------------------------------------------------- */

/** Populates req.user when a valid session is present. Never rejects. */
function attachUser(req, res, next) {
  try {
    req.user = resolveSession(tokenFromRequest(req));
  } catch {
    req.user = null;
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required', code: 'UNAUTHENTICATED' });
  next();
}

function requireManager(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required', code: 'UNAUTHENTICATED' });
  if (!req.user.isManager) return res.status(403).json({ error: 'Manager access required', code: 'FORBIDDEN' });
  next();
}

module.exports = {
  SESSION_COOKIE, SESSION_TTL_MS,
  hashPassword, verifyPassword, isHashed,
  createSession, resolveSession, destroySession, destroySessionsFor,
  migratePlaintextPasswords, ensureManagerAccount,
  buildSessionCookie, buildClearCookie, parseCookies, tokenFromRequest,
  attachUser, requireAuth, requireManager,
};
