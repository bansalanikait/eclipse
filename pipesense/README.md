<div align="center">

# 🔵 PIPE·SENSE v3

**AI-assisted sewer & gas pipeline inspection robot dashboard**

[![ESP32](https://img.shields.io/badge/MCU-ESP32%20DOIT%20DevKit%20V1-blue?logo=espressif)](https://www.espressif.com/)
[![Three.js](https://img.shields.io/badge/3D-Three.js%20r128-black?logo=threedotjs)](https://threejs.org/)
[![Node.js](https://img.shields.io/badge/Backend-Node.js-green?logo=nodedotjs)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

*Real-time 3D mapping · Physics-based anomaly detection · WebSocket telemetry · Mission export*

</div>

---

## 📖 Overview

PIPE·SENSE v3 is a complete inspection robot system for **sewer** and **gas pipeline** environments. A differential-drive robot equipped with gas, environmental, and structural sensors crawls through pipes and streams live telemetry to a browser-based dashboard that builds a real-time 3D map of the pipe interior, detects anomalies using physics-correct algorithms, and logs mission data for export.

The system runs fully in **demo mode** (no hardware needed) or connects live to an **ESP32** robot over WebSocket.

---

## ✨ Features

| Feature | Details |
|---|---|
| **Live 3D pipe map** | Three.js hollow pipe segments coloured by gas level, pipe tension, or wireframe |
| **Anomaly detection** | Hole/leak, blockage, bend detection with confidence scores |
| **Stress estimation** | Euler–Bernoulli beam theory (σ = E·r/R) with sensor multipliers |
| **Corrosion risk** | Consecutive high temp + humidity scoring |
| **Dead-reckoning** | Pose updated 0.09 m/tick from IMU heading |
| **Gas particle FX** | Floating particles coloured by MQ-4 concentration |
| **Demo mode** | Realistic simulation with event injection (spikes, leaks, blockages, bends) |
| **Live mode** | Direct WebSocket to ESP32 or proxied through Node.js server |
| **Mission save/load** | Full JSON persistence via REST API |
| **CSV export** | All nodes, timestamps, sensor values, and detected anomalies |
| **WebSocket proxy** | Server bridges browser → ESP32 (solves CORS / mixed-content issues) |
| **Responsive UI** | Orbitron + Rajdhani fonts, dark industrial aesthetic, scanline overlay |

---

## 🖼️ Screenshots

> Open **`frontend/index.html`** via the local server to see the live dashboard.

```
Landing Page → Select Sewer or Pipeline mode
Sewer Dashboard → 3D map, gas sensors, D-pad controls, stress gauge, event log
Pipeline Dashboard → Methane leak detection, concentration drop analysis
```

---

## 🔧 Hardware

### Robot Platform

| Component | Spec |
|---|---|
| **MCU** | ESP32 DOIT DevKit V1 (38-pin) |
| **Motor driver** | L298N dual H-bridge |
| **Drive** | 4× DC motors wired in series pairs |
| **Decoupling** | 1000 µF / 10 V capacitor across ESP32 5V + GND |
| **Protection** | Flyback diodes across all motor terminals |

### Motor Wiring

```
Channel A (Left)  — IN1=GPIO25, IN2=GPIO26, ENA=GPIO14
  OUT1 → Motor FL+ → Motor FL- → Motor RL+ → Motor RL- → OUT2

Channel B (Right) — IN3=GPIO27, IN4=GPIO33, ENB=GPIO12
  OUT3 → Motor FR+ → Motor FR- → Motor RR+ → Motor RR- → OUT4

Default PWM: 200/255 (~78% duty)
Speed at 5.5 V series wiring: ≈ 0.3 m/s
```

### Sensor Pin Map

| Sensor | Type | GPIO |
|---|---|---|
| DHT22 | Temp + Humidity | 13 |
| MQ-4 | Methane (ppm) | 34 (ADC) |
| MQ-135 | Air quality (AQI) | 35 (ADC) |
| Water level | Analog % | 39 (ADC) |
| ACS712 | Current (A) | 36 (ADC) |
| SW-420 | Vibration (digital) | 18 |
| VL53L0X | Lidar distance (cm) | I2C SDA=21, SCL=22 |
| MPU-6050 | IMU roll/pitch/yaw | I2C SDA=21, SCL=22 |

---

## 📁 Project Structure

```
pipesense/
├── esp32/                      # Arduino firmware (upload as a sketch folder)
│   ├── main.ino                # Setup, loop, sensor init, WebSocket broadcast
│   ├── sensors.ino             # DHT22, MQ-4, MQ-135, water, ACS712, VL53L0X, MPU-6050
│   ├── motor_control.ino       # L298N PWM control, command handler (F/B/L/R/S)
│   └── wifi_ws.ino             # WiFi connection, WebSocket server on port 81
│
├── frontend/                   # Static web dashboard (ES modules)
│   ├── index.html              # Landing page — mode selection
│   ├── sewer.html              # Sewer inspection dashboard
│   ├── pipeline.html           # Gas pipeline dashboard
│   ├── css/
│   │   ├── base.css            # CSS variables, fonts, scanline overlay, reset
│   │   ├── dashboard.css       # Grid layout, sensor panels, D-pad, gauge
│   │   └── map3d.css           # Canvas overlays, anomaly badges, landing cards
│   └── js/
│       ├── three-map.js        # Three.js 3D pipe map, particles, anomaly markers
│       ├── sensors.js          # Physics-based anomaly detection algorithms
│       ├── controls.js         # D-pad, keyboard (arrows), touch events
│       ├── demo-data.js        # Simulated telemetry with event injection
│       └── ws-client.js        # WebSocket client with auto-reconnect
│
└── backend/                    # Node.js server
    ├── server.js               # Express static server + WebSocket proxy
    ├── api.js                  # REST API: mission save/list/get/export
    ├── package.json
    └── missions/               # Auto-created — saved mission JSON files
```

---

## 🚀 Quick Start

### Option A — Demo mode (no hardware)

```bash
# 1. Install backend dependencies
cd pipesense/backend
npm install

# 2. Start the server
npm start

# 3. Open the dashboard
# Navigate to http://localhost:3000
# Click ▶ DEMO on either mode card
```

### Option B — Live ESP32 mode

```bash
# 1. Flash the firmware
#    Open pipesense/esp32/ as an Arduino sketch folder
#    Install required libraries (see below)
#    Set your WiFi credentials in wifi_ws.ino
#    Upload to ESP32 DOIT DevKit V1

# 2. Start backend server
cd pipesense/backend
npm install
npm start

# 3. Open dashboard → click ⚡ LIVE → enter ESP32 IP address

# Optional: proxy mode (avoids CORS issues)
ESP_IP=192.168.1.100 npm start
# Then in the dashboard, connect to ws://localhost:3000/ws
```

---

## 📚 Required Arduino Libraries

Install via **Arduino IDE → Library Manager**:

| Library | Purpose |
|---|---|
| `DHT sensor library` (Adafruit) | DHT22 temperature + humidity |
| `Adafruit Unified Sensor` | DHT dependency |
| `Adafruit VL53L0X` | Lidar distance sensor |
| `MPU6050` (Electronic Cats) | IMU roll/pitch/yaw |
| `ArduinoJson` | JSON packet serialisation |
| `WebSockets` (Markus Sattler) | WebSocket server on port 81 |

Also set the board to: **Tools → Board → ESP32 Dev Module**

---

## 📡 WebSocket Protocol

### ESP32 → Browser (JSON, every 300 ms)

```json
{
  "mq4":       425.0,
  "mq135":     96.4,
  "water":     19.9,
  "temp":      25.0,
  "hum":       63.1,
  "lidar":     59.7,
  "roll":      3.4,
  "pitch":     1.4,
  "yaw":       0.0,
  "vibration": false,
  "current":   1.14,
  "dist":      0.63,
  "heading":   0.0
}
```

### Browser → ESP32 (motor command)

```json
{ "cmd": "F", "speed": 200 }
```

| `cmd` | Action |
|---|---|
| `F` | Forward |
| `B` | Backward |
| `L` | Turn left |
| `R` | Turn right |
| `S` | Stop |

`speed` is a PWM value 0–255 (default 200).

---

## 🧠 Anomaly Detection Algorithms

All logic lives in `frontend/js/sensors.js`. Detection only runs after **8+ packets** are collected and a **10-packet median baseline** is established.

### Hole Detection (Sewer)
Requires **both** conditions simultaneously:
- MQ-4 > baseline × 2.2  (methane spike from soil behind pipe wall)
- Δ MQ-4 > 80 ppm/tick   (rapid rate-of-change)

Cross-validated with MQ-135 elevation (+0.25 confidence if AQI also spikes).

### Leak Detection (Pipeline)
- MQ-4 drops below baseline × 0.45 AND the previous reading was above baseline
- OR sudden drop > 100 ppm between consecutive readings

### Blockage Detection
- Lidar < 20 cm for **3+ of last 5 readings**
- AND yaw standard deviation < 3° (robot travelling straight)
- Bonus: water level regression slope > 2.0 %/reading upstream

### Bend Detection
- Lidar < 25 cm for 2+ of last 5 readings
- AND yaw standard deviation > 8° (active turning)
- Computes bend radius: `R = arcLength / θ` (arc-length geometry)

### Pipe Stress (Euler–Bernoulli)
```
σ = E · r / R
```
- `E` = 200,000 MPa (steel) or 3,000 MPa (PVC)
- `r` = 0.05 m (pipe outer radius)
- `R` = bend radius from bend detection
- Multiplier ×1.4 if vibration on straight section
- Multiplier ×1.25 if current ratio > 1.35 on straight section
- Critical threshold: 250 MPa (steel), 80 MPa (PVC)

### Corrosion Risk
Counts consecutive readings where `humidity > 85%` AND `temp > 35°C`:
- ≥ 20 consecutive → risk 0.9
- ≥ 10 consecutive → risk 0.6
- ≥ 5 consecutive  → risk 0.3

---

## 🌐 REST API

Base URL: `http://localhost:3000/api`

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/mission/save` | Save mission JSON → `missions/{id}.json` |
| `GET` | `/missions` | List all missions (summary) |
| `GET` | `/mission/:id` | Get full mission JSON |
| `POST` | `/mission/export/:id` | Download mission as CSV |

### Mission JSON shape

```json
{
  "id": 1712345678000,
  "mode": "sewer",
  "startTime": "2024-04-05T00:00:00.000Z",
  "duration": 120,
  "nodes": [ ...all packets... ],
  "detections": [
    { "tick": 42, "type": "hole", "confidence": 0.9, "details": "...", "position": {} }
  ],
  "stats": {
    "maxStress": 0, "avgMq4": 412, "avgMq135": 98,
    "holesFound": 2, "blockagesFound": 1, "bendsFound": 0,
    "totalDistance": 18.9, "maxWaterLevel": 44, "maxTemp": 26.4
  }
}
```

### CSV Export columns

```
timestamp, x, y, z, mq4, mq135, water, temp, hum, lidar, stress, detectedAnomaly
```

---

## ⚙️ Environment Variables

```bash
PORT=3000          # HTTP server port (default: 3000)
ESP_IP=192.168.1.x # ESP32 IP — enables WebSocket proxy at ws://localhost:3000/ws
ESP_PORT=81        # ESP32 WebSocket port (default: 81)
```

---

## 🗺️ 3D Map Views

| View | Colour scheme |
|---|---|
| **Gas Particles** | Segments coloured by anomaly priority; floating gas particles by MQ-4 level |
| **Pipe Tension** | Segments coloured green→yellow→orange→red by stress MPa; radius scaled |
| **Wireframe** | Edge-only render in cyan accent colour |

### Node colour priority (Gas view)

```
Hole/leak (confidence > 0.7) → #ff2244 red  (sewer) / #ffffff white (pipeline)
Blockage detected             → #2196f3 blue
Stress > 250 MPa             → #9c27b0 purple
Bend detected                → #ffff00 yellow
Corrosion risk > 0.5         → #ff8c00 orange
Default (safe)               → #00ff9d green
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Firmware** | Arduino C++ on ESP32 |
| **Frontend** | Vanilla HTML/CSS/JS (ES modules) |
| **3D rendering** | Three.js r128 (CDN) |
| **Fonts** | Google Fonts — Orbitron + Rajdhani |
| **Backend** | Node.js + Express |
| **WebSocket** | `ws` library (server) + native browser WebSocket (client) |
| **Persistence** | `fs-extra` JSON file storage |

---

## 🤝 Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m 'Add my feature'`
4. Push to the branch: `git push origin feature/my-feature`
5. Open a Pull Request

**Calibration notes for field use:**
- `sensors.ino`: Adjust ACS712 zero-offset and MQ sensor sensitivity curves after assembly
- `sensors.js`: Tune detection thresholds after real-world sensor testing in target pipe sizes

---

## 📄 License

MIT — see [LICENSE](LICENSE)

---

<div align="center">

Built for sewer and gas pipeline inspection · ESP32 + Three.js + Node.js

</div>
