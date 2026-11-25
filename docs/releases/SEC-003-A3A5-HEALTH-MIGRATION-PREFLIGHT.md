# SEC-003 + A3/A5 — Health Migration Preflight

- Дата проверки: 2026-11-25
- Режим: **READ-ONLY PREFLIGHT — MIGRATION NOT APPLIED**
- Worktree: `Точка опоры-sec-003-a3a5-integration`
- Ветка: `codex/sec-003-a3a5-integration`
- HEAD: `2f05e9f282c51e50b15aac9c3197164eb3a21f6f`
- Целевой Supabase Test: `eehyehlhiyztciaezaus` (`Tochka-Opori-Preview-Test`)
- Запрещённый Production: `blwogrdezfhprdpdnxtn`
- Итог: **READY FOR HEALTH MIGRATION APPLY**

Этот verdict относится только к отдельному контролируемому применению
`20261123223548_sec_003_health_bootstrap.sql` в Supabase Test после нового
разрешения владельца. Он не разрешает Production, commit, push, deploy,
`migration repair`, изменение Vercel env или запуск Connected Preview E2E.

## 1. Краткий итог

| Контроль | Результат |
| --- | --- |
| Git branch / HEAD | PASS — ожидаемые значения |
| Staging | PASS — пуст |
| Provenance manifest | PASS — manifest и пять artifacts сохранены с ожидаемыми SHA-256 |
| Supabase target | PASS — exact Test ref, Production не открывался и не опрашивался |
| Applied history | PASS — 49 local/remote versions совпадают |
| Pending history | PASS — только `20261123223548_sec_003_health_bootstrap.sql` |
| Migration SHA-256 | PASS — `f94f1701333fb384aa0fed67e157bdaae0eb91a618ae6b4299cbb569c05b756d` |
| CLI dry-run | PASS — предложен ровно один Health-файл, ничего не применено |
| RPC security/dependencies | PASS |
| Financial isolation | PASS — booking mutations остаются fail-closed |
| Recovery point | PASS — физический Test backup `2026-11-25 02:54:08 UTC`; PITR не включён |
| Локальные тесты / build | PASS |

## 2. Git и provenance

### 2.1 Состояние рабочей копии

Перед созданием этого отчёта:

- активна ветка `codex/sec-003-a3a5-integration`;
- `HEAD` равен `2f05e9f282c51e50b15aac9c3197164eb3a21f6f`;
- staged paths отсутствуют;
- status относительно `HEAD` содержит 22 modified, 11 deleted и 34 untracked
  paths;
- этот набор соответствует принятому controlled integration и последующей
  migration-stream normalization: SEC-003 runtime/source/tests, A3/A5 path
  corrections, канонические Test migrations, пять вынесенных artifacts и
  предыдущие release reports;
- новых необъяснимых исходников, SQL или данных не обнаружено;
- `docs/releases/qwen-r234b-preaudit.md` не изменён;
- основная рабочая копия `Точка опоры` не изменялась.

Локальный `supabase/.temp/project-ref`, созданный для target binding, и `dist/`
после build игнорируются Git. Commit, push, merge и staging не выполнялись.

### 2.2 Manifest и пять исключённых SQL

`supabase/migration-artifacts/MANIFEST.md` присутствует. Его SHA-256:

`cb0f440ddce53e0273d81222e9cd7b877fb98af12ebbcce471ea034d3bc52b39`

Manifest однозначно разделяет active Test stream, historical local artifact,
Production release artifacts и deferred product migration. Все пять SQL
сохранены без изменения:

| Класс | Artifact | SHA-256 |
| --- | --- | --- |
| Historical local | `20261117184606_a38_unify_patient_specialist_links.sql` | `90c2ea263d11c47b0d66d34c50c3ca1edb5cd15847685b3321826be89f8aa2d4` |
| Deferred product | `20261122125416_my_practice_payment_modes.sql` | `46adfcfc062cfe1cadec1d134df6cf8f9679b3947233121ee8feae8ec3d41019` |
| Production R2.3.4-A | `20261123070309_r232_production_clinical_base_a3_a5.sql` | `d15a95e83a084b131b2e2a62d880388a4255efe2698a6d53f9dd8960587ec436` |
| Production R2.3.4-A | `20261123070333_r232_production_payments_disabled_booking.sql` | `9b368f03d13bc7a7f7fa43827f7b67bdda9186ed7e71d1cf3e4f4b9ba87c0fef` |
| Production R2.3.4-A | `20261123114523_r233_fix_continuation_failed_attempt_rpcs.sql` | `f9b081e450fc8b94b8b67d196a6819263968ca2ce0fcaa1b85501ea4fd814498` |

Эти файлы отсутствуют в `supabase/migrations` и не попали в dry-run.

## 3. Supabase Test и migration history

### 3.1 Однозначный target

Две независимые read-only проверки подтвердили:

- connector project id/ref: `eehyehlhiyztciaezaus`;
- project name: `Tochka-Opori-Preview-Test`;
- status: `ACTIVE_HEALTHY`;
- region: `eu-west-1`;
- локальный linked ref: `eehyehlhiyztciaezaus`;
- ref не равен Production `blwogrdezfhprdpdnxtn`.

Перед каждой CLI-командой локальный guard завершал процесс, если ref не был
точно равен Test или совпадал с Production. Production connector, Dashboard и
database endpoint в этой проверке не использовались.

### 3.2 Applied и pending migrations

Read-only MCP inventory и `supabase migration list --linked` дали один результат:

- applied rows: **49**;
- первая version: `20260814000000`;
- последняя applied version: `20261121133131`;
- локальная и удалённая version/name history совпадает для всех 49 rows;
- ledger row `20261123223548`: **0**;
- remote overload `public.bootstrap_health_intake`: **0**;
- active local SQL count: **50** — те же 49 versions плюс Health.

Установленный CLI — `2.109.1`, поэтому использован его штатный linked syntax:

```bash
DO_NOT_TRACK=1 supabase migration list --linked --output json
DO_NOT_TRACK=1 supabase db push --dry-run --linked
```

Dry-run явно сообщил `migrations will not be pushed` и предложил только:

```text
20261123223548_sec_003_health_bootstrap.sql
```

Других migrations, `--include-all`, seed, repair или history mutation не было.
SQL не применялся.

## 4. Проверка Health migration

### 4.1 Целостность и install-time поведение

Файл:

`supabase/migrations/20261123223548_sec_003_health_bootstrap.sql`

SHA-256:

`f94f1701333fb384aa0fed67e157bdaae0eb91a618ae6b4299cbb569c05b756d`

Он совпадает с ранее утверждённым значением. На верхнем уровне файл содержит
только `CREATE OR REPLACE FUNCTION`, exact `REVOKE`, exact `GRANT` и `COMMENT`.
При применении migration нет `INSERT`, `UPDATE`, `DELETE`, backfill, trigger или
policy rewrite. Все runtime inserts находятся внутри тела RPC и выполняются
только при последующем явном вызове.

### 4.2 Function security и ACL

| Требование | Доказательство | Статус |
| --- | --- | --- |
| `SECURITY INVOKER` | migration, строка 31 | PASS |
| Пустой `search_path` | migration, строка 32 | PASS |
| Полная schema qualification | все таблицы/helper используют `public.` | PASS |
| Нет `PUBLIC` execute | exact revoke, строки 155–157 | PASS |
| Нет `anon` execute | тот же exact revoke | PASS |
| Нет `authenticated` execute | тот же exact revoke | PASS |
| Только `service_role` | exact grant, строки 159–161 | PASS |
| Нет `SECURITY DEFINER` | определение функции | PASS |

После будущего применения эти свойства должны быть повторно проверены по
`pg_proc` и effective privileges до первого runtime-вызова.

### 4.3 Совместимость зависимостей

В Test существуют все шесть зависимостей:

- `public.sessions`;
- `public.body_clients`;
- `public.body_intake_forms`;
- `public.continuation_credentials`;
- `public.usage_wallets`;
- `public.usage_ledger`.

Catalog comparison проверил **41 из 41** используемых columns и типов;
несовместимых или отсутствующих fields нет. `service_role` имеет необходимые
`SELECT`/`INSERT`/`UPDATE` table privileges.

Уникальность, на которой основана fail-closed обработка коллизий, существует:

- `idx_sessions_session_id_unique`;
- `body_clients_session_id_key`;
- `continuation_credentials_lookup_code_key`;
- `continuation_credentials_owner_type_owner_id_key`;
- `uq_wallet_owner_module` на `(owner_type, owner_id, module)`.

### 4.4 `ensure_usage_wallet`

Удалённая функция `public.ensure_usage_wallet(text,uuid,text)` подтверждена как:

- `SECURITY INVOKER`;
- `search_path=''`;
- `EXECUTE`: `service_role=true`, `PUBLIC=false`, `anon=false`,
  `authenticated=false`;
- return type `usage_wallets`;
- использует `pg_advisory_xact_lock`, `usage_wallets` и `usage_ledger`;
- не содержит ссылок на `practice_bookings`, payment mode или payment RPC.

Локальный источник использует transaction-scoped advisory lock, canonical
owner/module uniqueness и `ON CONFLICT ... DO NOTHING`. Health RPC вызывает эту
функцию на строке 144. Ошибка wallet/ledger не подавляется и откатывает весь
bootstrap.

Создаваемый wallet относится к учёту расхода сервиса. Это не booking payment,
не `test_credits` booking path и не зависимость от deferred payment-mode SQL.

### 4.5 Энтропия, owner isolation и атомарность

- `generateHealthSessionId()` использует
  `crypto.randomBytes(16).toString("base64url")`: ровно 128 бит исходной
  криптографической случайности (`lib/session/health-bootstrap.js:7-9`).
- Каждый attempt создаёт новый session ID, новый `crypto.randomUUID()` owner,
  новый 256-bit access token и новый continuation credential
  (`lib/session/health-bootstrap.js:32-50`).
- Количество повторов ограничено пятью; повтор разрешён только для `23505`,
  после чего выдаётся безопасный отказ (`lib/session/health-bootstrap.js:40-77`).
- RPC вставляет session, body client, intake, credential и wallet/ledger в одном
  database statement. Внутреннего `EXCEPTION` handler нет; любое исключение
  откатывает statement/transaction целиком.
- Новый session всегда имеет module `body`, переданный fresh owner и
  `legacy_access=false` (migration, строки 56–78).
- SQL не содержит `UPDATE`, `UPSERT` или lookup существующего patient owner.
  Поэтому коллизия не наследует owner и не изменяет существующую запись.
- Receipt проверяется на точные session ID, owner, intake/wallet IDs и token
  hash до выдачи raw credentials (`lib/session/health-bootstrap.js:80-101`).
- Ошибка RPC возвращает failure; успешный HTTP-ответ и credential не выдаются.

Следствие: применение migration не меняет пользовательские rows; будущий
runtime bootstrap либо создаёт полный согласованный набор, либо не создаёт
ничего. Legacy bypass и destructive fallback в этом пути отсутствуют.

## 5. Финансовая изоляция

1. `20261122125416_my_practice_payment_modes.sql` находится только в
   `supabase/migration-artifacts/deferred-product/`; dry-run его не предлагает.
2. `MY_PRACTICE_FINANCIAL_MODE` в проверенном локальном процессе не задан.
   В рамках preflight удалённые Vercel env не менялись.
3. Для Test/Preview отсутствие mode даёт `FINANCIAL_MODE_REQUIRED` и `mode=null`.
4. Reserve handler прекращает запрос до mutation RPC при `!financial.mode`
   (`lib/my-practice/booking-handler.js:575`). Cancel/confirm/complete также
   проверяют mode до mutations.
5. В текущей Test schema отсутствуют
   `request_practice_booking_without_payment` и
   `cancel_practice_booking_request`. При ошибочном преждевременном включении
   `payments_disabled` вызов завершится ошибкой, а не fallback.
6. В Test остаются исторический `reserve_practice_booking` и credit RPC, но
   application source не вызывает базовый `reserve_practice_booking` и не
   выполняет прямые INSERT/UPDATE/DELETE `practice_bookings`.
7. Выбор между credit и future unpaid RPC явный
   (`booking-handler.js:593-599,670-676`); fallback на `test_credits` отсутствует.

Итог: Health migration не активирует `payments_disabled`, не включает booking
payments и не меняет ограничения `practice_bookings`. Реализация unpaid request
и specialist confirmation остаётся отдельным продуктовым этапом.

## 6. Локальные проверки

| Команда / проверка | Результат |
| --- | --- |
| `npm run test:sec-003` | PASS — legacy bypass closed, module/owner binding |
| `npm run test:sec-003-fix2` | PASS — entropy, collision, real start-barrier concurrency, transaction contract |
| `npm run test:analyze-session-access` | PASS |
| `npm run test:preview-gate` | PASS — 51 checks, 0 DB clients on blocked paths |
| `npm run test:key-attestation` | PASS — 19 checks, mocked network |
| `npm run test:practice-financial-mode` | PASS |
| `npm run test:my-practice-booking` | PASS |
| `npm run test:my-practice-patient-cabinet` | PASS — multiple specialists and scope isolation |
| `npm run test:medical-record` | PASS — A5 rights, revoked access, immutable versions and scope |
| `npm run test:my-practice` | PASS — full local A3 suite, including real PostgreSQL concurrency/rollback fixture |
| `npm run build` | PASS — full release-config/A3/A5/SEC-003 suite + Vite build |
| `git diff --check` | PASS |
| Migration/manifest/artifact SHA validation | PASS |
| Secret/sensitive-data scan of changed/untracked paths | PASS |

Первый build в restricted sandbox дошёл до Vite, но не смог создать ignored
`.vite-temp` в отдельном worktree (`EPERM`). Повтор той же команды с разрешённой
локальной записью прошёл полностью. Это не дефект кода. Неблокирующим осталось
обычное Vite warning о размере chunk.

## 7. Recovery point и восстановление

Read-only Dashboard-проверка выполнена только для exact Test URL с ref
`eehyehlhiyztciaezaus`:

- latest physical backup: **2026-11-25 02:54:08 UTC**;
- доступны предыдущие ежедневные physical backups;
- Dashboard показывает ручное действие `Restore`;
- PITR не включён и доступен только как add-on;
- restore не запускался, backup не скачивался, настройки не менялись;
- backup не включает Storage objects; Health migration Storage не затрагивает.

### План при ошибке применения

1. **Ошибка до commit.** Не повторять команду автоматически. Read-only проверить
   ledger row `20261123223548` и overload RPC. Если оба отсутствуют, transaction
   rollback завершён; исправлять ledger не нужно.
2. **Timeout/потеря ответа.** Считать результат неопределённым. Сначала получить
   migration list и `pg_proc`; не выполнять второй push до определения факта
   commit.
3. **Migration committed, acceptance не пройдена, runtime ещё не вызывался.**
   Остановить дальнейшие тесты. Подготовить отдельно reviewed forward migration,
   которая сначала отзовёт execute, затем удалит точную 13-argument signature.
   Не редактировать ledger вручную и не использовать `migration repair`.
4. **После synthetic runtime calls.** Заморозить E2E и сохранить evidence.
   Автоматически не удалять rows и не восстанавливать backup. Выбрать отдельно:
   forward fix/revoke либо owner-approved restore с оценкой всех Test changes
   после `02:54:08 UTC`.
5. **Широкое повреждение Test.** Только владелец запускает ручной restore из
   подтверждённой physical backup. Restore является отдельным destructive
   действием и требует нового согласования.

Суточный backup даёт не нулевой RPO: восстановление откатит и несвязанные Test
изменения после snapshot. Поэтому предпочтителен forward revoke/drop для этой
schema-only функции, если существующие данные не повреждены.

## 8. План post-apply acceptance

Все runtime records должны быть синтетическими; реальные пациенты, Auth Users,
медицинские тексты и существующие credentials не используются.

### 8.1 До первого RPC-вызова

1. Повторить migration list: 50 exact local/remote versions, pending отсутствуют.
2. Убедиться, что добавлена только version `20261123223548`.
3. Проверить один overload, точную сигнатуру, return type, INVOKER, пустой
   `search_path` и effective ACL.
4. Проверить, что предыдущие 49 ledger rows не изменились.
5. Проверить, что deferred/Production artifacts не появились в ledger.

### 8.2 Synthetic runtime matrix

| Сценарий | Ожидаемый результат |
| --- | --- |
| Новая Health-сессия | Fresh 128-bit internal `health_...`, новый owner, одна session/client/intake/credential/wallet/ledger chain |
| Искусственная session/lookup collision | `23505`, fresh retry; существующий owner и rows неизменны |
| Два одновременных bootstrap с start barrier | Два изолированных owner/session либо один безопасный conflict/retry; взаимной перезаписи нет |
| Ошибка wallet/ledger в транзакции | Нет частичных session/client/intake/credential rows |
| Потеря HTTP-ответа после bootstrap | Session ID сам по себе не раскрывает данные; восстановление только с действительным proof-of-possession |
| Полный continuation credential | Успешный Health exchange и новый access token по утверждённой процедуре |
| Неверный/чужой secret, token, session ID или owner | 401/403/общий отказ, без защищённых side effects |
| Подмена `support`/`body` | Отказ до чтения/изменения защищённых данных |
| Существующая современная Health-сессия | Повторный вход и дневник продолжают работать; owner не меняется |
| Два пациента | Ни отчёты, ни дневники, ни истории, ни wallets не пересекаются |
| Support и Health одного пользователя | Отдельные canonical owner/module scopes; cross-module token не принимается |
| Связь со специалистом | Доступ только в разрешённом module/org scope; чужой или revoked link отклонён |
| Прямой вызов от `anon`/`authenticated` | EXECUTE denied; rows не создаются |
| Кабинеты, дневники, голос, polling | SEC-003 possession checks сохраняются; session ID alone недостаточен |
| A3/A5 regression | Кабинет пациента, multiple specialists, encounters, revoked grants и scope isolation проходят |
| Financial regression | Booking mutations остаются fail-closed; Health wallet не включает booking payment mode |

После тестов выполнить aggregate-only invariant checks по синтетическому
уникальному marker, затем отдельно согласовать cleanup. Никакого автоматического
массового DELETE.

## 9. Остаточные риски и обязательные apply-time guards

1. **TOCTOU migration history.** Непосредственно перед write повторить exact
   target, SHA и dry-run; любой второй pending файл означает STOP.
2. **CLI runtime warning.** Локальный CLI `2.109.1` успешно выполнил list/dry-run,
   но Bun предупреждает об отсутствии AVX. Для write использовать совместимую
   baseline/pinned официальную сборку и снова выполнить dry-run.
3. **PITR отсутствует.** Доступны ежедневные physical backups, поэтому владелец
   должен принять суточный RPO перед apply.
4. **Billing warning.** Dashboard показал предупреждение о неоплаченных счетах
   организации и возможном service disruption. До окна apply оператор должен
   подтвердить, что Test останется доступен; финансовых действий в этой задаче
   не выполнялось.
5. **Remote financial env.** Этот preflight не менял и не переаттестовывал Vercel
   env. Для последующего runtime окна `MY_PRACTICE_FINANCIAL_MODE` должен остаться
   unset; `payments_disabled` нельзя включать до отдельного product/schema gate.
6. **Schema cache.** После apply возможен временный PostgREST cache miss. Это не
   повод повторять migration; сначала выполнить catalog check и только затем
   отдельно разрешённый cache reload при подтверждённом `PGRST202`.

## 10. Вердикт

**READY FOR HEALTH MIGRATION APPLY**

Технические блокеры сняты: exact Test target подтверждён, свежая physical backup
доступна, 49 applied migrations совпадают, единственная pending migration имеет
утверждённый SHA, dry-run предлагает только её, зависимости/ACL/атомарность и
финансовая изоляция проверены, локальные SEC-003/A3/A5 тесты и build прошли.

Перед фактическим write всё равно обязательны отдельное разрешение владельца,
повтор exact dry-run совместимым CLI, принятие backup RPO и проверка отсутствия
service disruption. В этом этапе migration, ledger, пользовательские данные,
Production, Git remote и deployment не изменялись.
