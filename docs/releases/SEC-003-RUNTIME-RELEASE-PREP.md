# SEC-003-RUNTIME-RELEASE-PREP — финальный локальный release gate

Дата: 25 ноября 2026 года
Репозиторий: `Shvachkomax/Tochka-Opori`
Ветка: `codex/sec-003-legacy-bypass`
Исходный HEAD: `02c332b4bdb7d9b4cc41cab2300a0e5834484f25`

## Вердикт

**READY FOR LOCAL COMMIT.**

Проверяемый Runtime Isolation Gate работает fail-closed, локальные обязательные тесты и полный build проходят. В ходе этого release gate устранён дополнительный риск повторного использования кэшированного клиента после валидной полной смены URL/ключа либо organization scope. Commit, push, deploy, remote env changes и обращения к Supabase не выполнялись.

Этот вердикт разрешает только отдельное рассмотрение локального коммита. Он не является разрешением на push или Preview deployment.

## 1. Git branch и HEAD

- Активная ветка: `codex/sec-003-legacy-bypass`.
- HEAD совпадает с последним опубликованным SHA: `02c332b4bdb7d9b4cc41cab2300a0e5834484f25`.
- Staging area пуст.
- `git diff --check` до аудита прошёл.
- Ветка не переключалась; reset/clean не выполнялись.
- Существующие пользовательские изменения и untracked-файлы сохранены.
- `docs/releases/qwen-r234b-preaudit.md` не редактировался и остаётся вне предлагаемого commit.

## 2. Перечень проверенных файлов

Основная реализация:

- `lib/security/runtime-isolation.js`;
- `lib/supabase.js`;
- `api/reviews.js`;
- `lib/security/database-architecture.js`;
- `lib/security/deployment-scope.js`;
- `lib/my-practice/workspace-handler.js`;
- `lib/security/supabase-key-attestation.js`;
- `scripts/verify-sec-003-preview-key.js`;
- `scripts/test-sec-003-preview-gate.js`;
- `scripts/test-sec-003-key-attestation.js`;
- `package.json`;
- `vercel.json`;
- `.github/workflows/pilot-integration-gate.yml`;
- `.github/workflows/clinical-consolidation-preview.yml`.

Статически проверены все 17 активных `api/*.js`, весь активный `lib/`, `local-api-server.js` и их импорты. `lib/api-old/` рассмотрен как архив: из активного server code ссылок на него нет, Vercel-маршрутов в нём нет.

## 3. Архитектура Runtime Isolation Gate

Фактический серверный путь:

`API/lib consumer → getSupabase() → My Practice guard → assertRuntimeDatabaseIsolation() → env/URL/key/pepper checks → cache binding → createClient()`.

Для SEC-003 проверяются до создания клиента:

1. `VERCEL=1` и `VERCEL_ENV=preview`;
2. `DEPLOYMENT_PURPOSE=test`;
3. точная ветка `codex/sec-003-legacy-bypass`;
4. точный Vercel Project ID `prj_BSzyfSJjjrCTI0RieWuVxR8qh3el`;
5. при наличии — имя проекта `tochka-opori-test`;
6. `EXPECTED_SUPABASE_PROJECT=eehyehlhiyztciaezaus`;
7. точный URL `https://eehyehlhiyztciaezaus.supabase.co`;
8. service-role/secret credential и его независимо аттестованный SHA-256;
9. отдельный continuation pepper длиной не менее 32 байт.

URL проверяется и точным сравнением строки, и структурно: только HTTPS, без userinfo, порта, path, query и fragment. Production ref `blwogrdezfhprdpdnxtn` в SEC-003 Preview блокируется до фабрики клиента.

Единственный активный импорт `@supabase/supabase-js` находится в `lib/supabase.js`. Удалены пять прямых фабрик из `api/reviews.js`. Прямых Supabase `fetch`, fallback URL, `TEST_SUPABASE_*`/`SUPABASE_SECRET_KEYS` в active server code и импорта operator-only attestation helper из API нет. Импорт `lib/supabase.js` и всех API-модулей без env не инициализирует клиент.

### Защита кэша

Runtime gate вызывается перед каждым возвратом `getSupabase()`. Дополнительно кэш связан с:

- точным URL;
- SHA-256 фактического server key, без хранения или вывода исходного ключа;
- `DEPLOYMENT_ORGANIZATION_ID`.

После инициализации изменение любого из этих значений вызывает `SUPABASE_CLIENT_CONFIGURATION_CHANGED`; старый клиент не возвращается и новый не создаётся. Это закрывает случай, когда все runtime identity/env одновременно заменены другой формально валидной конфигурацией.

## 4. Контроль привязки ключа

Единственная переменная ожидаемого отпечатка:

`EXPECTED_SUPABASE_SERVICE_ROLE_KEY_SHA256`

Для legacy JWT локально проверяются три base64url-сегмента, `alg=HS256`, `ref=eehyehlhiyztciaezaus` и `role=service_role`. Декодирование claims не считается проверкой подписи. Для legacy JWT и `sb_secret_...` SHA-256 вычисляется от фактического `SUPABASE_SERVICE_ROLE_KEY`, ожидаемое значение читается из env, длина/hex-формат проверяются, сравнение выполняется через `timingSafeEqual`.

Подтверждено оператором, но не повторялось в этом аудите:

- реальный ключ распознан как `Legacy service_role JWT`;
- allowlisted Test endpoint вернул `VERIFIED_TEST_PROJECT`;
- результат — `PASS`;
- fingerprint добавлен как Sensitive branch-scoped Preview env;
- всего оператор видит шесть branch-scoped переменных SEC-003.

Секрет и fingerprint в этом аудите не читались и не выводились. Наличие переменных и операторский PASS не доказывают, что Vercel Function получила именно эту пару значений; это проверит только фактический runtime gate будущего Preview.

Актуальная документация Supabase подтверждает совместную поддержку legacy `service_role` и новых `sb_secret_...`, а также полный обход RLS для обоих серверных типов: <https://supabase.com/docs/guides/getting-started/api-keys>. Legacy-ключи объявлены устаревающими к концу 2026 года; миграция на отдельный `sb_secret` остаётся отдельной будущей задачей.

## 5. Положительные и отрицательные тесты

`npm run test:preview-gate` — **PASS, 41 проверка, без сети**.

Основная матрица отказов до инициализации подтверждает `createClient=0` и `scopeDatabase=0`. В cache-сценариях один synthetic client намеренно создаётся заранее; после изменения конфигурации старый клиент не возвращается и новый не создаётся:

| Сценарий | Результат |
|---|---|
| Нет/неверный `DEPLOYMENT_PURPOSE` | BLOCK |
| Не Preview / нет `VERCEL=1` | BLOCK |
| Нет/неверная ветка | BLOCK |
| Неверный Project ID/name | BLOCK |
| Нет/неверный expected project ref | BLOCK |
| Production, malformed, path/query/userinfo URL | BLOCK |
| Нет server key | BLOCK |
| Чужой ref/role legacy JWT | BLOCK |
| Нет/mismatch SHA-256 | BLOCK |
| Нет/короткий/reused pepper | BLOCK |
| Generic Preview с live DB | BLOCK |
| Возврат кэша после failed runtime check | BLOCK |
| Валидная смена ключа после кэширования | BLOCK |
| Полная смена Test → Production после кэширования | BLOCK |
| Смена organization scope после кэширования | BLOCK |
| Второй SDK import, Supabase fetch, alternate credential env | BLOCK static contract |

Положительные mocks:

- точная Test-конфигурация legacy JWT создаёт один synthetic client;
- `sb_secret` с правильным fingerprint проходит;
- обычная Production-конфигурация без SEC-003 fingerprint остаётся совместимой и создаёт один инъецированный synthetic client;
- никакие реальные ключи или базы не используются.

`npm run test:key-attestation` — **PASS, 17 проверок**: format/role/ref, legacy и `sb_secret`, HTTP 401/302, production-endpoint substitution, network/timeout, stdin/argv privacy, zero-client fingerprint failures. Сеть полностью mocked.

## 6. Регрессионные тесты

Пройдены локально:

- `test:sec-003` — legacy bypass, save/report polling, regeneration binding;
- `test:sec-003-fix2` — Health entropy, collision, barrier concurrency, atomic bootstrap, no overwrite;
- `test:session-access-pair` — 55 проверок;
- `test:analyze-session-access`;
- `test:bound-review-session`;
- `test:usage-auth`;
- `test:specialist-access-policy`;
- `test:expert-code-auth`;
- `test-continuation-rate-limit.js`;
- `test:health-live` — provider mocked;
- `test-health-diary-auth.js`;
- `test-health-diary-mock.js`;
- `test-patient-specialist-linking.js` — 95 проверок;
- `test:patient-specialist-workflow` — synthetic browser E2E, PASS после разрешения локального bind `127.0.0.1`;
- `test:cabinet-defects`;
- `test:my-practice-patient-cabinet`;
- `test:medical-record`;
- `test:my-practice-booking`;
- полный `test:my-practice`, включая server workspace, A3 cabinet, paid-booking guards и local PostgreSQL/PGlite concurrency.

Дополнительный `e2e:health-live` в текущем окружении не дошёл до приложения: локально отсутствует Playwright `chromium_headless_shell`. Устанавливать браузер или менять тестовый harness в этом security commit не выполнялось. Это инфраструктурное ограничение повторного запуска, а не провал application assertion; обязательный `test:health-live` и связанные Health/voice security tests прошли.

## 7. Результат полной сборки

`npm run build` — **PASS** после cache-binding исправления. Build включает release configuration, A3.8/A3.9, полный My Practice, specialist navigation, database architecture check, Runtime Isolation Gate, key attestation, A5, patient draft, tours и Vite production build.

Vite сохранил существующее неблокирующее предупреждение о chunk более 500 kB. Ошибок сборки нет.

Финальные `git diff --check`, conflict-marker/whitespace scan и pattern scan предполагаемых 11 файлов на Supabase/OpenAI/JWT/private-key secrets прошли без находок. Staging area осталась пустой.

## 8. Проверка Production-совместимости

- SEC-003-профиль включается только при наличии тестовых branch/project признаков.
- Обычный `VERCEL_ENV=production`, branch `main`, live ref и URL возвращают профиль `unchanged`.
- От Production не требуется `EXPECTED_SUPABASE_SERVICE_ROLE_KEY_SHA256` для Test.
- Положительный Production mock создаёт ровно один инъецированный клиент без сети.
- Test ref не используется как универсальное значение для Production.
- Если тестовая branch-scoped переменная ошибочно попадёт в Production, gate блокирует соединение — безопасный fail-closed результат.
- `DEPLOYMENT_ORGANIZATION_ID` включён в cache binding, поэтому старый tenant proxy не может быть повторно использован после смены scope.

Следовательно, локальный diff сам по себе не должен блокировать действующий Production после будущего merge. Перед Production rollout всё равно требуется отдельный release review и проверка актуальных Production env; этот аудит не является таким разрешением.

## 9. Статус защиты Vercel deployment

`vercel.json` успешно разбирается как JSON и содержит единственное локальное правило:

```json
{
  "git": {
    "deploymentEnabled": {
      "codex/sec-003-legacy-bypass": false
    }
  }
}
```

Совпадающего правила `true` в конфигурации нет. Официальная схема Vercel подтверждает, что `git.deploymentEnabled` с точной веткой отключает Git deployment, а любое совпадающее `true` имело бы приоритет: <https://vercel.com/docs/project-configuration/git-configuration>.

Оба GitHub Actions workflow выполняют только checkout/test/build; deploy command, deployment hook, `repository_dispatch` и Vercel API call отсутствуют. `main` и остальные ветки правилом не затронуты. `vercel.json` уже находится в опубликованном HEAD и в новый diff не входит.

## 10. Точный перечень файлов для коммита

В отдельный Runtime Isolation Gate commit включить ровно 11 файлов:

1. `api/reviews.js`;
2. `lib/supabase.js`;
3. `lib/security/runtime-isolation.js`;
4. `lib/security/supabase-key-attestation.js`;
5. `scripts/test-sec-003-preview-gate.js`;
6. `scripts/test-sec-003-key-attestation.js`;
7. `scripts/verify-sec-003-preview-key.js`;
8. `package.json`;
9. `docs/releases/SEC-003-PREVIEW-GATE.md`;
10. `docs/releases/SEC-003-KEY-ATTEST.md`;
11. `docs/releases/SEC-003-RUNTIME-RELEASE-PREP.md`.

Не включать:

- `AGENTS.md` — существующее пользовательское изменение;
- `docs/DEVELOPMENT-POLICY.md`;
- `docs/releases/SEC-003-GIT-PREPARE.md`;
- `docs/releases/SEC-003-PREVIEW-0.md`;
- `docs/releases/qwen-r234b-preaudit.md`;
- `.env*`, `.vercel/`, `data/`, `dist/` и любые выгрузки.

`vercel.json` не добавляется в список, поскольку guard уже присутствует в базовом HEAD и не изменён.

Рекомендуемый commit message:

`fix(security): enforce SEC-003 runtime database isolation`

Безопасная последовательность после отдельного разрешения на commit:

```bash
git add -- \
  api/reviews.js \
  lib/supabase.js \
  lib/security/runtime-isolation.js \
  lib/security/supabase-key-attestation.js \
  scripts/test-sec-003-preview-gate.js \
  scripts/test-sec-003-key-attestation.js \
  scripts/verify-sec-003-preview-key.js \
  package.json \
  docs/releases/SEC-003-PREVIEW-GATE.md \
  docs/releases/SEC-003-KEY-ATTEST.md \
  docs/releases/SEC-003-RUNTIME-RELEASE-PREP.md

git diff --cached --check
git diff --cached --name-only
git commit -m "fix(security): enforce SEC-003 runtime database isolation"
```

`git add -A` и `git add .` не использовать.

## 11. Оставшиеся риски

1. Фактическое совпадение Sensitive Vercel key и fingerprint доказывается только внутри будущего Preview runtime.
2. Доступность `VERCEL`, `VERCEL_ENV`, `VERCEL_PROJECT_ID` и `VERCEL_GIT_COMMIT_REF` для Function runtime должна быть наблюдена на реальном Preview. При отсутствии любого обязательного значения SEC-003-профиль, активированный branch env, откажет до клиента. Документация Vercel указывает эти переменные как build/runtime system env при включённом доступе: <https://vercel.com/docs/environment-variables/system-environment-variables>.
3. Legacy `service_role` должен быть отдельно мигрирован на `sb_secret` до завершения периода поддержки; этот commit сохраняет оба формата.
4. `lib/api-old/` содержит исторические прямые подключения. Сейчас он не активен; реактивация запрещена без перевода на центральный guard.
5. Текущий повтор Health Live browser E2E ограничен отсутствующим Playwright browser binary; CI/подготовленная Preview-среда должна повторить его.
6. Connected Preview, SQL-миграция и настоящие параллельные PostgreSQL соединения в этом задании не запускались.

## 12. Рекомендация по следующему этапу

### Доказано локально

- каждый активный Supabase server path проходит центральную фабрику;
- SEC-003 env/URL/key/fingerprint/pepper проверки выполняются до клиента;
- отрицательная матрица создаёт 0 DB-клиентов;
- старый cache не переживает смену runtime identity, URL, ключа или organization scope;
- обычный Production не требует Test fingerprint;
- deployment guard и отсутствие альтернативной CI-доставки подтверждены локально;
- обязательные регрессии и build прошли.

### Подтверждено оператором

- ключ типа Legacy `service_role` принят точным Test endpoint;
- получен PASS и fingerprint добавлен в branch-scoped Preview env;
- имена и scope шести переменных проверены оператором без публикации значений.

### Требует реального Preview runtime

- одновременное получение Function runtime всех шести branch env и системных Vercel identifiers;
- совпадение SHA-256 сохранённого key с сохранённым fingerprint;
- первое успешное прохождение gate до DB smoke;
- затем — Connected Preview E2E и только отдельно разрешённая Test-миграция.

Следующий допустимый шаг — отдельное разрешение на локальный commit ровно перечисленных файлов. После commit снова остановиться; push/deploy остаются запрещены без новых явных заданий.
