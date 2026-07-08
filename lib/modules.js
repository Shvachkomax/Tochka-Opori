// Module registry for Tochka-Opori
// Each module defines its own prompts directory and feature set.

export const MODULES = {
  support: {
    id: "support",
    label: "Точка опоры",
    description: "Первичный mental health triage — выявление сигналов, поддержка, маршрутизация",
    promptsDir: "prompts/support/",
    hasSupportToolkit: true,
    hasVoiceAnalysis: true,
    defaultModel: "AI_MODEL_TRIAGE",
  },
  body: {
    id: "body",
    label: "Опора. Здоровье & Стройность",
    description: "Поддержим на пути к здоровому и стройному телу",
    promptsDir: "prompts/body/",
    hasSupportToolkit: false,
    hasVoiceAnalysis: false,
    defaultModel: "AI_MODEL_TRIAGE",
  },
};

export const DEFAULT_MODULE = "support";

export function getModule(id) {
  return MODULES[id] || MODULES[DEFAULT_MODULE];
}

export function isValidModule(id) {
  return !!MODULES[id];
}
