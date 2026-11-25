// Brute-force and flood protection for an internet-facing bridge. In-memory and per client address,
// which is enough for one household; it resets when the bridge restarts.
export function createGuard({ maxFailures = 10, windowMs = 15 * 60_000, lockMs = 15 * 60_000, perMinute = 300, now = Date.now } = {}) {
  const fails = new Map(); // ip -> { count, first, lockedUntil }
  const rates = new Map(); // ip -> { minute, count }

  const prune = (t) => {
    if (fails.size + rates.size < 5000) return;
    for (const [ip, f] of fails) if ((f.lockedUntil ?? 0) < t && t - f.first > windowMs) fails.delete(ip);
    for (const [ip, r] of rates) if (r.minute < Math.floor(t / 60_000)) rates.delete(ip);
  };

  return {
    /** Null when the request may proceed, or { retryAfter } in seconds when this address is locked or too fast. */
    check(ip) {
      const t = now();
      prune(t);
      const f = fails.get(ip);
      if (f?.lockedUntil > t) return { retryAfter: Math.ceil((f.lockedUntil - t) / 1000) };
      const minute = Math.floor(t / 60_000);
      let r = rates.get(ip);
      if (!r || r.minute !== minute) rates.set(ip, (r = { minute, count: 0 }));
      if (++r.count > perMinute) return { retryAfter: Math.max(1, Math.ceil(((minute + 1) * 60_000 - t) / 1000)) };
      return null;
    },
    failure(ip) {
      const t = now();
      let f = fails.get(ip);
      if (!f || (f.lockedUntil ?? 0) <= t && t - f.first > windowMs) fails.set(ip, (f = { count: 0, first: t }));
      if (++f.count >= maxFailures) f.lockedUntil = t + lockMs;
    },
    success(ip) {
      fails.delete(ip);
    },
  };
}

// Headers for every response: nothing here should ever be cached, framed or sniffed.
export const securityHeaders = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
};
