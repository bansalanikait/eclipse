/**
 * PIPE·SENSE v3 — Demo Data Generator
 *
 * Simulates an ESP32 sending sensor packets every 300ms.
 * Injects realistic events: gas spikes, blockages, bends,
 * vibration, and pipeline leaks.
 *
 * Packet shape mirrors real ESP32 JSON:
 * { mq4, mq135, water, temp, hum, lidar,
 *   roll, pitch, yaw, vibration, current,
 *   dist, heading }
 */

import { sensors  } from './sensors.js';
import { threeMap } from './three-map.js';
import { controls } from './controls.js';

/* -------------------------------------------------------
   Constants
------------------------------------------------------- */
const SPEED_MPS  = 0.3;     // assumed metres/second for series motors at 5.5V
const TICK_MS    = 300;     // packet interval
const DIST_STEP  = SPEED_MPS * (TICK_MS / 1000); // 0.09 m per tick

/* -------------------------------------------------------
   Demo data module
------------------------------------------------------- */
export const demoData = {
  interval:  null,
  tick:      0,
  mode:      null,

  // Robot pose
  px:        0,
  py:        0,
  pz:        0,
  heading:   0,   // degrees
  dist:      0,

  // IMU state (complementary filter simulation)
  roll:      0,
  pitch:     0,
  yaw:       0,

  // Current active command
  _cmd:      'S',

  // Event injection state
  _gasSpikeTicksLeft:   0,
  _blockageTicksLeft:   0,
  _pipelineLeakActive:  false,
  _leakTicksLeft:       0,

  // Baseline gas for pipeline drop simulation
  _baselineMQ4: 420,

  // Accumulated noise seeds
  _tempBase:   22 + Math.random() * 6,
  _humBase:    55 + Math.random() * 15,

  start(mode) {
    this.mode = mode;
    this.tick = 0;
    this.interval = setInterval(() => this._step(), TICK_MS);
    if (typeof window.addLog === 'function') {
      window.addLog('info', 'Demo data generator started — ' + mode.toUpperCase());
    }
  },

  stop() {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
  },

  /** Called by controls.js to set the current command */
  setCmd(cmd) {
    this._cmd = cmd;
  },

  _step() {
    this.tick++;
    // cmd is used for steering and event injection only
    const cmd = controls.isMoving ? controls.currentCmd : this._cmd;

    // ---- Update heading (steering only) ----
    // Only L/R rotate the robot; robot always advances forward
    if (cmd === 'L') { this.heading -= 3; }
    if (cmd === 'R') { this.heading += 3; }
    this.heading = ((this.heading % 360) + 360) % 360;

    // ---- Always advance position every tick ----
    // Robot is continuously crawling forward through the pipe.
    // Operator steers with L/R; forward motion is constant.
    const rad  = this.heading * Math.PI / 180;
    this.px   += Math.sin(rad) * DIST_STEP;
    this.pz   += Math.cos(rad) * DIST_STEP;
    this.dist += DIST_STEP;
    // Small vertical drift (pipe surface roughness, slope)
    this.py   += (Math.random() - 0.5) * 0.01;

    // ---- IMU simulation ----
    const t = this.tick * 0.08;
    this.roll  = Math.sin(t * 0.7) * 3.5 + (Math.random() - 0.5) * 0.8;
    this.pitch = Math.sin(t * 0.5) * 2.2 + (Math.random() - 0.5) * 0.6;
    if (cmd === 'L') { this.roll -= 4; this.pitch -= 2; }
    if (cmd === 'R') { this.roll += 4; this.pitch += 2; }
    this.yaw = this.heading;

    // ---- Event injection ----
    this._injectEvents(cmd);

    // ---- Build packet ----
    const packet = this._buildPacket(cmd);

    // ---- Process ----
    const detections = sensors.processPacket(packet, this.mode);
    threeMap.addNode(packet, detections);
    if (typeof window.updateSensorUI === 'function') {
      window.updateSensorUI(packet);
    }
  },

  _injectEvents(cmd) {
    // Gas spike (sewer mode) every ~35 ticks randomly
    if (this.mode === 'sewer' && this._gasSpikeTicksLeft === 0) {
      if (Math.random() < (1 / 35)) {
        this._gasSpikeTicksLeft = 3;
        if (typeof window.addLog === 'function')
          window.addLog('warn', 'Gas spike detected — MQ-4 elevated');
      }
    }
    if (this._gasSpikeTicksLeft > 0) this._gasSpikeTicksLeft--;

    // Pipeline gas drop (leak) every ~50 ticks randomly
    if (this.mode === 'pipeline' && !this._pipelineLeakActive) {
      if (Math.random() < (1 / 50)) {
        this._pipelineLeakActive = true;
        this._leakTicksLeft      = 4;
      }
    }
    if (this._leakTicksLeft > 0) {
      this._leakTicksLeft--;
      if (this._leakTicksLeft === 0) this._pipelineLeakActive = false;
    }

    // Blockage every ~50 ticks randomly
    if (this._blockageTicksLeft === 0 && Math.random() < (1 / 50)) {
      this._blockageTicksLeft = 5;
    }
    if (this._blockageTicksLeft > 0) this._blockageTicksLeft--;
  },

  _buildPacket(cmd) {
    // ---- MQ-4 ----
    let mq4 = this._baselineMQ4 + (Math.random() - 0.5) * 40;

    if (this._gasSpikeTicksLeft > 1) {
      // Phase 1 (ticks 3,2): rising spike — robot enters gas pocket
      mq4 *= 3.5;
    } else if (this._gasSpikeTicksLeft === 1) {
      // Phase 2 (tick 1 = last spike tick): sharp drop — gas escapes through the hole.
      // New detectHole catches: peak was >500, now current < peak - 180.
      // Drop to ~25% of baseline so Δ ≈ -1100 ppm — well above the 180 threshold.
      mq4 *= 0.25;
    }
    if (this._pipelineLeakActive) {
      // Pipeline drop: multiply by 0.3
      mq4 *= 0.3;
    }
    mq4 = Math.max(50, mq4);

    // ---- MQ-135 ----
    let mq135 = 80 + Math.random() * 60 + (mq4 > 600 ? 60 : 0);

    // ---- MQ-2 (Smoke/LPG) ----
    // Pipeline: spikes on leak (LPG escaping). Sewer: baseline organic LPG from decomposition.
    let mq2 = 40 + Math.random() * 25;
    if (this.mode === 'pipeline' && this._pipelineLeakActive) {
      mq2 = 250 + Math.random() * 200; // LPG leak: strong MQ-2 spike
    } else if (this.mode === 'sewer' && this._gasSpikeTicksLeft > 1) {
      mq2 = 90 + Math.random() * 60;   // minor LPG alongside methane spike
    }
    mq2 = Math.max(10, Math.min(1000, mq2));

    // ---- Water level (sewer only) ----
    // Blockage event: ramp water up by +3.5%/tick so wTrend exceeds 8% over 5 ticks
    let water = this.mode === 'sewer'
      ? 12 + Math.sin(this.tick * 0.09) * 8 + Math.random() * 5
      : 0;
    if (this._blockageTicksLeft > 0 && this.mode === 'sewer') {
      // Each blockage tick adds to a climbing water level
      const blockProgress = 6 - this._blockageTicksLeft; // 0..5
      water += 8 + blockProgress * 3.5;  // rises from +8% to +25.5%
    }
    water = Math.max(0, Math.min(100, water));

    // ---- Temp & Humidity ----
    const temp = this._tempBase + Math.sin(this.tick * 0.04) * 1.5 + (Math.random() - 0.5) * 0.4;
    const hum  = this._humBase  + Math.sin(this.tick * 0.06) * 5   + (Math.random() - 0.5) * 2;

    // ---- Lidar: pipe bore ----
    let lidar = 55 + Math.sin(this.tick * 0.12) * 8 + (Math.random() - 0.5) * 4;
    if (this._blockageTicksLeft > 0) {
      lidar = 12 + Math.random() * 5; // blockage: very close
    } else if (cmd === 'L' || cmd === 'R') {
      lidar = 20 + Math.random() * 6; // bend: narrows naturally
    }
    lidar = Math.max(4, lidar);

    // ---- Vibration ----
    // Spike on straight sections randomly, or when near events
    let vibration = false;
    if (this._gasSpikeTicksLeft > 0 || this._blockageTicksLeft > 0) {
      vibration = Math.random() < 0.7;
    } else if (cmd === 'F' || cmd === 'B') {
      vibration = Math.random() < 0.07; // occasional on straight
    }

    // ---- Current ----
    // Always drawing current since robot is always moving
    let current = 1.2 + Math.random() * 0.4;
    if (this._blockageTicksLeft > 0) current += 0.6; // strain on motor

    return {
      mq4:       parseFloat(mq4.toFixed(1)),
      mq135:     parseFloat(mq135.toFixed(1)),
      mq2:       parseFloat(mq2.toFixed(1)),
      water:     parseFloat(water.toFixed(1)),
      temp:      parseFloat(temp.toFixed(1)),
      hum:       parseFloat(hum.toFixed(1)),
      lidar:     parseFloat(lidar.toFixed(1)),
      roll:      parseFloat(this.roll.toFixed(2)),
      pitch:     parseFloat(this.pitch.toFixed(2)),
      yaw:       parseFloat(this.yaw.toFixed(2)),
      vibration,
      current:   parseFloat(current.toFixed(2)),
      dist:      parseFloat(this.dist.toFixed(3)),
      heading:   parseFloat(this.heading.toFixed(1)),
      // Pre-computed world position consumed by three-map.js
      _x:        this.px,
      _y:        this.py,
      _z:        this.pz,
    };
  },
};
