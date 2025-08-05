const express = require('express');
const router = express.Router();
const db = require('../db');
const util = require('util');
const getCurrentDateTime = require('../utils/getCurrentDateTime');

const authenticateToken = require('../middleware/authenticateToken');
const authorizeRole = require('../middleware/authorizeRole');
const authorizeBuilding = require('../middleware/authorizeBuilding'); // Add if needed

const query = util.promisify(db.query).bind(db);

// All routes below require valid token
router.use(authenticateToken);

// GET ALL METERS
router.get('/', authorizeRole('admin'), async (req, res) => {
    try {
        const results = await query('SELECT * FROM meter_list');
        res.json(results);
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ error: err.message });
    }
});

// GET METER BY ID
router.get('/:id', authorizeRole('admin'), async (req, res) => {
    const meterId = req.params.id;
    try {
        const results = await query('SELECT * FROM meter_list WHERE meter_id = ?', [meterId]);
        if (results.length === 0) {
            return res.status(404).json({ message: 'Meter not found' });
        }
        res.json(results[0]);
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ error: err.message });
    }
});

//CREATE NEW METER
router.post('/', authorizeRole('admin'), async (req, res) => {
    const { meter_type, meter_sn, meter_mult, stall_id, meter_status, qr_id } = req.body;

    // Validation (qr_id not required)
    if (!meter_type || !meter_sn || !stall_id || !meter_status) {
        return res.status(400).json({ error: 'meter_type, meter_sn, stall_id, and meter_status are required' });
    }

    try {
        // Check if stall_id exists
        const stallCheckSql = 'SELECT stall_id FROM stall_list WHERE stall_id = ?';
        const stallResults = await query(stallCheckSql, [stall_id]);
        if (stallResults.length === 0) {
            return res.status(400).json({ error: 'Invalid stall_id: Stall does not exist.' });
        }

        // Check if qr_id exists (only if provided and not null/empty)
        if (qr_id) {
            const qrCheckSql = 'SELECT qr_id FROM qr_details WHERE qr_id = ?';
            const qrResults = await query(qrCheckSql, [qr_id]);
            if (qrResults.length === 0) {
                return res.status(400).json({ error: 'Invalid qr_id: QR ID does not exist.' });
            }
        }

        // Get next meter_id
        const sqlFind = `
            SELECT meter_id FROM meter_list
            WHERE meter_id LIKE 'MTR-%'
            ORDER BY CAST(SUBSTRING(meter_id, 5) AS UNSIGNED) DESC
            LIMIT 1
        `;
        const results = await query(sqlFind);
        const nextNumber = results.length > 0 ? parseInt(results[0].meter_id.slice(4), 10) + 1 : 1;
        const newMeterId = `MTR-${nextNumber}`;

        // Determine default meter_mult if not provided
        let finalMult = meter_mult;
        if (finalMult === undefined || finalMult === null || finalMult === '') {
            finalMult = (meter_type.toLowerCase() === 'water') ? 93.00 : 1;
        }

        const today = getCurrentDateTime();
        const updatedBy = req.user.user_fullname;

        const sqlInsert = `
            INSERT INTO meter_list (
                meter_id, meter_type, meter_sn, meter_mult, stall_id,
                meter_status, qr_id, last_updated, updated_by
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        await query(sqlInsert, [
            newMeterId,
            meter_type,
            meter_sn,
            finalMult,
            stall_id,
            meter_status,
            qr_id || null,   // Insert NULL if no qr_id provided
            today,
            updatedBy
        ]);

        res.status(201).json({ message: 'Meter created successfully', meterId: newMeterId });
    } catch (err) {
        console.error('Error in POST /meters:', err);
        res.status(500).json({ error: err.message });
    }
});

// UPDATE METER BY ID
router.put('/:id', authorizeRole('admin'), async (req, res) => {
    const meterId = req.params.id;
    const { meter_type, meter_sn, stall_id, meter_status, meter_mult, qr_id } = req.body;
    const updatedBy = req.user.user_fullname;
    const lastUpdated = getCurrentDateTime();

    try {
        // Fetch existing meter
        const sqlGet = 'SELECT * FROM meter_list WHERE meter_id = ?';
        const results = await query(sqlGet, [meterId]);
        if (results.length === 0) {
            return res.status(404).json({ error: 'Meter not found' });
        }

        const existing = results[0];

        // Resolve final values
        const finalMeterType = meter_type || existing.meter_type;
        const finalMeterSn = meter_sn || existing.meter_sn;
        const finalStallId = stall_id || existing.stall_id;
        const finalMeterStatus = meter_status || existing.meter_status;
        let finalQrId = (qr_id !== undefined) ? qr_id : existing.qr_id;
        let finalMult = meter_mult !== undefined ? meter_mult : existing.meter_mult;

        if (meter_type && meter_type !== existing.meter_type && meter_mult === undefined) {
            finalMult = (meter_type.toLowerCase() === 'water') ? 93.00 : 1;
        }

        // Validate stall_id if changed
        if (stall_id && stall_id !== existing.stall_id) {
            const stallCheckSql = 'SELECT stall_id FROM stall_list WHERE stall_id = ?';
            const stallResults = await query(stallCheckSql, [stall_id]);
            if (stallResults.length === 0) {
                return res.status(400).json({ error: 'Invalid stall_id: Stall does not exist.' });
            }
        }

        // Validate qr_id if changed and not null/empty
        if (qr_id && qr_id !== existing.qr_id) {
            const qrCheckSql = 'SELECT qr_id FROM qr_details WHERE qr_id = ?';
            const qrResults = await query(qrCheckSql, [qr_id]);
            if (qrResults.length === 0) {
                return res.status(400).json({ error: 'Invalid qr_id: QR does not exist.' });
            }
        }

        const sqlUpdate = `
            UPDATE meter_list
            SET meter_type = ?, meter_sn = ?, stall_id = ?, meter_status = ?, meter_mult = ?, qr_id = ?, last_updated = ?, updated_by = ?
            WHERE meter_id = ?
        `;
        await query(sqlUpdate, [
            finalMeterType,
            finalMeterSn,
            finalStallId,
            finalMeterStatus,
            finalMult,
            (qr_id === undefined || qr_id === '') ? null : finalQrId,
            lastUpdated,
            updatedBy,
            meterId
        ]);

        res.json({ message: `Meter with ID ${meterId} updated successfully` });
    } catch (err) {
        console.error('Error in PUT /meters/:id:', err);
        res.status(500).json({ error: err.message });
    }
});


// DELETE METER BY ID
router.delete('/:id', authorizeRole('admin'), async (req, res) => {
    const meterId = req.params.id;
    if (!meterId) {
        return res.status(400).json({ error: 'Meter ID is required' });
    }
    try {
        const sqlDelete = 'DELETE FROM meter_list WHERE meter_id = ?';
        const result = await query(sqlDelete, [meterId]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Meter not found' });
        }
        res.json({ message: `Meter with ID ${meterId} deleted successfully` });
    } catch (err) {
        console.error('Error in DELETE /meters/:id:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
