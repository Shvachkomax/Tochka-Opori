# SEC-003-A3A5-CONTROLLED-INTEGRATION

Дата локальной проверки: 2026-11-25  
Режим: controlled local integration, без commit/push/deploy/SQL  
Итог: **INTEGRATION BLOCKED**

Блокировка локализована: новый безопасный Health bootstrap требует серверную функцию
`public.bootstrap_health_intake(...)`. Её наличие в целевой A3/A5 Supabase не было и не
могло быть подтверждено в разрешённом локальном режиме; ранее подготовленный read-only
отчёт фиксировал отсутствие функции в Test DB. Применение миграции в этом этапе прямо
запрещено. Остальная интеграция подготовлена, локальные unit/mock/browser проверки и
полная сборка прошли.

## 1. Исходные SHA

Перед созданием worktree выполнен повторный read-only `git ls-remote --heads origin`.

| Ref | Ожидаемый SHA | Подтверждённый SHA | Статус |
| --- | --- | --- | --- |
| `main` | `41ee386145aa82f828b1a63059d7b221ee889105` | тот же | PASS |
| `feature/my-practice-a3-patient-cabinet` | `2f05e9f282c51e50b15aac9c3197164eb3a21f6f` | тот же | PASS |
| `codex/sec-003-legacy-bypass` | `7e62625a0344b5f42a533923d2669e827399367c` | тот же | PASS |
| `codex/sec-003-a3a5-integration` | должна отсутствовать на remote | отсутствует | PASS |

Локальная ветка создана строго от `2f05e9f282c51e50b15aac9c3197164eb3a21f6f`.
Commit, merge, cherry-pick и rebase не выполнялись; HEAD новой ветки остался базовым SHA.

## 2. Новый worktree

- Исходная рабочая копия: `/Users/macintosh/Documents/ChatGPT/Точка опоры`.
- Новый worktree: `/Users/macintosh/Documents/ChatGPT/Точка опоры-sec-003-a3a5-integration`.
- Новая локальная ветка: `codex/sec-003-a3a5-integration`.
- Исходная рабочая копия не переключалась и не сбрасывалась.
- До создания проверены отсутствие локальной ветки, remote-ветки и целевого каталога.

До начала работы записаны SHA-256 пользовательских `AGENTS.md`, локальных release-отчётов
и `qwen-r234b-preaudit.md`. Финальная проверка подтвердила их неизменность.

## 3. Перенесённые исправления

### 3.1 Auth/Health пакет

Коммит `2eb4b3f9ed181387f429042cff097beaa78ac5dd` имеет родителя ровно
`2f05e9f282c51e50b15aac9c3197164eb3a21f6f`. Его 22-файловый diff применён как
неиндексированный локальный patch, а не как merge или commit. Перенесены:

- устранение `legacy_access` bypass в `validateSessionAccess`;
- обязательная привязка токена к `session_id`, `module` и canonical owner;
- авторизация save, report polling, finalization, дневников, истории и кабинета до
  защищённых побочных эффектов;
- запрет повторной выдачи access/continuation secret через polling;
- безопасная regeneration continuation credential с проверкой владельца;
- условные UPDATE существующих canonical sessions;
- безопасный fallback только через INSERT подтверждённого Health owner без upsert;
- 128-битный внутренний Health `session_id` и bounded collision retry;
- атомарный контракт Health bootstrap;
- regression/negative/concurrency тесты и read-only aggregate inventory SQL.

### 3.2 Runtime isolation и key attestation

Из runtime-коммита `7e62625a0344b5f42a533923d2669e827399367c` выборочно перенесены
центральный Supabase client, `api/reviews.js`, механизмы runtime/key attestation и тесты.
Временные SEC-specific отчёты этого коммита и изменение `vercel.json` из отдельного
коммита `02c332b4bdb7d9b4cc41cab2300a0e5834484f25` не переносились.

Runtime-часть затем переработана для A3/A5:

- source-controlled Vercel identities вынесены в
  `lib/security/deployment-identities.js`;
- test/live Supabase profiles и deployment policy вынесены в
  `lib/security/runtime-database-policy.js`;
- универсальные проверки ключа/URL/fingerprint/pepper остались в
  `lib/security/runtime-isolation.js`;
- key attestation принимает только source-controlled test/live targets;
- operator Preview verifier по-прежнему test-only;
- кэш Supabase привязан к URL, fingerprint ключа, organization scope и runtime identity;
- все проверки повторяются до возврата уже созданного кэшированного клиента.

## 4. Исправления и контракты, уже существовавшие в A3/A5

На базе `2f05e9f...` уже присутствовали и сохранены:

- разделённые continuation lookup code/secret, HMAC hash и модульный формат;
- общие continuation store/rate-limit primitives;
- атомарная client-side пара `session_id` + `access_token` для Support/Health;
- `DATABASE_REFS`, запрет live DB для Preview и базовая проверка purpose/ref;
- organization scoping и запрет scoped upsert;
- allowlist тестовых Vercel projects для My Practice;
- кабинеты Support/Health, дневники, голосовые сценарии;
- My Practice: специалист, календарь, услуги, тарифы, booking и patient cabinet;
- A5: медицинская карта, версии обращений, назначения и существующие сводки.

`lib/clinical/patient-draft-summary.js` не изменён. A5.2.2 не реализовывалась; действующий
текст по-прежнему явно говорит, что разговоры и фотографии не анализируются.

## 5. Решения по конфликтам

| Область | Решение |
| --- | --- |
| `api/session.js`, `api/analyze.js`, `src/App.jsx`, `package.json` | Применён exact-parent patch `2eb4b3f9...`; это изменения поверх той же A3/A5 базы, не замена файла из расходящейся истории. |
| `lib/supabase.js` | Сохранены A3 organization/My Practice gates; поверх добавлены универсальная проверка и runtime-bound cache. |
| My Practice allowlist | Вынесен в общий security-модуль и re-exported для обратной совместимости. |
| Runtime branch gate | Старое жёсткое условие `codex/sec-003-legacy-bypass` удалено из active runtime. |
| `vercel.json` | Не изменён: SEC branch-specific deployment guard не является универсальной A3/A5 конфигурацией. |
| Dependencies | Добавлены только npm scripts; версии пакетов и `package-lock.json` не изменены. |
| A5.2.2 | Не добавлялась и не имитировалась. |

Конфликтных маркеров нет; `git diff --check` проходит.
Финальный literal-secret scan всех 34 изменённых/new файлов: PASS; private keys, long-lived
API/service-role literals и JWT literals не найдены. В diff присутствуют только synthetic
fixtures и обращения к именам env. Реальные медицинские данные не добавлялись.

## 6. Рефакторинг Runtime Gate

### Доказано локально

- До чтения/создания клиента выбирается source-controlled test/live profile.
- Hosted runtime требует системные `VERCEL=1`, `VERCEL_ENV`, `VERCEL_PROJECT_ID` и
  `VERCEL_GIT_COMMIT_REF`.
- `EXPECTED_VERCEL_GIT_COMMIT_REF` только ограничивает системный Git ref, но не заменяет его.
- Vercel Project ID должен входить в source-controlled test allowlist либо совпадать с
  source-controlled Production ID.
- Preview/test profile принимает только test Supabase ref и точный HTTPS origin.
- Production profile принимает только live ref, Production Vercel project и `main`.
- Требуются `EXPECTED_SUPABASE_PROJECT` и
  `EXPECTED_SUPABASE_SERVICE_ROLE_KEY_SHA256`.
- SHA-256 фактического key сравнивается constant-time до `createClient`.
- Legacy JWT claims — только preflight; они не считаются подтверждением подписи.
- Modern `sb_secret` и legacy service-role JWT поддержаны.
- Pepper должен иметь не менее 32 bytes и не совпадать с DB credential.
- Изменение runtime identity, key, URL или organization блокирует warm cache reuse.
- Active `api/` и `lib/` не содержат другого импорта `@supabase/supabase-js` и прямого
  REST/Auth fetch к Supabase; operator-only attestation исключена из active runtime.

Runtime test: **PASS, 51 проверка**. Все отрицательные сценарии дошли до
`RUNTIME_ISOLATION_BLOCKED` при **0 созданных Supabase clients**. Сеть не использовалась.

Key attestation test: **PASS, 19 проверок**. Все HTTP-вызовы замокированы; попытка подменить
test endpoint на Production блокируется до `fetch`.

### Непроверено удалённо

- Новая ветка не имеет одобренной Vercel-конфигурации и не развёртывалась.
- Source-controlled Production Vercel ID взят из существующих A3 release tests, но не
  перепроверялся через Dashboard/API в этом локальном этапе.
- Фактические fingerprints и keys ни читались, ни проверялись.
- До будущего deploy нужно отдельно настроить expected Git ref/project ref/fingerprint для
  каждого target. Без них gate безопасно блокирует клиент.

## 7. Сохранение A3/A5

| Поверхность | Доказательство | Результат |
| --- | --- | --- |
| Support auth/continuation/report | SEC-003, session-pair, analyze, usage-owner, bound-review tests | PASS |
| Health bootstrap/collision/concurrency | SEC-003-FIX2 с barrier и PGlite SQL contract | PASS локально |
| Health cabinet/diary | cabinet, diary auth/comprehensive, session-pair tests | PASS |
| Голос | 45 MIME checks, Health Live mocked provider | PASS |
| Patient ↔ Specialist | синтетический localhost browser workflow | PASS |
| My Practice | полный `test:my-practice`, booking, patient cabinet | PASS |
| A3.8/A3.9 UI | синтетические browser E2E с mocked API | PASS |
| A5 карта | medical-record test | PASS |
| A5.2 draft | patient-draft test | PASS |
| Support/Health tours | unit + browser, без API/медицинских изменений | PASS |

Ни один тест не использовал реальные patient data, Vercel, Production или remote Supabase.

## 8. Матрица миграционных зависимостей

| Артефакт | Назначение / зависимость | Локально доказано | Состояние / действие |
| --- | --- | --- | --- |
| `20260814000000_production_baseline.sql` | Базовые `sessions`, `body_clients`, `body_intake_forms`, `continuation_credentials`, `usage_wallets` | Объекты присутствуют в repo baseline | Не применять вслепую к существующей БД. |
| `20260821155003_service_request_financial_lifecycle.sql` и `20261107150430_partner_twenty_percent.sql` | Определяют/обновляют `ensure_usage_wallet(text,uuid,text)` | Сигнатура является prerequisite bootstrap RPC | Выбрать фактически применённую линию по migration history. |
| `20261021000822_link_match_request_to_session.sql` | Unique `public.sessions(session_id)` | Collision contract использует unique conflict | Подтвердить индекс в target catalog. |
| `scripts/027-continuation-secrets.sql` / baseline | Continuation tables, owner/lookup uniqueness, RLS | SEC tests используют этот контракт | Скрипт не запускать; подтвердить фактическую схему. |
| Individual A3/A5 migrations `20261116...`–`20261122...` | Profile links, bookings, services, availability, A5 encounters | Локальные A3/A5 tests PASS | Не смешивать автоматически с consolidated path. |
| `20261123070309_r232_production_clinical_base_a3_a5.sql` | One-shot consolidated A3/A5 clinical surface | В repo дублирует ряд individual objects | Нужен exact history reconciliation; blind replay запрещён. |
| `20261123114523_r233_fix_continuation_failed_attempt_rpcs.sql` | Rate-limit RPC repair | Не изменён SEC-003 integration | Не применять в этом этапе. |
| `20261123223548_sec_003_health_bootstrap.sql` | Создаёт service-role-only atomic `bootstrap_health_intake` | PGlite contract, ACL/search_path/source tests PASS; patient DML при migration отсутствует | **BLOCKER:** target catalog не подтверждён, миграция не применялась. |

Ни одна SQL-команда, migration runner, `db push/reset/up` или remote query не выполнялись.
Файл SEC-003 Health migration перенесён из уже проверенного SEC commit; новая migration в
ходе интеграции не создавалась.

### Блокирующая зависимость SEC-003-A3A5-01

`lib/session/health-bootstrap.js` вызывает `bootstrap_health_intake`. При отсутствии RPC
новый Health intake безопасно завершится ошибкой без частичных данных, но создание нового
Health-профиля перестанет работать. Предыдущий локальный отчёт
`SEC-003-PREVIEW-0.md` фиксировал отсутствие RPC в Test DB на момент проверки. Актуальное
состояние catalog/history в этом задании не проверялось.

Для снятия блокировки нужен отдельный разрешённый этап:

1. read-only catalog и migration-history reconciliation именно разрешённой Test DB;
2. подтверждённый backup/restore point;
3. exact allowlist только требуемой migration, без replay каталога;
4. применение в транзакции отдельным разрешением;
5. проверка сигнатуры, `SECURITY INVOKER`, пустого `search_path`, ACL и уникальностей;
6. connected synthetic Health bootstrap/collision/rollback E2E.

## 9. Результаты тестов

| Проверка | Результат |
| --- | --- |
| `npm run test:sec-003` | PASS |
| `npm run test:sec-003-fix2` | PASS; entropy, collision, barrier concurrency, immutable medical snapshots, SQL contract |
| `npm run test:preview-gate` | PASS; 51 checks, 0 clients on all blocked cases |
| `npm run test:key-attestation` | PASS; 19 checks, mocked network only |
| `test:session-access-pair` | PASS; 55 checks |
| `test:analyze-session-access`, `test:usage-session-owner`, `test:bound-review-session` | PASS |
| Cabinet, continuation rate-limit, pilot isolation | PASS |
| `npm run test:my-practice` | PASS, включая локальные PostgreSQL/PGlite concurrency contracts |
| Booking и A3 patient cabinet | PASS |
| A5 medical record и A5.2 patient draft | PASS |
| Health diary auth/comprehensive | PASS |
| Health diary mock | Все assertions PASS; standalone harness оставляет открытый process handle, поэтому выполнен контролируемый wrapper exit. Это test-harness issue, не product assertion failure. |
| Voice MIME / Health Live / Support risk routing | PASS |
| Patient↔Specialist browser | PASS, localhost + mocked API |
| A3.8/A3.9 browser | PASS, localhost + mocked API |
| Support/Health patient tour browser | PASS 10/10, 0 API calls |

Connected scripts, которые читают `.env.local` или обращаются к Supabase, намеренно не
запускались. Реальные keys/credentials не читались.

## 10. Сборка

`npm run build`: **PASS**.

В build включены release-config, A3.8.1, A3.8.2, A3.9, полный My Practice,
specialist navigation, database architecture, Runtime Gate, Key Attestation, A5 medical
record, A5.2 draft и tours. Vite собрал 263 modules.

Неблокирующее предупреждение: основной minified chunk около 1.0 MB превышает 500 KB.
`npm ci` установил существующий lockfile без его изменения. Версии dependencies не менялись.
Install audit сообщил о 7 уязвимостях существующего lockfile (1 moderate, 4 high, 2
critical); автоматический `npm audit fix` не запускался, чтобы не менять зависимости вне
SEC-003.

## 11. Изменённые файлы

До добавления этого отчёта: 33 файла (17 tracked modified, 16 new). С отчётом: 34.

### Modified

1. `.env.example`
2. `api/analyze.js`
3. `api/reviews.js`
4. `api/session.js`
5. `api/start-session.js`
6. `api/transcribe.js`
7. `lib/my-practice/workspace-handler.js`
8. `lib/report/finalize.js`
9. `lib/security/access-token.js`
10. `lib/security/module-availability.js`
11. `lib/supabase.js`
12. `package.json`
13. `scripts/acceptance-report-reliability.js`
14. `scripts/e2e-continuation.js`
15. `scripts/preview-acceptance.js`
16. `scripts/test-analyze-session-access.js`
17. `src/App.jsx`

### New

18. `docs/releases/SEC-003-FIX.md`
19. `docs/releases/SEC-003-FIX2.md`
20. `docs/releases/SEC-003-legacy-bypass.md`
21. `docs/releases/SEC-003-A3A5-CONTROLLED-INTEGRATION.md`
22. `lib/security/deployment-identities.js`
23. `lib/security/runtime-database-policy.js`
24. `lib/security/runtime-isolation.js`
25. `lib/security/supabase-key-attestation.js`
26. `lib/session/continuation-access.js`
27. `lib/session/health-bootstrap.js`
28. `scripts/sec-003-legacy-access-inventory.sql`
29. `scripts/test-sec-003-fix2.js`
30. `scripts/test-sec-003-key-attestation.js`
31. `scripts/test-sec-003-legacy-access.js`
32. `scripts/test-sec-003-preview-gate.js`
33. `scripts/verify-sec-003-preview-key.js`
34. `supabase/migrations/20261123223548_sec_003_health_bootstrap.sql`

`package-lock.json`, `vercel.json` и A5/A3 migration history не изменены.

## 12. Остаточные риски

### Доказанные

- Legacy session без действительного credential больше не получает старые medical data по
  `publicCode`; это целевое изменение, но затрагивает законных legacy-пациентов.
- Health bootstrap требует отдельный RPC; без него новый intake fail-closed и недоступен.
- Новая ветка пока не опубликована, поэтому автоматический deployment не запускался.

### Допущения

- Production Vercel project ID взят из существующих A3 source tests.
- Четыре существующих test Vercel project IDs сохранены как общий allowlist ради A3/My
  Practice compatibility.
- Local `live` profile оставлен для управляемой оператором разработки, но также требует
  exact live ref, independently attested fingerprint и pepper.

### Непроверенные условия

- Актуальные Test/Production catalog и migration history.
- Branch-scoped Vercel env для новой ветки.
- Реальный service-role key/fingerprint и отдельный pepper.
- Connected Preview behavior, backup и restore point.
- Production env ещё может не содержать новые required expected Git ref/fingerprint vars;
  в таком случае будущий deployment будет fail-closed.

Дополнительный operational risk: `vercel.json` не содержит guard для новой integration
ветки. До любого будущего push необходимо отдельно доказать, что он не создаст deployment,
либо добавить и проверить отдельный deployment guard. В этом этапе push запрещён и не
выполнялся.

Legacy recovery должен выполняться только через независимое proof-of-possession или
подтверждённый уже открытый modern session. Короткий publicCode не является достаточным
доказательством; данные и owners автоматически не мигрируются и не удаляются.

## 13. Рекомендованный состав будущего локального коммита

После снятия `SEC-003-A3A5-01` рекомендован один локальный integration commit из ровно 34
файлов раздела 11. Перед staging повторить:

1. exact catalog/history решение по Health RPC;
2. все локальные security/A3/A5 tests и build;
3. `git diff --check`, secret/PII scan и exact file allowlist;
4. проверку неизменности `package-lock.json`, `vercel.json` и исходного worktree;
5. отдельный pre-push deployment guard review.

Не использовать `git add -A`; staging должен выполняться явным списком. Commit в этом
задании не создан.

## 14. Вердикт

**INTEGRATION BLOCKED**

Универсальные SEC-003 исправления перенесены, branch-specific Runtime Gate переработан,
A3/A5 и browser regressions прошли, полный build успешен. Однако строгий запрет этапа
требует BLOCKED, поскольку безопасность и работоспособность нового Health bootstrap зависят
от неподтверждённой и неприменённой schema capability `bootstrap_health_intake`.

Разблокировка требует отдельного read-only schema/history preflight и отдельно разрешённого
Test migration этапа. До этого нельзя создавать integration commit, push, Preview или тем
более Production deployment.
