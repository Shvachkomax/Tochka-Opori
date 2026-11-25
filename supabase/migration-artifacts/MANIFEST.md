# Supabase migration provenance manifest

Дата нормализации: 2026-11-25

Целевой поток: Supabase Test `eehyehlhiyztciaezaus`

Запрещённая среда: Production `blwogrdezfhprdpdnxtn`

Файлы под `supabase/migration-artifacts/` являются versioned historical или
deferred artifacts. Их наличие в Git не означает, что SQL применён к Test или
Production. Supabase CLI не должен рассматривать эти каталоги как активный
migration stream.

## Active Test history normalization

| Исходный путь | Канонический активный путь | SHA-256 | Origin | Основание |
| --- | --- | --- | --- | --- |
| `supabase/migrations/20261106053005_my_practice_synthetic_workspaces.sql` | `supabase/migrations/20261106053005_my_practice_synthetic_workspaces_preview_only.sql` | `2a1c119ecf718490a6ecb6ec8cfe9865a8ba220b1a4fc7cd0dc8aa23402d15b9` | `51549a333906100863cbbf94a5d26c344e26a02e` | Same version и exact SQL; suffix приведён к Test ledger. |
| `supabase/migrations/20261116082953_practice_patient_profile_links.sql` | `supabase/migrations/20261116090216_practice_patient_profile_links.sql` | `3e982801e5765d7eab9ffaf71a5a22bd7bc78a4aac5ba01a55b70428584a9a74` | `fe16b256103ea983a235e454b0b78969d36b6634` | Exact B-пара с Test `20261116090216`. |
| `supabase/migrations/20261116084712_practice_booking_credit_payments.sql` | `supabase/migrations/20261116090231_practice_booking_credit_payments.sql` | `6cbd88c5d34f31b482a83ddfeec5d1ddcb93e545cad19f0125eb16fb4026fee4` | `fe16b256103ea983a235e454b0b78969d36b6634` | Exact B-пара с Test `20261116090231`. |
| `supabase/migrations/20261116173150_medical_encounters_a5.sql` | `supabase/migrations/20261116173440_medical_encounters_a5.sql` | `4b5c6fbd2e52d3d0266cd9ba7eb5ee74c3f1c27f0226f34bafc91815fb79b737` | `286b8c941069f058707d53f72d1f8d27ad9740f7` | Exact B-пара с Test `20261116173440`. |
| Test ledger `20261117185604` | `supabase/migrations/20261117185604_a38_unify_patient_specialist_links.sql` | `f00636e9b9b3162c7e621343298cbc10b55699ee11935ec0901ddc54f4986ffa` | Read-only Test ledger, одна statement | Exact Test-вариант; не выдаётся за byte-identical local `17184606`. |
| `supabase/migrations/20261117185640_a38_harden_link_rpc_grants.sql` | `supabase/migrations/20261117185704_a38_harden_link_rpc_grants.sql` | `826e87c29916c1b17688992924f53b3d2cb89f922f0990af266fcd229f000e08` | `44a8de07fee20de28b0d0004f76055e9e6cbba42` | Exact B-пара с Test `20261117185704`. |
| `supabase/migrations/20261117193254_a38_preserve_support_client_identity.sql` | `supabase/migrations/20261117193424_a38_preserve_support_client_identity.sql` | `1b192ed88ac17afad746ebdc64ffa95aa28fa6ec1c3ea34243e2640d000e2c8f` | `1a8fb7abb802a65042b126bce620edf2b80f0d34` | Exact B-пара с Test `20261117193424`; historical backfill не replay. |

### A3.8 non-exact provenance

Локальный исходник `17184606` отзывал `EXECUTE` у `public`, `anon` и
`authenticated`. Зарегистрированный Test SQL `17185604` в двух функциях отзывал
его только у `public`; следующий exact hardening `17185704` установил итоговый
server-only ACL. Оба варианта сохранены раздельно и имеют разные SHA.

## Historical local artifact

| Исходный путь | Архивный путь | SHA-256 | Origin | Статус |
| --- | --- | --- | --- | --- |
| `supabase/migrations/20261117184606_a38_unify_patient_specialist_links.sql` | `supabase/migration-artifacts/historical-local/20261117184606_a38_unify_patient_specialist_links.sql` | `90c2ea263d11c47b0d66d34c50c3ca1edb5cd15847685b3321826be89f8aa2d4` | `44a8de07fee20de28b0d0004f76055e9e6cbba42` | Сохранён для provenance; не является applied Test version и не должен replay. |

## Production release artifacts

| Исходный путь | Архивный путь | SHA-256 | Origin | Причина исключения из Test stream |
| --- | --- | --- | --- | --- |
| `supabase/migrations/20261123070309_r232_production_clinical_base_a3_a5.sql` | `supabase/migration-artifacts/production-r234a/20261123070309_r232_production_clinical_base_a3_a5.sql` | `d15a95e83a084b131b2e2a62d880388a4255efe2698a6d53f9dd8960587ec436` | `2f05e9f282c51e50b15aac9c3197164eb3a21f6f` | Production one-shot конфликтует с уже развёрнутой Test historical chain. |
| `supabase/migrations/20261123070333_r232_production_payments_disabled_booking.sql` | `supabase/migration-artifacts/production-r234a/20261123070333_r232_production_payments_disabled_booking.sql` | `9b368f03d13bc7a7f7fa43827f7b67bdda9186ed7e71d1cf3e4f4b9ba87c0fef` | `2f05e9f282c51e50b15aac9c3197164eb3a21f6f` | Companion ожидает Production constraint topology, которой нет в Test. |
| `supabase/migrations/20261123114523_r233_fix_continuation_failed_attempt_rpcs.sql` | `supabase/migration-artifacts/production-r234a/20261123114523_r233_fix_continuation_failed_attempt_rpcs.sql` | `f9b081e450fc8b94b8b67d196a6819263968ca2ce0fcaa1b85501ea4fd814498` | `2f05e9f282c51e50b15aac9c3197164eb3a21f6f` | Target defect уже отсутствует в Test baseline; exact function semantics не являются no-op. |

Эти SQL-файлы не разрешены к применению в Test. Их rehearsal-скрипты используют
архивные пути только в специально созданных локальных контейнерах.

## Deferred product migration

| Исходный путь | Deferred path | SHA-256 | Origin | Статус |
| --- | --- | --- | --- | --- |
| `supabase/migrations/20261122125416_my_practice_payment_modes.sql` | `supabase/migration-artifacts/deferred-product/20261122125416_my_practice_payment_modes.sql` | `46adfcfc062cfe1cadec1d134df6cf8f9679b3947233121ee8feae8ec3d41019` | `b75a1f2a5427bcf3d9c1806ba99d48d5efc566e4` | **DEFERRED — OPERATOR DECISION**; целевой режим `payments_disabled`. |

До возврата этого изменения в active stream обязательны отдельные approval,
backup/restore attestation и data preflight существующих `practice_bookings`.
Миграция должна добавить статус `requested`, включить его в exclusion constraint
и создать `request_practice_booking_without_payment` и
`cancel_practice_booking_request`. До её применения нельзя включать
`MY_PRACTICE_FINANCIAL_MODE=payments_disabled` для booking mutations.

## Pending SEC-003 migration

| Активный путь | SHA-256 | Origin | Статус |
| --- | --- | --- | --- |
| `supabase/migrations/20261123223548_sec_003_health_bootstrap.sql` | `f94f1701333fb384aa0fed67e157bdaae0eb91a618ae6b4299cbb569c05b756d` | `2eb4b3f9ed181387f429042cff097beaa78ac5dd` | Единственная local-only pending migration после нормализации; в рамках этой задачи не применялась. |
