import { transcribe, analyzeVoice, TASK_TYPES } from "../lib/modelRouter.js";
import { applyCors, handleOptions } from "../lib/security/cors.js";
import { rateLimit } from "../lib/security/rate-limit.js";
import { requireClientToken } from "../lib/security/client-token.js";
import { getSupabase } from "../lib/supabase.js";
import { validateSessionAccess } from "../lib/security/access-token.js";
import { debitCreditsForSession } from "../lib/usage/debit.js";

const MAX_AUDIO_SIZE = 20 * 1024 * 1024; // 20 MB

export const config = {
  api: {
    bodyParser: false
  }
};

async function readRequestBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

async function validateSessionOwnership(sessionId, module, accessToken) {
  const supabase = getSupabase();
  let check = {
    module,
    session_exists: false,
    has_owner: false,
    legacy_access: false,
    access_token_present: !!accessToken,
    validate_access_result: null,
  };

  if (module === "support") {
    const { data: session } = await supabase
      .from("sessions")
      .select("session_id, anonymous_owner_id, legacy_access")
      .eq("session_id", sessionId)
      .maybeSingle();
    check.session_exists = !!session;
    check.has_owner = !!session?.anonymous_owner_id;
    check.legacy_access = !!session?.legacy_access;
    if (!session || !session.anonymous_owner_id) {
      console.log("[transcribe] session ownership check:", check);
      return false;
    }
    if (!session.legacy_access) {
      if (!accessToken) {
        console.log("[transcribe] session ownership check:", check);
        return false;
      }
      const valid = await validateSessionAccess(session.session_id, accessToken);
      check.validate_access_result = valid;
      console.log("[transcribe] session ownership check:", check);
      if (!valid) return false;
    }
    return true;
  }

  if (module === "body") {
    const { data: client } = await supabase
      .from("body_clients")
      .select("anonymous_owner_id")
      .eq("session_id", sessionId)
      .maybeSingle();
    check.session_exists = !!client;
    check.has_owner = !!client?.anonymous_owner_id;
    if (!client || !client.anonymous_owner_id) {
      console.log("[transcribe] session ownership check:", check);
      return false;
    }
    // Body sessions are always non-legacy; token is mandatory.
    if (!accessToken) {
      check.access_token_present = false;
      console.log("[transcribe] session ownership check:", check);
      return false;
    }
    const valid = await validateSessionAccess(sessionId, accessToken);
    check.validate_access_result = valid;
    console.log("[transcribe] session ownership check:", check);
    if (!valid) return false;
    return true;
  }

  console.log("[transcribe] session ownership check:", check);
  return false;
}

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  applyCors(req, res);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const limit = rateLimit({ windowMs: 10 * 60 * 1000, max: 30, prefix: "transcribe:", message: "Слишком много голосовых сообщений. Подождите немного или введите ответ текстом." });
  const limited = await limit(req, res);
  if (limited) return;

  // Require short-lived client token
  const tokenCheck = requireClientToken(["transcribe"])(req, res);
  if (!tokenCheck) return;

  // Parse optional session context from query params or headers
  const rawSessionId = (req.query?.session_id || req.headers["x-session-id"] || "").trim();
  const sessionId = rawSessionId && rawSessionId !== "null" && rawSessionId !== "undefined" ? rawSessionId : "";
  const rawModule = (req.query?.module || req.headers["x-module"] || "").trim();
  const module = rawModule && rawModule !== "null" && rawModule !== "undefined" ? rawModule : "";
  const accessToken = (req.query?.access_token || req.headers["x-access-token"] || "").trim();

  // Validate ownership when session context is provided
  if (sessionId && module) {
    if (!["support", "body"].includes(module)) {
      return res.status(400).json({ error: "Invalid module" });
    }
    const owned = await validateSessionOwnership(sessionId, module, accessToken);
    if (!owned) {
      return res.status(403).json({ error: "Session not found or access denied" });
    }
  } else if (sessionId || module) {
    // Must provide both or neither
    return res.status(400).json({ error: "Both session_id and module required" });
  }

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        error: "OPENAI_API_KEY is missing"
      });
    }

    const audioBuffer = await readRequestBody(req);

    if (audioBuffer.length > MAX_AUDIO_SIZE) {
      return res.status(413).json({ error: "Файл слишком большой. Максимум 20 МБ." });
    }

    const contentType = req.headers["content-type"] || "";
    const { normalizeAudioContentType, audioFilenameForContentType, isWebmAudioContentType } =
      await import("../lib/audio-mime.js");
    const normalizedType = normalizeAudioContentType(contentType);
    const audioFilename = audioFilenameForContentType(contentType);

    // Safe diagnostics only: never log raw audio or credential material.
    console.log("Transcribe request:", {
      contentType: normalizedType || "missing",
      extension: audioFilename ? audioFilename.split(".").pop() : "unsupported",
      size: audioBuffer?.length || 0,
      sessionId: sessionId || "none",
      module: module || "none",
    });

    if (!audioFilename) {
      return res.status(415).json({ error: "Неподдерживаемый формат аудио." });
    }

    if (!audioBuffer || audioBuffer.length < 1000) {
      return res.status(400).json({
        error: "Audio file is too small"
      });
    }

    const transcription = await transcribe(TASK_TYPES.TRANSCRIPTION, {
      audioBuffer,
      contentType: normalizedType,
    });

    const text = transcription.text;

    // Voice analysis is experimental and non-blocking. It only accepts WAV
    // produced from WebM input; MP4/other containers are skipped instead of
    // being sent mislabelled to the analysis path.
    let voiceObservations = null;
    let voiceAnalysisSucceeded = false;
    if (isWebmAudioContentType(contentType)) {
      try {
        const { webmToWav } = await import("../lib/audio.js");
        const wav = await webmToWav(audioBuffer);
        if (wav && wav.length > 44) {
          try {
            voiceObservations = await analyzeVoice(TASK_TYPES.VOICE_ANALYSIS, {
              audioBuffer: wav,
              audioFormat: "wav",
            });
            voiceAnalysisSucceeded = true;
          } catch (e) {
            console.log("Voice analysis skipped (non-blocking):", e.message);
          }
        } else {
          console.log("Voice analysis skipped (non-blocking): WebM->WAV produced no usable audio");
        }
      } catch (convErr) {
        console.log("Voice analysis skipped (non-blocking): WebM->WAV conversion unavailable:", convErr.message);
      }
    } else {
      console.log("Voice analysis skipped (non-blocking): container not supported for analysis:", normalizedType || "missing");
    }

    if (!voiceObservations) {
      voiceObservations = process.env.OPENAI_VOICE_ANALYSIS_MODEL
        ? { status: "error", experimental: true, error_code: "voice_analysis_failed" }
        : { status: "not_available", experimental: true };
    }

    // Debit credits for validated sessions only (must complete before response)
    if (sessionId && module) {
      const audioDurationSec = Math.ceil((audioBuffer.length / 16000) / 2); // rough estimate: ~16KB/sec for opus
      try {
        await debitCreditsForSession({
          sessionId,
          module,
          resourceType: "transcription",
          requestId: `transcribe-${sessionId}-${Date.now()}`,
          provider: transcription.provider,
          audioSeconds: audioDurationSec,
        });
      } catch (e) {
        console.error("[credits] transcribe debit failed:", e.message);
      }

      // Debit for successful voice analysis separately
      if (voiceAnalysisSucceeded) {
        try {
          await debitCreditsForSession({
            sessionId,
            module,
            resourceType: "voice_analysis",
            requestId: `voice-${sessionId}-${Date.now()}`,
          });
        } catch (e) {
          console.error("[credits] voice_analysis debit failed:", e.message);
        }
      }
    }

    return res.status(200).json({
      text,
      voice_observations: voiceObservations,
      provider: transcription.provider,
      task_type: transcription.task_type,
      request_duration: transcription.request_duration,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      error: error.message || "Transcription server error"
    });
  }
}
