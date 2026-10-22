// Cloudflare Worker: liefert den persönlichen RWTHonline-Kalender (iCal) mit
// CORS-Headern aus, damit das Dashboard ihn direkt im Browser laden kann.
//
// Konfiguration (im Cloudflare-Dashboard unter „Variables and Secrets“,
// NIE in diese Datei schreiben):
//   ICAL_URL         Secret – dein iCal-Abo-Link aus RWTHonline
//   ACCESS_KEY       Secret – selbst erzeugter Zufallsschlüssel (z. B. openssl rand -hex 24)
//   ALLOWED_ORIGINS  optional, Text – erlaubte Dashboard-Adressen, kommagetrennt,
//                    z. B. "https://benutzer.github.io,http://localhost:8000"
//
// Aufruf: https://<worker>.workers.dev/?key=<ACCESS_KEY>
//         (alternativ Header „Authorization: Bearer <ACCESS_KEY>“)

const CACHE_SECONDS = 600;

// Vergleich in konstanter Zeit, damit der Schlüssel nicht über Antwortzeiten erratbar ist.
function safeEqual(a, b) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  const headers = { Vary: 'Origin' };
  if (!allowed.length) headers['Access-Control-Allow-Origin'] = '*';
  else if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function reply(request, env, body, status, extra = {}) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(request, env),
      ...extra,
    },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return reply(request, env, null, 204, {
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization',
        'Access-Control-Max-Age': '86400',
      });
    }
    if (request.method !== 'GET') return reply(request, env, 'Nur GET erlaubt.', 405);
    if (!env.ICAL_URL || !env.ACCESS_KEY) return reply(request, env, 'Worker ist nicht konfiguriert (ICAL_URL/ACCESS_KEY fehlen).', 500);

    const url = new URL(request.url);
    const key = url.searchParams.get('key') ?? request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    if (!safeEqual(key, env.ACCESS_KEY)) return reply(request, env, 'Zugriff verweigert.', 401);

    const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
    const origin = request.headers.get('Origin');
    if (allowed.length && origin && !allowed.includes(origin)) return reply(request, env, 'Herkunft nicht erlaubt.', 403);

    let upstream;
    try {
      upstream = await fetch(env.ICAL_URL, { cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true } });
    } catch {
      return reply(request, env, 'RWTHonline ist nicht erreichbar.', 502);
    }
    // Den Link selbst nie in Fehlermeldungen oder Logs ausgeben.
    if (!upstream.ok) return reply(request, env, `RWTHonline antwortet mit Fehler ${upstream.status}.`, 502);
    const text = await upstream.text();
    if (!/BEGIN:VCALENDAR/i.test(text)) return reply(request, env, 'RWTHonline liefert keinen iCal-Kalender (Link abgelaufen?).', 502);

    return reply(request, env, text, 200, { 'Content-Type': 'text/calendar; charset=utf-8' });
  },
};
