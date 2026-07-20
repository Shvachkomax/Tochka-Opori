import { transcribe, analyzeVoice, TASK_TYPES } from "../lib/modelRouter.js";
import { applyCors, handleOptions } from "../lib/security/cors.js";
import { rateLimit } from "../lib/security/rate-limit.js";

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

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  applyCors(req, res);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const limit = rateLimit({ windowMs: 10 * 60 * 1000, max: 10, prefix: "transcribe:" });
  const limited = limit(req, res);
  if (limited) return;

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

    console.log("Transcribe request:", {
      contentType: req.headers["content-type"],
      size: audioBuffer?.length || 0,
    });

    if (!audioBuffer || audioBuffer.length < 1000) {
      return res.status(400).json({
        error: "Audio file is too small"
      });
    }

    const contentType = req.headers["content-type"] || "audio/webm";

    const transcription = await transcribe(TASK_TYPES.TRANSCRIPTION, {
      audioBuffer,
      contentType,
    });

    const text = transcription.text;
    let audioFormat = "webm";
    let audioForAnalysis = audioBuffer;

    try {
      const { webmToWav } = await import("../lib/audio.js");
      const wav = await webmToWav(audioBuffer);
      if (wav && wav.length > 44) {
        audioForAnalysis = wav;
        audioFormat = "wav";
      }
    } catch (convErr) {
      console.log("WebM->WAV conversion unavailable, trying original format:", convErr.message);
    }

    let voiceObservations = null;
    try {
      voiceObservations = await analyzeVoice(TASK_TYPES.VOICE_ANALYSIS, {
        audioBuffer: audioForAnalysis,
        audioFormat,
      });
    } catch (e) {
      console.log("Voice analysis skipped (non-blocking):", e.message);
    }

    if (!voiceObservations) {
      voiceObservations = process.env.OPENAI_VOICE_ANALYSIS_MODEL
        ? { status: "error", experimental: true, error_code: "voice_analysis_failed" }
        : { status: "not_available", experimental: true };
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
