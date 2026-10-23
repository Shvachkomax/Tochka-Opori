import crypto from 'node:crypto';

// Only server-produced Health answers can be spoken. A client cannot substitute
// arbitrary text, or use another session's ticket. Tickets contain no plaintext.
export function createSpeechTicket(sessionId, text, now = Date.now()) {
  const secret = process.env.CLIENT_API_SIGNING_SECRET;
  if (!secret || process.env.HEALTH_VOICE_ENABLED !== 'true' || !text || text.length > 6000) return null;
  const payload = Buffer.from(JSON.stringify({ sessionId, hash: crypto.createHash('sha256').update(text).digest('hex'), expires: now + 10 * 60_000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update('health-speech:' + payload).digest('hex');
  return `${payload}.${signature}`;
}

export function verifySpeechTicket(ticket, sessionId, text, now = Date.now()) {
  try {
    if (typeof ticket !== 'string' || ticket.length > 2000 || typeof text !== 'string') return false;
    const [payload, signature, extra] = ticket.split('.');
    if (extra || !/^[a-f0-9]{64}$/.test(signature || '')) return false;
    const expected = crypto.createHmac('sha256', process.env.CLIENT_API_SIGNING_SECRET).update('health-speech:' + payload).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.sessionId === sessionId && data.expires > now && data.hash === crypto.createHash('sha256').update(text).digest('hex');
  } catch { return false; }
}

export { speechText } from "./speech-text.js";
