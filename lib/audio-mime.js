// Audio container MIME helpers shared by the transcription provider and
// transcribe API. Normalization strips codec parameters (for example
// "audio/mp4;codecs=mp4a.40.2" is recognised as MP4) and maps the base
// media type to a truthful filename extension. Unknown types are never
// relabelled as a supported container.

const EXTENSION_BY_TYPE = {
  "audio/webm": "webm",
  "video/webm": "webm",
  "audio/mp4": "mp4",
  "video/mp4": "mp4",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
};

export function normalizeAudioContentType(value) {
  if (typeof value !== "string") return "";
  return value.split(";")[0].trim().toLowerCase();
}

export function audioExtensionForContentType(value) {
  return EXTENSION_BY_TYPE[normalizeAudioContentType(value)] || null;
}

export function audioFilenameForContentType(value, basename = "voice") {
  const extension = audioExtensionForContentType(value);
  return extension ? `${basename}.${extension}` : null;
}

export function isWebmAudioContentType(value) {
  const normalized = normalizeAudioContentType(value);
  return normalized === "audio/webm" || normalized === "video/webm";
}
