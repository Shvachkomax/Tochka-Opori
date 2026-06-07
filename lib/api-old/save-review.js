import fs from "node:fs";
import path from "node:path";
import { getSupabase } from "../lib/supabase.js";
import { maskSensitiveData, getPrivacySafeMode } from "../lib/sanitize.js";

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

    if (isLocal) {
      review.status = "local_auto_saved";
      review.environment = "local";
      review.source = review.expert_id ? "developer_expert_review" : "developer_local";
      review.local_only = true;
      review.approved_for_training = false;
    } else {
      review.status = "pending";
      review.environment = "production";
      review.source = review.expert_id ? "external_expert_review" : "external_anonymous_review";
      review.local_only = false;
      review.approved_for_training = false;
    }

    // Sanitize review data in privacy-safe mode
    let sanitizedReview = review;
    if (getPrivacySafeMode()) {
      sanitizedReview = maskSensitiveData(review);
    }

    // Validate expert_id if provided
    if (sanitizedReview.expert_id) {
      const { data: expert, error: expertError } = await getSupabase()
        .from("experts")
        .select("id, name, role, specialty")
        .eq("id", sanitizedReview.expert_id)
        .eq("is_active", true)
        .maybeSingle();

      if (expertError) {
        console.error("Expert validation error:", expertError);
      } else if (!expert) {
        return res.status(400).json({
          ok: false,
          error: "Указанный специалист не найден или не активен",
        });
      } else {
        sanitizedReview.expert_name = expert.name;
        sanitizedReview.expert_role = expert.role;
        sanitizedReview.expert_specialty = expert.specialty;
      }
    }

    // Save to local filesystem (always original data for debugging)
    if (isLocal) {
      const dataDir = path.join(process.cwd(), "data");
      const jsonlPath = path.join(dataDir, "case-reviews.jsonl");
      const sessionsDir = path.join(dataDir, "sessions");

      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });

      fs.appendFileSync(jsonlPath, JSON.stringify(review) + "\n", "utf8");

      const sessionPath = path.join(sessionsDir, `${review.sessionId}.json`);
      fs.writeFileSync(sessionPath, JSON.stringify(review, null, 2), "utf8");
    }

    // Save to Supabase case_reviews (with sanitized data if privacy mode)
    const insertPayload = {
      case_id: sanitizedReview.case_id,
      session_id: sanitizedReview.sessionId,
      public_code: sanitizedReview.publicCode,
      expert_id: sanitizedReview.expert_id || null,
      expert_name: sanitizedReview.expert_name || null,
      expert_role: sanitizedReview.expert_role || null,
      expert_specialty: sanitizedReview.expert_specialty || null,
      json_data: sanitizedReview,
    };

    const { error: insertError } = await getSupabase()
      .from("case_reviews")
      .insert(insertPayload);

    if (insertError) {
      console.error("Supabase insert error:", insertError);
      return res.status(500).json({ ok: false, error: "Ошибка сохранения в базу данных" });
    }

    return res.status(200).json({
      ok: true,
      sessionId: sanitizedReview.sessionId,
      publicCode: sanitizedReview.publicCode,
      environment: sanitizedReview.environment,
      status: sanitizedReview.status,
      source: sanitizedReview.source,
      expert_id: sanitizedReview.expert_id || null,
      expert_name: sanitizedReview.expert_name || null,
      saved_to: isLocal ? "local+supabase" : "supabase",
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to save review",
    });
  }
}
