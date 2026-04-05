/*
  ESP32 DOIT DevKit V1 (38-pin) Robot Controller
  Hardware: L298N Motor Driver, DHT22, MQ-4, MQ-135, Water Level, ACS712, SW-420, VL53L0X, MPU-6050
  
  WIRING NOTES:
  - Motors in series pairs: OUT1→motor1+→motor1-→motor2+→motor2-→OUT2
    Channel A (ENA): front-left + rear-left in series (~5.5V per motor at 11.1V)
    Channel B (ENB): front-right + rear-right in series (~5.5V per motor at 11.1V)
  - L298N Control: IN1=GPIO25, IN2=GPIO26, ENA=GPIO14, IN3=GPIO27, IN4=GPIO33, ENB=GPIO12
  - DHT22: GPIO13
  - MQ-4 (methane): GPIO34 (ADC, input-only, no pullup)
  - MQ-135 (air quality): GPIO35 (ADC, input-only, no pullup)
  - Water level: GPIO39 (ADC, input-only, no pullup)
  - ACS712 current: GPIO36 (ADC, input-only, no pullup)
  - SW-420 vibration: GPIO18 (digital input)
  - VL53L0X + MPU-6050: I2C SDA=GPIO21, SCL=GPIO22
  - Boot capacitor: 1000µF 10V across 5V and GND
  - WARNING: GPIO2 is boot-sensitive, keep pulled high at boot
  - Flyback diodes across all motor terminals
*/

#include <WiFi.h>
#include <WebSocketsServer.h>
#include <ArduinoJson.h>
#include "DHT.h"
#include <Wire.h>
#include <VL53L0X.h>
#include <MPU6050.h>
#include <esp_task_wdt.h>

// ===== WiFi Configuration =====
#define WIFI_SSID "YOUR_SSID"
#define WIFI_PASS "YOUR_PASSWORD"
#define DEFAULT_SPEED 200

// ===== Pin Definitions =====
// Motor control pins (L298N)
#define IN1 25
#define IN2 26
#define ENA 14
#define IN3 27
#define IN4 33
#define ENB 12

// Sensor pins
#define DHT_PIN 13
#define MQ4_PIN 34
#define MQ135_PIN 35
#define WATER_PIN 39
#define ACS712_PIN 36
#define VIBRATION_PIN 18

// ===== Motor Speed =====
#define MOTOR_SPEED 200  // PWM 0-255, default duty cycle

// ===== Global Objects =====
WebSocketsServer webSocket = WebSocketsServer(81);
DHT dht(DHT_PIN, DHT22);
VL53L0X lidar;
MPU6050 mpu;

// ===== Sensor Variables =====
float totalDist = 0;
float currentHeading = 0;
unsigned long moveStartTime = 0;
bool isMoving = false;

// IMU complementary filter state
float roll = 0, pitch = 0, yaw = 0;
unsigned long lastIMUTime = 0;
const float ALPHA = 0.96;  // Complementary filter coefficient

// ACS712 calibration (zero current offset)
float acsZeroOffset = 0;
const float ACS712_SENSITIVITY = 0.185;  // 185mV per amp for 5A version

unsigned long lastSensorReadTime = 0;
const unsigned long SENSOR_READ_INTERVAL = 300;  // ms

void setup() {
  // Initialize Serial
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n\n========== ESP32 Robot Controller Starting ==========");
  
  // Initialize pins
  pinMode(IN1, OUTPUT);
  pinMode(IN2, OUTPUT);
  pinMode(ENA, OUTPUT);
  pinMode(IN3, OUTPUT);
  pinMode(IN4, OUTPUT);
  pinMode(ENB, OUTPUT);
  pinMode(VIBRATION_PIN, INPUT);
  
  // Configure PWM for motor speed control
  ledcSetup(0, 5000, 8);  // Channel 0, 5kHz, 8-bit (0-255)
  ledcSetup(1, 5000, 8);  // Channel 1, 5kHz, 8-bit
  ledcAttachPin(ENA, 0);
  ledcAttachPin(ENB, 1);
  
  // Stop motors initially
  motorStop();
  
  // Initialize WiFi
  Serial.println("Initializing WiFi...");
  initWiFi();
  
  // Initialize WebSocket
  Serial.println("Initializing WebSocket...");
  initWebSocket();
  
  // Initialize I2C (SDA=21, SCL=22)
  Wire.begin(21, 22);
  Serial.println("I2C initialized");
  
  // Initialize sensors
  Serial.println("Initializing DHT22...");
  dht.begin();
  
  Serial.println("Initializing VL53L0X...");
  if (!lidar.init()) {
    Serial.println("ERROR: VL53L0X initialization failed!");
  } else {
    Serial.println("VL53L0X initialized");
    lidar.setTimeout(500);
  }
  
  Serial.println("Initializing MPU-6050...");
  if (!mpu.begin(MPU6050_SCALE_2000DPS, MPU6050_RANGE_16G)) {
    Serial.println("ERROR: MPU-6050 initialization failed!");
  } else {
    Serial.println("MPU-6050 initialized");
    mpu.setThrottled(true);
  }
  
  // MQ sensor warmup (120 seconds)
  Serial.println("MQ sensors warming up for 120 seconds...");
  for (int i = 120; i > 0; i--) {
    Serial.print(".");
    if (i % 10 == 0) Serial.print(" ");
    delay(1000);
  }
  Serial.println("\nMQ warmup complete!");
  
  // ACS712 zero calibration
  Serial.println("Calibrating ACS712 zero offset...");
  acsZeroOffset = 0;
  for (int i = 0; i < 100; i++) {
    int adcValue = analogRead(ACS712_PIN);
    float voltage = (adcValue / 4095.0) * 3.3;
    acsZeroOffset += voltage;
    delay(5);
  }
  acsZeroOffset /= 100.0;
  Serial.print("ACS712 zero offset: ");
  Serial.println(acsZeroOffset);
  
  // Initialize watchdog timer (20 second timeout)
  esp_task_wdt_init(20, true);
  esp_task_wdt_add(NULL);
  Serial.println("Watchdog timer enabled (20s timeout)");
  
  lastIMUTime = millis();
  lastSensorReadTime = millis();
  
  Serial.println("========== Setup Complete ==========\n");
}

void loop() {
  // Feed watchdog
  esp_task_wdt_reset();
  
  // Handle WebSocket events
  webSocket.loop();
  
  // WiFi reconnection check
  static unsigned long lastWiFiCheck = 0;
  if (millis() - lastWiFiCheck > 5000) {
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("WiFi disconnected, reconnecting...");
      initWiFi();
    }
    lastWiFiCheck = millis();
  }
  
  // Read sensors every 300ms and broadcast
  if (millis() - lastSensorReadTime >= SENSOR_READ_INTERVAL) {
    broadcastSensors();
    lastSensorReadTime = millis();
  }
  
  // Update distance if moving
  if (isMoving) {
    updateDistance();
  }
  
  delay(10);
}
