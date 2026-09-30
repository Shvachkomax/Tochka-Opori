export async function loadSpecialistMemberships(supabase, expertId) {
  const { data: memberships, error: membershipError } = await supabase
    .from("expert_organization_memberships")
    .select("id, organization_id, role, status")
    .eq("expert_id", expertId)
    .eq("status", "active");

  if (membershipError) return { memberships: null, error: membershipError };

  const rows = memberships || [];
  const organizationIds = [...new Set(rows.map((membership) => membership.organization_id).filter(Boolean))];
  let organizations = [];

  if (organizationIds.length > 0) {
    const { data, error } = await supabase
      .from("organizations")
      .select("id, name, slug, type")
      .in("id", organizationIds);
    if (error) return { memberships: null, error };
    organizations = data || [];
  }

  const organizationsById = new Map(organizations.map((organization) => [organization.id, organization]));
  if (organizationIds.some((id) => !organizationsById.has(id))) {
    return { memberships: null, error: { code: "MEMBERSHIP_ORGANIZATION_MISSING" } };
  }

  return {
    memberships: rows.map((membership) => {
      const organization = organizationsById.get(membership.organization_id);
      return {
        membership_id: membership.id,
        organization_id: membership.organization_id,
        organization_name: organization?.name || null,
        organization_slug: organization?.slug || null,
        organization_type: organization?.type || null,
        role_in_organization: membership.role,
      };
    }),
    error: null,
  };
}
