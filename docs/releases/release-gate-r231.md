# Release Gate R2.3.1 — read-only аудит Production Supabase и подготовка миграции A3/A5

Дата аудита: 2026-11-22.
Ветка: `feature/my-practice-a3-patient-cabinet`.
Проверенный исходный SHA: `b75a1f2a5427bcf3d9c1806ba99d48d5efc566e4`.

## Итог

**R2.3.1: NO-GO для создания клона, миграции или любого изменения Production.**

Read-only аудит подтвердил, что Production имеет рабочий Support/Health и
исторический A2 wallet/ledger контур, но не имеет My Practice/A3/A5 схемы.
Также подтверждены timestamp drift истории миграций, отсутствие удалённой
R2.2-миграции и отсутствие доказательства конкретной доступной резервной
копии/PITR. План репетиции готов, но его запуск требует отдельного разрешения
владельца после проверки backup в Dashboard.

Этот статус не означает запрет на текущую локальную работу. Он запрещает только
переход к R2.3.2 или изменения cloud-инфраструктуры без перечисленных ниже
подтверждений.

## Граница аудита и доказательства

* Production: `blwogrdezfhprdpdnxtn` (`Tochka Opori`, `eu-west-1`), статус
  `ACTIVE_HEALTHY`, PostgreSQL `17.6.1.127` (major 17).
* Test: `eehyehlhiyztciaezaus` (`Tochka-Opori-Preview-Test`),
  PostgreSQL `17.6.1.155`.
* Организация: Pro (`tier_pro`). В Production нет development branches.
* Использованы только специализированные read-only интерфейсы Supabase:
  project/table/migration/extension/advisor listing. В них не запрашивались
  строки пользовательских таблиц, медицинские сведения, токены или ключи.
* Generic `execute_sql` не имеет гарантированного read-only режима. Поэтому
  системные каталоги через него **не вызывались**: нет запросов к `pg_catalog`,
  `information_schema`, данных пользователей или `schema_migrations` напрямую.
* Отдельный браузер не имеет сессии Dashboard; backup/PITR нельзя было
  подтвердить интерфейсом. Никакие sign-in, restore, clone, PITR, billing,
  migrations, `db push`, `migration repair`, Git push/merge или Vercel-действия
  не выполнялись.

Статусы в этом документе имеют строгий смысл: **VERIFIED** — получено фактом
read-only инструмента; **NOT VERIFIED** — инструмент не даёт доказательства;
**BLOCKED** — продолжение в заданной области небезопасно.

## Production schema inventory

| Область | Результат | Основание и ограничение |
|---|---|---|
| Версия PostgreSQL | VERIFIED | `17.6.1.127`, PostgreSQL 17, project API. |
| Доступность Production | VERIFIED | `ACTIVE_HEALTHY`; регион `eu-west-1`. |
| Таблицы `public` | VERIFIED | 62 таблицы, все 62 с `rls_enabled=true`; список получен metadata API. |
| Схемы с доступными метаданными | VERIFIED частично | В table metadata обнаружены `public`, `auth`, `vault`; исчерпывающий список всех схем не доступен без raw system-catalog query. |
| Колонки, типы, PK/FK ключевых таблиц | VERIFIED | Metadata API возвращает их для identity/org/link/A2/clinical таблиц; ниже приведена безопасная сводка. |
| Представления, все индексы, constraints, triggers | NOT VERIFIED | Нет специализированного read-only endpoint; raw SQL сознательно не использовался. |
| Все функции/RPC, определения `SECURITY DEFINER` | NOT VERIFIED | По той же причине. Для A3/A5 они отсутствуют вместе с базовыми таблицами; полный список существующих Production RPC требует отдельной технически read-only сессии или clone. |
| Политики RLS и GRANT/REVOKE | NOT VERIFIED | Advisor подтверждает включённый RLS и диагностирует policy gaps, но не даёт полный policy/privilege dump. |
| Extensions | VERIFIED | См. отдельную сводку. |

### Ключевые существующие объекты и агрегаты

Только количество строк, без пользовательских значений:

| Объект | Production | Test | Вывод |
|---|---:|---:|---|
| `experts` | 17 | 16 | Базовый справочник есть в обоих контурах. |
| `organizations` | 5 | 3 | Базовый справочник есть в обоих контурах. |
| `expert_organization_memberships` | 2 | 7 | Связь specialist–organization есть. |
| `patient_assignments` | 6 | 17 | Канонические primary links есть. |
| `patient_access` | 2 | 3 | Additional access links есть. |
| `patient_specialist_invitations` | 2 | 10 | Инвайты есть; полная FK/trigger семантика требует clone audit. |
| `usage_wallets` / `usage_ledger` | 191 / 615 | 94 / 210 | Существующий A2 финансовый контур есть; его не следует использовать как Production prerequisite для A3. |
| `service_pricing` / `service_requests` | 15 / 7 | 15 / 14 | Существующий Support pricing/request контур есть, но это не `practice_services`. |
| `clinical_events` / `clinical_observations` | 33 / 90 | 49 / 27 | Clinical C1 объекты существуют; записи не читались. |

Из metadata подтверждены PK `id` ключевых identity/org/link/A2/clinical
таблиц и FK: memberships → `experts`/`organizations`, assignments/access →
`experts`/`organizations`, usage ledger → wallet, clinical events/observations
→ organization/expert/event. Это важно: Production имеет более строгие FK для
`patient_assignments` и `patient_access`, чем исторический Test, как уже
зафиксировано в R2.

### Отсутствующий My Practice/A3/A5 слой

Следующие таблицы есть в Test, но **отсутствуют** в Production:

`practice_places`, `practice_services`, `practice_availability`,
`practice_bookings`, `practice_events`, `practice_payments`,
`practice_commissions`, `practice_booking_credits`,
`practice_patient_profile_links`, `medical_encounter_versions`.

Поэтому в Production пока отсутствуют и зависящие от них booking/default-
schedule/request payment-mode RPC. Нельзя запускать R2.2 SQL отдельно: он
изменяет `practice_bookings` и вызывает `reserve_practice_booking`, которых
там ещё нет.

Другие Test-only public объекты: `my_practice_synthetic_workspaces`,
`live_test_*`, `clinical_knowledge_*`, `published_clinical_cases`,
`clinical_contributions` и `clinical_contribution_bonus_ledger`. Они не
входят в целевой Production bundle.

Production-only public объекты относительно Test: `crisis_requests`,
`expert_requests`. Они относятся к действующим сервисам и не должны
удаляться, переименовываться или подменяться схемой из Test.

### RLS, policies и advisor findings

Metadata API подтверждает `rls_enabled=true` у всех 62 Production таблиц
`public`. Security Advisor одновременно сообщает о **48** таблицах с RLS без
политик, включая `experts`, `organizations`, assignments/access, clinical
tables и несколько Support/Health объектов. Это не доказывает внешний доступ:
при отсутствии grants RLS default-deny, а приложение может использовать
service role. Но без полной выгрузки `pg_policies`, table grants и API exposure
это серьёзный **stop condition** для любого Production rollout.

Performance Advisor отметил 20 FK без покрывающего индекса и одну policy
`usage_reservations_service_role_only`, где `current_setting()`/`auth.*`
может вычисляться для каждой строки. Это backlog измеренной performance work,
не разрешение добавлять индексы в рамках R2.3.1. Advisor health findings: 0.

### Установленные extensions

Подтверждены нужные для текущего дизайна extension: `pgcrypto` 1.3,
`supabase_vault` 0.3.1, `pg_stat_statements` 1.11, `uuid-ossp` 1.1,
`btree_gist` 1.7 и `plpgsql` 1.0. Наличие `btree_gist` позволяет в будущем
создать exclusion constraint бронирования на clone. Версии default-only
extensions не следует считать установленными.

## Сверка историй миграций

Локальный Git содержит 50 SQL-файлов. Production history содержит 33 записи,
Test history — 49. Ни Production, ни Test не содержат локальную R2.2
`20261122125416_my_practice_payment_modes`.

### Полная карта Git → Production → Test

`Present` означает ровно тот же version+name. `Different` означает тот же
смысл/имя при другом version; такая запись не является эквивалентностью для
migration runner. `Actual` отражает безопасно наблюдаемое наличие объектов, а
не доказательство идентичного SQL.

| Git migration | Production history | Test history | Actual Production objects | Решение |
|---|---|---|---|---|
| `20260814000000_production_baseline` | Present | Present | Present | Existing; не повторять. |
| `20260814010000_security_hardening` | Present | Present | Partial / not fully audited | Investigate only on clone. |
| `20260814020000_performance_hardening` | Present | Present | Partial / not fully audited | Investigate only on clone. |
| `20260816000000_specialist_module_entitlements` | Present | Present | Present base identity objects | Existing. |
| `20260817000000_support_pricing` | Present | Present | Present | Existing. |
| `20260818000000_patient_specialist_linking` | Present | Present | Present | Existing; compare RPC/triggers on clone. |
| `20260819000000_accept_invitation_rpc` | Present | Present | Partial | Compare function/grants on clone. |
| `20260821000000_harden_specialist_invitation_accept` | Present | Present | Partial | Compare function/grants on clone. |
| `20260821010000_scope_owner_accept` | Present | Present | Partial | Compare function/grants on clone. |
| `20260821133103_health_body_pricing` | Present | Present | Present | Existing. |
| `20260821155003_service_request_financial_lifecycle` | Present | Present | Present | Existing A2/service path; preserve. |
| `20260824083854_harden_service_request_financial_grants` | Present | Present | NOT VERIFIED | Audit grants on clone. |
| `20260825085627_harden_accept_specialist_invitation_grants` | Present | Present | NOT VERIFIED | Audit grants on clone. |
| `20260825134958_clinical_data_layer_c1_foundation` | Present | Present | Present | Existing; preserve data. |
| `20260825143903_clinical_data_layer_c1_reference_hardening` | Present | Present | Partial | Clone comparison required. |
| `20260825154115_clinical_c1_1_observation_idempotency` | Present | Present | Partial | Clone comparison required. |
| `20260825172224_clinical_c1_1_1_observation_owner_identity_hardening` | Present | Present | Partial | Clone comparison required. |
| `20260826095017_c2_v0_1_medication_order_foundation` | Present | Present | Present | Existing; do not read clinical rows. |
| `20260826102004_c2_v0_1_medication_function_security_hardening` | Present | Present | NOT VERIFIED | Clone function/grant audit. |
| `20260826102252_c2_v0_1_schedule_constraint_hardening` | Present | Present | Partial | Clone constraint audit. |
| `20260826104426_c2_v0_1_mutation_consistency_hardening` | Present | Present | Partial | Clone function/trigger audit. |
| `20260826111542_c2_v0_1_revoke_idempotency_hardening` | Present | Present | Partial | Clone audit. |
| `20260826111916_c2_v0_1_schedule_completeness_hardening` | Present | Present | Partial | Clone audit. |
| `20260826112815_c2_v0_1_indefinite_schedule_hardening` | Present | Present | Partial | Clone audit. |
| `20260826113620_c2_v0_1_schedule_open_phase_fix` | Present | Present | Partial | Clone audit. |
| `20260826114920_c2_v0_1_global_lifecycle_idempotency_guard` | Present | Present | Partial | Clone audit. |
| `20260826131822_c2_v0_1_medication_concept_snapshot_binding` | Present | Present | Partial | Clone audit. |
| `20261005123149_patient_reported_medication_orders` | Present | Present | Present | Existing; preserve. |
| `20261005234912_medication_reference_layer` | Present | Present | Present | Existing; preserve. |
| `20261021000822_link_match_request_to_session` | Different: `20261021072023` | Present | Partial | Reconcile object definition on clone; never repair history. |
| `20261026062744_pneumointegration_shared_org_scope` | Different: `20261026064902` | Present | Partial | Reconcile object definition on clone; never repair history. |
| `20261026080000_backfill_partner_request_tenant_columns` | Absent | Present | NOT VERIFIED | Assess data impact on clone; do not backfill Production now. |
| `20261027062352_partner_test_accruals` | Different: `20261027112618` | Present | Present A2 tables | Preserve existing financial history; no replay. |
| `20261028020916_live_test_budget` | Absent | Present | Missing Test-only objects | Exclude from Production. |
| `20261106053005_my_practice_synthetic_workspaces` | Absent | Present | Missing Test-only object | Exclude from Production. |
| `20261107150430_partner_twenty_percent` | Absent | Present | A2 exists | Exclude from Production bundle; no Test credit semantics. |
| `20261109120000_my_practice_bookings_a2` | Absent | Present | Missing all `practice_*` base tables | Replace with reviewed clinical base bundle, not historical A2 SQL. |
| `20261109130000_my_practice_bookings_a2_corrective` | Absent | Present | Missing prerequisite tables | Do not apply. |
| `20261109140000_my_practice_bookings_a2_ttl_semantics` | Absent | Present | Missing prerequisite tables | Do not apply. |
| `20261110022907_my_practice_bookings_a2_hardening` | Absent | Present | Missing prerequisite tables | Do not apply. |
| `20261116082953_practice_patient_profile_links` | Absent | Different: `20261116090216` | Missing | New clinical bundle on clone. |
| `20261116084712_practice_booking_credit_payments` | Absent | Different: `20261116090231` | Missing | Exclude credits/payment table/RPC in Production. |
| `20261116173150_medical_encounters_a5` | Absent | Different: `20261116173440` | Missing | New clinical A5 bundle on clone. |
| `20261117184606_a38_unify_patient_specialist_links` | Absent | Different: `20261117185604` | Base links present | Clone-only data impact review before any update/deactivation. |
| `20261117185640_a38_harden_link_rpc_grants` | Absent | Different: `20261117185704` | NOT VERIFIED | Clone function/grant diff first. |
| `20261117193254_a38_preserve_support_client_identity` | Absent | Different: `20261117193424` | Base links present | Clone-only duplicate/identity audit first. |
| `20261121081127_a381_default_practice_availability` | Absent | Present | Missing prerequisite tables | Include adapted server-only RPC after clinical base. |
| `20261121083234_a381_scope_booking_availability` | Absent | Present | Missing prerequisite tables | Include adapted booking guard after base. |
| `20261121133131_a382_practice_service_modules` | Absent | Present | Missing prerequisite table | Include `modules` in new base; no live backfill. |
| `20261122125416_my_practice_payment_modes` | Absent | Absent | Missing prerequisite table/RPC | Apply only adapted request-only portion after clone rehearsal. |

### Consequence of the drift

The three Production timestamp drifts and six Test timestamp drifts mean that
neither `supabase db push` nor `migration repair` can be used as a reconciliation
mechanism. They would either replay non-idempotent historical SQL or mask a
schema mismatch. The canonical comparison must be performed on a restored
clone using object definitions, constraints, triggers, functions and grants.

## A3/A5 Production-compatible target

The planned Production base is one My Practice data model with familiar object
names, but contains **only clinical booking capability**:

1. `practice_places`, `practice_services` (already including `modules`),
   `practice_availability`, `practice_bookings`, `practice_events`;
2. `practice_patient_profile_links` and `medical_encounter_versions`;
3. default 09:00–18:00 availability RPC and availability-scoped reservation
   RPC, available only to `service_role` after application authorization;
4. `requested` booking status plus request/cancel-without-payment RPC from
   R2.2, protected by the booking exclusion constraint;
5. Production server configuration
   `MY_PRACTICE_SERVER_ENABLED=true`,
   `MY_PRACTICE_ALLOWED_SUPABASE_REF=blwogrdezfhprdpdnxtn`, and omitted or
   explicit `MY_PRACTICE_FINANCIAL_MODE=payments_disabled`.

The target deliberately excludes `my_practice_synthetic_workspaces`,
`usage_wallets`, `usage_ledger`, `practice_booking_credits`,
`practice_payments`, `practice_commissions`, test-credit confirmation/complete
RPC and every `test_credits` default. `real_payments` remains blocked until A4.
Thus creating a request never creates a fictional payment, credit, commission
or `paid` state.

## Data, locking and safety risks

| Риск | Почему важен | Контроль / stop condition |
|---|---|---|
| Исторический timestamp drift | Runner не понимает семантическое совпадение по имени. | No `db push`, no repair, no manual history inserts; clone object diff first. |
| Existing clinical/financial data | Production содержит real records и A2 aggregates. | Clone only; no user-table exports; preserve IDs and never replay historical A2 data migrations. |
| RLS policy/grant gap | Advisor: 48 RLS-enabled tables without policies; exposure unknown. | Stop until clone captures `pg_policies`, table/function grants and Data API exposure. |
| A3.8 link cleanup | Historical SQL may alter/deactivate redundant links. | On clone count only; owner approval and explicit data-migration design before Production. |
| `ALTER TABLE` / backfill | A3.8.2 historical modules backfill and generated credit column could lock live tables. | New base starts with final columns; do not backfill Production A2. Use measured batching/`NOT VALID`/concurrent index only if a later data change is approved. |
| Booking exclusion constraint | Depends on `btree_gist`, concurrent writes and exact status semantics. | Extension present; create and test first on clone with synthetic only. |
| Clone-side external activity | Clone copies DB roles/data, but not all platform config; extensions like `pg_net`/`pg_cron` may cause external activity. | Before app tests, inspect and disable clone-only outbound schedules/webhooks under a separately approved procedure. |

No duplicate-link count, orphan count, referential-integrity aggregate, table
size, lock-time estimate or individual index/constraint inventory was executed
in this phase. The only permitted interface did not technically enforce raw
read-only catalog SQL; these remain `NOT VERIFIED` rather than inferred.

## Backup, PITR and cost

### What is verified

The organization is Pro. Official Supabase documentation states that Pro
projects normally have daily backups with seven-day retention, and that Restore
to a New Project is available only to paid projects with physical backups.
This is **plan capability**, not evidence of an actual backup for this project.

### What is not verified

* last successful backup and its timestamp;
* actual daily backup retention and whether a backup is selectable;
* PITR enabled/disabled state, earliest/latest recovery time, retention;
* clone screen availability and its exact current quote.

The Supabase API available to this audit did not expose backup/PITR metadata;
the Dashboard session was not authenticated. Therefore both **Backup
availability** and **PITR availability** are `NOT VERIFIED`.

### Owner verification checklist (no change)

In Production project `Tochka Opori`:

1. Open **Database → Backups → Scheduled** and record the latest successful
   backup time, available restore dates, retention and any failure banner.
2. Open **Database → Backups → Point in Time** and record whether PITR is
   enabled plus earliest/latest recovery points and retention. Do not toggle
   it and do not click restore.
3. Open **Restore to a New Project**, select no backup and do not continue;
   record only whether clone is offered and the displayed monthly resource
   quote. Exit without confirmation.
4. Share only the timestamps, statuses, plan/quote and screenshots with no
   user data or credentials.

Current published PITR prices are $0.137/hour (~$100/month) for 7 days,
$0.274/hour (~$200/month) for 14 days and $0.55/hour (~$400/month) for 28
days. PITR requires Pro/Team/Enterprise and at least Small compute. A clone
mirrors source compute and disk, so it incurs additional monthly project
charges; its exact amount is `NOT VERIFIED` until the Dashboard quote. Local
Colima rehearsal and this diagnostic audit create no continuing Supabase cost.

Sources: [Supabase backups](https://supabase.com/docs/guides/platform/backups),
[restore to a new project](https://supabase.com/docs/guides/platform/clone-project),
[PITR pricing](https://supabase.com/docs/guides/platform/manage-your-usage/point-in-time-recovery).

## Safe future clone rehearsal plan — not executed

| Шаг | Предусловия | Операция после отдельного разрешения | Риск / stop condition | Восстановление |
|---|---|---|---|---|
| 1. Backup sign-off | Owner completed checklist; timestamp satisfies agreed RPO. | Record approved source backup/PITR point. | No fresh successful backup or unknown retention → stop. | None; no state changes yet. |
| 2. Clone approval | Exact quote, billing owner approval, data-access list and retention/deletion date approved. | Use Dashboard Restore to a New Project from approved point. | Quote not approved, clone unavailable, or regulated-data policy forbids copy → stop. | Do not create clone. |
| 3. Isolation | Clone project ref, API credentials and outbound integrations inventoried. | Disable clone outbound cron/webhooks/replication under a dedicated approved runbook; do not point applications at clone. | Any route to real users/services remains → stop. | Pause clone access; correct isolation before tests. |
| 4. Object reconciliation | Technically read-only DB session on clone. | Capture migration history, schemas, views, columns, PK/FK, indexes, constraints, triggers, functions, RLS policies and grants; compare with Git/Test. | Any non-equivalence in drifted historical migrations → stop and design explicit forward fix. | Discard clone; Production untouched. |
| 5. Aggregate preflight | Approved synthetic test namespace/fixtures. | Compute only aggregate duplicate/orphan/constraint/table-size/lock-risk reports on clone. | Unexpected real-data invariant violation → stop; no repair. | Preserve report; discard clone if needed. |
| 6. Clinical base rehearsal | Written forward-only production bundle reviewed. | Apply only clinical base, then R2.2 request-only migration, first on clone. | Attempt to introduce wallets, credit payments, commission or `real_payments` → stop. | Recreate clone from original backup; never rollback live schema ad hoc. |
| 7. Verification | Clone migration succeeds. | Run synthetic A3/A5: links, Support/Health isolation, service publishing, default schedule, request/cancel booking, RLS role tests, medical versioning. | Any failed security/booking invariant → stop. | Clone-only forward repair/recreate. |
| 8. Production proposal | All clone evidence and maintenance plan reviewed. | Prepare separate Production change request with outage/communication/observer/rollback roles. | Owner has not explicitly approved each artifact → stop. | No Production operation. |

For a real Production incident, the recovery path is not a hand-written schema
rollback: stop application writes, record versions/error, restore or clone the
approved backup under owner control, validate schema and aggregate invariants,
then prepare a forward repair. A live restore is a separate destructive action
requiring its own owner confirmation.

## Required owner confirmations before R2.3.2

1. Latest successful backup timestamp, restore retention and selected recovery
   point for Production.
2. PITR status/retention, or an explicit acceptance of daily-backup RPO.
3. Clone availability, exact displayed monthly quote, budget owner and
   permitted retention/deletion date.
4. Permission to create an isolated clone that includes Production database and
   auth data, plus approved handling of the copied data.
5. A technically read-only clone session or approved clone-only catalog export
   for functions, triggers, policies, grants, views, constraints and indexes.
6. Approval of the forward-only clinical base bundle after it is separately
   designed and reviewed; no use of Test-only A2 SQL in Production.

## Gate table

| Проверка | Результат |
|---|---|
| Production schema inventory | **NOT VERIFIED** — core tables/metadata/extensions verified; full catalog objects need clone/read-only session. |
| Migration history reconciliation | **BLOCKED** — three Production and six Test timestamp drifts; no repair or replay allowed. |
| Test / Production schema comparison | **BLOCKED** — high-level missing A3/A5 set verified, but full object diff requires clone. |
| A3/A5 dependency map | **PASS** — clinical base and explicit financial exclusions defined. |
| RLS / grants audit | **NOT VERIFIED** — RLS enabled verified; 48 policy gaps reported; grants/policies not fully retrievable safely. |
| Backup availability | **NOT VERIFIED** — plan capability is not backup proof. |
| PITR availability | **NOT VERIFIED** — dashboard/API evidence unavailable. |
| Clone feasibility | **BLOCKED** — Pro plan qualifies in principle; concrete backup and quote unknown. |
| Migration rehearsal plan | **READY** — clone-only and forward-only, awaits approvals. |
| R2.3.1 | **NO-GO** for R2.3.2 / Production action. |

No Production/Test rows, cloud schemas, Vercel settings, billing, PITR,
backups, branches, deployments or remote Git state were changed in R2.3.1.
