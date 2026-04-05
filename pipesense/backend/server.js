/**
 * PIPE·SENSE v3 — Backend Server
 *
 * - Express serves frontend/ as static files on port 3000
 * - WebSocket proxy: browser → this server → ESP32 ws://ESP_IP:81
 *   (solves CORS issues when running the dashboard from localhost)
 * - REST API for mission save/load/export (see api.js)
 *
 * Environment variables:
 *   PORT        Server port        (default 3000)
 *   ESP_IP      ESP32 IP address   (optional, enables WS proxy)
 *   ESP_PORT    ESP32 WS port      (default 81)
 */

const express    = require('express');
const http       = require('http');
const path       = require('path');
const cors       = require('cors');
const WebSocket  = require('ws');
const apiRouter  = require('./api');

/* -----------------------------------------------------------
   Configuration
----------------------------------------------------------- */
const PORT     = process.env.PORT     || 3000;
const ESP_IP   = process.env.ESP_IP   || null;
const ESP_PORT = process.env.ESP_PORT || 81;

/* -----------------------------------------------------------
   Express app
----------------------------------------------------------- */
const app    = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Serve frontend static files
const frontendDir = path.join(__dirname, '..', 'frontend');
app.use(express.static(frontendDir));
console.log(`[Server] Serving static files from: ${frontendDir}`);

// Mount API routes
app.use('/api', apiRouter);

// Fallback: serve index.html for any unknown route
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDir, 'index.html'));
});

/* -----------------------------------------------------------
   WebSocket proxy (optional)

   When ESP_IP is set, the server creates a WS server on the
   same HTTP port. Browser clients connect to ws://localhost:3000.
   The server proxies messages bidirectionally to the ESP32.

   This avoids browser mixed-content/CORS issues when the
   dashboard is served from localhost but the ESP32 is on
   the local network.
----------------------------------------------------------- */
const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', (clientWs, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`[WS] Browser connected: ${clientIp}`);

  if (!ESP_IP) {
    // No ESP32 configured — operate in echo/passthrough mode
    console.log('[WS] No ESP_IP set — proxy disabled. Browser will connect directly to ESP32.');
    clientWs.on('message', (msg) => {
      console.log(`[WS] Client message (no proxy): ${msg}`);
    });
    clientWs.on('close', () => {
      console.log(`[WS] Browser disconnected: ${clientIp}`);
    });
    return;
  }

  // Connect to ESP32
  const espUrl = `ws://${ESP_IP}:${ESP_PORT}`;
  console.log(`[WS] Proxying to ESP32 at ${espUrl}`);

  let espWs;
  try {
    espWs = new WebSocket(espUrl);
  } catch (err) {
    console.error(`[WS] Failed to connect to ESP32: ${err.message}`);
    clientWs.send(JSON.stringify({ error: 'ESP32 connection failed', details: err.message }));
    clientWs.close();
    return;
  }

  let espConnected = false;

  espWs.on('open', () => {
    espConnected = true;
    console.log(`[WS] Connected to ESP32 @ ${ESP_IP}:${ESP_PORT}`);
    // Notify browser
    clientWs.send(JSON.stringify({ _proxy: true, status: 'connected', esp: ESP_IP }));
  });

  // ESP32 → Browser
  espWs.on('message', (data) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data);
    }
  });

  // Browser → ESP32
  clientWs.on('message', (msg) => {
    if (espConnected && espWs.readyState === WebSocket.OPEN) {
      espWs.send(msg);
    }
  });

  // Handle ESP32 disconnect
  espWs.on('close', (code, reason) => {
    console.log(`[WS] ESP32 disconnected (code ${code})`);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ _proxy: true, status: 'esp32_disconnected', code }));
    }
    // Attempt to reconnect after 3 seconds
    setTimeout(() => {
      if (clientWs.readyState === WebSocket.OPEN) {
        console.log('[WS] Attempting ESP32 reconnect...');
        try {
          const newEsp = new WebSocket(espUrl);
          newEsp.on('open', () => {
            espConnected = true;
            console.log('[WS] Reconnected to ESP32');
            clientWs.send(JSON.stringify({ _proxy: true, status: 'reconnected' }));
            // Rebind message forwarding
            newEsp.on('message', (data) => {
              if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
            });
          });
          newEsp.on('error', (e) => {
            console.error('[WS] Reconnect failed:', e.message);
          });
        } catch (e) {
          console.error('[WS] Reconnect error:', e.message);
        }
      }
    }, 3000);
  });

  espWs.on('error', (err) => {
    console.error(`[WS] ESP32 error: ${err.message}`);
  });

  // Handle browser disconnect
  clientWs.on('close', () => {
    console.log(`[WS] Browser disconnected: ${clientIp}`);
    if (espWs && espWs.readyState === WebSocket.OPEN) {
      // Send stop command to ESP32 for safety
      espWs.send(JSON.stringify({ cmd: 'S', speed: 0 }));
      espWs.close();
    }
  });

  clientWs.on('error', (err) => {
    console.error(`[WS] Browser error: ${err.message}`);
  });
});

/* -----------------------------------------------------------
   Start server
----------------------------------------------------------- */
server.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║       PIPE·SENSE v3  SERVER          ║');
  console.log('  ╠══════════════════════════════════════╣');
  console.log(`  ║  Dashboard : http://localhost:${PORT}    ║`);
  if (ESP_IP) {
    console.log(`  ║  ESP32     : ws://${ESP_IP}:${ESP_PORT}       ║`);
    console.log(`  ║  WS Proxy  : ws://localhost:${PORT}/ws  ║`);
  } else {
    console.log('  ║  ESP32     : (direct from browser)   ║');
    console.log('  ║  WS Proxy  : disabled (set ESP_IP)   ║');
  }
  console.log('  ║  API       : /api/missions            ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
});
