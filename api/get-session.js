import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
const SESSIONS_DIR = path.join(DATA_DIR, "sessions");
const JSONL_PATH = path.join(DATA_DIR, "case-reviews.jsonl");

function findInJsonl(normalizedCode) {
  if (!fs.existsSync(JSONL_PATH)) return null;
  const lines = fs.readFileSync(JSONL_PATH, "utf8").split("\n").filter(Boolean);
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.publicCode && entry.publicCode.toUpperCase() === normalizedCode) {
        return entry;
      }
    } catch {
      continue;
    }
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { code } = req.body || {};

    if (!code || typeof code !== "string") {
      return res.status(400).json({ error: "Введите код диалога" });
    }

    const normalizedCode = code.trim().toUpperCase();

    // Search in sessions dir
    if (fs.existsSync(SESSIONS_DIR)) {
      const files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        const filePath = path.join(SESSIONS_DIR, file);
        try {
          const session = JSON.parse(fs.readFileSync(filePath, "utf8"));
          if (session.publicCode && session.publicCode.toUpperCase() === normalizedCode) {
            return res.status(200).json({ session });
          }
        } catch {
          continue;
        }
      }
    }

    // Fallback to JSONL
    const fromJsonl = findInJsonl(normalizedCode);
    if (fromJsonl) {
      return res.status(200).json({ session: fromJsonl });
    }

    return res.status(404).json({ error: "Код не найден. Проверьте правильность ввода." });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Ошибка при поиске сессии",
    });
  }
}
