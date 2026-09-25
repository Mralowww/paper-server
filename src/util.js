const crypto = require('node:crypto');

/** Fixed-window in-memory rate limiter keyed by an arbitrary string. */
function createRateLimiter(limitPerMin) {
  const windows = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, w] of windows) if (w.reset <= now) windows.delete(k);
  }, 60_000).unref();

  return function hit(key, res) {
    const now = Date.now();
    let w = windows.get(key);
    if (!w || w.reset <= now) {
      w = { count: 0, reset: now + 60_000 };
      windows.set(key, w);
    }
    w.count++;
    res.set('X-RateLimit-Limit', String(limitPerMin));
    res.set('X-RateLimit-Remaining', String(Math.max(0, limitPerMin - w.count)));
    res.set('X-RateLimit-Reset', String(Math.ceil(w.reset / 1000)));
    if (w.count > limitPerMin) {
      res.set('Retry-After', String(Math.ceil((w.reset - now) / 1000)));
      res.status(429).json({ error: 'rate_limited', message: 'Too many requests, slow down.' });
      return false;
    }
    return true;
  };
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

module.exports = { createRateLimiter, sha256, clampInt };
