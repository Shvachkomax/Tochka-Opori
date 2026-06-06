export default async function handler(req, res) {
  return res.status(200).json({
    has_url: !!process.env.SUPABASE_URL,
    has_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    url_prefix: process.env.SUPABASE_URL ? process.env.SUPABASE_URL.substring(0, 20) + "..." : null,
    node_version: process.version,
    vercel: process.env.VERCEL || "not set",
  });
}
