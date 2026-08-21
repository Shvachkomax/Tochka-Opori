// Canonical site URL resolution for invitation links and redirects.
// Priority: SITE_URL env var > VERCEL_URL with https > localhost fallback.

export function getSiteUrl() {
  if (process.env.SITE_URL) return process.env.SITE_URL;

  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;

  return "http://localhost:5173";
}

export function getInviteUrl(token) {
  return `${getSiteUrl()}/invite/${token}`;
}
