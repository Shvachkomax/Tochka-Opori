# SEC-003 — Health Targeted Migration Preparation

- Дата: 25 ноября 2026 г.
- Режим: `LOCAL MIGRATION PREPARATION — NO DATABASE WRITES`
- Integration worktree: `/Users/macintosh/Documents/ChatGPT/Точка опоры-sec-003-a3a5-integration`
- Ветка: `codex/sec-003-a3a5-integration`
- HEAD: `2f05e9f282c51e50b15aac9c3197164eb3a21f6f`
- Целевая Test Supabase: `eehyehlhiyztciaezaus`

## 1. Executive Summary

Локальная миграция Health bootstrap уже присутствует, полностью совпадает с проверенным
вариантом SEC-003 из commit `7e62625a0344b5f42a533923d2669e827399367c` и не требует
переписывания. SQL-контракт, зависимости, права `service_role`, атомарность и локальные тесты
подтверждены.

Однако безопасный способ зарегистрировать **ровно эту одну локальную versioned migration** в
текущей истории Test отсутствует:

- локальный каталог содержит 54 migration versions, Test history — 49;
- 11 локальных versions отсутствуют в Test, 6 Test versions отсутствуют локально;
- после последней Test version локально pending не только Health RPC, но ещё четыре файла;
- `supabase db push`/`migration up` не имеют флага выбора одного файла;
- MCP `apply_migration` и Management API принимают `name` и `query`, но не исходный `version`,
  поэтому создадут server-generated timestamp, не равный `20261123223548`;
- direct SQL и последующий `migration repair` нарушили бы ограничения задания.

Итог: SQL готов, но migration-history gate не пройден.

**MIGRATION PREPARATION BLOCKED**

## 2. Текущий статус RPC

Read-only аудит `SEC-003-HEALTH-RPC-READINESS.md` подтвердил:

- целевая база — только `eehyehlhiyztciaezaus` (`Tochka-Opori-Preview-Test`);
- `public.bootstrap_health_intake` отсутствует;
- overload-варианты отсутствуют;
- необходимые таблицы, ограничения, defaults и `ensure_usage_wallet` существуют;
- текущий серверный код при отсутствии RPC завершает Health registration безопасным HTTP 500
  до выдачи access token или continuation credential.

В этом этапе RPC не вызывалась, DDL/DML не выполнялись, Test и Production не изменялись.

## 3. Исходный и подготовленный SQL

Утверждённый файл уже находится в integration worktree:

`supabase/migrations/20261123223548_sec_003_health_bootstrap.sql`

Проверки происхождения:

| Проверка | Результат |
| --- | --- |
| Source branch/commit | `codex/sec-003-legacy-bypass` / `7e62625a0344b5f42a533923d2669e827399367c` |
| Сравнение с `git show <source-sha>:<path>` | byte-identical |
| SHA-256 текущего файла | `f94f1701333fb384aa0fed67e157bdaae0eb91a618ae6b4299cbb569c05b756d` |
| Другие определения `bootstrap_health_intake` в SQL | отсутствуют |
| Новый migration-файл | не создавался |
| Изменение исходного migration-файла | отсутствует |

Файл содержит только:

1. `CREATE OR REPLACE FUNCTION`;
2. `REVOKE` на точной сигнатуре;
3. `GRANT EXECUTE` на точной сигнатуре;
4. `COMMENT ON FUNCTION`.

Он не создаёт повторно таблицы, индексы, triggers или policies и не выполняет patient DML во
время установки. `INSERT` выполняются только внутри тела RPC после будущего явного вызова.

## 4. Проверка сигнатуры

SQL объявляет один overload с 13 аргументами. JS вызывает то же имя и передаёт все аргументы
по именам (`lib/session/health-bootstrap.js:55-69`).

| SQL-параметр | Тип | Default | JS-источник |
| --- | --- | --- | --- |
| `p_session_id` | `text` | нет | fresh 128-bit `health_...` ID |
| `p_owner_id` | `uuid` | нет | fresh `crypto.randomUUID()` |
| `p_access_token_hash` | `text` | нет | SHA-256 нового 256-bit token |
| `p_lookup_code` | `text` | нет | Health continuation lookup |
| `p_secret_hash` | `text` | нет | HMAC-SHA256 continuation secret |
| `p_answers` | `jsonb` | нет | intake без client-supplied `session_id` |
| `p_bmi` | `numeric` | `NULL` | BMI либо `null` |
| `p_source` | `text` | `'self_signup'` | source fallback |
| `p_specialist_id` | `text` | `NULL` | specialist ID либо `null` |
| `p_specialist_name` | `text` | `NULL` | specialist name либо `null` |
| `p_display_name` | `text` | `NULL` | intake display name либо `null` |
| `p_goal` | `text` | `NULL` | intake goal либо `null` |
| `p_session_json` | `jsonb` | `'{}'::jsonb` | pilot metadata либо `{}` |

Возвращаемый контракт:

```text
TABLE(
  session_id text,
  anonymous_owner_id uuid,
  intake_id uuid,
  wallet_id uuid,
  access_token_hash text
)
```

`lib/session/health-bootstrap.js:80-89` проверяет точное совпадение session ID, owner и token
hash, а также наличие intake/wallet IDs. Raw access token и полный continuation credential
выдаются только после успешного receipt (`lib/session/health-bootstrap.js:91-101`).

## 5. Контроль безопасности

### 5.1 Function security

| Требование | Реализация | Результат |
| --- | --- | --- |
| Security mode | `SECURITY INVOKER` | PASS |
| Search path | `SET search_path = ''` | PASS |
| Schema qualification | все таблицы/helper имеют `public.` | PASS |
| `PUBLIC` execute | exact `REVOKE ALL` | PASS в источнике |
| `anon` execute | exact `REVOKE ALL` | PASS в источнике |
| `authenticated` execute | exact `REVOKE ALL` | PASS в источнике |
| `service_role` execute | exact `GRANT EXECUTE` | PASS в источнике |
| Дополнительные table grants | отсутствуют | PASS |
| `SECURITY DEFINER`/RLS bypass | отсутствует | PASS |

Такой режим соответствует официальным рекомендациям по ограничению database functions:
<https://supabase.com/docs/guides/database/functions>.

### 5.2 Фактические права вызывающей роли в Test

Узкий read-only запрос к `pg_catalog` подтвердил `allowed=true` для:

- `USAGE` на schema `public`;
- `INSERT` на `sessions`;
- `INSERT` на `body_clients`;
- `INSERT`, `SELECT` на `body_intake_forms` (`SELECT` нужен для `RETURNING id`);
- `INSERT` на `continuation_credentials`;
- `SELECT`, `INSERT`, `UPDATE` на `usage_wallets`;
- `INSERT` на `usage_ledger`;
- `EXECUTE` на `public.ensure_usage_wallet(text,uuid,text)`.

У `usage_ledger.id` подтверждён UUID default `gen_random_uuid()`; sequence grant не требуется.
Остальные поля, записываемые helper-функцией, присутствуют с ожидаемыми типами.

### 5.3 Атомарность и изоляция владельца

RPC одной функцией создаёт `sessions`, `body_clients`, `body_intake_forms`,
`continuation_credentials`, wallet и initial ledger row. Она не содержит `EXCEPTION` handler,
не подавляет ошибки и не обновляет существующие patient rows. Unique violation выходит наружу
как `23505`; JS ограниченно повторяет всю операцию с новым ID, owner, token и continuation
material.

SQL migration не содержит собственного `BEGIN/COMMIT`. Это правильно для runner, который
оборачивает migration и history insert в одну транзакцию. Нельзя выполнять statements вручную
по одному: между `CREATE FUNCTION` и `REVOKE` возникло бы окно default `PUBLIC EXECUTE`.

Логи `health-bootstrap.js:50-53,71-88` содержат только общий message/code и не выводят token,
hash, owner, lookup code или intake.

## 6. Анализ migration topology

### 6.1 Exact local/remote comparison

Read-only `list_migrations` и локальный filesystem дали:

- local versions: **54**;
- Test versions: **49**;
- local-only versions: **11**;
- remote-only versions: **6**;
- одна version с разным именем.

Шесть migration names присутствуют с разными timestamps:

| Migration name | Local version | Test version |
| --- | --- | --- |
| `practice_patient_profile_links` | `20261116082953` | `20261116090216` |
| `practice_booking_credit_payments` | `20261116084712` | `20261116090231` |
| `medical_encounters_a5` | `20261116173150` | `20261116173440` |
| `a38_unify_patient_specialist_links` | `20261117184606` | `20261117185604` |
| `a38_harden_link_rpc_grants` | `20261117185640` | `20261117185704` |
| `a38_preserve_support_client_identity` | `20261117193254` | `20261117193424` |

Version `20261106053005` имеет local name `my_practice_synthetic_workspaces`, а Test name
`my_practice_synthetic_workspaces_preview_only`.

После последней Test version `20261121133131` локально находятся пять незафиксированных Test
versions:

1. `20261122125416_my_practice_payment_modes.sql`;
2. `20261123070309_r232_production_clinical_base_a3_a5.sql`;
3. `20261123070333_r232_production_payments_disabled_booking.sql`;
4. `20261123114523_r233_fix_continuation_failed_attempt_rpcs.sql`;
5. `20261123223548_sec_003_health_bootstrap.sql`.

### 6.2 Почему обычный CLI push запрещён

Supabase CLI сравнивает versions в `supabase/migrations` с
`supabase_migrations.schema_migrations` и применяет pending migrations в timestamp-порядке:
<https://supabase.com/docs/guides/deployment/database-migrations>.

Установленный CLI `2.109.1` подтверждает, что `db push` и `migration up` не имеют флага
`--file`/`--version`; `--include-all` означает применение всех отсутствующих versions.
Следовательно:

- без `--include-all` команда либо остановится на history sync error, либо увидит минимум пять
  новых migrations после remote head;
- с `--include-all` она попытается включить все 11 local-only versions;
- ни один вариант не гарантирует единственную Health migration.

`supabase db push --dry-run` обязателен в будущем, но в текущей topology он не может дать
разрешённый one-file plan.

### 6.3 Почему MCP apply_migration также не разрешён

Текущий MCP tool принимает только `project_id`, `name`, `query`. Официальный Management API
также не принимает caller-supplied version:
<https://supabase.com/docs/reference/api/v1-apply-a-migration>.

Он создаёт server-generated timestamp. Это не будет локальная version `20261123223548` и
оставит репозиторный файл pending. Ограничение version-preservation зафиксировано и в открытом
issue официального MCP repository:
<https://github.com/supabase/mcp/issues/241>.

Поэтому запрещены:

- MCP `apply_migration` в текущем виде;
- SQL Editor/`execute_sql` для DDL;
- ручной INSERT/UPDATE в `supabase_migrations.schema_migrations`;
- `migration repair` после direct SQL;
- временное удаление/перемещение остальных migration-файлов;
- blind `db push --include-all`.

### 6.4 Условие разблокировки

Нужен отдельный review истории, который законно приведёт local и Test history к одному
version-set без ложной маркировки неприменённого SQL. После него допустимое состояние должно
быть таким:

- все существующие local/remote versions совпадают;
- единственная local-only version — `20261123223548`;
- `db push --dry-run` показывает ровно один файл и exact target ref;
- ни один A3/A5, payment или rate-limit файл не попадает в plan.

Как именно исправлять уже существующие timestamp/name расхождения, в scope этого задания не
входит. До отдельного утверждённого плана нельзя переименовывать файлы или менять remote ledger.

## 7. Перечень зависимостей

| Зависимость | Требование | Статус Test |
| --- | --- | --- |
| `public.sessions` | нужные columns/defaults + unique session/public code | PASS |
| `public.body_clients` | session/owner/profile columns + unique session | PASS |
| `public.body_intake_forms` | UUID id default, answers/BMI/source fields | PASS |
| `public.continuation_credentials` | owner/lookup uniqueness + module-owner check | PASS |
| `public.usage_wallets` | canonical owner/module uniqueness | PASS |
| `public.usage_ledger` | helper insert columns and UUID default | PASS |
| `public.ensure_usage_wallet(text,uuid,text)` | invoker, empty path, service-role-only execute | PASS |
| `idx_sessions_session_id_unique` | collision produces `23505` | PASS |
| `CONTINUATION_SECRET_PEPPER` | server-side generation dependency before RPC call | вне SQL; runtime gate уже подготовлен |

SQL не зависит от consolidated A3/A5 objects и не должен запускать их миграции.

## 8. План применения только в Supabase Test

Ниже — условная инструкция. Её нельзя выполнять, пока не выполнено условие раздела 6.4 и не
получено отдельное разрешение оператора.

### 8.1 Preflight и recovery point

1. Зафиксировать target: `eehyehlhiyztciaezaus`, имя `Tochka-Opori-Preview-Test`.
2. Проверить, что Production ref `blwogrdezfhprdpdnxtn` нигде не выбран.
3. В Supabase Dashboard → Database → Backups подтвердить время последнего успешного backup и
   доступный способ восстановления. Для PITR зафиксировать точное pre-migration restore time.
4. Если Test plan не предоставляет свежий backup/PITR, остановиться до отдельно разрешённого
   logical backup. Официальные варианты восстановления описаны здесь:
   <https://supabase.com/docs/guides/platform/backups>.
5. Использовать совместимый, явно pinned Supabase CLI. Текущий локальный `2.109.1` запускается
   с предупреждением об отсутствии AVX; до write-этапа заменить его совместимой baseline-сборкой
   или иным официальным поддерживаемым бинарником.
6. Аутентификацию выполнять оператору приватно. PAT/database password не передавать аргументом,
   не выводить и не сохранять в репозитории.
7. Повторить read-only catalog/history/privilege checks и подтвердить, что RPC всё ещё
   отсутствует.
8. Проверить hash файла:
   `f94f1701333fb384aa0fed67e157bdaae0eb91a618ae6b4299cbb569c05b756d`.

### 8.2 Version-preserving dry run

После отдельного history reconciliation использовать официальный CLI path, а не MCP
`apply_migration`. Для актуального CLI v3 target должен задаваться явно:

```bash
DO_NOT_TRACK=1 supabase migration list --remote=eehyehlhiyztciaezaus
DO_NOT_TRACK=1 supabase db push --remote=eehyehlhiyztciaezaus --dry-run
```

Разрешающий результат dry-run: ровно
`20261123223548_sec_003_health_bootstrap.sql`. Любой второй файл, history warning, иной ref или
неоднозначный output означает `STOP`.

### 8.3 Единственное применение

Только после положительного dry-run и отдельного разрешения:

```bash
DO_NOT_TRACK=1 supabase db push --remote=eehyehlhiyztciaezaus
```

Не использовать `--include-all`, seed, roles, `--yes` или повторный автоматический retry.
Оператор должен вручную подтвердить exact project и единственный файл в prompt.

При network/CLI timeout результат считается неопределённым. Не повторять push, пока read-only
history и `pg_catalog` не покажут, был ли commit завершён.

### 8.4 Проверка migration history

После success:

- version `20261123223548` присутствует ровно один раз;
- name — `sec_003_health_bootstrap`;
- previous 49 Test entries не изменены;
- нет новых A3/A5/payment/rate-limit migrations;
- локальный и remote migration list не содержит новых расхождений.

## 9. Post-Migration Acceptance Checklist

До Preview deployment выполнить в указанном порядке:

- [ ] `pg_catalog.pg_proc` возвращает ровно один `public.bootstrap_health_intake`.
- [ ] Identity arguments точно равны 13 ожидаемым типам.
- [ ] Return type содержит пять ожидаемых полей и типов.
- [ ] `prosecdef=false` (`SECURITY INVOKER`).
- [ ] `proconfig` содержит пустой `search_path`.
- [ ] `service_role` имеет `EXECUTE`.
- [ ] `PUBLIC`, `anon`, `authenticated` не имеют effective `EXECUTE`.
- [ ] PostgREST schema cache видит RPC; при `PGRST202` выполнить только отдельно разрешённый
  `NOTIFY pgrst, 'reload schema'` и повторить metadata/RPC check.
- [ ] Вызов с `anon` и `authenticated` отклоняется до выполнения функции.
- [ ] Service-role synthetic bootstrap возвращает согласованный receipt.
- [ ] Созданы ровно session, client, intake, credential, wallet и initial ledger row.
- [ ] Artificial session/lookup collision не изменяет существующие rows.
- [ ] Два параллельных bootstrap через независимые соединения не разделяют owner/session.
- [ ] Ошибка на позднем шаге оставляет ноль частичных rows.
- [ ] Повторный вход по полному continuation credential работает.
- [ ] Неверные module/owner/token/session отклоняются.
- [ ] Миграционная история содержит только одну новую version.
- [ ] Production history/schema/deployment не изменялись.

Все проверки используют только синтетические identifiers/content. Возвращённые IDs необходимо
записать в локальный ephemeral test manifest без token/secret. Cleanup допускается отдельной
транзакцией только по exact IDs и только после count/assertion проверки; при неожиданном count
cleanup откатывается. Общие predicates и wildcard delete запрещены.

## 10. Rollback Plan

Migration install сама не создаёт patient rows. После реальных RPC-вызовов rollback функции не
должен удалять созданные sessions, intake, wallets или credentials: это предотвращает потерю
данных и необратимую блокировку существующих пользователей.

Rollback выполняется только отдельной forward migration после проверки зависимостей:

```sql
DROP FUNCTION IF EXISTS public.bootstrap_health_intake(
  text, uuid, text, text, text, jsonb, numeric,
  text, text, text, text, text, jsonb
) RESTRICT;
```

Перед применением:

1. Через `pg_catalog.pg_depend` убедиться, что нет неожиданных dependent objects.
2. Подтвердить exact identity arguments; не использовать name-only drop.
3. Не использовать `CASCADE`.
4. Выполнить drop и запись новой rollback migration одной транзакцией через тот же
   version-preserving runner.
5. Проверить отсутствие функции и безопасный fail-closed HTTP 500 нового Health bootstrap.
6. Оставить уже созданные пользовательские rows без изменений.

Не использовать Management API `DELETE .../database/migrations?gte=...`: оно может затронуть
все более новые migrations. Не удалять migration-history row вручную. Синтетические E2E rows,
если их очистка нужна, удаляются отдельной процедурой по сохранённым exact IDs и не являются
частью schema rollback.

## 11. Результаты локальных проверок

| Проверка | Результат |
| --- | --- |
| Branch / HEAD | PASS: exact branch и базовый SHA |
| Source migration comparison | PASS: byte-identical source commit |
| Migration SHA-256 | PASS: зафиксирован |
| Duplicate SQL definitions | PASS: один migration definition |
| Повторные table/index/trigger DDL | PASS: отсутствуют |
| SQL ↔ JS RPC contract | PASS: имя, 13 args, defaults, return fields |
| `node --check lib/session/health-bootstrap.js` | PASS |
| `npm --silent run test:sec-003` | PASS |
| `npm --silent run test:sec-003-fix2` | PASS; PGlite transaction, collision, barrier concurrency |
| Test service-role privileges | PASS: все минимально необходимые права присутствуют |
| `git diff --check` + отдельная no-index проверка нового отчёта | PASS |
| Staged files | 0 |
| CLI capability | BLOCKED для write: v2.109.1, нет single-file flag, AVX warning |
| Migration topology | BLOCKED: local/remote version sets расходятся |

Локальные тесты использовали только синтетическую in-memory/PGlite схему. Remote RPC и
миграция не запускались.

## 12. Перечень изменённых файлов

В рамках этого задания создан только:

- `docs/releases/SEC-003-HEALTH-TARGETED-MIGRATION-PREP.md`.

Миграция `20261123223548_sec_003_health_bootstrap.sql`, функциональный JS и остальные ранее
подготовленные файлы не изменялись. Commit/staging не выполнялись.

## 13. Остаточные риски

| Риск | Уровень | Требуемое действие |
| --- | --- | --- |
| Нелинейная local/Test migration history | BLOCKER | отдельный history reconciliation review |
| MCP/API не сохраняет caller-supplied version | BLOCKER для MCP path | не использовать до поддержки version или согласованной стратегии |
| CLI plan включает более одной pending migration | BLOCKER | dry-run должен стать one-file после reconciliation |
| Backup/PITR Test на момент будущего запуска не подтверждён | HIGH operational | подтвердить restore point до write |
| Текущий CLI binary предупреждает об AVX | MEDIUM operational | использовать совместимую pinned сборку |
| Фактическая RPC/ACL/PostgREST ещё не установлены | ожидаемо | post-migration catalog acceptance |
| Connected atomicity/concurrency ещё не проверена | ожидаемо | synthetic Connected Test после миграции |
| E2E cleanup может затронуть не те rows при широком predicate | HIGH при ошибке | exact IDs, assertions, отдельная транзакция |

## 14. Итоговый вердикт

**MIGRATION PREPARATION BLOCKED**

SQL корректен и готов как migration artifact, зависимости и права подтверждены, но критическое
требование безопасной регистрации единственной version `20261123223548` сейчас невыполнимо без
отдельного reconciliation migration history. Применение через CLI, MCP, Management API, SQL
Editor или history repair в текущем состоянии запрещено.

Следующий разрешённый этап — отдельный read-only/history-reconciliation design review. До его
завершения не выполнять migration, commit, push, merge, deploy или изменения Supabase.
