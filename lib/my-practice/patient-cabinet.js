import { getPilotId, isModuleAvailable } from "../security/module-availability.js";

const linkTable = "practice_patient_profile_links";
const ownColumn = (owner) => owner.module === "support" ? "support_owner_id" : "health_owner_id";

export function canLinkPracticeProfiles() {
  return !getPilotId() && isModuleAvailable("body");
}

export async function getPracticePatientOwners(supabase, owner, allowLinks = canLinkPracticeProfiles()) {
  if (!allowLinks) return { owners: [owner] };
  const { data, error } = await supabase.from(linkTable)
    .select("support_owner_id, health_owner_id").eq(ownColumn(owner), owner.ownerId).maybeSingle();
  if (error) return { error };
  if (!data) return { owners: [owner] };
  const peer = owner.module === "support"
    ? { ownerType: "anonymous_profile", ownerId: data.health_owner_id, module: "body" }
    : { ownerType: "anonymous_case", ownerId: data.support_owner_id, module: "support" };
  return { owners: [owner, peer] };
}

export async function changePracticeProfileLink(supabase, owner, peer) {
  if (!peer) {
    const { error } = await supabase.from(linkTable).delete().eq(ownColumn(owner), owner.ownerId);
    return { error };
  }
  const pair = { [ownColumn(owner)]: owner.ownerId, [ownColumn(peer)]: peer.ownerId };
  const { error } = await supabase.from(linkTable).insert(pair);
  if (error?.code !== "23505") return { error };
  const existing = await getPracticePatientOwners(supabase, owner, true);
  if (existing.error) return { error: existing.error };
  if (existing.owners.some((candidate) => samePracticeOwner(candidate, peer))) return {};
  return { conflict: true };
}

export function samePracticeOwner(a, b) {
  return a.ownerType === b.ownerType && a.ownerId === b.ownerId;
}

export async function listPracticePatientSpecialists(supabase, owners, module = owners[0]?.module) {
  if (!['support', 'body'].includes(module)) return [];
  const results = await Promise.all(owners.map(async (owner) => {
    // Legacy Support access rows can use only a public code. Resolve those codes
    // from sessions already owned by this verified profile.
    let codes = [];
    if (owner.module === "support") {
      const sessions = await supabase.from("sessions").select("public_code")
        .eq("anonymous_owner_id", owner.ownerId).eq("module", "support");
      if (sessions.error) throw sessions.error;
      codes = (sessions.data || []).map((session) => session.public_code).filter(Boolean);
    }

    const relations = await Promise.all([
      ["patient_assignments", "primary_expert_id"],
      ["patient_access", "expert_id"],
    ].flatMap(([table, expertColumn]) => {
      const query = () => supabase.from(table)
        .select(`expert_id:${expertColumn}, organization_id`)
        .eq("module", owner.module).eq("status", "active");
      const byOwner = query().eq("owner_type", owner.ownerType).eq("owner_id", owner.ownerId);
      if (!codes.length) return [byOwner];
      return [byOwner, query().is("owner_id", null).in("public_code", codes)];
    }));
    if (relations.some(({ error }) => error)) throw relations.find(({ error }) => error).error;
    return relations.flatMap(({ data }) => data || []);
  }));
  const contexts = [...new Map(results.flat().filter((row) => row.expert_id)
    .map((row) => [`${row.expert_id}:${row.organization_id || ""}`, row])).values()];
  if (!contexts.length) return [];

  const expertIds = [...new Set(contexts.map((row) => row.expert_id))];
  const orgIds = [...new Set(contexts.map((row) => row.organization_id).filter(Boolean))];
  const [experts, organizations, services] = await Promise.all([
    supabase.from("experts").select("id, name, specialty").in("id", expertIds).eq("is_active", true),
    orgIds.length
      ? supabase.from("organizations").select("id, name").in("id", orgIds)
      : { data: [] },
    supabase.from("practice_services")
      .select("id, expert_id, organization_id, modules, name, format, duration_min, price_kop, price_credits, practice_places(name)")
      .in("expert_id", expertIds).eq("is_active", true).contains("modules", [module]).order("name"),
  ]);
  if (experts.error || organizations.error || services.error) {
    throw experts.error || organizations.error || services.error;
  }

  return contexts.flatMap((context) => {
    const expert = experts.data.find(({ id }) => id === context.expert_id);
    if (!expert) return [];
    return [{
      expert_id: expert.id,
      name: expert.name,
      specialty: expert.specialty,
      organization_id: context.organization_id,
      organization_name: organizations.data.find(({ id }) => id === context.organization_id)?.name,
      services: services.data.filter((service) => service.expert_id === expert.id
        && service.organization_id === context.organization_id).map((service) => ({
        service_id: service.id,
        modules: service.modules,
        name: service.name,
        format: service.format,
        duration_min: service.duration_min,
        price_kop: service.price_kop,
        price_credits: service.price_credits,
        place_name: service.practice_places?.name,
      })),
    }];
  }).sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

export async function getAttachedPracticeService(supabase, owner, serviceId) {
  if (!owner || !serviceId || !['support', 'body'].includes(owner.module)) return { service: null };
  const { data: service, error } = await supabase.from("practice_services")
    .select("*").eq("id", serviceId).eq("is_active", true)
    .contains("modules", [owner.module]).maybeSingle();
  if (error) return { error };
  if (!service) return { service: null };

  const specialists = await listPracticePatientSpecialists(supabase, [owner], owner.module);
  const attached = specialists.some((specialist) =>
    specialist.expert_id === service.expert_id
      && (specialist.organization_id || null) === (service.organization_id || null)
      && specialist.services.some(({ service_id: id }) => id === service.id));
  return { service: attached ? service : null };
}
