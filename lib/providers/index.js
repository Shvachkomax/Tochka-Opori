import * as openai from "./openai.js";
import { DEFAULT_PROVIDER } from "../config/models.js";

const registry = {};

export function registerProvider(providerModule) {
  registry[providerModule.name] = providerModule;
}

export function getProvider(name) {
  if (!name) return getProvider(DEFAULT_PROVIDER);
  const provider = registry[name];
  if (!provider) {
    throw new Error(`Model router: unknown provider "${name}". Available: ${Object.keys(registry).join(", ")}`);
  }
  return provider;
}

export function getAllProviders() {
  return { ...registry };
}

export function getSupportedProviders() {
  return Object.keys(registry);
}

registerProvider(openai);
