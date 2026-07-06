#include "soc/rtc_cntl_reg.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_NeoPixel.h>

const char* WIFI_SSID = "KNB";
const char* WIFI_PASS = "haker#07";
const char* API_DETECT = "http://192.168.101.7:3001/api/hardware/detect";
const char* API_PING   = "http://192.168.101.7:3001/api/hardware/sensor-ping";
const char* API_KEY    = "sg-hardware-key-2024";
const char* SENSOR_ID  = "SNS-001";
const float SENSOR_LAT = 51.130f;
const float SENSOR_LNG = 71.326f;

#define RCWL_PIN    34
#define LED_PIN     13
#define BUZZER_PIN  25
#define BTN_ACK     36
#define BTN_MODE    39
#define LED_COUNT    8
#define OLED_ADDR    0x3C
#define PING_INTERVAL  30000UL
#define COOLDOWN_MS    10000UL

Adafruit_SSD1306 display(128, 64, &Wire, -1);
Adafruit_NeoPixel ring(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);

unsigned long lastPing   = 0;
unsigned long lastDetect = 0;
bool wifiOk = false;

void setLEDs(uint32_t color) {
  for (int i = 0; i < LED_COUNT; i++) ring.setPixelColor(i, color);
  ring.show();
}

void beep(int times) {
  for (int i = 0; i < times; i++) {
    digitalWrite(BUZZER_PIN, HIGH); delay(150);
    digitalWrite(BUZZER_PIN, LOW);  delay(100);
  }
}

void oledStatus(const char* l1, const char* l2) {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println("=SKY GUARDIAN=");
  display.println(l1);
  display.println(l2);
  display.display();
}

void sendPing() {
  if (!wifiOk) return;
  HTTPClient http;
  http.begin(API_PING);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-api-key", API_KEY);
  StaticJsonDocument<128> doc;
  doc["sensorId"] = SENSOR_ID;
  doc["status"]   = "online";
  doc["lat"]      = SENSOR_LAT;
  doc["lng"]      = SENSOR_LNG;
  String body; serializeJson(doc, body);
  int code = http.POST(body);
  Serial.printf("[PING] HTTP %d\n", code);
  http.end();
}

void sendDetection() {
  if (!wifiOk) return;
  HTTPClient http;
  http.begin(API_DETECT);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-api-key", API_KEY);
  StaticJsonDocument<256> doc;
  doc["sensorId"]   = SENSOR_ID;
  doc["type"]       = "RADAR";
  doc["confidence"] = 85;
  doc["lat"]        = SENSOR_LAT;
  doc["lng"]        = SENSOR_LNG;
  String body; serializeJson(doc, body);
  int code = http.POST(body);
  Serial.printf("[DETECT] HTTP %d\n", code);
  http.end();
}

void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);
  Serial.begin(115200);
  delay(2000);
  Serial.println("\n=== SKY GUARDIAN NODE 1 ===");

  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(RCWL_PIN,   INPUT);
  pinMode(BTN_ACK,    INPUT);
  pinMode(BTN_MODE,   INPUT);
  digitalWrite(BUZZER_PIN, LOW);

  ring.begin();
  ring.setBrightness(40);
  setLEDs(ring.Color(0, 0, 50));

  Wire.begin(21, 22);
  if (!display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) {
    Serial.println("[OLED] NOT FOUND");
  } else {
    Serial.println("[OLED] OK");
    oledStatus("Booting...", "");
  }

  setCpuFrequencyMhz(80);
  WiFi.mode(WIFI_STA);
  WiFi.setTxPower(WIFI_POWER_2dBm);
  delay(500);

  Serial.print("[WiFi] Connecting");
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 40) {
    delay(500);
    Serial.print(".");
    tries++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    wifiOk = true;
    Serial.printf("\n[WiFi] OK: %s\n", WiFi.localIP().toString().c_str());
    oledStatus("WiFi OK", WiFi.localIP().toString().c_str());
    setLEDs(ring.Color(0, 50, 0));
    beep(2);
    sendPing();
    lastPing = millis();
  } else {
    Serial.println("\n[WiFi] FAILED");
    oledStatus("WiFi FAIL", "Offline");
    setLEDs(ring.Color(50, 0, 0));
    beep(3);
  }
}

void loop() {
  unsigned long now = millis();
  if (wifiOk && now - lastPing >= PING_INTERVAL) {
    lastPing = now;
    sendPing();
  }
  if (digitalRead(RCWL_PIN) == HIGH) {
    if (now - lastDetect >= COOLDOWN_MS) {
      lastDetect = now;
      Serial.println("[RCWL] MOTION DETECTED!");
      oledStatus("!!! DRONE !!!", "RCWL triggered");
      setLEDs(ring.Color(50, 0, 0));
      beep(3);
      sendDetection();
      delay(3000);
      oledStatus("Monitoring...", "SNS-001 online");
      setLEDs(ring.Color(0, 50, 0));
    }
  }
  delay(100);
}