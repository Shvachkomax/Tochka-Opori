# Release Gate R2.3.4-A — независимый аудит и фиксация A3/A5

Дата аудита: 2026-11-23 (Europe/Moscow)
Репозиторий: `Shvachkomax/Tochka-Opori`
Ветка: `feature/my-practice-a3-patient-cabinet`
Контрольный исходный SHA: `7a1c66d33267181355e16f69c0b7ee37e66b200b`

Статусы в отчёте:

- **VERIFIED** — подтверждено непосредственным чтением SQL, каталогом новой локальной базы или повторно выполненным тестом;
- **NOT VERIFIED** — прямого доказательства в разрешённой среде нет;
- **BLOCKED** — продолжение в Production небезопасно до выполнения указанного условия.

## 1. Executive summary

| Gate | Статус | Вывод |
| --- | --- | --- |
| Независимый аудит локального пакета | **VERIFIED / GO** | Все 14 исходных незакоммиченных файлов прочитаны и проверены; критические SQL-свойства повторно проверены на четырёх новых Production-shaped базах, а `test_credits` — на отдельной пятой базе. |
| Фиксация одним локальным коммитом | **GO** | Один доказанный блокирующий дефект транзакционного контракта устранён; повторные тесты прошли. В commit допустимы только 15 файлов релизного пакета, включая этот отчёт. |
| Production Release Gate | **BLOCKED / NO-GO** | Не подтверждены backup/restore, актуальный live-catalog через независимое подключение, migration-history reconciliation, lock budget и окно изменений. Production/Test не изменялись. |

Обнаруженный блокирующий дефект: migration R2.3.3 содержала собственные
`BEGIN/COMMIT`. Актуальный Supabase migration runner сам оборачивает обычный
migration-файл в транзакцию; embedded `COMMIT` может преждевременно завершить
wrapper и отделить schema change от migration history. Исправление:

1. transaction-control удалён из
   `20261123114523_r233_fix_continuation_failed_attempt_rpcs.sql`;
2. локальные runners, использующие plain `psql`, теперь явно применяют каждый
   migration-файл с `--single-transaction`;
3. SQL и fault-injection повторены на двух новых чистых базах.

Других доказанных блокирующих дефектов в локальном SQL-пакете не найдено.

## 2. Исходное Git-состояние

Перед аудитом:

- **VERIFIED:** HEAD точно
  `7a1c66d33267181355e16f69c0b7ee37e66b200b`;
- **VERIFIED:** ветка
  `feature/my-practice-a3-patient-cabinet`;
- **VERIFIED:** tracked diff отсутствовал;
- **VERIFIED:** присутствовали ровно 14 untracked-файлов R2.3.2/R2.3.3;
- **VERIFIED:** посторонних незакоммиченных файлов или конфликтных маркеров не
  обнаружено.

Отчёты R2, R2.1, R2.2, R2.3.1, R2.3.2-L-Mac и R2.3.3 прочитаны полностью.
Отдельные R2.3.1b, R2.3.1c и диагностический R2.3.2-L в репозитории не найдены.

Локальный GO R2.3.2/R2.3.3 основан на реконструированной по структурным
метаданным Production-схеме и синтетических данных. Это **не** восстановленный
Production backup и не доказательство успешного restore.

## 3. Список аудированных файлов

Исходные 14 файлов:

1. `docs/releases/release-gate-r232-mac.md`
2. `docs/releases/release-gate-r233.md`
3. `scripts/release-gate-r232/catalog-fingerprint.sql`
4. `scripts/release-gate-r232/post-migration-tests.sql`
5. `scripts/release-gate-r232/pre-migration-fixtures.sql`
6. `scripts/release-gate-r232/production-baseline-local-alignment.sql`
7. `scripts/release-gate-r232/run-production-rehearsal.sh`
8. `scripts/release-gate-r232/test-concurrent-booking.sh`
9. `scripts/release-gate-r232/test-credits-synthetic.sql`
10. `scripts/release-gate-r233/run-r233-rehearsal.sh`
11. `scripts/release-gate-r233/test-continuation-rpc-fix.sql`
12. `supabase/migrations/20261123070309_r232_production_clinical_base_a3_a5.sql`
13. `supabase/migrations/20261123070333_r232_production_payments_disabled_booking.sql`
14. `supabase/migrations/20261123114523_r233_fix_continuation_failed_attempt_rpcs.sql`

Пятнадцатый файл фиксации — настоящий
`docs/releases/release-gate-r234a.md`.

Функциональные изменения R2.3.4-A ограничены четырьмя файлами:

- RPC migration: удалён embedded transaction-control;
- R2.3.2 runner: добавлены точные `r234a_*` allowlist-имена и
  `--single-transaction` для migration-файлов;
- concurrency runner: добавлены только точные `r234a_*` имена;
- R2.3.3 runner: добавлены точные имена и отдельный atomic migration runner.

## 4. Независимые выводы SQL-аудита

### 4.1 Production clinical base A3/A5

Файл:
`supabase/migrations/20261123070309_r232_production_clinical_base_a3_a5.sql`
SHA-256: `d15a95e83a084b131b2e2a62d880388a4255efe2698a6d53f9dd8960587ec436`

| Свойство | Статус | Вывод |
| --- | --- | --- |
| Порядок | VERIFIED | Первый Production target; booking migration зависит от него. |
| Предусловия | VERIFIED локально | Требует baseline `experts`, `organizations`, memberships, assignments/access, invitations, роли и schema `extensions`. Реконструированный baseline их содержит. |
| Existing data | VERIFIED синтетически | 2 clinics, 3 experts, 3 assignments, 1 access, 2 clinical events и 2 observations сохранились. Top-level data backfill отсутствует. |
| Создаваемые данные | VERIFIED | 7 server-only clinical tables и 2 identity sequences; исходные clinical/wallet таблицы не пересоздаются. |
| RLS/ACL | VERIFIED | RLS включён на всех 7 таблицах; PUBLIC/anon/authenticated table privileges отозваны; service-role grants перечислены явно. |
| Functions | VERIFIED | Privileged RPC имеют `search_path=''`, relation references квалифицированы; SECURITY DEFINER RPC доступны только owner/service_role. |
| Finance | VERIFIED | Нет `practice_booking_credits`, `practice_payments`, `practice_commissions`, test-payment RPC или provider calls. |
| Destructive SQL | VERIFIED | Нет `TRUNCATE`, top-level `UPDATE/DELETE` существующих медицинских строк или массового backfill. Есть только точечный `DROP TRIGGER IF EXISTS` перед заменой trigger. |
| Повторное применение | VERIFIED | One-shot: повтор ожидаемо останавливается на существующей `practice_places`; при atomic runner fingerprint не меняется. |
| Частичное применение | BLOCKED для произвольного runner | Файл должен выполняться одной транзакцией. Supabase runner делает это; plain `psql` разрешён только с `--single-transaction -v ON_ERROR_STOP=1`. |
| Timeout | BLOCKED для Production | Значения не встроены: они требуют согласованного lock budget и change window. |

### 4.2 Payments-disabled booking

Файл:
`supabase/migrations/20261123070333_r232_production_payments_disabled_booking.sql`
SHA-256: `9b368f03d13bc7a7f7fa43827f7b67bdda9186ed7e71d1cf3e4f4b9ba87c0fef`

- **VERIFIED:** зависит от первой migration, исходного status constraint,
  exclusion constraint и `reserve_practice_booking`.
- **VERIFIED:** добавляет только status `requested`, новый half-open
  exclusion constraint и два SECURITY INVOKER RPC.
- **VERIFIED:** RPC доступны только `postgres` и `service_role`;
  PUBLIC/anon/authenticated EXECUTE отозван.
- **VERIFIED:** runtime DML касается одной booking row и её audit event.
- **VERIFIED:** wallets, ledger, credits, payments и commissions не читаются и
  не изменяются.
- **VERIFIED:** повтор one-shot migration ожидаемо останавливается на
  отсутствующем старом constraint; atomic runner оставляет fingerprint
  неизменным.
- **BLOCKED для Production:** drop/add constraints и построение GiST exclusion
  требуют lock budget. В целевом порядке `practice_bookings` новая и пустая,
  но это необходимо подтвердить непосредственно перед применением.

### 4.3 Continuation RPC fix

Файл:
`supabase/migrations/20261123114523_r233_fix_continuation_failed_attempt_rpcs.sql`
SHA-256 после R2.3.4-A:
`f9b081e450fc8b94b8b67d196a6819263968ca2ce0fcaa1b85501ea4fd814498`

- **VERIFIED:** отдельная forward-only migration; clinical SQL не смешан с
  rate-limit fix.
- **VERIFIED:** не содержит table DML во время migration.
- **VERIFIED:** повторяема через `CREATE OR REPLACE`.
- **VERIFIED:** больше не содержит `BEGIN/COMMIT`; atomicity принадлежит
  Supabase runner.
- **VERIFIED:** preconditions требуют таблицу, обе сигнатуры, SECURITY INVOKER
  и включённый RLS.
- **VERIFIED:** postconditions проверяют INVOKER, volatility, parallel mode и
  пустой `search_path`.
- **VERIFIED:** `CREATE OR REPLACE` сохраняет owner и ACL; runtime-тест
  сравнивает их с baseline.

## 5. Независимый аудит RPC

Исходный дефект воспроизведён на каждой новой Production-shaped базе:

```text
ERROR: relation "continuation_failed_attempts" does not exist
```

Причина **VERIFIED**: функции имели `search_path=''`, но использовали
неквалифицированное имя relation. Пустой path исключает `public`; перевод в
SECURITY DEFINER или расширение grants проблему не исправляет и не применялся.

Сохранённый контракт:

| Свойство | Increment | Clear |
| --- | --- | --- |
| Schema/signature | `public.increment_continuation_failed_attempts(text)` | `public.clear_continuation_failed_attempts(text)` |
| Return | table(count integer, locked_until timestamptz) | void |
| Owner | postgres | postgres |
| Security | INVOKER | INVOKER |
| Volatility / parallel | VOLATILE / UNSAFE | VOLATILE / UNSAFE |
| search_path | empty | empty |
| EXECUTE roles | PUBLIC, anon, authenticated, postgres, service_role | то же |

Исторически широкий EXECUTE ACL не расширен и не сужен в этом пакете.
`anon/authenticated` не имеют эффективного доступа к строкам: функции
INVOKER, таблица RLS-enabled, policies отсутствуют. Increment получает RLS
error; clear не удаляет невидимую строку; SELECT возвращает 0 строк.

Schema-shadow probe с одноимённой temp table записал строку только в
`public.continuation_failed_attempts`. Скан всех финальных функций
`public` с пустым `search_path` по всем public relations вернул 0
неквалифицированных runtime relation references. Массовое автоматическое
переписывание функций не выполнялось.

## 6. Результаты локальных тестов

Созданы новые базы на PostgreSQL image
`public.ecr.aws/supabase/postgres:17.6.1.143`:

- первые независимые прогоны: `r234a_prod_a_7a1c66d`,
  `r234a_prod_b_7a1c66d`;
- после transaction fix: `r234a_tx_a_7a1c66d`,
  `r234a_tx_b_7a1c66d`;
- отдельный contour: `r234a_testcredits_7a1c66d`.

Критический итог относится к двум последним чистым `tx`-базам:

| Проверка | A | B |
| --- | --- | --- |
| 33 mapped baseline files + guarded alignment | PASS | PASS |
| Baseline fingerprint | одинаков | одинаков |
| Clinical + booking migrations atomically | PASS | PASS |
| Pre-fix RPC error | воспроизведён | воспроизведён |
| RPC fix, первое применение | PASS | PASS |
| RPC fix, повторное применение | PASS | PASS |
| RPC roles/RLS/ACL/owner/signature | PASS | PASS |
| Schema-shadow protection | PASS | PASS |
| Старые synthetic medical rows | сохранены | сохранены |
| Межклиническая booking/medical isolation | PASS | PASS |
| Append-only medical versions | PASS | PASS |
| Конкурентная запись | 1 commit + 1 exclusion violation | то же |
| Final fingerprint | одинаков | одинаков |

Финальный каталог обеих баз:

| Категория | Count | Fingerprint |
| --- | ---: | --- |
| columns | 1072 | `1ed7c81c26b10ebc8e9e5533405d841d` |
| constraints | 376 | `31fe483a9c77889800f3e5ef4129ade6` |
| extensions | 5 | `96b62911ec05a0a6342ac2f6e5eb08b4` |
| function ACL | 99 | `d8048f7afa4a475ce198ce0cfa57422a` |
| functions | 47 | `7504c74b3f9a042e8369df3b1197309c` |
| indexes | 304 | `81061f46ae0b480933f4efc9d0d6af79` |
| policies | 14 | `7bc3cd0d4974f5c10d7b535083c8d8db` |
| relations | 71 | `cb402613b6f299d9c7d48af675e41e9e` |
| table grants | 1456 | `1062e1c0a3a60c3d77f5b6ac2ba7555a` |
| triggers | 30 | `03d561cb6e3e20a19bb1b5d0006e1a72` |

Fault injection:

- `psql --single-transaction` получил намеренную ошибку division by zero;
- созданная до ошибки probe table полностью откатилась;
- результат: `status=1`, `rolled_back=true`.

Остальные повторно выполненные проверки:

- `npm run build` — **PASS**;
- A3.8.1/A3.8.2/A3.9/My Practice/A5/A5.2 — **PASS**;
- `npm run test:practice-financial-mode` — **PASS**;
- `node scripts/test-continuation-rate-limit.js` — **PASS**;
- shell syntax — **PASS**;
- Vite chunk >500 kB — warning, не release blocker этого SQL-пакета.

## 7. Аудит финансовых режимов

| Условие | Статус | Доказательство |
| --- | --- | --- |
| `payments_disabled` | VERIFIED | Создаётся `requested`; wallet/ledger counts не меняются; отмена без refund/payment. |
| `test_credits` отдельно | VERIFIED | Отдельная база из 50 tracked migrations исходного SHA; 1 debit, 1 refund, final balance 50000. |
| Simulated payments/commissions | VERIFIED | В credit test обе таблицы остались с 0 строк. |
| Test finance в Production target | VERIFIED absent | `practice_booking_credits/payments/commissions` и test-payment RPC отсутствуют. |
| Production `test_credits` | VERIFIED blocked | `TEST_CREDITS_FORBIDDEN_IN_PRODUCTION`. |
| `real_payments` | VERIFIED blocked | `REAL_PAYMENTS_NOT_IMPLEMENTED`. |
| Внешний эквайринг/webhook | VERIFIED absent | Нет provider/HTTP/cron/webhook вызовов в трёх target migrations. |

## 8. Статус локальной изоляции

Сеть `r234a_rehearsal_net_7a1c66d`:

- **VERIFIED:** Docker context `colima`;
- **VERIFIED:** `internal=true`, `attachable=false`, driver `bridge`;
- **VERIFIED:** subnet `172.21.0.0/16`;
- **VERIFIED:** у пяти контейнеров нет host-port bindings;
- **VERIFIED:** PGDATA — `tmpfs`;
- **VERIFIED:** runners используют только exact container allowlist и
  `docker exec`; URL, cloud ref и service key им не передаются;
- **VERIFIED:** local alignment без session GUC падает до первого DDL;
- **VERIFIED:** alignment находится только в `scripts/release-gate-r232/`,
  не в `supabase/migrations`;
- **VERIFIED:** автоматического stop/remove/prune чужих Docker-ресурсов нет.

Существующие `r232_*`, `r233_*` и рабочий Supabase stack не
останавливались, не удалялись и не изменялись.

## 9. Migration-history reconciliation — предварительная матрица

| Git / local source | Production history из R2.3.2 evidence | Статус определения |
| --- | --- | --- |
| 27 файлов `20260814000000..20260826131822` | те же version+name | VERIFIED по history; итоговый каталог после применения и alignment совпал |
| `scripts/migrations/add-save-request-id-to-body-daily-logs.sql` | `20261005071922_add_save_request_id_to_body_daily_logs` | Mapping VERIFIED; файл вне стандартного migration path |
| `20261005123149_patient_reported_medication_orders` | exact | VERIFIED |
| `20261005234912_medication_reference_layer` | exact | VERIFIED |
| `20261021000822_link_match_request_to_session` | `20261021072023_link_match_request_to_session` | Timestamp drift; per-migration semantic identity NOT VERIFIED |
| `20261026062744_pneumointegration_shared_org_scope` | `20261026064902_pneumointegration_shared_org_scope` | Timestamp drift; per-migration semantic identity NOT VERIFIED |
| `20261027062352_partner_test_accruals` | `20261027112618_partner_test_accruals` | Timestamp drift; per-migration semantic identity NOT VERIFIED |
| A3/A5 target `20261123070309`, `20261123070333` | отсутствуют | Pending only after separate approval |
| RPC fix `20261123114523` | отсутствует | Pending only after separate approval |

Итоговый baseline catalog был воспроизведён по R2.3.2 structural metadata:
relations, constraints, indexes, policies, functions, triggers, grants, ACL и
extensions совпали; column fingerprint имел документированное отличие только
в physical ordinal order двух неиспользуемых target-пакетом таблиц.

Это **не** доказывает, что три timestamp-drift migration-файла побайтно или
построчно эквивалентны исторически применённым SQL. Поэтому:

- **BLOCKED:** `supabase db push`;
- **BLOCKED:** `migration repair`;
- **BLOCKED:** ручная вставка строк migration history;
- **NOT VERIFIED:** актуальная live-history после R2.3.3, потому что текущий
  connector не предоставил активный `link_id`.

## 10. Статус `btree_gist`

- **VERIFIED локально:** migration устанавливает `btree_gist` 1.7 в
  защищённую schema `extensions`.
- **VERIFIED:** extension нужен для UUID equality + range overlap в GiST
  exclusion constraint.
- **VERIFIED по более позднему R2.3.2 catalog evidence:** extension отсутствовал
  в Production baseline на момент снимка.
- **NOT VERIFIED сейчас:** актуальный live status не перечитан независимым
  подключением. R2.3.1 содержал противоречивое раннее утверждение о наличии;
  для решения используется более поздний полный catalog snapshot R2.3.2.
- **BLOCKED:** Production installation без проверки available version, schema,
  owner privileges и owner approval.
- **BLOCKED при будущем PostgreSQL 17.11 upgrade:** проверить официальное
  предупреждение Supabase о возможном reindex `btree_gist`.

## 11. Статус backup/restore

- **NOT VERIFIED:** последний успешный Production backup и его timestamp;
- **NOT VERIFIED:** PITR status, retention и recovery window;
- **NOT VERIFIED:** восстановление реального backup;
- **NOT VERIFIED:** RPO/RTO и восстановительная роль владельца;
- **BLOCKED:** Production change до документированного backup/PITR sign-off.

В R2.3.4-A backup не скачивался, clone не создавался, restore не запускался.

## 12. Production-блокеры и lock/timeout plan

Предварительный порядок после отдельного approval:

1. read-only preflight live catalog и migration history;
2. backup/PITR sign-off;
3. одна transactional migration
   `20261123070309_r232_production_clinical_base_a3_a5.sql`;
4. postflight catalog/RLS checks;
5. одна transactional migration
   `20261123070333_r232_production_payments_disabled_booking.sql`;
6. postflight booking/financial invariants;
7. одна transactional migration
   `20261123114523_r233_fix_continuation_failed_attempt_rpcs.sql`;
8. RPC contract and rate-limit smoke checks.

Потенциальные блокировки:

- `CREATE EXTENSION btree_gist`;
- `CREATE OR REPLACE FUNCTION` существующих invitation/link RPC;
- drop/create trigger на `patient_specialist_invitations`;
- foreign keys/indexes новых таблиц;
- drop/add booking constraints и построение GiST exclusion index;
- замена двух active continuation RPC.

Предварительные значения только для согласования, не встроенные в SQL:

- `SET LOCAL lock_timeout = '5s'`;
- `SET LOCAL statement_timeout = '5min'` для clinical/booking migrations;
- `SET LOCAL statement_timeout = '60s'` для RPC fix.

`lock_timeout` должен быть меньше `statement_timeout`. Значения необходимо
проверить по фактическому размеру таблиц, активным транзакциям и допустимому
окну. Не следует увеличивать timeout автоматически при конфликте: сначала
остановить rollout и определить блокирующую сессию.

Production остаётся **BLOCKED** также из-за:

1. трёх timestamp drift и нестандартного исторического файла;
2. отсутствия независимого актуального live-catalog;
3. отсутствия row-volume и lock-duration measurements;
4. неподтверждённого backup/restore;
5. отсутствия owner-approved maintenance/monitoring/recovery runbook;
6. Supabase CLI 2.109.1 x64/Bun AVX warning и необходимости заранее
   утвердить версию runner.

## 13. GO/NO-GO для фиксации пакета

### GO

Разрешён один локальный commit с 15 перечисленными файлами. Основания:

- доказанный transaction-wrapper defect исправлен;
- две новые чистые репетиции после исправления совпали;
- fault injection подтвердил atomic rollback;
- RLS/ACL/schema-shadowing/finance/concurrency/medical regressions прошли;
- secret/PII/staged-file checks выполнены непосредственно перед commit:
  секреты, реальные персональные данные и посторонние пути не обнаружены;
- commit фиксирует reviewed artifact и **не** разрешает Production rollout.

## 14. Production Release Gate

### NO-GO

Production Release Gate остаётся **NO-GO**. Локальный commit, успешный build и
синтетическая репетиция не заменяют backup restore test, live migration-history
reconciliation, lock measurement, owner review и отдельное разрешение.

Production Supabase `blwogrdezfhprdpdnxtn`, Test Supabase
`eehyehlhiyztciaezaus`, Vercel и внешние сервисы в рамках этого аудита не
изменялись.

## 15. Следующий безопасный этап

1. Независимый reviewer проверяет этот commit и три migration-файла.
2. Владелец подтверждает backup/PITR без запуска restore.
3. Через технически read-only live-сессию обновляется catalog/history matrix.
4. Согласуются runner version, transaction semantics, timeout и maintenance
   window.
5. Только отдельное решение владельца может открыть новый Production gate.

## Нормативные источники

- [Supabase CLI workflows](https://supabase.com/docs/guides/local-development/cli-workflows) —
  migration transaction semantics и non-transactional directive.
- [Supabase database migrations](https://supabase.com/docs/guides/deployment/database-migrations) —
  migration workflow и lock timeout.
- [Supabase database functions](https://supabase.com/docs/guides/database/functions) —
  SECURITY INVOKER/DEFINER и empty `search_path`.
- [PostgreSQL 17 client defaults](https://www.postgresql.org/docs/17/runtime-config-client.html) —
  `search_path`, `statement_timeout`, `lock_timeout`.
- [PostgreSQL 17 CREATE EXTENSION](https://www.postgresql.org/docs/17/sql-createextension.html) —
  schema, owner и installation security.
- [Supabase PostgreSQL 15.19/17.11 notice](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes) —
  будущий `btree_gist` reindex risk.
