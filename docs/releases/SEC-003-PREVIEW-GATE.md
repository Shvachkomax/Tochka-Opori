# SEC-003-PREVIEW-GATE — Runtime Isolation Gate

Дата проверки: 25 ноября 2026 года
Рабочая ветка: `codex/sec-003-legacy-bypass`
HEAD: `02c332b4bdb7d9b4cc41cab2300a0e5834484f25`
Vercel project: `tochka-opori-test` / `prj_BSzyfSJjjrCTI0RieWuVxR8qh3el`
Разрешённый Supabase Test ref: `eehyehlhiyztciaezaus`
Запрещённый для тестовых операций Production ref: `blwogrdezfhprdpdnxtn`

## Вердикт

**BLOCKED** для публикации/Preview-запуска.

Локальный Runtime Isolation Gate реализован, отрицательные тесты подтверждают ноль созданных DB-клиентов при блокировке, регрессии и полный build проходят. Блокирующее условие инфраструктурное: сохранённые branch-scoped `SUPABASE_SERVICE_ROLE_KEY` и `CONTINUATION_SECRET_PEPPER` имеют тип `Sensitive`, и доступные read-only Vercel CLI/MCP не возвращают их значения локальному процессу. Поэтому принадлежность фактически сохранённого ключа тестовому проекту и его пригодность для привилегированной серверной роли не подтверждены. Ни один запрос с этим ключом не выполнялся.

До закрытия этого пункта нельзя утверждать полную изоляцию будущего Connected Preview. Код готов к независимому review, но commit, push и deploy в рамках этой проверки не разрешены и не выполнялись.

## 1. Git и рабочее состояние

- Ветка и HEAD совпадают с заданием.
- Новых commit не создавалось.
- До начала работы уже существовали пользовательские изменения: `AGENTS.md`, `docs/DEVELOPMENT-POLICY.md`, `docs/releases/SEC-003-GIT-PREPARE.md`, `docs/releases/SEC-003-PREVIEW-0.md`, `docs/releases/qwen-r234b-preaudit.md`. Они не редактировались в этой задаче.
- `vercel.json` и запрет `git.deploymentEnabled=false` для ветки не изменялись.
- `docs/releases/qwen-r234b-preaudit.md` остался отдельным ранее существовавшим untracked-файлом и не включался в diff Runtime Isolation Gate.

## 2. Карта серверных подключений к Supabase

### Центральная точка

`lib/supabase.js:33-76` — единственная активная фабрика `@supabase/supabase-js`. `getSupabase()` выполняет runtime-проверку до создания **и до возврата** кэшированного клиента. Кэш дополнительно связан с точными URL, SHA-256 фактического ключа и `DEPLOYMENT_ORGANIZATION_ID`; любое изменение после инициализации блокируется без повторного клиента.

### Активные Vercel/API endpoints

Напрямую используют центральный `getSupabase`: `api/admin.js`, `api/analyze.js`, `api/clinical-contributions.js`, `api/clinical-knowledge.js`, `api/council.js`, `api/crisis.js`, `api/experts.js`, `api/practice-booking.js`, `api/reviews.js`, `api/session.js`, `api/specialist.js`, `api/start-session.js`, `api/transcribe.js`, `api/usage.js`.

Транзитивный путь `api/live-socket.js` идёт через `lib/voice/live-budget.js:3,54`, который также использует центральный клиент. `api/client-token.js` и `api/medical-staging-specialist-disabled.js` к Supabase не обращаются.

Критические SEC-003 пути:

- Health bootstrap: `api/analyze.js:744-764` → `lib/session/health-bootstrap.js:19-55` → RPC `bootstrap_health_intake`.
- Continuation exchange: `api/session.js:1671-1910` → центральный клиент; выдача токена через `lib/security/access-token.js:29-65`.
- Polling/report status: `api/session.js:1971-2065`.
- Continuation credential store: `lib/session/continuation-store.js:17-78`; Supabase передаётся только из уже защищённого API-пути.
- Health/Support live budget: `api/session.js:409-414` и `api/live-socket.js:33` → `lib/voice/live-budget.js`.

### Обнаруженные обходы и архив

До изменения `api/reviews.js` создавал пять собственных Supabase-клиентов и имел отдельный helper. Все активные пути заменены на `getSupabase()` (`api/reviews.js:138-140,226,355,462,539,628`).

В `lib/api-old/` остаются старые неактивные копии с прямым `createClient` и диагностическим `fetch`: `save-crisis-request.js`, `update-review-status.js`, `update-crisis-request-status.js`, `list-reviews.js`, `list-crisis-requests.js`, `check-env.js`. Поиск импортов и маршрутов подтвердил, что `api/`, `local-api-server.js` и активный `lib/` их не используют; Vercel routes находятся только в `api/`. Автоматический тест запрещает появление ссылки на `api-old` из активного server code. Архив не изменялся, но перед возможной реактивацией его необходимо удалить либо перевести на центральный клиент.

Импорт `lib/supabase.js` и всех `api/*.js` проверен в отдельном процессе без Supabase env: клиент и запросы при импорте не создаются.

## 3. Существовавшие риски

1. `lib/security/database-architecture.js` применялся в build-check, но не вызывался из runtime-фабрики; build-time контроль не защищал уже запущенную Function.
2. Прямые клиенты в `api/reviews.js` обходили общий My Practice guard и могли бы обойти новый runtime-gate.
3. Проверка только перед первой инициализацией позволила бы вернуть ранее кэшированный клиент после некорректного runtime-контекста.
4. Legacy service-role JWT содержит `ref` и `role`, но современный `sb_secret_...` является opaque; по одному формату нельзя доказать его принадлежность проекту.
5. Значение URL без точного сравнения origin могло бы допустить путь, query, userinfo или иной нестандартный адрес.

## 4. Реализованный Runtime Isolation Gate

`lib/security/runtime-isolation.js:6-168` содержит source-controlled allowlist SEC-003 и синхронную проверку до фабрики клиента.

Для SEC-003 обязательны:

- `VERCEL=1` и `VERCEL_ENV=preview`;
- `VERCEL_GIT_COMMIT_REF=codex/sec-003-legacy-bypass`;
- `VERCEL_PROJECT_ID=prj_BSzyfSJjjrCTI0RieWuVxR8qh3el`;
- при наличии `VERCEL_PROJECT_NAME` — точное имя `tochka-opori-test`;
- `DEPLOYMENT_PURPOSE=test`;
- `EXPECTED_SUPABASE_PROJECT=eehyehlhiyztciaezaus`;
- точное значение `SUPABASE_URL=https://eehyehlhiyztciaezaus.supabase.co` и повторная структурная проверка: HTTPS, без userinfo, порта, path, query и fragment;
- service-role credential и обязательный SHA-256 fingerprint независимо от формата ключа;
- `CONTINUATION_SECRET_PEPPER` длиной не менее 32 байт и не равный DB credential.

Vercel документирует `VERCEL_ENV`, `VERCEL_PROJECT_ID` и `VERCEL_PROJECT_NAME` как доступные build/runtime system variables; `VERCEL_GIT_COMMIT_REF` используется Vercel как системная Git-ветка. Источник: [Vercel System Environment Variables](https://vercel.com/docs/environment-variables/system-environment-variables). Если системные переменные не будут фактически экспонированы в deployment, gate завершится отказом до БД.

Для legacy JWT локально проверяются структура, `alg=HS256`, `ref` и `role=service_role`, но декодирование claims не считается проверкой подписи или доказательством владения. Для legacy JWT и opaque `sb_secret_...` обязательна одна branch-scoped переменная `EXPECTED_SUPABASE_SERVICE_ROLE_KEY_SHA256`: SHA-256 fingerprint должен быть независимо получен после успешной онлайн-проверки **тестового** server key и сравнивается constant-time до создания клиента. Значение ключа нигде не выводится. Supabase указывает, что `sb_secret_...` — backend-only opaque key с повышенными полномочиями, поэтому project binding нельзя извлечь из самого ключа: [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys).

Остальные Vercel Preview продолжают проходить общий `validateDatabaseArchitecture`, поэтому Preview не может молча использовать live DB. Обычный local runtime и не относящийся к SEC-003 Production runtime остаются в прежнем режиме. Это не является заключением о готовности Production-релиза.

## 5. Изменённые файлы

| Файл | Назначение |
|---|---|
| `lib/security/runtime-isolation.js` | Новый fail-closed runtime policy и привязка credential |
| `lib/supabase.js` | Gate до создания/возврата центрального клиента; инъецируемая фабрика для zero-call теста |
| `api/reviews.js` | Удалены активные прямые `createClient`; все пути идут через `getSupabase` |
| `scripts/test-sec-003-preview-gate.js` | Негативные/позитивные, cache, import-time и static-bypass тесты |
| `lib/security/supabase-key-attestation.js` | Allowlisted read-only `GET /rest/v1/`, запрет redirect и timeout без чтения body |
| `scripts/verify-sec-003-preview-key.js` | Операторский ввод через stdin/буфер Mac без аргумента, файла или вывода ключа |
| `scripts/test-sec-003-key-attestation.js` | Mock-only негативные тесты аттестации и zero-client проверки fingerprint gate |
| `package.json` | `test:preview-gate`, `test:key-attestation`, `verify:preview-key`; оба теста включены в build |
| `docs/releases/SEC-003-PREVIEW-GATE.md` | Этот отчёт |
| `docs/releases/SEC-003-KEY-ATTEST.md` | Операторская процедура и границы доказательства |

## 6. Результаты тестов

### Runtime gate

`npm run test:preview-gate` — **PASS**, 41 проверка, без сети.

`npm run test:key-attestation` — **PASS**, 17 проверок, только mock network; реальные Supabase endpoints не вызывались.

Отрицательные сценарии: отсутствующий/неверный purpose; отсутствующий/неверный expected ref; Production/wrong/malformed URL; URL с path/query/userinfo; отсутствующий ключ; чужой legacy ref; неверная role; отсутствующий или неверный fingerprint для любого server key; отсутствующий/короткий/reused pepper; Production Vercel env; отсутствующие runtime marker/branch; неверные branch/project ID/project name; generic Preview с live DB; повторное использование кэшированного клиента после смены runtime identity, URL/key или organization scope. Отдельная матрица аттестации блокирует неверный формат/алгоритм/роль, HTTP 401/redirect, подмену endpoint на Production, network failure и timeout.

Для каждой конфигурации из основной негативной матрицы инструментированная фабрика зафиксировала: `createClient=0`, `scopeDatabase=0`, DB query=0. Позитивные legacy, opaque/fingerprint и обычный Production без SEC-003 fingerprint сценарии разрешены. Active server code не содержит второго импорта Supabase SDK, прямого Supabase `fetch`, альтернативных credential env или импорта operator-only attestation helper.

### SEC-003 и регрессии

| Проверка | Результат |
|---|---|
| `npm run test:sec-003` | PASS — legacy bypass, save/report authorization, regeneration binding |
| `npm run test:sec-003-fix2` | PASS — entropy, collision, barrier concurrency, atomic bootstrap, no overwrite |
| `npm run test:session-access-pair` | PASS — 55 сценариев |
| `npm run test:analyze-session-access` | PASS |
| `npm run test:bound-review-session` | PASS |
| `npm run test:usage-auth` | PASS |
| `npm run test:health-live` | PASS, provider mocked |
| `test-health-diary-auth.js` | PASS |
| `test-health-diary-mock.js` | PASS; запуск через import wrapper с явным завершением из-за существующего открытого handle |
| specialist access / expert code | PASS |
| `test-patient-specialist-linking.js` | PASS — 95 сценариев |
| `npm run test:patient-specialist-workflow` | PASS — synthetic browser E2E на `127.0.0.1`; первый sandbox-запуск не мог bind порт, повторён с локальным разрешением |
| `npm run test:cabinet-defects` | PASS |
| `npm run build` | PASS; новый gate-test входит в build |
| `git diff --check` | PASS |

Первый полный build выявил несовместимость порядка сообщений с существующим My Practice guard. Порядок двух fail-closed проверок скорректирован без создания клиента; профильный тест My Practice и полный build после этого прошли.

## 7. Проверка принадлежности Supabase key

Vercel metadata подтвердили ровно пять branch-scoped Preview variables: три `plain` (`DEPLOYMENT_PURPOSE`, `EXPECTED_SUPABASE_PROJECT`, `SUPABASE_URL`) и две `sensitive` (`SUPABASE_SERVICE_ROLE_KEY`, `CONTINUATION_SECRET_PEPPER`). Значения Sensitive не были получены или выведены. `vercel env run` в текущем read-only контексте загрузил только доступные локальному процессу значения; оба Sensitive значения отсутствовали. Поэтому тип и фактическая принадлежность сохранённого ключа **NOT VERIFIED**.

Подготовлены `scripts/verify-sec-003-preview-key.js` и `lib/security/supabase-key-attestation.js`. Ключ принимается только через stdin либо буфер обмена macOS, не через argv/env/файл. Проверка обращается исключительно к source-controlled `https://eehyehlhiyztciaezaus.supabase.co/rest/v1/`, выполняет `GET`, запрещает redirect, ограничена таймаутом и не читает/не сохраняет body. В запросе нет пути к таблицам или Auth Users. SHA-256 вычисляется только после HTTP 200.

Безопасная операторская процедура:

1. Скопировать именно server key проекта `eehyehlhiyztciaezaus` в буфер Mac, не помещая его в аргумент команды, shell history или файл.
2. Локально выполнить `node ./scripts/verify-sec-003-preview-key.js --clipboard`. Скрипт очищает буфер до сетевого запроса; после PASS помещает туда только fingerprint. Для legacy JWT предварительно проверяются структура и claims, но доказательством считается только принятие ключа точным Test endpoint.
3. После отдельного разрешения передать fingerprint через stdin в branch-scoped Preview Config variable `EXPECTED_SUPABASE_SERVICE_ROLE_KEY_SHA256` проекта `prj_BSzyfSJjjrCTI0RieWuVxR8qh3el`. Не использовать `--value` и не брать ключ/fingerprint из Production.
4. Только после отдельного разрешения создать защищённый Preview. Фактическое совпадение сохранённого Vercel key и fingerprint подтверждается лишь успешным прохождением runtime-gate; один факт наличия env не является доказательством.
5. При любом отказе не запускать Connected E2E и не обращаться к Production URL.

В этой задаче удалённые env не изменялись, Preview не создавался, verifier не выполнялся и запросов к Supabase с сохранённым ключом не было.

## 8. Резервные копии

По предоставленному наблюдению в Supabase Test отображались Physical Backups:

- 25 ноября 2026, 02:54:08 UTC;
- 24 ноября 2026, 02:58:10 UTC;
- более ранние точки 18–23 ноября.

Кнопки Restore присутствуют. Это подтверждает только отображение точек в UI. Успешность восстановления, RPO/RTO и целостность копий не проверялись. Restore не запускался и не нажимался.

## 9. Статус Supabase и предупреждений

- Read-only project metadata для `eehyehlhiyztciaezaus` вернули `ACTIVE_HEALTHY`, регион `eu-west-1`, PostgreSQL 17.6.1. SQL и чтение таблиц не выполнялись.
- Официальный инцидент о некорректно отмеченных оплаченных счетах помечен `Resolved` 23 ноября 2026: [Supabase billing incident](https://status.supabase.com/incidents/01M843CVR1J1RD508Y1PTFYFSJ). Это не доказывает, что account-level баннер `Outstanding invoices` исчез; владелец должен проверить его вручную, без финансовой операции в рамках этого gate.
- Инцидент деградации Management/Data API остаётся в `Monitoring` и включает `eu-west-1`: [API endpoint degradation](https://status.supabase.com/incidents/01M85A4AS1YN8A7ZZEFED974TR). Метаданные конкретного проекта здоровы, но Connected E2E следует проводить только с фиксацией текущего status page и повторной проверкой project health.

## 10. Секреты и чувствительные данные

- Выполнен pattern scan изменённых server/test файлов: реальные Supabase/OpenAI/JWT credentials не найдены.
- В тестах используются только синтетические ключи, owners, session IDs и тексты.
- `.env*`, `data/`, экспортированные отчёты и медицинские записи не добавлялись и не читались.
- В выводе Vercel показывались только имена, scope/type и безопасные булевы результаты; значения Sensitive отсутствовали.
- Production Supabase не вызывался ни для сравнения, ни для теста.

## 11. Непроверенные предположения и остаточные риски

1. **Блокирующий:** принадлежность реально сохранённого service-role key тестовому проекту не подтверждена.
2. Системные Vercel identifiers документированы, но их фактическое наличие в ещё не созданном deployment этой ветки не наблюдалось. Отсутствие приведёт к безопасному отказу, а не к DB fallback.
3. Для любого формата server key потребуется шестая branch-scoped variable с независимо аттестованным fingerprint; тип текущего Sensitive key неизвестен.
4. Архив `lib/api-old/` содержит небезопасные исторические шаблоны. Он не маршрутизируется, но не должен быть реактивирован без отдельной очистки.
5. Реальное восстановление backup не проверено.
6. Connected Preview, миграция и реальные конкурентные PostgreSQL проверки в этой задаче не запускались.
7. Общий Production runtime не проходил release review этого изменения; текущий diff не следует продвигать в Production по результатам только этого отчёта.

## 12. Дальнейшая публикация и Connected Preview

До commit/push/deploy:

1. Провести независимый review локального diff и подтвердить исключение пользовательских pre-existing файлов.
2. Выполнить операторскую проверку ключа из раздела 7 и подготовить fingerprint variable независимо от типа ключа.
3. Подтвердить в Vercel, что System Environment Variables доступны Functions runtime и Preview Protection остаётся включённой.
4. Убедиться, что официальный инцидент не мешает тесту; account-level billing banner проверить вручную.
5. Только по отдельному разрешению создать защищённый Preview, не снимая текущий auto-deploy guard до согласованного шага.
6. Сначала выполнить runtime identity/key verifier, затем read-only smoke. Только после PASS применить разрешённую test migration и запустить Connected E2E на синтетических пользователях: Support/Health bootstrap, collision/concurrency, lost response/polling, continuation exchange, diary/cabinets/voice, patient↔specialist, негативные owner/module/token/session cases и неизменность данных.
7. При первом отказе gate или mismatch ключа остановить тест до любых DB операций. Production ref не использовать ни в одном сравнительном запросе.

Итог: локальная реализация готова к review, но **SEC-003-PREVIEW-GATE остаётся BLOCKED** до независимого подтверждения фактического test service-role credential в защищённом runtime.
