/**
 * forecast-service — 7-day heatwave prediction with probability
 *
 * Runs the original Vercel handler(s) from api/ as an independent service.
 * Station data comes from the data-service (DATA_SERVICE_URL).
 */

const { createService } = require('../shared/runtime');

createService({
  name: 'forecast-service',
  port: parseInt(process.env.PORT, 10) || 4002,
  routes: {
    '/api/forecast': require('../../api/forecast.js')
  }
});
