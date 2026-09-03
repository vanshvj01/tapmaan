/**
 * GET /api/hotspots
 *
 * Identifies heatwave hotspots across the network and aggregates conditions by
 * IMD region. A hotspot ranks on departure from local normal, persistence of
 * the spell, and failure of night-time temperature to fall, rather than on
 * absolute temperature alone.
 */

const { REGIONS, classify, heatIndex, hotspotScore, SEVERITY_LABEL, SEVERITY_RANK } = require('./_lib/heat');
const { fetchAll, scenarioFrom } = require('./_lib/provider');
const { ok, fail, preflight } = require('./_lib/respond');

module.exports = async function handler(req, res) {
  if (preflight(req, res)) return;

  try {
    const scenario = scenarioFrom(req.query);
    const all = await fetchAll(7, scenario);

    const scored = all.map(({ station, series }) => {
      const today = series[0];
      const cls = classify(station, today.maxTemp);

      // Count the run of forecast days meeting heatwave criteria
      let consecutiveDays = 0;
      for (const d of series) {
        if (SEVERITY_RANK[classify(station, d.maxTemp).severity] >= 2) consecutiveDays++;
        else break;
      }

      const hi = heatIndex(today.maxTemp, today.humidity);
      const score = hotspotScore({
        departure: cls.departure,
        consecutiveDays,
        nightMin: today.minTemp,
        heatIdx: hi
      });

      return {
        id: station.id,
        name: station.name,
        state: station.state,
        region: station.region,
        lat: station.lat,
        lon: station.lon,
        maxTemp: today.maxTemp,
        nightMin: today.minTemp,
        heatIndex: hi,
        departure: cls.departure,
        consecutiveDays,
        severity: cls.severity,
        severityLabel: SEVERITY_LABEL[cls.severity],
        hotspotScore: score,
        drivers: [
          cls.departure >= 4.5 ? 'Departure above heatwave threshold' : null,
          consecutiveDays >= 2 ? `Spell persisting ${consecutiveDays} days` : null,
          today.minTemp > 26 ? `Night minimum of ${today.minTemp}C prevents overnight recovery` : null,
          hi - today.maxTemp >= 3 ? 'Humidity raising apparent temperature sharply' : null
        ].filter(Boolean)
      };
    });

    scored.sort((a, b) => b.hotspotScore - a.hotspotScore);

    const byRegion = REGIONS.map(region => {
      const members = scored.filter(s => s.region === region);
      if (!members.length) return null;
      const worst = members[0];
      return {
        region,
        stations: members.length,
        underWarning: members.filter(m => SEVERITY_RANK[m.severity] >= 2).length,
        meanMaxTemp: Math.round((members.reduce((t, m) => t + m.maxTemp, 0) / members.length) * 10) / 10,
        meanDeparture: Math.round((members.reduce((t, m) => t + m.departure, 0) / members.length) * 10) / 10,
        peakHotspotScore: worst.hotspotScore,
        worstStation: worst.name,
        severity: members.reduce((a, m) => (SEVERITY_RANK[m.severity] > SEVERITY_RANK[a] ? m.severity : a), 'normal')
      };
    }).filter(Boolean).sort((a, b) => b.peakHotspotScore - a.peakHotspotScore);

    return ok(res, {
      scenario,
      hotspots: scored.filter(s => s.hotspotScore > 0).slice(0, 12),
      allStations: scored,
      byRegion
    });
  } catch (err) {
    console.error('[hotspots]', err);
    return fail(res, 500, 'Could not compute hotspots. Try again shortly.');
  }
};
