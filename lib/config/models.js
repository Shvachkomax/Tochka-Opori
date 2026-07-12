export const ROUTER_VERSION = "1.0.0";

export const TASK_TYPES = {
  PATIENT_DIALOG: "patient_dialog",
  DOCTOR_REPORT: "doctor_report",
  USER_REPORT: "user_report",
  QUALITY_REVIEW: "quality_review",
  EXPERT_REVIEW: "expert_review",
  PROMPT_REPAIR: "prompt_repair",
  TRAINING_ANALYSIS: "training_analysis",
  SUMMARY: "summary",
  TRANSCRIPTION: "transcription",
  TRANSLATION: "translation",
  VOICE_ANALYSIS: "voice_analysis",
  BODY_INTAKE: "body_intake",
};

export const PROVIDERS = {
  OPENAI: "openai",
  DEEPSEEK: "deepseek",
  YANDEX: "yandex",
  GIGACHAT: "gigachat",
  CLAUDE: "claude",
  GEMINI: "gemini",
};

export const MODELS = {
  TERRA: "terra",
  SOL: "sol",
  LUNA: "luna",
};

export const TASK_MODEL_MAP = {
  [TASK_TYPES.PATIENT_DIALOG]: {
    model: MODELS.TERRA,
    fallbackModel: MODELS.LUNA,
    reasoningEffort: void 0,
  },
  [TASK_TYPES.DOCTOR_REPORT]: {
    model: MODELS.SOL,
    fallbackModel: MODELS.TERRA,
    reasoningEffort: void 0,
  },
  [TASK_TYPES.USER_REPORT]: {
    model: MODELS.SOL,
    fallbackModel: MODELS.TERRA,
    reasoningEffort: void 0,
  },
  [TASK_TYPES.QUALITY_REVIEW]: {
    model: MODELS.SOL,
    fallbackModel: MODELS.TERRA,
    reasoningEffort: void 0,
  },
  [TASK_TYPES.EXPERT_REVIEW]: {
    model: MODELS.SOL,
    fallbackModel: MODELS.TERRA,
    reasoningEffort: void 0,
  },
  [TASK_TYPES.PROMPT_REPAIR]: {
    model: MODELS.LUNA,
    fallbackModel: MODELS.LUNA,
    reasoningEffort: void 0,
  },
  [TASK_TYPES.TRAINING_ANALYSIS]: {
    model: MODELS.SOL,
    fallbackModel: MODELS.TERRA,
    reasoningEffort: void 0,
  },
  [TASK_TYPES.SUMMARY]: {
    model: MODELS.SOL,
    fallbackModel: MODELS.TERRA,
    reasoningEffort: void 0,
  },
  [TASK_TYPES.TRANSCRIPTION]: {
    model: MODELS.TERRA,
    fallbackModel: null,
    reasoningEffort: void 0,
  },
  [TASK_TYPES.TRANSLATION]: {
    model: MODELS.SOL,
    fallbackModel: MODELS.LUNA,
    reasoningEffort: void 0,
  },
  [TASK_TYPES.VOICE_ANALYSIS]: {
    model: MODELS.TERRA,
    fallbackModel: null,
    reasoningEffort: void 0,
  },
  [TASK_TYPES.BODY_INTAKE]: {
    model: MODELS.TERRA,
    fallbackModel: MODELS.LUNA,
    reasoningEffort: void 0,
  },
};

export const PROVIDER_MODEL_MAP = {
  [PROVIDERS.OPENAI]: {
    [MODELS.TERRA]: process.env.AI_MODEL_TRIAGE || "gpt-5.5",
    [MODELS.SOL]:
      process.env.AI_MODEL_REPORT ||
      process.env.AI_MODEL_TRIAGE ||
      "gpt-5.5",
    [MODELS.LUNA]: process.env.AI_MODEL_FALLBACK || "gpt-4.1-mini",
    TRANSCRIPTION: process.env.AI_MODEL_TRANSCRIBE || "gpt-4o-mini-transcribe",
    VOICE_ANALYSIS:
      process.env.OPENAI_VOICE_ANALYSIS_MODEL || "gpt-audio-1.5",
  },
  [PROVIDERS.DEEPSEEK]: {
    [MODELS.TERRA]: "deepseek-chat",
    [MODELS.SOL]: "deepseek-reasoner",
    [MODELS.LUNA]: "deepseek-chat",
  },
  [PROVIDERS.YANDEX]: {
    [MODELS.TERRA]: "yandexgpt/latest",
    [MODELS.SOL]: "yandexgpt/latest",
    [MODELS.LUNA]: "yandexgpt-lite/latest",
  },
  [PROVIDERS.GIGACHAT]: {
    [MODELS.TERRA]: "GigaChat-Pro",
    [MODELS.SOL]: "GigaChat-Pro",
    [MODELS.LUNA]: "GigaChat-Standard",
  },
  [PROVIDERS.CLAUDE]: {
    [MODELS.TERRA]: "claude-sonnet-5",
    [MODELS.SOL]: "claude-opus-5",
    [MODELS.LUNA]: "claude-haiku-5",
  },
  [PROVIDERS.GEMINI]: {
    [MODELS.TERRA]: "gemini-2.0-pro",
    [MODELS.SOL]: "gemini-2.0-ultra",
    [MODELS.LUNA]: "gemini-2.0-flash",
  },
};

export const DEFAULT_PROVIDER = PROVIDERS.OPENAI;
