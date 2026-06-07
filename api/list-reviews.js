import { getSupabase } from "../lib/supabase.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({
        ok: false,
        error: "Missing Supabase env vars",
        hasUrl: Boolean(process.env.SUPABASE_URL),
        hasServiceKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      });
    }

    const isDebug = req.method === "GET" && req.query && req.query.debug === "1";

    if (isDebug) {
      const { data, error } = await getSupabase()
        .from("case_reviews")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) {
        return res.status(200).json({
          ok: false,
          mode: "debug",
          error: error.message,
          details: error.details || null,
          hint: error.hint || null,
          code: error.code || null,
        });
      }

      return res.status(200).json({
        ok: true,
        mode: "debug",
        reviews: data || [],
        count: (data || []).length,
      });
    }

    const params = req.method === "POST" ? (req.body || {}) : (req.query || {});

    const status = params.status || "all";
    const environment = params.environment || null;
    const expertFilter = params.expert_filter || "all";
    const limit = Math.min(parseInt(String(params.limit), 10) || 50, 200);
    const offset = parseInt(String(params.offset), 10) || 0;

    let query = getSupabase()
      .from("case_reviews")
      .select("*")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (status !== "all") {
      query = query.filter("json_data->>status", "eq", status);
    }

    if (environment) {
      query = query.filter("json_data->>environment", "eq", environment);
    }

    if (expertFilter === "with_expert") {
      query = query.not("expert_id", "is", null);
    } else if (expertFilter === "without_expert") {
      query = query.filter("expert_id", "is", null);
    }

    const { data, error } = await query;

    if (error) {
      return res.status(500).json({
        ok: false,
        error: "Database query failed",
        details: error.message,
        code: error.code,
        hint: error.hint,
      });
    }

    let countQuery = getSupabase()
      .from("case_reviews")
      .select("id", { count: "exact", head: true });

    if (status !== "all") {
      countQuery = countQuery.filter("json_data->>status", "eq", status);
    }

    if (environment) {
      countQuery = countQuery.filter("json_data->>environment", "eq", environment);
    }

    if (expertFilter === "with_expert") {
      countQuery = countQuery.not("expert_id", "is", null);
    } else if (expertFilter === "without_expert") {
      countQuery = countQuery.filter("expert_id", "is", null);
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
      expert_filter: expertFilter,
    });
  } catch (error) {
    console.error("list-reviews error", {
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
      code: error?.code,
      stack: error?.stack,
    });

    return res.status(500).json({
      ok: false,
      error: "Failed to load reviews",
      details: error?.message || String(error),
      code: error?.code || null,
      hint: error?.hint || null,
    });
  }
}
