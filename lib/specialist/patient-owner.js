const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function expectedOwnerType(module) {
  if (module === "support") return "anonymous_case";
  if (module === "body") return "anonymous_profile";
  return null;
}

function denied(error = "Пациент не определён.", status = 403) {
  return { ok: false, status, error };
}

// Normalize only identity fields read from the trusted relationship row. Client
// input never participates in this decision. Canonical and legacy identities
// are deliberately mutually exclusive, matching the database trigger contract.
export function resolvePatientRelationshipIdentity(record, module) {
  const ownerType = record?.owner_type ?? null;
  const ownerId = record?.owner_id ?? null;
  const publicCode = typeof record?.public_code === "string" && record.public_code.trim()
    ? record.public_code.trim()
    : null;
  const expectedType = expectedOwnerType(module);

  if (!expectedType) return denied("Несоответствие модуля");
  if ((ownerType === null) !== (ownerId === null)) return denied("Некорректный владелец");

  if (ownerType !== null && ownerId !== null) {
    if (publicCode) return denied("Противоречивая идентификация пациента");
    if (ownerType !== expectedType || !UUID.test(String(ownerId))) {
      return denied("Некорректный владелец");
    }
    return {
      ok: true,
      identitySource: "canonical",
      publicCode: null,
      ownerType,
      ownerId,
    };
  }

  // Existing historical Support links remain supported through their exact
  // relationship-row public_code. Health never had an approved legacy path.
  if (module === "support" && publicCode) {
    return {
      ok: true,
      identitySource: "legacy",
      publicCode,
      ownerType: null,
      ownerId: null,
    };
  }

  return denied("Некорректный владелец");
}

// This is not an authorization mechanism. It runs only after the active,
// specialist-, organization- and module-scoped relationship has been verified.
// Canonical identity is used directly; only an explicitly historical Support
// relationship may resolve its owner through its stored public_code.
export async function resolveClinicalPatientOwner({ resolved, module, supabase, pilotId = null }) {
  const expectedType = expectedOwnerType(module);
  if (!resolved?.ok || !expectedType) return denied();

  if (resolved.identitySource === "canonical") {
    if (resolved.publicCode || resolved.ownerType !== expectedType || !UUID.test(String(resolved.ownerId || ""))) {
      return denied("Противоречивая идентификация пациента");
    }

    // Pilot deployments retain their prior exact-pilot restriction. On the
    // default Test deployment the trusted canonical relationship is sufficient.
    if (module === "support" && pilotId) {
      const { data, error } = await supabase
        .from("sessions")
        .select("anonymous_owner_id")
        .eq("anonymous_owner_id", resolved.ownerId)
        .eq("module", "support")
        .contains("json_data", { pilot_id: pilotId })
        .limit(1)
        .maybeSingle();
      if (error || data?.anonymous_owner_id !== resolved.ownerId) {
        return denied("Нет доступа к пациенту.");
      }
    }

    return {
      ok: true,
      identitySource: "canonical",
      ownerType: resolved.ownerType,
      ownerId: resolved.ownerId,
    };
  }

  if (module !== "support" || resolved.identitySource !== "legacy" || !resolved.publicCode
      || resolved.ownerId || resolved.ownerType) {
    return denied("Противоречивая идентификация пациента");
  }

  const { data, error } = await supabase
    .from("sessions")
    .select("anonymous_owner_id,json_data")
    .eq("public_code", resolved.publicCode)
    .eq("module", "support")
    .maybeSingle();
  if (error || !UUID.test(String(data?.anonymous_owner_id || ""))) return denied();
  if (pilotId && data.json_data?.pilot_id !== pilotId) return denied("Нет доступа к пациенту.");

  return {
    ok: true,
    identitySource: "legacy",
    ownerType: "anonymous_case",
    ownerId: data.anonymous_owner_id,
  };
}
