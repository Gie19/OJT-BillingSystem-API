const express = require('express');
const router = express.Router();
const db = require('../db');
const util = require('util');
const getCurrentDateTime = require('../utils/getCurrentDateTime');
const authenticateToken = require('../middleware/authenticateToken');
const authorizeRole = require('../middleware/authorizeRole');

const query = util.promisify(db.query).bind(db);

// All routes below require a valid token
router.use(authenticateToken);


//GET ALL QR DETAILS
router.get('/', authorizeRole('admin'), async (req, res) => {
    try {
        const results = await query('SELECT * FROM qr_details');
        res.json(results);
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ error: err.message });
    }
});

//GET QR DETAILS BY ID
router.get('/:id', authorizeRole('admin'), async (req, res) => {
    const qrId = req.params.id;
    try {
        const results = await query('SELECT * FROM qr_details WHERE qr_id = ?', [qrId]);
        if (results.length === 0) {
            return res.status(404).json({ message: 'QR details not found' });
        }
        res.json(results[0]);
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ error: err.message });
    }
});

//CREATE NEW QR DETAILS
router.post('/', authorizeRole('admin'), async (req, res) => { 
    try {
        //Find the highest existing QR number
        const sqlFind = `
            SELECT qr_id FROM qr_details
            WHERE qr_id LIKE 'QR-%'
            ORDER BY CAST(SUBSTRING(qr_id, 4) AS UNSIGNED) DESC
            LIMIT 1
        `;
        const results = await query(sqlFind);

        let nextNumber = 1;
        if (results.length > 0) {
            const lastId = results[0].qr_id;
            const lastNumber = parseInt(lastId.slice(3), 10);
            nextNumber = lastNumber + 1;
        }

        //Prepare new QR data
        const newQrId = `QR-${nextNumber}`;
        const today = getCurrentDateTime();
        const generatedBy = req.user.user_fullname;

        //Insert new QR details
        const insertSql = 'INSERT INTO qr_details (qr_id, generated_date, generated_by) VALUES (?, ?, ?)';
        await query(insertSql, [newQrId, today, generatedBy]);

        res.status(201).json({ message: 'QR details created successfully', qr_id: newQrId });
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ error: err.message });
    }
});


// UPDATE QR DETAILS BY ID
router.put('/:id', authorizeRole('admin'), async (req, res) => {
    const qrId = req.params.id;
    const { generated_date, generated_by } = req.body;

    try {
        // Check if QR exists
        const sqlGet = 'SELECT * FROM qr_details WHERE qr_id = ?';
        const results = await query(sqlGet, [qrId]);
        if (results.length === 0) {
            return res.status(404).json({ error: 'QR details not found' });
        }

        // Update QR details
        const sqlUpdate = `
            UPDATE qr_details
            SET generated_date = ?, generated_by = ?
            WHERE qr_id = ?
        `;
        await query(sqlUpdate, [generated_date, generated_by, qrId]);

        res.json({ message: 'QR details updated successfully' });
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ error: err.message });
    }
});

// DELETE QR DETAILS BY ID
router.delete('/:id', authorizeRole('admin'), async (req, res) => {
    const qrId = req.params.id;

    try {
        // Check if QR exists
        const sqlGet = 'SELECT * FROM qr_details WHERE qr_id = ?';
        const results = await query(sqlGet, [qrId]);
        if (results.length === 0) {
            return res.status(404).json({ error: 'QR details not found' });
        }

        // Delete QR details
        const sqlDelete = 'DELETE FROM qr_details WHERE qr_id = ?';
        await query(sqlDelete, [qrId]);

        res.json({ message: `QR details with ID ${qrId} deleted successfully` });
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ error: err.message });
    }
});


module.exports = router;