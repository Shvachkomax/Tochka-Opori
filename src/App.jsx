import React, { useState } from "react";
import { Mic, Keyboard, AlertTriangle, Brain } from "lucide-react";

export default function App() {
  const [mode, setMode] = useState("text");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [aiResult, setAiResult] = useState(null);
  const [error, setError] = useState("");

  const analyze = async () => {
    if (text.trim().length < 20) {
      setError("Напишите чуть подробнее — хотя бы 2–3 предложения.");
      return;
    }

    setLoading(true);
    setError("");
    setAiResult(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Ошибка анализа");
      }

      const parsed =
        typeof data.result === "string" ? JSON.parse(data.result) : data.result;

      setAiResult(parsed);
    } catch (e) {
      setError("Не удалось выполнить анализ. Проверьте Vercel logs и OPENAI_API_KEY.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050817] text-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-8">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-3xl bg-white/10">
            <Brain className="h-6 w-6" />
          </div>
          <div>
            <div className="text-2xl font-bold">Точка опоры</div>
            <div className="text-sm text-slate-400">
              анонимный скрининг состояния
            </div>
          </div>
        </div>

        <a
          href="#crisis"
          className="rounded-3xl bg-red-600 px-6 py-4 font-semibold hover:bg-red-500"
        >
          <AlertTriangle className="mr-2 inline h-5 w-5" />
          Мне срочно нужна помощь
        </a>
      </header>

      <main className="mx-auto grid max-w-6xl gap-12 px-6 pb-20 pt-14 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
        <section>
          <div className="mb-8 inline-flex rounded-full border border-white/10 bg-white/5 px-5 py-3 text-base text-slate-300">
            Без имени. Без осуждения. Первый шаг — за 5–10 минут.
          </div>

          <h1 className="max-w-3xl text-5xl font-black leading-tight tracking-tight md:text-7xl">
            Расскажите, что с вами происходит — голосом или текстом.
          </h1>

          <p className="mt-7 max-w-2xl text-xl leading-9 text-slate-300">
            Сервис поможет мягко разобрать состояние, определить возможный
            спектр проблемы и предложить понятный план действий.
          </p>

          <div className="mt-9 flex flex-col gap-4 sm:flex-row">
            <button
              onClick={() => setMode("voice")}
              className="rounded-3xl bg-white px-7 py-4 font-bold text-slate-950 hover:bg-slate-200"
            >
              <Mic className="mr-2 inline h-5 w-5" />
              Рассказать голосом
            </button>

            <button
              onClick={() => setMode("text")}
              className="rounded-3xl border border-white/20 bg-white/5 px-7 py-4 font-bold text-white hover:bg-white/10"
            >
              <Keyboard className="mr-2 inline h-5 w-5" />
              Написать текстом
            </button>
          </div>

          <p className="mt-6 max-w-xl text-sm text-slate-500">
            Сервис не ставит диагноз. Это первичный скрининг и маршрутизация.
            Решение о диагнозе и лечении принимает врач.
          </p>
        </section>

        <section className="rounded-[2rem] border border-white/10 bg-white/10 p-6 shadow-2xl">
          <div className="mb-5">
            <div className="text-sm text-slate-400">Первичный вход</div>
            <div className="text-2xl font-bold">Анонимный разговор</div>
          </div>

          <div className="rounded-[2rem] bg-slate-950/70 p-6">
            {mode === "voice" ? (
              <div className="flex min-h-72 flex-col items-center justify-center text-center">
                <div className="mb-6 flex h-28 w-28 items-center justify-center rounded-full bg-red-500/20">
                  <Mic className="h-12 w-12 text-red-200" />
                </div>
                <div className="text-2xl font-bold">Голосовой режим</div>
                <p className="mt-4 max-w-sm text-slate-400">
                  Запись голоса подключим следующим этапом. Сейчас работает
                  текстовый AI-скрининг.
                </p>
              </div>
            ) : (
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="h-72 w-full resize-none rounded-3xl border border-white/10 bg-transparent p-5 text-base outline-none placeholder:text-slate-500"
                placeholder="Например: последние месяцы я плохо сплю, тревожусь, не могу собраться, часто думаю о потере..."
              />
            )}

            <button
              onClick={analyze}
              disabled={loading}
              className="mt-5 w-full rounded-3xl bg-white px-5 py-4 font-bold text-slate-950 hover:bg-slate-200 disabled:opacity-60"
            >
              {loading ? "Анализируем..." : "Начать анонимный разбор состояния"}
            </button>

            {error && (
              <div className="mt-4 rounded-2xl bg-red-500/15 p-4 text-sm text-red-100">
                {error}
              </div>
            )}
          </div>

          {aiResult && (
            <div className="mt-6 rounded-[2rem] border border-white/10 bg-white/5 p-6">
              <div className="mb-4 text-xl font-bold">Предварительный отчет</div>

              <div className="space-y-5 text-slate-200">
                <div>
                  <div className="text-sm text-slate-400">Краткое резюме</div>
                  <div className="mt-1">{aiResult.summary}</div>
                </div>

                <div>
                  <div className="text-sm text-slate-400">Возможные спектры</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {aiResult.clusters?.map((c) => (
                      <span
                        className="rounded-full bg-white/10 px-3 py-1 text-sm"
                        key={c}
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-sm text-slate-400">Уровень риска</div>
                  <div className="mt-1 font-bold">{aiResult.risk}</div>
                </div>

                <div>
                  <div className="text-sm text-slate-400">
                    Уточняющие вопросы
                  </div>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {aiResult.questions?.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                </div>

                <div>
                  <div className="text-sm text-slate-400">Рекомендация</div>
                  <div className="mt-1">{aiResult.recommendation}</div>
                </div>
              </div>
            </div>
          )}
        </section>
      </main>

      <section id="crisis" className="mx-auto max-w-6xl px-6 py-12">
        <div className="rounded-[2rem] border border-red-500/20 bg-red-500/10 p-8">
          <h2 className="text-3xl font-bold">
            Если вам очень плохо — не проходите опросник.
          </h2>
          <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-200">
            При угрозе жизни или безопасности нужно обращаться в экстренные
            службы: <b>112</b> или <b>103</b>.
          </p>
        </div>
      </section>
    </div>
  );
}
