# Clinical browser medical staging — isolated Vercel shell (v0.4.4)

**Status:** standalone Vercel project created, build validated, **not ready for physician testing**.

## Resources

- Vercel project: `tochka-opori-medical-staging`, id `prj_73X9w4yEZ1pdAfxB8hD0R64vh2js`.
- First build: `dpl_fEk4sDFpR4TrhDNzLz8cD75LH6Ma`, source
  `feature/clinical-longitudinal-v01`, commit
  `bcff3e55aec45e6874de4b90f4056feccf112cbc`.
- Built successfully: Vite, 246 modules, no compilation errors; Vercel `READY`.
- This is a **separate Vercel project**. The deployment's Vercel target was
  `production` *inside this new project*, NOT any production domain of Tochka Opori.
- No `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` or medical patient data
  was added to this project. Flags `CLINICAL_MEDICATION_ARCHIVE_ENABLED` and
  `CLINICAL_LONGITUDINAL_READ_ENABLED` set to `false` for both initial
  production target and branch-scoped preview target.
- The `MEDICAL_STAGING_NO_PATIENT_DATA=true` variable is an operator marker,
  **not an enforced access-control mechanism**. An isolated shell alone does not
  constitute a secure medical staging environment.

## Deployment protection blocker

- Attempt to create the project with `ssoProtection: all` failed `403`:
  the connected Vercel integration cannot modify Vercel Authentication.
- Attempt to enable Vercel Authentication after creating project failed with
  the same `403`. Password Protection failed `428`: requires Pro plan.
- Vercel Authentication can be enabled on Free/Hobby by the owner in
  Project → Settings → Deployment Protection → Vercel Authentication → All
  Deployments (see Vercel September 2026 changelog). Do not purchase Pro
  merely to resolve the 428 password protection failure.
- **No Supabase service-role key is to be installed until Vercel Authentication
  is verified by an actual unauthenticated browser request.**
- A `README` or page-level login cannot substitute for correctly configured
  server-side access control of the entire backend.

## Next gated steps

1. Owner enables Vercel Authentication (All Deployments) for the **new**
   `tochka-opori-medical-staging` project; no changes to existing products.
2. Verify anonymous incognito browser gets Vercel sign-in rather than
   static content OR any `/api/` route. Verify a team-approved tester can enter.
3. Confirm that Preview-Test Supabase `eehyehlhiyztciaezaus` contains
   **only lawful synthetic test records** for this use, or provision a
   clean separate medical staging database and apply all C1/C2 migrations.
   No copying of genuine patient histories to an EU-region test instance.
4. Configure the staging project with new **staging-only** `SUPABASE_URL`
   and server-side `SUPABASE_SERVICE_ROLE_KEY`, scoped to correct environment.
   Secret values must be supplied via Vercel dashboard/secret manager, never
   committed or pasted into chat.
5. Apply `scripts/065-clinical-medication-archive-staging-ONLY.sql` only to
   the reviewed staging database following backup and review. Inspect privileges.
6. Seed 1 synthetic clinician, 1 assigned patient, 1 second clinician without
   the right, separate organizations, and a curated synthetic drug.
   Test physician access code + HTTP cookies/Origin + POST RPC and browser UI.
7. Enable `CLINICAL_MEDICATION_ARCHIVE_ENABLED=true` **only** in staging.
   Ensure a failed archive produces no incomplete prescription.
8. Verify patient history access on separate permission and complete-source
   checks; only then enable `CLINICAL_LONGITUDINAL_READ_ENABLED=true`.
9. Run browser E2E for activate → supersede → revoke, two tabs,
   unauthorized clinician and failed DB, log only synthetic case details.
10. Invite owner for physician acceptance. Never enable new flags in main
    or actual production until appropriate Russian medical hosting, security,
    legal and clinical review.

## Tests already executed

- Existing Support C2 medical RPC smoke passed on `Tochka-Opori-Preview-Test`.
- Archive wrapper + actual Support C2 SQL test `scripts/068-clinical-full-c2-rpc-archive-preview-test.sql`
  passed with PostgreSQL transaction rollback: 0 remaining synthetic orders;
  archive schema removed by rollback.
- Runtime routing unit test `scripts/test-clinical-medication-rpc-routing.js`
  passed for all three mutations and forbidden actions.
- No HTTP physician-auth browser test has yet been executed.


## Обновление 28.10.2026 — после включения защиты владельцем

**Подтверждено Vercel API:**
- `tochka-opori-medical-staging` has `ssoProtection.enabled=true`,
  `deploymentType=all`; deployed initial shell is `READY`.
- Непосредственный анонимный HTTP-пробный запрос к корневой странице и
  `/api/specialist` не удалось проверить из-за сетевого/DNS ограничения
  среды проверки. Поэтому не называем это независимым HTTP E2E.
- Данных `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` в новом Vercel проекте
  нет. Медицинские флаги `false` для первого production target и Preview.
- В `api/specialist.js` внедрён новый fail-closed guard по
  `MEDICAL_STAGING_NO_PATIENT_DATA=true`: все запросы специалиста
  должны отклоняться с `503 MEDICAL_STAGING_DATA_DISABLED`.
  Добавлен тест `scripts/test-medical-staging-api-guard.js` и npm-команда.
  **Этот код ещё не опубликован на Vercel**.
- В `Tochka-Opori-Preview-Test` проверены 44/44 полей четырёх
  медицинских таблиц C2. На момент установки 0 действующих назначений.
  Миграция `scripts/065-clinical-medication-archive-staging-ONLY.sql`
  применена к **этому тестовому проекту**, а НЕ к production.
- После применения проверены архив, все три адаптера, права и нулевые
  записи: `anon`/ `authenticated` не читают закрытую схему,
  `anon` не вызывает RPC создания назначения.
- `scripts/069-clinical-installed-archive-smoke.sql` выполнил все
  реальные C2 RPC через **установленный** архив, завершился `ROLLBACK`;
  0 оставшихся учебных назначений, 0 строк архива; архив остался
  пустым и установленным.
- В базе `Preview-Test` уже имелись 80 сессий до этой работы.
  Не считаем их автоматически синтетическими и не подключаем их
  к новой площадке до отдельной проверки/изоляции. Не читаем и не
  переносим их клинические сведения.
- Новую публикацию commit `fa8540c...` Vercel отклонил: `402`,
  `api-deployments-free-per-day`, примерно 24 часа до повтора.
  Предыдущие READY развертывания **не включают** новый guard.
  Повторный deploy без снятия лимита не выполнять.

**До E2E врача необходимо:**
1. Подтвердить фактическую unauthenticated блокировку корня и API
   (например, Safari Private и отдельная автоматизированная HTTP-проверка).
2. Подтвердить, что новое развертывание содержит guard и по умолчанию
   `MEDICAL_STAGING_NO_PATIENT_DATA=true`.
3. Использовать только выделенный набор полностью искусственных
   врачей и пациентов в Preview-Test, не затрагивая и не выдавая
   прежние 80 сессий как учебные.
4. Добавить `SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY`
   **непосредственно в Vercel Environment Variables** для этого
   отдельного staging проекта; секреты не передавать в чат или GitHub.
   Интеграция Vercel не позволяет извлечь значения чувствительных ключей
   для автоматического копирования.
5. Лишь после этого через отдельный E2E проверить cookie/Origin,
   врачебные полномочия, действия 3 RPC, историю версий и отказ
   специалисту из другой клиники. Затем включать архивный флаг в
   выделенном тестовом окружении.
