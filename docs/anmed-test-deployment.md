# Подготовка тестового сайта АнМед

## Граница текущих изменений

AnMed-режим включается только при сборке с `VITE_APP_BRAND=anmed`. Он меняет подписи и предупреждения интерфейса, оставляет модуль поддержки основным и направляет `/expert` на `/specialist`. Это не tenant-изоляция и не проверка того, вымышленные ли данные вводит пользователь. Не использовать для реальных пациентов.

Тестовый контур должен быть отдельным Vercel-проектом `tochka-opori-anmed-test`, связанным с Supabase-проектом `eehyehlhiyztciaezaus`. Не использовать `tochka-opori-test` и не подключать Production Supabase `blwogrdezfhprdpdnxtn`.

## Авторизация сессии анализа

`/api/analyze` проверяет session context, если запрос указывает `session_id`: для support это запись владельца в `sessions`, для body это запись в `body_clients`, затем access token сверяется с хэшем, привязанным к тому же `session_id`. Access token выдаёт `/api/start-session` и клиент хранит его вместе с session ID; в URL он не передаётся. Без session context разрешены только запросы, не адресующие сохранённую сессию. Финальный support-отчёт и body diary/plate стадии требуют session ID; без credential, при неверном credential, чужой или отсутствующей сессии запрос отклоняется.

Сессии с `legacy_access=true` не могут использовать `/api/analyze` до защищённого обмена continuation credential, который выдаёт обычный session access token. Это не заменяется Vercel Deployment Protection.

Серверный запрет Body включается отдельной runtime-переменной `ANMED_SUPPORT_ONLY=true`, а не только флагом отображения интерфейса: он блокирует выдачу Body client token, Body-токены для `/api/start-session`, Body-вызовы `/api/analyze` и `/api/transcribe`, а также Body actions/module context в `/api/session`, `/api/usage`, `/api/specialist`, `/api/experts`, `/api/admin` и `/api/reviews`. Если runtime также видит `VITE_APP_BRAND=anmed`, это дополнительный fail-closed сигнал. Для предсказуемого режима явно установить `ANMED_SUPPORT_ONLY=true` в окружении Functions. До проверки этого значения и API-ответов пилотных пользователей не допускать.

## Vercel

1. Создать новый Vercel-проект `tochka-opori-anmed-test` из этого Git-репозитория. Не переиспользовать существующий проект. Выбрать `feature/anmed-test-prep` как Production Branch после того, как ветка будет отправлена в Git remote и проверена.
2. До добавления домена включить Deployment Protection для Production deployments: Vercel Authentication или парольную защиту, если она доступна в плане. Ограничить доступ участниками тестирования. Проверить в приватном окне, что без авторизации приложение и API недоступны.
3. В Settings → Environment Variables создать переменные именно в окружении **Production** нового проекта. Для домена `anmed-test.tochka-opori.online` будет использоваться Production deployment этого отдельного проекта; имя домена с `test` само по себе не делает deployment Preview.
4. Добавить Production environment variables:

   | Имя | Значение / назначение |
   | --- | --- |
   | `VITE_APP_BRAND` | `anmed` (публичный build-time переключатель бренда, не секрет) |
   | `ANMED_SUPPORT_ONLY` | `true` (runtime-ограничение серверных API только модулем Support) |
   | `SITE_URL` | `https://anmed-test.tochka-opori.online` (канонический origin, ссылки-приглашения и allowlist CORS для `/api/specialist`) |
   | `SUPABASE_URL` | `https://eehyehlhiyztciaezaus.supabase.co` |
   | `SUPABASE_SERVICE_ROLE_KEY` | Secret key только тестового проекта `eehyehlhiyztciaezaus`; никогда не использовать ключ Production |
   | `OPENAI_API_KEY` | Серверный secret уже созданного OpenAI API-проекта; не использовать `VITE_`-имя |
   | `CLIENT_API_SIGNING_SECRET` | Новый случайный секрет для этого тестового контура, например сгенерированный `openssl rand -hex 32` |
   | `CONTINUATION_SECRET_PEPPER` | Случайный серверный pepper; согласовать с другими приложениями, если они используют ту же тестовую БД, и не переиспользовать значение Production |
   | `AI_PROVIDER` | `openai` |

   При необходимости явно зафиксировать модели отдельными Production-переменными `AI_MODEL_TRIAGE`, `AI_MODEL_REPORT`, `AI_MODEL_FALLBACK`, `AI_MODEL_TRANSCRIBE` и `AI_USE_RESPONSES_API`. Не переносить значения из Production автоматически: подтвердить доступность выбранных моделей в созданном OpenAI-проекте.

5. Если для первоначального наполнения нужны административные API, создавать отдельные тестовые `ADMIN_SECRET`/`SUPER_ADMIN_TOKEN` только в этом Vercel-проекте, выдавать их только ответственным и удалить/заменить после настройки. Не копировать админские секреты Production.
6. Только после проверки Deployment Protection и Production-переменных, успешных регрессионных проверок и deploy добавить `anmed-test.tochka-opori.online` в Domains нового проекта. Проверить, что домен назначен Production deployment именно `tochka-opori-anmed-test`. Не менять DNS до отдельного подтверждения.

Переменные Preview не заменяют Production-переменные домена. Если отдельно тестируется Preview deployment, для него нужны собственные Preview variables, включая `VITE_APP_BRAND=anmed` и `ANMED_SUPPORT_ONLY=true`; `SITE_URL` должен совпадать с конкретным preview-origin, иначе строгая проверка Origin на входе `/api/specialist` отклонит login. Не направлять Preview или Production нового проекта на production-базу.

## Данные и проверка пилота

1. В тестовой БД создать отдельную тестовую организацию АнМед, тестовые учётные записи специалистов и назначения. Настроить каждому специалисту нужные `allowed_modules` и членство в организации; вход врача проверяется на `/specialist` через HttpOnly session cookie и серверную проверку активности, модулей, назначений и организации.
2. Создавать только явно вымышленные тестовые сессии и назначения. Не импортировать пациентские данные, не вводить реальные ФИО, контакты, тексты обращений или медицинские сведения. Баннер приложения напоминает об этом, но не способен технически отличать фиктивный текст от реального.
3. После deploy проверить в браузере с защитой доступа: отказ без Vercel-auth; AnMed-брендинг и предупреждение на `/` и `/specialist`; сохранение кнопки срочной помощи; редирект `/expert` → `/specialist`; успешный и неуспешный вход врача; доступ только к тестовой организации и назначенным тестовым сессиям.
4. В сетевых запросах браузера убедиться, что `/api/start-session`, `/api/analyze` и `/api/transcribe` идут на origin AnMed. Проверить тестовую запись только в тестовой Supabase-БД и убедиться, что Production не менялся.

Клиентские сессии создаются через `/api/start-session`; `/api/transcribe` и `/api/analyze` используют серверную проверку клиентских токенов. OpenAI вызывается только серверным роутером. `VITE_APP_BRAND` не является секретом и не включает авторизацию или изоляцию данных.
