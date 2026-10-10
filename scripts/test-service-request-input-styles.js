import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.join(__dirname, "..", "src", "BodyServiceRequests.jsx");
const source = fs.readFileSync(sourcePath, "utf8");
const lines = source.split("\n");

const offenders = [];
lines.forEach((line, index) => {
  if (!/<(textarea|input)\b/.test(line)) return;
  const match = line.match(/style=\{\{([\s\S]*?)\}\}/);
  if (!match) return;
  const style = match[1];
  const isWhiteBackground = /background\s*:\s*["']#(fff|ffffff)["']/.test(style);
  const hasColor = /\bcolor\s*:/.test(style);
  if (isWhiteBackground && !hasColor) {
    offenders.push(`  line ${index + 1}: white background without explicit 'color'`);
  }
});

if (offenders.length) {
  console.error(`FAIL: ${offenders.length} textarea/input in src/BodyServiceRequests.jsx would render white text on white background:`);
  for (const o of offenders) console.error(o);
  process.exitCode = 1;
} else {
  console.log("PASS every white-background textarea/input in BodyServiceRequests.jsx sets an explicit text color");
}