# Release Gate R2.1 — локальная репетиция полной схемы Supabase

Дата: 2026-11-22. Ветка: `feature/my-practice-a3-patient-cabinet`.
Исходный Git SHA: `f812351d9ff536d91e1bfdc39c919e3289539353`.

## Итог

**R2.1: GO для воспроизводимой локальной схемы и проверенных A3/A5-сценариев.**
Полная цепочка из 49 миграций, включая baseline, My Practice/A2, A3.8–A3.9
и A5, успешно применена к новой локальной Supabase/PostgreSQL 17.6 базе два
раза. Реальные синтетические интеграционные тесты прошли и не оставили данных.

Это **не меняет R2 Production verdict: NO-GO**. Причины из
`release-gate-r2.md` остаются: history drift с существующими Test/Production
базами и Test-only семантика A2/платежей. R2.1 не выполнял и не предлагает
автоматический перенос A2 в Production.

## Граница работ

* Использовались только Colima/Docker и `127.0.0.1` локального Mac.
* Не выполнялись `supabase db push`, `supabase link`, `--linked`, удалённый
  `db reset`, remote SQL/API, Vercel-операции, Git push или merge.
* Test `eehyehlhiyztciaezaus`, Production, Vercel и GitHub не изменялись.
* До запуска Docker не содержал контейнеров или томов; чужие контейнеры и тома
  не удалялись. Локальные fixtures используют только случайные UUID и labels
  `A38 Synthetic` / `R21 Synthetic`.

## Окружение

| Компонент | Фактический результат | Статус |
|---|---|---|
| Host | Apple Silicon `arm64`, macOS 27.2.1, 48 GB RAM | PASS |
| Colima | Virtualization.Framework, `aarch64`, Docker runtime | PASS |
| Docker client / engine | 29.10.0 `darwin/arm64` / 29.5.2 `linux/arm64` | PASS |
| Docker resources до запуска | контейнеров и томов нет; порты 54320–54327 свободны | PASS |
| Репозиторный Node/CLI | Node 22.22.3 x64/Rosetta, Supabase CLI 2.109.1 x64 | NOT USED FOR REHEARSAL |
| R2.1 CLI | временный native `@supabase/cli-darwin-arm64@2.109.1`, Mach-O arm64 | PASS |
| Local config | PostgreSQL 17; migrations и `seed.sql` включены; API/DB/Studio 54321/54322/54323 | PASS |

Нативный CLI был подготовлен только в `/private/tmp`: текущие Node и
глобальный CLI не заменялись. Первая попытка npm-install отказалась с
`EBADPLATFORM`, потому что npm работал через x64 Node. Минимальное исправление
— скачать проверенный ARM64 пакет той же версии с `--force` во временный
каталог; binary затем подтвердил `arm64` и `2.109.1`.

## Команды и развёртывание

CLI справка проверена до запуска: `supabase start --help`,
`supabase db reset --help`, `supabase migration list --help`,
`supabase db advisors --help`.

1. `supabase start --yes` загрузил образы, но после миграций столкнулся с
   кратким конфликтом имени собственного временного DB-container. Повторная
   read-only инспекция немедленно подтвердила, что контейнер, тома и сеть уже
   отсутствуют; ничего вручную не удалялось.
2. Повторный полный старт применил все миграции и seed, но Vector Buckets
   alpha-container не смог bind-mount Unix socket Colima:
   `mkdir .../.colima/default/docker.sock: operation not supported`.
3. Официальный CLI поддерживает `supabase start --exclude vector`; Vector
   Buckets — alpha и не используется A3/A5. Поэтому выполнен
   `supabase start --yes --exclude vector`.
4. Core stack успешно запущен: PostgreSQL, Kong/API, Auth, PostgREST,
   Storage, Realtime, Edge Runtime, Mailpit, pgMeta, Analytics и Studio.
   `imgproxy` и pooler остановлены конфигурацией; `vector` — единственный
   явно исключённый сервис.
5. `supabase migration list --local` показал совпадение local/remote всех
   49 файлов. В `supabase_migrations.schema_migrations`: `49` строк,
   `49` уникальных версий, диапазон `20260814000000..20261121133131`.
6. Второй чистый запуск `supabase db reset --local` повторно применил все
   49 миграций и `supabase/seed.sql` без пропусков и ошибок.

## Минимальное исправление, найденное интеграцией

Первый реальный A3.8 E2E запуск получил `503` при сохранении места приёма.
Причина: сам E2E уже требовал `SUPABASE_LOCAL_REHEARSAL=1` и localhost, но
`isMyPracticeServerEnabled()` разрешал только Preview с точным cloud-ref.

Исправление в `lib/my-practice/workspace-handler.js` добавляет двойной
локальный opt-in только при всех условиях:

* `MY_PRACTICE_SERVER_ENABLED=true`;
* `SUPABASE_LOCAL_REHEARSAL=1`;
* нет `VERCEL_ENV` и `DEPLOYMENT_PURPOSE`;
* URL строго `http://localhost:54321` либо `http://127.0.0.1:54321`.

Production/Preview путь, точный Test ref и существующие fail-closed проверки
не изменены. Unit-тесты дополнительно доказывают отказ для Production и
другого порта. После исправления A3.8 E2E успешно прошёл.

## Фактические интеграционные проверки

| Проверка | Результат |
|---|---|
| A3.8.2 local E2E (`SUPABASE_LOCAL_REHEARSAL=1`) | PASS: приглашения, canonical/shared links, Support/Health isolation, каталог по modules, default schedule (7 строк, без дубликатов), слоты, confirmed booking, snapshot цены, отмена, запрет чужой отмены, symmetric revoke, cleanup |
| R2.1 real local PostgreSQL | PASS: credit debit/refund, immutable booking snapshot, медицинские draft/confirmed версии и correction reason, service-role path, `anon` denial, rollback cleanup |
| Очистка E2E | PASS: `a38_fixture_remnants=0`, `r21_fixture_remnants=0` |
| Дубликаты | PASS: active availability, assignments и access duplicate groups = 0 |
| RLS/grants | PASS: ключевые practice/A5 tables с RLS; `anon`/`authenticated` без SELECT; проверенные RPC доступны только `service_role` |
| `npm run build` | PASS: A3.6/A3.7 tours, A3.8.1/2, A3.9, My Practice, booking credits, A5/A5.2, navigation и Vite build |

Транзакционный real-Postgres тест запускается как `npm run e2e:r21-local`
при явно переданном `R21_LOCAL_DB_URL` и расположен в
`scripts/e2e-r21-local-postgres.mjs`. Он отказывается от non-local URL,
использует один `BEGIN`/`ROLLBACK`, затем проверяет, что его synthetic rows не
сохранились. Это не Test fixture и не платеж.

## Security/performance advisor

`supabase db advisors --local --type all --level info --fail-on none`:

* `0 ERROR`, `2 WARN`, `238 INFO`.
* Warnings: performance pattern в policy `usage_reservations_service_role_only`
  (`current_setting()` следует вынести в scalar subquery) и `btree_gist` в
  схеме `public`.
* Для A3/A5 есть INFO о покрывающих индексах отдельных FK (`practice_*` и
  `medical_encounter_versions.organization_id`). Это рекомендации к отдельной
  измеренной performance migration, а не основание менять историческую
  Test-only A2-схему в R2.1.
* Сообщения `RLS enabled, no policy` для server-only practice/A5 tables
  ожидаемы: прямые права `anon`/`authenticated` отозваны, что дополнительно
  подтверждено реальными denial-проверками.

## Оставшиеся ограничения

1. Vector Buckets local alpha service **NOT VERIFIED**: Colima virtiofs не
   поддерживает требуемый socket bind-mount. Схема и A3/A5 не используют его;
   core local rehearsal завершён без него.
2. CLI 2.109.1 успешно применил схему, но CLI сообщает о доступном v3.2.0.
   Обновление — отдельная задача с повторной репетицией, не выполнялось.
3. Advisor warnings и INFO об индексах не исправлялись без отдельного
   production-compatible решения и оценки блокировок.
4. R2 Production **NO-GO** сохраняется до forward-only production migration
   design, reconciliation history drift и отдельной production rehearsal.

## Вердикт

| Область | Статус |
|---|---|
| Полная локальная миграционная цепочка (49/49), повторный reset | GO |
| A3/A5 local synthetic integration, RLS, booking, credits, medical records | GO |
| Local Vector Buckets alpha service | NOT VERIFIED |
| Test/Production migration и release safety из R2 | NO-GO (не менялся) |
| Изменения Test/Production/Vercel/GitHub | отсутствуют |

Ссылки: [Supabase local development](https://supabase.com/docs/guides/local-development),
[CLI `start`/`--exclude`](https://supabase.com/docs/reference/cli/introduction),
[Vector Buckets local development (alpha)](https://supabase.com/docs/guides/storage/vector/local-development).
