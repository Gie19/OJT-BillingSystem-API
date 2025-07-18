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


// UPDATE RATE BY ID FOR ELECTRIC
router.put('/electric/:id', authorizeRole('admin'), async (req, res) => {
    const rateId = req.params.id;
    const { meter_sn, erate_perKwH, emin_con, e_vat } = req.body;
    const updatedBy = req.user.user_fullname;
    const lastUpdated = getCurrentDateTime();

    try {
        // Fetch existing rate
        const sqlGet = 'SELECT * FROM utility_rate WHERE rate_id = ?';
        const results = await query(sqlGet, [rateId]);
        if (results.length === 0) {
            return res.status(404).json({ error: 'Rate not found' });
        }
        const existing = results[0];

        // Resolve final values
        const finalMeterSN = meter_sn || existing.meter_sn;
        const finalERate = erate_perKwH || existing.erate_perKwH;
        const finalEMinCon = emin_con || existing.emin_con;
        const finalEVat = e_vat || existing.e_vat;

        // Validate new meter_sn
        if (meter_sn && meter_sn !== existing.meter_sn) {
            const metersnCheckSql = 'SELECT meter_sn FROM meters WHERE meter_sn = ?';
            const metersnResults = await query(metersnCheckSql, [meter_sn]);
            if (metersnResults.length === 0) {
                return res.status(400).json({ error: 'Invalid meter_sn: Meter Serial Number does not exist.' });
            }
        }

        const sqlUpdate = `
            UPDATE utility_rate
            SET meter_sn = ?, erate_perKwH = ?, emin_con = ?, e_vat = ?, last_updated = ?, updated_by = ?
            WHERE rate_id = ?
        `;
        await query(sqlUpdate, [
            finalMeterSN,
            finalERate,
            finalEMinCon,
            finalEVat,
            lastUpdated,
            updatedBy,
            rateId
        ]);

        res.json({ message: `Rate with ID ${rateId} updated successfully` });
    } catch (err) {
        console.error('Error in PUT /rates/electric/:id:', err);
        res.status(500).json({ error: err.message });
    }
});

// UPDATE RATE BY ID FOR WATER
router.put('/water/:id', authorizeRole('admin'), async (req, res) => {
    const rateId = req.params.id;
    const { meter_sn, wmin_con, wrate_perCbM, wnet_vat, w_vat } = req.body;
    const updatedBy = req.user.user_fullname;
    const lastUpdated = getCurrentDateTime();

    try {
        // Fetch existing rate
        const sqlGet = 'SELECT * FROM utility_rate WHERE rate_id = ?';
        const results = await query(sqlGet, [rateId]);
        if (results.length === 0) {
            return res.status(404).json({ error: 'Rate not found' });
        }
        const existing = results[0];
        // Resolve final values
        const finalMeterSN = meter_sn || existing.meter_sn;
        const finalWMinCon = wmin_con || existing.wmin_con;
        const finalWRate = wrate_perCbM || existing.wrate_perCbM;
        const finalWNetVat = wnet_vat || existing.wnet_vat;
        const finalWVat = w_vat || existing.w_vat;

        // Validate new meter_sn
        if (meter_sn && meter_sn !== existing.meter_sn) {
            const metersnCheckSql = 'SELECT meter_sn FROM meters WHERE meter_sn = ?';
            const metersnResults = await query(metersnCheckSql, [meter_sn]);
            if (metersnResults.length === 0) {
                return res.status(400).json({ error: 'Invalid meter_sn: Meter Serial Number does not exist.' });
            }
        }

        const sqlUpdate = `
            UPDATE utility_rate
            SET meter_sn = ?, wmin_con = ?, wrate_perCbM = ?, wnet_vat = ?, w_vat = ?, last_updated = ?, updated_by = ?
            WHERE rate_id = ?
        `;
        await query(sqlUpdate, [
            finalMeterSN,
            finalWMinCon,
            finalWRate,
            finalWNetVat,
            finalWVat,
            lastUpdated,
            updatedBy,
            rateId
        ]);
        res.json({ message: `Rate with ID ${rateId} updated successfully` });
    } catch (err) {
        console.error('Error in PUT /rates/water/:id:', err);
        res.status(500).json({ error: err.message });
    }
});


// UPDATE RATE BY ID FOR LPG
router.put('/lpg/:id', authorizeRole('admin'), async (req, res) => {
    const rateId = req.params.id;   
    const { meter_sn, l_rate } = req.body;
    const updatedBy = req.user.user_fullname;
    const lastUpdated = getCurrentDateTime();

    try {
        // Fetch existing rate
        const sqlGet = 'SELECT * FROM utility_rate WHERE rate_id = ?';
        const results = await query(sqlGet, [rateId]);
        if (results.length === 0) {
            return res.status(404).json({ error: 'Rate not found' });
        }
        const existing = results[0];
        // Resolve final values
        const finalMeterSN = meter_sn || existing.meter_sn;
        const finalLRate = l_rate || existing.l_rate;
        // Validate new meter_sn
        if (meter_sn && meter_sn !== existing.meter_sn) {
            const metersnCheckSql = 'SELECT meter_sn FROM meters WHERE meter_sn = ?';
            const metersnResults = await query(metersnCheckSql, [meter_sn]);
            if (metersnResults.length === 0) {
                return res.status(400).json({ error: 'Invalid meter_sn: Meter Serial Number does not exist.' });
            }
        }
        const sqlUpdate = `
            UPDATE utility_rate
            SET meter_sn = ?, l_rate = ?, last_updated = ?, updated_by = ?
            WHERE rate_id = ?
        `;
        await query(sqlUpdate, [
            finalMeterSN,
            finalLRate,
            lastUpdated,
            updatedBy,
            rateId
        ]);
        res.json({ message: `Rate with ID ${rateId} updated successfully` });
    } catch (err) {
        console.error('Error in PUT /rates/lpg/:id:', err);
        res.status(500).json({ error: err.message });
    }
});

// DELETE RATE BY ID
router.delete('/:id', authorizeRole('admin'), async (req, res) => {
  const rateId = req.params.id;

  try {
    // Check if rate exists
    const sqlCheck = 'SELECT * FROM utility_rate WHERE rate_id = ?';
    const results = await query(sqlCheck, [rateId]);
    if (results.length === 0) {
      return res.status(404).json({ error: 'Rate not found' });
    }

    // Delete the rate
    const sqlDelete = 'DELETE FROM utility_rate WHERE rate_id = ?';
    await query(sqlDelete, [rateId]);

    res.json({ message: `Rate with ID ${rateId} deleted successfully` });
  } catch (err) {
    console.error('Error in DELETE /rates/:id:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;