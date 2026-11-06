/**
 * In-memory fixed-window rate limiter.
 *
 * Each client key (IP or user ID) gets a counter that resets when its window
 * expires. State lives in a per-process Map, so limits are not shared across
 * multiple server instances; a shared store such as Redis would be needed to
 * enforce them behind a load balancer.
 */
function createRateLimiter({
  windowMs = 60 * 1000,
  maxRequests = 60,
  keyGenerator = (req) => req.ip,
  message = "Too many requests. Please try again later.",
}) {
  // key -> { count, resetTime }
  const store = new Map();

  // Evict expired keys every minute so one-off clients don't grow the Map forever.
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, record] of store.entries()) {
      if (now > record.resetTime) {
        store.delete(key);
      }
    }
  }, 60 * 1000);

  // Don't keep the process alive just for this timer (lets tests and shutdown exit cleanly).
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  return function rateLimitMiddleware(req, res, next) {
    const key = keyGenerator(req);
    const now = Date.now();

    let record = store.get(key);

    // First request, or the previous window has expired: start a new window.
    if (!record || now > record.resetTime) {
      record = { count: 1, resetTime: now + windowMs };
      store.set(key, record);
    } else {
      record.count += 1;
    }

    const msRemaining = Math.max(0, record.resetTime - now);
    const retryAfterSec = Math.ceil(msRemaining / 1000);
    const remainingRequests = Math.max(0, maxRequests - record.count);

    res.setHeader("RateLimit-Limit", maxRequests);
    res.setHeader("RateLimit-Remaining", remainingRequests);
    res.setHeader("RateLimit-Reset", retryAfterSec);

    // Over the limit: stop here so the request never reaches the route handler or database.
    if (record.count > maxRequests) {
      res.setHeader("Retry-After", retryAfterSec);
      return res.status(429).json({
        error: message,
        retryAfter: retryAfterSec,
      });
    }

    next();
  };
}

module.exports = { createRateLimiter };
