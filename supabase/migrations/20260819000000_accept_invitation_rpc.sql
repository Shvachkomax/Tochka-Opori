-- Phase 11C.1: Atomic accept_specialist_invitation RPC
-- Guarantees: invitation status and patient_assignment are consistent.
-- If any validation fails or assignment cannot be created, nothing changes.

CREATE OR REPLACE FUNCTION public.accept_specialist_invitation(
  p_token_hash text,
  p_owner_id uuid,
  p_public_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_invitation record;
  v_expert record;
  v_existing record;
  v_now timestamptz := now();
  v_result jsonb;
BEGIN
  -- 1. Find and validate invitation
  SELECT id, direction, module, target_owner_id, status, expires_at, inviter_expert_id
  INTO v_invitation
  FROM public.patient_specialist_invitations
  WHERE token_hash = p_token_hash;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Приглашение не найдено', 'code', 'NOT_FOUND');
  END IF;

  IF v_invitation.direction != 'specialist_to_patient' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Некорректное приглашение', 'code', 'INVALID_DIRECTION');
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

  -- 2. Verify patient owns the invitation target (if specified)
  IF v_invitation.target_owner_id IS NOT NULL AND v_invitation.target_owner_id != p_owner_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Доступ запрещён', 'code', 'FORBIDDEN');
  END IF;

  -- 3. Verify expert exists, is active, and has module entitlement
  SELECT id, is_active, allowed_modules
  INTO v_expert
  FROM public.experts
  WHERE id = v_invitation.inviter_expert_id;

  IF NOT FOUND OR NOT v_expert.is_active THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Специалист недоступен', 'code', 'EXPERT_UNAVAILABLE');
  END IF;

  IF NOT (v_expert.allowed_modules @> ARRAY[v_invitation.module]) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Специалист не имеет доступа к данному модулю', 'code', 'NO_MODULE_ENTITLEMENT');
  END IF;

  -- 4. Check existing active assignment
  SELECT id, primary_expert_id
  INTO v_existing
  FROM public.patient_assignments
  WHERE public_code = p_public_code
    AND module = v_invitation.module
    AND status = 'active';

  IF FOUND THEN
    IF v_existing.primary_expert_id = v_invitation.inviter_expert_id THEN
      -- Idempotent: already assigned to same expert
      -- Still transition invitation to accepted for consistency
      UPDATE public.patient_specialist_invitations
      SET status = 'accepted',
          accepted_at = v_now,
          target_owner_id = p_owner_id,
          target_owner_type = 'anonymous_case',
          updated_at = v_now
      WHERE id = v_invitation.id AND status = 'pending';

      RETURN jsonb_build_object('ok', true, 'message', 'Уже назначено', 'idempotent', true);
    ELSE
      -- Conflict: assigned to different expert
      -- Do NOT change invitation status — keep pending for admin intervention
      RETURN jsonb_build_object('ok', false, 'error', 'У вас уже есть активный специалист. Обратитесь к администратору для перевода.', 'code', 'ASSIGNMENT_CONFLICT');
    END IF;
  END IF;

  -- 5. Create canonical patient_assignment
  INSERT INTO public.patient_assignments (
    public_code, primary_expert_id, module, status, source
  ) VALUES (
    p_public_code, v_invitation.inviter_expert_id, v_invitation.module, 'active', 'patient_invitation_accept'
  );

  -- 6. Transition invitation to accepted (only after successful assignment)
  UPDATE public.patient_specialist_invitations
  SET status = 'accepted',
      accepted_at = v_now,
      target_owner_id = p_owner_id,
      target_owner_type = 'anonymous_case',
      updated_at = v_now
  WHERE id = v_invitation.id AND status = 'pending';

  RETURN jsonb_build_object('ok', true, 'message', 'Специалист назначен');
END;
$$;

COMMENT ON FUNCTION public.accept_specialist_invitation IS 'Atomically accept specialist invitation and create patient assignment. Phase 11C.1.';
