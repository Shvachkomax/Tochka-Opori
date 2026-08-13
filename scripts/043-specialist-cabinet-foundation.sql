-- Specialist Cabinet Foundation — Phase 1A (corrected)
-- Additive migration: module + owner identity for patient_assignments / patient_access
-- Idempotent: safe to run multiple times. No destructive data changes.

-- ============================================================================
-- 1. patient_assignments — add module, owner_type, owner_id; make public_code nullable
-- ============================================================================

-- original 010 declared public_code text NOT NULL; Health owner rows need NULL
ALTER TABLE patient_assignments
  ALTER COLUMN public_code DROP NOT NULL;

ALTER TABLE patient_assignments
  ADD COLUMN IF NOT EXISTS module text NOT NULL DEFAULT 'support';

ALTER TABLE patient_assignments
  ADD COLUMN IF NOT EXISTS owner_type text,
  ADD COLUMN IF NOT EXISTS owner_id uuid;

-- CHECK: module must be known
ALTER TABLE patient_assignments
  DROP CONSTRAINT IF EXISTS pa_module_check;
ALTER TABLE patient_assignments
  ADD CONSTRAINT pa_module_check CHECK (module IN ('support', 'body'));

-- CHECK: owner_type and owner_id must appear together
ALTER TABLE patient_assignments
  DROP CONSTRAINT IF EXISTS pa_owner_pair_check;
ALTER TABLE patient_assignments
  ADD CONSTRAINT pa_owner_pair_check CHECK (
    (owner_type IS NULL AND owner_id IS NULL)
    OR
    (owner_type IS NOT NULL AND owner_id IS NOT NULL)
  );

-- CHECK: each row must have either public_code or an owner identity
ALTER TABLE patient_assignments
  DROP CONSTRAINT IF EXISTS pa_identity_check;
ALTER TABLE patient_assignments
  ADD CONSTRAINT pa_identity_check CHECK (
    public_code IS NOT NULL
    OR
    (owner_type IS NOT NULL AND owner_id IS NOT NULL)
  );

-- Drop legacy unique constraint (public_code, organization_id) if it exists
ALTER TABLE patient_assignments
  DROP CONSTRAINT IF EXISTS patient_assignments_public_code_organization_id_key;

-- Partial unique index: public_code identity
-- one active assignment per (public_code, org, module)
-- NULLS NOT DISTINCT: org=NULL (private practice) is a real context,
-- two rows with same code+module+org=NULL would collide → correctly rejected.
DROP INDEX IF EXISTS pa_public_code_org_module_uniq;
CREATE UNIQUE INDEX pa_public_code_org_module_uniq
  ON patient_assignments (public_code, organization_id, module)
  NULLS NOT DISTINCT
  WHERE public_code IS NOT NULL AND status = 'active';

-- Partial unique index: owner identity
-- one active assignment per (owner_type, owner_id, org, module)
-- NULLS NOT DISTINCT: private-practice owner with org=NULL is one active assignment.
DROP INDEX IF EXISTS pa_owner_org_module_uniq;
CREATE UNIQUE INDEX pa_owner_org_module_uniq
  ON patient_assignments (owner_type, owner_id, organization_id, module)
  NULLS NOT DISTINCT
  WHERE owner_type IS NOT NULL AND status = 'active';

-- Indexes
CREATE INDEX IF NOT EXISTS pa_module_idx ON patient_assignments(module);
CREATE INDEX IF NOT EXISTS pa_owner_idx ON patient_assignments(owner_type, owner_id)
  WHERE owner_type IS NOT NULL;

-- Trigger: enforce owner pair + identity integrity on INSERT/UPDATE
CREATE OR REPLACE FUNCTION enforce_patient_assignment_identity()
RETURNS trigger AS $$
BEGIN
  IF (NEW.owner_type IS NULL) <> (NEW.owner_id IS NULL) THEN
    RAISE EXCEPTION 'owner_type and owner_id must both be provided or both be NULL';
  END IF;
  IF NEW.public_code IS NULL AND NEW.owner_type IS NULL THEN
    RAISE EXCEPTION 'Row must have either public_code or owner identity (owner_type + owner_id)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pa_identity_check ON patient_assignments;
CREATE TRIGGER trg_pa_identity_check
  BEFORE INSERT OR UPDATE ON patient_assignments
  FOR EACH ROW EXECUTE FUNCTION enforce_patient_assignment_identity();

-- ============================================================================
-- 2. patient_access — add module, owner_type, owner_id; make public_code nullable
-- ============================================================================

-- original 010 declared public_code text NOT NULL; Health owner rows need NULL
ALTER TABLE patient_access
  ALTER COLUMN public_code DROP NOT NULL;

ALTER TABLE patient_access
  ADD COLUMN IF NOT EXISTS module text NOT NULL DEFAULT 'support';

ALTER TABLE patient_access
  ADD COLUMN IF NOT EXISTS owner_type text,
  ADD COLUMN IF NOT EXISTS owner_id uuid;

-- CHECK: module must be known
ALTER TABLE patient_access
  DROP CONSTRAINT IF EXISTS pacc_module_check;
ALTER TABLE patient_access
  ADD CONSTRAINT pacc_module_check CHECK (module IN ('support', 'body'));

-- CHECK: owner_type and owner_id must appear together
ALTER TABLE patient_access
  DROP CONSTRAINT IF EXISTS pacc_owner_pair_check;
ALTER TABLE patient_access
  ADD CONSTRAINT pacc_owner_pair_check CHECK (
    (owner_type IS NULL AND owner_id IS NULL)
    OR
    (owner_type IS NOT NULL AND owner_id IS NOT NULL)
  );

-- CHECK: each row must have either public_code or an owner identity
ALTER TABLE patient_access
  DROP CONSTRAINT IF EXISTS pacc_identity_check;
ALTER TABLE patient_access
  ADD CONSTRAINT pacc_identity_check CHECK (
    public_code IS NOT NULL
    OR
    (owner_type IS NOT NULL AND owner_id IS NOT NULL)
  );

-- Drop legacy unique constraint (public_code, organization_id, expert_id) if it exists
ALTER TABLE patient_access
  DROP CONSTRAINT IF EXISTS patient_access_public_code_organization_id_expert_id_key;

-- Partial unique index: public_code identity
-- one active access per (public_code, org, expert, module)
-- NULLS NOT DISTINCT: org=NULL private practice is a real context.
DROP INDEX IF EXISTS pacc_public_code_org_expert_module_uniq;
CREATE UNIQUE INDEX pacc_public_code_org_expert_module_uniq
  ON patient_access (public_code, organization_id, expert_id, module)
  NULLS NOT DISTINCT
  WHERE public_code IS NOT NULL AND status = 'active';

-- Partial unique index: owner identity
-- one active access per (owner_type, owner_id, org, expert, module)
-- NULLS NOT DISTINCT: private-practice owner with org=NULL is one active grant.
DROP INDEX IF EXISTS pacc_owner_org_expert_module_uniq;
CREATE UNIQUE INDEX pacc_owner_org_expert_module_uniq
  ON patient_access (owner_type, owner_id, organization_id, expert_id, module)
  NULLS NOT DISTINCT
  WHERE owner_type IS NOT NULL AND status = 'active';

-- Indexes
CREATE INDEX IF NOT EXISTS pacc_module_idx ON patient_access(module);
CREATE INDEX IF NOT EXISTS pacc_owner_idx ON patient_access(owner_type, owner_id)
  WHERE owner_type IS NOT NULL;

-- Trigger: enforce owner pair + identity integrity on INSERT/UPDATE
CREATE OR REPLACE FUNCTION enforce_patient_access_identity()
RETURNS trigger AS $$
BEGIN
  IF (NEW.owner_type IS NULL) <> (NEW.owner_id IS NULL) THEN
    RAISE EXCEPTION 'owner_type and owner_id must both be provided or both be NULL';
  END IF;
  IF NEW.public_code IS NULL AND NEW.owner_type IS NULL THEN
    RAISE EXCEPTION 'Row must have either public_code or owner identity (owner_type + owner_id)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pacc_identity_check ON patient_access;
CREATE TRIGGER trg_pacc_identity_check
  BEFORE INSERT OR UPDATE ON patient_access
  FOR EACH ROW EXECUTE FUNCTION enforce_patient_access_identity();
