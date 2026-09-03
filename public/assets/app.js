/* Tapmaan — frontend controllers. No framework, no build step. */

const SEV_COLOR = {
  normal:   'var(--normal)',
  watch:    'var(--watch)',
  heatwave: 'var(--heatwave)',
  severe:   'var(--severe)'
};

/* --------------------------------------------------------- scenario mode
   Outside the pre-monsoon season there are legitimately no heatwaves, which
   leaves every screen empty. Scenario mode substitutes a labelled peak-summer
   dataset so the warning pipeline can be demonstrated year round. It is never
   silent: a banner states it whenever it is on. */

const scenario = {
  get on() {
    const p = new URLSearchParams(location.search);
    if (p.has('demo') || p.has('scenario')) return p.get('demo') !== '0';
    return sessionStorage.getItem('tapmaan-scenario') === '1';
  },
  set(v) {
    sessionStorage.setItem('tapmaan-scenario', v ? '1' : '0');
    const u = new URL(location.href);
    u.searchParams.delete('demo');
    u.searchParams.delete('scenario');
    location.href = u.toString();
  },
  param(path) {
    if (!this.on) return path;
    return path + (path.includes('?') ? '&' : '?') + 'demo=1';
  }
};

function mountScenarioBar() {
  const host = document.querySelector('.masthead');
  if (!host || document.getElementById('scenario-bar')) return;

  const bar = document.createElement('div');
  bar.id = 'scenario-bar';
  bar.className = 'scenario-bar' + (scenario.on ? ' is-on' : '');
  bar.innerHTML = scenario.on
    ? '<span>Scenario mode: showing a modelled peak-summer heat event, not live conditions.</span>'
      + '<button class="linkish" id="scenario-off">Switch to live data</button>'
    : '<span>Live data. Outside the heatwave season there may be no active warnings.</span>'
      + '<button class="linkish" id="scenario-on">View a peak-summer scenario</button>';

  host.after(bar);
  const on = document.getElementById('scenario-on');
  const off = document.getElementById('scenario-off');
  if (on) on.onclick = () => scenario.set(true);
  if (off) off.onclick = () => scenario.set(false);
}

const api = {
  async get(path) {
    const res = await fetch(scenario.param(path));
    const json = await res.json().catch(() => ({ ok: false, error: 'Bad response from the server.' }));
    if (!res.ok || !json.ok) throw new Error(json.error || 'Request failed.');
    return json;
  },
  async post(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const json = await res.json().catch(() => ({ ok: false, error: 'Bad response from the server.' }));
    if (!res.ok || !json.ok) throw new Error(json.error || 'Request failed.');
    return json;
  }
};

function el(id) { return document.getElementById(id); }

function setState(id, message, isError) {
  const node = el(id);
  if (!node) return;
  node.hidden = !message;
  node.textContent = message || '';
  node.className = 'state' + (isError ? ' error' : '');
}

function sevTag(severity, label) {
  return `<span class="sev sev-${severity}">${label}</span>`;
}

function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

/* ------------------------------------------------------------------ map */

const BOUNDS = { minLat: 6, maxLat: 37.5, minLon: 67.5, maxLon: 97.5 };

function plotMap(container, stations, onPick) {
  container.innerHTML = '';
  stations.forEach(s => {
    const x = ((s.lon - BOUNDS.minLon) / (BOUNDS.maxLon - BOUNDS.minLon)) * 100;
    const y = 100 - ((s.lat - BOUNDS.minLat) / (BOUNDS.maxLat - BOUNDS.minLat)) * 100;
    const dot = document.createElement('button');
    dot.className = 'map-dot';
    dot.style.left = x + '%';
    dot.style.top = y + '%';
    dot.style.background = SEV_COLOR[s.severity] || 'var(--normal)';
    dot.title = `${s.name}, ${s.state} — ${s.maxTemp}C, ${s.severityLabel}`;
    dot.setAttribute('aria-label', dot.title);
    if (onPick) dot.onclick = () => onPick(s);
    container.appendChild(dot);
  });
}

/* ------------------------------------------------- page: dashboard */

async function initDashboard() {
  setState('dash-state', 'Loading the station network.');
  try {
    const data = await api.get('/api/observations');
    setState('dash-state', '');

    const s = data.summary;
    el('dash-stats').innerHTML = `
      <div class="stat" style="border-left-color:var(--severe)">
        <div class="stat-value">${s.underWarning}</div>
        <div class="stat-label">Stations meeting heatwave criteria</div></div>
      <div class="stat" style="border-left-color:var(--heatwave)">
        <div class="stat-value">${data.observations[0].maxTemp}&deg;C</div>
        <div class="stat-label">Highest maximum, ${data.observations[0].name}</div></div>
      <div class="stat" style="border-left-color:var(--watch)">
        <div class="stat-value">${s.stations}</div>
        <div class="stat-label">Stations monitored</div></div>
      <div class="stat" style="border-left-color:var(--relief)">
        <div class="stat-value">${data.season}</div>
        <div class="stat-label">Current season</div></div>`;

    plotMap(el('dash-map'), data.observations, s => {
      window.location.href = scenario.param('/forecast.html?station=' + s.id);
    });

    const filter = el('dash-region');
    if (filter && filter.options.length <= 1) {
      data.regions.forEach(r => filter.add(new Option(r, r)));
      filter.onchange = () => renderRows(data.observations, filter.value);
    }
    renderRows(data.observations, '');

    el('dash-source').textContent = data.observations[0].dataSource === 'open-meteo'
      ? 'Live observations via Open-Meteo. Classification applied using IMD criteria.'
      : 'Upstream feed unavailable — showing modelled values. Classification logic is unchanged.';
  } catch (err) {
    setState('dash-state', err.message, true);
  }
}

function renderRows(rows, region) {
  const list = region ? rows.filter(r => r.region === region) : rows;
  el('dash-rows').innerHTML = list.map(r => `
    <tr>
      <td><a href="${scenario.param('/forecast.html?station=' + r.id)}">${r.name}</a><div class="muted">${r.state}</div></td>
      <td>${r.region}</td>
      <td class="num">${r.maxTemp}&deg;</td>
      <td class="num">${r.normalMax}&deg;</td>
      <td class="num">${r.departure > 0 ? '+' : ''}${r.departure}</td>
      <td class="num">${r.heatIndex}&deg;</td>
      <td class="num">${r.minTemp}&deg;</td>
      <td>${sevTag(r.severity, r.severityLabel)}</td>
    </tr>`).join('');
}

/* -------------------------------------------------- page: forecast */

async function initForecast() {
  const select = el('fc-station');
  const params = new URLSearchParams(location.search);
  const preset = params.get('station');

  try {
    const obs = await api.get('/api/observations');
    obs.observations
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(o => select.add(new Option(`${o.name}, ${o.state}`, o.id)));
    select.value = preset && obs.observations.some(o => o.id === preset) ? preset : 'nagpur';
  } catch (err) {
    setState('fc-state', err.message, true);
    return;
  }

  select.onchange = () => loadForecast(select.value);
  loadForecast(select.value);
}

async function loadForecast(stationId) {
  setState('fc-state', 'Running the forecast.');
  el('fc-days').innerHTML = '';
  el('fc-panel').hidden = true;

  try {
    const data = await api.get('/api/forecast?station=' + encodeURIComponent(stationId));
    setState('fc-state', '');
    el('fc-panel').hidden = false;

    const o = data.outlook;
    el('fc-headline').textContent = o.headline;
    el('fc-stats').innerHTML = `
      <div class="stat"><div class="stat-value">${o.peakTemp}&deg;C</div>
        <div class="stat-label">Peak maximum, ${fmtDate(o.peakDate)}</div></div>
      <div class="stat"><div class="stat-value">${o.eventDays}</div>
        <div class="stat-label">Days meeting heatwave criteria</div></div>
      <div class="stat"><div class="stat-value">${o.longestSpell}</div>
        <div class="stat-label">Longest continuous spell</div></div>
      <div class="stat"><div class="stat-value">${o.leadTimeDays === null ? '—' : o.leadTimeDays + 'd'}</div>
        <div class="stat-label">Lead time to onset</div></div>`;

    const temps = data.forecast.map(d => d.maxTemp);
    const lo = Math.floor(Math.min(...temps) - 2);
    const hi = Math.ceil(Math.max(...temps) + 1);

    el('fc-days').innerHTML = data.forecast.map(d => {
      const pct = Math.max(4, ((d.maxTemp - lo) / (hi - lo)) * 100);
      return `<div class="day">
        <span class="day-date">${fmtDate(d.date)}</span>
        <span class="day-track"><span class="day-fill" style="width:${pct}%;background:${SEV_COLOR[d.severity]}"></span></span>
        <span class="day-temp">${d.maxTemp}&deg;</span>
        <span class="day-prob">${d.probability}% · ${d.confidence}</span>
      </div>`;
    }).join('');

    el('fc-criteria').innerHTML = data.forecast.map(d => `
      <tr><td>${fmtDate(d.date)}</td><td class="num">${d.maxTemp}&deg;</td>
      <td class="num">${d.departure > 0 ? '+' : ''}${d.departure}</td>
      <td class="num">${d.heatIndex}&deg;</td>
      <td class="num">${d.probability}%</td>
      <td>${sevTag(d.severity, d.severityLabel)}</td>
      <td class="muted" style="white-space:normal">${d.criterion}</td></tr>`).join('');

    el('fc-advisory-link').href = scenario.param('/advisory.html?station=' + stationId);
  } catch (err) {
    setState('fc-state', err.message, true);
  }
}

/* -------------------------------------------------- page: hotspots */

async function initHotspots() {
  setState('hs-state', 'Scoring hotspots across the network.');
  try {
    const data = await api.get('/api/hotspots');
    setState('hs-state', '');

    plotMap(el('hs-map'), data.allStations);

    el('hs-cards').innerHTML = data.hotspots.slice(0, 6).map(h => `
      <div class="card flag-${h.severity}">
        <h3>${h.name}, ${h.state}</h3>
        <div class="muted">${h.region} · score ${h.hotspotScore} of 100</div>
        <p class="muted" style="margin:.5rem 0 0">${h.maxTemp}&deg;C max · ${h.nightMin}&deg;C night · ${h.departure > 0 ? '+' : ''}${h.departure} departure</p>
        ${h.drivers.length ? '<ul>' + h.drivers.map(d => `<li>${d}</li>`).join('') + '</ul>'
                           : '<p class="muted">No elevated risk drivers.</p>'}
      </div>`).join('') || '<p class="muted">No hotspots above threshold anywhere in the network today.</p>';

    el('hs-regions').innerHTML = data.byRegion.map(r => `
      <tr><td>${r.region}</td>
      <td class="num">${r.stations}</td>
      <td class="num">${r.underWarning}</td>
      <td class="num">${r.meanMaxTemp}&deg;</td>
      <td class="num">${r.meanDeparture > 0 ? '+' : ''}${r.meanDeparture}</td>
      <td>${r.worstStation}</td>
      <td>${sevTag(r.severity, r.severity === 'normal' ? 'Normal' : r.severity === 'watch' ? 'Heat watch' : r.severity === 'heatwave' ? 'Heatwave' : 'Severe heatwave')}</td></tr>`).join('');
  } catch (err) {
    setState('hs-state', err.message, true);
  }
}

/* -------------------------------------------------- page: advisory */

async function initAdvisory() {
  const select = el('ad-station');
  const params = new URLSearchParams(location.search);

  try {
    const obs = await api.get('/api/observations');
    obs.observations.slice().sort((a, b) => a.name.localeCompare(b.name))
      .forEach(o => select.add(new Option(`${o.name}, ${o.state}`, o.id)));
    select.value = params.get('station') || 'nagpur';
  } catch (err) {
    setState('ad-state', err.message, true);
    return;
  }

  el('ad-generate').onclick = generateAdvisory;
  generateAdvisory();
}

async function generateAdvisory() {
  const btn = el('ad-generate');
  btn.disabled = true;
  setState('ad-state', 'Generating the advisory.');
  el('ad-out').hidden = true;

  try {
    const q = new URLSearchParams({
      station: el('ad-station').value,
      audience: el('ad-audience').value,
      language: el('ad-language').value
    });
    const data = await api.get('/api/advisory?' + q);
    setState('ad-state', '');

    const a = data.advisory;
    el('ad-out').hidden = false;
    el('ad-out').style.borderTopColor = SEV_COLOR[data.severity];
    el('ad-headline').textContent = a.headline;
    el('ad-meta').innerHTML = `
      <span>${data.station.name}, ${data.station.state}</span>
      <span>${data.audience}</span>
      <span>${data.language}</span>
      <span>Valid ${fmtDate(data.validFrom)} to ${fmtDate(data.validTo)}</span>
      <span>${a.generator === 'llm' ? 'LLM-assisted draft' : 'Rule-based draft'}</span>`;
    el('ad-body').textContent = a.body;
    el('ad-actions').innerHTML = a.actions.map(x => `<li>${x}</li>`).join('');

    el('ad-approval').hidden = !data.requiresHumanApproval;
  } catch (err) {
    setState('ad-state', err.message, true);
  } finally {
    btn.disabled = false;
  }
}

/* ---------------------------------------------------- page: alerts */

async function initAlerts() {
  setState('al-state', 'Loading the dispatch queue.');
  try {
    const data = await api.get('/api/alerts');
    setState('al-state', '');

    const s = data.summary;
    el('al-stats').innerHTML = `
      <div class="stat" style="border-left-color:var(--severe)"><div class="stat-value">${s.total}</div>
        <div class="stat-label">Active warnings</div></div>
      <div class="stat" style="border-left-color:var(--heatwave)"><div class="stat-value">${s.inForce}</div>
        <div class="stat-label">In force today</div></div>
      <div class="stat" style="border-left-color:var(--extreme)"><div class="stat-value">${s.severe}</div>
        <div class="stat-label">Severe heatwave</div></div>
      <div class="stat" style="border-left-color:var(--relief)"><div class="stat-value">${s.awaitingApproval}</div>
        <div class="stat-label">Awaiting expert approval</div></div>`;

    el('al-list').innerHTML = data.alerts.length ? data.alerts.map(a => `
      <div class="card flag-${a.severity}">
        <h3>${a.station}, ${a.state} ${sevTag(a.severity, a.severityLabel)}</h3>
        <div class="muted">${a.status} · onset ${fmtDate(a.onsetDate)} · ${a.leadTimeDays} day lead · ${a.spellDays} day spell</div>
        <p style="margin:.6rem 0 .3rem">${a.message}</p>
        <p class="muted" style="margin:0">Criterion: ${a.criterion}</p>
        ${a.requiresApproval ? '<p class="muted" style="margin:.4rem 0 0">Held for meteorologist approval before dissemination.</p>' : ''}
      </div>`).join('')
      : '<p class="muted">No warnings in force anywhere in the network. The queue is empty.</p>';
  } catch (err) {
    setState('al-state', err.message, true);
  }

  // subscription form
  try {
    const obs = await api.get('/api/observations');
    const sel = el('sub-station');
    obs.observations.slice().sort((a, b) => a.name.localeCompare(b.name))
      .forEach(o => sel.add(new Option(`${o.name}, ${o.state}`, o.id)));
    sel.value = 'nagpur';
  } catch (_) { /* the queue still renders without the picker */ }

  el('sub-submit').onclick = submitSubscription;
}

async function submitSubscription() {
  const btn = el('sub-submit');
  const out = el('sub-result');
  btn.disabled = true;
  out.hidden = true;

  try {
    const data = await api.post('/api/subscribe', {
      station: el('sub-station').value,
      channel: el('sub-channel').value,
      language: el('sub-language').value,
      contact: el('sub-contact').value
    });
    out.hidden = false;
    out.className = 'notice';
    out.textContent = data.message;
    el('sub-contact').value = '';
  } catch (err) {
    out.hidden = false;
    out.className = 'notice warn';
    out.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
}

/* ------------------------------------------------------------ boot */

document.addEventListener('DOMContentLoaded', function () {
  mountScenarioBar();
  const page = document.body.dataset.page;
  ({
    dashboard: initDashboard,
    forecast:  initForecast,
    hotspots:  initHotspots,
    advisory:  initAdvisory,
    alerts:    initAlerts
  }[page] || function () {})();
});
