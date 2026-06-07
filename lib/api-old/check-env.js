import { getSupabase } from "../lib/supabase.js";

export default async function handler(req, res) {
  const info = {
    has_url: !!process.env.SUPABASE_URL,
    has_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    url_prefix: process.env.SUPABASE_URL ? process.env.SUPABASE_URL.substring(0, 25) + "..." : null,
    key_prefix: process.env.SUPABASE_SERVICE_ROLE_KEY ? process.env.SUPABASE_SERVICE_ROLE_KEY.substring(0, 10) + "..." : null,
    node_version: process.version,
    vercel: process.env.VERCEL || "not set",
  };

  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("sessions")
      .select("id")
      .limit(1);
    info.query_result = error ? `Error: ${error.message}` : "OK";
    if (data) info.row_count = data.length;
  } catch (e) {
    info.query_result = `Exception: ${e.message}`;
  }

  try {
    const url = `${process.env.SUPABASE_URL}/rest/v1/`;
    const resp = await fetch(url, {
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY },
    });
    info.rest_status = resp.status;
    info.rest_body = (await resp.text()).substring(0, 100);
  } catch (e) {
    info.rest_fetch = `Exception: ${e.message}`;
  }

  return res.status(200).json(info);
}
