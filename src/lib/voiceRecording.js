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
