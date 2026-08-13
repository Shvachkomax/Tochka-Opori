-- Atomic body-client reassignment RPC
-- Phase 2B.2/2B.3: ensures old assignment is deactivated and new one created
-- in a single PostgreSQL statement-level transaction. No intermediate unassigned state.
--
-- Security:
--   SECURITY INVOKER (default) — runs with caller's privileges (service_role)
--   search_path = '' — all objects must be schema-qualified
--   REVOKE from PUBLIC, anon, authenticated — only service_role may call
--
-- No COMMIT / ROLLBACK / START TRANSACTION — relies on PostgreSQL auto-transaction.

-- ============================================================================
-- 1. reassign_body_client function
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reassign_body_client(
  p_owner_id uuid,
  p_new_expert_id uuid,
  p_organization_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_old_assignment_id uuid;
  v_new_assignment_id uuid;
  v_current_expert uuid;
BEGIN
  -- 1. Validate new expert exists and is active
  IF NOT EXISTS (
    SELECT 1 FROM public.experts
    WHERE id = p_new_expert_id AND is_active = true
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Специалист не найден или неактивен');
  END IF;

  -- 2. Validate organization membership if org specified
  IF p_organization_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.expert_organization_memberships
      WHERE expert_id = p_new_expert_id
        AND organization_id = p_organization_id
        AND status = 'active'
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Специалист не состоит в указанной организации');
    END IF;
  END IF;

  -- 3. Find current active assignment (lock row for update)
  SELECT id INTO v_old_assignment_id
  FROM public.patient_assignments
  WHERE owner_type = 'anonymous_profile'
    AND owner_id = p_owner_id
    AND module = 'body'
    AND organization_id IS NOT DISTINCT FROM p_organization_id
    AND status = 'active'
  FOR UPDATE;

  -- 4. If same expert already assigned, return noop
  IF v_old_assignment_id IS NOT NULL THEN
    SELECT primary_expert_id INTO v_current_expert
    FROM public.patient_assignments WHERE id = v_old_assignment_id;
    IF v_current_expert = p_new_expert_id THEN
      RETURN jsonb_build_object('ok', true, 'noop', true, 'message', 'Уже назначено', 'assignment_id', v_old_assignment_id);
    END IF;
  END IF;

  -- 5. Deactivate old assignment if exists
  IF v_old_assignment_id IS NOT NULL THEN
    UPDATE public.patient_assignments
    SET status = 'reassigned', updated_at = now()
    WHERE id = v_old_assignment_id;
  END IF;

  -- 6. Create new assignment
  INSERT INTO public.patient_assignments (
    public_code, owner_type, owner_id, organization_id,
    primary_expert_id, assigned_by_expert_id, assigned_by_expert_name,
    source, status, module
  ) VALUES (
    NULL, 'anonymous_profile', p_owner_id, p_organization_id,
    p_new_expert_id, NULL, 'admin',
    'admin_body_reassignment', 'active', 'body'
  ) RETURNING id INTO v_new_assignment_id;

  RETURN jsonb_build_object(
    'ok', true,
    'assignment_id', v_new_assignment_id,
    'old_assignment_id', v_old_assignment_id
  );
END;
$$;

-- ============================================================================
-- 2. Privileges: service-role only, no browser access
-- ============================================================================

REVOKE ALL ON FUNCTION public.reassign_body_client(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reassign_body_client(uuid, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.reassign_body_client(uuid, uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reassign_body_client(uuid, uuid, uuid) TO service_role;
