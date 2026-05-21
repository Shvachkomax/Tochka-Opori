export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { text } = req.body || {};

    if (!text || text.length < 20) {
      return res.status(400).json({ error: "Слишком короткое описание" });
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content:
              "Ты ОБЯЗАН вернуть только JSON объект без markdown, пояснений и текста.",
          },
          {
            role: "user",
            content: `Проанализируй текст пользователя и верни JSON:
{
  "summary": "краткое резюме",
  "clusters": ["спектр 1", "спектр 2"],
  "risk": "low",
  "questions": ["вопрос 1", "вопрос 2", "вопрос 3"],
  "recommendation": "мягкая рекомендация"
}

Текст пользователя:
${text}`,
          },
        ],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({
        error: data.error?.message || "OpenAI API error",
      });
    }

    let raw = data.output_text || "";

    raw = raw
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    if (!raw) {
      return res.status(500).json({
        error: "AI returned empty response",
      });
    }

    let parsed;

    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return res.status(500).json({
        error: "Invalid AI JSON: " + raw,
      });
    }

    return res.status(200).json({
      result: parsed,
    });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Ошибка анализа",
    });
  }
}
