# SEC-003 — устранение критического legacy bypass

Дата проверки: 2026-11-23  
Базовый commit: `2f05e9f282c51e50b15aac9c3197164eb3a21f6f`  
Рабочая ветка: `codex/sec-003-legacy-bypass`  
Статус: изменения и локальные тесты подготовлены; SQL в Production не выполнялся; merge/deploy не выполнялись.

## Итог

Критический обход подтверждён по исходникам базового commit и закрыт. В охваченных SEC-003 маршрутах `legacy_access` больше не является доказательством владения: предъявленный session token должен точно совпасть с сохранённым SHA-256 hash. Сессия с `legacy_access=true` и сохранившимся действительным credential продолжает работать; произвольный непустой токен больше не принимается.

Удаление, массовая миграция или изменение пользовательских данных не выполнялись. Механизмы ротации credential и rate limiting не изменялись.

## Подтверждённые дефекты базового commit

| ID | Риск | Статус | Доказательство в `2f05e9f…` | Последствие |
|---|---|---|---|---|
| SEC-003-01 | Critical | CONFIRMED | `lib/security/access-token.js:87-106`: после проверки только на непустое значение функция возвращала `true` при `legacy_access=true` без сравнения hash | Любая строка могла выступить access token для legacy-сессии |
| SEC-003-02 | Critical | CONFIRMED | `api/session.js:845-907`: `handleLoad()` выбирал отчёты и пропускал token-check при `legacy_access=true` | Старый `publicCode` мог раскрывать защищённые поля без доказательства владения |
| SEC-003-03 | High | CONFIRMED | `api/session.js:1431-1611` и `api/transcribe.js:39-62`: update/read/transcribe имели собственные legacy-ветки | Обход сохранялся бы даже при неполном исправлении центральной функции |
| SEC-003-04 | High | CONFIRMED | `api/session.js:1940-1988`: regeneration сначала принимал общий token-check, затем выбирал owner-таблицу по запрошенному `module` | Для legacy-сессии произвольный токен мог дойти до ротации; module и canonical owner не были связаны с аутентифицированной записью |
| SEC-003-05 | High | CONFIRMED | `api/session.js:1456-1462`: при одновременной передаче `session_id` и `public_code` проверялась одна запись, а обновляться могла другая | Возможна авторизация одной сессией и изменение плана по чужому public code |
| SEC-003-06 | — | NOT VERIFIED | Число затронутых Production-записей неизвестно до ручного запуска агрегатного SQL | Нельзя оценить объём восстановления доступа без инвентаризации |

## Read-only инвентаризация

Подготовлен `scripts/sec-003-legacy-access-inventory.sql`. Скрипт:

- запускает только агрегатные `SELECT` внутри `BEGIN TRANSACTION READ ONLY` и завершает `ROLLBACK`;
- считает legacy-записи отдельно для `support`, `health` и отдельного fail-closed cohort `unknown`;
- считает записи и distinct owners, наличие `anonymous_owner_id`, структурно корректного token hash, metadata токена, active/revoked continuation credential и пересечения этих признаков;
- отдельно проверяет согласованность `sessions.anonymous_owner_id` и `body_clients.anonymous_owner_id`;
- отдельно считает Health-профили без canonical `sessions` row;
- не выбирает медицинские поля, идентификаторы записей, owner IDs, lookup codes, token hashes, raw tokens или continuation secrets.

Ограничение интерпретации: raw access token намеренно не хранится. Поэтому SQL не может доказать, что пользователь сохранил токен. `with_verifiable_token_hash` означает только наличие корректного 64-hex hash, с которым сервер сможет сравнить предъявленный токен. Аналогично active credential в базе не доказывает, что пользователь сохранил полный continuation-код.

SQL не запускался ни в Production, ни в другом удалённом окружении. Фактические counts имеют статус `NOT VERIFIED`.

## Выполненные минимальные исправления

1. `lib/security/access-token.js`
   - добавлен `resolveSessionAccess()`;
   - проверяется точный token hash независимо от `legacy_access`;
   - поддерживается обязательная привязка к `expectedModule`;
   - `validateSessionAccess()` сохранён как boolean wrapper для совместимости.

2. `api/session.js`
   - `handleLoad()` сначала выбирает только `session_id,module`, затем проверяет token и только после этого читает защищённые поля;
   - Support cabinet/report/follow-up/write-маршруты привязаны к `module=support`;
   - Health diary/cabinet маршруты привязаны к `module=body`;
   - прямые legacy bypass в support plan, conversation pairs и body daily logs удалены;
   - support-plan update всегда изменяет именно аутентифицированный `session_id`;
   - защищённый conversation route больше не создаёт отсутствующую сессию;
   - автоматическое присвоение нового Health owner во время чтения удалено: отсутствующий или конфликтующий owner отправляется в controlled recovery.

3. `lib/session/continuation-access.js`
   - regeneration разрешается только после проверки точной пары `session_id + access_token + module`;
   - Support owner берётся из аутентифицированной `sessions` row;
   - Health owner берётся из `body_clients` и отклоняется при конфликте с owner в `sessions`;
   - если Health session owner отсутствует, но точный токен действителен и существующий `body_clients` owner однозначен, этот owner используется без записи или автоматической миграции.

4. `api/analyze.js` и `api/transcribe.js`
   - все защищённые Health analysis routes требуют `expectedModule=body`;
   - транскрибация требует token hash match и точный модуль для Support и Health;
   - legacy flag остаётся только диагностической metadata и не даёт доступа.

5. Тесты и tooling
   - добавлен `scripts/test-sec-003-legacy-access.js`;
   - добавлена команда `npm run test:sec-003`;
   - SQL защищён source-contract тестами от DML и выборки медицинских полей.

## Регрессионная матрица

| Сценарий | Ожидаемый результат | Локальный результат |
|---|---|---|
| Legacy + произвольный непустой token | отказ | PASS |
| Legacy + точный ранее выданный token и корректный hash | доступ сохраняется | PASS |
| Legacy без token hash + произвольная строка | отказ | PASS |
| Старый Support publicCode без token | protected fields не выбираются/не возвращаются | PASS, source-contract |
| Действительный современный token | успех | PASS |
| Token другой сессии/owner | отказ | PASS |
| Support token как Health | отказ | PASS |
| Health token как Support | отказ | PASS |
| Regeneration с произвольным legacy token | отказ до ротации | PASS |
| Regeneration с подменой module | отказ до ротации | PASS |
| Health regeneration при конфликте canonical owners | отказ | PASS |
| Health legacy row без session owner, но с точным token и однозначным существующим body owner | успех без изменения данных | PASS |
| Support plan с несовпадающими `session_id` и `public_code` | изменяется только аутентифицированная запись | PASS, source-contract |
| Health diary и AI routes с Support credential | отказ по module | PASS |
| Локальные кабинеты, atomic credential-pair, голосовые и specialist scopes | без регрессии | PASS |
| Полный continuation exchange → token → Support/Health cabinet на подключённой Preview DB | должен пройти на синтетических fixtures | PENDING; обязательный pre-deploy gate |
| Ручная Production-инвентаризация | только агрегатные counts | NOT RUN |

## Выполненные проверки

Все команды завершились с кодом `0`:

- `npm run test:sec-003`
- `node scripts/test-health-diary-auth.js`
- `npm run test:analyze-session-access`
- `npm run test:session-access-pair` — 55 проверок
- `npm run test:usage-auth`
- `npm run test:usage-session-owner`
- `node scripts/test-live-owner.js`
- `npm run test:cabinet-defects`
- `npm run test:my-practice-patient-cabinet`
- `npm run test:voice-audio-mime` — 45 проверок
- `node scripts/test-support-voice-input.js` — 6 проверок
- `npm run test:specialist-access-policy`
- `npm run test:bound-review-session`
- `npm run build` — полный проектный gate и Vite build прошли; осталось существующее предупреждение о размере bundle chunk
- `node --check` для изменённых server-side JS и `git diff --check`

Ни один тест не обращался к Production. Connected Preview E2E не выполнялся.

## План безопасного восстановления доступа

### Cohort A: пользователь сохранил точный access token

Ничего мигрировать не нужно для продолжения доступа к маршрутам, которые используют общий session-token contract: сервер сравнивает токен с hash, а `legacy_access=true` не заменяет и не отменяет это доказательство. Если credential уже существует, пользователь может штатно ротировать его только для подтверждённого module и canonical owner. Если credential отсутствует, его bootstrap должен быть отдельной reviewed recovery-операцией; текущий rotation route намеренно не превращён в неявный create-flow.

### Cohort B: пользователь сохранил полный continuation-код

Использовать существующий exchange flow. После проверки lookup + secret сервер выдаёт новый access token для найденного canonical owner. Это действие инициировано пользователем и не является массовой или автоматической миграцией.

### Cohort C: raw token утрачен, но есть active credential

Предложить ввод полного continuation-кода. Public lookup code или старый короткий код сами по себе не являются доказательством владения.

### Cohort D: нет доступного possession proof

Не открывать старую запись по `publicCode`, session ID, знанию текста отчёта или произвольной строке. Данные сохраняются без изменений. Допустимы только два безопасных варианта:

1. controlled reissue после отдельной, документированной проверки уже существующей server-side связи с организацией/специалистом и независимого подтверждения пользователя; выдавать одноразовую ссылку или новый owner-bound credential, не передавать raw token оператору;
2. если надёжно подтвердить владение невозможно из-за анонимной модели сервиса — создать новую сессию, сохранить старую запись и не связывать профили автоматически.

Каждый controlled reissue должен быть отдельной операторской операцией с причиной, временем, actor и audit event; старые медицинские данные не копировать в тикет восстановления.

### Cohort E: отсутствующий или конфликтующий canonical owner

Не генерировать owner на чтении и не исправлять массово. Поместить запись в ручную очередь; сверить только server-side связи и техническую provenance. Любое изменение owner — отдельная reviewed migration с backup/PITR и журналом соответствий, не часть SEC-003.

## План внедрения

1. Провести peer review diff SEC-003; отдельно подтвердить, что в diff нет изменений rotation/rate limiting.
2. Уполномоченному оператору вручную выполнить inventory SQL read-only ролью; сохранить только агрегатные counts.
3. По counts подготовить инструкции поддержки для cohorts A–E и оценить необходимость отдельного controlled-reissue инструмента.
4. В Preview создать только синтетические fixtures для всех строк регрессионной матрицы и выполнить полный exchange/cabinet E2E, включая параллельные запросы с чужими и неверными токенами.
5. Подтвердить backup/PITR и мониторинг агрегированных 401/403/error-rate без логирования credential material.
6. После отдельного разрешения выполнить merge и сначала Preview deploy. Production deploy — только после Preview gate и sign-off.
7. При проблемах не возвращать legacy bypass. Безопасный аварийный вариант — временно закрыть затронутый protected route и использовать controlled recovery; затем выпустить forward fix.

## Границы текущей работы

- Production, Supabase и удалённые данные не изменялись.
- Миграции и SQL не выполнялись.
- Пользовательские данные не удалялись и не перепривязывались.
- Commit, push, PR, merge, publish и deploy не выполнялись.
- Исправления ротации credential и rate limiting намеренно не включены.
