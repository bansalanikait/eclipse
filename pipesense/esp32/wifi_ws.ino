/*
  WiFi and WebSocket Server Functions
  WebSocket protocol on port 81 for real-time robot control and sensor broadcasting
*/

// ===== WiFi Initialization =====
void initWiFi() {
  /*
    Connect to SSID with retry limit of 20 attempts
    Print IP address to Serial once connected
  */
  Serial.print("Connecting to WiFi: ");
  Serial.println(WIFI_SSID);
  
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  
  int retries = 0;
  const int MAX_RETRIES = 20;
  
  while (WiFi.status() != WL_CONNECTED && retries < MAX_RETRIES) {
    delay(500);
    Serial.print(".");
    retries++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi Connected!");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
    Serial.print("Signal Strength: ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");
  } else {
    Serial.println("\nFailed to connect to WiFi");
  }
}

// ===== WebSocket Initialization =====
void initWebSocket() {
  /*
    Initialize WebSocket server on port 81
    Register event handler for connection/disconnection/data
  */
  webSocket.begin();
  webSocket.onEvent(onWebSocketEvent);
  Serial.println("WebSocket server started on port 81");
}

// ===== WebSocket Event Handler =====
void onWebSocketEvent(uint8_t num, WStype_t type, uint8_t *payload, size_t length) {
  /*
    Handle WebSocket events:
    - WStype_CONNECTED: New client connected
    - WStype_TEXT: Command received as JSON
    - WStype_DISCONNECTED: Client disconnected, stop motors for safety
    
    Expected JSON format:
    {"cmd":"F"} or {"cmd":"F","speed":200}
    Commands: F=forward, B=backward, L=left, R=right, S=stop
  */
  
  switch (type) {
    // ===== New Client Connected =====
    case WStype_CONNECTED: {
      IPAddress ip = webSocket.remoteIP(num);
      Serial.print("WebSocket client #");
      Serial.print(num);
      Serial.print(" connected from IP: ");
      Serial.println(ip);
      break;
    }
    
    // ===== Text Command Received =====
    case WStype_TEXT: {
      Serial.print("WebSocket #");
      Serial.print(num);
      Serial.print(" payload: ");
      
      // Convert payload to string
      String payloadStr = "";
      for (size_t i = 0; i < length; i++) {
        payloadStr += (char)payload[i];
      }
      Serial.println(payloadStr);
      
      // Parse JSON
      StaticJsonDocument<200> doc;
      DeserializationError error = deserializeJson(doc, payloadStr);
      
      if (error) {
        Serial.print("JSON parse error: ");
        Serial.println(error.c_str());
        break;
      }
      
      // Extract command and optional speed
      const char *cmd = doc["cmd"];
      uint8_t speed = doc["speed"] | MOTOR_SPEED;  // Default to MOTOR_SPEED if not specified
      
      if (cmd == NULL) {
        Serial.println("ERROR: No 'cmd' field in JSON");
        break;
      }
      
      // Set speed if different from current
      if (speed != MOTOR_SPEED && speed > 0 && speed <= 255) {
        // Speed change request (if desired)
        // setMotorSpeed(speed);
      }
      
      // Execute command
      switch (cmd[0]) {
        case 'F':  // Forward
          motorForward();
          break;
          
        case 'B':  // Backward
          motorBackward();
          break;
          
        case 'L':  // Left turn
          motorLeft();
          break;
          
        case 'R':  // Right turn
          motorRight();
          break;
          
        case 'S':  // Stop
          motorStop();
          break;
          
        default:
          Serial.print("Unknown command: ");
          Serial.println(cmd);
          break;
      }
      break;
    }
    
    // ===== Client Disconnected =====
    case WStype_DISCONNECTED: {
      Serial.print("WebSocket #");
      Serial.print(num);
      Serial.println(" disconnected");
      // Safety: stop motors when client disconnects
      motorStop();
      break;
    }
    
    default:
      break;
  }
}

// ===== Broadcast Sensor Data =====
void broadcastSensors() {
  /*
    Read all sensors and broadcast as JSON every 300ms
    Connect required function calls to read actual sensor values
    
    JSON broadcast format:
    {
      "mq4": 320.5,      // Methane in ppm
      "mq135": 145.2,    // Air quality index
      "water": 18.4,     // Water level %
      "temp": 24.5,      // Temperature °C
      "hum": 68.2,       // Humidity %
      "lidar": 42.1,     // Distance in cm
      "roll": 1.2,       // Roll angle degrees
      "pitch": -0.8,     // Pitch angle degrees
      "yaw": 47.3,       // Yaw angle (heading_command) degrees
      "vibration": 0,    // Vibration detected (0/1)
      "current": 1.24,   // Current in amps
      "dist": 3.41,      // Total distance traveled in meters
      "heading": 47.3    // Current heading in degrees
    }
  */
  
  // Create JSON document
  StaticJsonDocument<300> doc;
  
  // Read MQ sensors
  doc["mq4"] = readMQ4();
  doc["mq135"] = readMQ135();
  
  // Read water level sensor
  doc["water"] = readWater();
  
  // Read DHT22 (temperature & humidity)
  doc["temp"] = readTemp();
  doc["hum"] = readHum();
  
  // Read LiDAR distance
  doc["lidar"] = readLidar();
  
  // Read IMU (roll, pitch, yaw)
  float roll_val, pitch_val, yaw_val;
  readIMU(roll_val, pitch_val, yaw_val);
  doc["roll"] = serialized(String(roll_val, 2));
  doc["pitch"] = serialized(String(pitch_val, 2));
  doc["yaw"] = serialized(String(yaw_val, 2));
  
  // Read vibration sensor
  doc["vibration"] = readVibration() ? 1 : 0;
  
  // Read current sensor
  doc["current"] = serialized(String(readCurrent(), 2));
  
  // Distance traveled
  doc["dist"] = serialized(String(totalDist, 2));
  
  // Current heading
  doc["heading"] = serialized(String(currentHeading, 2));
  
  // Serialize to string and broadcast
  String jsonString;
  serializeJson(doc, jsonString);
  
  // Send to all connected WebSocket clients
  webSocket.broadcastTXT(jsonString);
  
  // Optional: Print to Serial for debugging
  // Serial.println(jsonString);
}
