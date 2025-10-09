// routes/tenants.js
const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');

const getCurrentDateTime = require('../utils/getCurrentDateTime');
const authenticateToken = require('../middleware/authenticateToken');
const authorizeRole = require('../middleware/authorizeRole');
const { authorizeBuildingParam, enforceRecordBuilding } = require('../middleware/authorizeBuilding');

const Tenant = require('../models/Tenant');
const VAT = require('../models/VAT');
const WT = require('../models/WT');

// All routes require login
router.use(authenticateToken);

// Helper to validate vat_code and wt_code
async function validateVatCodeOrNull(vat_code) {
  if (vat_code == null || vat_code === '') return null;
  const v = await VAT.findOne({ where: { vat_code: String(vat_code) }, attributes: ['vat_code'], raw: true });
  if (!v) throw new Error('Invalid vat_code: not found in vat_codes');
  return v.vat_code;
}

async function validateWtCodeOrNull(wt_code) {
  if (wt_code == null || wt_code === '') return null;
  const w = await WT.findOne({ where: { wt_code: String(wt_code) }, attributes: ['wt_code'], raw: true });
  if (!w) throw new Error('Invalid wt_code: not found in wt_codes');
  return w.wt_code;
}

/** GET /tenants — list tenants with optional filters for penalty */
router.get('/', async (req, res) => {
  try {
    const where = {};

    // Filter by for_penalty if provided
    const qPenalty = (req.query.for_penalty || '').toString().toLowerCase();
    if (qPenalty) {
      if (!['true', 'false'].includes(qPenalty)) {
        return res.status(400).json({ error: "Invalid for_penalty. Use 'true' or 'false'." });
      }
      where.for_penalty = qPenalty === 'true';
    }

    // Search filter for tenant_name or tenant_sn
    const q = (req.query.q || '').toString().trim();
    if (q) {
      where[Op.or] = [
        { tenant_name: { [Op.like]: `%${q}%` } },
        { tenant_sn: { [Op.like]: `%${q}%` } },
      ];
    }

    const tenants = await Tenant.findAll({
      where,
      include: [{ model: VAT, as: 'vat', attributes: ['vat_code', 'vat_description'] }, 
                { model: WT, as: 'wt', attributes: ['wt_code', 'wt_description'] }],
    });

    res.json(tenants);
  } catch (err) {
    console.error('GET /tenants error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/** POST /tenants — create a new tenant */
router.post('/', authorizeRole('admin', 'biller'), async (req, res) => {
  try {
    const {
      tenant_sn,
      tenant_name,
      building_id,
      tenant_status,
      vat_code,       
      wt_code,        
      for_penalty     
    } = req.body || {};

    const validVatCode = await validateVatCodeOrNull(vat_code);
    const validWtCode = await validateWtCodeOrNull(wt_code);
    const penaltyFlag = (typeof for_penalty === 'boolean') ? for_penalty : (String(for_penalty).toLowerCase() === 'true');

    const newTenantId = `TENANT-${Date.now()}`;  // Replace with your own ID logic

    const created = await Tenant.create({
      tenant_id: newTenantId,
      tenant_sn,
      tenant_name,
      building_id,
      tenant_status: tenant_status || 'active',
      vat_code: validVatCode,
      wt_code: validWtCode,
      for_penalty: penaltyFlag,
      last_updated: getCurrentDateTime(),
      updated_by: req.user?.user_fullname || 'System Admin',
    });

    res.status(201).json({ message: 'Tenant created successfully', tenantId: newTenantId });
  } catch (err) {
    console.error('POST /tenants error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/** PUT /tenants/:tenant_id — update an existing tenant */
router.put('/:tenant_id', authorizeRole('admin', 'biller'), async (req, res) => {
  try {
    const tenant = await Tenant.findByPk(req.params.tenant_id);
    if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

    const {
      tenant_sn,
      tenant_name,
      building_id,
      tenant_status,
      vat_code,       // NEW
      wt_code,        // NEW
      for_penalty     // NEW
    } = req.body || {};

    const validVatCode = vat_code ? await validateVatCodeOrNull(vat_code) : tenant.vat_code;
    const validWtCode = wt_code ? await validateWtCodeOrNull(wt_code) : tenant.wt_code;
    const penaltyFlag = (for_penalty === undefined) ? tenant.for_penalty : (String(for_penalty).toLowerCase() === 'true');

    await tenant.update({
      tenant_sn: tenant_sn ?? tenant.tenant_sn,
      tenant_name: tenant_name ?? tenant.tenant_name,
      building_id: building_id ?? tenant.building_id,
      tenant_status: tenant_status ?? tenant.tenant_status,
      vat_code: validVatCode,
      wt_code: validWtCode,
      for_penalty: penaltyFlag,
      last_updated: getCurrentDateTime(),
      updated_by: req.user?.user_fullname || 'System Admin',
    });

    res.json(tenant);
  } catch (err) {
    console.error('PUT /tenants/:tenant_id error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
