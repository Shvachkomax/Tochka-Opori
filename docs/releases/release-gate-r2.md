# Release Gate R2 — аудит миграций A3/A5

Дата аудита: 2026-11-22. Ветка: `feature/my-practice-a3-patient-cabinet`.
Проверенный SHA: `8fba52973027b2a6bf2772ebbeb43d79bed370e2`.

## Граница аудита

Проверены только Git и read-only метаданные Supabase Test
`eehyehlhiyztciaezaus` и Production `blwogrdezfhprdpdnxtn`.
Ни миграции, ни записи `supabase_migrations.schema_migrations`, ни данные,
RLS/grants, Vercel или Production не изменялись.

## Результат

**R2: NO-GO.** Текущая папка миграций не является безопасной цепочкой для
`supabase db push` в существующий Production. Причины:

1. В Production присутствуют исторические миграции с теми же именами, но
   другими версиями времени, чем в Git. У Test такая же проблема у первых
   шести миграций A3.8/A5. Простой migration runner считает их новыми и
   попробует выполнить повторно.
2. Production не содержит базовую My Practice/A2-схему. Девять миграций
   A3.8–A3.8.2 требуют как минимум `practice_places`, `practice_services`,
   `practice_availability`, `practice_bookings`, `practice_events`,
   `practice_commissions` и `practice_payments`.
3. Базовая A2-цепочка помечена в SQL как **TEST CONTOUR ONLY** и моделирует
   тестовую оплату. Её нельзя переносить в Production без отдельной
   совместимой production-спецификации и репетиции.
4. Чистая локальная репетиция не выполнена: на рабочем хосте нет Docker,
   Podman, Colima или локального PostgreSQL 17. Третий облачный проект не
   создавался, как требует задание.
5. PITR/наличие конкретных Production backups не удалось подтвердить
   имеющимися read-only средствами. До подтверждения это не считается
   существующим резервным копированием.

## Инвентаризация

| Объект | Git | Test | Production | Источник |
|---|---:|---:|---:|---|
| `experts`, `organizations`, `expert_organization_memberships` | да | да | да | `20260814000000_production_baseline.sql` |
| `patient_assignments`, `patient_access` | да | да | да | baseline + linking migrations |
| `patient_specialist_invitations` | да | да | да | `20260818000000_patient_specialist_linking.sql` |
| `usage_wallets`, `usage_ledger` | да | да | да | baseline, partner lifecycle |
| `practice_places`, `practice_services`, `practice_availability` | да | да | нет | `20261109120000_my_practice_bookings_a2.sql` |
| `practice_bookings`, `practice_payments`, `practice_commissions`, `practice_events` | да | да | нет | A2 and corrective migrations |
| `practice_patient_profile_links` | да | да | нет | A3.8 |
| `practice_booking_credits` | да | да | нет | A5 credit booking migration |
| `medical_encounter_versions` | да | да | нет | A5 |
| default-schedule RPC | да | да | нет | A3.8.1 |
| A3.8 link RPC/trigger | да | да | частично | A3.8 |
| service module column/index | да | да | нет | A3.8.2 |

В обоих проектах существующие общие таблицы имеют RLS. В Test новые
practice/A5-таблицы отозваны у `anon`/`authenticated` и доступны
`service_role`; у них нет RLS-политик, что является ожидаемой server-only /
default-deny архитектурой, а не автоматической уязвимостью. У общих
baseline-таблиц есть широкие grants, но при включённой RLS и отсутствии
политик внешний `anon`/`authenticated` доступ всё равно default-deny.

Проверенные привилегированные RPC в Test (`accept_specialist_invitation`,
`revoke_patient_specialist_link`, `ensure_default_practice_availability`,
`reset_default_practice_availability`) имеют `SECURITY DEFINER`, пустой
`search_path` и `EXECUTE` только для `service_role`. Аналогично ограничены
booking-credit и medical-record RPC. `practice_set_updated_at()` остаётся
публично исполнимой trigger-функцией без параметров; она не открывает данные,
но должна быть отозвана у внешних ролей отдельной проверенной hardening
миграцией до production-релиза.

## Расхождение истории миграций

Не добавлять недостающие строки в `schema_migrations` вручную или через
`migration repair`: это скрыло бы drift, а не доказало эквивалентность схем.

| Файл Git | Запись Test с тем же именем |
|---|---|
| `20261116082953_practice_patient_profile_links.sql` | `20261116090216` |
| `20261116084712_practice_booking_credit_payments.sql` | `20261116090231` |
| `20261116173150_medical_encounters_a5.sql` | `20261116173440` |
| `20261117184606_a38_unify_patient_specialist_links.sql` | `20261117185604` |
| `20261117185640_a38_harden_link_rpc_grants.sql` | `20261117185704` |
| `20261117193254_a38_preserve_support_client_identity.sql` | `20261117193424` |

Production также имеет несовпадающие версии для `link_match_request_to_session`,
`pneumointegration_shared_org_scope` и `partner_test_accruals`. Поэтому
сравнение только по имени недостаточно, а `db push` в любую уже существующую
базу сейчас запрещён планом R2.

Кроме истории, Test и Production отличаются ограничениями: у Production на
`patient_assignments` и `patient_access` есть внешние ключи к экспертам и
организациям, а в Test этих FK нет. В Test обнаружена одна активная
`patient_assignments` без существующей организации. Данные Test не
изменялись: для исправления нужен подтверждённый владелец синтетических
данных и отдельный обратимый data-repair. В Production агрегатная проверка
не обнаружила активных осиротевших assignment/access связей.

## Необходимая последовательность

Для чистой изолированной базы репозиторий должен применяться строго в
лексикографическом порядке всех файлов `supabase/migrations`. Для A3/A5
критический поднабор и зависимости следующие:

1. `20260814000000_production_baseline.sql` — `experts`, организации,
   Support/Health identity, wallets/ledger, RLS.
2. `20260814010000`–`20260826131822` — hardening, invitations, entitlement,
   pricing, clinical/medication prerequisites.
3. `20261005123149`–`20261028020916` — patient medication, tenant and
   partner/live-budget predecessors, если требуется весь current Git state.
4. `20261106053005_my_practice_synthetic_workspaces.sql` — только
   Preview/Test, не Production.
5. `20261109120000`, `20261109130000`, `20261109140000`,
   `20261110022907` — создают базовый My Practice/A2 каталог, график,
   записи и их серверные RPC; текущие файлы прямо помечены Test-only.
6. Девять A3/A5 файлов в точном порядке:
   `20261116082953`, `20261116084712`, `20261116173150`,
   `20261117184606`, `20261117185640`, `20261117193254`,
   `20261121081127`, `20261121083234`, `20261121133131`.

Пункты 4–5 нельзя выдавать за production-готовую архитектуру. Перед
Production нужен минимальный, forward-only набор migration-файлов, который
создаёт требуемую My Practice схему без synthetic workspace и без test-payment
семантики, сохраняет те же имена/PK/FK/RLS контракты и проходит чистую
репетицию. Это не должна быть параллельная модель данных.

## Данные, блокировки и восстановление

* `ensure_default_practice_availability` не изменяет имеющиеся строки, а
  создаёт семь 09:00–18:00 строк только в пустом контексте. Явный reset
  деактивирует старые интервалы и создаёт новый набор; записи не меняются.
* A3.8 деактивирует точные дубли `patient_access` при наличии канонического
  active assignment. Перед запуском нужен отчёт количества затрагиваемых
  строк и backup, потому что это data migration.
* `practice_services.modules` выполняет `ALTER TABLE`, backfill всех `NULL`,
  `NOT NULL`, `CHECK` и обычный GIN index. Это потенциально блокирует
  записи. Production-вариант должен разнести backfill на ограниченные
  транзакции, использовать `CHECK ... NOT VALID`/последующую validation и
  `CREATE INDEX CONCURRENTLY` вне транзакционного migration runner.
* `price_credits` — generated column; его добавление требует оценить
  table rewrite/lock на фактическом размере каталога. Медицинский индекс и
  все таблицы на чистой базе не несут migration-time data risk.

Перед любым Production запуском владелец обязан подтвердить в Dashboard
Database → Backups: доступный backup, план, тип/срок хранения и включённый
PITR (если нужен RPO менее суток). Без этого выполняется только анализ.
При аварии: остановить записи приложения, зафиксировать применённые версии и
ошибку, не запускать ручной schema rollback, восстановить/клонировать backup
в отдельную среду, проверить схему и данные, подготовить forward repair; live
restore допускается только отдельным подтверждением владельца.

## Воспроизводимая локальная репетиция

После установки Docker Desktop (или совместимого локального PostgreSQL 17) в
отдельной локальной среде, не подключённой к Test/Production:

```bash
supabase start
supabase db reset --local
supabase migration list --local
npm run build
SUPABASE_LOCAL_REHEARSAL=1 SUPABASE_URL=http://127.0.0.1:54321 \\
  SUPABASE_SERVICE_ROLE_KEY=<local-only-key> npm run e2e:a38
supabase stop
```

Перед `e2e:a38` в локальную среду передаются только локальные synthetic
ключи; URL обязан указывать на localhost, а данные cleanup-теста должны быть
проверены после выполнения. Не запускать этот набор с Production или с
неизолированными Test credentials. После репетиции следует снять каталоговый
снимок таблиц/FK/индексов/RLS/grants и сравнить с описанной целевой схемой.

## Проверки этого gate

| Проверка | Статус |
|---|---|
| Инвентаризация Git/Test/Production | PASS |
| Полная производственная цепочка миграций | FAIL |
| Чистая изолированная репетиция | NOT VERIFIED |
| Совместимость с существующей Test DB | FAIL (history/FK drift) |
| RLS и grants по каталогам | PASS; role E2E NOT VERIFIED |
| Сохранность существующих данных | NOT VERIFIED; Test orphan не менялся |
| Индексы и блокировки | PASS (оценка и план готовы) |
| Backup/PITR Production | NOT VERIFIED |
| План восстановления | READY |
| Готовность R2 | NO-GO |

Полный `npm run build`, unit/static tests A3.8.1/A3.8.2/A3.9/A5/A5.2,
бронирование/кредиты и экскурсии прошли. Local browser E2E A3.8 UI, A3.9 и
A3.7 (10/10) прошли. Remote Test Supabase E2E не запускался без test-only
service-role credentials и потому не создавал синтетические записи.
