/**
 * PIPE·SENSE v3 — WebSocket Client
 *
 * Connects to ESP32 WebSocket server on port 81.
 * Receives sensor JSON, sends motor commands.
 * Auto-reconnects every 3 seconds on disconnect.
 */

import { sensors  } from './sensors.js';
import { threeMap } from './three-map.js';

/* -------------------------------------------------------
   Helper: Update status pill by id
------------------------------------------------------- */
function setPill(id, state, label) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `pill pill-${state}`;
  el.textContent = label;
}

/* -------------------------------------------------------
   WebSocket client module
------------------------------------------------------- */
export const wsClient = {
  ws:              null,
  ip:              null,
  mode:            null,
  reconnectTimer:  null,
  _reconnecting:   false,

  connect(ip, mode) {
    this.ip   = ip;
    this.mode = mode;

    // Close existing connection cleanly
    if (this.ws) {
      this.ws.onclose = null; // prevent re-trigger
      this.ws.close();
      this.ws = null;
    }

    const url = `ws://${ip}:81`;
    if (typeof window.addLog === 'function') {
      window.addLog('info', `Connecting to ${url}…`);
    }

    try {
      this.ws = new WebSocket(url);
    } catch (err) {
      if (typeof window.addLog === 'function') {
        window.addLog('danger', `WebSocket error: ${err.message}`);
      }
      this._scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      clearTimeout(this.reconnectTimer);
      this._reconnecting = false;

      setPill('pill-esp32', 'ok', 'ESP32');
      document.getElementById('reconnect-banner') &&
        document.getElementById('reconnect-banner').classList.add('hidden');

      if (typeof window.addLog === 'function') {
        window.addLog('success', `Connected to ESP32 @ ${ip}`);
      }
    };

    this.ws.onmessage = (ev) => {
      let packet;
      try {
        packet = JSON.parse(ev.data);
      } catch (e) {
        if (typeof window.addLog === 'function') {
          window.addLog('warn', 'Invalid JSON from ESP32');
        }
        return;
      }

      // Validate required fields
      if (typeof packet.mq4 === 'undefined') return;

      const detections = sensors.processPacket(packet, this.mode);
      threeMap.addNode(packet, detections);

      if (typeof window.updateSensorUI === 'function') {
        window.updateSensorUI(packet);
      }
    };

    this.ws.onclose = (ev) => {
      setPill('pill-esp32', 'danger', 'OFFLINE');

      const banner = document.getElementById('reconnect-banner');
      if (banner) banner.classList.remove('hidden');

      if (typeof window.addLog === 'function') {
        window.addLog('danger', `Disconnected (code ${ev.code}) — retrying in 3s`);
      }

      this._scheduleReconnect();
    };

    this.ws.onerror = (ev) => {
      if (typeof window.addLog === 'function') {
        window.addLog('danger', 'WebSocket error — check ESP32 IP and WiFi');
      }
    };
  },

  sendCommand(cmd, speed = 200) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const payload = JSON.stringify({ cmd, speed });
    this.ws.send(payload);
  },

  reconnect() {
    if (this._reconnecting) return;
    this._reconnecting = true;
    if (typeof window.addLog === 'function') {
      window.addLog('warn', 'Reconnecting to ESP32…');
    }
    this.connect(this.ip, this.mode);
  },

  _scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.reconnect(), 3000);
  },
};
