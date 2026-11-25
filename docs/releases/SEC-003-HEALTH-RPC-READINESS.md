# SEC-003 — Health RPC Readiness

- Дата проверки: 25 ноября 2026 г.
- Режим: `READ-ONLY RPC AUDIT`
- Интеграционная ветка: `codex/sec-003-a3a5-integration`
- HEAD: `2f05e9f282c51e50b15aac9c3197164eb3a21f6f`

## Итог

**RPC MISSING — TARGETED MIGRATION REQUIRED**

Целевая Test-база установлена однозначно. В её `pg_catalog` отсутствует функция
`public.bootstrap_health_intake`; перегруженных вариантов также нет. Ожидаемые таблицы,
столбцы, уникальные ограничения и вспомогательная функция `ensure_usage_wallet` в Test
присутствуют и совместимы с подготовленным SQL. Для снятия блокировки нужна отдельная,
явно разрешённая точечная миграция
`supabase/migrations/20261123223548_sec_003_health_bootstrap.sql`, но в рамках этой проверки
она не выполнялась.

Ниже слова «подготовленная функция» и «ожидаемый контракт» относятся к локальному SQL,
а не к уже установленному объекту базы.

## 1. Целевой Supabase Test ref

Подтверждённая цель:

- Supabase ref: `eehyehlhiyztciaezaus`;
- имя проекта: `Tochka-Opori-Preview-Test`;
- состояние по management metadata: `ACTIVE_HEALTHY`;
- регион: `eu-west-1`;
- версия PostgreSQL, показанная проектом: `17.6.1.155`.

Подтверждение выполнено до первого обращения к каталогу базы:

| Источник | Подтверждение |
| --- | --- |
| `docs/database-architecture.md:7-16` | Vercel-проект `tochka-opori-test` предназначен для всех экспериментальных веток и E2E и связан с `Tochka-Opori-Preview-Test`. |
| `docs/my-practice-db-gate.md:3-5` | Preview A3 требует точные URL/ref `eehyehlhiyztciaezaus` и ключ именно этой Test-базы. |
| `lib/security/database-architecture.js:2-5` | В коде зафиксированы Test ref `eehyehlhiyztciaezaus` и отдельный live ref. |
| локальный `.vercel/project.json`, прочитан без изменения | Проект привязан к `tochka-opori-test` (`prj_BSzyfSJjjrCTI0RieWuVxR8qh3el`). |
| Supabase management metadata | Ref, имя и состояние проекта совпали с локальной архитектурой. |

Production ref `blwogrdezfhprdpdnxtn` не передавался ни в один SQL, schema или migration
запрос. Все обращения к базе были направлены только в `eehyehlhiyztciaezaus`.

## 2. Подтверждённый способ read-only проверки

Проверка состояла только из metadata-операций:

1. Выполнен предложенный в задании `SELECT` из `pg_catalog.pg_proc` и
   `pg_catalog.pg_namespace` для имени `public.bootstrap_health_intake`.
2. Через schema metadata подтверждены только определения необходимых таблиц и столбцов.
3. Дополнительными узкими `SELECT` из `pg_catalog` подтверждены:
   - обязательные типы/default-выражения столбцов;
   - уникальные constraints/indexes;
   - сигнатура, режим, `search_path`, ACL и определение `ensure_usage_wallet`;
   - наличие `public.usage_ledger`, вызываемой helper-функцией.
4. Через read-only список миграций проверено наличие точной версии/имени миграции.

Не выполнялись:

- вызов `bootstrap_health_intake`;
- чтение строк `sessions`, `body_clients`, intake, wallet или иных пользовательских таблиц;
- DML, DDL, `GRANT`, миграция, `db push/reset/up`;
- запросы к Auth Users, медицинским данным или секретам.

## 3. Результат поиска RPC

Первый разрешённый запрос вернул `0` строк.

Следовательно, в момент проверки в целевой Test-базе:

- `public.bootstrap_health_intake` отсутствует;
- фактической сигнатуры и возвращаемого типа нет;
- фактический security mode и `search_path` отсутствуют;
- фактических прав `EXECUTE` нет;
- перегруженных вариантов функции нет.

Read-only migration history содержит 49 записей; самая поздняя из возвращённых записей —
`20261121133131_a382_practice_service_modules`. В истории отсутствуют:

- `20261123223548_sec_003_health_bootstrap`;
- `20261123070309_r232_production_clinical_base_a3_a5`;
- `20261123114523_r233_fix_continuation_failed_attempt_rpcs`.

Отсутствие Health RPC согласуется с отсутствием её migration record. При текущем состоянии
`supabase.rpc("bootstrap_health_intake", ...)` завершится ошибкой. Код преобразует её в
`database_error`, а `api/analyze.js:773-775` возвращает HTTP 500 до выдачи access token или
continuation credential. Это безопасный отказ, но новый Health intake неработоспособен.

## 4. Сопоставление сигнатур

### 4.1 Имя и аргументы

Локальная миграция объявляет одну функцию
`public.bootstrap_health_intake` с 13 аргументами
(`supabase/migrations/20261123223548_sec_003_health_bootstrap.sql:8-22`).
`lib/session/health-bootstrap.js:55-69` вызывает то же имя и передаёт все 13 именованных
аргументов.

| № | SQL-аргумент | Тип | Default в SQL | Значение из JS |
| ---: | --- | --- | --- | --- |
| 1 | `p_session_id` | `text` | нет | новый `health_` + base64url ID |
| 2 | `p_owner_id` | `uuid` | нет | новый UUID |
| 3 | `p_access_token_hash` | `text` | нет | SHA-256 hash нового access token |
| 4 | `p_lookup_code` | `text` | нет | public part Health continuation code |
| 5 | `p_secret_hash` | `text` | нет | HMAC-SHA256 continuation secret |
| 6 | `p_answers` | `jsonb` | нет | копия intake без клиентского `session_id` |
| 7 | `p_bmi` | `numeric` | `NULL` | число либо `null` |
| 8 | `p_source` | `text` | `'self_signup'` | source либо `'self_signup'` |
| 9 | `p_specialist_id` | `text` | `NULL` | строка либо `null` |
| 10 | `p_specialist_name` | `text` | `NULL` | строка либо `null` |
| 11 | `p_display_name` | `text` | `NULL` | intake display name либо `null` |
| 12 | `p_goal` | `text` | `NULL` | intake goal либо `null` |
| 13 | `p_session_json` | `jsonb` | `'{}'::jsonb` | объект pilot metadata либо `{}` |

JS не зависит от SQL defaults: он передаёт каждый аргумент явно. Имена и типы значений
совпадают с подготовленной сигнатурой.

### 4.2 Возвращаемые поля

Подготовленная функция возвращает
`TABLE(session_id text, anonymous_owner_id uuid, intake_id uuid, wallet_id uuid,
access_token_hash text)` (`...health_bootstrap.sql:23-29`).

`lib/session/health-bootstrap.js:80-89` требует все эти поля и проверяет:

- точное совпадение `session_id`;
- точное совпадение нового canonical owner;
- наличие `intake_id` и `wallet_id`;
- точное совпадение token hash.

Raw access token и полный continuation credential возвращаются вызывающему коду только после
успешной проверки receipt (`lib/session/health-bootstrap.js:91-101`).

### 4.3 Идентификаторы и повторные попытки

- `generateHealthSessionId()` использует `crypto.randomBytes(16)` и base64url: это 128 бит
  криптографической случайности и ровно 22 символа после префикса `health_`
  (`lib/session/health-bootstrap.js:7-9`). SQL принимает только
  `^health_[A-Za-z0-9_-]{22}$` (`...health_bootstrap.sql:38-40`).
- Canonical owner создаётся через `crypto.randomUUID()`
  (`lib/session/health-bootstrap.js:32-35`).
- Access token использует 32 случайных байта, то есть 256 бит
  (`lib/security/access-token.js:4,20-22`).
- При `23505` весь комплект — session ID, owner, token и continuation material — создаётся
  заново. Число попыток ограничено пятью (`lib/session/health-bootstrap.js:5,40-77`).

## 5. Проверка прав и режима безопасности

Фактические ACL для `bootstrap_health_intake` проверить невозможно: функция отсутствует.
Подготовленная миграция задаёт требуемый контракт:

| Требование | SQL-доказательство | Оценка |
| --- | --- | --- |
| `SECURITY INVOKER` | строки 30-32 | корректно |
| пустой `search_path` | строка 32 | корректно; все объекты schema-qualified |
| нет доступа `PUBLIC`, `anon`, `authenticated` | строки 155-157 | корректно в источнике |
| `service_role` имеет `EXECUTE` | строки 159-161 | корректно в источнике |
| exact signature в ACL | 13 типов в строках 155-165 | совпадает с объявлением |

Supabase рекомендует для database functions `SECURITY INVOKER`, schema-qualified обращения при
пустом `search_path`, а также явный отзыв default `EXECUTE` у `PUBLIC` и нежелательных ролей:
<https://supabase.com/docs/guides/database/functions>.

Фактическая helper-функция в Test подтверждена отдельно:

- `public.ensure_usage_wallet(p_owner_type text, p_owner_id uuid, p_module text)`;
- `RETURNS usage_wallets`;
- `SECURITY INVOKER` (`prosecdef=false`);
- `search_path=""`;
- `service_role`: `EXECUTE=true`;
- `anon`, `authenticated`: `EXECUTE=false`.

При будущем применении Health migration её следует выполнить одной транзакцией. Это исключает
видимый промежуток между создаваемым PostgreSQL default `PUBLIC EXECUTE` и последующим
`REVOKE`. До допуска API-трафика требуется повторный exact catalog query.

## 6. Зависимости и конфликты миграций

### 6.1 Фактические prerequisites Test

| Объект | Нужный контракт | Результат metadata-проверки |
| --- | --- | --- |
| `public.sessions` | `session_id text`, `module text`, owner UUID, `public_code`, JSONB-поля, token hash/time, `legacy_access` | все столбцы и defaults совместимы; `id` генерируется через `gen_random_uuid()` |
| `public.body_clients` | session/owner, display/referral metadata, status/time | совместимо; `id` имеет UUID default |
| `public.body_intake_forms` | `id`, session/module/version, answers, BMI, care/source/specialist fields | совместимо; `id` имеет UUID default |
| `public.continuation_credentials` | module, owner type/id, lookup/hash/version/time | совместимо; `id`, version и timestamp имеют defaults |
| `public.usage_wallets` | canonical owner/module и возвращаемый wallet UUID | совместимо; `id` имеет UUID default |
| `public.ensure_usage_wallet(text,uuid,text)` | создать/вернуть canonical wallet | функция существует, exact signature и ACL подтверждены |
| `public.usage_ledger` | запись initial credit из helper-функции | relation существует; фактическое определение helper ссылается на неё |

Подтверждены collision prerequisites:

- unique index `idx_sessions_session_id_unique` на `sessions(session_id)`;
- `sessions_public_code_key` на `sessions(public_code)`;
- `body_clients_session_id_key` на `body_clients(session_id)`;
- `continuation_credentials_lookup_code_key`;
- `continuation_credentials_owner_type_owner_id_key`;
- module/owner check для `support/anonymous_case` и `body/anonymous_profile`;
- `uq_wallet_owner_module` на wallet `(owner_type, owner_id, module)`.

Фактический `ensure_usage_wallet` дополнительно использует transaction advisory lock,
`SELECT ... FOR UPDATE`, unique wallet constraint и создаёт initial ledger entry. Он совпадает
с ожидаемым источником `supabase/migrations/20261107150430_partner_twenty_percent.sql:124-197`.

### 6.2 Атомарность

Подготовленная функция одной server-side функцией последовательно создаёт:

1. canonical `sessions` row;
2. `body_clients` row;
3. intake row;
4. continuation credential;
5. wallet и initial ledger entry через `ensure_usage_wallet`.

Внешняя функция не содержит `EXCEPTION` handler, не подавляет ошибки и не делает UPDATE/UPSERT
существующих patient rows. Любая ошибка прерывает statement и откатывает все её изменения.
Уникальный конфликт намеренно выходит как `23505`, после чего сервер создаёт весь набор заново.
Поэтому совпавший `session_id` не приводит к чтению, обновлению или наследованию чужого owner.

### 6.3 A3/A5 migration topology

В Test уже присутствует индивидуальная A3/A5-линия (profile links, booking credit payments,
A5 encounters, A3.8 links/grants/identity, availability и service modules). Несколько записей
имеют фактические migration timestamps, отличающиеся от имён файлов в репозитории. При этом
one-shot consolidated migration `20261123070309_r232_production_clinical_base_a3_a5` в истории
отсутствует.

Health migration не создаёт и не изменяет A3/A5-таблицы. Она содержит только
`CREATE OR REPLACE FUNCTION`, exact `REVOKE/GRANT` и `COMMENT`; при её применении медицинские
записи не читаются и не изменяются. Поэтому возможна отдельная точечная миграция без replay
baseline, consolidated A3/A5 или каталога миграций.

Из-за установленного drift запрещено применять весь каталог или consolidated migration для
доставки одной RPC. Allowlist должен содержать только
`20261123223548_sec_003_health_bootstrap.sql`.

## 7. Риски безопасности

| Риск | Уровень | Состояние / контроль |
| --- | --- | --- |
| RPC отсутствует: новый Health intake всегда завершается 500 | HIGH, availability blocker | подтверждено; fail-closed, credentials и данные не выдаются |
| Фактические ACL/режим Health RPC неизвестны до её создания | MEDIUM, release gate | post-migration catalog inspection обязательна |
| Нетранзакционное ручное выполнение могло бы кратко оставить default `PUBLIC EXECUTE` | MEDIUM | использовать только одобренную транзакционную migration procedure; проверять ACL до трафика |
| История Test расходится с локальными timestamp/consolidated path | MEDIUM, operational | применять только точечный файл после повторного preflight, не replay всего каталога |
| Connected concurrency/rollback на фактической Test ещё не выполнен | MEDIUM, verification | после миграции провести synthetic E2E с независимыми соединениями |
| Частичная регистрация при SQL/unique/helper error | LOW после миграции | одна функция, без подавления исключений; statement rollback; подтверждено локальным PostgreSQL contract test |
| Захват чужого Health owner через collision | LOW после миграции | только INSERT, уникальности, fresh owner/ID на retry; существующие строки не обновляются |

Локально выполнен `npm --silent run test:sec-003-fix2`: **PASS**. Проверка покрыла 128-битный
ID, forced collision, конкурентный старт с barrier, неизменность существующих записей и
PostgreSQL transaction contract. Это подтверждает источник, но не заменяет Connected Test
после установки RPC.

## 8. Действия для снятия блокировки

Нужен отдельный этап с явным разрешением на изменение только Test:

1. Подтвердить актуальный backup/restore point Test и процедуру восстановления.
2. Повторно проверить runtime gate: exact ref `eehyehlhiyztciaezaus`, аттестованный Test key,
   Preview/test purpose; Production ref должен оставаться запрещён.
3. Повторить read-only preflight функции, prerequisites, constraints и migration history,
   чтобы исключить drift после этого отчёта.
4. Зафиксировать checksum/allowlist единственного файла
   `20261123223548_sec_003_health_bootstrap.sql`.
5. Отдельно разрешённым migration runner применить ровно этот файл к Test одной транзакцией.
   Не выполнять baseline, consolidated A3/A5, R2.3.3 или иные миграции.
6. До любого application smoke повторить исходный catalog query и подтвердить:
   - ровно один overload;
   - exact 13-argument signature и return table;
   - `SECURITY INVOKER`;
   - `search_path=""`;
   - `service_role=true`, `PUBLIC/anon/authenticated=false`.
7. Выполнить только синтетический Connected Test:
   - нормальный Health bootstrap;
   - forced session/lookup collision без изменения существующей строки;
   - два параллельных bootstrap через независимые PostgreSQL-соединения;
   - принудительная ошибка helper/insert с проверкой отсутствия всех частичных rows;
   - успешное receipt/token/continuation продолжение.
8. При любом несовпадении ACL, receipt или rollback отменить только Test rollout и не
   продолжать Preview deployment.

В этом аудите ни один из этих write-шагов не выполнялся.

## 9. Рекомендация о следующем этапе

Следующий этап — отдельный **Test-only targeted migration gate**, а не commit, push или deploy
текущей интеграции. Сначала применить и каталожно аттестовать единственную Health RPC migration
в разрешённой Test-базе, затем выполнить Connected synthetic collision/rollback E2E. Только
после успешной runtime-проверки можно снять блокер интеграции SEC-003/A3/A5 и вернуться к
release-gate.

Текущий вердикт остаётся:

**RPC MISSING — TARGETED MIGRATION REQUIRED**

Коммит, push, deployment и миграции не выполнялись. Production и пользовательские данные не
использовались.
