DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.sessions
    GROUP BY session_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot link match requests: public.sessions contains duplicate session_id values';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_session_id_unique
  ON public.sessions(session_id);

ALTER TABLE public.specialist_match_requests
  ADD COLUMN IF NOT EXISTS session_id text
  REFERENCES public.sessions(session_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_specialist_match_requests_session
  ON public.specialist_match_requests(session_id)
  WHERE session_id IS NOT NULL;

COMMENT ON COLUMN public.specialist_match_requests.session_id IS
  'Patient-requested conversation context; populated only when the patient explicitly requests specialist matching.';
