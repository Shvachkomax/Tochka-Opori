export default async function handler(req, res) {
  try {
    const { text, answers, mode } = req.body || {};

    if (!text || text.trim().length < 10) {
      return res.status(400).json({
        error: "Опишите состояние подробнее"
      });
    }

    const useAI = !!process.env.OPENAI_API_KEY;

    // ===== QUESTIONS MODE =====
    if (mode === "questions") {
      if (useAI) {
        const prompt = `
Ты — клинически аккуратный AI-ассистент первичного психологического скрининга.

Текст пользователя: "${text}"

Составь 4–6 уточняющих вопросов, чтобы лучше понять состояние.
Вопросы должны быть открытыми, спокойными, не пугающими.

Формат: каждый вопрос с новой строки. Без лишнего текста.
        `;

        try {
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
                  { role: "system", content: "Ты осторожный AI для психологического скрининга." },
                  { role: "user", content: prompt }
                ],
                temperature: 0.4,
                max_tokens: 500
              })
            }
          );

          const data = await response.json();

          if (!data.error && data.choices?.[0]?.message?.content) {
            return res.status(200).json({ result: data.choices[0].message.content });
          }
        } catch (_) {
          // fall through to demo
        }
      }

      // Demo fallback questions
      return res.status(200).json({
        result: `1. Как давно вы замечаете это состояние?
2. Что обычно усиливает или ослабляет эти ощущения?
3. Влияет ли это на вашу работу, учёбу или отношения с близкими?
4. Менялся ли ваш аппетит или вес за последнее время?
5. Бывают ли моменты, когда становится легче? Что помогает?`
      });
    }

    // ===== FINAL MODE =====
    if (mode === "final") {
      const allInfo = answers
        ? `Первичное описание: "${text}"\n\nУточнения пользователя:\n${answers}`
        : text;

      if (useAI) {
        const prompt = `
Ты — клинически аккуратный AI-ассистент первичного психологического скрининга.

ВАЖНО:
- не ставь диагноз
- не пугай
- не используй категоричные формулировки
- отвечай спокойно и профессионально

Информация о пользователе:
"${allInfo}"

Дай структурированный ответ:

1. Возможные состояния (без диагноза)
2. Что может усиливать проблему
3. Что делать прямо сейчас
4. К какому специалисту обратиться
5. Когда нужна срочная помощь

Если есть признаки риска самоповреждения — обязательно добавь в конце:
🚨 ЕСЛИ У ВАС ЕСТЬ МЫСЛИ О ПРИЧИНЕНИИ ВРЕДА СЕБЕ — НЕМЕДЛЕННО ОБРАТИТЕСЬ ЗА ПОМОЩЬЮ: 112 или 103.
        `;

        try {
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
                  { role: "system", content: "Ты осторожный AI для психологического первичного скрининга." },
                  { role: "user", content: prompt }
                ],
                temperature: 0.4,
                max_tokens: 800
              })
            }
          );

          const data = await response.json();

          if (!data.error && data.choices?.[0]?.message?.content) {
            return res.status(200).json({ result: data.choices[0].message.content });
          }
        } catch (_) {
          // fall through to demo
        }
      }

      // Demo fallback final report
      return res.status(200).json({
        result: `🧠 Предварительный анализ состояния

На основе вашего описания и уточнений можно отметить:

• повышенная тревожность
• эмоциональное истощение
• нарушения сна
• хронический стресс

⚠️ Это не диагноз.

📌 Рекомендуется:
• снизить перегрузку
• нормализовать сон
• исключить алкоголь и стимуляторы
• обратиться к психологу/психотерапевту

🚨 Если состояние ухудшается или появляются мысли о причинении вреда себе — срочно обратитесь за помощью: 112 или 103.`
      });
    }

    // ===== DEFAULT (no mode) =====
    return res.status(200).json({
      result: "Режим не указан. Используйте mode: 'questions' или 'final'."
    });

  } catch (error) {
    console.error(error);
    return res.status(200).json({
      result: "⚠️ Сервис временно недоступен. Попробуйте позже."
    });
  }
}
