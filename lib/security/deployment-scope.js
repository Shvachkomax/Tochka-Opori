// Server-only organization scope for dedicated pilots sharing the main database.
// This supplements patient tokens and specialist permissions; it is not a replacement for them.
const TABLE_COLUMNS = new Map([
  ['sessions', 'organization_id'],
  ['patient_assignments', 'organization_id'],
  ['patient_access', 'organization_id'],
  ['expert_organization_memberships', 'organization_id'],
  ['patient_specialist_invitations', 'organization_id'],
  ['specialist_match_requests', 'organization_id'],
  ['doctor_invite_links', 'organization_id'],
  ['case_reviews', 'organization_id'],
  ['specialist_onboarding_requests', 'organization_id'],
  // service_requests uses the existing text tenant_id column. The org UUID is
  // serialized as text at this boundary.
  ['service_requests', 'tenant_id'],
  ['expert_requests', 'tenant_id'],
  // Added by the Pneumo tenant-scope migration; legacy rows remain unscoped
  // and are intentionally invisible to a dedicated partner deployment.
  ['crisis_requests', 'tenant_id'],
]);

const ORGANIZATION_SCOPED_BRANDS = new Set(['kgmu', 'pneumointegration']);
export function deploymentOrganizationId() {
  const id = process.env.DEPLOYMENT_ORGANIZATION_ID;
  if (ORGANIZATION_SCOPED_BRANDS.has(process.env.VITE_APP_BRAND) && !id) {
    throw new Error('Deployment organization is required');
  }
  if (id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('Invalid deployment organization');
  return id || null;
}
export function scopeDatabase(client, organizationId) {
  if (!organizationId) return client;
  return new Proxy(client, { get(target, prop) {
    if (prop === 'from') return (table) => {
      const builder = target.from(table);
      const column = table === 'organizations' ? 'id' : TABLE_COLUMNS.get(table) || null;
      if (!column) return builder;
      return new Proxy(builder, { get(query, operation) {
        if (['select', 'update', 'delete'].includes(operation)) return (...args) => {
          if (operation === 'update' && args[0]?.[column] !== undefined && args[0][column] !== organizationId) throw new Error('Organization change denied');
          return query[operation](...args).eq(column, organizationId);
        };
        // Upsert can overwrite a conflicting row outside the scope. Use an authorized update instead.
        if (operation === 'upsert') return () => { throw new Error('Scoped upsert is not allowed'); };
        if (operation === 'insert') return (values, ...rest) => {
          const bind = row => {
            if (row[column] != null && row[column] !== organizationId) throw new Error('Foreign organization denied');
            return { ...row, [column]: organizationId };
          };
          return query.insert(Array.isArray(values) ? values.map(bind) : bind(values), ...rest);
        };
        const value = query[operation];
        return typeof value === 'function' ? value.bind(query) : value;
      }});
    };
    if (prop === 'rpc') return async (name, args, ...rest) => {
      if (name === 'accept_specialist_invitation') {
        const { data, error } = await target.from('patient_specialist_invitations').select('id')
          .eq('token_hash', args.p_token_hash).eq('organization_id', organizationId).maybeSingle();
        if (error || !data) return { data: { ok: false, code: 'NOT_FOUND', error: 'Приглашение не найдено' }, error: null };
      }
      return target.rpc(name, args, ...rest);
    };
    const value = target[prop];
    return typeof value === 'function' ? value.bind(target) : value;
  }});
}
