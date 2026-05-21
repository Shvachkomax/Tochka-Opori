export default async function handler(req, res) {
  try {
    const { text } = req.body;

    if (!text || text.trim().length < 10) {
      return res.status(400).json({
        error: "Опишите состояние подробнее"
      });
    }

    // Если API ключ отсутствует — используем demo режим
    if (!process.env.OPENAI_API_KEY) {
      return res.status(200).json({
        result: `
🧠 Предварительный анализ состояния

Ваше описание похоже на сочетание:

• повышенной тревожности
• эмоционального истощения
• нарушений сна
• хронического стресса

⚠️ Это не диагноз.

📌 Рекомендуется:
• снизить перегрузку
• нормализовать сон
• исключить алкоголь и стимуляторы
• обратиться к психологу/психотерапевту

🚨 Если состояние ухудшается или появляются мысли о причинении вреда себе — срочно обратитесь за помощью.
        `
      });
    }

    const prompt = `
Ты — клинически аккуратный AI-ассистент первичного психологического скрининга.

ВАЖНО:
- не ставь диагноз
- не пугай
- не используй категоричные формулировки
- не упоминай психоз/шизофрению без явных признаков
- отвечай спокойно и профессионально

Текст пользователя:
"${text}"

Дай ответ в формате:

1. Возможные состояния
2. Что может усиливать проблему
3. Что делать прямо сейчас
4. К какому специалисту обратиться
5. Когда нужна срочная помощь
`;

    const response = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          messages: [
            {
              role: "system",
              content:
                "Ты осторожный AI для психологического первичного скрининга."
            },
            {
              role: "user",
              content: prompt
            }
          ],
          temperature: 0.4,
          max_tokens: 700
        })
      }
    );

    const data = await response.json();

    // Если OpenAI вернул ошибку
    if (data.error) {
      return res.status(200).json({
        result:
          "Сервис временно перегружен. Попробуйте ещё раз через несколько минут."
      });
    }

    const result =
      data.choices?.[0]?.message?.content ||
      "Не удалось выполнить анализ.";

    return res.status(200).json({
      result
    });

  } catch (error) {
    console.error(error);

    return res.status(200).json({
      result:
        "⚠️ Сервис временно недоступен. Попробуйте позже."
    });
  }
}
