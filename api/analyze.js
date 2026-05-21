export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { text } = req.body || {};

    if (!text || text.trim().length < 20) {
      return res.status(400).json({ error: "Слишком короткое описание" });
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Ты ассистент первичного mental health скрининга. Не ставь диагноз. Не назначай лекарства. Верни только JSON.",
          },
          {
            role: "user",
            content: `Проанализируй текст и верни JSON:
{
  "summary": "краткое резюме",
  "clusters": ["спектр 1", "спектр 2"],
  "risk": "low | medium | high | crisis",
  "questions": ["вопрос 1", "вопрос 2", "вопрос 3"],
  "recommendation": "рекомендация"
}

Текст:
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

    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return res.status(500).json({ error: "Empty AI response" });
    }

    const parsed = JSON.parse(content);

    return res.status(200).json({ result: parsed });
  } catch (error) {
    return res.status(500).json({
      error: error.message || "Ошибка анализа",
    });
  }
}
