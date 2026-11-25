import { spawnSync } from "node:child_process";
import { stdin, stdout } from "node:process";
import { attestSupabaseServiceRoleKey } from "../lib/security/supabase-key-attestation.js";

const MAX_KEY_BYTES = 16 * 1024;

function printResult(result) {
  stdout.write([
    `Тип ключа: ${result.keyType || "UNKNOWN"}`,
    `Статус проверки: ${result.status}`,
    `SHA-256: ${result.fingerprint || "—"}`,
    result.passed ? "PASS" : "BLOCKED",
    "",
  ].join("\n"));
}

async function readFromStdin() {
  if (stdin.isTTY) throw new Error("stdin is interactive");
  const chunks = [];
  let size = 0;
  for await (const chunk of stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_KEY_BYTES) throw new Error("stdin is too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function clearMacClipboard() {
  return spawnSync("/usr/bin/pbcopy", [], {
    input: "",
    encoding: "utf8",
    stdio: ["pipe", "ignore", "ignore"],
  }).status === 0;
}

function readFromMacClipboardAndClear() {
  if (process.platform !== "darwin") throw new Error("clipboard mode requires macOS");
  const pasted = spawnSync("/usr/bin/pbpaste", [], {
    encoding: "utf8",
    maxBuffer: MAX_KEY_BYTES,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const cleared = clearMacClipboard();
  if (pasted.status !== 0 || !cleared) throw new Error("clipboard operation failed");
  return pasted.stdout;
}

function copyFingerprintToMacClipboard(fingerprint) {
  return spawnSync("/usr/bin/pbcopy", [], {
    input: fingerprint,
    encoding: "utf8",
    stdio: ["pipe", "ignore", "ignore"],
  }).status === 0;
}

async function main() {
  const args = process.argv.slice(2);
  const clipboardMode = args.length === 1 && args[0] === "--clipboard";
  const stdinMode = args.length === 0 || (args.length === 1 && args[0] === "--stdin");
  if (!clipboardMode && !stdinMode) {
    printResult({
      keyType: "UNKNOWN",
      status: "BLOCKED_USAGE",
      fingerprint: null,
      passed: false,
    });
    process.exitCode = 1;
    return;
  }

  let rawKey;
  try {
    rawKey = clipboardMode ? readFromMacClipboardAndClear() : await readFromStdin();
  } catch {
    printResult({
      keyType: "UNKNOWN",
      status: "BLOCKED_INPUT",
      fingerprint: null,
      passed: false,
    });
    process.exitCode = 1;
    return;
  }

  const result = await attestSupabaseServiceRoleKey(rawKey);
  if (result.passed && clipboardMode && !copyFingerprintToMacClipboard(result.fingerprint)) {
    printResult({
      ...result,
      status: "BLOCKED_FINGERPRINT_CLIPBOARD",
      passed: false,
    });
    process.exitCode = 1;
    return;
  }

  printResult(result);
  if (!result.passed) process.exitCode = 1;
}

try {
  await main();
} catch {
  printResult({
    keyType: "UNKNOWN",
    status: "BLOCKED_UNEXPECTED",
    fingerprint: null,
    passed: false,
  });
  process.exitCode = 1;
}
