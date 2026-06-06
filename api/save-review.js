import fs from "node:fs";
import path from "node:path";
import { getSupabase } from "../lib/supabase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const review = req.body;

    if (!review || !review.case_id) {
      return res.status(400).json({ error: "Invalid case review" });
    }

    const host = req.headers?.host || "";
    const isLocal =
      host.includes("localhost") ||
      host.includes("127.0.0.1") ||
      process.env.VERCEL !== "1";

    const environment = isLocal ? "local" : "production";

    if (isLocal) {
      review.status = "local_auto_saved";
      review.environment = "local";
      review.source = "developer_local";
      review.local_only = true;
      review.approved_for_training = false;

      // Local filesystem save (dev only)
      const dataDir = path.join(process.cwd(), "data");
      const jsonlPath = path.join(dataDir, "case-reviews.jsonl");
      const sessionsDir = path.join(dataDir, "sessions");

      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });

      fs.appendFileSync(jsonlPath, JSON.stringify(review) + "\n", "utf8");

      const sessionPath = path.join(sessionsDir, `${review.sessionId}.json`);
      fs.writeFileSync(sessionPath, JSON.stringify(review, null, 2), "utf8");
    } else {
      review.status = "pending";
      review.environment = "production";
      review.source = "external_test";
      review.local_only = false;
      review.approved_for_training = false;
    }

    // Save to Supabase case_reviews (both local and Vercel)
    const { error: insertError } = await getSupabase().from("case_reviews").insert({
      case_id: review.case_id,
      session_id: review.sessionId,
      public_code: review.publicCode,
      json_data: review,
    });

    if (insertError) {
      console.error("Supabase insert error:", insertError);
      return res.status(500).json({ ok: false, error: "Ошибка сохранения в базу данных" });
    }

    return res.status(200).json({
      ok: true,
      sessionId: review.sessionId,
      publicCode: review.publicCode,
      environment,
      status: review.status,
      saved_to: isLocal ? "local+supabase" : "supabase",
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to save review",
    });
  }
}
