# Точечная интеграция Health и телеметрии — 6 ноября 2026

## Проверенный исходный код

`main`: `090d8bae3a09b973413af1c5b731710b4f73199b`, PR #15 объединён.
PR #14 открыт как Draft; учебная практика и платежи из него не переносятся.
`codex/clinic-consolidation`: `220206d1c7b44117b51a36ea46646cb8b99d4f54`,
пять коммитов относительно общего предка, отставание от main на один merge.

| Коммит | Содержание | Решение |
|---|---|---|
| ffca66e | Health Live, Langfuse, учебная практика; повреждённые большие UTF-8 файлы | Не cherry-pick; выбрать нужные файлы из конечного исправленного дерева |
| 1cb9fb9 | Изоляция окружения Live-тестов | Учтено в перенесённых тестах |
| 320422a | Очистка project ID в тесте | Учтено |
| a4ec93e | Очистка VERCEL_ENV в тесте | Заменено явным synthetic Preview и отрицательными проверками |
| 220206d | Восстановление UTF-8 | Используется исправленное дерево; App.jsx и практика не переносятся |

| Компонент | Исходный main | Интеграционная ветка | Ограничение |
|---|---|---|---|
| Бренды, авторизация, изоляция, кризисный Support | Есть | Сохранены | Проверки регрессий обязательны |
| Флаг расширенного Пневмо Support | Есть, default OFF | Сохранён | Не включался |
| Health Live WebRTC | Нет | UI, серверный обработчик, строгая авторизация | Только Preview + test + тестовая БД + явные флаги |
| Usage OpenAI → router | Теряется | Input/output/total/cache/reasoning, фактическая модель, fallback | Не все AI-маршруты инструментированы |
| Langfuse | Нет | Изолированный SDK, метрики без содержимого | Production запрещён, default OFF |
| Моя практика / платежи | Нет новой демоверсии | Не переносится | Отдельная техническая и юридическая приёмка |

## Голос: подтверждено кодом, а не реальным разговором

Это WebRTC-поток микрофона и удалённого аудио с data channel, а не цикл
MediaRecorder → распознавание → TTS. Дельты расшифровки показываются в памяти окна.
Аудиофайлы и расшифровки приложением не сохраняются; `store:false` не является
доказательством полного отсутствия обработки/хранения у внешнего провайдера.
Браузер предусматривает AudioContext/webkitAudioContext, playsInline и ручное
возобновление звука. Реальный Safari/iPhone и задержка/перебивания не проверены.

Новый Health endpoint не принимает legacy_access, проверяет hash токена,
точное совпадение пилота и владельца sessions/body_clients, не создаёт owner
при чтении. БД передаётся с существующим deployment organization scope.
Маршрут Support Live не подключён к api/session.js в этой интеграции.

Блокеры включения для пациентов: серверный бюджет/резерв, блокировка второго
разговора между вкладками/устройствами, гарантированное серверное завершение,
сверка окончательного расхода и клиническая приёмка. 300/60 секунд сейчас —
браузерные таймеры, не финансовая гарантия. Серверные инструкции, модели и
allowed_client_events задаются сервером; браузер не выбирает backend или инструменты.

## Фактические публикации и откат

Все три домена пока обслуживают `220206d` из `codex/clinic-consolidation`.
Последняя попытка Пневмо из main отменена; это не активный deployment домена.
Сводный get_project не раскрывает настройку productionBranch: ветка активного
deployment подтверждена, текущую настройку автоматического отслеживания перед
rollout необходимо читать отдельно. Переключений в этой итерации нет.

| Проект | Домен | Активный READY / кандидат для отката |
|---|---|---|
| tochka-opori-anmed-test | anmed-test.tochka-opori.online | dpl_CA6AStCsChxndwpXxmNfwh9BYmGN |
| tochka-opori-pneumo-test | pneumo-test.tochka-opori.online | dpl_ELozJmLLGEaHkj6TuiqKMFzT8Qsj |
| tochka-opori-kgmu-test | kgmu-test.tochka-opori.online | dpl_8ekcboENLgvuDQpNt2chojSqLKsN |

Production env: DEPLOYMENT_PURPOSE=live; DEPLOYMENT_ORGANIZATION_ID сопоставлены
со своими организациями в основной БД. У всех VITE_ENABLE_MY_PRACTICE_PILOT=true,
VITE_SUPPORT_LIVE_ENABLED=true, SUPPORT_LIVE_ENABLED=false. Это нельзя считать
готовностью к рабочему голосу/платежам. Health UI дополнительно блокируется
в production-сборке, даже если клиентский флаг ошибочно выставлен.
AnMed brand=anmed, КГМУ brand=kgmu; PILOT_ID у них отсутствует (код использует
brand fallback). Production brand/PILOT_ID Пневмо имеют тип sensitive и не
раскрываются API; Preview значения — pneumointegration. Их боевые значения
не заявляются проверенными. PNEUMO_ENHANCED_SUPPORT_ENABLED отсутствует и не включался.

После приёмки: перечитать SHA/env/branch; сначала один проект, затем smoke
бренда, отказов API, авторизации и межорганизационного доступа; при провале
вернуть домен к записанному deployment и восстановить прежнее отслеживание
ветки. Только после успеха первого повторять для следующих двух. Старый
deployment — точка отката, а не подтверждение всех новых критериев безопасности.

## Supabase — только чтение

Подтверждены две существующие БД; схемы/данные/права не изменялись.
Production активные membership / distinct expert IDs: AnMed 0/0,
Pneumointegration 0/0, КГМУ 1/1, P2B Clinic 1/1, P2B Fake Clinic 0/0.
Это технический подсчёт, не верификация врачей и не выдача доступа.
Реальные пациентские данные не читались и не копировались.
Новый код не решает локализацию медицинских данных: перед рабочим запуском
остаётся ранее установленное требование российского контура и правовой приёмки.

## Проверки

Локально PASS: 25 node-скриптов (действующий Pilot Gate, Health Live, строгий
live-owner, матрица трёх организаций, Langfuse SDK in-memory, usage/fallback,
clinical knowledge/longitudinal, staging guard, database architecture,
model routing, audio MIME), npm ci --ignore-scripts и npm run build.
Сборка предупреждает о крупном bundle; это не ошибка сборки.
Синтетические unit-тесты не заменяют E2E трёх авторизованных врачей на Preview.
Локальный Chromium запрещён средой (socket Operation not permitted).
Браузерный тест добавлен в Pilot Integration Gate; его результат читать в CI.
Внешние оплачиваемые AI-вызовы и реальный экспорт Langfuse не выполнялись.

Документация протокола и правил расчёта:
- https://developers.openai.com/api/reference/resources/live/methods/create
- https://langfuse.com/docs/observability/features/token-and-cost-tracking
