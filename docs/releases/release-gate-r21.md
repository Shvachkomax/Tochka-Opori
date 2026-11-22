# Release Gate R2.1 — локальная репетиция полной схемы Supabase

Дата аудита: 2026-11-22. Ветка: `feature/my-practice-a3-patient-cabinet`.
Исходный SHA: `a68f1c49df125c7e4c7dc26fbb2d5d0b90d0dd49`.

## Результат

**R2.1: BLOCKED — NOT VERIFIED.** Полная изолированная репетиция не
запускалась, потому что на рабочем Mac нет Docker Engine (также нет Podman,
Colima и локального PostgreSQL). Это не компенсировалось Test/Production
Supabase: ни одна облачная база не использовалась и не изменялась.

Аппаратное обеспечение совместимо с локальным запуском: Apple Silicon
(`arm64`), 48 GB RAM, macOS 27.2.1 и около 1.0 TiB свободного места.
Официальные требования Docker Desktop для Apple Silicon — поддерживаемая
версия macOS и не менее 4 GB RAM; Docker поддерживает текущий и две предыдущие
мажорные версии macOS. Поэтому проблема не в ресурсах хоста, а только в
отсутствии выбранного container runtime.

## Граница и неизменность окружений

* Не выполнялись `supabase start`, `supabase db reset`, `supabase db push`,
  `supabase link`, `supabase migration repair` или любые удалённые SQL/API
  операции.
* Не изменялись Test `eehyehlhiyztciaezaus`, Production, Vercel, GitHub,
  миграции приложения, контейнеры либо локальные данные проекта.
* Не создавались проекты, ветки, базы, записи пациентов или платежи.
* Рабочее дерево до отчёта было чистым; ветка находится на один коммит впереди
  `origin` из-за уже существующего локального R2-коммита. Push не выполнялся.

## Диагностика хоста

| Проверка | Результат | Статус |
|---|---|---|
| Архитектура и ОС | `arm64`, macOS 27.2.1 | PASS |
| Процессор и RAM | Apple Silicon M5 Max, 48 GB, свободно 86% системной памяти | PASS |
| Свободный диск | около 1.0 TiB | PASS |
| Homebrew | установлен, 7.0.14 | PASS |
| Docker Engine / Desktop | команда `docker` отсутствует | BLOCKED |
| Podman / Colima | команды отсутствуют | BLOCKED |
| PostgreSQL (`psql`, `postgres`, `initdb`) | команды отсутствуют | BLOCKED |
| Supabase CLI | установлен, `2.109.1`; справка `start` и `db` доступна | PASS WITH RISK |

`supabase/config.toml` готов для полного локального контура: PostgreSQL 17,
миграции и `seed.sql` включены; API/DB/Studio используют локальные порты
54321/54322/54323. В Git отслеживается 49 файлов миграций. Однако проверка
синтаксиса, порядка и фактических объектов возможна только после старта
локального Postgres в составе Supabase stack.

### Риск CLI

На Mac установлены Intel/x64 Node 22.22.3 и Intel/x64 Supabase CLI, запущенные
через Rosetta, хотя сам Mac `arm64`. `supabase --version`, `--help`,
`start --help` и `db --help` завершились успешно, но каждый вызов вывел
предупреждение Bun об отсутствии AVX. До длительной локальной репетиции
рекомендуется перейти на нативный ARM64 Node/CLI либо отдельно подтвердить
стабильность текущего x64 CLI. Это не меняет ни схему, ни данные, но иначе
результат локального теста был бы менее надёжным.

## Требуемое действие владельца

### Предпочтительный путь: Docker Desktop

1. Владелец вручную скачивает вариант **Docker Desktop for Mac with Apple
   silicon** с официальной страницы Docker.
2. В интерактивном установщике переносит `Docker.app` в `Applications`,
   запускает приложение и принимает лицензионные условия.
3. Дожидается статуса запущенного Docker Engine, не меняя настройки Test,
   Production или Vercel.
4. Сообщает, что Docker запущен. Только тогда повторяется R2.1 с проверкой
   `docker version`/`docker info`, сохранением инвентаря существующих
   контейнеров и без удаления чего-либо.

Интерактивная установка не требует пароля в конфигурации Docker по умолчанию,
но старые версии или выбранные привилегированные настройки могут запросить
администратора. Docker Desktop бесплатен для personal use, education,
non-commercial open source и организаций одновременно меньше 250 сотрудников
и $10M годовой выручки; соответствие лицензии должен подтвердить владелец.

### Подтверждённая бесплатная альтернатива

Если лицензирование Docker Desktop не подходит, [Colima](https://github.com/abiosoft/colima)
поддерживает Apple Silicon, имеет MIT-лицензию и даёт Docker-compatible runtime.
Он потребует отдельного разрешения владельца на установку `colima` и Docker
client через Homebrew, а затем отдельной проверки совместимости с Supabase CLI.
Автоматически эту альтернативу не устанавливать.

## План продолжения после установки runtime

Только в этой рабочей копии и только против localhost:

1. Проверить runtime и зафиксировать перечень уже существующих контейнеров;
   ничего не удалять.
2. Устранить или явно принять риск x64/Rosetta Supabase CLI.
3. Запустить `supabase start`, проверить все сервисы и применить полный набор
   миграций в новую локальную БД.
4. Выполнить `supabase db reset --local`; зафиксировать порядок миграций,
   схему таблиц/столбцов/FK/индексов/RLS/grants/RPC и отсутствие дубликатов
   availability/links.
5. Запустить изолированные синтетические интеграционные проверки A3/A5:
   links, invitation/revoke, services, availability, booking,
   Support/Health isolation, RLS denial, payment credits and cleanup.
6. Остановить локальный stack и повторить чистый start/reset/deploy. Никакие
   ключи Test/Production в эти проверки не передавать.

До выполнения этого плана статусы миграций, RLS/RPC, индексов, seed и
сквозных сценариев остаются **NOT VERIFIED**, а не PASS.

## Проверки R2.1

| Проверка | Статус | Доказательство / причина |
|---|---|---|
| Git SHA и чистота до отчёта | PASS | `a68f1c4…`, рабочее дерево чистое |
| Конфигурация локального Supabase | PASS | PostgreSQL 17, migrations/seed включены |
| Совместимость аппаратуры | PASS | Apple Silicon, 48 GB RAM, свободный диск |
| Возможность запустить Docker сейчас | BLOCKED | Docker Engine отсутствует |
| Совместимость Docker Desktop | READY FOR OWNER ACTION | официальный Apple-silicon installer и требования выполнены |
| Надёжность Supabase CLI | PASS WITH RISK | команды доступны, но используются x64/Rosetta и AVX warning |
| Первый чистый start/migration/reset | NOT VERIFIED | намеренно не запущен без runtime |
| Таблицы, FK, индексы, RLS, grants, RPC | NOT VERIFIED | нужна локальная схема после миграций |
| Сквозные синтетические тесты и cleanup | NOT VERIFIED | нет локального API/Postgres |
| Повторная чистая репетиция | NOT VERIFIED | нет локального runtime |
| Изменения Test/Production/Vercel | PASS | отсутствуют |

## Ошибки и принятые меры

| Наблюдение | Мера |
|---|---|
| `docker: command not found` | Не подменять Docker облачной базой; остановиться до миграций и запросить интерактивную установку владельца. |
| У CLI предупреждение об AVX | Не считать будущий x64/Rosetta запуск полноценной доказательной репетицией без нативного CLI или отдельного подтверждения стабильности. |
| Нет локального Postgres | Не устанавливать отдельный Postgres: он не заменяет полный Supabase stack (Auth, PostgREST, Storage, Realtime). |

## Ссылки

* [Официальная установка и требования Docker Desktop для Mac](https://docs.docker.com/desktop/setup/install/mac-install/)
* [Supabase CLI changelog: v3 локален по умолчанию и требует подтверждения для hosted-изменений](https://supabase.com/changelog.md)
* [Colima: Docker-compatible runtime для Apple Silicon/macOS](https://github.com/abiosoft/colima)

**Итоговый статус: BLOCKED.** Для продолжения R2.1 требуется только решение
владельца об установке локального container runtime; никаких облачных
изменений, push, merge или деплоев не требуется.
