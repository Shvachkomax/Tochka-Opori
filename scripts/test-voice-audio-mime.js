import { createVoiceRecording } from "../src/lib/voiceRecording.js";
import { getAudioExtension, normalizeAudioContentType, isSupportedAudioContentType, isWebmAudioContentType } from "../lib/audio-mime.js";

let passed = 0;
let failed = 0;
function assert(condition, label) {
  if (condition) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

assert(normalizeAudioContentType("audio/mp4; codecs=mp4a.40.2") === "audio/mp4", "normalizes Safari MP4 MIME");
assert(getAudioExtension("audio/mp4") === "mp4", "maps MP4 MIME to .mp4");
assert(getAudioExtension("audio/x-m4a") === "m4a", "maps M4A alias to .m4a");
assert(getAudioExtension("audio/webm;codecs=opus") === "webm", "maps WebM MIME to .webm");
assert(isSupportedAudioContentType("audio/mp4"), "accepts Safari audio");
assert(!isSupportedAudioContentType("application/octet-stream"), "rejects unknown MIME");
assert(isWebmAudioContentType("audio/webm;codecs=opus"), "identifies WebM for optional voice analysis");
assert(!isWebmAudioContentType("audio/mp4"), "does not treat MP4 as WebM");

class FakeMediaRecorder {
  static supported = ["audio/mp4"];
  static isTypeSupported(type) { return this.supported.includes(type); }
  constructor(_stream, options = {}) { this.mimeType = options.mimeType || "audio/mp4"; this.state = "inactive"; this.listeners = {}; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  emit(name, data = {}) { for (const fn of this.listeners[name] || []) fn({ type: name, ...data }); }
  start() { this.state = "recording"; }
  stop() {
    this.state = "inactive";
    this.emit("dataavailable", { data: new Blob(["iphone audio"], { type: this.mimeType }) });
    this.emit("stop");
  }
}
globalThis.MediaRecorder = FakeMediaRecorder;
const capture = createVoiceRecording({});
capture.recorder.start();
capture.recorder.stop();
const blob = await capture.blobPromise;
assert(blob.type === "audio/mp4", "preserves recorder MIME in final Blob");
assert(await blob.text() === "iphone audio", "collects final dataavailable payload before resolving");
assert(getAudioExtension(blob.type) === "mp4", "keeps matching file extension for provider upload");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
