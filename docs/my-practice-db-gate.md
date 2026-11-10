## Блокировка доступа к базе в ветке «Моя практика»

Для этой ветки Preview установлен `MY_PRACTICE_REQUIRE_TEST_DB=true`. С этой настройкой весь `getSupabase()` в Preview и вход через `/api/specialist` остаются закрыты (HTTP 503), пока **одновременно** не выполнены условия: `MY_PRACTICE_SERVER_ENABLED=true`, `VERCEL_ENV=preview`, `SUPABASE_URL=https://eehyehlhiyztciaezaus.supabase.co` и `MY_PRACTICE_ALLOWED_SUPABASE_REF=eehyehlhiyztciaezaus`. Идентификатор тестовой базы дополнительно зафиксирован в коде.

Секрет `SUPABASE_SERVICE_ROLE_KEY` необходимо вручную внести только через Vercel, с областью действия **Preview / ветка feat/my-practice-multi-clinic-pilot**, из панели **Tochka-Opori-Preview-Test** в Supabase. Нельзя использовать ключ Production и нельзя передавать ключ в переписке или репозитории.

До настройки серверная синхронизация выключена намеренно. Публичная демонстрация `/specialist/my-practice/demo` продолжает работать: она не обращается к базе.

Это защитный механизм только для отдельной ветки. Он не меняет настройки Production или других Preview.
