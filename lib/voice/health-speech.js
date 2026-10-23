import { applyCors, handleOptions } from '../security/cors.js';
import { rateLimit } from '../security/rate-limit.js';
import { requireClientToken } from '../security/client-token.js';
import { rejectUnavailableModule } from '../security/module-availability.js';
import { validateSessionAccess } from '../security/access-token.js';
import { verifySpeechTicket } from './speech-ticket.js';
import { maskText } from '../sanitize.js';

const TEST_PHRASE = 'Здравствуйте! Это голос ИИ-помощника Health. Если вы слышите меня, нажмите «Да, слышу».';

export function createHandler({ validateAccess = validateSessionAccess, upstreamFetch = fetch } = {}) {
  return async function handler(req, res) {
    if (handleOptions(req, res)) return;
    if (!applyCors(req, res)) return res.status(403).json({ error: 'Источник не разрешён.' });
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (process.env.HEALTH_VOICE_ENABLED !== 'true') return res.status(503).json({ error: 'Голосовой режим пока не включён. Используйте текстовый чат.' });
    if (rejectUnavailableModule(res, 'body')) return;
    try {
      const token = requireClientToken(['analyze'])(req, res);
      if (!token) return;
      if (token.module !== 'body') return res.status(403).json({ error: 'Нужен доступ Health.' });
      const { session_id, access_token, action, text, ticket } = req.body || {};
      if (typeof session_id !== 'string' || typeof access_token !== 'string' || session_id.length > 128 || access_token.length > 256 || !await validateAccess(session_id, access_token)) {
        return res.status(403).json({ error: 'Войдите в Health заново по коду продолжения.' });
      }
      if (!['test', 'speak'].includes(action)) return res.status(400).json({ error: 'Неизвестное действие.' });
      if (action === 'speak' && (typeof text !== 'string' || !text.trim() || text.length > 6000 || !verifySpeechTicket(ticket, session_id, text))) {
        return res.status(400).json({ error: 'Ответ недоступен для озвучивания. Продолжите разговор текстом.' });
      }
      // Canonical URL prevents query-string variation from bypassing this limiter.
      if (await rateLimit({ windowMs: 10 * 60_000, max: 40, prefix: 'health-speech:' })({ headers: req.headers, socket: req.socket, url: '/api/health-speech' }, res)) return;
      if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'Озвучивание не настроено. Ответ доступен текстом.' });
      const response = await upstreamFetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: process.env.HEALTH_TTS_MODEL || 'gpt-4o-mini-tts', voice: 'coral', input: maskText(action === 'test' ? TEST_PHRASE : text), response_format: 'mp3' }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!response.ok) return res.status(502).json({ error: 'Не удалось озвучить ответ. Он остался в чате.' });
      const audio = Buffer.from(await response.arrayBuffer());
      if (!audio.length || audio.length > 10 * 1024 * 1024) throw new Error('Invalid audio size');
      res.setHeader('Content-Type', 'audio/mpeg');
      return res.status(200).send(audio);
    } catch {
      return res.status(503).json({ error: 'Голосовой сервис временно недоступен. Продолжите текстом.' });
    }
  };
}
export default createHandler();
