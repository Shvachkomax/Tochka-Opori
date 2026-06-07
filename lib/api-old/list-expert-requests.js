import { getSupabase } from "../lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const params = req.method === "POST" ? (req.body || {}) : (req.query || {});
    const status = params.status || "pending";
    const limit = Math.min(parseInt(params.limit) || 50, 200);
    const offset = parseInt(params.offset) || 0;

    let query = getSupabase()
      .from("expert_requests")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (status !== "all") {
      query = query.eq("status", status);
    }

    const { data, error, count } = await query;

    if (error) {
      return res.status(500).json({ ok: false, error: "Ошибка загрузки заявок" });
    }

    return res.status(200).json({
      ok: true,
      requests: data || [],
      total: count || 0,
      status,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Ошибка загрузки заявок",
    });
  }
}
