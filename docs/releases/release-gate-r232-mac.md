# Release Gate R2.3.2-L-Mac

Дата проверки: 2026-11-23 (Europe/Moscow)
Репозиторий: `/Users/macintosh/Documents/ChatGPT/Точка опоры`
Ветка: `feature/my-practice-a3-patient-cabinet`
Контрольный SHA: `7a1c66d33267181355e16f69c0b7ee37e66b200b`

## Итог

| Gate | Решение | Основание |
| --- | --- | --- |
| Локальная репетиция Production → A3/A5 | **GO** | Две независимые чистые локальные базы прошли одинаковую forward-only последовательность, синтетические старые клинические данные сохранились, итоговые структурные отпечатки совпали, RLS/ACL, межклинические проверки, конкурентная запись и `payments_disabled` прошли. |
| Production Release Gate | **NO-GO** | В Production-baseline воспроизведён runtime-дефект двух RPC rate-limit продолжения; не подтверждены backup/PITR и план окна изменений; история миграций расходится с Git; локальный образ имеет иной build patch; Production не изменялась и разрешение на релиз не выдавалось. |

Это решение означает только техническую доказанность локального перехода структуры Production к подготовленному клиническому пакету. Оно не разрешает `db push`, deploy или ручное применение SQL в Production.

## 1. Исходные материалы и ограничения

Прочитаны предыдущие отчёты:

- `docs/releases/release-gate-r2.md`;
- `docs/releases/release-gate-r21.md`;
- `docs/releases/release-gate-r22.md`;
- `docs/releases/release-gate-r231.md`.

Отдельный файл диагностического отчёта R2.3.2-L в рабочем дереве и доступных вложениях текущего задания не найден. Его отсутствие не подменялось предположениями: необходимые структурные метаданные Production были заново получены read-only запросами.

Соблюдённые запреты:

- не выполнялись commit, push, merge и deploy;
- не изменялись Production Supabase, Test Supabase, Vercel и GitHub;
- не создавался облачный clone/branch и не восстанавливался реальный backup;
- не читались строки прикладных таблиц Production, Auth credentials, Vault secrets или реальные медицинские данные;
- не вызывались внешние медицинские, платёжные или уведомительные API;
- не применялся `supabase db reset`;
- существующий локальный Supabase stack `Tochka-Opori` не останавливался, не сбрасывался и не модифицировался.

## 2. Состояние Git

Перед работой:

- ветка: `feature/my-practice-a3-patient-cabinet`;
- HEAD: `7a1c66d33267181355e16f69c0b7ee37e66b200b`;
- рабочее дерево: чистое;
- upstream: `origin/feature/my-practice-a3-patient-cabinet`.

После работы HEAD и ветка не изменились. В рабочем дереве находятся только новые незакоммиченные артефакты этой проверки в `scripts/release-gate-r232/`, две новые миграции и настоящий отчёт. Commit не создавался.

## 3. Локальная среда

| Компонент | Фактическое состояние |
| --- | --- |
| ОС | macOS 27.2.1, build 26B131; Darwin 27.2.0 arm64 |
| Colima | запущена через macOS Virtualization.Framework; `aarch64`; runtime Docker; `virtiofs` |
| Docker | client 29.10.0/arm64; server 29.5.2/arm64; context/socket Colima |
| Supabase CLI | 2.109.1, x64/Rosetta; команды версии и создания локальных migration-файлов работоспособны |
| Предупреждение CLI | Bun 1.3.13 сообщает `CPU lacks AVX support, strange crashes may occur`; это зафиксировано как риск инструмента |
| Production PostgreSQL | 17.6.1.127, engine 17, проект `blwogrdezfhprdpdnxtn`, `ACTIVE_HEALTHY` |
| Локальный PostgreSQL | образ `public.ecr.aws/supabase/postgres:17.6.1.143`, PostgreSQL 17.6, linux/arm64 |

Локальный образ уже присутствовал до репетиции. Существующий stack содержит, в частности, здоровый `supabase_db_Tochka-Opori` на том же образе и остальные сервисы Supabase. Все они остались запущены с прежними именами; команды `supabase start`, `stop`, `db reset`, `db push` и `link` не выполнялись.

### Сетевая и проектная изоляция

Создана отдельная сеть:

```text
name=r232_rehearsal_net_7a1c66d
driver=bridge
internal=true
attachable=false
scope=local
subnet=172.19.0.0/16
```

Финальные контейнеры:

- `r232_prod_a_7a1c66d`;
- `r232_prod_b_7a1c66d`;
- `r232_testcredits_7a1c66d`.

У всех отсутствует опубликованный host-порт; `5432/tcp` доступен только внутри Docker. Данные PostgreSQL размещены на `tmpfs`. В контейнеры не передавались `SUPABASE_ACCESS_TOKEN`, `SUPABASE_URL`, `SUPABASE_DB_URL`, `DATABASE_URL`, `PGHOST` или облачные project refs. В `supabase/.temp` отсутствует `project-ref`. Рабочая Production/Test конфигурация не использовалась для локальных подключений.

Попытка `supabase db lint --db-url` с явно выключенной телеметрией не смогла подключиться именно из-за отсутствия host-порта. Ослаблять сетевую изоляцию ради lint не стали. Это ограничение отмечено отдельно; SQL фактически парсился и исполнялся PostgreSQL, а структурные и security-инварианты проверялись каталогом и runtime-тестами.

## 4. Источник Production baseline

Источник: live Production `blwogrdezfhprdpdnxtn`, только read-only запросы к системным каталогам `pg_catalog`, `information_schema`, списку миграций и Supabase Advisors. Прикладные строки не выбирались.

Сняты и проверены:

- версия PostgreSQL и статусы проекта;
- таблицы/последовательности/views, колонки и defaults;
- constraints, indexes, triggers;
- RLS flags и policies;
- определения функций через `pg_get_functiondef` и function ACL;
- table grants;
- установленные extensions и их схемы;
- история миграций.

Production содержит:

- 62 relations в `public` с учётом sequences;
- 1004 колонки;
- 333 constraints;
- 282 indexes;
- 14 policies;
- 37 функций;
- 27 пользовательских triggers;
- 1367 table-grant записей;
- 81 function-ACL запись;
- 4 расширения помимо `plpgsql`.

Расширения Production:

| Extension | Версия | Схема |
| --- | --- | --- |
| `pg_stat_statements` | 1.11 | `extensions` |
| `pgcrypto` | 1.3 | `extensions` |
| `supabase_vault` | 0.3.1 | `vault` |
| `uuid-ossp` | 1.1 | `extensions` |

`btree_gist` в Production сейчас отсутствует. Целевая миграция устанавливает его явно в `extensions`, чтобы не добавлять служебные функции расширения в `public`.

Текущие read-only Advisors Production:

- security: [`rls_enabled_no_policy`](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) — 48, level INFO;
- performance: [20 unindexed foreign keys](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys), 1 [`auth_rls_initplan`](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan) WARN, [96 unused indexes](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index), 1 [`auth_db_connections_absolute`](https://supabase.com/docs/guides/deployment/going-into-prod) INFO;
- health: замечаний нет.

48 таблиц с RLS без policies соответствуют существующей fail-closed модели с backend/service-role доступом, но сами по себе не доказывают корректность каждого server-side authorization path. Новые клинические таблицы проверялись отдельно.

## 5. Production ↔ Git

### История миграций

В Production зарегистрировано 33 миграции. Для локального baseline применены соответствующие 33 SQL-файла из Git, после чего добавлен отдельный **local-only** alignment по live-каталогу.

| Группа | Production | Git | Статус |
| --- | --- | --- | --- |
| Базовая цепочка | 20260814000000…20260826131822 | одноимённые 27 файлов | совпадает по версиям/именам |
| `add_save_request_id_to_body_daily_logs` | `20261005071922` | `scripts/migrations/add-save-request-id-to-body-daily-logs.sql` | логически сопоставлен; файл находится вне `supabase/migrations` |
| medication layers | `20261005123149`, `20261005234912` | одноимённые файлы | совпадают |
| link match request | `20261021072023` | `20261021000822` | timestamp drift |
| shared org scope | `20261026064902` | `20261026062744` | timestamp drift |
| partner test accruals | `20261027112618` | `20261027062352` | timestamp drift |
| Более поздние A3/A5/test migrations | отсутствуют | присутствуют в Git | не переносились автоматически в Production-пакет |

Из-за timestamp drift стандартный `supabase db push` не считается допустимой стратегией Production-релиза.

### Каталожная идентичность локального baseline

| Категория | Production | Локальный baseline A/B | Статус |
| --- | --- | --- | --- |
| relations | `62 / 0f330bf34f641cd924c840fe8e8696a4` | то же | exact |
| columns | `1004 / 4c351986720bd4e9f1cb682d76e22f76` | `1004 / 85f7f0c21e57b8931a9509190e442eb6` | документированное исключение |
| constraints | `333 / fd12c1ce09f4f75185ccb261d1a45642` | то же | exact |
| indexes | `282 / b521ae7fd39dd2a86a91aba4d34ae486` | то же | exact |
| policies | `14 / 7bc3cd0d4974f5c10d7b535083c8d8db` | то же | exact |
| functions | `37 / c2cb4ba8327aefbcf2dac82324eca869` | то же | exact |
| triggers | `27 / fb6fb8f547b24af89852c87aeec728c2` | то же | exact |
| table grants | `1367 / 93076ee98ac4ebb7d15be736798440d3` | то же | exact |
| function ACL | `81 / e8641f6248a65b962bc6628d83f04bb0` | то же | exact |
| extensions | `4 / 61bf0bbc2f67773bf6058288f23cc27a` | то же | exact |

Единственное расхождение `columns` вызвано физическим `attnum`/порядком колонок в `body_intake_forms` и `body_weekly_summaries`. Для обеих таблиц отдельно подтверждены одинаковые наборы имён, типов, nullability, defaults и constraints. A3/A5 эти таблицы не изменяет и не использует positional inserts, поэтому исключение принято для локальной репетиции. Оно не объявлено общим разрешением на будущие миграции.

Файл `scripts/release-gate-r232/production-baseline-local-alignment.sql` нужен только для точного воспроизведения уже существующего live-каталога. Он не является Production migration и не должен применяться в облаке.

## 6. Целевая forward-only последовательность A3/A5

Фактически применены после подтверждения baseline и изоляции:

1. `supabase/migrations/20261123070309_r232_production_clinical_base_a3_a5.sql`
   SHA-256: `d15a95e83a084b131b2e2a62d880388a4255efe2698a6d53f9dd8960587ec436`
2. `supabase/migrations/20261123070333_r232_production_payments_disabled_booking.sql`
   SHA-256: `9b368f03d13bc7a7f7fa43827f7b67bdda9186ed7e71d1cf3e4f4b9ba87c0fef`

Первая миграция создаёт клиническую поверхность:

- `practice_places`;
- `practice_services`;
- `practice_availability`;
- `practice_bookings`;
- `practice_events`;
- `practice_patient_profile_links`;
- `medical_encounter_versions`;
- необходимые функции, constraints, indexes, triggers, RLS и service-role-only ACL;
- `btree_gist` в схеме `extensions`.

Вторая миграция добавляет durable статус `requested`, half-open exclusion для `requested/held/confirmed` и service-role-only RPC создания/отмены запроса без оплаты.

Пакет намеренно не создаёт и не изменяет:

- `practice_booking_credits`;
- `practice_payments`;
- `practice_commissions`;
- test-credit RPC;
- реальные платёжные интеграции;
- synthetic workspace tables.

## 7. Синтетические fixtures

До целевых миграций в каждой Production-репетиции созданы только синтетические данные:

- 2 клиники;
- 3 врача;
- memberships в двух организациях;
- 3 patient assignments;
- 1 additional patient access;
- 2 старых `clinical_events`;
- 2 старых `clinical_observations` с разными организациями.

Идентификаторы фиксированы и имеют префикс/значения R2.3.2. Контакты, имена реальных людей и реальные медицинские тексты отсутствуют.

## 8. Результаты тестов

| Проверка | База A | База B | Результат |
| --- | --- | --- | --- |
| Чистый `public` перед baseline | 0 relations | 0 relations | PASS |
| Production baseline + local alignment | применён | применён | PASS |
| Baseline fingerprints | как в разделе 5 | идентичны A | PASS |
| Обе target migrations | применены | применены | PASS |
| Сохранность клиник/врачей/patient links | без изменений | без изменений | PASS |
| Сохранность старых clinical records | 2 observations | 2 observations | PASS |
| RLS включён на 7 новых таблицах | да | да | PASS |
| Прямой `anon`/`authenticated` read | permission denied | permission denied | PASS |
| `service_role` доступ/RPC | разрешён | разрешён | PASS |
| Function `search_path` | `search_path=""` у 11 функций | то же | PASS |
| Function ACL | только owner/service role; trigger-only без service execute | то же | PASS |
| Межклиническая запись | отклонена | отклонена | PASS |
| Межклиническая medical revision | отклонена | отклонена | PASS |
| Immutable medical versions | версии 1 и 2 сохранены | то же | PASS |
| `payments_disabled` request | `requested`, idempotent | то же | PASS |
| Wallet/ledger mutation | отсутствует | отсутствует | PASS |
| Unpaid cancellation | без payment/refund | то же | PASS |
| Overlap | отклонён | отклонён | PASS |
| Смежные `[start,end)` интервалы | разрешены | разрешены | PASS |
| Реальная конкуренция двух sessions | 1 commit + 1 exclusion violation | то же | PASS |
| Итоговые fingerprints | идентичны | идентичны | PASS |

### Итоговый каталог A/B

Обе базы дали одинаковый результат:

| Категория | Count | Fingerprint |
| --- | ---: | --- |
| columns | 1072 | `1ed7c81c26b10ebc8e9e5533405d841d` |
| constraints | 376 | `31fe483a9c77889800f3e5ef4129ade6` |
| extensions | 5 | `96b62911ec05a0a6342ac2f6e5eb08b4` |
| function ACL | 99 | `d8048f7afa4a475ce198ce0cfa57422a` |
| functions | 47 | `d94d12767fabcab1a03b4dc8eed01153` |
| indexes | 304 | `81061f46ae0b480933f4efc9d0d6af79` |
| policies | 14 | `7bc3cd0d4974f5c10d7b535083c8d8db` |
| relations | 71 | `cb402613b6f299d9c7d48af675e41e9e` |
| table grants | 1456 | `1062e1c0a3a60c3d77f5b6ac2ba7555a` |
| triggers | 30 | `03d561cb6e3e20a19bb1b5d0006e1a72` |

71 relations = 62 baseline + 7 таблиц + 2 identity sequences.

### Отдельный `test_credits`

В третьем контейнере, не являющемся Production baseline, применены 50 исходных Git-миграций до новых R2.3.2 файлов. Все данные синтетические.

Проверено:

- баланс 50000 test credits;
- atomic debit 10000 → баланс 40000;
- повтор с тем же idempotency key не списывает второй раз;
- отмена с fee 0 возвращает баланс 50000;
- ровно одна debit и одна refund ledger entry;
- один credit snapshot;
- `practice_payments` = 0 строк;
- `practice_commissions` = 0 строк;
- `anon` не имеет execute; `service_role` имеет execute.

Результат: `PASS credit_snapshots=1 wallet_ledger_rows=2 final_balance=50000`.

Этот контур не включён в Production-пакет и не использовался как Production baseline.

### Financial mode и приложение

- `npm run test:practice-financial-mode`: PASS;
- Production default: `payments_disabled`;
- `test_credits` в Production: `TEST_CREDITS_FORBIDDEN_IN_PRODUCTION`;
- `real_payments`: `REAL_PAYMENTS_NOT_IMPLEMENTED`;
- `npm run build`: PASS, включая полный набор A3/A5/My Practice/medical-record тестов;
- Vite оставил только неблокирующее предупреждение о chunk > 500 kB.

## 9. Обнаруженные ошибки и ограничения

### 9.1 Блокирующий pre-existing дефект Production baseline

Live Production definitions функций:

- `public.increment_continuation_failed_attempts(text)`;
- `public.clear_continuation_failed_attempts(text)`

содержат `SET search_path TO ''`, но внутри обращаются к `continuation_failed_attempts` без `public.`. На локальном exact baseline обе функции воспроизводимо падают:

```text
ERROR: relation "continuation_failed_attempts" does not exist
```

API вызывает эти RPC в exchange continuation credential. Это существующий дефект baseline, не созданный A3/A5, но он блокирует Production Release Gate до отдельного исправления и ручной проверки rate-limit/indistinguishability. Исправление не следует незаметно смешивать с клиническими миграциями.

### 9.2 История миграций

Три Production version timestamp расходятся с Git, а один SQL-файл лежит вне стандартной migration directory. Нельзя полагаться на автоматическое определение pending migrations без согласованной стратегии reconciliation.

### 9.3 Версии PostgreSQL image

Production сообщает build 17.6.1.127, локально использован image 17.6.1.143. Major/minor PostgreSQL совпадает (17.6), но точный platform build не идентичен. Для Production approval требуется оценить release notes/совместимость точного build или повторить на официально сопоставимом clone, если он станет разрешён.

### 9.4 Отсутствующая эксплуатационная информация

В рамках этой локальной задачи не подтверждены:

- актуальный recoverable backup/PITR и проверка восстановления;
- допустимое окно DDL/lock budget;
- monitoring/rollback runbook;
- owner approval на применение двух SQL-файлов;
- стратегия внесения `btree_gist` в Production и rollback-forward при ошибке.

### 9.5 CLI lint

Supabase CLI работает, но использует x64 Bun с AVX warning. `db lint` не был выполнен, потому что контейнеры намеренно не имеют host-порта, а сетевую изоляцию не ослабляли. Фактическое исполнение SQL, catalog assertions, ACL tests и runtime tests прошло; отсутствие CLI lint остаётся ограничением, а не скрытым PASS.

### 9.6 Ограничения модели данных теста

Репетиция не содержит production row volume, реального распределения данных, длительных транзакций, фоновой нагрузки или статистики lock contention. Она доказывает корректность структуры, constraints и синтетических переходов, но не доказывает production-time performance.

## 10. Решение и условия следующего шага

### Локальная репетиция: GO

Forward-only переход от подтверждённой структуры Production к A3/A5 повторён дважды с одинаковым результатом. Платёжные test tables не попали в пакет, `payments_disabled` не меняет wallets, конкурентная запись защищена PostgreSQL constraint, а прямой доступ внешних ролей закрыт.

### Production Release Gate: NO-GO

До отдельного Production approval необходимо:

1. Исправить и отдельно проверить две continuation rate-limit RPC с полностью квалифицированными именами.
2. Подтвердить backup/PITR и практический recovery plan.
3. Согласовать reconciliation трёх timestamp drift и запретить автоматический `db push` без этого плана.
4. Согласовать точную forward-only команду применения только двух R2.3.2 миграций.
5. Зафиксировать lock/maintenance window и мониторинг для `CREATE EXTENSION`, tables, indexes и exclusion constraint.
6. Получить явное разрешение на Preview/Production; текущая работа такого разрешения не даёт.

## 11. Артефакты воспроизведения

- `scripts/release-gate-r232/catalog-fingerprint.sql`;
- `scripts/release-gate-r232/production-baseline-local-alignment.sql` — **local only, never deploy**;
- `scripts/release-gate-r232/pre-migration-fixtures.sql`;
- `scripts/release-gate-r232/post-migration-tests.sql`;
- `scripts/release-gate-r232/test-credits-synthetic.sql`;
- `scripts/release-gate-r232/run-production-rehearsal.sh`;
- `scripts/release-gate-r232/test-concurrent-booking.sh`;
- две target migrations из раздела 6.

Секреты, `.env`, реальные пользовательские строки и выгрузки Production в артефакты не включены.
