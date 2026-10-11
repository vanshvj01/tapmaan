/**
 * hotspot-service — hotspot scoring and regional aggregation
 *
 * Runs the original Vercel handler(s) from api/ as an independent service.
 * Station data comes from the data-service (DATA_SERVICE_URL).
 */

const { createService } = require('../shared/runtime');

createService({
  name: 'hotspot-service',
  port: parseInt(process.env.PORT, 10) || 4003,
  routes: {
    '/api/hotspots': require('../../api/hotspots.js')
  }
});
