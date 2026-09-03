/**
 * GET /api/alerts
 *
 * The early-warning dispatch queue: every station currently meeting or
 * forecast to meet heatwave criteria, with lead time and the human approval
 * flag required before a severe warning is released.
 */

const { classify, heatIndex, SEVERITY_LABEL, SEVERITY_RANK } = require('./_lib/heat');
const { fetchAll, scenarioFrom } = require('./_lib/provider');
const { ok, fail, preflight } = require('./_lib/respond');

module.exports = async function handler(req, res) {
  if (preflight(req, res)) return;

  try {
    const scenario = scenarioFrom(req.query);
    const all = await fetchAll(7, scenario);
    const today = new Date().toISOString().slice(0, 10);

    const alerts = [];

    for (const { station, series } of all) {
      const days = series.map(d => ({ ...d, ...classify(station, d.maxTemp) }));
      const events = days.filter(d => SEVERITY_RANK[d.severity] >= 2);
      if (!events.length) continue;

      const first = events[0];
      const worst = events.reduce((a, b) => (SEVERITY_RANK[b.severity] > SEVERITY_RANK[a.severity] ? b : a));
      const leadDays = days.findIndex(d => d.date === first.date);

      alerts.push({
        id: `alert_${station.id}_${first.date}`,
        station: station.name,
        stationId: station.id,
        state: station.state,
        region: station.region,
        severity: worst.severity,
        severityLabel: SEVERITY_LABEL[worst.severity],
        status: first.date === today ? 'in force' : 'issued',
        onsetDate: first.date,
        leadTimeDays: leadDays,
        spellDays: events.length,
        peakTemp: worst.maxTemp,
        departure: worst.departure,
        heatIndex: heatIndex(worst.maxTemp, worst.humidity),
        nightMin: worst.minTemp,
        criterion: worst.criterion,
        requiresApproval: worst.severity === 'severe',
        message: `${SEVERITY_LABEL[worst.severity]} in ${station.name} from ${first.date}. `
               + `Maximum near ${worst.maxTemp}C, feels like ${heatIndex(worst.maxTemp, worst.humidity)}C. `
               + `Avoid outdoor exposure between 12pm and 4pm.`
      });
    }

    alerts.sort((a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.leadTimeDays - b.leadTimeDays);

    return ok(res, {
      scenario,
      summary: {
        total: alerts.length,
        inForce: alerts.filter(a => a.status === 'in force').length,
        severe: alerts.filter(a => a.severity === 'severe').length,
        awaitingApproval: alerts.filter(a => a.requiresApproval).length
      },
      alerts
    });
  } catch (err) {
    console.error('[alerts]', err);
    return fail(res, 500, 'Could not load the alert queue. Try again shortly.');
  }
};
