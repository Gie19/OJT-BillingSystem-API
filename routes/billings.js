// routes/billings.js
'use strict';

const express = require('express');
const router = express.Router();

const authenticateToken = require('../middleware/authenticateToken');
const authorizeRole     = require('../middleware/authorizeRole');
const getCurrentDateTime = require('../utils/getCurrentDateTime');

const {
  computeBillingForMeter,
  computeBillingForTenant,
} = require('../utils/billingEngine');

// Require auth for all billing routes
router.use(authenticateToken);

/**
 * GET /billings/meters/:meter_id/period-end/:endDate
 * - endDate: YYYY-MM-DD (e.g. 2025-02-20)
 * - optional query: ?penalty_rate=2  (in PERCENT, e.g. 2 = 2%)
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

      // Optional percent, defaults to 0 if omitted
      const penaltyRatePct = Number(req.query.penalty_rate) || 0;

      const result = await computeBillingForMeter({
        meterId: meter_id,
        endDate,
        user: req.user,
        penaltyRatePct,
      });

      res.json({
        ...result,
        generated_at: getCurrentDateTime(),
      });
    } catch (err) {
      console.error('Billing (meter) error:', err);
      res.status(err.status || 500).json({ error: err.message });
    }
  }
);

/**
 * GET /billings/tenants/:tenant_id/period-end/:endDate
 * - endDate: YYYY-MM-DD (e.g. 2025-02-20)
 * - optional query: ?penalty_rate=2  (in PERCENT)
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

      const penaltyRatePct = Number(req.query.penalty_rate) || 0;

      const { meters, totals_by_type, grand_totals } =
        await computeBillingForTenant({ tenantId: tenant_id, endDate, user: req.user, penaltyRatePct });

      res.json({
        tenant_id,
        end_date: endDate,
        meters,
        totals_by_type,
        grand_totals,
        generated_at: getCurrentDateTime(),
      });
    } catch (err) {
      console.error('Billing (tenant) error:', err);
      res.status(err.status || 500).json({ error: err.message });
    }
  }
);

module.exports = router;
