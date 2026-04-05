/*
  Sensor Reading Functions
  Handles DHT22, MQ-4, MQ-135, Water Level, ACS712, SW-420, VL53L0X, MPU-6050
*/

// ===== MQ-4 Methane Sensor =====
float readMQ4() {
  /*
    MQ-4 sensitivity: 4.0 ppm/V @ 25°C, 65%RH
    Rs/Ro at 4000ppm = 1.2
    Standard curve: ppm = 10 ^ ((log10(Rs/Ro) - log10(A)) / B)
    Where A ~= 0.3449, B ~= -0.2413 for MQ-4
  */
  int adcValue = analogRead(MQ4_PIN);
  float voltage = (adcValue / 4095.0) * 3.3;
  
  // RL = 10k (typical load resistance)
  const float RL = 10000;
  const float Ro = 4700;  // Ro calibrated at 4000ppm methane
  
  // Calculate Rs
  float Rs = RL * (3.3 - voltage) / voltage;
  
  // MQ-4 curve coefficients
  float ratio = Rs / Ro;
  float A = 0.3449;
  float B = -0.2413;
  
  float ppm = pow(10, (log10(ratio) - log10(A)) / B);
  return ppm;
}

// ===== MQ-135 Air Quality Sensor =====
float readMQ135() {
  /*
    MQ-135 sensitivity: 1.0 ppm/V @ 25°C, 65%RH
    Rs/Ro at 100ppm = 3.6
    Standard curve coefficients for AQI estimation
  */
  int adcValue = analogRead(MQ135_PIN);
  float voltage = (adcValue / 4095.0) * 3.3;
  
  const float RL = 10000;
  const float Ro = 3600;  // Ro calibrated at 100ppm CO2
  
  // Calculate Rs
  float Rs = RL * (3.3 - voltage) / voltage;
  
  // MQ-135 curve coefficients
  float ratio = Rs / Ro;
  float A = 116.6020682;
  float B = -2.769034857;
  
  float aqi = A * pow(ratio, B);
  return aqi;
}

// ===== Water Level Sensor =====
float readWater() {
  /*
    ADC 0-4095 maps to 0-100% water level
    Assuming linear sensor response
  */
  int adcValue = analogRead(WATER_PIN);
  float percentage = (adcValue / 4095.0) * 100.0;
  return percentage;
}

// ===== DHT22 Temperature =====
float readTemp() {
  float temp = dht.readTemperature();
  if (isnan(temp)) {
    return -999.0;  // Error indicator
  }
  return temp;
}

// ===== DHT22 Humidity =====
float readHum() {
  float hum = dht.readHumidity();
  if (isnan(hum)) {
    return -999.0;  // Error indicator
  }
  return hum;
}

// ===== VL53L0X LiDAR Distance =====
float readLidar() {
  uint16_t distance = lidar.readRangeSingleMillimeters();
  if (lidar.timeoutOccurred()) {
    return -999.0;  // Error indicator
  }
  return distance / 10.0;  // Return in cm
}

// ===== MPU-6050 IMU with Complementary Filter =====
void readIMU(float &roll_out, float &pitch_out, float &yaw_out) {
  /*
    Complementary filter combines accelerometer (stable) with gyroscope (responsive)
    Accelerometer for absolute roll/pitch, gyroscope for yaw integration
    Alpha = 0.96 weights gyro heavily, complemented by accel signal
  */
  unsigned long currentTime = millis();
  float deltaTime = (currentTime - lastIMUTime) / 1000.0;  // seconds
  lastIMUTime = currentTime;
  
  if (deltaTime > 0.05) deltaTime = 0.05;  // Cap at 50ms to prevent spikes
  
  // Read raw accelerometer and gyroscope
  Vector rawAccel = mpu.readRawAccel();
  Vector rawGyro = mpu.readRawGyro();
  
  // Convert to proper units (accelerometer: g, gyroscope: deg/s)
  // MPU-6050 at ±16g range and ±2000dps range
  float accelX = rawAccel.XAxis / 2048.0;
  float accelY = rawAccel.YAxis / 2048.0;
  float accelZ = rawAccel.ZAxis / 2048.0;
  
  float gyroX = rawGyro.XAxis / 16.4;  // deg/s
  float gyroY = rawGyro.YAxis / 16.4;
  float gyroZ = rawGyro.ZAxis / 16.4;
  
  // Calculate roll and pitch from accelerometer
  float accel_roll = atan2(accelY, accelZ) * 57.2958;  // rad to deg
  float accel_pitch = atan2(-accelX, sqrt(accelY * accelY + accelZ * accelZ)) * 57.2958;
  
  // Complementary filter for roll and pitch
  roll = ALPHA * (roll + gyroX * deltaTime) + (1 - ALPHA) * accel_roll;
  pitch = ALPHA * (pitch + gyroY * deltaTime) + (1 - ALPHA) * accel_pitch;
  
  // Integrate gyroscope for yaw (heading)
  yaw += gyroZ * deltaTime;
  
  // Normalize yaw to 0-360 degrees
  if (yaw >= 360) yaw -= 360;
  if (yaw < 0) yaw += 360;
  
  // Output results
  roll_out = roll;
  pitch_out = pitch;
  yaw_out = yaw;
  currentHeading = yaw;
}

// ===== SW-420 Vibration Sensor =====
bool readVibration() {
  /*
    SW-420 outputs HIGH when vibration detected
    Returns true if vibration, false otherwise
  */
  return digitalRead(VIBRATION_PIN) == HIGH;
}

// ===== ACS712 Current Sensor (5A version) =====
float readCurrent() {
  /*
    ACS712-5A: 185mV per amp, 2.5V at 0A
    ADC maps 0-3.3V to 0-4095
  */
  int adcValue = analogRead(ACS712_PIN);
  float voltage = (adcValue / 4095.0) * 3.3;
  
  // Subtract calibrated zero offset and convert to current
  float current = (voltage - acsZeroOffset) / ACS712_SENSITIVITY;
  
  // Filter small noise near 0A
  if (abs(current) < 0.05) {
    current = 0;
  }
  
  return current;
}

// ===== Update Total Distance Traveled =====
void updateDistance() {
  /*
    Motors run at ~5.5V per motor in series
    Estimated speed at MOTOR_SPEED=200/255 PWM:
    Speed ~= 0.3 m/s (calibrate based on actual motor specs)
  */
  static unsigned long lastDistUpdate = 0;
  unsigned long currentTime = millis();
  
  if (currentTime - lastDistUpdate >= 100) {  // Update every 100ms
    float speedMps = 0.3;  // meters per second
    float timeDelta = (currentTime - lastDistUpdate) / 1000.0;
    totalDist += speedMps * timeDelta;
    lastDistUpdate = currentTime;
  }
}
