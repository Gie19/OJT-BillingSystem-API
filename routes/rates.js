const express = require('express');
const router = express.Router();
const db = require('../db');
const util = require('util');
const getCurrentDateTime = require('../utils/getCurrentDateTime');

const authenticateToken = require('../middleware/authenticateToken');
const authorizeRole = require('../middleware/authorizeRole');


const query = util.promisify(db.query).bind(db);

// All routes below require valid token
router.use(authenticateToken);

//GET ALL RATES
router.get('/', authorizeRole('admin'), async (req, res) => {   
    try {
        const results = await query('SELECT * FROM utility_rate');  
        res.json(results);
    } catch (err) { 
        console.error('Database error:', err);
        res.status(500).json({ error: err.message });
    }
});


//GET RATE BY ID
router.get('/:id', authorizeRole('admin'), async (req, res) => {
    const rateId = req.params.id;
    try {           
        const results = await query('SELECT * FROM utility_rate WHERE rate_id = ?', [rateId]);
        if (results.length === 0) {
            return res.status(404).json({ message: 'Rate not found' });
        }
        res.json(results[0]);
    } catch (err) {
        console.error('Database error:', err);
        res.status(500).json({ error: err.message });   
    }
}); 

//CREATE NEW ELECTRIC RATE
router.post('/electric', authorizeRole('admin'), async (req, res) => {
    const { meter_sn, erate_perKwH, emin_con, e_vat } = req.body;
    
    // Validation
    if (!meter_sn || !erate_perKwH || !emin_con || !e_vat) {
        return res.status(400).json({ error: 'All fields are required' });
    }
    try {
         // Check if meter_sn exists
        const meterSnCheckSql = 'SELECT meter_sn FROM meters WHERE meter_sn = ?';
        const meterSnResults = await query(meterSnCheckSql, [meter_sn]);
        if (meterSnResults.length === 0) {
            return res.status(400).json({ error: 'Invalid meter_sn: Meter Serial Number does not exist.' });
        }


        const sqlFind = `
            SELECT rate_id FROM utility_rate
            WHERE rate_id LIKE 'R%'
            ORDER BY CAST(SUBSTRING(rate_id, 2) AS UNSIGNED) DESC
            LIMIT 1
        `;
        const results = await query(sqlFind);
        let nextNumber = results.length > 0 ? parseInt(results[0].rate_id.slice(1), 10) + 1 : 1;
        const newRateId = `R${nextNumber}`;

        const today = getCurrentDateTime();
        const updatedBy = req.user.user_fullname;

        const sqlInsert = `
      INSERT INTO utility_rate (
        rate_id, meter_sn, erate_perKwH, emin_con, e_vat, last_updated, updated_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    await query(sqlInsert, [
      newRateId,
      meter_sn,
      erate_perKwH,
      emin_con,
      e_vat,
      today,
      updatedBy
    ]);

    res.status(201).json({ message: 'Rate created successfully', rateId: newRateId });

    } catch (err) {
        console.error('Error in POST /meters/electric:', err);
        res.status(500).json({ error: err.message });
    }
    
});



//CREATE NEW WATER RATE
router.post('/water', authorizeRole('admin'), async (req, res) => {
    const { meter_sn, wmin_con, wrate_perCbM, wnet_vat, w_vat } = req.body;
    
    // Validation
    if (!meter_sn || !wmin_con || !wrate_perCbM || !wnet_vat || !w_vat) {
        return res.status(400).json({ error: 'All fields are required' });
    }
    try {
         // Check if meter_sn exists
        const meterSnCheckSql = 'SELECT meter_sn FROM meters WHERE meter_sn = ?';
        const meterSnResults = await query(meterSnCheckSql, [meter_sn]);
        if (meterSnResults.length === 0) {
            return res.status(400).json({ error: 'Invalid meter_sn: Meter Serial Number does not exist.' });
        }


        const sqlFind = `
            SELECT rate_id FROM utility_rate
            WHERE rate_id LIKE 'R%'
            ORDER BY CAST(SUBSTRING(rate_id, 2) AS UNSIGNED) DESC
            LIMIT 1
        `;
        const results = await query(sqlFind);
        let nextNumber = results.length > 0 ? parseInt(results[0].rate_id.slice(1), 10) + 1 : 1;
        const newRateId = `R${nextNumber}`;

        const today = getCurrentDateTime();
        const updatedBy = req.user.user_fullname;

        const sqlInsert = `
      INSERT INTO utility_rate (
        rate_id, meter_sn, wmin_con, wrate_perCbM, wnet_vat, w_vat, last_updated, updated_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    await query(sqlInsert, [
      newRateId,
      meter_sn,
      wmin_con,
      wrate_perCbM,
      wnet_vat,
      w_vat,
      today,
      updatedBy
    ]);

    res.status(201).json({ message: 'Rate created successfully', rateId: newRateId });

    } catch (err) {
        console.error('Error in POST /meters/water:', err);
        res.status(500).json({ error: err.message });
    }
    
});


//CREATE NEW LPG RATE
router.post('/lpg', authorizeRole('admin'), async (req, res) => {
    const { meter_sn, l_rate} = req.body;
    
    // Validation
    if (!meter_sn || !l_rate) {
        return res.status(400).json({ error: 'All fields are required' });
    }
    try {
         // Check if meter_sn exists
        const meterSnCheckSql = 'SELECT meter_sn FROM meters WHERE meter_sn = ?';
        const meterSnResults = await query(meterSnCheckSql, [meter_sn]);
        if (meterSnResults.length === 0) {
            return res.status(400).json({ error: 'Invalid meter_sn: Meter Serial Number does not exist.' });
        }


        const sqlFind = `
            SELECT rate_id FROM utility_rate
            WHERE rate_id LIKE 'R%'
            ORDER BY CAST(SUBSTRING(rate_id, 2) AS UNSIGNED) DESC
            LIMIT 1
        `;
        const results = await query(sqlFind);
        let nextNumber = results.length > 0 ? parseInt(results[0].rate_id.slice(1), 10) + 1 : 1;
        const newRateId = `R${nextNumber}`;

        const today = getCurrentDateTime();
        const updatedBy = req.user.user_fullname;

        const sqlInsert = `
      INSERT INTO utility_rate (
        rate_id, meter_sn, l_rate, last_updated, updated_by
      )
      VALUES (?, ?, ?, ?, ?)
    `;
    await query(sqlInsert, [
        newRateId,
        meter_sn,
        l_rate,
        today,
        updatedBy
    ]);

    res.status(201).json({ message: 'Rate created successfully', rateId: newRateId });

    } catch (err) {
        console.error('Error in POST /meters/lpg:', err);
        res.status(500).json({ error: err.message });
    }
    
});


module.exports = router;