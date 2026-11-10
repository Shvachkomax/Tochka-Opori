# Production Release Plan — «Точка опоры»

Дата подготовки: 10 ноября 2026 года
Интеграционный HEAD: `3b117d98cd826e01f6432d3d7b1300b459f8307f`
PR №16: https://github.com/Shvachkomax/Tochka-Opori/pull/16
Статус PR: OPEN/DRAFT

## 0. Текущий вывод

Документ описывает контролируемую подготовку Production-релиза. Он не является разрешением на merge, миграции или deployment.

Текущий статус: **NO-GO для Production**.

Причины:

1. В integration были добавлены Preview/Test-функции, для которых нет Production-safe миграций и Production acceptance.
2. A2 «Моя практика» использует тестовые платежи, тестовые комиссии и UTC-расписание.
3. Health/Support Live и Langfuse предназначены только для принятого Preview test-контура.
4. Для реального выпуска ещё не выполнены device acceptance на iPhone Safari, production backup/restore drill и проверка фактической пары Production Supabase credentials.
5. Полное wall-clock ожидание A2 hold ровно 10 минут не выполнялось; проверены расчёт 600 секунд и expiry/release-ветка в Test.

До перехода к Production необходимо отдельное решение владельца по каждому пункту GO/NO-GO в конце документа.

## 1. Архитектура и границы

### 1.1 Единая платформа

- `main` остаётся единой Production-веткой.
- Support, Health, «Моя практика» и Clinical Knowledge собираются из одного репозитория.
- Бренды `tochka-opory`, `anmed`, `kgmu`, `pneumointegration` выбираются конфигурацией `VITE_APP_BRAND`, серверным `DEPLOYMENT_ORGANIZATION_ID`, ролями и `allowed_modules`.
- Для `kgmu` и `pneumointegration` серверный scope организации обязателен; отсутствие scope блокирует deployment.
- Партнёрские витрины не являются отдельными версиями кабинета врача и не имеют отдельных постоянных реализаций A1/A2.

### 1.2 Текущее состояние refs

- `origin/main`: `090d8bae3a09b973413af1c5b731710b4f73199b`
- `origin/integration/health-telemetry-main`: `3b117d98cd826e01f6432d3d7b1300b459f8307f`
- Merge base совпадает с текущим `main` до будущего отдельного merge.
- PR №16 остаётся OPEN/DRAFT.

## 2. Матрица готовности функций

| Функция | Текущий режим | Что проверено | Production-решение | Риск |
|---|---|---|---|---|
| Support, обычный текстовый поток | Общий код | Support risk, session access, cabinet tests | Допускать после финальной privacy/access проверки | Средний |
| Кризисная маршрутизация | Общий код | `test-crisis-mobile`, emergency links 112/103, safety flow | Допускать только после повторного browser smoke на release candidate | Высокий |
| Health-дневник | Общий код | Health Live gates, session pair, auth tests | Допускать при подтверждённых Production credentials и backup policy | Средний |
| Standard Voice/transcription | Общий код | MIME/PCM и mocked provider tests | iPhone Safari device acceptance обязателен | Высокий |
| Health/Support Live | Preview + `DEPLOYMENT_PURPOSE=test` | Budget, relay, PCM и mocked lifecycle tests | Production выключено | Высокий |
| AI telemetry/Langfuse | Preview test only | Privacy-safe export/no-network tests | Production выключено до отдельного observability approval | Средний |
| A1 FullCalendar | Preview flag | FullCalendar, navigation, organization tests | Production flag пока выключен; нужен отдельный UX rollout | Средний |
| A2 Server Booking | Test Supabase only | RPC, auth, TTL, idempotency, 10-way contention, 20% test fee | Production выключено; не переносить test migrations | Высокий |
| Clinical Knowledge | Mock/review-oriented | Clinical Knowledge and medication routing tests | Не считать клиническим Production-релизом без content/reviewer acceptance | Средний |
| Partner accounting | Test credits | Accounting, DB/API, organization isolation | Не является рублёвой выплатой; Production выключено | Высокий |

## 3. Supabase plan

### 3.1 Read-only findings

В связанном Test Supabase история миграций содержит все A2-миграции до:

```text
20261110022907_my_practice_bookings_a2_hardening.sql
```

В integration добавлены следующие миграции:

1. `20261028020916_live_test_budget.sql` — общий тестовый бюджет Live.
2. `20261106053005_my_practice_synthetic_workspaces.sql` — синтетические Preview workspace.
3. `20261107150430_partner_twenty_percent.sql` — test partner accounting, 20% для новых начислений.
4. `20261109120000_my_practice_bookings_a2.sql` — A2 tables/RPC/RLS.
5. `20261109130000_my_practice_bookings_a2_corrective.sql` — payment idempotency и guards.
6. `20261109140000_my_practice_bookings_a2_ttl_semantics.sql` — `p_ttl_minutes`, expiry и `[)` intervals.
7. `20261110022907_my_practice_bookings_a2_hardening.sql` — валидные SQLSTATE, persistent expiry, unique commission.

### 3.2 Классификация миграций

**Production-safe без изменений:** новых миграций в этом списке нет.

**Test/Preview-only, не применять в Production:**

- `live_test_budgets`, `live_test_bindings`, `live_test_reservations`;
- `my_practice_synthetic_workspaces`;
- `partner_test_accounts` и связанные test credit/refill изменения;
- `practice_places`, `practice_services`, `practice_availability`, `practice_bookings`, `practice_payments`, `practice_commissions`, `practice_events`;
- RPC тестовой оплаты и тестовой комиссии.

Особенно опасно автоматически переносить `20261107150430`: она меняет defaults и test wallet balances и содержит `UPDATE` существующих test-wallet записей. Это не Production migration для реальных финансов.

### 3.3 Обязательный Production migration workflow

До любой Production migration:

1. Зафиксировать release commit и список migrations.
2. Read-only сравнить `supabase migration list` для Test и Production.
3. Проверить `supabase db diff`/schema dump против целевой Production-схемы.
4. Исключить все Test-only migrations из Production package.
5. Для каждой Production-safe migration подготовить dependency order, SQL review и rollback/forward-fix plan.
6. Получить backup/PITR checkpoint и подтвердить успешную проверку восстановления.
7. Применять migrations только через утверждённый Production process, не из feature/integration Preview.
8. После каждого шага выполнять schema/RLS/grant smoke test.

В рамках этой задачи Production schema не читалась с использованием Production credentials и не изменялась.

### 3.4 Backup и восстановление

Перед релизом:

- подтвердить включённые Supabase backups/PITR и retention policy;
- зафиксировать timestamp/backup identifier перед migration window;
- получить schema dump без секретов и проверить его checksum;
- провести восстановление в разрешённом изолированном recovery process, не направляя пользователей на восстановленную копию до проверки;
- отдельно проверить RLS, функции, grants, triggers и индексы после восстановления.

### 3.5 Rollback

- Код: вернуть предыдущий Production deployment/commit через Vercel rollback.
- Схема: не рассчитывать на автоматический down migration. Для Production migrations требуются forward-compatible rollback scripts.
- Данные: partner/test accruals, payment rows и usage ledger нельзя откатывать простым `DROP`; требуется транзакционный reconciliation/forward correction.
- A2 test tables не должны появиться в Production, поэтому их Production rollback не планируется — они исключаются на этапе migration review.

## 4. Vercel/GitHub release plan

### 4.1 Production configuration

Read-only listing Production проекта показывает:

- `DEPLOYMENT_PURPOSE=live`;
- Production `SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` существуют, но значения скрыты и в этом аудите не раскрывались;
- Production-specific Live/Telemetry/My Practice flags в listing не включены.

Перед релизом владелец должен безопасно подтвердить, что Production URL/key относятся к Production Supabase, а не к `eehyehlhiyztciaezaus`. Само наличие скрытых переменных не доказывает правильность их пары.

### 4.2 Flags, которые должны быть выключены

В Production оставить unset/false:

- `MY_PRACTICE_SERVER_ENABLED`;
- `MY_PRACTICE_REQUIRE_TEST_DB`;
- `MY_PRACTICE_ALLOWED_SUPABASE_REF`;
- `VITE_ENABLE_MY_PRACTICE_PILOT`;
- `VITE_ENABLE_MY_PRACTICE_SERVER_UI`;
- `HEALTH_LIVE_ENABLED`, `SUPPORT_LIVE_ENABLED`;
- `VITE_HEALTH_LIVE_ENABLED`, `VITE_SUPPORT_LIVE_ENABLED`;
- `LIVE_BUDGET_RELAY_ENABLED`;
- `AI_TELEMETRY_ENABLED` и Langfuse secrets;
- test partner accrual/payment flags.

Vite уже принудительно выключает Preview/test UI flags, если `VERCEL_ENV` не `preview` и `DEPLOYMENT_PURPOSE` не `test`. Это защитный слой, но не замена проверке Production environment variables.

### 4.3 Последовательность выпуска

1. Зафиксировать release tag/commit после отдельного approval PR №16.
2. Выполнить `npm ci` и `npm run build` на exact commit.
3. Создать Production deployment только через существующий Vercel проект и общий `main`.
4. Проверить deployment env, response headers и отсутствие Preview-only flags.
5. Выполнить smoke: landing, Support, crisis route, Health cabinet, continuation access, specialist login, Clinical Knowledge read-only.
6. Проверить отсутствие обращений к Live socket, Langfuse и A2 booking endpoints.
7. Наблюдать ошибки/latency/AI provider failures в release window.
8. При регрессии откатить Vercel deployment на предыдущий Production deployment; DB rollback выполнять только по отдельному runbook.

## 5. Функциональная приёмка

### Support

- обычный текстовый сценарий;
- safety questions и emergency links `112`/`103`;
- crisis continuation/recovery;
- обращения специалисту и ownership checks;
- отсутствие сырых credential/PII в логах.

### Health

- intake, diary save/read, owner/session pair;
- reload и continuation recovery;
- wallet/usage ownership;
- body module separation from Support;
- no real AI telemetry in Production.

### Specialist cabinet

- login, expiry/revocation, membership and organization scope;
- no cross-organization patient leakage;
- Clinical Knowledge read-only/review permissions;
- A1 calendar only when separately enabled;
- A2 remains disabled in Production.

### Voice

- iPhone Safari real device: MP4 recording, upload MIME, interruption, retry, permission denial, background/resume;
- Android/desktop smoke;
- Live remains excluded from Production until budget, provider, legal and privacy approval.

### Credits and finance

- existing AI credit ledger: owner/module/request idempotency;
- no test partner credit tables in Production;
- no `provider=test` payments in Production;
- no ruble commission payout before a separate payment/legal/reconciliation release.

## 6. Open technical decisions

### Time zones

Current A2 schedule semantics are UTC. Before Production booking:

1. Store an explicit IANA timezone for doctor/place or organization.
2. Keep booking timestamps as `timestamptz`.
3. Calculate recurring availability in the configured local timezone and convert to UTC.
4. Add DST boundary tests, including spring-forward/fall-back and cross-midnight windows.
5. Display the same timezone label to doctor and patient.

### Ten-minute hold

Production acceptance must include a real Test-environment wait or controlled clock procedure proving:

- `expires_at` passes after exactly 10 minutes;
- expired hold no longer blocks a slot;
- confirm after expiry is rejected;
- retry with the same idempotency key is deterministic;
- browser reload preserves the server booking;
- disconnect/retry cannot create duplicate payment or commission.

### Real payments

Production payment GO requires:

- provider contract and webhook signature verification;
- payment idempotency and replay handling;
- refund/chargeback reconciliation;
- separate payment ledger and accounting reports;
- PCI/legal/security review;
- no test provider or test commission code path in Production.

### Personal and medical data

- RLS policy review for every exposed table;
- service-role key never exposed to browser;
- log redaction review for prompts, reports, tokens and audio metadata;
- backup encryption/retention/deletion policy;
- access audit for specialist organization scope;
- privacy/DPA and incident-response review before real patient data.

## 7. GO / NO-GO checklist

### GO only when all are true

- [ ] PR №16 approved and merged to `main` by the owner.
- [ ] Production Supabase URL/key pair independently verified.
- [ ] Production-safe migration set reviewed; Test-only migrations excluded.
- [ ] Backup/PITR checkpoint and restore drill completed.
- [ ] Production flags audited and experimental flags disabled.
- [ ] Support, crisis, Health, auth and continuation smoke passed on release commit.
- [ ] iPhone Safari Voice acceptance passed or Voice explicitly remains disabled.
- [ ] A1 timezone/rollout decision approved.
- [ ] A2 timezone, real 10-minute hold and payment decision approved, or A2 remains disabled.
- [ ] Clinical content and partner financial/legal review completed.
- [ ] Monitoring and rollback owners assigned.

### Immediate NO-GO conditions

- [ ] Any Support cabinet `ReferenceError` or failed crisis recovery test.
- [ ] Production env points to Test Supabase or cannot be verified.
- [ ] Any Test-only migration is queued for automatic Production application.
- [ ] Any Live/Langfuse/My Practice/test-payment flag is enabled unintentionally.
- [ ] Cross-organization or cross-patient access violation.
- [ ] Backup/restore or rollback procedure is untested.

## 8. Release decision for current HEAD

Current decision: **NO-GO for Production release**.

The integration branch is suitable for continued Test/Preview validation after the Support regression fix. A separate release approval is required before merge to `main`, Production deployment, Production migrations or enabling any experimental function.
