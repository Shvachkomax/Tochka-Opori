# SEC-003 — A3/A5 Migration Stream Normalization

- Дата: 2026-11-25
- Режим: **LOCAL-ONLY MIGRATION NORMALIZATION**
- Worktree: `Точка опоры-sec-003-a3a5-integration`
- Ветка: `codex/sec-003-a3a5-integration`
- Базовый HEAD: `2f05e9f282c51e50b15aac9c3197164eb3a21f6f`
- Supabase Test: `eehyehlhiyztciaezaus`
- Production `blwogrdezfhprdpdnxtn`: не опрашивался и не изменялся

## 1. Исходное Git-состояние

Preflight подтвердил правильные worktree, branch и HEAD. Staging был пуст и
остался пустым. До нормализации `git status` показывал 37 путей: утверждённые 34
файла controlled integration и три последующих read-only отчёта:

- `SEC-003-HEALTH-RPC-READINESS.md`;
- `SEC-003-HEALTH-TARGETED-MIGRATION-PREP.md`;
- `SEC-003-MIGRATION-HISTORY-RECONCILIATION.md`.

Это полностью объясняет отличие от исходного числа 34; неизвестных файлов не
обнаружено. Основная рабочая копия `Точка опоры` не изменялась.

## 2. Выполненные локальные переименования

Перед каждым изменением проверены исходные SHA-256. Содержимое пяти exact B-пар
и name-only migration не менялось.

| Исходный путь | Канонический Test path | SHA-256 | Результат |
| --- | --- | --- | --- |
| `20261106053005_my_practice_synthetic_workspaces.sql` | `20261106053005_my_practice_synthetic_workspaces_preview_only.sql` | `2a1c119ecf718490a6ecb6ec8cfe9865a8ba220b1a4fc7cd0dc8aa23402d15b9` | PASS, изменён только suffix |
| `20261116082953_practice_patient_profile_links.sql` | `20261116090216_practice_patient_profile_links.sql` | `3e982801e5765d7eab9ffaf71a5a22bd7bc78a4aac5ba01a55b70428584a9a74` | PASS, exact B |
| `20261116084712_practice_booking_credit_payments.sql` | `20261116090231_practice_booking_credit_payments.sql` | `6cbd88c5d34f31b482a83ddfeec5d1ddcb93e545cad19f0125eb16fb4026fee4` | PASS, exact B |
| `20261116173150_medical_encounters_a5.sql` | `20261116173440_medical_encounters_a5.sql` | `4b5c6fbd2e52d3d0266cd9ba7eb5ee74c3f1c27f0226f34bafc91815fb79b737` | PASS, exact B |
| `20261117185640_a38_harden_link_rpc_grants.sql` | `20261117185704_a38_harden_link_rpc_grants.sql` | `826e87c29916c1b17688992924f53b3d2cb89f922f0990af266fcd229f000e08` | PASS, exact B |
| `20261117193254_a38_preserve_support_client_identity.sql` | `20261117193424_a38_preserve_support_client_identity.sql` | `1b192ed88ac17afad746ebdc64ffa95aa28fa6ec1c3ea34243e2640d000e2c8f` | PASS, exact B |

Два локальных теста, которые открывали миграции по старым filenames, переведены
на канонические paths. Living-документ My Practice также использует новый
suffix. Исторические release reports не переписывались: они сохраняют факты и
пути соответствующего времени.

## 3. A3.8 `17184606` / `17185604`

Исходный локальный вариант сохранён без изменения:

`supabase/migration-artifacts/historical-local/20261117184606_a38_unify_patient_specialist_links.sql`

Его SHA:

`90c2ea263d11c47b0d66d34c50c3ca1edb5cd15847685b3321826be89f8aa2d4`

Точный Test SQL получен одним read-only `SELECT` только из
`supabase_migrations.schema_migrations` проекта `eehyehlhiyztciaezaus`.
Ledger вернул одну statement, name `a38_unify_patient_specialist_links` и SHA:

`f00636e9b9b3162c7e621343298cbc10b55699ee11935ec0901ddc54f4986ffa`

Этот exact вариант размещён как:

`supabase/migrations/20261117185604_a38_unify_patient_specialist_links.sql`

Различие действительно ограничено двумя `REVOKE`: локальный вариант отзывал у
`public, anon, authenticated`, Test historical SQL — у `public`. Следующий exact
hardening `20261117185704` закрывает итоговый ACL. Приблизительная реконструкция
не использовалась.

## 4. Production artifact track

Три файла перенесены без изменения bytes в
`supabase/migration-artifacts/production-r234a/`:

| Artifact | SHA-256 | Origin | Причина исключения из Test stream |
| --- | --- | --- | --- |
| `20261123070309_r232_production_clinical_base_a3_a5.sql` | `d15a95e83a084b131b2e2a62d880388a4255efe2698a6d53f9dd8960587ec436` | `2f05e9f282c51e50b15aac9c3197164eb3a21f6f` | Production one-shot конфликтует с существующей Test chain |
| `20261123070333_r232_production_payments_disabled_booking.sql` | `9b368f03d13bc7a7f7fa43827f7b67bdda9186ed7e71d1cf3e4f4b9ba87c0fef` | тот же | Ожидает иную constraint topology |
| `20261123114523_r233_fix_continuation_failed_attempt_rpcs.sql` | `f9b081e450fc8b94b8b67d196a6819263968ca2ce0fcaa1b85501ea4fd814498` | тот же | Qualification defect уже отсутствует в Test, exact semantics отличаются |

Локальные R2.3.2/R2.3.3 rehearsal-скрипты переведены на архивные пути и прошли
`bash -n`. Они по-прежнему требуют специально разрешённый локальный контейнер и
не являются способом применения SQL к Test или Production.

## 5. Deferred My Practice migration

Файл сохранён без изменения:

`supabase/migration-artifacts/deferred-product/20261122125416_my_practice_payment_modes.sql`

- SHA: `46adfcfc062cfe1cadec1d134df6cf8f9679b3947233121ee8feae8ec3d41019`.
- Origin: `b75a1f2a5427bcf3d9c1806ba99d48d5efc566e4`.
- Статус: **DEFERRED — OPERATOR DECISION**.
- Целевой продуктовый режим: `payments_disabled`.

Перед возвратом в active stream нужны отдельные review, backup/restore
attestation и data preflight существующих `practice_bookings`. Миграция должна
добавить `requested`, перестроить exclusion constraint и создать
`request_practice_booking_without_payment` и
`cancel_practice_booking_request`.

`MY_PRACTICE_FINANCIAL_MODE=payments_disabled` в рамках этой задачи не
устанавливался. Booking without payment не считается работоспособным.

## 6. Итоговый активный каталог

В `supabase/migrations` находится 50 SQL-файлов: 49 Test history versions и одна
pending Health migration.

```text
20260814000000 production_baseline
20260814010000 security_hardening
20260814020000 performance_hardening
20260816000000 specialist_module_entitlements
20260817000000 support_pricing
20260818000000 patient_specialist_linking
20260819000000 accept_invitation_rpc
20260821000000 harden_specialist_invitation_accept
20260821010000 scope_owner_accept
20260821133103 health_body_pricing
20260821155003 service_request_financial_lifecycle
20260824083854 harden_service_request_financial_grants
20260825085627 harden_accept_specialist_invitation_grants
20260825134958 clinical_data_layer_c1_foundation
20260825143903 clinical_data_layer_c1_reference_hardening
20260825154115 clinical_c1_1_observation_idempotency
20260825172224 clinical_c1_1_1_observation_owner_identity_hardening
20260826095017 c2_v0_1_medication_order_foundation
20260826102004 c2_v0_1_medication_function_security_hardening
20260826102252 c2_v0_1_schedule_constraint_hardening
20260826104426 c2_v0_1_mutation_consistency_hardening
20260826111542 c2_v0_1_revoke_idempotency_hardening
20260826111916 c2_v0_1_schedule_completeness_hardening
20260826112815 c2_v0_1_indefinite_schedule_hardening
20260826113620 c2_v0_1_schedule_open_phase_fix
20260826114920 c2_v0_1_global_lifecycle_idempotency_guard
20260826131822 c2_v0_1_medication_concept_snapshot_binding
20261005123149 patient_reported_medication_orders
20261005234912 medication_reference_layer
20261021000822 link_match_request_to_session
20261026062744 pneumointegration_shared_org_scope
20261026080000 backfill_partner_request_tenant_columns
20261027062352 partner_test_accruals
20261028020916 live_test_budget
20261106053005 my_practice_synthetic_workspaces_preview_only
20261107150430 partner_twenty_percent
20261109120000 my_practice_bookings_a2
20261109130000 my_practice_bookings_a2_corrective
20261109140000 my_practice_bookings_a2_ttl_semantics
20261110022907 my_practice_bookings_a2_hardening
20261116090216 practice_patient_profile_links
20261116090231 practice_booking_credit_payments
20261116173440 medical_encounters_a5
20261117185604 a38_unify_patient_specialist_links
20261117185704 a38_harden_link_rpc_grants
20261117193424 a38_preserve_support_client_identity
20261121081127 a381_default_practice_availability
20261121083234 a381_scope_booking_availability
20261121133131 a382_practice_service_modules
20261123223548 sec_003_health_bootstrap
```

Проверка versions/names против сохранённого 49-row Test inventory плюс Health
дала set diff `0`. Повторяющихся versions нет. Все пять исключённых SQL-файлов
присутствуют в artifact tracks; потерянных SQL нет.

## 7. Соответствие Test history

Read-only ledger inventory повторно получен только для Test и содержит 49 rows.
Production не запрашивался. Для шести ранее remote-only versions подтверждены:

- exact hash пяти B-пар;
- exact Test SQL/hash `17185604`;
- совпадение version и name после нормализации;
- отсутствие дополнительных active local-only versions до Health.

Remote migration ledger не менялся. `db push`, `migration up`, `migration
repair`, `apply_migration`, DDL и DML не выполнялись.

## 8. Единственная pending Health migration

Активный файл:

`supabase/migrations/20261123223548_sec_003_health_bootstrap.sql`

SHA:

`f94f1701333fb384aa0fed67e157bdaae0eb91a618ae6b4299cbb569c05b756d`

Подтверждено:

- сигнатура из 13 аргументов:
  `text, uuid, text, text, text, jsonb, numeric, text, text, text, text, text, jsonb`;
- `SECURITY INVOKER` и `search_path=''`;
- revoke у `PUBLIC`, `anon`, `authenticated`, grant только `service_role`;
- Test содержит все шесть dependency tables;
- `ensure_usage_wallet(text,uuid,text)` существует, является INVOKER,
  использует пустой `search_path` и доступен `service_role`;
- в Test нет overload `bootstrap_health_intake` и нет ledger row
  `20261123223548`;
- top-level migration statements — только `CREATE OR REPLACE FUNCTION`,
  `REVOKE`, `GRANT`, `COMMENT`; DML при установке отсутствует;
- runtime inserts и wallet creation находятся внутри одного function statement;
  ошибка или unique conflict откатывают весь bootstrap.

Health SQL не изменялся и в рамках нормализации не применялся.

## 9. Ограничения booking functionality

### Продолжает работать без deferred migration

- авторизованное чтение кабинета пациента и существующих bookings;
- чтение опубликованных услуг и `price_kop`;
- чтение расписания и расчёт свободных слотов;
- чтение кабинета/календаря специалиста;
- specialist CRUD мест, услуг и доступности, не являющийся booking mutation;
- связь и отзыв связи пациент–специалист;
- finance endpoint возвращает пустое fail-closed состояние вне credit mode.

### Заблокировано до отдельного продуктового этапа

- создание unpaid request;
- отмена unpaid request;
- credit payment/confirmation;
- завершение/settlement booking;
- специалистское подтверждение `requested`.

Последний путь сейчас не реализован отдельным RPC/handler для
`payments_disabled`; одной deferred migration недостаточно для полного
операторского процесса «заявка → подтверждение специалистом». Это обязательное
условие следующего продуктового этапа, но не блокер Health normalization, потому
что режим остаётся выключенным.

### Контроль обходов

- В Preview/Test отсутствие `MY_PRACTICE_FINANCIAL_MODE` даёт
  `FINANCIAL_MODE_REQUIRED`; reserve и cancel завершаются до mutation RPC.
- `test_credits` не включается неявно и требует exact server-side env value.
- При будущем `payments_disabled` handler выбирает только отсутствующие сейчас
  request/cancel RPC; fallback на credit или базовый `reserve_practice_booking`
  отсутствует.
- В `api/`, `lib/`, `src/` нет прямых INSERT/UPDATE/DELETE
  `practice_bookings`; все найденные mutation calls находятся в единственном
  server handler.
- Чужой owner/session не принимается: patient identity разрешается через
  проверенную session/access-token пару.

Дополнительный code guard для текущего Health-only Preview не нужен при
сохранении unset financial mode. Перед включением `payments_disabled` требуется
отдельный deployment preflight, который подтверждает applied schema/RPC и
готовность specialist confirmation; до этого env включать запрещено.

## 10. Локальные проверки

| Проверка | Результат |
| --- | --- |
| Active migration count | PASS — 50 |
| 49 Test versions + Health set comparison | PASS — diff 0 |
| Duplicate migration versions | PASS — 0 |
| SHA всех перемещённых/восстановленных SQL | PASS |
| Artifact SQL count | PASS — 5 |
| `bash -n` обоих обновлённых rehearsal scripts | PASS |
| `git diff --check` | PASS |
| Secret scan: private keys, `sb_secret`, provider keys, JWT, AWS keys | PASS — совпадений нет |
| `npm run test:sec-003` | PASS |
| `npm run test:sec-003-fix2` | PASS |
| `npm run test:preview-gate` | PASS — 51 checks, 0 clients on failures |
| `npm run test:key-attestation` | PASS — 19 checks, mocked network |
| `npm run test:my-practice` | PASS |
| `npm run build` | PASS |

Первый build дошёл до Vite и завершился `EPERM`, поскольку sandbox не разрешал
Vite записать `.vite-temp` в отдельный worktree. Повтор той же команды с
разрешённой локальной записью прошёл полностью; это не было ошибкой кода или
тестов. Предупреждение о размере существующего JS chunk остаётся неблокирующим.

Remote/Connected E2E, SQL migrations и временный deployment не запускались.

## 11. Provenance manifest

Создан:

`supabase/migration-artifacts/MANIFEST.md`

Он содержит исходные и конечные пути, полные SHA-256, origin commits,
классификацию и причины исключения каждого artifact. Наличие SQL в архиве не
помечает его applied.

## 12. Состав будущего коммита

Commit не создан и staging пуст. Будущий review должен использовать явный
allowlist, не `git add -A`, и включать:

1. ранее утверждённые 34 integration files;
2. три последующих SEC-003 migration-readiness/reconciliation reports;
3. шесть канонических rename-пар и удаление их старых paths;
4. exact active `20261117185604` и archived local `20261117184606`;
5. три Production artifacts и deferred payment-mode artifact;
6. `supabase/migration-artifacts/MANIFEST.md`;
7. два обновлённых local-test paths;
8. два обновлённых local-rehearsal paths;
9. living-doc path `docs/my-practice-pilot.md`;
10. этот normalization report.

Перед staging необходимо повторно получить полный name-only список, проверить
rename detection, secret scan и исключить любые новые посторонние файлы.

## 13. Остаточные риски

1. `payments_disabled` документированно неработоспособен до отдельной schema и
   application acceptance; env остаётся выключенным.
2. Specialist confirmation для `requested` ещё не реализован.
3. Deferred constraint rebuild остаётся data-dependent и требует backup/preflight.
4. Production artifacts сохранены, но не являются разрешённым Production plan.
5. Test ledger может измениться после этого окна; непосредственно перед Health
   preflight нужен новый read-only inventory.
6. Backup/PITR и фактическое применение Health остаются отдельными gates.

## 14. Вердикт

**READY FOR HEALTH MIGRATION PREFLIGHT**

Локальный active migration stream воспроизводит 49 зарегистрированных Test
versions и содержит только одну дополнительную migration — Health bootstrap.
Исторический SQL не потерян, ledger не изменялся, booking mutations не имеют
небезопасного fallback, а будущий `payments_disabled` явно заблокирован до
отдельного продуктового этапа.

Этот вердикт не разрешает commit, push, deployment, изменение Vercel env или
применение SQL.
