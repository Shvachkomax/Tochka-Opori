import { accessTokenMatchesHash } from '../security/access-token.js';
import { getPilotId } from '../security/module-availability.js';

// New voice access never inherits the permissive legacy-access path and never
// creates an owner as a side effect. The supplied database already has org scope.
export async function resolveLiveOwner(db, sessionId, token, module = 'body') {
  if (!['body', 'support'].includes(module)) return null;
  const { data: session, error } = await db.from('sessions')
    .select('session_id, module, anonymous_owner_id, access_token_hash, legacy_access, json_data')
    .eq('session_id', sessionId).eq('module', module).maybeSingle();
  if (error || !session || session.module !== module || session.legacy_access !== false
    || !session.anonymous_owner_id || !accessTokenMatchesHash(token, session.access_token_hash)
    || (session.json_data?.pilot_id || null) !== getPilotId()) return null;
  if (module === 'support') return { ownerId: session.anonymous_owner_id, sessionId };
  const { data: client, error: clientError } = await db.from('body_clients')
    .select('anonymous_owner_id').eq('session_id', sessionId).maybeSingle();
  if (clientError || client?.anonymous_owner_id !== session.anonymous_owner_id) return null;
  return { ownerId: session.anonymous_owner_id, sessionId };
}
