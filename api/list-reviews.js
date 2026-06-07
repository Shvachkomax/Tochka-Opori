import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET" && req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      return res.status(500).json({
        ok: false,
        error: "Missing Supabase env vars",
        hasUrl: Boolean(supabaseUrl),
        hasServiceKey: Boolean(serviceKey),
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const params = req.method === "GET" ? (req.query || {}) : (req.body || {});

    const debug = String(params.debug || "") === "1";

    if (debug) {
      const { data, error } = await supabase
        .from("case_reviews")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) {
        console.error("list-reviews debug supabase error", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });

        return res.status(500).json({
          ok: false,
          error: "Failed to load reviews in debug mode",
          details: error.message,
          code: error.code || null,
          hint: error.hint || null,
        });
      }

      return res.status(200).json({
        ok: true,
        debug: true,
        reviews: data || [],
        count: Array.isArray(data) ? data.length : 0,
      });
    }

    const status = String(params.status || "pending").toLowerCase();
    const environment = String(params.environment || "all").toLowerCase();
    const expertFilter = String(params.expert_filter || "all").toLowerCase();

    let limit = parseInt(String(params.limit || "50"), 10);
    if (Number.isNaN(limit) || limit <= 0) limit = 50;
    if (limit > 200) limit = 200;

    let query = supabase
      .from("case_reviews")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status && status !== "all") {
      query = query.filter("json_data->>status", "eq", status);
    }

    if (environment && environment !== "all") {
      query = query.filter("json_data->>environment", "eq", environment);
    }

    if (environment && environment !== "all") {
      query = query.filter("json_data->>environment", "eq", environment);
    }

    if (expertFilter === "with_expert") {
      query = query.not("expert_id", "is", null);
    }

    if (expertFilter === "without_expert") {
      query = query.filter("expert_id", "is", null);
    }

    const { data, error } = await query;

    if (error) {
      console.error("list-reviews supabase error", {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      });

      return res.status(500).json({
        ok: false,
        error: "Failed to load reviews",
        details: error.message,
        code: error.code || null,
        hint: error.hint || null,
      });
    }

    return res.status(200).json({
      ok: true,
      reviews: data || [],
      count: Array.isArray(data) ? data.length : 0,
    });
  } catch (error) {
    console.error("list-reviews fatal error", {
      message: error?.message,
      stack: error?.stack,
    });

    return res.status(500).json({
      ok: false,
      error: "Fatal list-reviews error",
      details: error?.message || String(error),
    });
  }
}
