/**
 * One-time migration: reconstruct conversation_pairs for all existing
 * sessions and case_reviews from legacy conversation history data.
 *
 * Usage:
 *   node --experimental-vm-modules scripts/migrate-conversation-pairs.js
 *
 * This script:
 * 1. Reads sessions where conversation_pairs IS NULL or empty
 *    AND conversation_history has data.
 * 2. Uses normalizeConversationHistory() to build {round, question, answer}.
 * 3. Writes conversation_pairs back to the sessions table.
 * 4. Also patches case_reviews.json_data → adds conversation_pairs key.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { normalizeConversationHistory } from "../lib/conversation.js";

// Load env vars from .env.local
const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf-8");
const env = {};
envText.split("\n").filter((l) => l.trim() && !l.startsWith("#")).forEach((l) => {
  const eq = l.indexOf("=");
  if (eq > 0) env[l.substring(0, eq)] = l.substring(eq + 1);
});

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

let migratedCount = 0;
let skippedCount = 0;

async function migrateSessions() {
  console.log("Migrating sessions...");

  const { data: sessions, error } = await supabase
    .from("sessions")
    .select("id, session_id, conversation_history, json_data, patient_text, public_code, created_at");

  if (error) {
    console.error("Error fetching sessions:", error.message);
    return;
  }

  console.log(`Total sessions: ${sessions.length}`);

  for (const s of sessions) {
    const jd = s.json_data || {};
    // Skip if already has conversation_pairs in json_data
    if (jd.conversation_pairs && jd.conversation_pairs.length > 0) {
      skippedCount++;
      continue;
    }

    const rawHistory = s.conversation_history || jd.conversation_history || jd.conversationHistory || [];
    const json = { ...jd, patient_text: s.patient_text };

    const { rounds } = normalizeConversationHistory(rawHistory, json);

    if (rounds.length === 0) {
      skippedCount++;
      continue;
    }

    const pairs = rounds.map((r) => ({
      round: r.round,
      question: r.question,
      answer: r.answer,
      created_at: s.created_at || new Date().toISOString(),
    }));

    jd.conversation_pairs = pairs;

    const { error: updateError } = await supabase
      .from("sessions")
      .update({ json_data: jd })
      .eq("id", s.id);

    if (updateError) {
      console.error(`  Error updating session ${s.session_id}: ${updateError.message}`);
    } else {
      migratedCount++;
      if (migratedCount <= 3) {
        console.log(`  OK ${s.public_code || s.session_id}: ${pairs.length} pairs`);
      }
    }
  }
}

async function migrateCaseReviews() {
  console.log("\nMigrating case_reviews...");

  const { data: reviews, error } = await supabase
    .from("case_reviews")
    .select("id, case_id, session_id, json_data, public_code, created_at");

  if (error) {
    console.error("Error fetching case_reviews:", error.message);
    return;
  }

  console.log(`Found ${reviews.length} case_reviews to check`);

  let reviewPatched = 0;

  for (const r of reviews) {
    if (!r.json_data) continue;

    const jd = typeof r.json_data === "string" ? JSON.parse(r.json_data) : r.json_data;

    // Skip if already has conversation_pairs
    if (jd.conversation_pairs && jd.conversation_pairs.length > 0) {
      skippedCount++;
      continue;
    }

    const rawHistory = jd.conversationHistory || jd.conversation_history || [];
    const { rounds } = normalizeConversationHistory(rawHistory, jd);

    if (rounds.length === 0) {
      skippedCount++;
      continue;
    }

    const pairs = rounds.map((rnd) => ({
      round: rnd.round,
      question: rnd.question,
      answer: rnd.answer,
      created_at: r.created_at || new Date().toISOString(),
    }));

    jd.conversation_pairs = pairs;

    const { error: updateError } = await supabase
      .from("case_reviews")
      .update({ json_data: jd })
      .eq("id", r.id);

    if (updateError) {
      console.error(`  Error updating case_review ${r.id}: ${updateError.message}`);
    } else {
      reviewPatched++;
      migratedCount++;
      if (reviewPatched <= 3) {
        console.log(`  OK ${r.public_code || r.case_id}: ${pairs.length} pairs`);
      }
    }
  }
}

async function main() {
  console.log("=== Conversation Pairs Migration ===\n");

  await migrateSessions();
  await migrateCaseReviews();

  console.log(`\nDone. Migrated: ${migratedCount}, Skipped: ${skippedCount}`);
}

main().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
