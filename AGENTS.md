# AGENTS.md - Tochka-Opori

## Назначение проекта

«Точка Опоры» - анонимный русскоязычный сервис предварительного психологического и психиатрического триажа. Сервис помогает собрать первичное описание состояния, задать уточняющие вопросы, выявить сигналы риска и подготовить отчеты для пользователя и специалиста.

Это не постановка диагноза, не лечение, не телемедицина и не замена врача.

## Структура репозитория

- `src/App.jsx` - основной React-интерфейс: текстовый и голосовой режимы, отчеты, срочная помощь, экспертный режим, админка.
- `src/main.jsx`, `src/style.css` - вход приложения и базовые стили.
- `api/` - serverless API для Vercel и локального API-сервера.
- `api/analyze.js` - AI-триаж, вопросы и отчеты.
- `api/transcribe.js` - расшифровка голосовых записей.
- `api/session.js`, `api/reviews.js`, `api/crisis.js`, `api/experts.js`, `api/admin.js` - сессии, отзывы, срочные обращения, специалисты и админка.
- `lib/` - OpenAI/Supabase-клиенты, маскирование данных, генерация кодов.
- `prompts/` - проектные промпты и правила стиля.
- `support-practices/` и `public/support-practices/` - тексты поддерживающих практик.
- `scripts/` - SQL-скрипты для Supabase.
- `data/` - локальные тестовые данные разработки; не хранить реальные пользовательские данные.

## Установка и запуск

```bash
npm install
npm run dev:all
```

Отдельный запуск:

```bash
npm run dev:api
npm run dev
```

## Сборка и тестирование

```bash
npm run build
npm run preview
```

Отдельных `test`, `lint` или `typecheck` скриптов сейчас нет. Если добавляете проверки, держите их короткими, воспроизводимыми и документируйте команду в `package.json`.

## Ветки и commit

- Работать маленькими, проверяемыми изменениями.
- Перед изменениями смотреть `git status`.
- Не смешивать функциональные изменения, правки промптов, миграции и документацию в одном commit без необходимости.
- Commit делать только по явной просьбе пользователя.
- Перед commit обязательно проверить `git diff` и убедиться, что нет секретов, `.env`, пользовательских данных и случайных файлов.
- `git push` запрещен без прямого указания пользователя.

## Клинические и речевые ограничения

- Весь интерфейс и все отчеты должны оставаться на русском языке.
- Не формулировать окончательные диагнозы.
- Не писать «у вас ПТСР», «у вас БАР», «у вас шизофрения», «это подтверждает СДВГ».
- Не назначать лекарства, дозировки, схемы лечения, БАДы или растительные средства.
- Не ослаблять проверку суицидального риска, психоза и мании.
- Использовать язык сигналов: «признаки», «маркеры», «красные флаги», «важно уточнить», «стоит обсудить со специалистом».
- Для пациента писать живо, ясно и бережно, без канцелярита и медицинского жаргона.
- Для специалиста допустим профессиональный язык, но без окончательных диагнозов и назначений.

## Срочная помощь

- Маршрут и окно срочной помощи нельзя удалять, скрывать или упрощать без отдельного согласованного плана.
- При риске вреда себе или другому человеку основной посыл: звонить `112` или `103` и не оставаться одному.
- Сервис не должен обещать обратный звонок, экстренное реагирование или медицинскую помощь.
- Любые изменения логики кризисного риска требуют отдельного плана и ручной проверки.

## Данные и секреты

- Не коммитить `.env`, `.env.local`, API-ключи, Supabase service role key, Vercel metadata и реальные пользовательские данные.
- `.env.example` должен содержать только имена переменных без значений.
- Локальные тестовые сессии допустимы только для разработки и не должны содержать реальные персональные данные.
- Перед commit проверять `data/`, `.vercel/`, `.env*`, экспортированные JSON/JSONL/CSV и скачанные отчеты.
- При работе с пользовательским текстом сохранять privacy-safe подход и маскирование контактов.

## Текущий статус (Anonymous Continuation Credential Pass)

### Что сделано
- **Миграция 027** (`scripts/027-continuation-secrets.sql`): новая таблица `continuation_credentials` с разделением `lookup_code` (публичный) и `secret_hash` (HMAC-SHA256 с серверным перцем `CONTINUATION_SECRET_PEPPER`); unique `(owner_type, owner_id)`; индексы по `lookup_code` и владельцу; RLS включена.
- **`lib/session/continuation-credential.js`**: генерация, парсинг, нормализация, форматирование и константное сравнение `secret`; поддержка `ТОЧКА-XXXX-XXXX-XXXX-XXXX-XXXX` (support) и `HEALTH-XXXX-XXX-XXXX-XXXX-XXXX` (body); распознавание устаревших коротких кодов.
- **`lib/session/continuation-store.js`**: shared `getOrCreateContinuationCredential` и `rotateContinuationCredential` для `api/session.js` и `api/analyze.js`.
- **`api/session.js`**: `handleSave` создаёт credential для canonical owner (`anonymous_case`) и возвращает `continuation_code` один раз; `exchangeContinuationCredential` — разбор комбинированного кода, rate-limit 5 попыток/15 мин на IP+lookup, блокировка после неудач, единое сообщение об ошибке, выдача нового `access_token` и кабинета; `regenerateContinuationCredential` — ротация кода из кабинета; `anonymous_owner_id` не возвращается и не логируется.
- **`api/analyze.js`**: `handleBodyIntakeAnalysis` сохраняет `anonymous_owner_id` в `body_clients`, создаёт `anonymous_profile` credential и возвращает `continuation_code` + `access_token` на первичной анкете.
- **`src/App.jsx`**: единый UI «Код продолжения» на финальном экране support; один input в модалке возврата; кабинет support с кнопкой «Создать новый код продолжения»; Health-анкета показывает и копирует полный continuation-код; единый стейт `continuationCode`, `continuationCodeInput`, `continuationCodeError`, `regeneratedCode`.
- **`src/lib/sessionAccess.js`**: сохранение access_token и session_id для support и body; `withAccessToken` подкладывает токен в API-запросы.
- **local-api-server.js**: `/api/usage` роут для локального dev.
- **Сборка**: `npm run build` проходит; `node --check` для ключевых файлов проходит.
- **Миграция 027 применена** в Supabase.
- **CONTINUATION_SECRET_PEPPER** добавлен в Vercel Preview и Production (одинаковое значение) и в локальный `.env.local`.
- **Post-migration validation**: таблицы, constraints, RPC-функции проверены; service role может создавать/читать credentials.
- **E2E тесты**: Support save → exchange → regenerate → rotation; Health credential exchange; rate-limit и indistinguishability existing/non-existing lookup.
- **Security scripts**: `scripts/test-continuation-rate-limit.js`, `scripts/validate-continuation-migration.js`, `scripts/e2e-continuation.js`.

### Что не сделано
- Body-кабинет для пользователя: есть exchange endpoint, но UI кабинета здоровья не реализован (дневник привязан к session_id из localStorage).

### Следующий шаг
1. Запросить подтверждение для деплоя Preview, затем Production.

