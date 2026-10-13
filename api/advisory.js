/**
 * GET  /api/advisory?station=nagpur&audience=citizens[&language=marathi]
 * POST /api/advisory   { station, audience, language }
 *
 * Translates a technical forecast into a stakeholder-specific advisory, as
 * described in Phase V of the use case.
 *
 * If ANTHROPIC_API_KEY is set as an environment variable the text is generated
 * by an LLM under a strict factual-grounding prompt: it may only restate the
 * numbers it is given. Without the key, a deterministic template is used, so
 * the platform never depends on an external model being reachable.
 */

const { STATIONS, classify, heatIndex, SEVERITY_LABEL, SEVERITY_RANK } = require('./_lib/heat');
const { fetchStation, scenarioFrom } = require('./_lib/provider');
const { ok, fail, preflight } = require('./_lib/respond');

const AUDIENCES = {
  citizens: {
    label: 'Citizens',
    focus: 'personal safety, hydration, avoiding exposure during peak hours, recognising heat stroke'
  },
  workers: {
    label: 'Outdoor workers',
    focus: 'work-rest cycles, shifting shifts away from peak heat, shade and water provision at the worksite'
  },
  farmers: {
    label: 'Farmers',
    focus: 'irrigation timing, protecting livestock, crop stress, avoiding fieldwork at midday'
  },
  health: {
    label: 'Health agencies',
    focus: 'expected heat-illness case load, ORS and IV fluid stocking, ward readiness, vulnerable patient outreach'
  },
  authorities: {
    label: 'Local authorities',
    focus: 'cooling centre activation, water tanker deployment, adjusting public works timings, Heat Action Plan triggers'
  }
};

const LANGUAGES = { english: 'English', hindi: 'Hindi', marathi: 'Marathi' };

// ---------------------------------------------------------------------------
// Deterministic template — always available
// ---------------------------------------------------------------------------

const TEMPLATE_ACTIONS = {
  citizens: [
    'Drink water every twenty minutes, before you feel thirsty.',
    'Stay indoors or in shade between 12pm and 4pm.',
    'Wear loose light-coloured cotton and cover your head outdoors.',
    'Check on elderly neighbours, infants and anyone living alone.',
    'Confusion, hot dry skin or fainting is a medical emergency. Call 108.'
  ],
  workers: [
    'Shift work to before 11am or after 5pm wherever the task allows.',
    'Take a ten-minute shaded rest every hour, and longer as the day peaks.',
    'Keep drinking water and ORS within reach of the work area, not at a distance.',
    'Pair workers so that early signs of heat illness are noticed by someone.',
    'Stop work immediately if a worker becomes confused or stops sweating.'
  ],
  farmers: [
    'Irrigate in the early morning or after sunset to reduce evaporation loss.',
    'Move livestock to shade and increase the frequency of watering.',
    'Avoid fieldwork between 12pm and 4pm.',
    'Apply mulch to reduce soil temperature and conserve moisture.',
    'Watch standing crops for wilting and heat scorch on exposed foliage.'
  ],
  health: [
    'Expect a rise in heat exhaustion and heat stroke presentations, peaking in the late afternoon.',
    'Verify ORS, IV fluid and cold-pack stocks before the onset date.',
    'Prepare a designated cooling area in the emergency department.',
    'Contact dialysis, cardiac and elderly patients on the outreach list in advance.',
    'Brief staff on rapid cooling protocol for suspected heat stroke.'
  ],
  authorities: [
    'Activate cooling centres and publish their locations ward by ward.',
    'Deploy water tankers and confirm public drinking water points are working.',
    'Reschedule outdoor public works away from peak heat hours.',
    'Issue the advisory through local channels in the languages people actually read.',
    'Confirm that the Heat Action Plan trigger level for this severity has been declared.'
  ]
};

function templateAdvisory(ctx) {
  const { station, severityLabel, peakTemp, peakHeatIndex, onsetDate, audience, nightMin } = ctx;

  const headline = ctx.isEvent
    ? `${severityLabel} warning for ${station.name}, ${station.state}.`
    : `No heatwave warning for ${station.name}, ${station.state}.`;

  const body = ctx.isEvent
    ? `Maximum temperature is forecast to reach ${peakTemp}C, which feels like ${peakHeatIndex}C `
      + `with humidity. Conditions begin ${onsetDate}. Night-time temperature is expected to stay `
      + `near ${nightMin}C, so the body gets limited recovery overnight.`
    : `Maximum temperature is forecast to reach ${peakTemp}C, within the normal range for this `
      + `station and season. No action beyond routine precautions is required.`;

  const actions = ctx.isEvent ? TEMPLATE_ACTIONS[audience] : [
    'Maintain normal hydration during outdoor activity.',
    'Continue to monitor the forecast, which is updated through the day.'
  ];

  return { headline, body, actions, generator: 'template' };
}

// ---------------------------------------------------------------------------
// LLM-assisted generation
// ---------------------------------------------------------------------------

async function llmAdvisory(ctx) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  const aud = AUDIENCES[ctx.audience];
  const prompt =
`You are drafting an official heat advisory for a meteorological early-warning service in India.

Verified forecast data — you may use ONLY these numbers and must not invent any others:
- Station: ${ctx.station.name}, ${ctx.station.state} (${ctx.station.region})
- Classification: ${ctx.severityLabel}
- Forecast maximum: ${ctx.peakTemp} C (normal for this station: ${ctx.station.normalMax} C)
- Apparent temperature with humidity: ${ctx.peakHeatIndex} C
- Night-time minimum: ${ctx.nightMin} C
- Onset: ${ctx.onsetDate || 'not applicable'}
- Days meeting heatwave criteria in the next 7: ${ctx.eventDays}

Audience: ${aud.label}. Their concerns: ${aud.focus}.
Language: ${LANGUAGES[ctx.language] || 'English'}.

Return ONLY a JSON object, no markdown fences and no preamble:
{"headline": "one sentence under 15 words",
 "body": "two or three sentences of plain factual explanation",
 "actions": ["four to five short imperative actions"]}

Rules: plain language a non-specialist reads easily. No alarmism and no reassurance
beyond what the data supports. Do not state any temperature not listed above.`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    clearTimeout(timer);

    if (!res.ok) throw new Error('anthropic ' + res.status);
    const data = await res.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());

    if (!parsed.headline || !Array.isArray(parsed.actions)) throw new Error('unexpected shape');
    return { ...parsed, generator: 'llm' };
  } catch (err) {
    console.warn('[advisory] LLM generation unavailable:', err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------

module.exports = async function handler(req, res) {
  if (preflight(req, res)) return;

  try {
    const input = req.method === 'POST' ? (req.body || {}) : (req.query || {});
    const stationId = input.station || 'nagpur';
    const audience = AUDIENCES[input.audience] ? input.audience : 'citizens';
    const language = LANGUAGES[input.language] ? input.language : 'english';

    const station = STATIONS.find(s => s.id === stationId);
    if (!station) return fail(res, 404, `Unknown station: ${stationId}`);

    const series = await fetchStation(station, 7, scenarioFrom(input));

    const days = series.map(d => {
      const cls = classify(station, d.maxTemp);
      return { ...d, ...cls, heatIndex: heatIndex(d.maxTemp, d.humidity) };
    });

    const eventDays = days.filter(d => SEVERITY_RANK[d.severity] >= 2);
    const peak = days.reduce((a, b) => (a.maxTemp > b.maxTemp ? a : b));
    const worst = days.reduce((a, b) => (SEVERITY_RANK[b.severity] > SEVERITY_RANK[a.severity] ? b : a));

    const ctx = {
      station,
      audience,
      language,
      isEvent: eventDays.length > 0,
      severityLabel: SEVERITY_LABEL[worst.severity],
      severity: worst.severity,
      peakTemp: peak.maxTemp,
      peakHeatIndex: peak.heatIndex,
      nightMin: peak.minTemp,
      onsetDate: eventDays.length ? eventDays[0].date : null,
      eventDays: eventDays.length
    };

    const advisory = (await llmAdvisory(ctx)) || templateAdvisory(ctx);

    return ok(res, {
      station: { id: station.id, name: station.name, state: station.state, region: station.region },
      audience: AUDIENCES[audience].label,
      language: LANGUAGES[language],
      severity: ctx.severity,
      severityLabel: ctx.severityLabel,
      validFrom: days[0].date,
      validTo: days[days.length - 1].date,
      requiresHumanApproval: SEVERITY_RANK[ctx.severity] >= 3,
      advisory
    });
  } catch (err) {
    console.error('[advisory]', err);
    return fail(res, err.status || 500, err.status ? err.message : 'Could not generate the advisory. Try again shortly.');
  }
};
