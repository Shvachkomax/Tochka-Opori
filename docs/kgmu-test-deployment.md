# Контур Казанского ГМУ

Ветка: feature/kgmu-test. Основа: АнМед 96f43ba.
Vercel: tochka-opori-kgmu-test (prj_E5bcy3n00Mv3szU6ZdHwbIXrPvUL).
Адрес: https://kgmu-test.tochka-opori.online.

По решению пользователя используется основная база Tochka Opori
(blwogrdezfhprdpdnxtn), а не новая база. Организация: kgmu-test.
DEPLOYMENT_ORGANIZATION_ID задаётся только на сервере.

## Разделение данных

lib/security/deployment-scope.js ограничивает запросы к таблицам с organization_id:
разговоры, назначения, доступы, членства, приглашения, заявки подбора и отзывы.
Новые строки привязываются к организации сервером; изменение организации и upsert
в этих таблицах запрещены. Вход специалиста требует активного членства в кафедре;
контекст частной практики запрещён. Запросы специалисту отбираются по владельцам
разговоров этой организации. Принятие приглашения через RPC проверяет организацию.
Это дополнительная серверная проверка поверх токенов и прав, не отдельная база и не RLS tenant.
Глобальные административные и старые экспертные API закрыты в этом контуре;
рабочий вход врача — /specialist. Сохранение отзывов и кризисных обращений остаётся.
Кризисные правила и тексты не менялись. Только вымышленные данные.

## Окружение Production

VITE_APP_BRAND=kgmu; SUPPORT_ONLY=true; AI_PROVIDER=openai.
SITE_URL указывает канонический домен. OPENAI_API_KEY и SUPABASE_SERVICE_ROLE_KEY
добавлены пользователем как Secret. CLIENT_API_SIGNING_SECRET и
CONTINUATION_SECRET_PEPPER сгенерированы отдельно для кафедры.
Коды продолжения других контуров не переносятся.
Preview не подключён к основной БД и не имеет рабочих ключей.

## Совместимость

В основной базе применена существующая миграция link_match_request_to_session:
индекс уникальности sessions.session_id и nullable FK specialist_match_requests.session_id.
Данные других контуров не переносились.

## Проверки

node scripts/test-deployment-scope.js
npm run test:analyze-session-access
npm run test:specialist-memberships
npm run test:cabinet-defects
npm run test:support-risk-routing
VITE_APP_BRAND=kgmu npm run build

После каждого деплоя проверять создание и сохранение разговора, продолжение,
вход врача, приглашение, запрос специалисту и отказы для чужих кодов.
