/*
  Motor Control Functions
  L298N dual-channel motor driver controlling 4 motors in series pairs:
  - Channel A: Front-Left + Rear-Left motors in series (~5.5V each at 11.1V supply)
  - Channel B: Front-Right + Rear-Right motors in series (~5.5V each at 11.1V supply)
  
  Control Logic:
  IN1/IN2 control motor direction on Channel A (ENA for speed)
  IN3/IN4 control motor direction on Channel B (ENB for speed)
  
  Digital pins: IN1=GPIO25, IN2=GPIO26, IN3=GPIO27, IN4=GPIO33
  PWM pins: ENA=GPIO14, ENB=GPIO12
*/

void motorForward() {
  /*
    Both channels forward
    Channel A: IN1=HIGH, IN2=LOW
    Channel B: IN3=HIGH, IN4=LOW
  */
  digitalWrite(IN1, HIGH);
  digitalWrite(IN2, LOW);
  digitalWrite(IN3, HIGH);
  digitalWrite(IN4, LOW);
  
  ledcWrite(0, MOTOR_SPEED);  // ENA speed
  ledcWrite(1, MOTOR_SPEED);  // ENB speed
  
  isMoving = true;
  moveStartTime = millis();
  
  Serial.println("Motor Forward");
}

void motorBackward() {
  /*
    Both channels backward
    Channel A: IN1=LOW, IN2=HIGH
    Channel B: IN3=LOW, IN4=HIGH
  */
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, HIGH);
  digitalWrite(IN3, LOW);
  digitalWrite(IN4, HIGH);
  
  ledcWrite(0, MOTOR_SPEED);  // ENA speed
  ledcWrite(1, MOTOR_SPEED);  // ENB speed
  
  isMoving = true;
  moveStartTime = millis();
  
  Serial.println("Motor Backward");
}

void motorLeft() {
  /*
    Left turn: pivot around left wheels
    Channel A (left) backward: IN1=LOW, IN2=HIGH
    Channel B (right) forward: IN3=HIGH, IN4=LOW
  */
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, HIGH);
  digitalWrite(IN3, HIGH);
  digitalWrite(IN4, LOW);
  
  ledcWrite(0, MOTOR_SPEED);  // ENA speed
  ledcWrite(1, MOTOR_SPEED);  // ENB speed
  
  isMoving = true;
  moveStartTime = millis();
  
  Serial.println("Motor Left Turn");
}

void motorRight() {
  /*
    Right turn: pivot around right wheels
    Channel A (left) forward: IN1=HIGH, IN2=LOW
    Channel B (right) backward: IN3=LOW, IN4=HIGH
  */
  digitalWrite(IN1, HIGH);
  digitalWrite(IN2, LOW);
  digitalWrite(IN3, LOW);
  digitalWrite(IN4, HIGH);
  
  ledcWrite(0, MOTOR_SPEED);  // ENA speed
  ledcWrite(1, MOTOR_SPEED);  // ENB speed
  
  isMoving = true;
  moveStartTime = millis();
  
  Serial.println("Motor Right Turn");
}

void motorStop() {
  /*
    Emergency stop: all control pins LOW, speed to 0
    This stops motor current immediately
  */
  digitalWrite(IN1, LOW);
  digitalWrite(IN2, LOW);
  digitalWrite(IN3, LOW);
  digitalWrite(IN4, LOW);
  
  ledcWrite(0, 0);  // ENA off
  ledcWrite(1, 0);  // ENB off
  
  if (isMoving) {
    // Update distance one final time
    unsigned long moveDuration = millis() - moveStartTime;
    float speedMps = 0.3;  // meters per second
    totalDist += speedMps * (moveDuration / 1000.0);
  }
  
  isMoving = false;
  
  Serial.println("Motor Stop");
}

void setMotorSpeed(uint8_t speed) {
  /*
    Change motor speed on the fly (0-255 PWM)
    Only affects speed if motors are currently moving
  */
  if (speed > 255) speed = 255;
  if (speed < 0) speed = 0;
  
  ledcWrite(0, speed);  // ENA
  ledcWrite(1, speed);  // ENB
  
  Serial.print("Motor Speed Set to: ");
  Serial.println(speed);
}
