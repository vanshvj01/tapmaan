/**
 * POST /api/subscribe  { station, channel, language, contact }
 * GET  /api/subscribe                     -> aggregate counts only
 *
 * Registers a subscriber for early warnings.
 *
 * Storage note: this uses an in-process store, which resets when the
 * serverless function goes cold. That is deliberate for a demonstration
 * deployment, since it keeps contact details out of any persistent system.
 * For production, replace `store` with a call to Vercel KV, Postgres or
 * MongoDB. The rest of the handler does not change.
 */

const { STATIONS } = require('./_lib/heat');
const { ok, fail, preflight } = require('./_lib/respond');

const store = [];
const CHANNELS = ['sms', 'whatsapp', 'email'];
const LANGUAGES = ['english', 'hindi', 'marathi'];

function validContact(channel, contact) {
  const v = String(contact || '').trim();
  if (channel === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  return /^(\+91[- ]?)?[6-9]\d{9}$/.test(v.replace(/[\s-]/g, ''));
}

/** Store only a masked form of the contact — the full value is never retained. */
function mask(contact) {
  const v = String(contact).trim();
  if (v.includes('@')) {
    const [user, domain] = v.split('@');
    return user.slice(0, 2) + '***@' + domain;
  }
  return v.slice(0, 2) + '******' + v.slice(-2);
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

module.exports = async function handler(req, res) {
  if (preflight(req, res)) return;

  if (req.method === 'GET') {
    const byStation = store.reduce((acc, s) => {
      acc[s.station] = (acc[s.station] || 0) + 1;
      return acc;
    }, {});
    return ok(res, { total: store.length, byStation });
  }

  if (req.method !== 'POST') return fail(res, 405, 'Use POST to subscribe.');

  const { station, channel, language, contact } = parseBody(req);

  const found = STATIONS.find(s => s.id === station);
  if (!found) return fail(res, 400, 'Choose a district from the list.');
  if (!CHANNELS.includes(channel)) return fail(res, 400, 'Choose SMS, WhatsApp or email.');
  if (!LANGUAGES.includes(language)) return fail(res, 400, 'Choose a language.');
  if (!validContact(channel, contact)) {
    return fail(res, 400, channel === 'email'
      ? 'Enter a valid email address.'
      : 'Enter a valid 10-digit Indian mobile number.');
  }

  const record = {
    id: 'sub_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    station: found.id,
    stationName: found.name,
    channel,
    language,
    contact: mask(contact),
    createdAt: new Date().toISOString()
  };
  store.push(record);

  return ok(res, {
    subscription: record,
    message: `${found.name} alerts will reach you by ${channel} in ${language}. `
           + 'You will only be contacted when a warning is in force.'
  });
};
