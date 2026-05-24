export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { text, answers, mode, conversationHistory: rawHistory, depth = 0 } = req.body || {};

  if (!text || text.trim().length < 10) {
    return res.status(400).json({ error: "Опишите состояние подробнее" });
  }

  const MIN_DEPTH = 3;
  const MAX_DEPTH = 8;

  const fallbackQuestions = [
    "Было ли в последние месяцы важное событие, потеря, конфликт, болезнь, переезд, военные события, исчезновение или смерть близкого человека, которое могло повлиять на ваше состояние?",
    "Началось ли состояние после конкретного события или постепенно, без понятной причины?",
    "Были ли алкоголь, вещества, новые лекарства, отмена препаратов, гормональные или соматические проблемы, которые совпали с ухудшением?",
    "Как давно вы замечаете это состояние?",
    "Насколько это влияет на сон, работу, учебу или отношения?",
    "Бывали ли мысли, что жить не хочется или причинить себе вред?",
    "Бывали ли ощущения, что вы слышите или замечаете то, чего не замечают другие?",
    "Бывали ли периоды, когда вы почти не спали, но чувствовали необычный прилив энергии?",
  ];

  const fallbackFinal = `===USER_REPORT===

Предварительный разбор для вас

1. Что сейчас видно
По описанию заметны признаки эмоционального напряжения, усталости, нарушения сна и трудностей с концентрацией. Это не диагноз, а первичный скрининг.

2. Что могло запустить или усиливать состояние
Важно оценить возможные триггеры: стрессовые события, утрата, конфликты, болезни, перегрузка, вещества или соматические факторы.

3. Что важно уточнить
Важно понять длительность состояния, влияние на обычную жизнь, наличие мыслей о самоповреждении, эпизодов потери контроля.

4. Возможные направления помощи
Может быть полезна консультация психолога, психотерапевта или врача-психиатра.

5. Что можно сделать сегодня
Снизить нагрузку, стабилизировать сон, записать основные жалобы и обратиться за консультацией.

6. Когда нужна срочная помощь
Если появляются мысли о причинении вреда себе или другим — звоните 112 или 103.

===DOCTOR_REPORT===

- Жалобы: требуют уточнения.
- Timeline: уточнить.
- Сон: уточнить.
- Функциональное снижение: уточнить.
- Possible etiology / triggers: требуется оценка.
- Risk level: требует уточнения.
- Red flags: проверить.
- Reality testing: уточнить.
- Differential directions: тревожный спектр, депрессивный спектр, стресс/выгорание.
- Что врачу важно уточнить: анамнез, сон, вещества, суицидальные мысли.
- Рекомендуемая срочность: консультация специалиста в плановом порядке.`;

  if (!process.env.OPENAI_API_KEY) {
    return res.status(200).json({
      type: "questions",
      questions: fallbackQuestions,
    });
  }

  const convHistory = Array.isArray(rawHistory) ? rawHistory : [];

  let historyText = "";
  if (convHistory.length > 0) {
    historyText = convHistory
      .map((entry) => {
        if (entry.role === "user") {
          return `Пользователь: ${entry.content || JSON.stringify(entry.answers)}`;
        }
        if (entry.role === "assistant") {
          return `AI: заданы вопросы — ${(entry.questions || []).join("; ")}`;
        }
        return "";
      })
      .join("\n\n");
  }

  const currentAnswersText =
    answers && typeof answers === "object"
      ? Object.entries(answers)
          .map(([key, val]) => `Вопрос ${parseInt(key) + 1}: ${val || "нет ответа"}`)
          .join("\n")
      : "";

  const systemPrompt = `Ты — AI-ассистент первичного mental health triage. Ты ведешь адаптивный клинический диалог.

Твоя задача:
- строить гипотезы о возможных направлениях проблемы
- проверять их через уточняющие вопросы
- углублять диалог по мере необходимости
- не завершать слишком рано

Всегда оценивай:
- что осталось неясным
- какие гипотезы конкурируют
- какие риски не проверены
- какой информации не хватает

Отслеживай возможные направления (internal, не показывать пользователю):
- reactive/grief/trauma
- endogenous depressive
- anxiety spectrum
- ADHD-like
- bipolar-spectrum
- psychosis/reality-testing
- substance-related
- somatic contributor
- sleep/circadian

Правила:
- не ставь диагноз
- не назначай лекарства
- не используй "у вас психоз/шизофрения/БАР"
- используй "возможные признаки", "важно обсудить со специалистом"
- если риск самоповреждения — срочная помощь 112/103
- не усиливай тревогу
- отвечай на русском языке

MIN_DEPTH = ${MIN_DEPTH}. Не завершай диалог до MIN_DEPTH, если нет low complexity, low risk и clear explanation.
MAX_DEPTH = ${MAX_DEPTH}. После MAX_DEPTH заверши, указав limitations.`;

  let userPrompt = "";

  if (!convHistory.length && depth === 0) {
    userPrompt = `Это первый раунд диалога.

Исходное описание пользователя:
${text}

Оцени red flags и задай 4-6 уточняющих вопросов.
Первые 2-3 вопроса про возможную причину/триггер состояния.
Вопросы должны быть адаптивными к тексту пользователя.

Верни JSON:
{ "type": "questions", "questions": ["вопрос 1", "вопрос 2", "вопрос 3", "вопрос 4"] }`;
  } else {
    const enough = depth >= MIN_DEPTH;
    const maxed = depth >= MAX_DEPTH;

    let decisionRule = "";
    if (maxed) {
      decisionRule = "Ты достиг MAX_DEPTH. ОБЯЗАН завершить диалог и вернуть финальный отчет, указав limitations.";
    } else if (enough) {
      decisionRule = `Ты достиг MIN_DEPTH. Оцени, достаточно ли данных для предварительного заключения.
Если есть competing hypotheses или missing critical info — продолжи questioning.
Если данных достаточно — заверши и верни отчет.`;
    } else {
      decisionRule = `Ты еще не достиг MIN_DEPTH. Продолжай questioning. Верни только вопросы.`;
    }

    userPrompt = `Текущий раунд: ${depth + 1}.
${decisionRule}

История диалога:
${historyText}

${
  currentAnswersText
    ? `Ответы на предыдущие вопросы:\n${currentAnswersText}\n`
    : ""
}Исходное описание пользователя: ${text}

Оцени:
- что уже ясно
- что осталось неясным
- какие гипотезы конкурируют
- какие риски не проверены

Если нужно больше информации — верни JSON:
{ "type": "questions", "questions": ["вопрос 1", "вопрос 2", ...] }

Если данных достаточно для предварительного заключения — верни JSON:
{ "type": "final", "user_report": "отчет для пользователя\n\n1. Что сейчас видно\n2. Что могло запустить или усиливать состояние\n3. Что важно уточнить\n4. Возможные направления помощи\n5. Что можно сделать сегодня\n6. Когда нужна срочная помощь", "doctor_report": "структурированная карта для специалиста\n- Жалобы\n- Timeline\n- Сон\n- Функциональное снижение\n- Possible etiology / triggers\n- Risk level\n- Red flags\n- Reality testing\n- Differential directions\n- Что важно уточнить\n- Рекомендуемая срочность" }

ВАЖНО: Не завершай слишком рано. Если есть competing hypotheses или missing information — продолжай questioning.`;
  }

  try {
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
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: depth <= 2 ? 600 : 1500,
      }),
    });

    const data = await response.json();

    if (!response.ok || data.error) {
      if (depth === 0) {
        return res.status(200).json({ type: "questions", questions: fallbackQuestions });
      }
      return res.status(200).json({ type: "final", user_report: fallbackFinal, doctor_report: "" });
    }

    const raw = data.choices?.[0]?.message?.content?.trim();

    if (!raw) {
      if (depth === 0) {
        return res.status(200).json({ type: "questions", questions: fallbackQuestions });
      }
      return res.status(200).json({ type: "final", user_report: fallbackFinal, doctor_report: "" });
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      if (depth === 0) {
        return res.status(200).json({ type: "questions", questions: fallbackQuestions });
      }
      const cleaned = raw
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();
      try {
        parsed = JSON.parse(cleaned);
      } catch (e2) {
        return res.status(200).json({ type: "final", user_report: raw, doctor_report: "" });
      }
    }

    if (parsed.type === "questions" && Array.isArray(parsed.questions)) {
      return res.status(200).json({
        type: "questions",
        questions: parsed.questions.filter(Boolean).slice(0, 7),
      });
    }

    const userPart = parsed.user_report || "";
    const doctorPart = parsed.doctor_report || "";

    const report = userPart.includes("===USER_REPORT===")
      ? userPart
      : `===USER_REPORT===\n\n${userPart}\n\n===DOCTOR_REPORT===\n\n${doctorPart}`;

    return res.status(200).json({ type: "final", report });
  } catch (error) {
    if (depth === 0) {
      return res.status(200).json({ type: "questions", questions: fallbackQuestions });
    }
    return res.status(200).json({ type: "final", report: fallbackFinal });
  }
}
