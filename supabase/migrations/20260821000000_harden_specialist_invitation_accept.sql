-- Phase 11C.1 stabilization: harden invitation acceptance.
-- Keeps patient_assignments as the canonical relationship and supports both
-- invitation directions without creating an assignment during onboarding approval.

CREATE OR REPLACE FUNCTION public.accept_specialist_invitation(
  p_token_hash text,
  p_owner_id uuid,
  p_public_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invitation record;
  v_expert record;
  v_existing record;
  v_expert_id uuid;
  v_now timestamptz := pg_catalog.now();
BEGIN
  SELECT id, direction, module, target_owner_id, target_expert_id,
         inviter_owner_type, inviter_owner_id, inviter_expert_id,
         organization_id, status, expires_at
  INTO v_invitation
  FROM public.patient_specialist_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Приглашение не найдено', 'code', 'NOT_FOUND');
  END IF;

  IF v_invitation.status != 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Приглашение уже обработано', 'code', 'ALREADY_PROCESSED');
  END IF;

  IF v_invitation.expires_at < v_now THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Приглашение истекло', 'code', 'EXPIRED');
  END IF;

  IF v_invitation.module != 'support' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Несоответствие модуля', 'code', 'MODULE_MISMATCH');
  END IF;

  IF v_invitation.direction = 'specialist_to_patient' THEN
    IF v_invitation.target_owner_id IS NOT NULL
       AND v_invitation.target_owner_id != p_owner_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Доступ запрещён', 'code', 'FORBIDDEN');
    END IF;
    v_expert_id := v_invitation.inviter_expert_id;
  ELSIF v_invitation.direction = 'patient_to_specialist' THEN
    IF v_invitation.inviter_owner_type != 'anonymous_case'
       OR v_invitation.inviter_owner_id IS NULL
       OR v_invitation.inviter_owner_id != p_owner_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Доступ запрещён', 'code', 'OWNER_MISMATCH');
    END IF;
    v_expert_id := v_invitation.target_expert_id;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'Некорректное приглашение', 'code', 'INVALID_DIRECTION');
  END IF;

  IF v_expert_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Специалист ещё не подключён', 'code', 'EXPERT_UNAVAILABLE');
  END IF;

  SELECT id, is_active, allowed_modules
  INTO v_expert
  FROM public.experts
  WHERE id = v_expert_id;

  IF NOT FOUND OR NOT v_expert.is_active THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Специалист недоступен', 'code', 'EXPERT_UNAVAILABLE');
  END IF;

  IF NOT COALESCE(v_expert.allowed_modules @> ARRAY[v_invitation.module]::text[], false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Специалист не имеет доступа к данному модулю', 'code', 'NO_MODULE_ENTITLEMENT');
  END IF;

  SELECT id, primary_expert_id
  INTO v_existing
  FROM public.patient_assignments
  WHERE module = v_invitation.module
    AND status = 'active'
    AND organization_id IS NOT DISTINCT FROM v_invitation.organization_id
    AND (
      public_code = p_public_code
      OR (owner_type = 'anonymous_case' AND owner_id = p_owner_id)
    )
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.primary_expert_id != v_expert_id THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'У вас уже есть активный специалист в этой организации. Обратитесь к администратору для перевода.',
        'code', 'ASSIGNMENT_CONFLICT'
      );
    END IF;

    UPDATE public.patient_specialist_invitations
    SET status = 'accepted',
        accepted_at = v_now,
        target_owner_id = CASE
          WHEN direction = 'specialist_to_patient' THEN p_owner_id
          ELSE target_owner_id
        END,
        target_owner_type = CASE
          WHEN direction = 'specialist_to_patient' THEN 'anonymous_case'
          ELSE target_owner_type
        END,
        updated_at = v_now
    WHERE id = v_invitation.id AND status = 'pending';

    RETURN jsonb_build_object('ok', true, 'message', 'Уже назначено', 'idempotent', true);
  END IF;

  INSERT INTO public.patient_assignments (
    public_code,
    organization_id,
    primary_expert_id,
    assigned_by_expert_id,
    assigned_by_expert_name,
    module,
    status,
    source
  ) VALUES (
    p_public_code,
    v_invitation.organization_id,
    v_expert_id,
    v_expert_id,
    'invitation',
    v_invitation.module,
    'active',
    'patient_invitation_accept'
  );

  UPDATE public.patient_specialist_invitations
  SET status = 'accepted',
      accepted_at = v_now,
      target_owner_id = CASE
        WHEN direction = 'specialist_to_patient' THEN p_owner_id
        ELSE target_owner_id
      END,
      target_owner_type = CASE
        WHEN direction = 'specialist_to_patient' THEN 'anonymous_case'
        ELSE target_owner_type
      END,
      updated_at = v_now
  WHERE id = v_invitation.id AND status = 'pending';

  RETURN jsonb_build_object('ok', true, 'message', 'Специалист назначен');
END;
$$;

REVOKE ALL ON FUNCTION public.accept_specialist_invitation(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_specialist_invitation(text, uuid, text) TO service_role;

COMMENT ON FUNCTION public.accept_specialist_invitation IS
  'Atomically accepts a support patient-specialist invitation and creates the canonical patient_assignment.';
