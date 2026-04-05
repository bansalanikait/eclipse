/**
 * PIPE·SENSE v3 — Sensor Processing & Anomaly Detection
 *
 * Physics-correct detection algorithms for sewer and
 * gas pipeline inspection.
 *
 * Robot context:
 *   Speed ≈ 0.3 m/s (series-wired motors at 5.5V)
 *   Pipe diameter 100–200 mm typical
 *   Packet every 300 ms ≈ 0.09 m per reading while moving
 *
 * Sensors: MQ-4 (ppm), MQ-135 (AQI), water (%),
 *   temp (°C), hum (%), lidar (cm),
 *   roll/pitch/yaw (°), vibration (bool),
 *   current (A), dist (m), heading (°)
 */

/* =======================================================
   HELPER FUNCTIONS
   ======================================================= */

/**
 * Compute the median of a numeric array.
 * Returns NaN for empty arrays.
 * Filters out NaN/null/undefined before computing.
 */
function median(arr) {
  const clean = arr.filter(v => v !== null && v !== undefined && !isNaN(v));
  if (clean.length === 0) return NaN;
  const sorted = clean.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Compute the sample standard deviation of a numeric array.
 * Returns 0 for arrays with fewer than 2 clean values.
 */
function stddev(arr) {
  const clean = arr.filter(v => v !== null && v !== undefined && !isNaN(v));
  if (clean.length < 2) return 0;
  const mean = clean.reduce((s, v) => s + v, 0) / clean.length;
  const variance = clean.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (clean.length - 1);
  return Math.sqrt(variance);
}

/**
 * Compute the slope of a least-squares linear regression
 * for an array of values (x = 0, 1, 2, ..., n-1).
 *
 *   slope = Σ((xi - x̄)(yi - ȳ)) / Σ((xi - x̄)²)
 *
 * Returns 0 for arrays with fewer than 2 values.
 */
function linearRegressionSlope(arr) {
  const clean = arr.filter(v => v !== null && v !== undefined && !isNaN(v));
  const n = clean.length;
  if (n < 2) return 0;

  const xMean = (n - 1) / 2;
  const yMean = clean.reduce((s, v) => s + v, 0) / n;

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - xMean;
    numerator += dx * (clean[i] - yMean);
    denominator += dx * dx;
  }

  return denominator === 0 ? 0 : numerator / denominator;
}

/* =======================================================
   DETECTION FUNCTIONS
   ======================================================= */

/**
 * FUNCTION 1 — detectHole
 *
 * SEWER mode:
 *   Gas spike detection. A structural hole in the sewer wall
 *   releases trapped methane from the soil behind the pipe.
 *   We detect a sudden spike in MQ-4 above baseline, confirmed
 *   by MQ-135 (general VOCs from decaying organic matter).
 *
 * PIPELINE mode:
 *   Gas leak detection via concentration DROP. Inside a
 *   pressurised gas pipeline the ambient CH₄ is high.
 *   A leak causes gas to escape outward, so the robot sees
 *   a sudden decrease in MQ-4 downstream of the leak point.
 *
 * @param {Array} history  Circular buffer, last 20 packets
 * @param {string} mode    'sewer' | 'pipeline'
 * @returns {{ detected: boolean, confidence: number, details: string }}
 */
function detectHole(history, mode) {
  if (history.length < 5) {
    return { detected: false, confidence: 0, details: 'insufficient data' };
  }

  const mq4Values = history.map(p => p.mq4);
  const baseline = median(mq4Values);

  if (isNaN(baseline) || baseline <= 0) {
    return { detected: false, confidence: 0, details: 'no valid MQ-4 baseline' };
  }

  const currentMq4 = history[history.length - 1].mq4;
  const prevMq4    = history[history.length - 2].mq4;

  if (mode === 'sewer') {
    // ---- SEWER: gas peaked then dropped sharply through a hole ----
    //
    // Physics: robot enters a pocket of trapped sewer gas — MQ-4 spikes.
    // If there is a hole in the pipe wall, gas escapes outward and MQ-4
    // drops sharply in the next 1-3 readings. The DROP after the spike
    // is the hole signature, not the spike itself.
    // Reference logic: peak > 500 ppm AND current drop > 180 ppm/tick
    const delta    = currentMq4 - prevMq4;
    const last6    = mq4Values.slice(-6);
    const mq4Peak  = Math.max(...last6.filter(v => !isNaN(v)));
    const peakHigh  = mq4Peak > 500;
    const sharpDrop = delta < -180;

    let confidence = 0;
    if (peakHigh && sharpDrop) {
      confidence = 0.85;
    } else if (peakHigh && delta < -80) {
      confidence = 0.5;
    } else if (sharpDrop && currentMq4 < baseline * 0.6) {
      confidence = 0.4;
    }

    // Cross-validate: MQ-135 elevated during gas escape
    const mq135Values   = history.map(p => p.mq135);
    const mq135Baseline = median(mq135Values);
    const currentMq135  = history[history.length - 1].mq135;
    if (!isNaN(mq135Baseline) && mq135Baseline > 0 &&
        currentMq135 > mq135Baseline * 1.5 && confidence >= 0.85) {
      confidence = Math.min(1.0, confidence + 0.15);
    }

    return {
      detected: confidence >= 0.75,
      confidence,
      dGas:    delta,
      mq4Peak,
      details: `Peak ${mq4Peak.toFixed(0)}ppm → ${currentMq4.toFixed(0)}ppm (Δ${delta.toFixed(0)})`
    };

  } else {
    // ---- PIPELINE: gas DROP from high baseline (pressurised pipe leaks outward) ----
    const delta        = currentMq4 - prevMq4;
    const dropDetected = currentMq4 < baseline * 0.45;
    const wasAbove     = prevMq4 > baseline;
    const suddenDrop   = (prevMq4 - currentMq4) > 100;

    let confidence = 0;
    if (dropDetected && wasAbove) confidence += 0.6;
    if (suddenDrop)               confidence += 0.4;

    return {
      detected: confidence >= 0.6,
      confidence,
      dGas:    delta,
      mq4Peak: currentMq4,
      details: `MQ4 dropped to ${currentMq4.toFixed(0)}ppm from baseline ${baseline.toFixed(0)}ppm`
    };
  }
}

/**
 * FUNCTION 2 — detectBlockage
 *
 * A blockage (collapsed wall section, root intrusion, debris)
 * causes the lidar distance to drop persistently while the
 * robot is travelling straight (no yaw change). Rising water
 * level upstream of the blockage provides additional evidence.
 *
 * We require water rising trend as primary, lidar low as secondary confirmation.
 *
 * @param {Array} history  Circular buffer, last 20 packets
 * @returns {{ detected: boolean, confidence: number, details: string }}
 */
function detectBlockage(history) {
  if (history.length < 5) {
    return { detected: false, confidence: 0, details: 'insufficient data' };
  }

  const lastFive      = history.slice(-5);
  const lastFiveLidar = lastFive.map(p => p.lidar);
  const lastFiveWater = lastFive.map(p => p.water);

  // PRIMARY: water level rising trend over 5 ticks
  // A blockage backs up water upstream. Water rise > 8% across 5 readings
  // with absolute level > 40% is the definitive signature.
  const wTrend  = lastFiveWater.length >= 4
    ? lastFiveWater[lastFiveWater.length - 1] - lastFiveWater[0]
    : 0;
  const currentWater = lastFiveWater[lastFiveWater.length - 1];
  const waterRising  = wTrend > 8 && currentWater > 40;

  // Without rising water there is no blockage — just narrowing pipe geometry
  if (!waterRising) {
    return {
      detected: false,
      confidence: 0,
      details: `Water ${currentWater.toFixed(0)}%, trend Δ${wTrend.toFixed(1)}%`
    };
  }

  // SECONDARY: lidar sees obstruction (narrows the pipe ahead)
  const lidarLow    = lastFiveLidar.filter(v => v !== null && !isNaN(v) && v < 20).length;
  const lidarBlocks = lidarLow >= 3;

  let confidence = 0.75;  // waterRising alone is strong
  if (lidarBlocks) confidence = Math.min(1.0, confidence + 0.25); // lidar confirms

  const latestLidar = lastFiveLidar[lastFiveLidar.length - 1];

  return {
    detected: true,
    confidence,
    details: `Water +${wTrend.toFixed(1)}% (${currentWater.toFixed(0)}%), lidar ${(latestLidar||0).toFixed(0)}cm`
  };
}

/**
 * FUNCTION 3 — detectBend
 *
 * A pipe bend is detected when the robot is actively turning
 * (high yaw σ) while the lidar distance narrows (the sensor
 * sees the inner wall of the bend closer).
 *
 * Once a bend is identified we compute the bend angle (sum of
 * absolute yaw deltas over the last 3 readings) and the
 * approximate bend radius using arc-length geometry:
 *
 *   arcLength = 3 readings × 0.09 m/reading = 0.27 m
 *   θ (rad)   = bendAngle × π / 180
 *   radius    = arcLength / θ        (for θ > 0.01 rad)
 *
 * @param {Array} history  Circular buffer, last 20 packets
 * @returns {{ detected: boolean, confidence: number, bendAngle: number, radius: number, details: string }}
 */
function detectBend(history) {
  if (history.length < 5) {
    return { detected: false, confidence: 0, bendAngle: 0, radius: 999, details: 'insufficient data' };
  }

  const lastFive      = history.slice(-5);
  const lastFiveLidar = lastFive.map(p => p.lidar);
  const lastFiveYaw   = lastFive.map(p => p.yaw);

  // Lidar narrowing: at least 2 of 5 readings below 25 cm
  const lidarLowCount = lastFiveLidar.filter(v => v !== null && !isNaN(v) && v < 25).length;
  const lidarLow      = lidarLowCount >= 2;

  // Yaw variation indicates turning
  const yawStd  = stddev(lastFiveYaw);
  const turning = yawStd > 8.0;

  // Bend angle: sum of absolute yaw deltas over last 3 readings
  const lastThreeYaw = lastFiveYaw.slice(-3);
  let bendAngle = 0;
  for (let i = 1; i < lastThreeYaw.length; i++) {
    let delta = Math.abs(lastThreeYaw[i] - lastThreeYaw[i - 1]);
    if (delta > 180) delta = 360 - delta;
    bendAngle += delta;
  }

  // Bend radius from arc-length geometry
  const arcLength    = 3 * 0.09;
  const bendAngleRad = bendAngle * Math.PI / 180;
  const radius       = bendAngleRad > 0.01 ? arcLength / bendAngleRad : 999;

  // BOTH conditions required — not turning means no bend, regardless of lidar
  if (!lidarLow || !turning) {
    return {
      detected: false,
      confidence: 0,
      bendAngle,
      radius,
      details: `Bend ${bendAngle.toFixed(1)}° radius ${radius.toFixed(2)}m (not confirmed)`
    };
  }

  return {
    detected: true,
    confidence: 1.0,
    bendAngle,
    radius,
    details: `Bend ${bendAngle.toFixed(1)}° radius ${radius.toFixed(2)}m`
  };
}

/**
 * FUNCTION 4 — estimateStress
 *
 * Estimates the bending stress in the pipe wall using
 * Euler–Bernoulli beam theory:
 *
 *   σ_bend = E · r / R
 *
 * where:
 *   E = Young's modulus (steel 200 GPa, PVC 3 GPa)
 *   r = pipe outer radius (0.05 m for 100 mm pipe)
 *   R = bend radius from detectBend()
 *
 * Additional multipliers account for dynamic loading
 * (vibration on a straight section signals external
 * impact or soil settlement, not bend vibration)
 * and motor current draw (high current on straight =
 * friction from deformation or debris).
 *
 * @param {Object} packet      Latest sensor packet
 * @param {Array}  history     Circular buffer, last 20 packets
 * @param {Object} bendResult  Return value of detectBend()
 * @param {string} pipeType    'steel' | 'pvc'
 * @returns {{ stressMPa: number, confidence: number, method: string, warning: boolean }}
 */
function estimateStress(packet, history, bendResult, pipeType) {
  if (!pipeType) pipeType = 'steel';

  // Material properties
  const E = pipeType === 'steel' ? 200000 : 3000; // MPa
  const r = 0.05; // pipe outer radius in metres

  // Bend radius
  const R = bendResult.detected ? bendResult.radius : 999;

  // Bending stress σ = E·r / R (only meaningful if R < ~900)
  const sigmaBend = R < 900 ? (E * r / R) : 0;

  // Baseline current from first 10 readings (or all available)
  const currentValues   = history.slice(0, Math.min(10, history.length)).map(p => p.current);
  const baselineCurrent = median(currentValues);
  const currentRatio    = (!isNaN(baselineCurrent) && baselineCurrent > 0)
    ? packet.current / baselineCurrent
    : 1.0;

  // Is the robot travelling straight?
  const lastFiveYaw = history.slice(-5).map(p => p.yaw);
  const yawStd      = stddev(lastFiveYaw);
  const isStraight  = yawStd < 3.0;

  // Dynamic loading multiplier
  let multiplier = 1.0;
  if ((packet.vibration === true || packet.vibration === 1) && isStraight) {
    // Vibration on a straight section → external force
    multiplier *= 1.4;
  }
  if (currentRatio > 1.35 && isStraight) {
    // High motor current on straight → friction from deformation
    multiplier *= 1.25;
  }

  const stressMPa = Math.min(500, sigmaBend * multiplier);

  const criticalThreshold = pipeType === 'steel' ? 250 : 80;

  return {
    stressMPa,
    confidence: bendResult.confidence,
    method: bendResult.detected ? 'curvature+sensors' : 'sensors-only',
    warning: stressMPa > criticalThreshold
  };
}

/**
 * FUNCTION 5 — detectCorrosion
 *
 * Corrosion risk increases with sustained high temperature
 * and humidity inside the pipe. We count how many consecutive
 * readings (from newest to oldest) exceed the thresholds.
 *
 * At 300 ms per reading:
 *   20 readings =  6 seconds (full buffer)
 *   10 readings =  3 seconds
 *    5 readings = 1.5 seconds
 *
 * @param {Object} packet   Latest sensor packet
 * @param {Array}  history  Circular buffer, last 20 packets
 * @returns {{ risk: number, sustainedReadings: number, details: string }}
 */
function detectCorrosion(packet, history) {
  let sustainedCount = 0;

  // Walk from newest to oldest; break at first non-qualifying reading
  for (let i = history.length - 1; i >= 0; i--) {
    const p = history[i];
    if (p.hum > 85 && p.temp > 35) {
      sustainedCount++;
    } else {
      break;
    }
  }

  let risk = 0;
  if      (sustainedCount >= 20) risk = 0.9;
  else if (sustainedCount >= 10) risk = 0.6;
  else if (sustainedCount >= 5)  risk = 0.3;

  return {
    risk,
    sustainedReadings: sustainedCount,
    details: `${sustainedCount} consecutive high temp+humidity readings`
  };
}

/**
 * FUNCTION 6 — getNodeColor
 *
 * Returns a THREE.Color for the 3D map node, using a strict
 * priority order so the most critical detection wins.
 *
 * Priority (highest → lowest):
 *   1. Hole/leak with high confidence  → red (#ff2244) or white (#ffffff pipeline)
 *   2. Blockage                         → blue (#2196f3)
 *   3. Stress > 250 MPa                → purple (#9c27b0)
 *   4. Bend                            → yellow (#ffff00)
 *   5. Corrosion risk > 0.5            → orange (#ff8c00)
 *   6. Default                         → green (#00ff9d)
 */
function getNodeColor(detections, mode) {
  // Priority 1: hole / leak
  if (detections.hole && detections.hole.detected && detections.hole.confidence > 0.7) {
    return new THREE.Color(mode === 'pipeline' ? 0xffffff : 0xff2244);
  }

  // Priority 2: blockage
  if (detections.blockage && detections.blockage.detected) {
    return new THREE.Color(0x2196f3);
  }

  // Priority 3: high stress
  if (detections.stress && detections.stress.stressMPa > 250) {
    return new THREE.Color(0x9c27b0);
  }

  // Priority 4: bend
  if (detections.bend && detections.bend.detected) {
    return new THREE.Color(0xffff00);
  }

  // Priority 5: corrosion
  if (detections.corrosion && detections.corrosion.risk > 0.5) {
    return new THREE.Color(0xff8c00);
  }

  // Default: safe
  return new THREE.Color(0x00ff9d);
}

/* =======================================================
   EXPORTED MODULE
   ======================================================= */

const MAX_HISTORY    = 20;
const BASELINE_COUNT = 10;

export const sensors = {
  history:  [],
  baseline: {},

  /**
   * Main entry point — called once per packet.
   *
   * Manages the history ring buffer, computes the baseline
   * from the first 10 packets, runs every detection function,
   * and returns a unified detections object.
   *
   * @param {Object} packet  Sensor JSON from ESP32 or demo
   * @param {string} mode    'sewer' | 'pipeline'
   * @returns {Object} detections
   */
  processPacket(packet, mode) {
    // Push to history, keep last 20
    this.history.push(packet);
    if (this.history.length > MAX_HISTORY) {
      this.history.shift();
    }

    // Build baseline from first BASELINE_COUNT packets — set once, never recalculate
    if (this.history.length === BASELINE_COUNT && !this._baselineLocked) {
      this._computeBaseline();
      this._baselineLocked = true;
    }

    // Do NOT run any detection until we have enough data for a meaningful baseline.
    // Early packets are used to establish normal conditions only.
    if (this.history.length < 8) {
      return {
        hole:      { detected: false, confidence: 0 },
        blockage:  { detected: false, confidence: 0 },
        bend:      { detected: false, confidence: 0, bendAngle: 0, radius: 999 },
        stress:    { stressMPa: 0, warning: false, method: 'sensors-only', confidence: 0 },
        corrosion: { risk: 0, sustainedReadings: 0 },
        stressMPa:      0,
        leakConfidence: 0,
        mq4Drop:        0,
        nodeColor: new THREE.Color(0x00ff9d),
      };
    }

    // Run all detections
    const holeResult      = detectHole(this.history, mode);
    const blockageResult  = detectBlockage(this.history);
    const bendResult      = detectBend(this.history);
    const stressResult    = estimateStress(packet, this.history, bendResult, 'steel');
    const corrosionResult = detectCorrosion(packet, this.history);

    const detections = {
      hole:      holeResult,
      blockage:  blockageResult,
      bend:      bendResult,
      stress:    stressResult,
      corrosion: corrosionResult,

      // Flat aliases used by the dashboard HTML inline scripts
      stressMPa:      stressResult.stressMPa,
      leakConfidence: mode === 'pipeline' ? holeResult.confidence * 100 : 0,
      mq4Drop:        0,
    };

    // Compute MQ-4 drop for pipeline mode display
    if (mode === 'pipeline' && this.baseline.mq4 && this.baseline.mq4 > 0) {
      detections.mq4Drop = Math.max(0, this.baseline.mq4 - packet.mq4);
    }

    // Node colour for the 3D map
    detections.nodeColor = getNodeColor(detections, mode);

    // Notify the page
    if (typeof window.handleDetections === 'function') {
      window.handleDetections(detections, packet);
    }

    return detections;
  },

  /**
   * Compute baseline medians from the current history.
   * Called only during the first BASELINE_COUNT packets.
   */
  _computeBaseline() {
    const h = this.history;
    if (!h.length) return;
    const keys = ['mq4', 'mq135', 'water', 'temp', 'hum', 'lidar', 'current'];
    keys.forEach(k => {
      const vals = h.map(p => p[k]).filter(v => v !== null && v !== undefined && !isNaN(v));
      if (vals.length) {
        this.baseline[k] = median(vals);
      }
    });
  },

  /**
   * Exposed so three-map.js can colour nodes.
   */
  getNodeColor(detections, mode) {
    return getNodeColor(detections, mode);
  },
};
