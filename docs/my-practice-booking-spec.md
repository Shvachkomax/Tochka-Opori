# «Моя практика» — техническая спецификация бронирования (этап A2)

**Статус:** проект. Миграции, API, платежи не выполняются на этапе A1. Документ не заменяет юридическое оформление исполнения медицинской услуги.

## 1. Сущности и изоляция

Все таблицы содержат `organization_id` (NULL только для частной практики врача) и проверяются по `memberships`. Врач без активного членства в организации не видит её расписания, услуги и записи. Переключение клиники в UI не меняет права — сервер перепроверяет каждый запрос.

### Предлагаемые таблицы

```
practice_services(
  id uuid PK, expert_id uuid, organization_id uuid NULL,
  name text, price_kop bigint, duration_min int, format text,
  is_active bool, created_at, updated_at,
  UNIQUE (expert_id, organization_id, name) WHERE is_active
)

practice_availability(
  id uuid PK, expert_id uuid, organization_id uuid NULL,
  weekday int 1..7 (ISO), start_time time, end_time time,
  exception_kind text NULL (vacation|personal|...), exception_date date NULL,
  CHECK (end_time > start_time)
)

practice_bookings(
  id uuid PK,
  expert_id uuid, organization_id uuid NULL, service_id uuid FK,
  owner_type text, owner_id uuid,            -- пациент из существующего реестра
  status text,                               -- held|confirmed|cancelled|completed|expired
  starts_at timestamptz, ends_at timestamptz,
  idempotency_key text, expires_at timestamptz,
  created_at, updated_at, completed_at timestamptz NULL
)
-- защита от двойной записи: одинаковые expert_id и пересекающиеся tstzrange
-- в активных статусах (held|confirmed) запрещены на уровне БД
ALTER TABLE practice_bookings ADD CONSTRAINT no_double_booking
  EXCLUDE USING gist (expert_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
  WHERE (status IN ('held','confirmed'));

practice_payments(
  id uuid PK, booking_id uuid FK, amount_kop bigint, currency text DEFAULT 'RUB',
  provider text,                     -- A2: только 'test'
  status text,                       -- test_paid|refunded
  idempotency_key text UNIQUE, created_at
)
-- Рублёвый контур изолирован от usage_ledger (AI-кредиты). Не смешивать.

practice_commissions(
  id uuid PK, booking_id uuid FK, payment_id uuid FK,
  base_kop bigint, rate_bps int DEFAULT 2000, fee_kop bigint,
  status text,                       -- held|payable|reversed
  created_at, released_at timestamptz NULL
)

practice_events(                    -- append-only аудит
  id bigint identity, booking_id uuid FK NULL,
  event text, actor text, payload jsonb, at timestamptz DEFAULT now()
)
```

`needs extension: pg_trgm` не требуется; `btree_gist` для EXCLUDE-констрейнта — проверить наличие на целевой БД (Supabase: расширение доступно). Альтернатива без расширений — триггер с `SELECT ... FOR UPDATE` по `expert_id` + проверка пересечений; EXCLUDE предпочтительнее (атомарно).

## 2. Слоты и доступность

- Сервер вычисляет слоты как `availability − exceptions − активные bookings(held|confirmed)`; выдает окна, кратные длительности услуги.
- Клиент **не вычисляет доступность**: FullCalendar показывает только серверные события и справочные free-интервалы из A1 (помечены «справочно»).
- Время хранения: UTC (`timestamptz`); отображение — в локальном таймзоне кабинета (поле `practitioner_timezone` или `Europe/Moscow` по умолчанию, явно в ответе API).

## 3. Атомарное резервирование и идемпотентность

```
RPC reserve_booking(p_expert_id, p_org_id, p_service_id, p_starts_at,
                    p_owner_type, p_owner_id, p_idempotency_key, p_ttl_min=10)
1. Проверка membership и принадлежности услуги врачу/организации.
2. Поиск существующей записи по idempotency_key → вернуть её (replay).
3. INSERT status='held', expires_at = now() + ttl.
   При 23P01 (EXCLUDE) → 409 с текущим статусом слота.
4. INSERT practice_events('hold_created').
```

Повторный запрос с тем же ключом возвращает тот же held — повторного удержания нет. Конкурентные запросы два разных пациента: один получает held, второй — 409. Операция выполняется в одной транзакции.

## 4. Жизненный цикл

```
held --(test payment ok)--> confirmed --(complete)--> completed
held --(TTL истёк / cancel)--> expired | cancelled
confirmed --(cancel, policy)--> cancelled
completed --(refund)--> commission reversed (обратная запись, история сохраняется)
```

- **Истечение:** `pg_cron` или фоновый вызов каждые 5 мин: `held AND expires_at < now()` → `expired` + событие. Слот освобождается, because expired не входит в EXCLUDE-where.
- **Отмена:** `cancel_booking` валидирует владельца брони или права специалиста; `confirmed` может отменяться только по политике (окно отмены) — параметром в `practice_services.policies`.
- **Изменение времени:** отмена старой held + резерв нового слота одной транзакцией (без «переноса» через UPDATE диапазона, чтобы не ломать EXCLUDE).

## 5. Оплата и комиссия (A2 — тестовая)

- Провайдер `test`: `confirmTestPayment` создаёт `practice_payments` и переводит `held → confirmed`. Настоящий эквайринг, ЮKassa/CloudPayments, ККТ и чеки — только отдельным этапом с юридическим оформлением.
- Комиссия 20% создаётся **только после** `completed` + релиза холда: `fee_kop = round(base_kop * 2000 / 10000)`, снимок `rate_bps`. До подтверждения оплаты/оказания — только `held`.
- Возврат: `practice_payments.status=refunded` + `practice_commissions.status=reversed` (обратная запись по исходной ставке). Рублёвые записи никогда не смешиваются с `usage_ledger`; партнёрские 25% (AI-трафик) не участвуют в этом контуре.

## 6. API (проект, не выполнять)

Новые actions в `/api/specialist` (авторизованные) и публичный booking-эндпоинт по неперечислимому токену услуги:

`listPracticeServices`, `getPracticeAvailability`, `getPublicSlots(token, date)`,
`reserveBooking`, `confirmTestPayment`, `cancelBooking`, `completeService`,
`getPracticeFinance(organization_id)`.

Все — с `organization_id` проверкой, RLS `service_role в API`, rate-limit на публичный эндпоинт, generic-ошибки. CORS — тот же механизм, что у существующего `api/specialist.js`.

## 7. Связка с существующими данными

- Пациент — `owner_type/owner_id` из `patient_assignments` / Health-профиля; бронирование не создаёт дубли пациентов.
- `public_code` (support) и `owner_id` (body) — единая точка разрешения в `resolveAuthorizedSpecialistClient`; booking использует тот же резолвер.
- Клиническая карта не открывается бронированием: запись даёт только факт приёма (время, услуга, организация), не тексты сессий.

## 8. Тестирование A2 (будущее)

Concurrency-тесты (`SELECT FOR UPDATE` + EXCLUDE): 10 параллельных reserve на один слот → ровно 1 held. Idempotency: повтор с тем же ключом → тот же ид. TTL: held истекает, слот освобождается. Изоляция: врач B не видит записи врача A при прямом `organization_id` запросе. RU-эксплуатация: все запросы — `service_role_in_API`, anon/authenticated без прямых политик.

## 9. Открытые решения (не входит в A1/A2)

- Исполнитель медицинской услуги, договор/агентирование, ОКВЭД, касса/чеки, способы подтверждения оплаты у клиники.
- Юридически значимое согласие пациента и сроки хранения.
- FHIR-экспорт (решено отложить; собственный реестр + `@medplum/core` типы при необходимости).
