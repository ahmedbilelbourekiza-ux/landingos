/* =============================================================================
 * lib/ratelimit.js — in-process request throttling.
 *
 * Written rather than pulled in because express-rate-limit would be the fifth
 * dependency in a project whose one native dependency already breaks installs
 * on machines without a compiler, and this needs about forty lines.
 *
 * A fixed-window counter, not a token bucket: the thing being defended against
 * here is credential stuffing and scripted abuse, where "how many attempts in
 * the last minute" is exactly the right question and burst smoothing is not
 * worth the extra state.
 *
 * KNOWN LIMITATION, stated plainly: the counters live in this process's memory.
 * On a single instance — which is what this deploys to today — that is correct.
 * Behind more than one instance each would keep its own count, so the effective
 * limit multiplies by the instance count, and a restart clears everything. The
 * fix at that point is Redis, and it belongs with the same work that moves SSE
 * fan-out off in-process state.
 * ========================================================================== */

/**
 * @param {Object} opts
 * @param {number} opts.windowMs   length of the fixed window
 * @param {number} opts.max        allowed requests per key per window
 * @param {Function} opts.key      (req) => string, the thing being limited
 * @param {string} [opts.message]  what the caller is told
 * @param {Function} [opts.skip]   (req) => boolean, bypass the limiter
 * @param {Function} [opts.onLimit] (req, key) => void, for logging
 */
function rateLimit({ windowMs, max, key, message, skip, onLimit }) {
  const hits = new Map();   // key -> { count, resetAt }

  // Drop expired buckets so an attacker cycling keys cannot grow this forever.
  // Unref'd so it never keeps the process alive on shutdown.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, Math.max(windowMs, 60000));
  if (sweep.unref) sweep.unref();

  return function limiter(req, res, next) {
    if (skip && skip(req)) return next();

    const k = key(req);
    if (!k) return next();

    const now = Date.now();
    let bucket = hits.get(k);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      hits.set(k, bucket);
    }
    bucket.count++;

    const remaining = Math.max(0, max - bucket.count);
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil((bucket.resetAt - now) / 1000)));

    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      if (onLimit) onLimit(req, k);
      return res.status(429).json({
        error: message || 'Too many requests — please wait and try again',
        code: 'RATE_LIMITED',
        retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
      });
    }
    next();
  };
}

/** Best-effort client identity. Behind a proxy, trust proxy must be set for
 *  req.ip to be the real client rather than the load balancer. */
function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

module.exports = { rateLimit, clientIp };
