/**
 * monitoring-service — current conditions classified against IMD criteria
 *
 * Runs the original Vercel handler(s) from api/ as an independent service.
 * Station data comes from the data-service (DATA_SERVICE_URL).
 */

const { createService } = require('../shared/runtime');

createService({
  name: 'monitoring-service',
  port: parseInt(process.env.PORT, 10) || 4001,
  routes: {
    '/api/observations': require('../../api/observations.js')
  }
});
