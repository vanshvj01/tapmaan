/**
 * advisory-service — stakeholder-specific advisories (LLM with template fallback)
 *
 * Runs the original Vercel handler(s) from api/ as an independent service.
 * Station data comes from the data-service (DATA_SERVICE_URL).
 */

const { createService } = require('../shared/runtime');

createService({
  name: 'advisory-service',
  port: parseInt(process.env.PORT, 10) || 4004,
  routes: {
    '/api/advisory': require('../../api/advisory.js')
  }
});
