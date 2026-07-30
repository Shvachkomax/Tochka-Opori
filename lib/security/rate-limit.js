// In-memory rate limiter with optional Vercel KV integration.
// Falls back to in-memory when KV is unavailable or in dev.

import crypto from "crypto";

const memStore = new Map();

function getClientIp(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
    || req.headers["x-real-ip"]
    || req.socket?.remoteAddress
    || "unknown";
}

function memGetKey(req, prefix = "") {
  const ip = getClientIp(req);
  return `${prefix}${ip}:${req.url}`;
}

function memCleanup(now, windowMs) {
  const cutoff = now - windowMs;
  for (const [key, timestamps] of memStore) {
    const valid = timestamps.filter(t => t > cutoff);
    if (valid.length === 0) {
      memStore.delete(key);
    } else {
      memStore.set(key, valid);
    }
  }
}

// Vercel KV helpers
function isKvConfigured() {
  return !!(process.env.KV_URL || process.env.KV_REST_API_URL || process.env.VERCEL_KV_URL);
}

function buildKvKey(req, prefix = "") {
  const ip = getClientIp(req);
  // KV key cannot contain : in some providers
  const safeUrl = req.url.replace(/[:/]/g, "_");
  return `${prefix}${ip}:${safeUrl}`;
}

async function kvCheckLimit(kvKey, max, windowMs) {
  const { kv } = await import("@vercel/kv");
  const now = Date.now();
  const cutoff = now - windowMs;

  // Use sorted set: score = timestamp, member = random id
  // Clean old entries, count remaining
  await kv.zremrangebyscore(kvKey, 0, cutoff);
  const count = await kv.zcard(kvKey);

  if (count >= max) {
    const oldest = await kv.zrange(kvKey, 0, 0, { withScores: true });
    const resetAt = oldest[1] ? Math.ceil((Number(oldest[1]) + windowMs) / 1000) : Math.ceil((now + windowMs) / 1000);
    return { allowed: false, remaining: 0, reset: resetAt, limit: max };
  }

  // Add new entry with TTL
  const member = `${now}:${crypto.randomUUID()}`;
  await kv.zadd(kvKey, { score: now, member });
  await kv.expire(kvKey, Math.ceil(windowMs / 1000));

  return { allowed: true, remaining: max - count - 1, reset: Math.ceil((now + windowMs) / 1000), limit: max };
}

async function memCheckLimit(kvKeyFn, max, windowMs) {
  const key = kvKeyFn();
  const now = Date.now();
  const cutoff = now - windowMs;

  if (!memStore.has(key)) {
    memStore.set(key, []);
  }

  const timestamps = memStore.get(key).filter(t => t > cutoff);
  timestamps.push(now);
  memStore.set(key, timestamps);

  const remaining = Math.max(0, max - timestamps.length);

  if (timestamps.length > max) {
    return { allowed: false, remaining: 0, reset: Math.ceil((now + windowMs) / 1000), limit: max };
  }

  return { allowed: true, remaining, reset: Math.ceil((now + windowMs) / 1000), limit: max };
}

export function rateLimit(options = {}) {
  const {
    windowMs = 10 * 60 * 1000,
    max = 60,
    prefix = "",
    dailyMax = null,
    message = "Слишком много запросов. Попробуйте позже.",
  } = options;

  const useKv = isKvConfigured();

  return async function limit(req, res) {
    const kvKeyFn = () => buildKvKey(req, prefix);
    const memKeyFn = () => memGetKey(req, prefix);

    let result;
    if (useKv) {
      try {
        result = await kvCheckLimit(kvKeyFn(), max, windowMs);
      } catch {
        // KV failure → fall back to in-memory
        result = await memCheckLimit(memKeyFn, max, windowMs);
      }
    } else {
      result = await memCheckLimit(memKeyFn, max, windowMs);
    }

    res.setHeader("X-RateLimit-Limit", result.limit);
    res.setHeader("X-RateLimit-Remaining", result.remaining);
    res.setHeader("X-RateLimit-Reset", result.reset);

    // Daily budget (per IP)
    if (dailyMax && useKv) {
      try {
        const { kv } = await import("@vercel/kv");
        const dayKey = `${kvKeyFn()}:daily:${new Date().toISOString().slice(0, 10)}`;
        const dayCount = await kv.incr(dayKey);
        await kv.expire(dayKey, 86400);

        res.setHeader("X-RateLimit-Daily-Remaining", Math.max(0, dailyMax - dayCount));

        if (dayCount > dailyMax) {
          res.setHeader("Retry-After", "86400");
          return res.status(429).json({ error: "Достигнут дневной лимит запросов. Попробуйте завтра." });
        }
      } catch {
        // Daily budget check failed — continue
      }
    }

    if (!result.allowed) {
      res.setHeader("Retry-After", Math.ceil((result.reset - Date.now() / 1000)).toString());
      return res.status(429).json({ error: message });
    }

    return null;
  };
}

// Run cleanup every 5 minutes (in-memory)
if (typeof setInterval !== "undefined") {
  setInterval(() => memCleanup(Date.now(), 10 * 60 * 1000), 5 * 60 * 1000);
}
