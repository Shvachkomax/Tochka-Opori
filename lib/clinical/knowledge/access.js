import { KNOWLEDGE_ROLES } from "./constants.js";

export function hasClinicalKnowledgeAccess({ role, requestedOrganizationId, memberships = [] }) {
  if (role === KNOWLEDGE_ROLES.PLATFORM_ADMIN) return true;
  if (![KNOWLEDGE_ROLES.SPECIALIST, KNOWLEDGE_ROLES.ORGANIZATION_ADMIN].includes(role)) return false;
  if (!requestedOrganizationId) return true;
  return memberships.some((membership) => membership.organization_id === requestedOrganizationId);
}

export function sanitizeClinicalText(value, maxLength = 4000) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength).replace(/\s+/g, " ");
}

export function redactPii(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\+?\d[\d\s\-()]{7,}\d/g, "[phone]");
}
