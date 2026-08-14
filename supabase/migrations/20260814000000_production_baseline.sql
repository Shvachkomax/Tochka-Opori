-- ============================================================================
-- Production Baseline Migration
-- Source: pg_dump --schema-only --schema=public of blwogrdezfhprdpdnxtn
-- Generated: 2026-08-14
-- Strategy: Current production schema as baseline (Strategy B)
-- Reordered: tables first, then dependent functions
-- ============================================================================

-- ============================================================================
-- 1. SCHEMA
-- ============================================================================

-- ============================================================================
-- 2. TABLES
-- ============================================================================

CREATE TABLE public.admin_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    performed_at timestamp with time zone DEFAULT now() NOT NULL,
    admin_role text NOT NULL,
    action text NOT NULL,
    target_type text,
    target_id text,
    module text,
    ip_address text,
    success boolean DEFAULT true NOT NULL,
    details jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE public.body_ai_chat (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_type text NOT NULL,
    owner_id uuid NOT NULL,
    session_id text,
    role text NOT NULL,
    message_text text NOT NULL,
    context_snapshot jsonb,
    related_daily_log_id uuid,
    related_plate_id uuid,
    related_summary_id uuid,
    request_id text,
    model_used text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT body_ai_chat_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text, 'system'::text])))
);

CREATE TABLE public.body_clients (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id text NOT NULL,
    display_name text,
    source text NOT NULL DEFAULT 'self_signup',
    specialist_id text,
    specialist_name text,
    referral_code text,
    status text NOT NULL DEFAULT 'active',
    goal text,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    anonymous_owner_id uuid
);

CREATE TABLE public.body_daily_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id text NOT NULL,
    module text NOT NULL DEFAULT 'body',
    log_date date NOT NULL,
    weight_kg numeric,
    waist_cm numeric,
    steps integer,
    activity_comment text,
    workout_done boolean,
    workout_type text,
    workout_minutes integer,
    workout_intensity text,
    workout_comment text,
    calories integer,
    meals_count integer,
    breakfast text,
    lunch text,
    dinner text,
    snacks text,
    nutrition_comment text,
    overeating_level text,
    sweet_cravings text,
    water_l numeric,
    sleep_hours numeric,
    sleep_quality text,
    energy_level integer,
    mood_level integer,
    day_text text,
    voice_transcript text,
    plate_photos jsonb,
    ai_day_summary text,
    ai_focus_tomorrow text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone,
    access_token_hash text,
    plate_analysis jsonb,
    ai_positive_observation text,
    ai_pattern_observation text,
    ai_question_for_user text,
    ai_analysis_status text,
    ai_analysis_request_id text,
    ai_analysis_model text,
    daily_log_version integer DEFAULT 1,
    activity_calories integer,
    activity_calories_source text,
    calorie_intake_source text,
    workout_entries jsonb
);

CREATE TABLE public.body_expert_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id text,
    target_type text NOT NULL,
    target_id text NOT NULL,
    reviewer_name text,
    reviewer_role text,
    rating_safety text,
    rating_usefulness integer,
    rating_practicality integer,
    rating_tone integer,
    error_tags jsonb,
    what_ai_did_well text,
    what_ai_missed text,
    corrected_recommendation text,
    suggested_questions text,
    expert_comment text,
    source_payload jsonb,
    ai_output jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT body_expert_reviews_rating_safety_check CHECK (((rating_safety IS NULL) OR (rating_safety = ANY (ARRAY['ok'::text, 'questionable'::text, 'dangerous'::text])))),
    CONSTRAINT body_expert_reviews_target_type_check CHECK ((target_type = ANY (ARRAY['intake'::text, 'daily_log'::text, 'plate_analysis'::text])))
);

CREATE TABLE public.body_health_contexts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_type text NOT NULL DEFAULT 'anonymous_profile',
    owner_id uuid NOT NULL,
    session_id text,
    module text NOT NULL DEFAULT 'body',
    health_conditions jsonb DEFAULT '[]'::jsonb NOT NULL,
    medications jsonb DEFAULT '[]'::jsonb NOT NULL,
    supplements jsonb DEFAULT '[]'::jsonb NOT NULL,
    lab_notes jsonb DEFAULT '{}'::jsonb NOT NULL,
    documents_note text,
    doctor_observation text,
    safety_flags jsonb DEFAULT '[]'::jsonb NOT NULL,
    consent_acknowledged boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT body_health_contexts_owner_type_check CHECK ((owner_type = 'anonymous_profile'::text))
);

CREATE TABLE public.body_insights (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_type text NOT NULL DEFAULT 'anonymous_profile',
    owner_id uuid NOT NULL,
    insight_type text NOT NULL,
    insight_date date NOT NULL,
    title text,
    insight_text text NOT NULL,
    priority text NOT NULL DEFAULT 'normal',
    source_kind text,
    source_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text NOT NULL DEFAULT 'active',
    fingerprint text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT body_insights_insight_type_check CHECK ((insight_type = ANY (ARRAY['nutrition_pattern'::text, 'activity_pattern'::text, 'sleep_pattern'::text, 'wellbeing_pattern'::text, 'progress'::text, 'warning'::text, 'positive_change'::text]))),
    CONSTRAINT body_insights_owner_type_check CHECK ((owner_type = 'anonymous_profile'::text)),
    CONSTRAINT body_insights_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text]))),
    CONSTRAINT body_insights_status_check CHECK ((status = ANY (ARRAY['active'::text, 'resolved'::text, 'dismissed'::text])))
);

CREATE TABLE public.body_intake_forms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id text,
    module text NOT NULL DEFAULT 'body',
    version text NOT NULL DEFAULT 'body-intake-v0.1',
    answers jsonb NOT NULL,
    bmi numeric,
    care_recommendation text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    source text DEFAULT 'self_signup',
    specialist_id text,
    specialist_name text,
    deleted_at timestamp with time zone,
    deleted_by text,
    provider text,
    ai_model text,
    task_type text,
    router_version text,
    request_duration_ms integer,
    triggered_red_flags jsonb,
    red_flag_care_level text,
    used_fallback boolean DEFAULT false
);

CREATE TABLE public.body_onboarding (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_type text NOT NULL DEFAULT 'anonymous_profile',
    owner_id uuid NOT NULL,
    intro_completed boolean DEFAULT false NOT NULL,
    intro_completed_at timestamp with time zone,
    activity_tracker_used boolean,
    activity_tracker_name text,
    activity_tracker_other text,
    tracked_metrics jsonb DEFAULT '[]'::jsonb NOT NULL,
    calorie_tracking_mode text,
    calorie_tracking_app text,
    calorie_tracking_other text,
    data_entry_preference text,
    priority_metrics jsonb DEFAULT '[]'::jsonb NOT NULL,
    support_style text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT body_onboarding_owner_type_check CHECK ((owner_type = 'anonymous_profile'::text))
);

CREATE TABLE public.body_plate_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_type text NOT NULL DEFAULT 'anonymous_profile',
    owner_id uuid NOT NULL,
    session_id text NOT NULL,
    daily_log_id uuid,
    log_date date NOT NULL,
    meal_type text,
    photo_ref text,
    photo_index integer,
    detected_foods jsonb,
    plate_components jsonb,
    vegetables_assessment text,
    protein_assessment text,
    carbohydrate_assessment text,
    balance_summary text,
    what_is_missing jsonb,
    gentle_suggestion text,
    confidence numeric,
    model_used text,
    prompt_version text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT body_plate_history_owner_type_check CHECK ((owner_type = 'anonymous_profile'::text))
);

CREATE TABLE public.body_weekly_summaries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_type text NOT NULL DEFAULT 'anonymous_profile',
    owner_id uuid NOT NULL,
    summary_type text NOT NULL DEFAULT 'weekly',
    period_start date NOT NULL,
    period_end date NOT NULL,
    source_days integer DEFAULT 0 NOT NULL,
    source_plate_count integer DEFAULT 0 NOT NULL,
    summary_json jsonb,
    user_summary text,
    focus_next_period jsonb,
    model_used text,
    request_id text NOT NULL,
    generation_status text DEFAULT 'ready' NOT NULL,
    error_code text,
    source_snapshot jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT body_weekly_summaries_owner_type_check CHECK ((owner_type = 'anonymous_profile'::text)),
    CONSTRAINT body_weekly_summaries_summary_type_check CHECK ((summary_type = ANY (ARRAY['weekly'::text, 'monthly'::text, 'milestone'::text])))
);

CREATE TABLE public.case_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    case_id text,
    session_id text,
    public_code text,
    created_at timestamp with time zone DEFAULT now(),
    json_data jsonb,
    expert_id uuid,
    expert_name text,
    expert_role text,
    expert_specialty text,
    doctor_correction jsonb,
    corrected_json jsonb,
    protocol_update text,
    correction_comment text,
    quality_analysis_id uuid,
    quality_analyzed_at timestamp with time zone,
    organization_id uuid,
    primary_expert_id uuid,
    assigned_expert_id uuid,
    module text DEFAULT 'support'::text
);

CREATE TABLE public.clinical_council_email_campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    subject text NOT NULL,
    body_html text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    scheduled_at timestamp with time zone,
    sent_at timestamp with time zone,
    total_count integer DEFAULT 0 NOT NULL,
    sent_count integer DEFAULT 0 NOT NULL,
    failed_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cc_email_campaigns_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'sending'::text, 'completed'::text, 'partially_failed'::text, 'failed'::text, 'cancelled'::text])))
);

CREATE TABLE public.clinical_council_email_deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    expert_id uuid,
    invitation_id uuid,
    recipient_email text NOT NULL,
    recipient_name text,
    status text DEFAULT 'pending'::text NOT NULL,
    provider_message_id text,
    error_message text,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cc_email_deliveries_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'failed'::text, 'skipped'::text])))
);

CREATE TABLE public.clinical_council_experts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    invitation_id uuid,
    first_name text NOT NULL,
    last_name text NOT NULL,
    email text NOT NULL,
    phone text,
    specialty text,
    "position" text,
    organization text,
    professional_note text,
    status text DEFAULT 'pending_review'::text NOT NULL,
    role text DEFAULT 'clinical_council_expert'::text NOT NULL,
    public_name_consent boolean DEFAULT false,
    participation_terms_accepted_at timestamp with time zone,
    access_token_hash text,
    access_token_generated_at timestamp with time zone,
    approved_by text,
    approved_at timestamp with time zone,
    rejected_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by text,
    CONSTRAINT cc_experts_status_check CHECK ((status = ANY (ARRAY['pending_review'::text, 'active'::text, 'paused'::text, 'rejected'::text, 'revoked'::text])))
);

CREATE TABLE public.clinical_council_invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invite_code text NOT NULL,
    token_hash text NOT NULL,
    invited_first_name text,
    invited_last_name text,
    invited_email text,
    specialty text,
    organization text,
    invited_by text,
    notes text,
    status text DEFAULT 'created'::text NOT NULL,
    expires_at timestamp with time zone,
    max_uses integer DEFAULT 1,
    use_count integer DEFAULT 0,
    opened_at timestamp with time zone,
    accepted_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    "position" text,
    deleted_at timestamp with time zone,
    deleted_by text,
    CONSTRAINT cc_invitations_status_check CHECK ((status = ANY (ARRAY['created'::text, 'sent'::text, 'opened'::text, 'accepted'::text, 'expired'::text, 'revoked'::text])))
);

CREATE TABLE public.continuation_credentials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    module text NOT NULL,
    owner_type text NOT NULL,
    owner_id uuid NOT NULL,
    lookup_code text NOT NULL,
    secret_hash text NOT NULL,
    secret_version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    rotated_at timestamp with time zone,
    revoked_at timestamp with time zone,
    CONSTRAINT continuation_credentials_module_owner_check CHECK ((((module = 'support'::text) AND (owner_type = 'anonymous_case'::text)) OR ((module = 'body'::text) AND (owner_type = 'anonymous_profile'::text))))
);

CREATE TABLE public.continuation_failed_attempts (
    attempt_key text NOT NULL,
    failed_attempt_count integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.doctor_invite_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone,
    token text NOT NULL,
    organization_id uuid,
    expert_id uuid,
    status text DEFAULT 'active'::text,
    max_uses integer,
    used_count integer DEFAULT 0,
    label text,
    settings jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE public.expert_organization_memberships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    organization_id uuid,
    expert_id uuid,
    role text DEFAULT 'doctor'::text,
    status text DEFAULT 'active'::text
);

CREATE TABLE public.experts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    email text,
    role text,
    specialty text,
    city text,
    organization text,
    access_code text NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    telegram text
);

CREATE TABLE public.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    name text NOT NULL,
    slug text,
    type text DEFAULT 'clinic'::text,
    status text DEFAULT 'active'::text,
    city text,
    comment text,
    settings jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE public.patient_access (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    public_code text,
    organization_id uuid,
    expert_id uuid,
    access_role text DEFAULT 'viewer'::text,
    granted_by_expert_id uuid,
    granted_by_expert_name text,
    status text DEFAULT 'active'::text,
    module text DEFAULT 'support'::text NOT NULL,
    owner_type text,
    owner_id uuid,
    CONSTRAINT pacc_identity_check CHECK (((public_code IS NOT NULL) OR ((owner_type IS NOT NULL) AND (owner_id IS NOT NULL)))),
    CONSTRAINT pacc_module_check CHECK ((module = ANY (ARRAY['support'::text, 'body'::text]))),
    CONSTRAINT pacc_owner_pair_check CHECK ((((owner_type IS NULL) AND (owner_id IS NULL)) OR ((owner_type IS NOT NULL) AND (owner_id IS NOT NULL))))
);

CREATE TABLE public.patient_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    public_code text,
    organization_id uuid,
    primary_expert_id uuid,
    assigned_by_expert_id uuid,
    assigned_by_expert_name text,
    source text DEFAULT 'manual'::text,
    status text DEFAULT 'active'::text,
    patient_label text,
    comment text,
    module text DEFAULT 'support'::text NOT NULL,
    owner_type text,
    owner_id uuid,
    CONSTRAINT pa_identity_check CHECK (((public_code IS NOT NULL) OR ((owner_type IS NOT NULL) AND (owner_id IS NOT NULL)))),
    CONSTRAINT pa_module_check CHECK ((module = ANY (ARRAY['support'::text, 'body'::text]))),
    CONSTRAINT pa_owner_pair_check CHECK ((((owner_type IS NULL) AND (owner_id IS NULL)) OR ((owner_type IS NOT NULL) AND (owner_id IS NOT NULL))))
);

CREATE TABLE public.quality_review_insights (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    created_by_expert_id uuid,
    created_by_expert_name text,
    analysis_type text DEFAULT 'new_approved'::text,
    status text DEFAULT 'new'::text,
    review_count integer DEFAULT 0,
    review_ids jsonb DEFAULT '[]'::jsonb,
    date_from timestamp with time zone,
    date_to timestamp with time zone,
    model_used text,
    fallback_used boolean DEFAULT false,
    summary text,
    strengths jsonb DEFAULT '[]'::jsonb,
    recurring_problems jsonb DEFAULT '[]'::jsonb,
    safety_findings jsonb DEFAULT '[]'::jsonb,
    language_findings jsonb DEFAULT '[]'::jsonb,
    missed_domains jsonb DEFAULT '[]'::jsonb,
    recommendations jsonb DEFAULT '[]'::jsonb,
    proposed_prompt_changes jsonb DEFAULT '[]'::jsonb,
    proposed_logic_changes jsonb DEFAULT '[]'::jsonb,
    regression_tests jsonb DEFAULT '[]'::jsonb,
    risk_of_changes text,
    admin_comment text,
    reviewed_at timestamp with time zone,
    accepted_at timestamp with time zone,
    rejected_at timestamp with time zone,
    json_data jsonb
);

CREATE TABLE public.service_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id text,
    module text DEFAULT 'body'::text NOT NULL,
    owner_type text NOT NULL,
    owner_id uuid NOT NULL,
    session_id text,
    specialist_id text,
    specialist_name text,
    request_type text NOT NULL,
    meeting_format text,
    title text,
    message text NOT NULL,
    status text DEFAULT 'submitted'::text NOT NULL,
    priority text DEFAULT 'normal'::text,
    sla_hours integer,
    due_at timestamp with time zone,
    reserved_credits integer DEFAULT 0,
    charged_credits integer DEFAULT 0,
    pricing_note text,
    context_snapshot jsonb DEFAULT '{}'::jsonb,
    client_contact jsonb DEFAULT '{}'::jsonb,
    specialist_response text,
    internal_note text,
    scheduled_at timestamp with time zone,
    scheduled_place text,
    scheduled_comment text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    answered_at timestamp with time zone,
    completed_at timestamp with time zone,
    cancelled_at timestamp with time zone
);

CREATE TABLE public.sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    public_code text NOT NULL,
    session_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    risk_level text,
    patient_text text,
    conversation_history jsonb,
    user_report text,
    doctor_report text,
    support_plan jsonb,
    json_data jsonb,
    organization_id uuid,
    primary_expert_id uuid,
    invite_token text,
    module text DEFAULT 'support'::text,
    access_token_hash text,
    legacy_access boolean DEFAULT true NOT NULL,
    access_token_generated_at timestamp with time zone,
    anonymous_owner_id uuid,
    report_generation_status text,
    report_request_id text,
    report_started_at timestamp with time zone,
    report_completed_at timestamp with time zone,
    report_error_code text,
    care_recommendation jsonb,
    CONSTRAINT sessions_report_status_check CHECK (((report_generation_status IS NULL) OR (report_generation_status = ANY (ARRAY['processing'::text, 'ready'::text, 'failed'::text]))))
);

CREATE TABLE public.specialist_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    expert_id uuid NOT NULL,
    token_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone,
    revoked_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE public.support_ai_chat (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_type text NOT NULL,
    owner_id uuid NOT NULL,
    role text NOT NULL,
    message_text text NOT NULL,
    ai_response jsonb,
    context_snapshot jsonb,
    source_session_id text,
    request_id text,
    model_used text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT support_ai_chat_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text, 'system'::text])))
);

CREATE TABLE public.support_daily_checkins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_type text NOT NULL,
    owner_id uuid NOT NULL,
    checkin_date date NOT NULL,
    wellbeing_score integer NOT NULL,
    anxiety_score integer,
    comment text,
    source text DEFAULT 'client_cabinet'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT support_daily_checkins_anxiety_range CHECK (((anxiety_score IS NULL) OR ((anxiety_score >= 0) AND (anxiety_score <= 10)))),
    CONSTRAINT support_daily_checkins_wellbeing_range CHECK (((wellbeing_score >= '-5'::integer) AND (wellbeing_score <= 5)))
);

CREATE TABLE public.support_owner_practices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_type text NOT NULL,
    owner_id uuid NOT NULL,
    practice_key text NOT NULL,
    title text NOT NULL,
    description text,
    first_recommended_at timestamp with time zone DEFAULT now() NOT NULL,
    last_recommended_at timestamp with time zone DEFAULT now() NOT NULL,
    recommendation_count integer DEFAULT 1 NOT NULL,
    source_session_ids text[] DEFAULT '{}'::text[],
    status text DEFAULT 'active'::text NOT NULL,
    helpfulness text DEFAULT 'unknown'::text NOT NULL,
    user_status text DEFAULT 'not_tried'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    instructions jsonb,
    duration_minutes integer,
    when_to_use text,
    safety_note text,
    category text,
    CONSTRAINT support_owner_practices_duration_check CHECK (((duration_minutes IS NULL) OR (duration_minutes >= 0))),
    CONSTRAINT support_owner_practices_helpfulness_check CHECK ((helpfulness = ANY (ARRAY['unknown'::text, 'helped'::text, 'neutral'::text, 'not_helpful'::text]))),
    CONSTRAINT support_owner_practices_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'dismissed'::text]))),
    CONSTRAINT support_owner_practices_user_status_check CHECK ((user_status = ANY (ARRAY['not_tried'::text, 'tried'::text, 'helped'::text, 'not_helpful'::text])))
);

CREATE TABLE public.support_owner_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_type text NOT NULL,
    owner_id uuid NOT NULL,
    display_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.training_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    public_code text,
    session_id text,
    case_review_id uuid,
    expert_id uuid,
    expert_name text,
    expert_role text,
    session_sequence integer,
    session_kind text DEFAULT 'initial'::text,
    previous_public_code text,
    follow_up_after_days integer,
    test_round text,
    scenario_played text,
    expected_case_type text,
    ai_detected_case_type text,
    ai_detected_secondary_types jsonb,
    detection_quality integer,
    missed_domain text,
    classification_comment text,
    model_used text,
    fallback_used boolean DEFAULT false,
    questions_quality integer,
    report_quality integer,
    safety_quality integer,
    language_quality integer,
    support_toolkit_quality integer,
    continuation_quality integer,
    repeated_questions boolean DEFAULT false,
    missed_risk_flags boolean DEFAULT false,
    wrong_recommendation boolean DEFAULT false,
    remembered_context boolean DEFAULT false,
    status text DEFAULT 'new'::text,
    short_summary text,
    main_problem text,
    expert_comment text,
    action_needed text,
    continuation_comment text,
    approved_for_learning boolean DEFAULT false,
    json_data jsonb,
    organization_id uuid,
    primary_expert_id uuid,
    module text DEFAULT 'support'::text
);

CREATE TABLE public.usage_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    wallet_id uuid NOT NULL,
    entry_type text NOT NULL,
    amount bigint NOT NULL,
    balance_before bigint NOT NULL,
    balance_after bigint NOT NULL,
    resource_type text,
    request_id text NOT NULL,
    module text NOT NULL,
    session_id text,
    provider text,
    model text,
    input_tokens integer,
    output_tokens integer,
    audio_seconds integer,
    image_count integer,
    estimated_cost numeric,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_ledger_entry_type CHECK ((entry_type = ANY (ARRAY['initial_credit'::text, 'usage_debit'::text, 'automatic_refill'::text, 'manual_refill'::text, 'admin_adjustment'::text, 'refund'::text])))
);

CREATE TABLE public.usage_wallets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_type text NOT NULL,
    owner_id uuid NOT NULL,
    module text NOT NULL,
    balance bigint DEFAULT 22000 NOT NULL,
    refill_amount bigint DEFAULT 22000 NOT NULL,
    refill_mode text DEFAULT 'on_zero'::text NOT NULL,
    cycle_number integer DEFAULT 1 NOT NULL,
    total_used bigint DEFAULT 0 NOT NULL,
    total_refilled bigint DEFAULT 22000 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    visible_to_client boolean DEFAULT false NOT NULL,
    continuation_enabled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_wallet_module CHECK ((module = ANY (ARRAY['support'::text, 'body'::text]))),
    CONSTRAINT chk_wallet_refill_mode CHECK ((refill_mode = ANY (ARRAY['on_zero'::text, 'monthly'::text, 'daily'::text, 'manual'::text, 'disabled'::text]))),
    CONSTRAINT chk_wallet_status CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'closed'::text])))
);

-- ============================================================================
-- 3. PRIMARY KEYS
-- ============================================================================

ALTER TABLE ONLY public.admin_audit_log ADD CONSTRAINT admin_audit_log_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.body_ai_chat ADD CONSTRAINT body_ai_chat_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.body_clients ADD CONSTRAINT body_clients_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.body_daily_logs ADD CONSTRAINT body_daily_logs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.body_expert_reviews ADD CONSTRAINT body_expert_reviews_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.body_health_contexts ADD CONSTRAINT body_health_contexts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.body_insights ADD CONSTRAINT body_insights_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.body_intake_forms ADD CONSTRAINT body_intake_forms_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.body_onboarding ADD CONSTRAINT body_onboarding_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.body_plate_history ADD CONSTRAINT body_plate_history_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.body_weekly_summaries ADD CONSTRAINT body_weekly_summaries_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.case_reviews ADD CONSTRAINT case_reviews_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.clinical_council_email_campaigns ADD CONSTRAINT clinical_council_email_campaigns_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.clinical_council_email_deliveries ADD CONSTRAINT clinical_council_email_deliveries_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.clinical_council_experts ADD CONSTRAINT clinical_council_experts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.clinical_council_invitations ADD CONSTRAINT clinical_council_invitations_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.continuation_credentials ADD CONSTRAINT continuation_credentials_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.continuation_failed_attempts ADD CONSTRAINT continuation_failed_attempts_pkey PRIMARY KEY (attempt_key);
ALTER TABLE ONLY public.doctor_invite_links ADD CONSTRAINT doctor_invite_links_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.expert_organization_memberships ADD CONSTRAINT expert_organization_memberships_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.experts ADD CONSTRAINT experts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.organizations ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.patient_access ADD CONSTRAINT patient_access_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.patient_assignments ADD CONSTRAINT patient_assignments_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.quality_review_insights ADD CONSTRAINT quality_review_insights_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.service_requests ADD CONSTRAINT service_requests_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.sessions ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.specialist_sessions ADD CONSTRAINT specialist_sessions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.support_ai_chat ADD CONSTRAINT support_ai_chat_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.support_daily_checkins ADD CONSTRAINT support_daily_checkins_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.support_owner_practices ADD CONSTRAINT support_owner_practices_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.support_owner_profiles ADD CONSTRAINT support_owner_profiles_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.training_sessions ADD CONSTRAINT training_sessions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.usage_ledger ADD CONSTRAINT usage_ledger_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.usage_wallets ADD CONSTRAINT usage_wallets_pkey PRIMARY KEY (id);

-- ============================================================================
-- 4. UNIQUE CONSTRAINTS
-- ============================================================================

ALTER TABLE ONLY public.body_clients ADD CONSTRAINT body_clients_session_id_key UNIQUE (session_id);
ALTER TABLE ONLY public.body_health_contexts ADD CONSTRAINT body_health_contexts_owner_type_owner_id_module_key UNIQUE (owner_type, owner_id, module);
ALTER TABLE ONLY public.body_insights ADD CONSTRAINT body_insights_owner_type_owner_id_fingerprint_key UNIQUE (owner_type, owner_id, fingerprint);
ALTER TABLE ONLY public.body_onboarding ADD CONSTRAINT body_onboarding_owner_type_owner_id_key UNIQUE (owner_type, owner_id);
ALTER TABLE ONLY public.body_weekly_summaries ADD CONSTRAINT body_weekly_summaries_owner_type_owner_id_summary_type_peri_key UNIQUE (owner_type, owner_id, summary_type, period_start);
ALTER TABLE ONLY public.clinical_council_experts ADD CONSTRAINT clinical_council_experts_invitation_id_key UNIQUE (invitation_id);
ALTER TABLE ONLY public.clinical_council_invitations ADD CONSTRAINT clinical_council_invitations_invite_code_key UNIQUE (invite_code);
ALTER TABLE ONLY public.clinical_council_invitations ADD CONSTRAINT clinical_council_invitations_token_hash_key UNIQUE (token_hash);
ALTER TABLE ONLY public.continuation_credentials ADD CONSTRAINT continuation_credentials_lookup_code_key UNIQUE (lookup_code);
ALTER TABLE ONLY public.continuation_credentials ADD CONSTRAINT continuation_credentials_owner_type_owner_id_key UNIQUE (owner_type, owner_id);
ALTER TABLE ONLY public.doctor_invite_links ADD CONSTRAINT doctor_invite_links_token_key UNIQUE (token);
ALTER TABLE ONLY public.expert_organization_memberships ADD CONSTRAINT expert_organization_memberships_organization_id_expert_id_key UNIQUE (organization_id, expert_id);
ALTER TABLE ONLY public.experts ADD CONSTRAINT experts_access_code_key UNIQUE (access_code);
ALTER TABLE ONLY public.organizations ADD CONSTRAINT organizations_slug_key UNIQUE (slug);
ALTER TABLE ONLY public.sessions ADD CONSTRAINT sessions_public_code_key UNIQUE (public_code);
ALTER TABLE ONLY public.specialist_sessions ADD CONSTRAINT specialist_sessions_token_hash_key UNIQUE (token_hash);
ALTER TABLE ONLY public.support_daily_checkins ADD CONSTRAINT support_daily_checkins_unique_day UNIQUE (owner_type, owner_id, checkin_date);
ALTER TABLE ONLY public.support_owner_practices ADD CONSTRAINT support_owner_practices_unique UNIQUE (owner_type, owner_id, practice_key);
ALTER TABLE ONLY public.support_owner_profiles ADD CONSTRAINT support_owner_profiles_unique UNIQUE (owner_type, owner_id);
ALTER TABLE ONLY public.usage_ledger ADD CONSTRAINT uq_ledger_request_id UNIQUE (request_id);
ALTER TABLE ONLY public.usage_wallets ADD CONSTRAINT uq_wallet_owner_module UNIQUE (owner_type, owner_id, module);

-- ============================================================================
-- 5. INDEXES
-- ============================================================================

CREATE INDEX case_reviews_assigned_expert_id_idx ON public.case_reviews USING btree (assigned_expert_id);
CREATE INDEX case_reviews_module_idx ON public.case_reviews USING btree (module);
CREATE INDEX case_reviews_organization_id_idx ON public.case_reviews USING btree (organization_id);
CREATE INDEX case_reviews_primary_expert_id_idx ON public.case_reviews USING btree (primary_expert_id);
CREATE INDEX dil_expert_id_idx ON public.doctor_invite_links USING btree (expert_id);
CREATE INDEX dil_organization_id_idx ON public.doctor_invite_links USING btree (organization_id);
CREATE INDEX dil_status_idx ON public.doctor_invite_links USING btree (status);
CREATE INDEX dil_token_idx ON public.doctor_invite_links USING btree (token);
CREATE INDEX eom_expert_id_idx ON public.expert_organization_memberships USING btree (expert_id);
CREATE INDEX eom_organization_id_idx ON public.expert_organization_memberships USING btree (organization_id);
CREATE INDEX eom_status_idx ON public.expert_organization_memberships USING btree (status);
CREATE INDEX experts_access_code_idx ON public.experts USING btree (access_code);
CREATE INDEX idx_admin_audit_log_action ON public.admin_audit_log USING btree (action);
CREATE INDEX idx_admin_audit_log_admin ON public.admin_audit_log USING btree (admin_role);
CREATE INDEX idx_admin_audit_log_performed ON public.admin_audit_log USING btree (performed_at DESC);
CREATE INDEX idx_ai_chat_owner_created ON public.body_ai_chat USING btree (owner_id, created_at DESC);
CREATE INDEX idx_ai_chat_related_daily_log ON public.body_ai_chat USING btree (related_daily_log_id);
CREATE INDEX idx_ai_chat_related_plate ON public.body_ai_chat USING btree (related_plate_id);
CREATE INDEX idx_ai_chat_related_summary ON public.body_ai_chat USING btree (related_summary_id);
CREATE INDEX idx_body_clients_session_id ON public.body_clients USING btree (session_id);
CREATE INDEX idx_body_clients_source ON public.body_clients USING btree (source);
CREATE INDEX idx_body_clients_specialist_id ON public.body_clients USING btree (specialist_id);
CREATE INDEX idx_body_daily_logs_log_date ON public.body_daily_logs USING btree (log_date);
CREATE INDEX idx_body_daily_logs_session_id ON public.body_daily_logs USING btree (session_id);
CREATE INDEX idx_body_expert_reviews_session ON public.body_expert_reviews USING btree (session_id);
CREATE INDEX idx_body_expert_reviews_target ON public.body_expert_reviews USING btree (target_type, target_id);
CREATE INDEX idx_body_intake_forms_created_at ON public.body_intake_forms USING btree (created_at DESC);
CREATE INDEX idx_body_intake_forms_session_id ON public.body_intake_forms USING btree (session_id);
CREATE INDEX idx_body_onboarding_owner ON public.body_onboarding USING btree (owner_id);
CREATE INDEX idx_cc_email_campaigns_created ON public.clinical_council_email_campaigns USING btree (created_at DESC);
CREATE INDEX idx_cc_email_campaigns_status ON public.clinical_council_email_campaigns USING btree (status);
CREATE INDEX idx_cc_email_deliveries_campaign ON public.clinical_council_email_deliveries USING btree (campaign_id);
CREATE INDEX idx_cc_email_deliveries_status ON public.clinical_council_email_deliveries USING btree (status);
CREATE INDEX idx_cc_experts_access_token ON public.clinical_council_experts USING btree (access_token_hash);
CREATE INDEX idx_cc_experts_deleted ON public.clinical_council_experts USING btree (deleted_at);
CREATE INDEX idx_cc_experts_email ON public.clinical_council_experts USING btree (email);
CREATE INDEX idx_cc_experts_invitation ON public.clinical_council_experts USING btree (invitation_id);
CREATE INDEX idx_cc_experts_status ON public.clinical_council_experts USING btree (status);
CREATE INDEX idx_cc_invitations_code ON public.clinical_council_invitations USING btree (invite_code);
CREATE INDEX idx_cc_invitations_deleted ON public.clinical_council_invitations USING btree (deleted_at);
CREATE INDEX idx_cc_invitations_email ON public.clinical_council_invitations USING btree (invited_email);
CREATE INDEX idx_cc_invitations_status ON public.clinical_council_invitations USING btree (status);
CREATE INDEX idx_cc_invitations_token_hash ON public.clinical_council_invitations USING btree (token_hash);
CREATE INDEX idx_health_contexts_module ON public.body_health_contexts USING btree (module);
CREATE INDEX idx_health_contexts_owner ON public.body_health_contexts USING btree (owner_type, owner_id);
CREATE INDEX idx_health_contexts_updated ON public.body_health_contexts USING btree (updated_at);
CREATE INDEX idx_insights_fingerprint ON public.body_insights USING btree (owner_id, fingerprint);
CREATE INDEX idx_insights_owner_status ON public.body_insights USING btree (owner_id, status, priority, created_at DESC);
CREATE INDEX idx_ledger_module ON public.usage_ledger USING btree (module);
CREATE INDEX idx_ledger_request_id ON public.usage_ledger USING btree (request_id);
CREATE INDEX idx_ledger_wallet_created ON public.usage_ledger USING btree (wallet_id, created_at DESC);
CREATE INDEX idx_plate_history_daily_log ON public.body_plate_history USING btree (daily_log_id);
CREATE INDEX idx_plate_history_owner_created ON public.body_plate_history USING btree (owner_id, created_at DESC);
CREATE INDEX idx_plate_history_owner_date ON public.body_plate_history USING btree (owner_id, log_date DESC);
CREATE INDEX idx_plate_history_session ON public.body_plate_history USING btree (session_id);
CREATE INDEX idx_service_requests_created ON public.service_requests USING btree (created_at);
CREATE INDEX idx_service_requests_due ON public.service_requests USING btree (due_at);
CREATE INDEX idx_service_requests_module ON public.service_requests USING btree (module);
CREATE INDEX idx_service_requests_owner ON public.service_requests USING btree (owner_type, owner_id);
CREATE INDEX idx_service_requests_specialist ON public.service_requests USING btree (specialist_id);
CREATE INDEX idx_service_requests_status ON public.service_requests USING btree (status);
CREATE INDEX idx_service_requests_type ON public.service_requests USING btree (request_type);
CREATE INDEX idx_sessions_access_token_hash ON public.sessions USING btree (access_token_hash) WHERE (access_token_hash IS NOT NULL);
CREATE UNIQUE INDEX idx_sessions_report_request_id ON public.sessions USING btree (report_request_id);
CREATE INDEX idx_sessions_report_status ON public.sessions USING btree (session_id, report_generation_status);
CREATE INDEX idx_support_ai_chat_owner ON public.support_ai_chat USING btree (owner_id, created_at DESC);
CREATE INDEX idx_support_daily_checkins_owner ON public.support_daily_checkins USING btree (owner_type, owner_id, checkin_date DESC);
CREATE INDEX idx_support_owner_practices_owner ON public.support_owner_practices USING btree (owner_type, owner_id, status, last_recommended_at DESC);
CREATE INDEX idx_wallets_owner_module ON public.usage_wallets USING btree (owner_id, module);
CREATE INDEX idx_wallets_status ON public.usage_wallets USING btree (status);
CREATE INDEX idx_wallets_visible ON public.usage_wallets USING btree (visible_to_client) WHERE (visible_to_client = true);
CREATE INDEX idx_weekly_summaries_owner ON public.body_weekly_summaries USING btree (owner_id, period_start DESC);
CREATE INDEX organizations_status_idx ON public.organizations USING btree (status);
CREATE INDEX organizations_type_idx ON public.organizations USING btree (type);
CREATE INDEX pa_module_idx ON public.patient_assignments USING btree (module);
CREATE INDEX pa_organization_id_idx ON public.patient_assignments USING btree (organization_id);
CREATE INDEX pa_owner_idx ON public.patient_assignments USING btree (owner_type, owner_id) WHERE (owner_type IS NOT NULL);
CREATE UNIQUE INDEX pa_owner_org_module_uniq ON public.patient_assignments USING btree (owner_type, owner_id, organization_id, module) NULLS NOT DISTINCT WHERE ((owner_type IS NOT NULL) AND (status = 'active'::text));
CREATE INDEX pa_primary_expert_id_idx ON public.patient_assignments USING btree (primary_expert_id);
CREATE INDEX pa_public_code_idx ON public.patient_assignments USING btree (public_code);
CREATE UNIQUE INDEX pa_public_code_org_module_uniq ON public.patient_assignments USING btree (public_code, organization_id, module) NULLS NOT DISTINCT WHERE ((public_code IS NOT NULL) AND (status = 'active'::text));
CREATE INDEX pa_status_idx ON public.patient_assignments USING btree (status);
CREATE INDEX pacc_expert_id_idx ON public.patient_access USING btree (expert_id);
CREATE INDEX pacc_module_idx ON public.patient_access USING btree (module);
CREATE INDEX pacc_owner_idx ON public.patient_access USING btree (owner_type, owner_id) WHERE (owner_type IS NOT NULL);
CREATE UNIQUE INDEX pacc_owner_org_expert_module_uniq ON public.patient_access USING btree (owner_type, owner_id, organization_id, expert_id, module) NULLS NOT DISTINCT WHERE ((owner_type IS NOT NULL) AND (status = 'active'::text));
CREATE INDEX pacc_public_code_idx ON public.patient_access USING btree (public_code);
CREATE UNIQUE INDEX pacc_public_code_org_expert_module_uniq ON public.patient_access USING btree (public_code, organization_id, expert_id, module) NULLS NOT DISTINCT WHERE ((public_code IS NOT NULL) AND (status = 'active'::text));
CREATE INDEX pacc_status_idx ON public.patient_access USING btree (status);
CREATE INDEX sessions_invite_token_idx ON public.sessions USING btree (invite_token);
CREATE INDEX sessions_module_idx ON public.sessions USING btree (module);
CREATE INDEX sessions_organization_id_idx ON public.sessions USING btree (organization_id);
CREATE INDEX sessions_primary_expert_id_idx ON public.sessions USING btree (primary_expert_id);
CREATE INDEX sessions_public_code_idx ON public.sessions USING btree (public_code);
CREATE INDEX ss_expert_id_idx ON public.specialist_sessions USING btree (expert_id);
CREATE INDEX ss_expires_at_idx ON public.specialist_sessions USING btree (expires_at);
CREATE INDEX training_sessions_case_type_idx ON public.training_sessions USING btree (expected_case_type);
CREATE INDEX training_sessions_created_at_idx ON public.training_sessions USING btree (created_at DESC);
CREATE INDEX training_sessions_expert_id_idx ON public.training_sessions USING btree (expert_id);
CREATE INDEX training_sessions_module_idx ON public.training_sessions USING btree (module);
CREATE INDEX training_sessions_organization_id_idx ON public.training_sessions USING btree (organization_id);
CREATE INDEX pacc_organization_id_idx ON public.patient_access USING btree (organization_id);
CREATE INDEX quality_review_insights_created_at_idx ON public.quality_review_insights USING btree (created_at DESC);
CREATE INDEX quality_review_insights_status_idx ON public.quality_review_insights USING btree (status);
CREATE INDEX training_sessions_primary_expert_id_idx ON public.training_sessions USING btree (primary_expert_id);
CREATE INDEX training_sessions_public_code_idx ON public.training_sessions USING btree (public_code);
CREATE INDEX training_sessions_session_kind_idx ON public.training_sessions USING btree (session_kind);
CREATE INDEX training_sessions_status_idx ON public.training_sessions USING btree (status);

-- ============================================================================
-- 6. FUNCTIONS
-- ============================================================================

-- clear_continuation_failed_attempts
CREATE FUNCTION public.clear_continuation_failed_attempts(p_attempt_key text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM public.continuation_failed_attempts
  WHERE attempt_key = p_attempt_key;
END;
$$;

-- consume_usage_credits
CREATE FUNCTION public.consume_usage_credits(
  p_wallet_id uuid,
  p_amount bigint,
  p_request_id text,
  p_resource_type text DEFAULT NULL,
  p_module text DEFAULT 'support',
  p_session_id text DEFAULT NULL,
  p_provider text DEFAULT NULL,
  p_model text DEFAULT NULL,
  p_input_tokens integer DEFAULT NULL,
  p_output_tokens integer DEFAULT NULL,
  p_audio_seconds integer DEFAULT NULL,
  p_image_count integer DEFAULT NULL,
  p_estimated_cost numeric DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
declare
  v_wallet public.usage_wallets%rowtype;
  v_balance_before bigint;
  v_remaining bigint;
begin
  -- Lock wallet row
  SELECT * INTO v_wallet
  FROM public.usage_wallets
  WHERE id = p_wallet_id
  FOR UPDATE;

  IF NOT FOUND THEN
    return jsonb_build_object('ok', false, 'error', 'wallet_not_found');
  END IF;

  IF v_wallet.status != 'active' THEN
    return jsonb_build_object('ok', false, 'error', 'wallet_not_active');
  END IF;

  v_balance_before := v_wallet.balance;
  v_remaining := v_wallet.balance - p_amount;

  IF v_remaining < 0 THEN
    return jsonb_build_object('ok', false, 'error', 'insufficient_credits', 'balance', v_wallet.balance);
  END IF;

  -- Debit wallet
  UPDATE public.usage_wallets
  SET balance = v_remaining,
      total_used = total_used + p_amount,
      updated_at = now()
  WHERE id = p_wallet_id;

  -- Insert ledger entry
  INSERT INTO public.usage_ledger (
    wallet_id, entry_type, amount, balance_before, balance_after,
    resource_type, request_id, module, session_id,
    provider, model, input_tokens, output_tokens, audio_seconds, image_count,
    estimated_cost, metadata
  ) VALUES (
    p_wallet_id, 'usage_debit', p_amount, v_balance_before, v_remaining,
    p_resource_type, p_request_id, p_module, p_session_id,
    p_provider, p_model, p_input_tokens, p_output_tokens, p_audio_seconds, p_image_count,
    p_estimated_cost, p_metadata
  );

  return jsonb_build_object(
    'ok', true,
    'balance', v_remaining,
    'debited', p_amount
  );
end;
$$;

-- enforce_patient_access_identity
CREATE FUNCTION public.enforce_patient_access_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.owner_type IS NOT NULL AND NEW.owner_id IS NOT NULL THEN
    NEW.public_code := NULL;
  ELSIF NEW.public_code IS NOT NULL THEN
    NEW.owner_type := NULL;
    NEW.owner_id := NULL;
  END IF;

  IF NEW.owner_type IS NULL AND NEW.owner_id IS NULL AND NEW.public_code IS NULL THEN
    RAISE EXCEPTION 'patient_access must have either public_code or owner identity';
  END IF;

  RETURN NEW;
END;
$$;

-- enforce_patient_assignment_identity
CREATE FUNCTION public.enforce_patient_assignment_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.owner_type IS NOT NULL AND NEW.owner_id IS NOT NULL THEN
    NEW.public_code := NULL;
  ELSIF NEW.public_code IS NOT NULL THEN
    NEW.owner_type := NULL;
    NEW.owner_id := NULL;
  END IF;

  IF NEW.owner_type IS NULL AND NEW.owner_id IS NULL AND NEW.public_code IS NULL THEN
    RAISE EXCEPTION 'patient_assignments must have either public_code or owner identity';
  END IF;

  RETURN NEW;
END;
$$;

-- increment_continuation_failed_attempts
CREATE FUNCTION public.increment_continuation_failed_attempts(p_attempt_key text)
RETURNS TABLE(failed_attempt_count integer, locked_until timestamp with time zone)
LANGUAGE plpgsql
AS $$
begin
  return query
  INSERT INTO public.continuation_failed_attempts (attempt_key, failed_attempt_count, locked_until, updated_at)
  VALUES (p_attempt_key, 1,
    CASE WHEN 1 >= 5 THEN now() + interval '15 minutes' ELSE NULL END,
    now())
  ON CONFLICT (attempt_key) DO UPDATE
  SET failed_attempt_count = public.continuation_failed_attempts.failed_attempt_count + 1,
      locked_until = CASE
        WHEN public.continuation_failed_attempts.failed_attempt_count + 1 >= 5
        THEN now() + interval '15 minutes'
        ELSE public.continuation_failed_attempts.locked_until
      END,
      updated_at = now()
  RETURNING continuation_failed_attempts.failed_attempt_count, continuation_failed_attempts.locked_until;
end;
$$;

-- reassign_body_client
CREATE FUNCTION public.reassign_body_client(
  p_owner_id uuid,
  p_new_expert_id uuid,
  p_organization_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_old_assignment_id uuid;
  v_new_assignment_id uuid;
  v_current_expert uuid;
BEGIN
  -- Find current active assignment
  SELECT id, primary_expert_id INTO v_old_assignment_id, v_current_expert
  FROM public.patient_assignments
  WHERE owner_type = 'anonymous_profile'
    AND owner_id = p_owner_id
    AND module = 'body'
    AND status = 'active'
  ORDER BY created_at DESC
  LIMIT 1;

  -- Already assigned to this expert
  IF v_current_expert = p_new_expert_id THEN
    RETURN jsonb_build_object('ok', true, 'unchanged', true);
  END IF;

  -- Deactivate old assignment
  IF v_old_assignment_id IS NOT NULL THEN
    UPDATE public.patient_assignments
    SET status = 'inactive', updated_at = now()
    WHERE id = v_old_assignment_id;
  END IF;

  -- Create new assignment
  INSERT INTO public.patient_assignments (
    owner_type, owner_id, organization_id, primary_expert_id,
    assigned_by_expert_name, module, status, patient_label
  ) VALUES (
    'anonymous_profile', p_owner_id, p_organization_id, p_new_expert_id,
    'system', 'body', 'active', 'Клиент'
  ) RETURNING id INTO v_new_assignment_id;

  RETURN jsonb_build_object(
    'ok', true,
    'old_assignment_id', v_old_assignment_id,
    'new_assignment_id', v_new_assignment_id
  );
END;
$$;

-- rls_auto_enable
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog'
AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
      RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;

-- trigger_set_updated_at
CREATE FUNCTION public.trigger_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- update_updated_at
CREATE FUNCTION public.update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ============================================================================
-- 7. RLS
-- ============================================================================

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.body_ai_chat ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.body_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.body_daily_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.body_expert_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.body_health_contexts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.body_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.body_intake_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.body_onboarding ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.body_plate_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.body_weekly_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinical_council_email_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinical_council_email_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinical_council_experts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinical_council_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.continuation_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.continuation_failed_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_invite_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expert_organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quality_review_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.specialist_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ai_chat ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_daily_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_owner_practices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_owner_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_wallets ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 8. RLS POLICIES
-- ============================================================================

CREATE POLICY cc_email_campaigns_service_role_only ON public.clinical_council_email_campaigns USING ((current_setting('role'::text) = 'service_role'::text));
CREATE POLICY cc_email_deliveries_service_role_only ON public.clinical_council_email_deliveries USING ((current_setting('role'::text) = 'service_role'::text));
CREATE POLICY cc_experts_service_role_only ON public.clinical_council_experts USING ((current_setting('role'::text) = 'service_role'::text));
CREATE POLICY cc_invitations_service_role_only ON public.clinical_council_invitations USING ((current_setting('role'::text) = 'service_role'::text));
CREATE POLICY support_ai_chat_service_role_only ON public.support_ai_chat USING ((current_setting('role'::text) = 'service_role'::text));
CREATE POLICY support_daily_checkins_service_role_only ON public.support_daily_checkins USING ((current_setting('role'::text) = 'service_role'::text));
CREATE POLICY support_owner_practices_service_role_only ON public.support_owner_practices USING ((current_setting('role'::text) = 'service_role'::text));
CREATE POLICY support_owner_profiles_service_role_only ON public.support_owner_profiles USING ((current_setting('role'::text) = 'service_role'::text));
CREATE POLICY usage_ledger_service_role_only ON public.usage_ledger USING ((current_setting('role'::text) = 'service_role'::text));
CREATE POLICY usage_wallets_service_role_only ON public.usage_wallets USING ((current_setting('role'::text) = 'service_role'::text));

-- ============================================================================
-- 9. TRIGGERS
-- ============================================================================

CREATE TRIGGER cc_experts_updated_at BEFORE UPDATE ON public.clinical_council_experts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER cc_invitations_updated_at BEFORE UPDATE ON public.clinical_council_invitations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER trg_pa_identity_check BEFORE INSERT OR UPDATE ON public.patient_assignments FOR EACH ROW EXECUTE FUNCTION public.enforce_patient_assignment_identity();
CREATE TRIGGER trg_pacc_identity_check BEFORE INSERT OR UPDATE ON public.patient_access FOR EACH ROW EXECUTE FUNCTION public.enforce_patient_access_identity();
CREATE TRIGGER trg_wallets_updated_at BEFORE UPDATE ON public.usage_wallets FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

-- ============================================================================
-- 10. EVENT TRIGGER (rls_auto_enable)
-- ============================================================================

DROP EVENT TRIGGER IF EXISTS ensure_rls;
CREATE EVENT TRIGGER ensure_rls
ON ddl_command_end
WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
EXECUTE FUNCTION public.rls_auto_enable();

-- ============================================================================
-- 11. ACL — SCHEMA
-- ============================================================================

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;

-- ============================================================================
-- 12. ACL — FUNCTIONS
-- ============================================================================

GRANT ALL ON FUNCTION public.clear_continuation_failed_attempts(p_attempt_key text) TO anon;
GRANT ALL ON FUNCTION public.clear_continuation_failed_attempts(p_attempt_key text) TO authenticated;
GRANT ALL ON FUNCTION public.clear_continuation_failed_attempts(p_attempt_key text) TO service_role;

REVOKE ALL ON FUNCTION public.consume_usage_credits(p_wallet_id uuid, p_amount bigint, p_request_id text, p_resource_type text, p_module text, p_session_id text, p_provider text, p_model text, p_input_tokens integer, p_output_tokens integer, p_audio_seconds integer, p_image_count integer, p_estimated_cost numeric, p_metadata jsonb) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.consume_usage_credits(p_wallet_id uuid, p_amount bigint, p_request_id text, p_resource_type text, p_module text, p_session_id text, p_provider text, p_model text, p_input_tokens integer, p_output_tokens integer, p_audio_seconds integer, p_image_count integer, p_estimated_cost numeric, p_metadata jsonb) TO service_role;

GRANT ALL ON FUNCTION public.enforce_patient_access_identity() TO anon;
GRANT ALL ON FUNCTION public.enforce_patient_access_identity() TO authenticated;
GRANT ALL ON FUNCTION public.enforce_patient_access_identity() TO service_role;

GRANT ALL ON FUNCTION public.enforce_patient_assignment_identity() TO anon;
GRANT ALL ON FUNCTION public.enforce_patient_assignment_identity() TO authenticated;
GRANT ALL ON FUNCTION public.enforce_patient_assignment_identity() TO service_role;

GRANT ALL ON FUNCTION public.increment_continuation_failed_attempts(p_attempt_key text) TO anon;
GRANT ALL ON FUNCTION public.increment_continuation_failed_attempts(p_attempt_key text) TO authenticated;
GRANT ALL ON FUNCTION public.increment_continuation_failed_attempts(p_attempt_key text) TO service_role;

REVOKE ALL ON FUNCTION public.reassign_body_client(p_owner_id uuid, p_new_expert_id uuid, p_organization_id uuid) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.reassign_body_client(p_owner_id uuid, p_new_expert_id uuid, p_organization_id uuid) TO service_role;

GRANT ALL ON FUNCTION public.rls_auto_enable() TO anon;
GRANT ALL ON FUNCTION public.rls_auto_enable() TO authenticated;
GRANT ALL ON FUNCTION public.rls_auto_enable() TO service_role;

GRANT ALL ON FUNCTION public.trigger_set_updated_at() TO anon;
GRANT ALL ON FUNCTION public.trigger_set_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.trigger_set_updated_at() TO service_role;

GRANT ALL ON FUNCTION public.update_updated_at() TO anon;
GRANT ALL ON FUNCTION public.update_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.update_updated_at() TO service_role;

-- ============================================================================
-- 13. ACL — TABLES
-- ============================================================================

GRANT ALL ON TABLE public.admin_audit_log TO anon;
GRANT ALL ON TABLE public.admin_audit_log TO authenticated;
GRANT ALL ON TABLE public.admin_audit_log TO service_role;

GRANT ALL ON TABLE public.body_ai_chat TO anon;
GRANT ALL ON TABLE public.body_ai_chat TO authenticated;
GRANT ALL ON TABLE public.body_ai_chat TO service_role;

GRANT ALL ON TABLE public.body_clients TO anon;
GRANT ALL ON TABLE public.body_clients TO authenticated;
GRANT ALL ON TABLE public.body_clients TO service_role;

GRANT ALL ON TABLE public.body_daily_logs TO anon;
GRANT ALL ON TABLE public.body_daily_logs TO authenticated;
GRANT ALL ON TABLE public.body_daily_logs TO service_role;

GRANT ALL ON TABLE public.body_expert_reviews TO anon;
GRANT ALL ON TABLE public.body_expert_reviews TO authenticated;
GRANT ALL ON TABLE public.body_expert_reviews TO service_role;

GRANT ALL ON TABLE public.body_health_contexts TO anon;
GRANT ALL ON TABLE public.body_health_contexts TO authenticated;
GRANT ALL ON TABLE public.body_health_contexts TO service_role;

GRANT ALL ON TABLE public.body_insights TO anon;
GRANT ALL ON TABLE public.body_insights TO authenticated;
GRANT ALL ON TABLE public.body_insights TO service_role;

GRANT ALL ON TABLE public.body_intake_forms TO anon;
GRANT ALL ON TABLE public.body_intake_forms TO authenticated;
GRANT ALL ON TABLE public.body_intake_forms TO service_role;

GRANT ALL ON TABLE public.body_onboarding TO anon;
GRANT ALL ON TABLE public.body_onboarding TO authenticated;
GRANT ALL ON TABLE public.body_onboarding TO service_role;

GRANT ALL ON TABLE public.body_plate_history TO anon;
GRANT ALL ON TABLE public.body_plate_history TO authenticated;
GRANT ALL ON TABLE public.body_plate_history TO service_role;

GRANT ALL ON TABLE public.body_weekly_summaries TO anon;
GRANT ALL ON TABLE public.body_weekly_summaries TO authenticated;
GRANT ALL ON TABLE public.body_weekly_summaries TO service_role;

GRANT ALL ON TABLE public.case_reviews TO anon;
GRANT ALL ON TABLE public.case_reviews TO authenticated;
GRANT ALL ON TABLE public.case_reviews TO service_role;

GRANT ALL ON TABLE public.clinical_council_email_campaigns TO anon;
GRANT ALL ON TABLE public.clinical_council_email_campaigns TO authenticated;
GRANT ALL ON TABLE public.clinical_council_email_campaigns TO service_role;

GRANT ALL ON TABLE public.clinical_council_email_deliveries TO anon;
GRANT ALL ON TABLE public.clinical_council_email_deliveries TO authenticated;
GRANT ALL ON TABLE public.clinical_council_email_deliveries TO service_role;

GRANT ALL ON TABLE public.clinical_council_experts TO anon;
GRANT ALL ON TABLE public.clinical_council_experts TO authenticated;
GRANT ALL ON TABLE public.clinical_council_experts TO service_role;

GRANT ALL ON TABLE public.clinical_council_invitations TO anon;
GRANT ALL ON TABLE public.clinical_council_invitations TO authenticated;
GRANT ALL ON TABLE public.clinical_council_invitations TO service_role;

GRANT ALL ON TABLE public.continuation_credentials TO anon;
GRANT ALL ON TABLE public.continuation_credentials TO authenticated;
GRANT ALL ON TABLE public.continuation_credentials TO service_role;

GRANT ALL ON TABLE public.continuation_failed_attempts TO anon;
GRANT ALL ON TABLE public.continuation_failed_attempts TO authenticated;
GRANT ALL ON TABLE public.continuation_failed_attempts TO service_role;

GRANT ALL ON TABLE public.doctor_invite_links TO anon;
GRANT ALL ON TABLE public.doctor_invite_links TO authenticated;
GRANT ALL ON TABLE public.doctor_invite_links TO service_role;

GRANT ALL ON TABLE public.expert_organization_memberships TO anon;
GRANT ALL ON TABLE public.expert_organization_memberships TO authenticated;
GRANT ALL ON TABLE public.expert_organization_memberships TO service_role;

GRANT ALL ON TABLE public.experts TO anon;
GRANT ALL ON TABLE public.experts TO authenticated;
GRANT ALL ON TABLE public.experts TO service_role;

GRANT ALL ON TABLE public.organizations TO anon;
GRANT ALL ON TABLE public.organizations TO authenticated;
GRANT ALL ON TABLE public.organizations TO service_role;

GRANT ALL ON TABLE public.patient_access TO anon;
GRANT ALL ON TABLE public.patient_access TO authenticated;
GRANT ALL ON TABLE public.patient_access TO service_role;

GRANT ALL ON TABLE public.patient_assignments TO anon;
GRANT ALL ON TABLE public.patient_assignments TO authenticated;
GRANT ALL ON TABLE public.patient_assignments TO service_role;

GRANT ALL ON TABLE public.quality_review_insights TO anon;
GRANT ALL ON TABLE public.quality_review_insights TO authenticated;
GRANT ALL ON TABLE public.quality_review_insights TO service_role;

GRANT ALL ON TABLE public.service_requests TO anon;
GRANT ALL ON TABLE public.service_requests TO authenticated;
GRANT ALL ON TABLE public.service_requests TO service_role;

GRANT ALL ON TABLE public.sessions TO anon;
GRANT ALL ON TABLE public.sessions TO authenticated;
GRANT ALL ON TABLE public.sessions TO service_role;

REVOKE ALL ON TABLE public.specialist_sessions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.specialist_sessions TO service_role;

GRANT ALL ON TABLE public.support_ai_chat TO anon;
GRANT ALL ON TABLE public.support_ai_chat TO authenticated;
GRANT ALL ON TABLE public.support_ai_chat TO service_role;

GRANT ALL ON TABLE public.support_daily_checkins TO anon;
GRANT ALL ON TABLE public.support_daily_checkins TO authenticated;
GRANT ALL ON TABLE public.support_daily_checkins TO service_role;

GRANT ALL ON TABLE public.support_owner_practices TO anon;
GRANT ALL ON TABLE public.support_owner_practices TO authenticated;
GRANT ALL ON TABLE public.support_owner_practices TO service_role;

GRANT ALL ON TABLE public.support_owner_profiles TO anon;
GRANT ALL ON TABLE public.support_owner_profiles TO authenticated;
GRANT ALL ON TABLE public.support_owner_profiles TO service_role;

GRANT ALL ON TABLE public.training_sessions TO anon;
GRANT ALL ON TABLE public.training_sessions TO authenticated;
GRANT ALL ON TABLE public.training_sessions TO service_role;

GRANT ALL ON TABLE public.usage_ledger TO anon;
GRANT ALL ON TABLE public.usage_ledger TO authenticated;
GRANT ALL ON TABLE public.usage_ledger TO service_role;

GRANT ALL ON TABLE public.usage_wallets TO anon;
GRANT ALL ON TABLE public.usage_wallets TO authenticated;
GRANT ALL ON TABLE public.usage_wallets TO service_role;

-- ============================================================================
-- 14. ALTER DEFAULT PRIVILEGES
-- ============================================================================

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;
-- NOTE: ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin omitted.
-- These are platform-owned and already configured by Supabase at project creation.
-- Attempting to set them as postgres fails with permission denied (SQLSTATE 42501).

-- ============================================================================
-- 15. COMMENTS
-- ============================================================================

COMMENT ON TABLE public.admin_audit_log IS 'Tracks admin actions for accountability. Does NOT store tokens, secrets, or full payloads.';
COMMENT ON COLUMN public.admin_audit_log.details IS 'Non-sensitive metadata (counts, types, etc). Never store tokens or full payloads.';
COMMENT ON TABLE public.body_daily_logs IS 'Daily health diary entries for returning clients.';
COMMENT ON COLUMN public.body_daily_logs.access_token_hash IS 'Snapshot of sessions.access_token_hash at log creation time';
COMMENT ON TABLE public.body_expert_reviews IS 'Expert reviews of body module AI outputs.';
COMMENT ON COLUMN public.body_expert_reviews.session_id IS 'Public session code or internal session identifier, e.g. HEALTH-XXXX-XXX or ТОЧКА-XXXX-XXXX.';
COMMENT ON TABLE public.clinical_council_experts IS 'Approved clinical council experts. Status lifecycle: pending_review → active → paused.';
COMMENT ON COLUMN public.clinical_council_experts.access_token_hash IS 'SHA-256 hash of the expert access token for login.';
COMMENT ON COLUMN public.clinical_council_experts.access_token_generated_at IS 'Timestamp when the current access token was generated. Used for expiry checks.';
COMMENT ON TABLE public.clinical_council_invitations IS 'Invitation links for Clinical Council experts. One-time or limited-use tokens.';
COMMENT ON COLUMN public.clinical_council_invitations.invite_code IS 'Public short code COUNCIL-XXXX-XXX shown in admin UI.';
COMMENT ON COLUMN public.clinical_council_invitations.token_hash IS 'SHA-256 hash of the raw invite token. Never stored in plaintext.';
COMMENT ON TABLE public.continuation_credentials IS 'Cross-device continuation credentials per canonical owner';
COMMENT ON COLUMN public.continuation_credentials.module IS 'support or body';
COMMENT ON COLUMN public.continuation_credentials.owner_type IS 'anonymous_case for support, anonymous_profile for body';
COMMENT ON COLUMN public.continuation_credentials.owner_id IS 'Canonical anonymous owner UUID';
COMMENT ON COLUMN public.continuation_credentials.lookup_code IS 'Publicly visible part of continuation code (e.g. ТОЧКА-XXXX-XXXX)';
COMMENT ON COLUMN public.continuation_credentials.secret_hash IS 'HMAC-SHA256 of secret part with server-side pepper';
COMMENT ON COLUMN public.continuation_credentials.secret_version IS 'Version for future crypto migrations';
COMMENT ON TABLE public.continuation_failed_attempts IS 'Per-IP+lookup failure attempts for brute-force protection';
COMMENT ON COLUMN public.continuation_failed_attempts.attempt_key IS 'HMAC-derived opaque key for IP + lookup_code pair';
COMMENT ON COLUMN public.sessions.access_token_hash IS 'SHA-256 hash of the raw access token; NULL for legacy sessions';
COMMENT ON COLUMN public.sessions.legacy_access IS 'If true, session can be read without access_token (backward compat)';
COMMENT ON COLUMN public.sessions.access_token_generated_at IS 'When the current access token was generated';
