# SEC-003-FIX — закрытие дополнительных bypass в `save` и `getReportStatus`

Дата локальной проверки: 2026-11-24  
Ветка: `codex/sec-003-legacy-bypass`  
Базовый commit: `2f05e9f282c51e50b15aac9c3197164eb3a21f6f`  
Вердикт: **READY FOR REVIEW**

## Границы работы

- Production, Preview, Supabase и SQL не изменялись.
- Commit, push, merge, deploy и миграции не выполнялись.
- Данные пациентов не читались и не удалялись; тесты используют только синтетические fixtures и in-memory mocks.
- Механизмы rotation continuation credential и rate limiting не менялись: они остаются в SEC-004/SEC-005.
- `docs/releases/qwen-r234b-preaudit.md` не изменялся.

## Изменённые файлы и диапазоны

| Файл | Диапазон | Назначение |
|---|---:|---|
| `api/session.js` | 565–843 | Авторизация `handleSave`, запрет client-id bootstrap, canonical owner/module, условный UPDATE |
| `api/session.js` | 2001–2098 | Авторизованный `handleGetReportStatus`, binding к request id и повторные условия в SELECT |
| `lib/security/access-token.js` | 8–123 | Общий exact-token resolver с module binding; экспорт hash для условных запросов |
| `lib/report/finalize.js` | 259–334 | Выдача continuation credential только после exact proof, module/owner/hash/legacy binding; access token не перевыпускается |
| `lib/report/finalize.js` | 375–413 | В final response добавлен bound `report_request_id` |
| `api/analyze.js` | 2211–2254, 2580–2650, 2939–3004 | Стабильный request id, передача уже выданного proof в finalization, без mint нового token |
| `src/App.jsx` | 2292–2328, 2791–2872, 2939–3175 | Безопасный bootstrap до первого запроса; polling/recovery с точной парой session/token и request id |
| `scripts/test-sec-003-legacy-access.js` | 305–768 | Route-level negative/positive/concurrency tests и source contracts |
| `scripts/acceptance-report-reliability.js` | 327–332, 424–436 | Локальный acceptance-flow адаптирован к bootstrap token и authenticated polling |
| `scripts/preview-acceptance.js` | 178–203, 238–246 | План Preview acceptance адаптирован; удалённо не запускался |
| `scripts/e2e-continuation.js` | 105–147 | Support fixture моделирует server bootstrap и не ожидает перевыпуск token |
| `package.json` | 27 | Воспроизводимая команда `npm run test:sec-003` |

## Серверная авторизация

### `handleSave`

1. Строка должна уже существовать; произвольный клиентский `sessionId` больше не создаёт сессию.
2. Обязательны `access_token`, точный `module=support`, canonical `anonymous_owner_id`, `legacy_access=false` и pilot scope.
3. `owner_id`/`anonymous_owner_id` из request отклоняются, а module/owner/token hash берутся из серверной строки.
4. UPDATE содержит predicates по row id, session, module, owner, token hash и legacy flag. Если любое из них изменилось между check и write, обновляется ноль строк и запрос завершается `409`.
5. Кошелёк, invitation side effects и continuation credential создаются только после успешного условного UPDATE. `handleSave` больше не mint/reissue access token.

### `handleGetReportStatus`

1. До чтения report fields проверяются `sessionId`, exact access token, `module=support`, canonical owner и `legacy_access=false`.
2. Token hash, module, owner и legacy flag повторены в metadata SELECT и protected-report SELECT. Ротация токена между validation и SELECT закрывает доступ.
3. `reportRequestId` должен точно совпасть с сохранённой операцией.
4. Polling не вызывает `createReportArtifacts`, не меняет состояние и не возвращает access token или full continuation credential.
5. Успешный ответ помечается `Cache-Control: no-store`.

### Finalization

`createReportArtifacts` принимает уже выданный bootstrap-token и повторно закрепляет session/module/owner/hash/legacy перед доступом к continuation store. Новый access token здесь не создаётся. Повторная finalization не возвращает секрет уже существующего credential.

## Безопасный bootstrap и client polling

`/api/start-session` уже реализует нужную архитектуру: сервер генерирует session id через `crypto.randomBytes(16)`, canonical owner через `crypto.randomUUID()`, создаёт modern row и затем выдаёт 256-bit access token. `App.jsx` ожидает этот bootstrap до первого Support-запроса и хранит session/token как атомарную пару.

При polling клиент:

- берёт token только из пары с тем же session id;
- передаёт `module=support`, `sessionId`, `reportRequestId` и `access_token`;
- прекращает retry при 401/403/409;
- при обрыве использует стабильный `support-final:<session>:<depth>`; тот же id возвращается в final/cached response;
- не принимает credential material из polling response.

## Тестовая матрица SEC-003-FIX

| Сценарий | Ожидание | Результат |
|---|---|---|
| Existing save без token | 401/403, нет write/side effects | PASS, 401 |
| Save с произвольным token | Отказ, нет write/credential | PASS, 403 |
| Save с token чужой сессии | Отказ | PASS, 403 |
| Save с точным token | Ровно один UPDATE, canonical fields сохранены | PASS, 200 |
| Подмена module/owner | Отказ | PASS, 403 |
| Legacy save с точным retained token | Отказ для protected write | PASS, 403 |
| Несуществующий client-chosen session id | Нет INSERT, требуется bootstrap | PASS, 409 |
| Server-bootstrapped modern session | Безопасный save с exact token | PASS, 200 |
| Два конкурентных first-save | Законный успех, чужой token не захватывает session | PASS, 200/403 |
| Token изменён между save-check и UPDATE | Zero-row CAS, нет credential | PASS, 409 |
| ReportStatus без proof | Отказ до protected read | PASS, 401 |
| ReportStatus с чужим proof | Отказ до protected read | PASS, 403 |
| ReportStatus с exact proof | Отчёт возвращён, `no-store` | PASS, 200 |
| Tampered request id | Нет report read/write | PASS, 409 |
| Support/Health mismatch | Отказ | PASS, 403 |
| Legacy report polling | Отказ до protected read | PASS, 403 |
| Repeated polling | Нет token/credential, нет mutation | PASS |
| Token rotated во время polling | Нет report read | PASS, fail closed |
| Invalid/rotated proof при finalization | Нет обращения к credential store | PASS |
| Потеря final response | Отчёт восстанавливается exact session/token/request-id polling | PASS на route/client contracts; remote E2E не запускался |

Во всех negative route-tests отдельно проверяется отсутствие protected UPDATE, credential creation, wallet side effects или protected report read.

## Локальные проверки

| Команда/набор | Статус |
|---|---|
| `npm run test:sec-003` | PASS |
| `npm run test:analyze-session-access` | PASS |
| `npm run test:session-access-pair` | PASS, 55 checks |
| Health diary auth/mock/comprehensive | PASS |
| `npm run test:usage-auth`, `npm run test:usage-session-owner` | PASS |
| Cabinet, bound review, specialist access, expert identity | PASS |
| Patient↔specialist linking | PASS, 95 checks |
| Browser patient→specialist→patient workflow на `127.0.0.1` | PASS |
| My Practice patient cabinet, multiple owner sessions | PASS |
| Practice sync, Health Live, pilot isolation | PASS |
| Server-side `node --check` | PASS |
| `npm run build` | PASS |
| `git diff --check` | PASS |

## Остаточные риски и Preview E2E

1. Full continuation credential является one-time секретом. Если соединение оборвалось после его создания, polling восстановит отчёт, но не вернёт секрет повторно. На устройстве остаётся bootstrap-token; из авторизованного кабинета можно создать новый continuation code. Это безопаснее, чем replay секрета через polling.
2. Connected Preview E2E не запускался по ограничению. Перед release нужно проверить: first Support session, normal final, forced response abort + polling, crisis final recovery, cabinet, continuation exchange, multiple sessions одного owner, Health intake/diary/cabinet, а также все negative подмены.
3. Legacy-сессии без современного proof по-прежнему требуют ручного recovery по плану SEC-003; автомиграция не выполнялась.
4. Race-safe rotation continuation credential и distributed/atomic rate limiting остаются отдельными SEC-004/SEC-005 и не блокируют review этого узкого fix.

## Заключение

Оба подтверждённых bypass закрыты на серверной границе. Локальные route-level, concurrency, Support/Health, cabinet и patient↔specialist regressions проходят. Изменения готовы к code review, но не к merge/deploy до отдельного Connected Preview E2E.
