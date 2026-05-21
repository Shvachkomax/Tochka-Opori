export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { text } = req.body || {};

    if (!text || text.length < 20) {
      return res.status(400).json({
        error: "Слишком короткое описание"
      });
    }

    const prompt = `
Ты — AI-ассистент первичного психиатрического скрининга.

НЕ ставь диагноз.
НЕ назначай препараты.

Нужно:
1. Кратко суммировать состояние.
2. Выделить возможные symptom clusters.
3. Определить risk level.
4. Сформулировать 3 уточняющих вопроса.
5. Дать мягкую рекомендацию.

Ответ строго JSON:

{
  "summary": "...",
  "clusters": ["..."],
  "risk": "low | medium | high | crisis",
  "questions": ["...", "...", "..."],
  "recommendation": "..."
}

Текст пользователя:
${text}
`;

    const response = await fetch(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          input: prompt,
          text: {
            format: {
              type: "json_object"
            }
          }
        })
      }
    );

    const data = await response.json();

    const parsed = JSON.parse(data.output_text);

    res.status(200).json({
      result: parsed
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Ошибка анализа"
    });
  }
}
