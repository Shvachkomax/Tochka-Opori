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
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        error: "OPENAI_API_KEY is missing"
      });
    }

    const audioBuffer = await readRequestBody(req);

    console.log("Transcribe request:", {
      contentType: req.headers["content-type"],
      size: audioBuffer?.length || 0
    });

    if (!audioBuffer || audioBuffer.length < 1000) {
      return res.status(400).json({
        error: "Audio file is too small"
      });
    }

    const formData = new FormData();

    const audioBlob = new Blob([audioBuffer], {
      type: req.headers["content-type"] || "audio/webm"
    });

    const MODEL_TRANSCRIBE = process.env.AI_MODEL_TRANSCRIBE || "gpt-4o-mini-transcribe";

    console.log("Using AI model for transcribe:", MODEL_TRANSCRIBE);

    formData.append("file", audioBlob, "voice.webm");
    formData.append("model", MODEL_TRANSCRIBE);
    formData.append("language", "ru");

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: formData
    });

    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error("OpenAI transcribe: non-JSON response", response.status, responseText.slice(0, 300));
      return res.status(500).json({
        error: "OpenAI вернул пустой ответ"
      });
    }

    if (!response.ok || data.error) {
      return res.status(500).json({
        error: data.error?.message || "Transcription failed"
      });
    }

    const text = data.text || "";

    let voiceObservations = null;
    const voiceModel = process.env.OPENAI_VOICE_ANALYSIS_MODEL;

    if (voiceModel && audioBuffer.length >= 1000) {
      try {
        let audioForAnalysis = audioBuffer;
        let audioFormat = "webm";

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

        const audioBase64 = audioForAnalysis.toString("base64");

        const promptPath = new URL("../prompts/voice-analysis.md", import.meta.url);
        let voiceSystemPrompt = "Ты анализируешь голосовое сообщение и возвращаешь JSON.";
        try {
          const { readFileSync, existsSync } = await import("node:fs");
          if (existsSync(promptPath)) {
            voiceSystemPrompt = readFileSync(promptPath, "utf-8");
          }
        } catch {}

        const voiceRes = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: voiceModel,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "input_audio",
                    input_audio: {
                      data: audioBase64,
                      format: audioFormat,
                    },
                  },
                  {
                    type: "text",
                    text: voiceSystemPrompt,
                  },
                ],
              },
            ],
            temperature: 0.3,
          }),
        });

        const voiceText = await voiceRes.text();
        let voiceData;
        try {
          voiceData = JSON.parse(voiceText);
        } catch {
          voiceData = null;
        }

        if (voiceRes.ok && voiceData && !voiceData.error) {
          const content = voiceData.choices?.[0]?.message?.content || "";
          try {
            voiceObservations = JSON.parse(content);
            voiceObservations.experimental = true;
          } catch {
            voiceObservations = { status: "error", experimental: true, error_code: "voice_analysis_invalid_response" };
          }
        }
      } catch (e) {
        console.log("Voice analysis skipped (non-blocking):", e.message);
      }
    }

    if (!voiceObservations) {
      voiceObservations = voiceModel
        ? { status: "error", experimental: true, error_code: "voice_analysis_failed" }
        : { status: "not_available", experimental: true };
    }

    return res.status(200).json({
      text,
      voice_observations: voiceObservations,
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Transcription server error"
    });
  }
}
