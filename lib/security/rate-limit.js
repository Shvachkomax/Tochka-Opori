// In-memory rate limiter.
// NOTE: On Vercel serverless, each instance has separate memory.
// This provides basic protection for development and light production use.
// For production at scale, replace with Upstash / Vercel KV.

const store = new Map();

function getClientIp(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
    || req.headers["x-real-ip"]
    || req.socket?.remoteAddress
    || "unknown";
}

function getKey(req, prefix = "") {
  const ip = getClientIp(req);
  return `${prefix}${ip}:${req.url}`;
}

function cleanup(now, windowMs) {
  const cutoff = now - windowMs;
  for (const [key, timestamps] of store) {
    const valid = timestamps.filter(t => t > cutoff);
    if (valid.length === 0) {
      store.delete(key);
    } else {
      store.set(key, valid);
    }
  }
}

export function rateLimit(options = {}) {
  const {
    windowMs = 10 * 60 * 1000,
    max = 60,
    prefix = "",
  } = options;

  return function limit(req, res) {
    const key = getKey(req, prefix);
    const now = Date.now();
    const cutoff = now - windowMs;

    if (!store.has(key)) {
      store.set(key, []);
    }

    const timestamps = store.get(key).filter(t => t > cutoff);
    timestamps.push(now);
    store.set(key, timestamps);

    const remaining = Math.max(0, max - timestamps.length);
    res.setHeader("X-RateLimit-Limit", max);
    res.setHeader("X-RateLimit-Remaining", remaining);
    res.setHeader("X-RateLimit-Reset", Math.ceil((now + windowMs) / 1000));

    if (timestamps.length > max) {
      return res.status(429).json({ error: "Слишком много запросов. Попробуйте позже." });
    }

    return null;
  };
}

// Run cleanup every 5 minutes
if (typeof setInterval !== "undefined") {
  setInterval(() => cleanup(Date.now(), 10 * 60 * 1000), 5 * 60 * 1000);
}
