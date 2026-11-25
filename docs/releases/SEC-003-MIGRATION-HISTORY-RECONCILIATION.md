# SEC-003 — Migration History Reconciliation

- Дата проверки: 2026-11-25
- Режим: **STRICT READ-ONLY**
- Интеграционная ветка: `codex/sec-003-a3a5-integration`
- HEAD: `2f05e9f282c51e50b15aac9c3197164eb3a21f6f`
- Supabase Test: `eehyehlhiyztciaezaus`
- Production `blwogrdezfhprdpdnxtn`: **не опрашивался и не изменялся**

## 1. Executive Summary

Локальная директория содержит 54 migration versions, история Supabase Test — 49.
Подтверждены 43 общие версии, 11 local-only, 6 remote-only и одно расхождение
имени при одинаковой версии. Все 17 version-разногласий установлены и
классифицированы без чтения строк прикладных таблиц:

| Категория | Количество | Версии |
| --- | ---: | --- |
| A — эквивалентное целевое состояние уже присутствует | 3 | `20261117184606`, `20261117185604`, `20261123114523` |
| B — тот же SQL зарегистрирован под другим timestamp | 10 | пять локальных и пять удалённых сторон точных пар |
| C — изменение действительно отсутствует | 2 | `20261122125416`, `20261123223548` |
| D — migration заменена или неприменима в Test-потоке | 2 | `20261123070309`, `20261123070333` |
| E — состояние неизвестно | 0 | — |

Ключевые выводы:

- пять пар timestamp drift совпадают побайтно по SHA-256;
- шестая пара A3.8 не побайтна: удалённый SQL отличается ровно двумя более
  узкими `REVOKE ... FROM public`, но следующая уже применённая hardening
  migration побайтно совпадает и фактический ACL закрыт для `anon` и
  `authenticated`;
- Production-консолидация R2.3.2 **не должна применяться к Test**: семь её
  таблиц уже существуют, Test имеет дополнительную credit-схему, а один из
  ожидаемых checks (`practice_bookings_owner_type_check`) отсутствует;
- payments-disabled состояние в Test отсутствует: status `requested`, два RPC
  и соответствующий exclusion predicate не установлены;
- целевой эффект R2.3.3 уже присутствует в Test из baseline: обе continuation
  RPC используют `public.continuation_failed_attempts` при `search_path=''`;
- `public.bootstrap_health_intake` отсутствует, одноимённых overloads нет,
  зависимости и права `service_role` присутствуют;
- после согласованного исправления **локального набора файлов**, без ложной
  правки remote ledger, Health migration может стать единственной pending
  migration и быть зарегистрирована штатным runner вместе с фактическим
  применением SQL.

Официальная документация подтверждает, что CLI сравнивает timestamps из
`supabase/migrations` с `supabase_migrations.schema_migrations` и запускает
pending migrations по порядку; `migration repair` меняет только tracking
table, но не выполняет SQL: [Deploy database migrations](https://supabase.com/docs/guides/deployment/database-migrations),
[CLI reference](https://supabase.com/docs/reference/cli/supabase-config).

В ходе проверки выполнялись только локальные read-only Git/filesystem-команды
и `SELECT` к `pg_catalog`/`supabase_migrations` Test. DDL, DML, RPC-вызовы,
миграции и обращения к Production отсутствовали. До создания этого отчёта в
worktree было 17 tracked modified и 19 untracked файлов; ни один из них не
изменён этой проверкой.

## 2. Local Migration Inventory

Источник: `supabase/migrations/*.sql`; 54 файла. Имена ниже приведены полностью.
Raw-file SHA-256 для всех 11 local-only приведены в разделе 4. Для общих
версий SHA не используется как доказательство эквивалентности с ledger:
Supabase хранит массив statements, и concatenated-ledger hash для
многооператорного файла не обязан равняться hash исходных bytes.

```text
20260814000000 production_baseline
20260814010000 security_hardening
20260814020000 performance_hardening
20260816000000 specialist_module_entitlements
20260817000000 support_pricing
20260818000000 patient_specialist_linking
20260819000000 accept_invitation_rpc
20260821000000 harden_specialist_invitation_accept
20260821010000 scope_owner_accept
20260821133103 health_body_pricing
20260821155003 service_request_financial_lifecycle
20260824083854 harden_service_request_financial_grants
20260825085627 harden_accept_specialist_invitation_grants
20260825134958 clinical_data_layer_c1_foundation
20260825143903 clinical_data_layer_c1_reference_hardening
20260825154115 clinical_c1_1_observation_idempotency
20260825172224 clinical_c1_1_1_observation_owner_identity_hardening
20260826095017 c2_v0_1_medication_order_foundation
20260826102004 c2_v0_1_medication_function_security_hardening
20260826102252 c2_v0_1_schedule_constraint_hardening
20260826104426 c2_v0_1_mutation_consistency_hardening
20260826111542 c2_v0_1_revoke_idempotency_hardening
20260826111916 c2_v0_1_schedule_completeness_hardening
20260826112815 c2_v0_1_indefinite_schedule_hardening
20260826113620 c2_v0_1_schedule_open_phase_fix
20260826114920 c2_v0_1_global_lifecycle_idempotency_guard
20260826131822 c2_v0_1_medication_concept_snapshot_binding
20261005123149 patient_reported_medication_orders
20261005234912 medication_reference_layer
20261021000822 link_match_request_to_session
20261026062744 pneumointegration_shared_org_scope
20261026080000 backfill_partner_request_tenant_columns
20261027062352 partner_test_accruals
20261028020916 live_test_budget
20261106053005 my_practice_synthetic_workspaces
20261107150430 partner_twenty_percent
20261109120000 my_practice_bookings_a2
20261109130000 my_practice_bookings_a2_corrective
20261109140000 my_practice_bookings_a2_ttl_semantics
20261110022907 my_practice_bookings_a2_hardening
20261116082953 practice_patient_profile_links
20261116084712 practice_booking_credit_payments
20261116173150 medical_encounters_a5
20261117184606 a38_unify_patient_specialist_links
20261117185640 a38_harden_link_rpc_grants
20261117193254 a38_preserve_support_client_identity
20261121081127 a381_default_practice_availability
20261121083234 a381_scope_booking_availability
20261121133131 a382_practice_service_modules
20261122125416 my_practice_payment_modes
20261123070309 r232_production_clinical_base_a3_a5
20261123070333 r232_production_payments_disabled_booking
20261123114523 r233_fix_continuation_failed_attempt_rpcs
20261123223548 sec_003_health_bootstrap
```

## 3. Supabase Test Migration Inventory

Источник: read-only `SELECT` из
`supabase_migrations.schema_migrations`; 49 записей. Ниже указаны version и
зарегистрированное remote name. Для шести remote-only записей ledger SQL hash
приведён в разделе 5.

```text
20260814000000 production_baseline
20260814010000 security_hardening
20260814020000 performance_hardening
20260816000000 specialist_module_entitlements
20260817000000 support_pricing
20260818000000 patient_specialist_linking
20260819000000 accept_invitation_rpc
20260821000000 harden_specialist_invitation_accept
20260821010000 scope_owner_accept
20260821133103 health_body_pricing
20260821155003 service_request_financial_lifecycle
20260824083854 harden_service_request_financial_grants
20260825085627 harden_accept_specialist_invitation_grants
20260825134958 clinical_data_layer_c1_foundation
20260825143903 clinical_data_layer_c1_reference_hardening
20260825154115 clinical_c1_1_observation_idempotency
20260825172224 clinical_c1_1_1_observation_owner_identity_hardening
20260826095017 c2_v0_1_medication_order_foundation
20260826102004 c2_v0_1_medication_function_security_hardening
20260826102252 c2_v0_1_schedule_constraint_hardening
20260826104426 c2_v0_1_mutation_consistency_hardening
20260826111542 c2_v0_1_revoke_idempotency_hardening
20260826111916 c2_v0_1_schedule_completeness_hardening
20260826112815 c2_v0_1_indefinite_schedule_hardening
20260826113620 c2_v0_1_schedule_open_phase_fix
20260826114920 c2_v0_1_global_lifecycle_idempotency_guard
20260826131822 c2_v0_1_medication_concept_snapshot_binding
20261005123149 patient_reported_medication_orders
20261005234912 medication_reference_layer
20261021000822 link_match_request_to_session
20261026062744 pneumointegration_shared_org_scope
20261026080000 backfill_partner_request_tenant_columns
20261027062352 partner_test_accruals
20261028020916 live_test_budget
20261106053005 my_practice_synthetic_workspaces_preview_only
20261107150430 partner_twenty_percent
20261109120000 my_practice_bookings_a2
20261109130000 my_practice_bookings_a2_corrective
20261109140000 my_practice_bookings_a2_ttl_semantics
20261110022907 my_practice_bookings_a2_hardening
20261116090216 practice_patient_profile_links
20261116090231 practice_booking_credit_payments
20261116173440 medical_encounters_a5
20261117185604 a38_unify_patient_specialist_links
20261117185704 a38_harden_link_rpc_grants
20261117193424 a38_preserve_support_client_identity
20261121081127 a381_default_practice_availability
20261121083234 a381_scope_booking_availability
20261121133131 a382_practice_service_modules
```

Результат set comparison: 43 общих timestamps, 11 local-only, 6 remote-only.
Текущий локальный CLI — `2.109.1`. Актуальная CLI v3 стала local-first и
требует явного `--remote`; перед любым будущим операторским шагом версию CLI и
target необходимо зафиксировать: [Supabase CLI v3 migration guide](https://supabase.com/docs/guides/local-development/cli/migrating-to-v3).

## 4. Матрица 11 local-only versions

`Local SHA` — SHA-256 исходных bytes файла. `Remote analog SHA` — SHA-256
concatenated statements из ledger; для указанных пар совпадение проверено
побайтно.

| Version / локальный SQL-файл | Local SHA-256 / remote history | Назначение и фактическое состояние Test | Риск повторного применения | Предложение | Класс |
| --- | --- | --- | --- | --- | --- |
| `20261116082953` — `supabase/migrations/20261116082953_practice_patient_profile_links.sql` | `3e982801e5765d7eab9ffaf71a5a22bd7bc78a4aac5ba01a55b70428584a9a74`; version отсутствует; exact analog `20261116090216` имеет тот же SHA | A3: `practice_patient_profile_links`; таблица, RLS, unique keys и ACL присутствуют | Высокий: `CREATE TABLE` конфликтует | Не выполнять; после review нормализовать локальный timestamp к фактическому remote | B |
| `20261116084712` — `supabase/migrations/20261116084712_practice_booking_credit_payments.sql` | `6cbd88c5d34f31b482a83ddfeec5d1ddcb93e545cad19f0125eb16fb4026fee4`; exact analog `20261116090231` | My Practice/Test credits: `price_credits`, credit table и RPC; SQL уже применён под remote timestamp | Высокий: DDL конфликт и финансовые объекты | Не выполнять; канонизировать filename/version по remote ledger | B |
| `20261116173150` — `supabase/migrations/20261116173150_medical_encounters_a5.sql` | `4b5c6fbd2e52d3d0266cd9ba7eb5ee74c3f1c27f0226f34bafc91815fb79b737`; exact analog `20261116173440` | A5: immutable `medical_encounter_versions` и save RPC; объекты, constraints, index, RLS/ACL присутствуют | Высокий: таблица/sequence уже существуют | Не выполнять; канонизировать timestamp | B |
| `20261117184606` — `supabase/migrations/20261117184606_a38_unify_patient_specialist_links.sql` | `90c2ea263d11c47b0d66d34c50c3ca1edb5cd15847685b3321826be89f8aa2d4`; remote `20261117185604` — `f00636e9b9b3162c7e621343298cbc10b55699ee11935ec0901ddc54f4986ffa` | A3.8 accept/revoke RPC. Remote SQL отличается только удалением двух строковых фрагментов `, anon, authenticated`; следующая hardening migration закрывает ACL. Фактически `anon=false`, `authenticated=false`, `service_role=true` для обеих RPC | Средний: security-critical `CREATE OR REPLACE`; повтор не нужен | Восстановить в Git точный historical remote SQL под `20261117185604`, затем exact hardening; локальную version не считать applied | A |
| `20261117185640` — `supabase/migrations/20261117185640_a38_harden_link_rpc_grants.sql` | `826e87c29916c1b17688992924f53b3d2cb89f922f0990af266fcd229f000e08`; exact analog `20261117185704` | A3.8 ACL hardening; фактический ACL соответствует | Средний: повтор security grants без необходимости | Не выполнять; канонизировать timestamp | B |
| `20261117193254` — `supabase/migrations/20261117193254_a38_preserve_support_client_identity.sql` | `1b192ed88ac17afad746ebdc64ffa95aa28fa6ec1c3ea34243e2640d000e2c8f`; exact analog `20261117193424` | A3.8 Support label trigger/function и historical backfill; trigger/function присутствуют | Высокий: файл содержит top-level backfill `UPDATE` пользовательских связей | Никогда не replay; канонизировать timestamp только локально | B |
| `20261122125416` — `supabase/migrations/20261122125416_my_practice_payment_modes.sql` | `46adfcfc062cfe1cadec1d134df6cf8f9679b3947233121ee8feae8ec3d41019`; remote отсутствует | My Practice payments-disabled для существующей Test A2-схемы. В Test нет status `requested`, predicate блокирует только `held/confirmed`, оба RPC отсутствуют | Высокий/UNKNOWN по данным: drop/add checks и GiST exclusion на непроверенных rows | Не смешивать с SEC-003; отдельный forward change после backup, data preflight и review | C |
| `20261123070309` — `supabase/migrations/20261123070309_r232_production_clinical_base_a3_a5.sql` | `d15a95e83a084b131b2e2a62d880388a4255efe2698a6d53f9dd8960587ec436`; remote отсутствует | Production-only consolidated A3/A5. Семь таблиц и почти все функции уже есть из Test migrations; Test дополнительно имеет `price_credits`. Consolidated owner-type check в Test отсутствует | Критический: первая `CREATE TABLE practice_places` конфликтует; пакет не эквивалентен Test | Исключить из канонического Test migration stream, сохранив как Production release artifact | D |
| `20261123070333` — `supabase/migrations/20261123070333_r232_production_payments_disabled_booking.sql` | `9b368f03d13bc7a7f7fa43827f7b67bdda9186ed7e71d1cf3e4f4b9ba87c0fef`; remote отсутствует | Production companion к предыдущему one-shot base. Целевой payments-disabled state отсутствует, но файл ожидает constraint `practice_bookings_no_double_booking`, тогда как Test имеет `_halfopen` | Высокий: отдельно воспроизводимо остановится на неверном prerequisite; вместе с consolidated конфликтует раньше | Не применять в Test; нужный Test delta представляет `20261122125416` либо новая reviewed forward migration | D |
| `20261123114523` — `supabase/migrations/20261123114523_r233_fix_continuation_failed_attempt_rpcs.sql` | `f9b081e450fc8b94b8b67d196a6819263968ca2ce0fcaa1b85501ea4fd814498`; remote отсутствует | R2.3.3 qualification fix. Test baseline уже имеет schema-qualified table refs, INVOKER, volatile, parallel-unsafe и `search_path=''`; exact bodies отличаются в alias/`locked_until` edge semantics | Средний: `CREATE OR REPLACE` меняет definition и берёт DDL locks, хотя дефект отсутствует | Не применять автоматически к Test; держать в Production-specific stream или оформить отдельный forward semantic change | A |
| `20261123223548` — `supabase/migrations/20261123223548_sec_003_health_bootstrap.sql` | `f94f1701333fb384aa0fed67e157bdaae0eb91a618ae6b4299cbb569c05b756d`; remote отсутствует | SEC-003 Health atomic bootstrap. Функция и overloads отсутствуют; все зависимости и права подтверждены | Низкий для schema-only migration при транзакционном runner; security impact требует acceptance | После reconciliation сделать её единственной pending и применить штатным runner под той же version | C |

### Git provenance local-only

Точные remote-only filenames никогда не существовали ни в одной достижимой
Git-ветке (`git log --all --full-history -- <path>` вернул пустой результат).
Их доказанная provenance — аналогичные файлы под локальными timestamps:

| Локальные версии | Добавивший commit | Модуль | Ветки, содержащие commit |
| --- | --- | --- | --- |
| `20261116082953`, `20261116084712` | `fe16b256103ea983a235e454b0b78969d36b6634` — `feat: shared patient appointments and credit payments` | A3 / My Practice | текущая integration, `codex/sec-003-legacy-bypass`, `feature/my-practice-a3-patient-cabinet`, `origin/feature/...` |
| `20261116173150` | `286b8c941069f058707d53f72d1f8d27ad9740f7` — `feat: manual patient medical records with immutable encounter history` | A5 | те же |
| `20261117184606`, `20261117185640` | `44a8de07fee20de28b0d0004f76055e9e6cbba42` — `feat(A3.8): unify patient and specialist cabinets` | A3.8 | те же |
| `20261117193254` | `1a8fb7abb802a65042b126bce620edf2b80f0d34` — `fix(A3.8): preserve organization and patient identity` | A3.8 | те же |
| `20261122125416` | `b75a1f2a5427bcf3d9c1806ba99d48d5efc566e4` — `feat: separate My Practice payment modes for R2.2` | My Practice R2.2 | те же |
| `20261123070309`, `20261123070333`, `20261123114523` | `2f05e9f282c51e50b15aac9c3197164eb3a21f6f` — `chore: audit and prepare A3/A5 production migration package R2.3.4-A` | Production R2.3.2/R2.3.3 | текущая integration, legacy-bypass, feature и origin feature |
| `20261123223548` | `2eb4b3f9ed181387f429042cff097beaa78ac5dd` — `fix(auth): close legacy bypass and harden Health bootstrap` | SEC-003 | `codex/sec-003-legacy-bypass`; integration-файл сейчас untracked, но побайтно равен commit |

## 5. Матрица 6 remote-only versions

Remote SHA вычислен read-only как SHA-256 UTF-8 от
`array_to_string(statements, '')`. Для пяти B-пар он равен raw SHA локального
аналога.

| Remote version / name | Локальный файл | Remote SQL SHA-256 | Назначение и фактическое состояние | Риск / рекомендация | Класс |
| --- | --- | --- | --- | --- | --- |
| `20261116090216 practice_patient_profile_links` | точного path нет; analog `20261116082953_practice_patient_profile_links.sql` | `3e982801e5765d7eab9ffaf71a5a22bd7bc78a4aac5ba01a55b70428584a9a74` | Exact SQL applied; table/RLS/keys present | Replay локального аналога высокий; canonicalize local timestamp, remote ledger не менять | B |
| `20261116090231 practice_booking_credit_payments` | analog `20261116084712_practice_booking_credit_payments.sql` | `6cbd88c5d34f31b482a83ddfeec5d1ddcb93e545cad19f0125eb16fb4026fee4` | Exact SQL applied; Test credit schema present | Высокий; canonicalize only in Git | B |
| `20261116173440 medical_encounters_a5` | analog `20261116173150_medical_encounters_a5.sql` | `4b5c6fbd2e52d3d0266cd9ba7eb5ee74c3f1c27f0226f34bafc91815fb79b737` | Exact SQL applied; A5 objects present | Высокий; canonicalize only in Git | B |
| `20261117185604 a38_unify_patient_specialist_links` | near-analog `20261117184606_a38_unify_patient_specialist_links.sql` | `f00636e9b9b3162c7e621343298cbc10b55699ee11935ec0901ddc54f4986ffa` | SQL differs only by two omitted `anon, authenticated` revoke targets; final ACL made equivalent by next migration | Средний; store exact remote historical variant, never claim byte identity with local | A |
| `20261117185704 a38_harden_link_rpc_grants` | analog `20261117185640_a38_harden_link_rpc_grants.sql` | `826e87c29916c1b17688992924f53b3d2cb89f922f0990af266fcd229f000e08` | Exact SQL applied; both RPC server-only | Средний; canonicalize only in Git | B |
| `20261117193424 a38_preserve_support_client_identity` | analog `20261117193254_a38_preserve_support_client_identity.sql` | `1b192ed88ac17afad746ebdc64ffa95aa28fa6ec1c3ea34243e2640d000e2c8f` | Exact SQL including backfill applied; trigger/function present | Высокий if replayed; canonicalize only in Git | B |

## 6. Расхождение имени

| Version | Local | Remote | SQL evidence | Вывод |
| --- | --- | --- | --- | --- |
| `20261106053005` | `my_practice_synthetic_workspaces` | `my_practice_synthetic_workspaces_preview_only` | обе стороны SHA `2a1c119ecf718490a6ecb6ec8cfe9865a8ba220b1a4fc7cd0dc8aa23402d15b9` | Same version и exact SQL; только provenance-name mismatch |

Локальный файл добавлен commit
`51549a333906100863cbbf94a5d26c344e26a02e` и присутствует в integration,
legacy-bypass, feature branch и `origin/main`. CLI идентифицирует migration по
timestamp, но для честной исходной истории после отдельного review следует
переименовать локальный filename так, чтобы suffix совпадал с remote name.
Удалённую историю менять не требуется.

## 7. Анализ консолидированных миграций A3/A5

### 7.1 `20261123070309_r232_production_clinical_base_a3_a5.sql`

Файл — one-shot Production package, а не инкремент для уже развитой Test
схемы. Он функционально собирает части следующих Test migrations:

| Область consolidated SQL | Исторические Test migrations |
| --- | --- |
| `practice_places/services/availability/bookings/events`, TTL/hardening | `20261109120000`, `20261109130000`, `20261109140000`, `20261110022907` |
| Support↔Health canonical profile link | remote `20261116090216` / local `20261116082953` |
| A5 encounter versions | remote `20261116173440` / local `20261116173150` |
| unified accept/revoke specialist links + ACL | remote `20261117185604`, `20261117185704` |
| сохранение Support label и trigger | remote `20261117193424` |
| default availability | `20261121081127` |
| availability-scoped reservation | `20261121083234` |
| service `modules` | `20261121133131` |

Подтверждённые совпадения результата: все семь relations существуют, RLS
включён, основные indexes, три triggers и все целевые RPC signatures
присутствуют; exact timestamp-drift SQL для profile links и encounters
подтверждён hashes.

Подтверждённые различия:

1. Test `practice_services` имеет дополнительный `price_credits bigint`, а
   Production consolidated SQL намеренно исключает credit finance.
2. Test не имеет named constraint `practice_bookings_owner_type_check`, который
   consolidated добавляет.
3. Два unnamed checks в Test называются `practice_bookings_check` и
   `practice_bookings_check1`; их expressions эквивалентны interval/owner-pair
   checks consolidated, но имена отличаются.
4. Test exclusion уже называется
   `practice_bookings_no_double_booking_halfopen`; consolidated создаёт сначала
   `practice_bookings_no_double_booking`.
5. A3.8 remote historical SQL имеет более узкие `REVOKE`, затем отдельный
   exact hardening; consolidated сразу отзывает все внешние роли.
6. Consolidated не создаёт Test-only `practice_booking_credits` и credit RPCs,
   уже существующие в Test.

Следовательно, итог **не является побайтно или объектно полностью
эквивалентным**, хотя clinical surface в основном присутствует. Применение
невозможно: после harmless `CREATE EXTENSION IF NOT EXISTS` оно остановится на
существующей `practice_places`. При штатной одной транзакции это откатится, но
пробное применение запрещено и не требуется.

### 7.2 `20261123070333_r232_production_payments_disabled_booking.sql`

Файл зависит от только что созданной предыдущей migration и constraint
`practice_bookings_no_double_booking`. В Test такого constraint уже нет:
присутствует `_halfopen`. Поэтому отдельное выполнение не является безопасным
Test migration. Его желаемый функциональный результат (status `requested`,
predicate с `requested`, два request/cancel RPC) отсутствует, но корректным
Test-кандидатом является отдельный инкремент `20261122125416` или новая
reviewed forward migration, а не Production companion.

### 7.3 `20261123114523_r233_fix_continuation_failed_attempt_rpcs.sql`

Test catalog уже содержит обе signatures с:

- `SECURITY INVOKER`;
- `VOLATILE`, `PARALLEL UNSAFE`;
- `search_path=""`;
- schema-qualified `public.continuation_failed_attempts`;
- существующей таблицей с RLS.

Это состояние получено из Test baseline, а не из отсутствующей R2.3.3 ledger
version. Exact definitions отличаются: current Test использует исходный
target-table name и сохраняет прежний `locked_until` в одном below-threshold
edge case; R2.3.3 использует alias, `pg_catalog.now()` и устанавливает `NULL`.
Таким образом, defect fix присутствует, но повторная замена функции не является
безусловно no-op.

## 8. Проверка фактических объектов схемы

Все результаты ниже получены только из `pg_catalog`, без `SELECT` из
пользовательских таблиц.

### A3/A5 / My Practice

| Проверка | Test result |
| --- | --- |
| 7 consolidated relations | Все существуют; `relrowsecurity=true` |
| Основные indexes | `practice_*` indexes, `medical_encounter_owner_idx`, unique profile/encounter indexes присутствуют |
| Triggers | `practice_services_touch`, `practice_bookings_touch`, `sync_support_assignment_label_from_invitation` присутствуют |
| RLS policies на 7 server-only tables | Отсутствуют; доступ определяется ACL/service role |
| A3.8 ACL | accept/revoke: `anon=false`, `authenticated=false`, `service_role=true` |
| A5 ACL | save RPC только service role; encounter table service role `SELECT/INSERT`, без `UPDATE/DELETE` |
| `practice_bookings_status_check` | Только `held/confirmed/completed/cancelled/expired`; `requested` отсутствует |
| booking exclusion | Только `held/confirmed`; `requested` отсутствует |
| payments-disabled RPC | Обе signatures отсутствуют |
| owner-type check consolidated | Отсутствует как отдельный constraint |

### Health bootstrap

| Проверка | Test result |
| --- | --- |
| `bootstrap_health_intake` по имени | 0 функций |
| exact 13-argument signature | отсутствует |
| Dependency tables | `sessions`, `body_clients`, `body_intake_forms`, `continuation_credentials`, `usage_wallets`, `usage_ledger` существуют |
| `sessions.session_id` collision guard | unique index `idx_sessions_session_id_unique` |
| `body_clients.session_id` collision guard | unique index `body_clients_session_id_key` |
| continuation guards | unique `lookup_code`; unique `(owner_type, owner_id)` |
| wallet guard | unique `(owner_type, owner_id, module)` |
| `ensure_usage_wallet(text,uuid,text)` | существует, INVOKER, `search_path=''`, возвращает `usage_wallets`, service role имеет EXECUTE |
| Required service-role table rights | На всех шести dependencies подтверждены `SELECT/INSERT`; дополнительные права не требуются для создания function |
| `usage_ledger.id` | `uuid DEFAULT gen_random_uuid()` |

Health SQL валидирует 128-bit-shaped `health_` identifier, hashes и input
JSON, затем одной function invocation вставляет session, profile, intake,
continuation credential и wallet. Любой unique conflict или ошибка wallet
прерывает statement transaction; частичный bootstrap не должен сохраниться.
Сама migration только создаёт/заменяет функцию и ACL — пользовательские rows
не создаёт.

Повторный запуск SQL definition технически идемпотентен через
`CREATE OR REPLACE`, `REVOKE`, `GRANT`, `COMMENT`, но migration version должна
регистрироваться один раз. Runtime-повтор с тем же identifier обязан завершиться
unique conflict и откатом всех вставок.

## 9. Классификация каждого расхождения

| Version | Сторона | Класс | Основание |
| --- | --- | --- | --- |
| `20261116082953` | local-only | B | exact SQL зарегистрирован как `20261116090216` |
| `20261116084712` | local-only | B | exact SQL зарегистрирован как `20261116090231` |
| `20261116173150` | local-only | B | exact SQL зарегистрирован как `20261116173440` |
| `20261117184606` | local-only | A | near-identical remote SQL + exact next hardening дают тот же ACL/result |
| `20261117185640` | local-only | B | exact SQL зарегистрирован как `20261117185704` |
| `20261117193254` | local-only | B | exact SQL зарегистрирован как `20261117193424` |
| `20261122125416` | local-only | C | status/predicate/RPC действительно отсутствуют |
| `20261123070309` | local-only | D | Production one-shot заменён Test historical chain и неприменим к существующим tables |
| `20261123070333` | local-only | D | Production companion неприменим к Test constraint topology; Test delta представлен отдельно |
| `20261123114523` | local-only | A | qualification defect уже отсутствует в Test baseline |
| `20261123223548` | local-only | C | function отсутствует, dependencies присутствуют |
| `20261116090216` | remote-only | B | exact local SQL существует под `20261116082953` |
| `20261116090231` | remote-only | B | exact local SQL существует под `20261116084712` |
| `20261116173440` | remote-only | B | exact local SQL существует под `20261116173150` |
| `20261117185604` | remote-only | A | не exact, но полностью объяснённая двухфрагментная ACL-разница и последующий hardening |
| `20261117185704` | remote-only | B | exact local SQL существует под `20261117185640` |
| `20261117193424` | remote-only | B | exact local SQL существует под `20261117193254` |

Безопасные правила по категориям:

- **A:** не replay и не помечать слепо applied; сохранить catalog evidence и,
  если нужен exact semantic delta, оформить новый forward change.
- **B:** привести локальный filename/version к правдивому remote timestamp;
  remote ledger и schema не менять.
- **C:** выполнять только как новую/фактическую migration после отдельного
  approval, backup и preflight. История появляется только вместе с SQL.
- **D:** сохранить artifact, но исключить из канонического Test stream;
  никогда не маскировать его как applied.
- **E:** отсутствует; если появится новая неизвестность, reconciliation
  останавливается.

## 10. Влияние на Health bootstrap

Исходный файл:
`supabase/migrations/20261123223548_sec_003_health_bootstrap.sql`.

- Working-copy SHA-256:
  `f94f1701333fb384aa0fed67e157bdaae0eb91a618ae6b4299cbb569c05b756d`.
- SHA из source commit `2eb4b3f9ed181387f429042cff097beaa78ac5dd`:
  тот же; diff пуст.
- В Test нет ни exact signature, ни другого overload с этим именем.
- Все relation/function dependencies и требуемые service-role права
  подтверждены.
- Signature conflict отсутствует.
- SQL не содержит собственного `BEGIN/COMMIT`; transaction ownership должен
  принадлежать штатному migration runner.

Безопасный способ применить **ровно эту** migration после reconciliation:

1. Канонический локальный migration set должен совпасть с remote ledger до
   `20261121133131`; B-пары исправляются только в Git, A/D artifacts удаляются
   из Test stream без правки remote ledger.
2. `20261122125416` выносится в отдельный product migration track до отдельного
   решения; иначе он будет второй pending migration перед Health.
3. Read-only migration plan должен показывать единственную pending version
   `20261123223548` для exact Test ref.
4. После backup/restore attestation оператор запускает штатный Supabase
   migration runner в отдельном change window. Runner должен выполнить SQL и
   записать **эту же** version/name атомарно.
5. Direct SQL + `migration repair`, MCP apply под автоматически сгенерированным
   timestamp и ручной ledger INSERT запрещены: они либо разрывают atomicity,
   либо создают ложную provenance.

Новая migration version нужна только если исходная `20261123223548` станет
занятой или будет официально заменена до запуска. В текущем Test она свободна,
поэтому честнее сохранить исходную SEC-003 version.

## 11. Рекомендуемая стратегия согласования

Ни один шаг ниже в рамках этого аудита не выполнялся.

1. **Freeze и evidence.** Зафиксировать Test project ref, Git SHA, CLI version,
   read-only migration ledger, catalog fingerprint, backup/PITR timestamp и
   процедуру restore. Не читать application rows.
2. **Нормализовать пять exact B-пар в Git.** Переименовать локальные files к
   remote timestamps `16090216`, `16090231`, `16173440`, `17185704`,
   `17193424`, сохранив exact bytes/hash. Это отдельный reviewed Git change,
   без SQL и без ledger repair.
3. **Восстановить честную A3.8 history.** Создать canonical historical file
   `20261117185604` из remote ledger SQL; проверяемый hash должен быть
   `f00636...`. За ним оставить exact hardening `20261117185704`. Старую
   локальную `20261117184606` не считать применённой и убрать из active Test
   stream, сохранив её Git provenance.
4. **Исправить name-only drift.** Согласовать suffix
   `20261106053005_my_practice_synthetic_workspaces_preview_only.sql`; DB action
   не нужна.
5. **Развести environment-specific artifacts.** R2.3.2 Production one-shot
   files `23070309/23070333` хранить вне active Test migration stream.
   R2.3.3 оставить в Production track, пока отдельный review не потребует exact
   semantic change в Test.
6. **Отделить payment-mode gap.** `20261122125416` не является SEC-003
   prerequisite. Решение о `requested` mode — отдельный product/security
   change с data-dependent preflight и новой forward migration при
   необходимости.
7. **Повторная read-only сверка.** Local/remote должны совпасть через remote
   head; не должно быть remote-only и ложных local-only historical files.
   Единственная разрешённая pending version для SEC-003 — Health.
8. **Утверждение operator.** Независимо проверить reconstructed A3.8 hash,
   staged diff локальной history normalization, backup и target. Никакого
   `migration repair`: документация прямо указывает, что он изменяет только
   tracking table, а не SQL.
9. **Health migration.** Применить штатным runner одной transaction только к
   Test; version и SQL должны регистрироваться вместе.
10. **Post-migration catalog acceptance.** Проверить exact signature,
    INVOKER, `search_path`, ACL (PUBLIC/anon/authenticated denied,
    `service_role` granted), definition hash,
    unchanged ledger except одной новой version и отсутствие неожиданных
    objects.
11. **Synthetic SEC-003 + A3/A5 tests.** Только после catalog acceptance:
    Health collision/concurrency, continuation exchange, кабинеты, дневники,
    связь специалиста, negative owner/module/token cases. Production не
    затрагивать.

Supabase рекомендует одному оператору выполнять remote migration deployment и
указывает, что прямые remote schema changes обходят migration history:
[Database migrations](https://supabase.com/docs/guides/deployment/database-migrations).

## 12. План восстановления при ошибке

### До изменения Test

- Проверить актуальную Test backup или PITR и документированный restore path.
- Сохранить read-only ledger/catalog fingerprint и exact target SQL hash.
- Не начинать окно без возможности восстановить **только Test**.

### Ошибка history-normalization в Git

Изменение только локальное/репозиторное: остановить review и отклонить этот
отдельный commit. Remote database и ledger не меняются. Нельзя компенсировать
ошибку `migration repair`.

### Health migration завершилась ошибкой

При штатном transactional runner ожидается rollback function/ACL и history
row. Сначала read-only подтвердить отсутствие обеих частей. Если обнаружено
частичное состояние, остановить все E2E и восстановить Test по утверждённому
плану; не вставлять/удалять ledger rows вручную.

### Migration успешна, acceptance не прошёл

- Не запускать приложение/E2E, не применять SQL вручную.
- Сохранить logs и catalog evidence без секретов.
- Подготовить отдельную forward rollback migration после review. Для этой
  schema-only change rollback должен точно отозвать EXECUTE и удалить только
  exact Health function signature; history остаётся append-only.
- Restore Test использовать, если обнаружено более широкое повреждение или
  forward rollback не доказан.

### Ошибка в последующих synthetic E2E

Остановить deployment, сохранить только технические identifiers теста и
очищать synthetic rows лишь отдельной одобренной процедурой. Не откатывать
migration history из-за application-test failure.

## 13. Риски

| Риск | Уровень | Контроль |
| --- | --- | --- |
| Автоматический replay 11 local-only migrations | Критический | Не использовать `db push/up` до canonical history reconciliation |
| Production consolidated package на Test | Критический | Исключить из Test stream; он конфликтует с существующими tables |
| Повтор historical A3.8 label migration | Высокий | Exact B mapping; никогда не replay top-level backfill |
| Payments-mode constraint rebuild на неизвестных rows | Высокий | Отдельный data-safe preflight/backup; не часть SEC-003 |
| A3.8 remote SQL не существует в достижимом Git | Средний | Reconstruct from ledger metadata, verify full hash independently |
| R2.3.3 exact body отличается от current Test | Средний | Не считать no-op; отдельный semantic review |
| Backup/restore readiness в этой задаче не проверялась | Высокий до подтверждения | Обязательный operator gate перед любой migration |
| Catalog мог измениться после 2026-11-25 | Средний | Повторить read-only preflight непосредственно перед окном |
| CLI v2.109.1 против актуальной v3 local-first | Средний | Pin approved CLI или обновить runbook; всегда явно проверять target |
| Ledger hash и raw-file hash различаются для multi-statement migrations | Средний | Exact equivalence утверждать только там, где bytes/hash доказаны |
| Application rows не читались | Ожидаемое ограничение | Data-dependent constraints остаются отдельным gate, не скрытым PASS |

Запрещённые операции (`db push/reset/pull`, `migration up/repair/squash`, DDL,
DML, commit, push, deploy) не выполнялись. Секреты, токены и медицинские данные
не запрашивались и в отчёт не включены.

## 14. Итоговый вердикт

**READY FOR RECONCILIATION PLAN REVIEW**

Все 17 version-разногласий идентифицированы и распределены по A/B/C/D;
неразрешённых E-категорий нет. Причина timestamp drift доказана для пяти exact
пар, A3.8-разница локализована до двух ACL-фрагментов и подтверждена фактическим
catalog ACL. Production consolidated package отделён от Test topology,
payments-disabled gap и Health gap установлены независимо.

Это только готовый к операторскому рассмотрению план. Он **не разрешает**
изменение migration history, применение Health SQL, миграции, commit, push,
merge или deployment.
