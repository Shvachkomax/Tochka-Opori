// Pure tests for Support cabinet voice-to-text input composition.

import { appendVoiceText } from "../src/supportVoice.js";

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

assert(appendVoiceText("", "  голосовой ответ  ") === "голосовой ответ", "empty field receives trimmed transcription");
assert(appendVoiceText("Уже написано", "ещё текст") === "Уже написано\nещё текст", "typed text is preserved and transcription appended");
assert(appendVoiceText("Уже написано. ", "ещё текст") === "Уже написано. ещё текст", "existing whitespace is preserved");
assert(appendVoiceText("Уже написано.", "ещё текст") === "Уже написано. ещё текст", "punctuated text gets a readable separator");
assert(appendVoiceText("Текст", "") === "Текст", "empty transcription leaves existing text unchanged");
assert(appendVoiceText("", "   ") === "", "whitespace-only transcription leaves empty field unchanged");

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
