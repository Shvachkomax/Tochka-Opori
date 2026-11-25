# SEC-003-KEY-ATTEST — независимая привязка Supabase server key

Дата подготовки: 25 ноября 2026 года
Ветка: `codex/sec-003-legacy-bypass`
Разрешённый Supabase Test ref: `eehyehlhiyztciaezaus`
Запрещённый для тестовых операций Production ref: `blwogrdezfhprdpdnxtn`
Vercel project: `tochka-opori-test` / `prj_BSzyfSJjjrCTI0RieWuVxR8qh3el`

## Вердикт

**READY FOR OPERATOR ATTESTATION.**

Локальная процедура и fail-closed тесты готовы. Реальный ключ не вводился, операторская онлайн-проверка не запускалась, удалённые env не менялись, deployment не выполнялся. Поэтому этот вердикт означает готовность безопасно провести аттестацию, а не подтверждение принадлежности уже сохранённого в Vercel ключа.

## 1. Существующий механизм привязки

Точное имя ожидаемой переменной:

`EXPECTED_SUPABASE_SERVICE_ROLE_KEY_SHA256`

Это единственный механизм SHA-256-привязки в `lib/security/runtime-isolation.js`. Он применяется к legacy `service_role` JWT и современному `sb_secret_...`. Gate требует 64 строчных hex-символа и сравнивает ожидаемое значение с SHA-256 фактического `SUPABASE_SERVICE_ROLE_KEY` через `timingSafeEqual` до вызова фабрики `@supabase/supabase-js`.

Legacy JWT до сети проходит только структурную проверку: три base64url-сегмента, `alg=HS256`, опциональный `typ=JWT`, точные claims `ref=eehyehlhiyztciaezaus` и `role=service_role`. Это не проверка подписи и не доказательство принадлежности. Доказательство даёт только принятие исходного ключа API gateway точного тестового проекта, после чего вычисляется fingerprint именно принятого ключа.

## 2. Безопасная операторская команда на Mac

1. В панели **тестового** Supabase проекта получить server key и скопировать его в буфер Mac. Не вставлять ключ в shell, argv, `.env`, файл или отчёт.
2. Из корня репозитория выполнить:

```bash
node ./scripts/verify-sec-003-preview-key.js --clipboard
```

Скрипт читает ключ через `/usr/bin/pbpaste`, немедленно очищает буфер через `/usr/bin/pbcopy`, затем выполняет единственный сетевой запрос. При PASS в буфер помещается уже не ключ, а его SHA-256 fingerprint.

Альтернатива для защищённого stdin-потока:

```bash
node ./scripts/verify-sec-003-preview-key.js --stdin
```

Интерактивный TTY отклоняется, чтобы ключ случайно не отобразился. Ключ как аргумент команды также отклоняется. Нормальный вывод состоит только из четырёх строк: тип ключа, статус, SHA-256 и `PASS`/`BLOCKED`.

## 3. Сетевой протокол проверки

- Единственный разрешённый URL: `https://eehyehlhiyztciaezaus.supabase.co/rest/v1/`.
- Метод: только `GET`.
- Ключ передаётся только в заголовке `apikey`.
- Redirect запрещён (`redirect: error`).
- Таймаут: 10 секунд.
- Body не читается, не сохраняется и не выводится; поток ответа отменяется.
- Запросов к таблицам, Auth Users, Storage и другим пользовательским ресурсам нет.
- Любой ответ, кроме HTTP 200, network error или timeout даёт `BLOCKED`; fingerprint при отказе не вычисляется.

Официальная документация Supabase описывает корень Data API как `/rest/v1/` и указывает, что этот OpenAPI endpoint допускает только `secret`/`service_role` ключи, тогда как publishable/`anon` получает 401: [Data REST API](https://supabase.com/docs/guides/api), [API keys](https://supabase.com/docs/guides/getting-started/api-keys).

## 4. Привязка fingerprint к Vercel

Только после операторского PASS и отдельного разрешения на изменение remote env выполнить команду, читающую fingerprint из буфера через stdin:

```bash
pbpaste | vercel env add EXPECTED_SUPABASE_SERVICE_ROLE_KEY_SHA256 preview --git-branch codex/sec-003-legacy-bypass --project prj_BSzyfSJjjrCTI0RieWuVxR8qh3el --visibility config --yes
```

Не использовать `--value`: это поместило бы значение в argv. `--git-branch` ограничивает новую переменную конкретной веткой; `preview` не затрагивает Production; `--project` фиксирует точный Vercel project. Fingerprint не является исходным ключом и хранится как Config, но не должен находиться в исходном коде.

Если branch-scoped переменная уже существует, не применять `--force` вслепую. После read-only проверки scope обновить её отдельной подтверждённой операцией:

```bash
pbpaste | vercel env update EXPECTED_SUPABASE_SERVICE_ROLE_KEY_SHA256 preview codex/sec-003-legacy-bypass --project prj_BSzyfSJjjrCTI0RieWuVxR8qh3el --visibility config --yes
```

Обе команды приведены как инструкция и в этой задаче не выполнялись. Синтаксис проверен по локальному Vercel CLI 58.9.4; перед реальным изменением следует повторно проверить `vercel env add --help`/`update --help`.

## 5. Автоматические проверки

| Сценарий | Результат | Сеть / DB-клиент |
|---|---|---|
| Ключ отсутствует | BLOCKED | 0 / 0 |
| Неверный формат | BLOCKED | 0 / 0 |
| Legacy JWT с `alg=none` | BLOCKED | 0 / 0 |
| Неверная role или project claim | BLOCKED | 0 / 0 |
| Test API не принимает ключ (HTTP 401) | BLOCKED | mock / 0 |
| Redirect (HTTP 302) | BLOCKED | mock / 0 |
| Подмена endpoint на Production | BLOCKED до fetch | 0 / 0 |
| Network error / timeout | BLOCKED | mock / 0 |
| Ожидаемый SHA-256 отсутствует | BLOCKED до клиента | 0 / 0 |
| SHA-256 не совпадает | BLOCKED до клиента | 0 / 0 |
| Валидный synthetic legacy JWT + HTTP 200 | PASS | mock / 0 |
| Валидный synthetic `sb_secret` + HTTP 200 | PASS | mock / 0 |

Команды:

- `npm run test:key-attestation` — PASS, 17 проверок, только mocked network;
- `npm run test:preview-gate` — PASS, 41 проверка, без сети; во всех основных отказах `createClient=0` и `scopeDatabase=0`.
- `npm run test:sec-003` — PASS;
- `npm run test:sec-003-fix2` — PASS, включая collision/concurrency и сохранность медицинских полей;
- `npm run build` — PASS; оба новых security test входят в build.

Тест также подтверждает, что verifier не использует Auth Admin endpoint/Supabase SDK, не принимает ключ в argv, не выводит отклонённый ввод и не читает response body.

## 6. Что доказуемо сейчас и что требует runtime

До deployment доказано локально:

- операторский путь не принимает ключ через argv/env/файл и не печатает его;
- URL проверки source-controlled и не может быть заменён на Production;
- запрос read-only, redirect запрещён, timeout установлен, body не читается;
- оба формата проходят предварительную проверку, а fingerprint появляется только после HTTP 200;
- отсутствие/mismatch fingerprint останавливает централизованную Supabase-фабрику до создания клиента.

После выполнения операторской команды HTTP 200 дополнительно докажет, что переданный ключ в этот момент принят API gateway именно проекта `eehyehlhiyztciaezaus`. Для legacy JWT это является сетевой проверкой подписи/пригодности, которой не даёт простое декодирование claims.

До последующего защищённого Preview deployment **не доказано**:

- что сохранённый в Vercel `SUPABASE_SERVICE_ROLE_KEY` байт-в-байт совпадает с аттестованным ключом;
- что fingerprint создан в точном branch scope без конфликтующей переменной более высокого приоритета;
- что Vercel system variables фактически доступны Function runtime.

Эти пункты подтверждаются только фактическим успешным прохождением Runtime Isolation Gate в deployment. Наличие fingerprint env само по себе доказательством не считается. До этого Connected Preview E2E и любые миграции должны оставаться заблокированными.

## 7. Ограничения выполнения

- Операторская проверка не запускалась.
- Ни одного запроса к Test или Production Supabase не выполнялось.
- Медицинские данные, Auth Users и таблицы пациентов не читались.
- Git commit/push/merge, deploy, remote env changes и миграции не выполнялись.
- `docs/releases/qwen-r234b-preaudit.md` не изменялся.
