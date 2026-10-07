const EXTENSIONS_BY_MIME = new Map([
  ["audio/mp4", "mp4"],
  ["audio/m4a", "m4a"],
  ["audio/x-m4a", "m4a"],
  ["audio/webm", "webm"],
  ["audio/ogg", "ogg"],
  ["audio/wav", "wav"],
  ["audio/x-wav", "wav"],
  ["audio/mpeg", "mp3"],
  ["audio/mp3", "mp3"],
  ["video/mp4", "mp4"],
]);

const MIME_ALIASES = new Map([
  ["audio/x-m4a", "audio/mp4"],
  ["audio/m4a", "audio/mp4"],
  ["audio/x-wav", "audio/wav"],
  ["audio/mp3", "audio/mpeg"],
  ["video/mp4", "audio/mp4"],
]);

export function normalizeAudioContentType(value) {
  const mime = String(value || "").split(";")[0].trim().toLowerCase();
  return MIME_ALIASES.get(mime) || mime;
}

export function getAudioExtension(value) {
  const rawMime = String(value || "").split(";")[0].trim().toLowerCase();
  if (rawMime === "audio/x-m4a" || rawMime === "audio/m4a") return "m4a";
  return EXTENSIONS_BY_MIME.get(normalizeAudioContentType(value)) || null;
}

export function isSupportedAudioContentType(value) {
  return getAudioExtension(value) !== null;
}

export function isWebmAudioContentType(value) {
  return normalizeAudioContentType(value) === "audio/webm";
}
