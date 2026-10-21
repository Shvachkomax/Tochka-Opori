// Truthful MediaRecorder audio container handling. Safari/WebKit may
// record MP4/AAC where Chrome records WebM/Opus: the produced Blob and
// request Content-Type must always carry the container the browser
// actually recorded, never a hardcoded "audio/webm" label.

const FALLBACK_RECORDING_MIME = "audio/webm";

export function pickRecorderMimeType(recorder, chunks = []) {
  const candidates = [
    recorder && typeof recorder.mimeType === "string" ? recorder.mimeType : "",
    ...chunks.map((chunk) => (chunk && typeof chunk.type === "string" ? chunk.type : "")),
  ];
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (trimmed) return trimmed;
  }
  return FALLBACK_RECORDING_MIME;
}

export function buildVoiceBlob(chunks, recorder) {
  return new Blob(chunks || [], { type: pickRecorderMimeType(recorder, chunks) });
}

const MIME_CANDIDATES = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
const MIN_VOICE_BLOB_BYTES = 1000;

export function isUsableVoiceBlob(blob, minimumBytes = MIN_VOICE_BLOB_BYTES) {
  return Boolean(blob && typeof blob.size === "number" && blob.size >= minimumBytes && blob.type);
}

export function createVoiceRecording(stream) {
  if (typeof MediaRecorder === "undefined") {
    throw new Error("Запись голоса не поддерживается этим браузером.");
  }

  const supportedType = MIME_CANDIDATES.find((type) =>
    typeof MediaRecorder.isTypeSupported !== "function" || MediaRecorder.isTypeSupported(type)
  );
  let recorder;
  try {
    recorder = supportedType
      ? new MediaRecorder(stream, { mimeType: supportedType })
      : new MediaRecorder(stream);
  } catch {
    recorder = new MediaRecorder(stream);
  }

  const chunks = [];
  let finishTimer = null;
  let resolved = false;
  let resolveBlob;
  const blobPromise = new Promise((resolve) => { resolveBlob = resolve; });

  const finish = () => {
    if (resolved) return;
    resolved = true;
    if (finishTimer) clearTimeout(finishTimer);
    const mimeType = recorder.mimeType || chunks.find((chunk) => chunk.type)?.type || supportedType || "";
    resolveBlob(new Blob(chunks, { type: mimeType }));
  };

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data?.size > 0) chunks.push(event.data);
    if (recorder.state === "inactive") {
      if (finishTimer) clearTimeout(finishTimer);
      finishTimer = setTimeout(finish, 150);
    }
  });
  recorder.addEventListener("stop", () => {
    if (finishTimer) clearTimeout(finishTimer);
    finishTimer = setTimeout(finish, 150);
  }, { once: true });

  return { recorder, blobPromise };
}
