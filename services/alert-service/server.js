/**
 * alert-service — early-warning queue and subscriber registration
 *
 * Runs the original Vercel handler(s) from api/ as an independent service.
 * Station data comes from the data-service (DATA_SERVICE_URL).
 */

const { createService } = require('../shared/runtime');

createService({
  name: 'alert-service',
  port: parseInt(process.env.PORT, 10) || 4005,
  routes: {
    '/api/alerts': require('../../api/alerts.js'),
    '/api/subscribe': require('../../api/subscribe.js')
  }
});
