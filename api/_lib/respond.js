/** Shared response helpers: CORS, caching, error shape. */
function send(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.status(status).send(JSON.stringify(body));
}

function ok(res, body)          { send(res, 200, { ok: true, generatedAt: new Date().toISOString(), ...body }); }
function fail(res, status, msg) { send(res, status, { ok: false, error: msg }); }

/** Handle preflight; returns true if the request is finished. */
function preflight(req, res) {
  if (req.method === 'OPTIONS') { send(res, 204, {}); return true; }
  return false;
}

module.exports = { ok, fail, preflight, send };
