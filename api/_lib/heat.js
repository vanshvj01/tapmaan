/**
 * Tapmaan — core heatwave intelligence logic.
 *
 * Implements the India Meteorological Department heatwave criteria and a
 * heat-index model, shared by every API route.
 *
 * Reference: IMD declares a heatwave on departure from normal maximum
 * temperature, with different base thresholds for plains, coastal and hilly
 * stations, plus an absolute-temperature override.
 */

// ---------------------------------------------------------------------------
// Station network — seven IMD homogeneous regions
// ---------------------------------------------------------------------------

const STATIONS = [
  // Northwest India
  { id: 'delhi',      name: 'Delhi',        region: 'Northwest India',   state: 'Delhi',          lat: 28.6139, lon: 77.2090, terrain: 'plains',  normalMax: 39.8 },
  { id: 'jaipur',     name: 'Jaipur',       region: 'Northwest India',   state: 'Rajasthan',      lat: 26.9124, lon: 75.7873, terrain: 'plains',  normalMax: 40.6 },
  { id: 'churu',      name: 'Churu',        region: 'Northwest India',   state: 'Rajasthan',      lat: 28.2969, lon: 74.9647, terrain: 'plains',  normalMax: 41.9 },
  { id: 'chandigarh', name: 'Chandigarh',   region: 'Northwest India',   state: 'Chandigarh',     lat: 30.7333, lon: 76.7794, terrain: 'plains',  normalMax: 38.4 },

  // Central India
  { id: 'nagpur',     name: 'Nagpur',       region: 'Central India',     state: 'Maharashtra',    lat: 21.1458, lon: 79.0882, terrain: 'plains',  normalMax: 41.2 },
  { id: 'akola',      name: 'Akola',        region: 'Central India',     state: 'Maharashtra',    lat: 20.7002, lon: 77.0082, terrain: 'plains',  normalMax: 41.8 },
  { id: 'bhopal',     name: 'Bhopal',       region: 'Central India',     state: 'Madhya Pradesh', lat: 23.2599, lon: 77.4126, terrain: 'plains',  normalMax: 39.5 },
  { id: 'raipur',     name: 'Raipur',       region: 'Central India',     state: 'Chhattisgarh',   lat: 21.2514, lon: 81.6296, terrain: 'plains',  normalMax: 40.3 },

  // West India
  { id: 'ahmedabad',  name: 'Ahmedabad',    region: 'West India',        state: 'Gujarat',        lat: 23.0225, lon: 72.5714, terrain: 'plains',  normalMax: 40.9 },
  { id: 'mumbai',     name: 'Mumbai',       region: 'West India',        state: 'Maharashtra',    lat: 19.0760, lon: 72.8777, terrain: 'coastal', normalMax: 33.2 },
  { id: 'pune',       name: 'Pune',         region: 'West India',        state: 'Maharashtra',    lat: 18.5204, lon: 73.8567, terrain: 'plains',  normalMax: 36.8 },
  { id: 'surat',      name: 'Surat',        region: 'West India',        state: 'Gujarat',        lat: 21.1702, lon: 72.8311, terrain: 'coastal', normalMax: 35.1 },

  // East India
  { id: 'kolkata',    name: 'Kolkata',      region: 'East India',        state: 'West Bengal',    lat: 22.5726, lon: 88.3639, terrain: 'coastal', normalMax: 35.4 },
  { id: 'patna',      name: 'Patna',        region: 'East India',        state: 'Bihar',          lat: 25.5941, lon: 85.1376, terrain: 'plains',  normalMax: 38.7 },
  { id: 'bhubaneswar',name: 'Bhubaneswar',  region: 'East India',        state: 'Odisha',         lat: 20.2961, lon: 85.8245, terrain: 'coastal', normalMax: 37.6 },
  { id: 'ranchi',     name: 'Ranchi',       region: 'East India',        state: 'Jharkhand',      lat: 23.3441, lon: 85.3096, terrain: 'plains',  normalMax: 36.2 },

  // South Peninsular India
  { id: 'hyderabad',  name: 'Hyderabad',    region: 'South Peninsular',  state: 'Telangana',      lat: 17.3850, lon: 78.4867, terrain: 'plains',  normalMax: 38.9 },
  { id: 'chennai',    name: 'Chennai',      region: 'South Peninsular',  state: 'Tamil Nadu',     lat: 13.0827, lon: 80.2707, terrain: 'coastal', normalMax: 36.1 },
  { id: 'bengaluru',  name: 'Bengaluru',    region: 'South Peninsular',  state: 'Karnataka',      lat: 12.9716, lon: 77.5946, terrain: 'plains',  normalMax: 33.4 },
  { id: 'vijayawada', name: 'Vijayawada',   region: 'South Peninsular',  state: 'Andhra Pradesh', lat: 16.5062, lon: 80.6480, terrain: 'plains',  normalMax: 40.1 },

  // Northeast India
  { id: 'guwahati',   name: 'Guwahati',     region: 'Northeast India',   state: 'Assam',          lat: 26.1445, lon: 91.7362, terrain: 'plains',  normalMax: 33.0 },
  { id: 'agartala',   name: 'Agartala',     region: 'Northeast India',   state: 'Tripura',        lat: 23.8315, lon: 91.2868, terrain: 'plains',  normalMax: 34.2 },

  // Hilly Regions
  { id: 'shimla',     name: 'Shimla',       region: 'Hilly Regions',     state: 'Himachal',       lat: 31.1048, lon: 77.1734, terrain: 'hilly',   normalMax: 25.1 },
  { id: 'dehradun',   name: 'Dehradun',     region: 'Hilly Regions',     state: 'Uttarakhand',    lat: 30.3165, lon: 78.0322, terrain: 'hilly',   normalMax: 32.6 },
  { id: 'srinagar',   name: 'Srinagar',     region: 'Hilly Regions',     state: 'J&K',            lat: 34.0837, lon: 74.7973, terrain: 'hilly',   normalMax: 27.8 }
];

const REGIONS = [...new Set(STATIONS.map(s => s.region))];

const SEASONS = {
  Winter: [1, 2],
  'Pre-Monsoon': [3, 4, 5],
  Monsoon: [6, 7, 8, 9],
  'Post-Monsoon': [10, 11, 12]
};

function seasonFor(date) {
  const m = date.getMonth() + 1;
  for (const [name, months] of Object.entries(SEASONS)) {
    if (months.includes(m)) return name;
  }
  return 'Unknown';
}

// ---------------------------------------------------------------------------
// Heat index — Rothfusz regression, metric, with adjustments
// ---------------------------------------------------------------------------

function heatIndex(tempC, humidity) {
  const T = tempC * 9 / 5 + 32;
  const R = humidity;

  // Simple average formula is adequate below 80F
  let hiF = 0.5 * (T + 61.0 + (T - 68.0) * 1.2 + R * 0.094);

  if ((hiF + T) / 2 >= 80) {
    hiF = -42.379 + 2.04901523 * T + 10.14333127 * R
        - 0.22475541 * T * R - 0.00683783 * T * T
        - 0.05481717 * R * R + 0.00122874 * T * T * R
        + 0.00085282 * T * R * R - 0.00000199 * T * T * R * R;

    if (R < 13 && T >= 80 && T <= 112) {
      hiF -= ((13 - R) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
    } else if (R > 85 && T >= 80 && T <= 87) {
      hiF += ((R - 85) / 10) * ((87 - T) / 5);
    }
  }

  const hiC = (hiF - 32) * 5 / 9;

  // The Rothfusz regression is fitted within roughly 27-43C and 40-100% RH.
  // Beyond that it extrapolates upward faster than the published NWS table, so
  // the result is bounded rather than reported as a precise figure.
  return Math.round(Math.min(hiC, 58) * 10) / 10;
}

// ---------------------------------------------------------------------------
// IMD heatwave classification
// ---------------------------------------------------------------------------

const BASE_THRESHOLD = { plains: 40, coastal: 37, hilly: 30 };

/**
 * Classify a single station-day against IMD criteria.
 * Returns { severity, departure, criterion } where severity is one of
 * normal | watch | heatwave | severe.
 */
function classify(station, maxTemp) {
  const base = BASE_THRESHOLD[station.terrain] || 40;
  const departure = Math.round((maxTemp - station.normalMax) * 10) / 10;

  // Absolute-temperature override applies regardless of departure
  if (maxTemp >= 47) {
    return { severity: 'severe', departure, criterion: 'Absolute maximum at or above 47C' };
  }
  if (maxTemp >= 45) {
    return { severity: 'heatwave', departure, criterion: 'Absolute maximum at or above 45C' };
  }

  if (maxTemp < base) {
    return { severity: 'normal', departure, criterion: `Below the ${station.terrain} base threshold of ${base}C` };
  }

  if (departure >= 6.5) {
    return { severity: 'severe', departure, criterion: `Departure from normal of ${departure}C, at or above 6.5C` };
  }
  if (departure >= 4.5) {
    return { severity: 'heatwave', departure, criterion: `Departure from normal of ${departure}C, between 4.5C and 6.4C` };
  }
  if (departure >= 3.0) {
    return { severity: 'watch', departure, criterion: `Departure from normal of ${departure}C, approaching heatwave criteria` };
  }

  return { severity: 'normal', departure, criterion: `Departure from normal of ${departure}C, within normal range` };
}

const SEVERITY_RANK = { normal: 0, watch: 1, heatwave: 2, severe: 3 };

const SEVERITY_LABEL = {
  normal: 'Normal',
  watch: 'Heat watch',
  heatwave: 'Heatwave',
  severe: 'Severe heatwave'
};

// ---------------------------------------------------------------------------
// Hotspot score
// ---------------------------------------------------------------------------

/**
 * A hotspot is not simply the hottest place. It combines the departure from
 * local normal, the persistence of the event, and the failure of night-time
 * temperatures to fall, which is what drives heat mortality.
 */
function hotspotScore({ departure, consecutiveDays, nightMin, heatIdx }) {
  const departureScore  = Math.max(0, departure) * 6;
  const persistenceScore = Math.min(consecutiveDays, 5) * 8;
  const nightScore      = Math.max(0, nightMin - 26) * 5;
  const indexScore      = Math.max(0, heatIdx - 40) * 2;
  return Math.round(Math.min(100, departureScore + persistenceScore + nightScore + indexScore));
}

module.exports = {
  STATIONS,
  REGIONS,
  SEASONS,
  seasonFor,
  heatIndex,
  classify,
  hotspotScore,
  SEVERITY_RANK,
  SEVERITY_LABEL,
  BASE_THRESHOLD
};
