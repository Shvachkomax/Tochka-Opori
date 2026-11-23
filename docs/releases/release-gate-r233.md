# Release Gate R2.3.3

Дата проверки: 2026-11-23 (Europe/Moscow)
Репозиторий: `/Users/macintosh/Documents/ChatGPT/Точка опоры`
Ветка: `feature/my-practice-a3-patient-cabinet`
Базовый и текущий HEAD: `7a1c66d33267181355e16f69c0b7ee37e66b200b`

## Итог

| Gate | Решение | Основание |
| --- | --- | --- |
| Локальный пакет Production baseline → A3/A5 → RPC fix | **GO** | Две новые чистые изолированные базы прошли одинаковую последовательность; RPC исправлены без изменения сигнатур, owner, EXECUTE ACL, RLS или SECURITY INVOKER; клинические, финансовые и конкурентные проверки прошли. |
| Production Release Gate | **NO-GO** | Требуются независимая проверка владельца, backup/PITR, согласованный migration-history reconciliation, lock/timeout runbook и отдельное разрешение. Production/Test не изменялись. |

Локальный GO не разрешает `supabase db push`, ручное применение SQL, deploy или изменение migration history Production.

## 1. Область проверки и изоляция

Полностью прочитан `docs/releases/release-gate-r232-mac.md`. Все 10 незакоммиченных файлов R2.3.2 сохранены; три вспомогательных файла усилены только для R2.3.3-репетиции:

- local-only alignment получил fail-closed session guard;
- R2.3.2 runner и concurrency runner получили точный allowlist новых имён `r233_prod_a/b`.

Не выполнялись commit, push, merge, deploy, `supabase db reset`, cloud clone, Production/Test DDL/DML, реальные платежи, уведомления или чтение прикладных строк Production.

Для R2.3.3 созданы без удаления прежних контейнеров:

- internal-only сеть `r233_rehearsal_net_7a1c66d`, subnet `172.20.0.0/16`, `attachable=false`;
- `r233_prod_a_7a1c66d`;
- `r233_prod_b_7a1c66d`;
- `r233_testcredits_7a1c66d`.

Все три контейнера используют локальный образ `public.ecr.aws/supabase/postgres:17.6.1.143`, `tmpfs`, не имеют опубликованных host-портов и остались healthy. Существующие `r232_*` и рабочий Supabase stack не изменялись и не удалялись.

Проверка опиралась на актуальные официальные рекомендации Supabase:

- при `search_path=''` каждая relation в функции должна быть schema-qualified: [Database functions](https://supabase.com/docs/guides/database/functions);
- RLS на таблице exposed schema остаётся обязательным: [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security);
- Production migration history должна совпадать с migration-файлами: [Database migrations](https://supabase.com/docs/guides/deployment/database-migrations).

## 2. Точная причина дефекта RPC

Read-only Production metadata подтверждает:

| Свойство | `increment_continuation_failed_attempts` | `clear_continuation_failed_attempts` |
| --- | --- | --- |
| Schema | `public` | `public` |
| Identity arguments | `p_attempt_key text` | `p_attempt_key text` |
| Return | `TABLE(failed_attempt_count integer, locked_until timestamptz)` | `void` |
| Owner | `postgres` | `postgres` |
| Security | `INVOKER` | `INVOKER` |
| Volatility | `VOLATILE` | `VOLATILE` |
| Parallel | `UNSAFE` | `UNSAFE` |
| `search_path` | пустой | пустой |
| EXECUTE ACL | PUBLIC, postgres, anon, authenticated, service_role | то же |

Используемая таблица: `public.continuation_failed_attempts`, owner `postgres`, RLS enabled, FORCE RLS disabled, policies отсутствуют. `postgres` и `service_role` имеют `BYPASSRLS`; `anon` и `authenticated` — нет.

Production function bodies обращались к таблице как к `continuation_failed_attempts`, без `public.`. Пустой `search_path` намеренно исключает пользовательские схемы; `pg_catalog` остаётся неявно доступным, но `public` не участвует в разрешении relation. Поэтому обе функции падали во время выполнения:

```text
ERROR: relation "continuation_failed_attempts" does not exist
```

Ошибка воспроизведена на обеих локальных exact-baseline базах до исправления.

### Аналогичные дефекты

Все Production-функции с `search_path=''` были сопоставлены построчно со всеми relations схемы `public`. До исправления runtime-неквалифицированные relation references найдены только в этих двух RPC. Единственный дополнительный match `RETURNS usage_wallets` относится к уже разрешённому OID return type, а не к runtime SQL relation lookup.

После исправления тот же скан на локальной финальной схеме вернул 0 строк.

## 3. Исправление

Создана отдельная forward-only миграция:

`supabase/migrations/20261123114523_r233_fix_continuation_failed_attempt_rpcs.sql`
SHA-256: `d5fdcf165a44419db5ec98af9b5b9269adbcb8bc8ed756424a72f93116014b22`

Миграция:

- имеет явные `BEGIN/COMMIT`;
- проверяет наличие таблицы и обеих исходных сигнатур;
- требует сохранённый INVOKER-контракт и включённый RLS;
- использует `CREATE OR REPLACE FUNCTION` с теми же identity arguments и return types;
- явно фиксирует `VOLATILE`, `PARALLEL UNSAFE`, `SECURITY INVOKER`, `search_path=''`;
- обращается к `public.continuation_failed_attempts` явно;
- использует alias `attempts` внутри `ON CONFLICT`/`RETURNING`;
- вызывает `pg_catalog.now()` явно;
- после замены проверяет security/volatility/parallel/search-path contract;
- не содержит `GRANT`, `REVOKE`, изменения RLS, policies или table DML во время миграции.

`CREATE OR REPLACE` сохранил owner и ACL. Функции намеренно не переведены в `SECURITY DEFINER`: это расширило бы эффективные полномочия и позволило бы обходить RLS.

## 4. Регрессионные тесты RPC

На каждой из двух новых баз проверено:

| Проверка | A | B |
| --- | --- | --- |
| Оба pre-fix runtime error воспроизведены | PASS | PASS |
| Первое увеличение создаёт count=1 | PASS | PASS |
| Повторное увеличение атомарно растит count | PASS | PASS |
| Пятая попытка создаёт lock примерно на 15 минут | PASS | PASS |
| Clear удаляет только переданный attempt key | PASS | PASS |
| Разные attempt keys изолированы | PASS | PASS |
| Существующая строка count/timestamps сохранена | PASS | PASS |
| Owner/signature/return/security/ACL не изменены | PASS | PASS |
| RLS enabled, policies не добавлены | PASS | PASS |
| `anon`/`authenticated` не видят защищённые строки | PASS | PASS |
| `anon`/`authenticated` не могут increment через RLS | PASS | PASS |
| Clear от non-bypass roles не удаляет скрытые строки | PASS | PASS |
| `service_role` может increment/clear | PASS | PASS |
| Temp-table/schema-shadowing не перехватывает lookup | PASS | PASS |
| Финальная migration применена повторно дважды | PASS | PASS |

Существующий EXECUTE ACL для PUBLIC/anon/authenticated сохранён как часть исходного контракта. Это не даёт доступа к строкам: функции остаются INVOKER, а RLS без policies блокирует DML/visibility для non-bypass roles. Отдельное сужение ACL возможно только отдельным согласованным security change.

Дополнительно `node scripts/test-continuation-rate-limit.js` прошёл сценарии existing/non-existing lookup indistinguishability, порога 5, параллельных ошибок, lock expiry и IP isolation.

## 5. Повторная Production → A3/A5 репетиция

На `r233_prod_a` и `r233_prod_b` с нулём relations в `public` повторена последовательность:

1. 33 SQL-файла, соответствующие Production migration history.
2. Guarded local-only catalog alignment.
3. Синтетические старые клинические данные.
4. `20261123070309_r232_production_clinical_base_a3_a5.sql`.
5. `20261123070333_r232_production_payments_disabled_booking.sql`.
6. R2.3.2 post-migration tests.
7. Воспроизведение двух дефектных RPC.
8. `20261123114523_r233_fix_continuation_failed_attempt_rpcs.sql` дважды.
9. RPC contract/security tests.
10. Двухсессионный concurrency test.

Обе базы дали одинаковый финальный каталог:

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

От R2.3.2 изменился только fingerprint function definitions. Counts, grants, policies, relations, data structures и extension layout не изменились.

## 6. Аудит 10 файлов R2.3.2 относительно базового SHA

Все 10 файлов отсутствуют в базовом SHA и являются сохранёнными незакоммиченными additions.

| Файл | Назначение | Повтор/данные/безопасность | Итог |
| --- | --- | --- | --- |
| `docs/releases/release-gate-r232-mac.md` | доказательный отчёт | Только документация | PASS |
| `scripts/release-gate-r232/catalog-fingerprint.sql` | read-only fingerprint | Повторяем; не читает app rows | PASS |
| `scripts/release-gate-r232/pre-migration-fixtures.sql` | синтетические old-data fixtures | Fresh-db only; fixed IDs; INSERT only | PASS |
| `scripts/release-gate-r232/post-migration-tests.sql` | assertions A3/A5 | Fresh-db test only; синтетический DML внутри теста | PASS |
| `scripts/release-gate-r232/test-credits-synthetic.sql` | отдельный credit flow | Fresh synthetic contour only; не Production path | PASS |
| `scripts/release-gate-r232/production-baseline-local-alignment.sql` | точная локальная реконструкция live catalog | Содержит ожидаемый `DROP TABLE` пустой baseline campaign table; теперь требует `r232.local_rehearsal=on`; вне migration path | PASS, local-only |
| `scripts/release-gate-r232/run-production-rehearsal.sh` | оркестрация exact baseline | Отказывается от non-empty `public`; exact container allowlist; alignment GUC выставляется только этой командой | PASS |
| `scripts/release-gate-r232/test-concurrent-booking.sh` | две параллельные транзакции | Синтетические fixed keys; один commit, второй exclusion violation | PASS |
| `supabase/migrations/20261123070309_r232_production_clinical_base_a3_a5.sql` | клиническая A3/A5 база | One-shot migration; без top-level row DML, test finance и external calls | PASS |
| `supabase/migrations/20261123070333_r232_production_payments_disabled_booking.sql` | неоплачиваемый durable booking request | One-shot migration; wallet/ledger/payment/commission не меняются | PASS |

`production-baseline-local-alignment.sql` физически находится только в `scripts/release-gate-r232/`; `find ... -samefile` не обнаружил его в `supabase/migrations`. Без специального session GUC файл падает до первого DDL. Он не является migration и не должен копироваться, переименовываться или подаваться Production SQL runner.

## 7. Детальный аудит Production SQL-пакета

### 7.1 `20261123070309_r232_production_clinical_base_a3_a5.sql`

SHA-256 не изменился после R2.3.2: `d15a95e83a084b131b2e2a62d880388a4255efe2698a6d53f9dd8960587ec436`.

- Предусловия: Production baseline tables `experts`, `organizations`, patient link/invitation tables; роли `anon`, `authenticated`, `service_role`; schema `extensions`; `gen_random_uuid()`.
- Создаёт 7 clinical tables и 2 identity sequences, `btree_gist` в `extensions`, indexes, constraints, triggers и functions.
- Не выполняет top-level `UPDATE`, `DELETE`, `TRUNCATE` или массовый backfill.
- Единственный DROP — `DROP TRIGGER IF EXISTS` перед заменой конкретного trigger.
- 7 новых таблиц получают RLS; PUBLIC/anon/authenticated table privileges отозваны; service-role privileges перечислены явно.
- SECURITY DEFINER используется только там, где нужен controlled backend bypass; EXECUTE отозван у PUBLIC/anon/authenticated и выдан service_role, либо функция доступна только trigger owner.
- Все privileged functions имеют пустой `search_path` и schema-qualified relations.
- Test credits, simulated payments, commissions, providers, webhooks, external calls и notifications отсутствуют.
- Повторное применение после успеха предсказуемо падает на существующей `practice_places`; в явной тестовой транзакции весь повтор откатился, fingerprint не изменился.

### 7.2 `20261123070333_r232_production_payments_disabled_booking.sql`

SHA-256 не изменился: `9b368f03d13bc7a7f7fa43827f7b67bdda9186ed7e71d1cf3e4f4b9ba87c0fef`.

- Зависит от предыдущей migration и новой пустой `practice_bookings`.
- Расширяет status до `requested`, заменяет exclusion constraint и создаёт два INVOKER RPC.
- Runtime DML ограничен одной booking row и audit event; используется row lock.
- Wallets, usage ledger, credit snapshots, payments и commissions не читаются и не изменяются.
- RPC доступны только owner/service_role; PUBLIC/anon/authenticated EXECUTE отозван.
- Повторное применение предсказуемо падает на уже удалённом старом constraint; явная транзакция полностью откатилась, fingerprint не изменился.

### 7.3 `20261123114523_r233_fix_continuation_failed_attempt_rpcs.sql`

- Зависит только от двух существующих signatures и `public.continuation_failed_attempts` с RLS.
- Не изменяет строки во время migration.
- Атомарна и повторяема.
- Не создаёт SECURITY DEFINER и не расширяет ACL.
- Не содержит внешних вызовов, финансовой логики или фоновых действий.

### 7.4 Блокировки и timeout

- RPC fix заменяет два catalog function objects; table scan и table DML отсутствуют. Ожидается короткая DDL-блокировка конкурентных вызовов функций.
- Clinical migration создаёт новые таблицы/indexes, но также заменяет function/trigger на существующих invitation/link tables; это требует коротких DDL locks.
- Payments-disabled migration меняет constraints новой `practice_bookings`; exclusion constraint строит GiST index. В согласованной последовательности таблица ещё пуста.
- В двух R2.3.2 migration-файлах нет собственного `lock_timeout` и явного transaction wrapper. Локальный one-shot прогон успешен; Production runner должен гарантировать отдельную транзакцию для каждой migration и установить согласованный `lock_timeout`/`statement_timeout`. Это условие Production Gate, а не скрытый PASS.

Официальная документация рекомендует задавать `lock_timeout` при риске lock timeout: [Database migrations](https://supabase.com/docs/guides/deployment/database-migrations). При будущем обновлении PostgreSQL 17.6 → 17.11 нужно учесть предупреждение о возможном reindex для `btree_gist`: [PostgreSQL 15.19/17.11 breaking changes](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes).

## 8. Остальные тесты

| Проверка | Результат |
| --- | --- |
| Сохранность 2 clinics, 3 doctors, assignments/access | PASS на A/B |
| Сохранность 2 legacy clinical observations | PASS на A/B |
| RLS/ACL новых clinical tables | PASS на A/B |
| Межклиническая booking isolation | PASS на A/B |
| Межклиническая medical revision isolation | PASS на A/B |
| Immutable encounter versions | PASS на A/B |
| `payments_disabled`, idempotency, no wallet mutation | PASS на A/B |
| Конкурентное бронирование | 1 commit + 1 exclusion violation на A/B |
| Отдельный новый `test_credits` container | PASS |
| `test_credits`: debit/refund/idempotency | 1 debit, 1 refund, final balance 50000 |
| `test_credits`: simulated payments/commissions | 0 / 0 |
| Production default `payments_disabled` | PASS |
| Production `test_credits` blocked | `TEST_CREDITS_FORBIDDEN_IN_PRODUCTION` |
| `real_payments` blocked | `REAL_PAYMENTS_NOT_IMPLEMENTED` |
| `npm run build` | PASS |
| A3.8.1/A3.8.2/A3.9/My Practice/A5/A5.2 | PASS |
| Shell syntax | PASS |
| Secret pattern scan | 0 findings |

Vite сохранил неблокирующее предупреждение о chunk > 500 kB.

## 9. Все изменённые файлы после R2.3.3

Сохранённые R2.3.2 additions:

1. `docs/releases/release-gate-r232-mac.md`
2. `scripts/release-gate-r232/catalog-fingerprint.sql`
3. `scripts/release-gate-r232/post-migration-tests.sql`
4. `scripts/release-gate-r232/pre-migration-fixtures.sql`
5. `scripts/release-gate-r232/production-baseline-local-alignment.sql`
6. `scripts/release-gate-r232/run-production-rehearsal.sh`
7. `scripts/release-gate-r232/test-concurrent-booking.sh`
8. `scripts/release-gate-r232/test-credits-synthetic.sql`
9. `supabase/migrations/20261123070309_r232_production_clinical_base_a3_a5.sql`
10. `supabase/migrations/20261123070333_r232_production_payments_disabled_booking.sql`

Новые R2.3.3 additions:

11. `supabase/migrations/20261123114523_r233_fix_continuation_failed_attempt_rpcs.sql`
12. `scripts/release-gate-r233/test-continuation-rpc-fix.sql`
13. `scripts/release-gate-r233/run-r233-rehearsal.sh`
14. `docs/releases/release-gate-r233.md`

Все файлы незакоммичены. `.env`, ключи, реальные пользовательские данные и cloud metadata не добавлены.

## 10. Оставшиеся риски и блокеры

1. Production migration history содержит три timestamp drift относительно Git; автоматический `db push` без reconciliation запрещён.
2. Backup/PITR и recovery rehearsal не подтверждены.
3. Не согласованы maintenance window, `lock_timeout`, `statement_timeout`, monitoring и forward-recovery runbook.
4. Production build PostgreSQL 17.6.1.127 отличается от локального image 17.6.1.143.
5. Исторический EXECUTE/table ACL для continuation RPC/table включает anon/authenticated/PUBLIC. RLS сейчас fail-closed и тесты подтверждают отсутствие эффективного доступа; целесообразность отдельного REVOKE требует независимого contract review.
6. Supabase CLI 2.109.1 работает через x64 Bun/Rosetta и выдаёт AVX warning.
7. Нет production row volume, реальной нагрузки и длительных транзакций; lock duration на Production не измерена.
8. `btree_gist` отсутствует в текущем Production и будет новым extension object; его создание требует отдельного owner approval.

## 11. Решение

### Локальный пакет: GO

Пакет из двух клинических migration-файлов и отдельного RPC fix локально воспроизводим. Два чистых прогона совпали, клинические данные сохранились, test finance не попал в Production path, `real_payments` заблокирован, RPC contract и RLS сохранены.

### Production Release Gate: NO-GO

Production Release Gate остаётся **NO-GO** до независимой проверки и отдельного решения владельца. Минимальные условия следующего решения:

1. утвердить точный порядок трёх migration-файлов и migration-history reconciliation;
2. подтвердить backup/PITR и recovery plan;
3. определить transaction/lock/statement timeout и maintenance window;
4. независимо проверить сохранение широкого исторического continuation ACL либо согласовать отдельное hardening изменение;
5. утвердить установку `btree_gist` и мониторинг;
6. выдать отдельное явное разрешение на Production.
