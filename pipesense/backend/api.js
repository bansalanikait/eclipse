/**
 * PIPE·SENSE v3 — Backend API Routes
 *
 * Express routes for mission persistence and CSV export.
 */

const express = require('express');
const path    = require('path');
const fse     = require('fs-extra');

const router  = express.Router();

const MISSIONS_DIR = path.join(__dirname, 'missions');

// Ensure missions directory exists on module load
fse.ensureDirSync(MISSIONS_DIR);

/* -----------------------------------------------------------
   POST /api/mission/save
   Body: full mission JSON
   Saves to missions/{timestamp}.json
   Returns { id, saved: true }
----------------------------------------------------------- */
router.post('/mission/save', async (req, res) => {
  try {
    const mission = req.body;

    if (!mission || typeof mission !== 'object') {
      return res.status(400).json({ error: 'Invalid mission payload' });
    }

    const id = mission.id || Date.now();
    mission.id = id;

    const filePath = path.join(MISSIONS_DIR, `${id}.json`);
    await fse.writeJson(filePath, mission, { spaces: 2 });

    console.log(`[API] Mission saved: ${id}`);
    res.json({ id, saved: true });
  } catch (err) {
    console.error('[API] Save error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* -----------------------------------------------------------
   GET /api/missions
   Lists all saved missions.
   Returns array of summary objects.
----------------------------------------------------------- */
router.get('/missions', async (req, res) => {
  try {
    const exists = await fse.pathExists(MISSIONS_DIR);
    if (!exists) {
      return res.json([]);
    }

    const files = await fse.readdir(MISSIONS_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    const summaries = [];

    for (const file of jsonFiles) {
      try {
        const mission = await fse.readJson(path.join(MISSIONS_DIR, file));

        // Count anomalies from detections array
        let anomalyCount = 0;
        if (Array.isArray(mission.detections)) {
          anomalyCount = mission.detections.length;
        }

        summaries.push({
          id:             mission.id || file.replace('.json', ''),
          timestamp:      mission.startTime || null,
          mode:           mission.mode || 'unknown',
          duration:       mission.duration || 0,
          totalDistance:   mission.stats ? mission.stats.totalDistance : 0,
          anomalyCount,
        });
      } catch (parseErr) {
        console.warn(`[API] Skipping corrupt file: ${file}`);
      }
    }

    // Sort newest first
    summaries.sort((a, b) => {
      const ta = a.id || 0;
      const tb = b.id || 0;
      return tb - ta;
    });

    res.json(summaries);
  } catch (err) {
    console.error('[API] List error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* -----------------------------------------------------------
   GET /api/mission/:id
   Returns the full mission JSON.
----------------------------------------------------------- */
router.get('/mission/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const filePath = path.join(MISSIONS_DIR, `${id}.json`);

    const exists = await fse.pathExists(filePath);
    if (!exists) {
      return res.status(404).json({ error: 'Mission not found' });
    }

    const mission = await fse.readJson(filePath);
    res.json(mission);
  } catch (err) {
    console.error('[API] Read error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* -----------------------------------------------------------
   POST /api/mission/export/:id
   Converts mission nodes to CSV and returns as file download.

   Columns: timestamp, x, y, z, mq4, mq135, water, temp,
            hum, lidar, stress, detectedAnomaly
----------------------------------------------------------- */
router.post('/mission/export/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const filePath = path.join(MISSIONS_DIR, `${id}.json`);

    const exists = await fse.pathExists(filePath);
    if (!exists) {
      return res.status(404).json({ error: 'Mission not found' });
    }

    const mission = await fse.readJson(filePath);

    if (!Array.isArray(mission.nodes) || mission.nodes.length === 0) {
      return res.status(400).json({ error: 'Mission has no node data' });
    }

    // Build a lookup of detection events by tick index
    const detectionMap = {};
    if (Array.isArray(mission.detections)) {
      for (const d of mission.detections) {
        if (d.tick !== undefined) {
          detectionMap[d.tick] = d.type || 'anomaly';
        }
      }
    }

    // CSV header
    const header = [
      'timestamp', 'x', 'y', 'z',
      'mq4', 'mq135', 'water', 'temp', 'hum', 'lidar',
      'stress', 'detectedAnomaly'
    ].join(',');

    const rows = [header];

    const startMs = mission.startTime
      ? new Date(mission.startTime).getTime()
      : (mission.id || Date.now());

    for (let i = 0; i < mission.nodes.length; i++) {
      const n = mission.nodes[i];

      // Reconstruct timestamp from tick index (300 ms intervals)
      const ts = new Date(startMs + i * 300).toISOString();

      // Position (may not be stored; use dist + heading to approximate)
      const headingRad = ((n.heading || 0) * Math.PI) / 180;
      const dist = n.dist || 0;
      const x = (dist * Math.sin(headingRad)).toFixed(4);
      const y = ((n.pitch || 0) * 0.04).toFixed(4);
      const z = (dist * Math.cos(headingRad)).toFixed(4);

      const mq4     = (n.mq4     ?? '').toString();
      const mq135   = (n.mq135   ?? '').toString();
      const water   = (n.water   ?? '').toString();
      const temp    = (n.temp    ?? '').toString();
      const hum     = (n.hum     ?? '').toString();
      const lidar   = (n.lidar   ?? '').toString();
      const stress  = (n.stress  ?? 0).toString();
      const anomaly = detectionMap[i] || '';

      rows.push([ts, x, y, z, mq4, mq135, water, temp, hum, lidar, stress, anomaly].join(','));
    }

    const csv = rows.join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="mission_${id}.csv"`);
    res.send(csv);

    console.log(`[API] Exported mission ${id} as CSV (${mission.nodes.length} rows)`);
  } catch (err) {
    console.error('[API] Export error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
