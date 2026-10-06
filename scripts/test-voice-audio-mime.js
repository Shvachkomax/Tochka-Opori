// Deterministic tests for truthful audio container handling across the
// voice transcription path (client recorder helper, server MIME mapping,
// OpenAI provider filename derivation). No network, no Supabase.
// Usage: node scripts/test-voice-audio-mime.js

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildVoiceBlob, pickRecorderMimeType } from "../src/lib/voiceRecording.js";
import {
  audioFilenameForContentType,
  audioExtensionForContentType,
  isWebmAudioContentType,
  normalizeAudioContentType,
} from "../lib/audio-mime.js";

let passed = 0;
function check(value, label) {
  assert.ok(value, label);
  passed++;
  console.log(`  OK ${label}`);
}

const chunk = (type, size = 8) => ({ type, size });

console.log("A. Recorder MIME preservation (Safari MP4)");
{
  const recorder = { mimeType: "audio/mp4" };
  const blob = buildVoiceBlob([chunk("audio/mp4")], recorder);
  check(blob.type === "audio/mp4", "recorder mimeType=audio/mp4 produces a Blob typed audio/mp4");
  const contentType = blob.type;
  check(contentType === "audio/mp4", "the transcription request Content-Type is the actual blob type");
  check(audioFilenameForContentType(blob.type) === "voice.mp4", "MP4 recording maps to voice.mp4, never voice.webm");
}

console.log("\nB. WebM with codec parameters");
{
  const recorder = { mimeType: "audio/webm;codecs=opus" };
  const blob = buildVoiceBlob([chunk("audio/webm;codecs=opus")], recorder);
  check(blob.type === "audio/webm;codecs=opus", "WebM codec parameters are preserved on the blob");
  check(normalizeAudioContentType(blob.type) === "audio/webm", "WebM normalizes to audio/webm");
  check(isWebmAudioContentType(blob.type) === true, "WebM with codec parameters is recognised as WebM");
  check(audioFilenameForContentType(blob.type) === "voice.webm", "WebM maps to voice.webm");
}

console.log("\nC. Provider filename mapping");
{
  check(audioFilenameForContentType("audio/mp4") === "voice.mp4", "audio/mp4 -> voice.mp4");
  check(audioFilenameForContentType("audio/webm") === "voice.webm", "audio/webm -> voice.webm");
  check(audioFilenameForContentType("audio/wav") === "voice.wav", "audio/wav -> voice.wav");
  check(audioFilenameForContentType("video/mp4") === "voice.mp4", "video/mp4 -> voice.mp4");
  check(audioFilenameForContentType("audio/m4a") === "voice.m4a", "audio/m4a -> voice.m4a");
  check(audioFilenameForContentType("audio/x-m4a") === "voice.m4a", "audio/x-m4a -> voice.m4a");
  check(audioFilenameForContentType("audio/mpeg") === "voice.mp3", "audio/mpeg -> voice.mp3");
  check(audioFilenameForContentType("audio/ogg") === "voice.ogg", "audio/ogg -> voice.ogg");
  check(audioFilenameForContentType("audio/mp4;codecs=mp4a.40.2") === "voice.mp4",
    "audio/mp4;codecs=mp4a.40.2 stays recognised as MP4");
  check(audioExtensionForContentType("AUDIO/MP4;CODECS=MP4A.40.2") === "mp4", "mapping is case-insensitive");
  check(audioFilenameForContentType("audio/flac") === null, "unsupported audio/flac fails clearly instead of being called webm");
  check(audioFilenameForContentType("") === null, "missing content type fails clearly");
  check(audioFilenameForContentType(undefined) === null, "undefined content type fails clearly");
}

console.log("\nD. MP4 bytes are never labelled webm");
{
  const recorder = { mimeType: "audio/mp4;codecs=mp4a.40.2" };
  const blob = buildVoiceBlob([chunk("audio/mp4"), chunk("audio/mp4")], recorder);
  check(blob.type !== "audio/webm" && blob.type.startsWith("audio/mp4"), "Safari MP4 bytes keep their MP4 label end-to-end");
  check(audioFilenameForContentType(blob.type) !== "voice.webm", "MP4 never maps to a voice.webm filename");
  check(normalizeAudioContentType("audio/mp4") !== "audio/webm", "normalization never rewrites mp4 to webm");
}

console.log("\nG. Mocked Safari MediaRecorder request flow");
{
  // Safari-style recorder: mimeType present, chunks carry the same container.
  const safariRecorder = { mimeType: "audio/mp4;codecs=mp4a.40.2" };
  const safariChunks = [chunk("audio/mp4"), chunk("audio/mp4", 16)];
  const blob = buildVoiceBlob(safariChunks, safariRecorder);
  const request = {
    method: "POST",
    url: "/api/transcribe",
    headers: {
      "Content-Type": blob.type,
      "X-Session-Id": "HEALTH-TEST-000",
      "X-Module": "body",
      "X-Access-Token": "test-token",
    },
    body: blob,
  };
  check(request.headers["Content-Type"] === "audio/mp4;codecs=mp4a.40.2",
    "the full client transcription request carries the recorder container");
  check(!request.headers["Content-Type"].includes("webm"), "the request is not mislabelled as webm");

  // Firefox/desktop-style recorder without an explicit recorder mimeType.
  const chunkOnly = buildVoiceBlob([chunk("audio/webm;codecs=opus")], { mimeType: "" });
  check(chunkOnly.type === "audio/webm;codecs=opus", "chunk.type is used when recorder.mimeType is empty");
  check(pickRecorderMimeType(null, [chunk(""), chunk("audio/ogg")]) === "audio/ogg",
    "first non-empty chunk type wins");
  check(pickRecorderMimeType(null, [chunk("")]) === "audio/webm", "safe fallback applies when nothing is reported");
}

console.log("\nProvider and API source hardening");
{
  const providerCode = readFileSync("lib/providers/openai.js", "utf8");
  check(!providerCode.includes('"voice.webm"') && !providerCode.includes("'voice.webm'"),
    "the OpenAI provider never hardcodes a voice.webm filename");
  check(providerCode.includes("audioFilenameForContentType(contentType)"),
    "the OpenAI provider derives the filename from the normalized content type");
  check(providerCode.includes("unsupported_audio_type"),
    "the OpenAI provider fails clearly on unsupported content types");

  const apiCode = readFileSync("api/transcribe.js", "utf8");
  check(!apiCode.includes('|| "audio/webm"'), "the transcribe API no longer defaults unknown audio to webm");
  check(apiCode.includes("isWebmAudioContentType"), "voice analysis is gated on the actual WebM container");
  check(!apiCode.includes("audioFormat = \"webm\""), "no audio is sent to voice analysis labelled as webm");

  for (const file of ["src/BodyDiary.jsx", "src/HealthCabinet.jsx", "src/App.jsx"]) {
    const code = readFileSync(file, "utf8");
    check(!code.includes('type: "audio/webm"') && !code.includes('"Content-Type": "audio/webm"'),
      `${file} no longer hardcodes audio/webm for recorded audio`);
    check(code.includes("buildVoiceBlob"), `${file} builds recording blobs through the shared helper`);
  }
  const diaryCode = readFileSync("src/BodyDiary.jsx", "utf8");
  check(diaryCode.includes('"Content-Type": blob.type'), "BodyDiary sends the actual blob type as Content-Type");
  check(diaryCode.includes('"X-Session-Id": sessionId') && diaryCode.includes('"X-Module": "body"')
    && diaryCode.includes('"X-Access-Token": saved.accessToken'),
    "BodyDiary keeps the Health credential-pair headers");
}

console.log(`\nVoice audio MIME tests: ${passed} passed`);
