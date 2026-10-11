/**
 * Tapmaan service runtime.
 *
 * Every microservice is started through createService(). It wraps the plain
 * Node http server with the small slice of the Vercel/Express request and
 * response API that the existing handlers in api/ use (req.query, req.body,
 * res.status().send()), so the same handler code runs on Vercel and inside a
 * container without modification.
 *
 * Each service also gets, for free:
 *   GET /health   liveness and readiness probe (Docker, Kubernetes)
 *   GET /metrics  Prometheus text exposition (request counts and latency)
 *
 * No dependencies: only Node's standard library.
 */

const http = require('http');

const BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

function createMetrics(service) {
  const requests = new Map();   // "route|method|status" -> count
  const latency = new Map();    // route -> { buckets[], sum, count }
  const started = Date.now();

  function observe(route, method, status, seconds) {
    const key = `${route}|${method}|${status}`;
    requests.set(key, (requests.get(key) || 0) + 1);

    let h = latency.get(route);
    if (!h) { h = { buckets: BUCKETS.map(() => 0), sum: 0, count: 0 }; latency.set(route, h); }
    BUCKETS.forEach((b, i) => { if (seconds <= b) h.buckets[i]++; });
    h.sum += seconds;
    h.count++;
  }

  function render() {
    const lines = [];
    const lbl = `service="${service}"`;

    lines.push('# HELP tapmaan_http_requests_total HTTP requests handled, by route and status.');
    lines.push('# TYPE tapmaan_http_requests_total counter');
    for (const [key, n] of requests) {
      const [route, method, status] = key.split('|');
      lines.push(`tapmaan_http_requests_total{${lbl},route="${route}",method="${method}",status="${status}"} ${n}`);
    }

    lines.push('# HELP tapmaan_http_request_duration_seconds Request latency.');
    lines.push('# TYPE tapmaan_http_request_duration_seconds histogram');
    for (const [route, h] of latency) {
      BUCKETS.forEach((b, i) =>
        lines.push(`tapmaan_http_request_duration_seconds_bucket{${lbl},route="${route}",le="${b}"} ${h.buckets[i]}`));
      lines.push(`tapmaan_http_request_duration_seconds_bucket{${lbl},route="${route}",le="+Inf"} ${h.count}`);
      lines.push(`tapmaan_http_request_duration_seconds_sum{${lbl},route="${route}"} ${h.sum.toFixed(4)}`);
      lines.push(`tapmaan_http_request_duration_seconds_count{${lbl},route="${route}"} ${h.count}`);
    }

    lines.push('# HELP tapmaan_uptime_seconds Seconds since the service started.');
    lines.push('# TYPE tapmaan_uptime_seconds gauge');
    lines.push(`tapmaan_uptime_seconds{${lbl}} ${Math.round((Date.now() - started) / 1000)}`);

    const mem = process.memoryUsage();
    lines.push('# HELP tapmaan_process_resident_memory_bytes Resident memory.');
    lines.push('# TYPE tapmaan_process_resident_memory_bytes gauge');
    lines.push(`tapmaan_process_resident_memory_bytes{${lbl}} ${mem.rss}`);

    return lines.join('\n') + '\n';
  }

  return { observe, render, started };
}

/** Decorate Node's response with the Express-style helpers the handlers use. */
function adapt(res) {
  res.status = code => { res.statusCode = code; return res; };
  res.send = body => { if (!res.writableEnded) res.end(body); return res; };
  res.json = obj => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.send(JSON.stringify(obj));
  };
  return res;
}

function readBody(req) {
  return new Promise(resolve => {
    if (req.method === 'GET' || req.method === 'HEAD') return resolve(undefined);
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 64 * 1024) req.destroy();   // nothing here needs more than this
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
    });
    req.on('error', () => resolve({}));
  });
}

/**
 * Start a service.
 *   name    used in logs, /health and metric labels
 *   port    listening port
 *   routes  { '/api/forecast': handler, ... }  exact path match
 */
function createService({ name, port, routes, version = process.env.APP_VERSION || 'dev' }) {
  const metrics = createMetrics(name);

  const server = http.createServer(async (req, rawRes) => {
    const res = adapt(rawRes);
    const t0 = process.hrtime.bigint();
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname.replace(/\/+$/, '') || '/';

    let route = path;
    res.on('finish', () => {
      if (path === '/metrics' || path === '/health') return;
      const secs = Number(process.hrtime.bigint() - t0) / 1e9;
      metrics.observe(route, req.method, res.statusCode, secs);
      console.log(JSON.stringify({
        t: new Date().toISOString(), service: name, method: req.method,
        path, status: res.statusCode, ms: Math.round(secs * 1000)
      }));
    });

    if (path === '/health') {
      return res.status(200).json({
        status: 'up', service: name, version,
        uptimeSeconds: Math.round((Date.now() - metrics.started) / 1000)
      });
    }

    if (path === '/metrics') {
      res.setHeader('Content-Type', 'text/plain; version=0.0.4');
      return res.status(200).send(metrics.render());
    }

    const handler = routes[path];
    if (!handler) {
      route = 'unmatched';
      return res.status(404).json({ ok: false, error: `${name} has no route ${path}` });
    }

    req.query = Object.fromEntries(url.searchParams);
    req.body = await readBody(req);

    try {
      await handler(req, res);
    } catch (err) {
      console.error(`[${name}]`, err);
      if (!res.headersSent) res.status(500).json({ ok: false, error: 'Internal error.' });
    }
  });

  server.listen(port, () =>
    console.log(`${name} ${version} listening on :${port} — routes: ${Object.keys(routes).join(', ')}`));

  // Containers are stopped with SIGTERM; finish in-flight requests first.
  const shutdown = signal => {
    console.log(`${name} received ${signal}, shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return server;
}

module.exports = { createService };
