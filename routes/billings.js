// routes/billings.js
const express = require('express');
const router = express.Router();

const authenticateToken = require('../middleware/authenticateToken');
const authorizeRole     = require('../middleware/authorizeRole');

const getCurrentDateTime = require('../utils/getCurrentDateTime');
const {
  computeBillingForMeter,
  computeBillingForTenant,
} = require('../utils/billingEngine');

// All billings routes require auth
router.use(authenticateToken);

/**
 * GET /billings/meters/:meter_id/period-end/:endDate
 * endDate format: YYYY-MM-DD
 */
router.get(
  '/meters/:meter_id/period-end/:endDate',
  authorizeRole('admin', 'operator', 'biller'),
  async (req, res) => {
    try {
      const { meter_id, endDate } = req.params;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        return res.status(400).json({ error: 'Invalid endDate. Use YYYY-MM-DD.' });
      }
      const result = await computeBillingForMeter({ meterId: meter_id, endDate, user: req.user });
      return res.json({ ...result, generated_at: getCurrentDateTime() });
    } catch (err) {
      const status = err.status || 500;
      console.error('Billing (meter) error:', err);
      res.status(status).json({ error: err.message });
    }
  }
);

/**
 * GET /billings/tenants/:tenant_id/period-end/:endDate
 * endDate format: YYYY-MM-DD
 * Computes all meters under the tenant (scoped by building for non-admins)
 */
router.get(
  '/tenants/:tenant_id/period-end/:endDate',
  authorizeRole('admin', 'operator', 'biller'),
  async (req, res) => {
    try {
      const { tenant_id, endDate } = req.params;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        return res.status(400).json({ error: 'Invalid endDate. Use YYYY-MM-DD.' });
      }

      const { meters, totals_by_type, grand_totals } =
        await computeBillingForTenant({ tenantId: tenant_id, endDate, user: req.user });

      return res.json({
        tenant_id,
        end_date: endDate,
        meters,
        totals_by_type,
        grand_totals,
        generated_at: getCurrentDateTime(),
      });
    } catch (err) {
      const status = err.status || 500;
      console.error('Billing (tenant) error:', err);
      res.status(status).json({ error: err.message });
    }
  }
);

module.exports = router;
