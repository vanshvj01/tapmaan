/* Plain-node tests for the classification and index logic. Run: npm test */
const assert = require('assert');
const { STATIONS, classify, heatIndex, hotspotScore } = require('../api/_lib/heat');

let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('  pass  ' + name); }
  catch (e) { console.error('  FAIL  ' + name + ' — ' + e.message); process.exitCode = 1; }
}

const nagpur = STATIONS.find(s => s.id === 'nagpur');   // plains, normal 41.2
const mumbai = STATIONS.find(s => s.id === 'mumbai');   // coastal, normal 33.2
const shimla = STATIONS.find(s => s.id === 'shimla');   // hilly, normal 25.1

console.log('IMD classification');
check('below plains base threshold is normal', () =>
  assert.strictEqual(classify(nagpur, 39.0).severity, 'normal'));
check('departure 4.5 to 6.4 is a heatwave', () =>
  assert.strictEqual(classify(nagpur, 45.8).severity, 'heatwave'));
check('departure at or above 6.5 is severe', () =>
  assert.strictEqual(classify(nagpur, 47.9).severity, 'severe'));
check('absolute 45C triggers heatwave regardless', () =>
  assert.strictEqual(classify(mumbai, 45.0).severity, 'heatwave'));
check('coastal base threshold is lower', () =>
  assert.strictEqual(classify(mumbai, 38.0).severity, 'heatwave'));
check('hilly base threshold is lower still', () =>
  assert.strictEqual(classify(shimla, 31.0).severity, 'heatwave'));
check('departure is reported to one decimal', () =>
  assert.strictEqual(classify(nagpur, 45.8).departure, 4.6));

console.log('Heat index');
const f2c = f => (f - 32) * 5 / 9, c2f = c => c * 9 / 5 + 32;
check('90F at 70% RH matches NWS within 2F', () =>
  assert.ok(Math.abs(c2f(heatIndex(f2c(90), 70)) - 106) < 2));
check('100F at 40% RH matches NWS within 2F', () =>
  assert.ok(Math.abs(c2f(heatIndex(f2c(100), 40)) - 109) < 2));
check('humidity raises apparent temperature', () =>
  assert.ok(heatIndex(35, 80) > heatIndex(35, 30)));
check('bounded outside the fitted domain', () =>
  assert.ok(heatIndex(48, 90) <= 58));

console.log('Hotspot score');
check('benign conditions score low', () =>
  assert.ok(hotspotScore({ departure: 1, consecutiveDays: 0, nightMin: 22, heatIdx: 35 }) < 15));
check('severe persistent conditions score high', () =>
  assert.ok(hotspotScore({ departure: 7, consecutiveDays: 4, nightMin: 31, heatIdx: 50 }) > 80));
check('warm nights raise the score', () => {
  const base = { departure: 5, consecutiveDays: 2, heatIdx: 45 };
  assert.ok(hotspotScore({ ...base, nightMin: 31 }) > hotspotScore({ ...base, nightMin: 23 }));
});
check('score never exceeds 100', () =>
  assert.ok(hotspotScore({ departure: 20, consecutiveDays: 10, nightMin: 40, heatIdx: 60 }) <= 100));

console.log(`\n${passed} checks passed.`);
