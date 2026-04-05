/**
 * PIPE·SENSE v3 — Robot Controls
 *
 * Handles D-pad buttons, keyboard, and touch events.
 * Calls sendCommand() which dispatches via wsClient or demoData.
 */

import { wsClient } from './ws-client.js';
import { demoData  } from './demo-data.js';

/* -------------------------------------------------------
   Internal send helper — chooses live or demo
------------------------------------------------------- */
function sendCommand(cmd) {
  const speedEl = document.getElementById('speed-slider');
  const speed   = speedEl ? parseInt(speedEl.value, 10) : 200;

  if (wsClient.ws && wsClient.ws.readyState === WebSocket.OPEN) {
    wsClient.sendCommand(cmd, speed);
  } else {
    demoData.setCmd(cmd);
  }
}

/* -------------------------------------------------------
   Controls module
------------------------------------------------------- */
export const controls = {
  currentCmd: null,
  isMoving:   false,
  _mode:      'sewer',

  init(mode) {
    this._mode = mode;
    this._attachButtons();
    this._attachKeyboard();
    if (typeof window.addLog === 'function') {
      window.addLog('info', 'Controls ready — keyboard: Arrow keys + Space');
    }
  },

  pressBtn(cmd) {
    // Remove pressed state from all buttons
    ['F','B','L','R','S'].forEach(c => {
      const btn = document.getElementById('cb-' + c);
      if (btn) btn.classList.remove('pressed');
    });

    const btn = document.getElementById('cb-' + cmd);
    if (btn) btn.classList.add('pressed');

    this.currentCmd  = cmd;
    this.isMoving    = (cmd !== 'S');
    sendCommand(cmd);
  },

  releaseBtn(cmd) {
    const btn = document.getElementById('cb-' + cmd);
    if (btn) btn.classList.remove('pressed');

    if (cmd !== 'S') {
      // Auto-stop on release
      sendCommand('S');
      this.isMoving   = false;
      this.currentCmd = null;
    }
  },

  _attachButtons() {
    const cmdMap = { F:'F', B:'B', L:'L', R:'R', S:'S' };

    Object.entries(cmdMap).forEach(([id, cmd]) => {
      const el = document.getElementById('cb-' + id);
      if (!el) return;

      // Mouse
      el.addEventListener('mousedown',  (e) => { e.preventDefault(); this.pressBtn(cmd); });
      el.addEventListener('mouseup',    ()  => { this.releaseBtn(cmd); });
      el.addEventListener('mouseleave', ()  => { if (this.currentCmd === cmd) this.releaseBtn(cmd); });

      // Touch
      el.addEventListener('touchstart', (e) => { e.preventDefault(); this.pressBtn(cmd); }, { passive: false });
      el.addEventListener('touchend',   (e) => { e.preventDefault(); this.releaseBtn(cmd); }, { passive: false });
    });
  },

  _attachKeyboard() {
    const keyMap = {
      'ArrowUp':    'F',
      'ArrowDown':  'B',
      'ArrowLeft':  'L',
      'ArrowRight': 'R',
      ' ':          'S',
    };
    const active = {};

    window.addEventListener('keydown', (e) => {
      const cmd = keyMap[e.key];
      if (!cmd) return;
      e.preventDefault();
      if (active[e.key]) return; // prevent repeat
      active[e.key] = true;
      this.pressBtn(cmd);
    });

    window.addEventListener('keyup', (e) => {
      const cmd = keyMap[e.key];
      if (!cmd) return;
      active[e.key] = false;
      // Don't auto-stop on S key up; stop is sticky
      if (cmd !== 'S') {
        this.releaseBtn(cmd);
      } else {
        const btn = document.getElementById('cb-S');
        if (btn) btn.classList.remove('pressed');
      }
    });
  },
};
