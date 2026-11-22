# Release Gate R2.2 — Production-совместимая архитектура My Practice / A3 / A5

Дата: 2026-11-22. Ветка: `feature/my-practice-a3-patient-cabinet`.
Исходный SHA: `04eefb43a301149db47c3a59ac406ad15706d167`.

## Итог

**R2.2: GO для кода, чистой локальной схемы и безопасного разделения
финансовых режимов.** Клинические кабинеты, привязки, каталог, расписание и
запись теперь не требуют тестового кошелька. В Preview/Test кредитный контур
сохраняется только при явном server-side `MY_PRACTICE_FINANCIAL_MODE=test_credits`.
В валидированном Production-окружении отсутствие этой переменной означает
`payments_disabled`, а не тестовую оплату.

Это **не разрешение на Production migration, merge, push или deployment**.
Production history drift из R2 сохраняется; ниже подготовлен контролируемый
forward-only порядок, который сначала должен быть проверен на клоне Production
и отдельно подтверждён владельцем.

## Карта зависимостей

| Компонент | Данные / RPC / серверный код | Класс | Граница R2.2 |
|---|---|---|---|
| Специалисты и организации | `experts`, `organizations`, `expert_organization_memberships`; `api/specialist.js` | Базовый клинический/организационный | Membership проверяется до операций в контексте организации. Специалист может состоять в нескольких организациях. |
| Привязка пациента | `patient_assignments` (primary), `patient_access` (additional), `patient_specialist_invitations`; `accept_specialist_invitation`, `revoke_patient_specialist_link` | Базовый клинический | Один канонический primary или additional link по owner/module/org; Support (`anonymous_case`) и Health (`anonymous_profile`) изолированы. |
| Связанные профили | `practice_patient_profile_links`; `patient-cabinet.js` | Базовый UX | Только явная двусторонняя связь; владельцы клинических данных не подменяются. |
| Каталог и места | `practice_places`, `practice_services`, `modules`; `handlePracticePlaces`, `handlePracticeServices` | Каталог / scheduling | Цена хранится в `price_kop`; публикация, physician/org/place/module проверяются сервером. |
| Расписание | `practice_availability`; `ensure_default_practice_availability`, `reset_default_practice_availability` | Scheduling | Семь строк 09:00–18:00 создаются только в пустом контексте; reset требует подтверждение; существующие booking не переписываются. |
| Поиск слотов | `practice_availability`, `practice_bookings`; `slotsForServiceDay`, `reserve_practice_booking` | Booking | Context-aware availability и DB exclusion защищают от двойного бронирования. |
| Неоплаченная заявка | `practice_bookings.status='requested'`; `request_practice_booking_without_payment`, `cancel_practice_booking_request` | Базовый booking | Не создаёт строк кошелька, кредитов, оплаты или комиссии; слот остаётся занят. |
| Test credits | `usage_wallets`, `usage_ledger`, `practice_booking_credits`; `reserve/pay/cancel/complete_*_with_credits` | Только Test financial | Доступен лишь в разрешённом Preview/Test или explicit local rehearsal с явным режимом. |
| A2 simulated payment и комиссия | `practice_payments`, `practice_commissions`, `practice_events`; legacy `confirm/complete` | Test financial / A4 prep | История не меняется. Новый Production path их не вызывает. |
| A5/A5.2 | `medical_encounter_versions`, version RPC; `lib/clinical/*` | Клинический | Не зависит от wallet/credit/payment и остаётся service-role-only. |
| Будущий A4 | `real_payments` mode | Зарезервировано | Всегда блокируется `REAL_PAYMENTS_NOT_IMPLEMENTED`; не создаёт фиктивный `paid` и не включает эквайринг. |

## Реализованное разделение бронирования и оплаты

Новый файл `lib/my-practice/financial-mode.js` решает режим **только из
server env и точного URL Supabase**. Клиент не может передать или выбрать режим.

| Контекст | Разрешённый режим | Поведение |
|---|---|---|
| Local Supabase (`SUPABASE_LOCAL_REHEARSAL=1`, localhost:54321) | Явный `test_credits` или `payments_disabled` | Local tests могут проверять оба режима. Без переменной финансовые действия отклоняются. |
| Разрешённый Vercel Preview/Test + `eehyehlhiyztciaezaus` | Явный `test_credits` или `payments_disabled` | Кредиты не включаются неявно. |
| Production + exact live DB `blwogrdezfhprdpdnxtn` | По умолчанию `payments_disabled` | Каталог, расписание и заявка работают; подтверждение/списание/комиссия не выполняются. |
| Любая неизвестная/противоречивая конфигурация | нет | Financial action получает fail-closed отказ. |
| Любое окружение + `real_payments` | нет | `REAL_PAYMENTS_NOT_IMPLEMENTED`. |
| Production + `test_credits` | нет | `TEST_CREDITS_FORBIDDEN_IN_PRODUCTION`. |

`payments_disabled` создаёт `requested`, а не `confirmed` и не `paid`.
Она блокирует слот той же PostgreSQL exclusion constraint, отображается врачу и
пациенту как «Заявка без оплаты» и может быть отменена без refund. Кнопка
кредитной оплаты, wallet и финансовая витрина скрыты для этого режима. В
`test_credits` прежние A2 RPC и все существующие credit snapshots сохраняются.

## Новая миграция

`supabase/migrations/20261122125416_my_practice_payment_modes.sql`:

1. расширяет существующий `practice_bookings.status` значением `requested`;
2. расширяет exclusion constraint на `held`, `requested`, `confirmed`;
3. добавляет service-role-only RPC `request_practice_booking_without_payment`;
4. добавляет service-role-only RPC `cancel_practice_booking_request`;
5. отзывает широкий direct `EXECUTE` у trigger function
   `practice_set_updated_at()`;
6. не трогает исторические `practice_booking_credits`, кошельки, оплаты,
   комиссии или ранее созданные записи.

RPC сначала вызывает уже проверенный атомарный guard availability/service/
idempotency, затем в той же транзакции переводит только созданный `held` в
`requested`. Это сохраняет блокировку слота, короткую транзакцию и единый
порядок блокировок без внешних payment calls внутри SQL transaction.

## Чистая локальная установка

На Colima/Apple Silicon выполнен `supabase db reset --local`. Все **50/50**
миграций применились в лексикографическом порядке, включая новую R2.2. Затем
использовались только `127.0.0.1` и случайные UUID synthetic fixtures.

Повторяемый локальный порядок:

```bash
supabase start --yes --exclude vector
supabase db reset --local
SUPABASE_LOCAL_REHEARSAL=1 MY_PRACTICE_SERVER_ENABLED=true \
  MY_PRACTICE_FINANCIAL_MODE=test_credits \
  SUPABASE_URL=<local-api-url> SUPABASE_SERVICE_ROLE_KEY=<local-only-key> \
  npm run e2e:r21-local
SUPABASE_LOCAL_REHEARSAL=1 MY_PRACTICE_SERVER_ENABLED=true \
  SUPABASE_URL=<local-api-url> SUPABASE_SERVICE_ROLE_KEY=<local-only-key> \
  npm run e2e:r22-local
```

Локальный vector alpha container по-прежнему исключается из-за ограничения
Colima virtiofs; он не используется A3/A5/R2.2.

## Production migration: безопасный порядок B

Production не имеет A2/practice tables, а записи migration history отличаются
по timestamp от Git. Поэтому **нельзя** запускать `supabase db push`, вручную
вставлять строки в `schema_migrations` или выполнять `migration repair` до
доказательства эквивалентности объектов.

### Предусловия и preflight на read-only clone

Владелец должен сначала предоставить свежий clone Production и подтвердить
backup/PITR. На clone выполнить:

```sql
select version, name from supabase_migrations.schema_migrations order by version;

select to_regclass('public.practice_places') as practice_places,
       to_regclass('public.practice_services') as practice_services,
       to_regclass('public.practice_availability') as practice_availability,
       to_regclass('public.practice_bookings') as practice_bookings,
       to_regclass('public.practice_patient_profile_links') as profile_links,
       to_regclass('public.medical_encounter_versions') as medical_versions;

select conrelid::regclass as table_name, conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid in ('public.patient_assignments'::regclass, 'public.patient_access'::regclass)
order by 1, 2;

select count(*) filter (where status = 'active') as active_rows,
       count(*) filter (where owner_id is null and public_code is null) as unresolved_identity
from public.patient_assignments;

select count(*) filter (where status = 'active') as active_rows,
       count(*) filter (where owner_id is null and public_code is null) as unresolved_identity
from public.patient_access;
```

Expected current Production baseline: clinical identity/org tables exist; the
six `practice_*` base tables, `practice_patient_profile_links` and A5 version
table do not. Existing Production has no active orphan assignment/access rows
according to R2 read-only audit. Any other result is a stop condition.

### Forward-only deployment bundle (after approval only)

1. Reconcile the three historical timestamp drifts by comparing canonical
   object definitions on the clone, not by marking versions applied.
2. Apply an idempotent **production clinical base** bundle to the clone:
   `practice_places`, `practice_services` (with `modules`),
   `practice_availability`, `practice_bookings`, `practice_events`, profile
   links, default-schedule RPC, canonical invitation/link RPC and A5 table.
   It must preserve the existing baseline `experts`, organizations,
   memberships, `patient_assignments` and `patient_access`; it must not create
   `usage_wallets`, `usage_ledger`, `practice_booking_credits`,
   `practice_payments`, `practice_commissions`, synthetic workspaces or A2
   test-payment RPC.
3. Apply the R2.2 status/request migration adapted to that base (same table,
   constraint, functions and service-role grants as `20261122125416`).
4. Configure only Production server variables:
   `MY_PRACTICE_SERVER_ENABLED=true`,
   `MY_PRACTICE_ALLOWED_SUPABASE_REF=blwogrdezfhprdpdnxtn`, and either omit
   `MY_PRACTICE_FINANCIAL_MODE` or set it to `payments_disabled`.
   Do not set `test_credits` or `real_payments`.
5. Run clinical, RLS and request/cancel smoke tests against the clone. Only
   then prepare a separately approved Production change window.

The bundle is deliberately not auto-applied from the current Test/A2 migration
chain: reusing that chain would install test wallets/payment semantics as a
Production prerequisite and would bypass the unresolved history drift. This is
one model of data, not a parallel catalog: table and FK names remain the
existing My Practice names.

### Postflight queries

```sql
select c.relname, c.relrowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('practice_places','practice_services','practice_availability',
                    'practice_bookings','practice_events','practice_patient_profile_links',
                    'medical_encounter_versions')
order by c.relname;

select routine_name, grantee
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name in ('request_practice_booking_without_payment',
                       'cancel_practice_booking_request',
                       'ensure_default_practice_availability',
                       'reset_default_practice_availability')
order by routine_name, grantee;

select status, count(*) from public.practice_bookings group by status order by status;

select count(*) as duplicate_active_slots
from (
  select a.id
  from public.practice_bookings a
  join public.practice_bookings b on a.id < b.id
    and a.expert_id = b.expert_id
    and a.status in ('held','requested','confirmed')
    and b.status in ('held','requested','confirmed')
    and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(b.starts_at, b.ends_at, '[)')
) conflicts;
```

Expected: RLS enabled; new RPC execute only for `service_role`; no duplicate
active slot. The final query is an invariant check, not a data repair command.

## RLS, authorization and safety

* Practice/A5 tables remain RLS-enabled and server-role mediated; no new
  `anon`/`authenticated` grant is added.
* New RPCs revoke `PUBLIC`, `anon`, `authenticated` and re-grant only
  `service_role`; API verifies patient session or physician membership before
  the RPC.
* Final local privilege/invariant query confirmed: 50 migrations (latest
  `20261122125416`), both new RPCs are granted only to owner `postgres` and
  `service_role`, `anon` is denied (`42501`), there are zero overlapping active
  slots and zero remaining R2.2 synthetic fixtures.
* `requested` participates in both SQL exclusion and slot calculations, so
  disabled payments cannot reopen an occupied slot.
* The patient catalog only resolves attached specialists and published services
  in the current Support/Health module. An unavailable server is still shown
  separately from “no attached specialist”.
* Existing confirmed/test-credit bookings retain their current status and
  financial snapshots. No historical financial row is recomputed.
* A3.6/A3.7 tours, A3.9 navigation and A5/A5.2 records have no dependency on
  a payment mode; regression tests below confirm this.

## Executed tests

| Проверка | Статус | Фактический результат |
|---|---|---|
| Чистые миграции | PASS | Local `db reset --local`: 50/50 migrations, including R2.2. |
| Scenario A — `test_credits` | PASS | R2.1 real PostgreSQL: debit/refund, price snapshot, cancellation, service-role and medical record/RLS; A3.8 local E2E preserved credit booking. |
| Scenario B — `payments_disabled` | PASS | `e2e:r22-local`: attached doctor/catalog/7-day schedule/slots; `requested`; zero credit/payment/commission rows; cancellation; conflict protection. |
| Scenario C — bad config / `real_payments` | PASS | Local E2E and unit matrix: `FINANCIAL_MODE_REQUIRED`, `REAL_PAYMENTS_NOT_IMPLEMENTED`, Production test-credit denial. |
| Privileges / post-cleanup invariants | PASS | New booking RPCs: only `postgres` + `service_role`; anonymous execution denied (`42501`); active overlap = 0; R2.2 fixture residue = 0. |
| A3.8 | PASS | local E2E: canonical/shared links, Support/Health isolation, services, schedule, booking/cancellation/revoke cleanup. |
| A3.6 browser | PASS | Three-step doctor tour: desktop/mobile no overlap with fields/buttons; repeat entry no autostart. |
| A3.7 browser | PASS | 10/10: seven Support + seven Health steps, no mobile overlap, empty states, split progress, no API/payment/medical side effects. |
| A3.9 browser | PASS | all-directions list, aggregate calendar, module-specific card, mobile layout. |
| A5 / A5.2 | PASS | `npm run build`: immutable versions, rights/revoke, module isolation, provenance and bounds. |
| Regression build | PASS | `npm run build` passed all included checks and Vite production build. |

## Изменённые файлы

* `lib/my-practice/financial-mode.js` — server-only mode resolution.
* `lib/my-practice/workspace-handler.js`, `api/specialist.js`,
  `lib/supabase.js` — separate Production clinical gate from Test-only
  synthetic workspace gate.
* `lib/my-practice/booking-handler.js`, `patient-cabinet.js`,
  `booking-utils.js` — mode-aware reads/actions and `requested` slot blocking.
* `src/pages/specialist/PracticePatientBooking.jsx`,
  `PracticeBookingPanel.jsx` — truthful disabled-payment wording; no fake
  payment confirmation.
* `supabase/migrations/20261122125416_my_practice_payment_modes.sql` — new
  unpaid request schema/RPC only.
* `scripts/e2e-r22-financial-modes.mjs` and unit/browser fixtures — local
  coverage of modes and preserved A3 flows.

## Ограничения и A4 handoff

1. R2.2 does not implement acquirer, checkout, webhook verification, fiscal
   receipts, refunds, payouts, KYC or real commission settlement.
2. A4 may enable `real_payments` only after a separate schema/provider design,
   idempotent provider event ledger, verified webhook authentication, payment
   state machine, refund policy, reconciliation tests, security review and
   explicit owner approval. Until then the code refuses it.
3. Before Production migration, owner approval is required for clone/backup
   validation, historical drift reconciliation, forward-only base bundle,
   maintenance window and postflight results.
4. Local vector alpha is still not verified; it is unrelated to the release
   surface covered here.

## Verdict

| Проверка | Статус |
|---|---|
| Карта зависимостей My Practice | PASS |
| Отделение клинического контура от A2 | PASS |
| Режим `test_credits` | PASS |
| Режим `payments_disabled` | PASS |
| Блокировка `real_payments` | PASS |
| Чистые миграции | PASS |
| План Production-миграций | READY (требует clone/owner approval) |
| RLS и авторизация | PASS |
| Локальные E2E | PASS |
| Регрессионные тесты | PASS |
| Итог R2.2 | **GO** |

Cloud Test DB, Production Supabase, Vercel, GitHub remote, merge и deployment
в R2.2 **не изменялись**. Final SHA is recorded after the local commit.
