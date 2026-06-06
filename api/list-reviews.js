import { getSupabase } from "../lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const params = req.method === "POST" ? (req.body || {}) : (req.query || {});

    const status = params.status || "pending";
    const environment = params.environment || null;
    const limit = Math.min(parseInt(params.limit) || 50, 200);
    const offset = parseInt(params.offset) || 0;

    let query = getSupabase()
      .from("case_reviews")
      .select("*")
      .filter("json_data->>status", "eq", status)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (environment) {
      query = query.filter("json_data->>environment", "eq", environment);
    }

    const { data, error } = await query;

    if (error) {
      return res.status(500).json({ ok: false, error: "Ошибка загрузки списка" });
    }

    // Get total count
    let countQuery = getSupabase()
      .from("case_reviews")
      .select("id", { count: "exact", head: true })
      .filter("json_data->>status", "eq", status);

    if (environment) {
      countQuery = countQuery.filter("json_data->>environment", "eq", environment);
    }

    const { count } = await countQuery;

    const reviews = (data || []).map((row) => ({
      id: row.id,
      case_id: row.case_id,
      session_id: row.session_id,
      public_code: row.public_code,
      created_at: row.created_at,
      json_data: row.json_data,
    }));

    return res.status(200).json({
      ok: true,
      reviews,
      total: count || reviews.length,
      status,
      environment: environment || "all",
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Ошибка загрузки списка",
    });
  }
}
