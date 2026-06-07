import { createClient } from "@supabase/supabase-js";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const adminSecret = process.env.ADMIN_SECRET;
    const inputSecret = req.query?.admin_secret || req.headers?.["x-admin-secret"] || "";

    if (!adminSecret || inputSecret !== adminSecret) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
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

    const statusFilter = String(req.query?.status || "new").toLowerCase();
    const environmentFilter = String(req.query?.environment || "all").toLowerCase();
    let limit = parseInt(String(req.query?.limit || "50"), 10);
    if (Number.isNaN(limit) || limit <= 0) limit = 50;
    if (limit > 200) limit = 200;

    let query = supabase
      .from("crisis_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (statusFilter && statusFilter !== "all") {
      query = query.eq("status", statusFilter);
    }

    if (environmentFilter && environmentFilter !== "all") {
      query = query.eq("environment", environmentFilter);
    }

    const { data, error } = await query;

    if (error) {
      console.error("list-crisis-requests supabase error", {
        message: error.message,
        details: error.details,
        code: error.code,
      });
      return res.status(500).json({
        ok: false,
        error: "Failed to load crisis requests",
        details: error.message,
      });
    }

    return res.status(200).json({
      ok: true,
      requests: data || [],
      count: Array.isArray(data) ? data.length : 0,
    });
  } catch (error) {
    console.error("list-crisis-requests fatal error", {
      message: error?.message,
      stack: error?.stack,
    });
    return res.status(500).json({
      ok: false,
      error: "Fatal list-crisis-requests error",
      details: error?.message || String(error),
    });
  }
}
