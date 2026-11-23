-- Synthetic-only fixtures inserted into the Production-shaped baseline before
-- A3/A5. No names, contacts, codes, or content represent real people.

begin;

insert into public.organizations (id, name, slug, type, status, city, settings)
values
  ('a0000000-0000-4000-8000-000000000001', 'R232 Synthetic Clinic A', 'r232-synthetic-clinic-a', 'clinic', 'active', 'Synthetic City', '{}'),
  ('a0000000-0000-4000-8000-000000000002', 'R232 Synthetic Clinic B', 'r232-synthetic-clinic-b', 'clinic', 'active', 'Synthetic City', '{}');

insert into public.experts (
  id, name, role, specialty, access_code, is_active, allowed_modules
)
values
  ('b0000000-0000-4000-8000-000000000001', 'R232 Synthetic Doctor A1', 'doctor', 'synthetic', 'R232-A1', true, array['support', 'body']::text[]),
  ('b0000000-0000-4000-8000-000000000002', 'R232 Synthetic Doctor A2', 'doctor', 'synthetic', 'R232-A2', true, array['support', 'body']::text[]),
  ('b0000000-0000-4000-8000-000000000003', 'R232 Synthetic Doctor B1', 'doctor', 'synthetic', 'R232-B1', true, array['support', 'body']::text[]);

insert into public.expert_organization_memberships (
  id, organization_id, expert_id, role, status
)
values
  ('d0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'doctor', 'active'),
  ('d0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002', 'doctor', 'active'),
  ('d0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000003', 'doctor', 'active');

insert into public.patient_assignments (
  id, public_code, owner_type, owner_id, organization_id,
  primary_expert_id, assigned_by_expert_id, assigned_by_expert_name,
  source, status, patient_label, module
)
values
  (
    'e0000000-0000-4000-8000-000000000001', 'R232-SUPPORT-A',
    'anonymous_case', 'c0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000001', 'R232 Synthetic Doctor A1',
    'r232_pre_migration', 'active', 'R232 Synthetic Patient Support A', 'support'
  ),
  (
    'e0000000-0000-4000-8000-000000000002', null,
    'anonymous_profile', 'c0000000-0000-4000-8000-000000000002',
    'a0000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000001', 'R232 Synthetic Doctor A1',
    'r232_pre_migration', 'active', 'R232 Synthetic Patient Health A', 'body'
  ),
  (
    'e0000000-0000-4000-8000-000000000003', 'R232-SUPPORT-B',
    'anonymous_case', 'c0000000-0000-4000-8000-000000000003',
    'a0000000-0000-4000-8000-000000000002',
    'b0000000-0000-4000-8000-000000000003',
    'b0000000-0000-4000-8000-000000000003', 'R232 Synthetic Doctor B1',
    'r232_pre_migration', 'active', 'R232 Synthetic Patient Support B', 'support'
  );

insert into public.patient_access (
  id, public_code, owner_type, owner_id, organization_id, expert_id,
  access_role, granted_by_expert_id, granted_by_expert_name, status, module
)
values (
  'f0000000-0000-4000-8000-000000000001', 'R232-SUPPORT-A',
  'anonymous_case', 'c0000000-0000-4000-8000-000000000001',
  'a0000000-0000-4000-8000-000000000001',
  'b0000000-0000-4000-8000-000000000002',
  'clinician', 'b0000000-0000-4000-8000-000000000001',
  'R232 Synthetic Doctor A1', 'active', 'support'
);

insert into public.clinical_events (
  id, module, owner_type, owner_id, organization_id, expert_id,
  event_type, occurred_at, source_type, source_id, source_event_key,
  provenance, confidence, validation_status, quality_level, payload
)
values
  (
    '91000000-0000-4000-8000-000000000001', 'support', 'anonymous_case',
    'c0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001',
    'b0000000-0000-4000-8000-000000000001',
    'r232_legacy_observation', now() - interval '60 days',
    'r232_synthetic_legacy', 'r232-old-support-a', 'r232-old-support-a-v1',
    'clinician_entered', 1, 'clinician_confirmed', 1,
    '{"synthetic":true,"record":"pre-migration-support-a"}'::jsonb
  ),
  (
    '91000000-0000-4000-8000-000000000002', 'support', 'anonymous_case',
    'c0000000-0000-4000-8000-000000000003',
    'a0000000-0000-4000-8000-000000000002',
    'b0000000-0000-4000-8000-000000000003',
    'r232_legacy_observation', now() - interval '45 days',
    'r232_synthetic_legacy', 'r232-old-support-b', 'r232-old-support-b-v1',
    'clinician_entered', 1, 'clinician_confirmed', 1,
    '{"synthetic":true,"record":"pre-migration-support-b"}'::jsonb
  );

insert into public.clinical_observations (
  id, clinical_event_id, module, owner_type, owner_id, organization_id,
  concept, value_text, observed_at, source_type, source_id, provenance,
  confidence, validation_status, quality_level, metadata, source_event_key
)
values
  (
    '92000000-0000-4000-8000-000000000001',
    '91000000-0000-4000-8000-000000000001',
    'support', 'anonymous_case', 'c0000000-0000-4000-8000-000000000001',
    'a0000000-0000-4000-8000-000000000001',
    'r232.synthetic.legacy.note', 'synthetic old record A', now() - interval '60 days',
    'r232_synthetic_legacy', 'r232-old-support-a', 'clinician_entered',
    1, 'clinician_confirmed', 1, '{"synthetic":true}'::jsonb,
    'r232-old-support-a-v1'
  ),
  (
    '92000000-0000-4000-8000-000000000002',
    '91000000-0000-4000-8000-000000000002',
    'support', 'anonymous_case', 'c0000000-0000-4000-8000-000000000003',
    'a0000000-0000-4000-8000-000000000002',
    'r232.synthetic.legacy.note', 'synthetic old record B', now() - interval '45 days',
    'r232_synthetic_legacy', 'r232-old-support-b', 'clinician_entered',
    1, 'clinician_confirmed', 1, '{"synthetic":true}'::jsonb,
    'r232-old-support-b-v1'
  );

commit;
