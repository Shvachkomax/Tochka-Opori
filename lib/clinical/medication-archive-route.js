// Server-only selection. Does not grant authority to prescribe: the
// specialist endpoint and the verified prescriber authorization remain required.
// No best-effort fallback when the archive is explicitly enabled.
const MEDICATION_MUTATIONS = new Set([
  "activate_medication_order",
  "supersede_medication_order",
  "revoke_medication_order",
]);

export function medicationRpcForClinicalArchive(name, enabled = false) {
  if (!MEDICATION_MUTATIONS.has(name)) {
    throw new Error("Unsupported medication mutation");
  }
  return enabled === true ? "clinical_" + name : name;
}
