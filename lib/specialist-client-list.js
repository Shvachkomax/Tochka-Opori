export function buildSpecialistClientList({ module, assignments = [], accessRows = [], bodyDisplayNames = new Map() }) {
  const clients = new Map();

  for (const assignment of assignments) {
    const key = module === "body"
      ? `body:${assignment.owner_type}:${assignment.owner_id}`
      : `support:${assignment.public_code}`;
    clients.set(key, {
      client_ref: `assignment:${assignment.id}`,
      module,
      _ownerId: assignment.owner_id,
      relationship: "primary",
      access_role: "owner",
      status: assignment.status,
      last_activity_at: assignment.updated_at,
      _patientLabel: assignment.patient_label,
    });
  }

  for (const access of accessRows) {
    const key = module === "body"
      ? `body:${access.owner_type}:${access.owner_id}`
      : `support:${access.public_code}`;
    if (!clients.has(key)) {
      clients.set(key, {
        client_ref: `access:${access.id}`,
        module,
        _ownerId: access.owner_id,
        relationship: "shared",
        access_role: access.access_role,
        status: access.status,
        last_activity_at: null,
        _patientLabel: null,
      });
    }
  }

  return [...clients.values()].map((client) => ({
    client_ref: client.client_ref,
    module: client.module,
    display_name: module === "support"
      ? client._patientLabel || "Клиент без имени"
      : client._ownerId ? bodyDisplayNames.get(client._ownerId) || "Клиент без имени" : "Клиент без имени",
    relationship: client.relationship,
    access_role: client.access_role,
    status: client.status,
    last_activity_at: client.last_activity_at,
  }));
}
