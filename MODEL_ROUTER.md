# Model Router — Архитектура управления LLM

## Общая архитектура

```
api/*.js
  └→ lib/modelRouter.js  (единый роутер)
        ├→ lib/config/models.js  (конфигурация задач и моделей)
        └→ lib/providers/index.js  (реестр провайдеров)
              └→ lib/providers/openai.js  (адаптер OpenAI)
              └→ lib/providers/deepseek.js  (будет добавлен)
              └→ lib/providers/yandex.js    (будет добавлен)
              └→ lib/providers/gigachat.js  (будет добавлен)
```

**Принцип:** ни один API-хендлер не вызывает LLM напрямую. Все обращения проходят через `modelRouter.runTask(taskType, payload)`.

## Типы задач (TASK_TYPES)

| Задача | Логическая модель | Назначение |
|--------|-------------------|------------|
| `patient_dialog` | terra | Основной триаж: вопросы и финальные отчёты |
| `doctor_report` | sol | Отчёт для врача/специалиста |
| `user_report` | sol | Отчёт для пациента |
| `quality_review` | sol | Анализ качества (экспертная панель) |
| `expert_review` | sol | Экспертная обратная связь |
| `prompt_repair` | luna | Исправление отчётов после quality check |
| `training_analysis` | sol | Анализ обучающих данных |
| `summary` | sol | Суммаризация |
| `transcription` | terra | Распознавание речи (аудио → текст) |
| `translation` | sol | Перевод |
| `voice_analysis` | terra | Анализ голосовых характеристик |
| `body_intake` | terra | Анализ анкеты здоровья/тела |

## Логические модели

| Модель | По умолчанию | Назначение |
|--------|-------------|------------|
| `terra` | `gpt-5.5` | Основная: диалог с пациентом, intake |
| `sol` | `gpt-5.5` | Аналитическая: отчёты, quality review |
| `luna` | `gpt-4.1-mini` | Лёгкая: repair, вспомогательные задачи |

## Провайдеры

Каждый провайдер реализует адаптер в `lib/providers/<name>.js` с интерфейсом:

```js
export const name = "openai";

export function resolveModelId(logicalModel)
  // Принимает terra|sol|luna или конкретную строку
  // Возвращает идентификатор модели у провайдера

export async function runCompletion({ systemPrompt, userPrompt, model, reasoningEffort })
  // Основной метод: отправляет запрос LLM, возвращает { raw, parsed }

export function isProviderError(err)
  // Классифицирует ошибку: true = можно повторить с fallback-моделью

export async function transcribeAudio(audioBuffer, contentType)  // опционально
export async function analyzeVoice(audioBuffer, audioFormat)      // опционально
```

### Поддерживаемые провайдеры

| Провайдер | Адаптер | Статус |
|-----------|---------|--------|
| OpenAI | `lib/providers/openai.js` | ✅ Работает |
| DeepSeek | — | 🚧 Запланирован |
| Yandex GPT | — | 🚧 Запланирован |
| GigaChat | — | 🚧 Запланирован |
| Claude | — | 🚧 Запланирован |
| Gemini | — | 🚧 Запланирован |

## Конфигурация

### Переменные окружения

```env
# Базовые
OPENAI_API_KEY=sk-...
AI_PROVIDER=openai

# Модели для каждого типа задач (переопределяют TASK_MODEL_MAP)
AI_MODEL_TRIAGE=gpt-5.5
AI_MODEL_REPORT=gpt-5.5
AI_MODEL_QUALITY_REVIEW=gpt-5.5
AI_MODEL_FALLBACK=gpt-4.1-mini
AI_MODEL_TRANSCRIBE=gpt-4o-mini-transcribe
OPENAI_VOICE_ANALYSIS_MODEL=gpt-audio-1.5

# Параметры
AI_USE_RESPONSES_API=true
AI_REASONING_EFFORT=medium
AI_QUALITY_REASONING_EFFORT=medium
```

### Назначение env-переменных в TASK_MODEL_MAP

```
PATIENT_DIALOG  → AI_MODEL_TRIAGE      (gpt-5.5)
PROMPT_REPAIR   → AI_MODEL_FALLBACK    (gpt-4.1-mini)
BODY_INTAKE     → AI_MODEL_TRIAGE      (gpt-5.5)
QUALITY_REVIEW  → AI_MODEL_QUALITY_REVIEW (gpt-5.5)
TRANSCRIPTION   → AI_MODEL_TRANSCRIBE  (gpt-4o-mini-transcribe)
VOICE_ANALYSIS  → OPENAI_VOICE_ANALYSIS_MODEL (gpt-audio-1.5)
```

## Подключение нового провайдера

1. Создать `lib/providers/<name>.js` с экспортами интерфейса
2. Зарегистрировать в `lib/providers/index.js`
3. Добавить маппинг моделей в `lib/config/models.js → PROVIDER_MODEL_MAP`
4. Установить `AI_PROVIDER=<name>` в окружение

## Пример: переключение на DeepSeek

```env
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=sk-...
```

Код не меняется — `modelRouter.runTask()` сам выберет адаптер провайдера.

## Router Policy (логика переключения)

Текущая политика (`TASK_MODEL_MAP` в `lib/config/models.js`):
- Для каждой задачи указана primary model и fallback
- При ошибке primary вызывается fallback
- При переключении провайдера все задачи используют маппинг нового провайдера

## Логирование

Каждый вызов `runTask()` возвращает:

```json
{
  "raw": "...",
  "parsed": {...},
  "model_used": "gpt-5.5",
  "provider": "openai",
  "task_type": "patient_dialog",
  "router_version": "1.0.0",
  "request_duration": 2847,
  "fallback_used": false
}
```

Эти поля также добавляются в response API для сохранения в сессию.

## Сравнение моделей (Roadmap)

Архитектура позволяет прогнать одну сессию через несколько моделей:

```js
const models = ["openai:terra", "deepseek:terra", "yandex:terra"];
const results = await Promise.all(models.map(m => runTask(task, { ...payload, providerOverride: m })));
```

Каждый результат сохраняется отдельно для последующего анализа.

## План перехода на GPT-5.6 (Terra/Sol/Luna)

1. Обновить `PROVIDER_MODEL_MAP[PROVIDERS.OPENAI]`:
   ```
   terra → gpt-5.6-preview
   sol → gpt-5.6-thinking
   luna → gpt-5.6-mini
   ```
2. Проверить регрессию тестовых сценариев
3. Переключить в production через env-переменные (без изменения кода)

## План подключения DeepSeek, Yandex, GigaChat

1. Создать адаптер провайдера (`lib/providers/deepseek.js`)
2. В `runCompletion()` использовать API провайдера с тем же интерфейсом
3. Добавить API-ключ в окружение
4. Переключить `AI_PROVIDER` и протестировать
5. При необходимости — точечно переопределить модели для конкретных задач

## Backward Compatibility

- `lib/aiClient.js` сохранён как тонкая обёртка → `modelRouter.runTask()`.
- Все существующие вызовы `runTextAnalysis()` работают без изменений.
- Новый код использует `runTask()` напрямую с указанием task_type.
- Все env-переменные сохранены: `AI_MODEL_TRIAGE`, `AI_MODEL_FALLBACK` и т.д.
