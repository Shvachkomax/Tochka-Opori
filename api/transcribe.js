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

    const data = await response.json();

    if (!response.ok || data.error) {
      return res.status(500).json({
        error: data.error?.message || "Transcription failed"
      });
    }

    return res.status(200).json({
      text: data.text || ""
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Transcription server error"
    });
  }
}
