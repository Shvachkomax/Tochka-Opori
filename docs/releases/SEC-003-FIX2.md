# SEC-003-FIX2 — безопасный Health bootstrap и восстановление токена

Дата локальной проверки: 2026-11-24
Ветка: `codex/sec-003-legacy-bypass`
Базовый commit: `2f05e9f282c51e50b15aac9c3197164eb3a21f6f`
Вердикт: **READY FOR REVIEW**

## Границы работы

- Production, Preview и удалённые Supabase-проекты не изменялись.
- Миграция подготовлена отдельным файлом, но не применялась.
- Commit, push, merge и deploy не выполнялись.
- Пользовательские данные не удалялись и не читались.
- `docs/releases/qwen-r234b-preaudit.md` не изменялся.
- Общая многотокенная модель и гонка двух законных token rotations остаются за рамками FIX2/SEC-004.

Полный working tree относительно базового commit проверен: 13 отслеживаемых файлов изменены и 10 файлов не отслеживаются. `qwen-r234b-preaudit.md` уже находился в рабочем дереве и исключён из будущего SEC-003 commit; его начальный и финальный SHA-256 совпадают: `9fb431d8b6061ec0eb198d560239e35c80c8b79ae061bae183822fa45c6e5668`. Остальные 22 файла относятся к SEC-003, его тестам, SQL-инвентаризации и отчётам. `.env*`, `.vercel/` и `data/` в изменениях отсутствуют; скан изменённых и новых файлов не нашёл ключей, JWT, private keys или присвоенных secret values.

## Что исправлено

### SEC-003-RG2-01 — Health owner takeover при коллизии

Новый Health bootstrap больше не использует короткий `HEALTH-XXXX-XXX` как внутренний `session_id` и никогда не ищет существующего owner по сгенерированному идентификатору.

1. Внутренний `session_id` имеет формат `health_<base64url>` и создаётся из `crypto.randomBytes(16)`, то есть содержит 128 бит случайности.
2. Короткий `HEALTH-XXXX-XXX` сохранён только как публичный lookup-код continuation credential и как `sessions.public_code`; secret в `public_code` не записывается.
3. Owner создаётся новым `crypto.randomUUID()` для каждой попытки.
4. `sessions`, `body_clients`, `body_intake_forms`, `continuation_credentials` и скрытый `usage_wallet` создаются одной PostgreSQL RPC-транзакцией.
5. Уникальный конфликт не обрабатывается через update/upsert: PostgreSQL откатывает весь вызов, приложение создаёт полностью новый комплект случайных значений. Максимум — пять попыток.
6. После исчерпания попыток или любой другой ошибки возвращается отказ без access token и continuation code.
7. AI-результат обновляет только intake row, созданную RPC, по точным `intake_id + session_id`; повторного INSERT профиля или переопределения owner нет.

### SEC-003-RG2-02 — уничтожение данных fallback-upsert

Опасный fallback в continuation exchange полностью удалён.

- Для существующей `sessions` row token issuer сначала сверяет exact `session_id + module + anonymous_owner_id`.
- UPDATE меняет только `access_token_hash`, `access_token_generated_at` и `legacy_access`; те же module/owner повторены в predicates.
- При отсутствии canonical row допускается только Health recovery после exact-проверки существующего `body_clients(session_id, anonymous_owner_id)`.
- Создание missing Health row выполняется обычным INSERT. Unique conflict означает отказ; чужая строка не обновляется.
- Для новой строки в `public_code` передаётся только проверенный continuation lookup-код.
- `patient_text`, `conversation_history`, `json_data`, отчёты, назначения и owner никогда не входят в recovery UPDATE.
- Любая ошибка token issuance завершает exchange с `500`; недействительный token не возвращается.

## Изменённые файлы и строки FIX2

| Файл | Строки после FIX2 | Назначение |
|---|---:|---|
| `lib/session/health-bootstrap.js` | 5–104 | 128-bit ID, ограниченные retry, вызов атомарной RPC, проверка receipt |
| `lib/session/health-bootstrap.js` | 107–136 | Условное обновление единственной intake row после AI |
| `supabase/migrations/20261123223548_sec_003_health_bootstrap.sql` | 8–153 | Транзакционное создание session/profile/intake/credential/wallet |
| `supabase/migrations/20261123223548_sec_003_health_bootstrap.sql` | 155–165 | RPC доступна только `service_role`, `SECURITY INVOKER` |
| `api/analyze.js` | 744–778 | Новый Health intake использует только atomic bootstrap receipt |
| `api/analyze.js` | 895–925 | AI metadata обновляет существующую intake row; wallet не создаётся повторно |
| `lib/security/access-token.js` | 20–23 | 256-bit access-token material для транзакционного bootstrap |
| `lib/security/access-token.js` | 29–82 | Exact scope и conditional UPDATE существующей сессии |
| `lib/security/access-token.js` | 85–135 | Безопасное создание missing canonical Health session без upsert |
| `api/session.js` | 1860–1869 | Continuation exchange использует canonical issuer и fail-closed отказ |
| `api/session.js` | 1397–1400, 1428–1457 | Support callers передают canonical module/owner |
| `api/start-session.js` | 59–64 | Support bootstrap передаёт exact module/owner token issuer-у |
| `lib/security/module-availability.js` | 42–48 | Support-only gate распознаёт старый публичный `HEALTH-` и новый внутренний `health_` ID |
| `scripts/test-sec-003-fix2.js` | весь файл | Коллизии, параллельность, сохранность данных, SQL transaction и source contracts |
| `scripts/e2e-continuation.js` | 126–131 | Support fixture использует усиленный token issuer contract |
| `scripts/test-sec-003-legacy-access.js` | 683–690 | Обновлён source contract Support bootstrap |
| `scripts/test-analyze-session-access.js` | 48–50 | Регрессия распознавания нового Health ID в module gate |
| `package.json` | 28 | Воспроизводимая команда `npm run test:sec-003-fix2` |

## Гарантии изоляции Health owner

RPC начинает с INSERT в `sessions`, где `session_id` защищён уникальным индексом, затем вставляет `body_clients`. При совпадении любого session ID, public lookup, owner credential или wallet scope возникает исключение; весь SQL statement откатывается, поэтому intake, credential и wallet также не остаются.

Код приложения не содержит ветки «найти существующего Health owner и продолжить». Клиентский `intake.session_id` удаляется из сохраняемых answers и не участвует в выборе identity.

Успешный ответ возможен только если RPC вернула receipt с точными запрошенными session ID, owner ID, token hash, intake ID и wallet ID.

Все найденные проверки формата session ID просмотрены: общий валидатор допускает новый 29-символьный base64url ID, а Support-only module gate теперь явно распознаёт и `HEALTH-…`, и `health_…`. Старые Health ID остаются допустимыми.

## Гарантии сохранности медицинских данных

Token rotation существующей canonical row выполняет единственный UPDATE с тремя техническими полями. Негативные тесты сохраняют snapshot `patient_text`, `conversation_history`, `json_data`, `user_report` и `doctor_report` до запроса и сравнивают его после:

- неверного owner;
- неверного module;
- ошибки UPDATE;
- unique-конфликта во время INSERT missing Health row;
- коллизии Health bootstrap с существующим пациентом.

Во всех сценариях snapshot остаётся неизменным. В continuation exchange отсутствуют `upsert`, пустые medical payload и recovery mutation вне canonical issuer.

## Конкурентные тесты

`scripts/test-sec-003-fix2.js` запускает два `createHealthBootstrap()` одновременно через `Promise.all`. Оба вызова удерживаются на общем стартовом барьере перед записью одного искусственно совпавшего session ID:

- одна транзакция получает идентификатор;
- вторая получает unique conflict, генерирует новый session/owner/token/credential и повторяет попытку;
- итогом являются две независимые пары session/owner;
- ни одна запись не обновляет данные другой.

Отдельно миграция исполняется в локальном PGlite. Успешный вызов создаёт все пять сущностей; повторный вызов с конфликтующим session ID оставляет counts всех таблиц без изменений, подтверждая rollback всего statement.

Это реальная конкурентная JavaScript-проверка с барьером, а не последовательная смена mock-state. Многосоединительный тест против Connected Preview PostgreSQL остаётся обязательным перед deploy.

## Результаты тестов

| Проверка | Результат |
|---|---|
| `npm run test:sec-003-fix2` | PASS: entropy, collision, bounded retry, DB failure, barrier concurrency, Support/Health token issuance, PGlite transaction |
| `npm run test:sec-003` | PASS |
| `npm run test:analyze-session-access` | PASS |
| `npm run test:session-access-pair` | PASS, 55 checks |
| Usage auth и owner isolation | PASS |
| Health diary auth/mock/comprehensive | PASS |
| Cabinet, bound review, specialist access, expert identity | PASS |
| Patient↔specialist linking | PASS, 95 checks |
| My Practice patient cabinet и practice sync | PASS |
| Health Live и pilot isolation | PASS |
| Voice MIME / Support voice | PASS, 45 + 6 checks |
| Browser patient→specialist→patient workflow | PASS на локальном loopback |
| `node --check` изменённых server-side файлов | PASS |
| `npm run build` | PASS; только существующее предупреждение о размере chunk |
| `git diff --check` | PASS |
| Whitespace-проверка новых FIX2-файлов | PASS |
| Скан секретов и sensitive paths | PASS, совпадений нет |

Production/Preview E2E и SQL к удалённым БД не запускались.

## Остаточные риски и порядок внедрения

1. Код требует миграцию `20261123223548_sec_003_health_bootstrap.sql`. До её применения Health bootstrap безопасно завершится ошибкой RPC; приложение не должно выкатываться раньше миграции.
2. Перед deploy нужен Connected Preview E2E с синтетическими данными: параллельный Health bootstrap, Support/Health continuation exchange, missing legacy Health `sessions` row, кабинеты, дневник и связь со специалистом.
3. Параллельная выдача двух законных access tokens одному owner по-прежнему имеет single-token/last-writer semantics. Это отдельная SEC-004 и не ослаблялась.
4. Legacy Health row с конфликтующими `sessions.anonymous_owner_id` и `body_clients.anonymous_owner_id` продолжает fail closed и требует controlled recovery.
5. Миграция проверена локально, но не применена ни в Preview, ни в Production; Supabase schema smoke/advisors должны выполняться в отдельном разрешённом deployment gate.

## Итог

Оба дефекта SEC-003-RG2 устранены. Коллизия не может наследовать существующего owner, а continuation recovery не содержит пути, очищающего медицинские данные. Локальные security, concurrency, cabinet, Health, specialist и build gates пройдены.

**READY FOR REVIEW** — не READY FOR DEPLOY до применения миграции в изолированной Preview и Connected Preview E2E.
