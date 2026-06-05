import fs from "node:fs";
import path from "node:path";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const review = req.body;

    if (!review || !review.case_id) {
      return res.status(400).json({ error: "Invalid case review" });
    }

    const dataDir = path.join(process.cwd(), "data");
    const filePath = path.join(dataDir, "case-reviews.jsonl");

    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    fs.appendFileSync(filePath, JSON.stringify(review) + "\n", "utf8");

    return res.status(200).json({
      ok: true,
      saved_to: "data/case-reviews.jsonl",
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Failed to save review",
    });
  }
}
