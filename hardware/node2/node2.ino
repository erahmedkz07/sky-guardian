// ================================================================
//  Sky Guardian — NODE 2 Firmware  (SNS-002 / BRAVO-02)
//  ESP32 DevKit V1 (ESP-WROOM-32)
//
//  Sensors  : RCWL-0516   (microwave radar)
//             CC1101       (433 MHz RF scanner)
//             NRF24L01+    (2.4 GHz RF scanner, shared SPI)
//             MAX9814      (acoustic mic)
//             HC-SR501     (PIR motion)
//             NEO-6M GPS   (location)
//  Outputs  : SSD1306 OLED, WS2812B LED Ring, Passive Buzzer
//  Backend  : POST http://<SERVER>:3001/api/hardware/detect
//
//  Arduino IDE: Board = "ESP32 Dev Module"
//  Required libs:
//    - SmartRC-CC1101-Driver-Lib  (搜: "ELECHOUSE CC1101")
//    - RF24           (TMRh20)
//    - TinyGPS++      (Mikal Hart)
//    - Adafruit SSD1306 + Adafruit GFX
//    - Adafruit NeoPixel
//    - ArduinoJson    (Benoit Blanchon, v6.x)
// ================================================================

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <SPI.h>
#include <RF24.h>
#include <ELECHOUSE_CC1101_SRC_DRV.h>
#include <TinyGPS++.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_NeoPixel.h>

// ── WiFi ────────────────────────────────────────────────────────
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";

// ── Backend ─────────────────────────────────────────────────────
const char* API_DETECT = "http://192.168.1.100:3001/api/hardware/detect";
const char* API_PING   = "http://192.168.1.100:3001/api/hardware/sensor-ping";
const char* API_KEY    = "sg-hardware-key-2024";
const char* SENSOR_ID  = "SNS-002";

const float SENSOR_LAT = 51.250f;
const float SENSOR_LNG = 71.586f;

// ── Пины ────────────────────────────────────────────────────────
// Общая SPI шина: SCK=18, MOSI=23, MISO=19
#define RCWL_PIN    34    // RCWL-0516  OUT → GPIO34
#define CC1101_CSN  5     // CC1101     CSN → GPIO5
#define CC1101_GDO0 2     //            GDO0→ GPIO2
#define CC1101_GDO2 4     //            GDO2→ GPIO4
#define NRF_CE      15    // NRF24L01+  CE  → GPIO15
#define NRF_CSN     27    //            CSN → GPIO27  (≠ CC1101!)
#define MIC_PIN     36    // MAX9814    OUT → GPIO36 (ADC1)
#define PIR_PIN     35    // HC-SR501   OUT → GPIO35
#define GPS_RX      16    // NEO-6M     TX  → GPIO16 (UART2)
#define GPS_TX      17    //            RX  → GPIO17
#define OLED_SDA    21
#define OLED_SCL    22
#define LED_PIN     13    // WS2812B DIN через 220 Ом
#define BUZZER_PIN  25
#define BTN_ACK     32
#define BTN_MODE    33

// ── Константы ───────────────────────────────────────────────────
#define LED_COUNT       8
#define OLED_ADDR       0x3C
#define PING_INTERVAL   30000UL
#define COOLDOWN_MS     10000UL
#define RF_SCAN_REPS    10
#define RF_THRESH       3
#define MIC_SAMPLES     64          // выборок ADC за одно измерение
#define MIC_THRESHOLD   2200        // порог амплитуды (0-4095)
#define CC_FREQ         433.920f    // частота сканирования (МГц)
#define CC_RSSI_THRESH  -85         // dBm порог CC1101

// ── Объекты ─────────────────────────────────────────────────────
RF24              radio(NRF_CE, NRF_CSN);
TinyGPSPlus       gps;
HardwareSerial    gpsSerial(2);
Adafruit_SSD1306  display(128, 64, &Wire, -1);
Adafruit_NeoPixel strip(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);

// ── Состояние ────────────────────────────────────────────────────
unsigned long lastPing   = 0;
unsigned long lastDetect = 0;
unsigned long lastRfScan = 0;
int  detectionCount = 0;
bool rcwlActive  = false;
bool rfActive    = false;
bool cc433Active = false;
bool micActive   = false;
bool pirActive   = false;
bool gpsFixed    = false;
float gpsLat = SENSOR_LAT, gpsLng = SENSOR_LNG;
float gpsAlt = 0, gpsSpd = 0, gpsCrs = 0;

// ════════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  gpsSerial.begin(9600, SERIAL_8N1, GPS_RX, GPS_TX);

  pinMode(RCWL_PIN,  INPUT);
  pinMode(PIR_PIN,   INPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(BUZZER_PIN, LOW);
  pinMode(BTN_ACK,  INPUT_PULLUP);
  pinMode(BTN_MODE, INPUT_PULLUP);

  Wire.begin(OLED_SDA, OLED_SCL);
  strip.begin();
  strip.setBrightness(70);
  setColor(0, 0, 255);

  display.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR);
  showMsg("Sky Guardian", "NODE 2 boot...");

  // CC1101 (SPI)
  ELECHOUSE_cc1101.setSpiPin(18, 19, 23, CC1101_CSN);  // SCK,MISO,MOSI,CS
  ELECHOUSE_cc1101.Init();
  ELECHOUSE_cc1101.setMHZ(CC_FREQ);
  ELECHOUSE_cc1101.SetRx();
  Serial.println("CC1101 init OK");

  // NRF24L01+ в режиме сканера (другой CSN, та же SPI шина)
  radio.begin();
  radio.setAutoAck(false);
  radio.disableCRC();
  radio.setDataRate(RF24_2MBPS);
  radio.setPALevel(RF24_PA_MIN);
  Serial.println("NRF24 init OK");

  // WiFi
  showMsg("Connecting...", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  for (int i = 0; i < 20 && WiFi.status() != WL_CONNECTED; i++) delay(500);

  if (WiFi.status() == WL_CONNECTED) {
    showMsg("WiFi OK", WiFi.localIP().toString().c_str());
    setColor(0, 255, 0);
  } else {
    showMsg("WiFi FAIL", "offline");
    setColor(255, 128, 0);
  }

  beep(2);
  delay(1200);
}

// ════════════════════════════════════════════════════════════════
void loop() {
  unsigned long now = millis();

  // ── GPS ──────────────────────────────────────────────────────
  while (gpsSerial.available()) {
    if (gps.encode(gpsSerial.read()) && gps.location.isValid()
        && gps.location.age() < 2000) {
      gpsLat = gps.location.lat();
      gpsLng = gps.location.lng();
      gpsAlt = gps.altitude.meters();
      gpsSpd = gps.speed.kmph();
      gpsCrs = gps.course.deg();
      gpsFixed = true;
    }
  }

  // ── RCWL-0516 ────────────────────────────────────────────────
  rcwlActive = (digitalRead(RCWL_PIN) == HIGH);

  // ── HC-SR501 PIR ─────────────────────────────────────────────
  pirActive = (digitalRead(PIR_PIN) == HIGH);

  // ── MAX9814 Acoustic ─────────────────────────────────────────
  {
    int peak = 0;
    for (int i = 0; i < MIC_SAMPLES; i++) {
      int v = analogRead(MIC_PIN);
      if (v > peak) peak = v;
      delayMicroseconds(200);
    }
    micActive = (peak > MIC_THRESHOLD);
    if (micActive) Serial.printf("[MIC] peak=%d\n", peak);
  }

  // ── CC1101 433MHz ────────────────────────────────────────────
  if (ELECHOUSE_cc1101.CheckReceiveFlag()) {
    int rssi = ELECHOUSE_cc1101.getRssi();
    cc433Active = (rssi > CC_RSSI_THRESH);
    Serial.printf("[CC1101] RSSI %d dBm → %s\n",
                  rssi, cc433Active ? "DETECTED" : "noise");
    byte buf[61];
    ELECHOUSE_cc1101.ReceiveData(buf);
    ELECHOUSE_cc1101.SetRx();
  }

  // ── NRF24 2.4 GHz scan ───────────────────────────────────────
  if (now - lastRfScan > 600) {
    uint8_t counts[126] = {0};
    for (uint8_t rep = 0; rep < RF_SCAN_REPS; rep++) {
      for (uint8_t ch = 0; ch < 126; ch++) {
        radio.setChannel(ch);
        radio.startListening();
        delayMicroseconds(128);
        radio.stopListening();
        if (radio.testRPD()) counts[ch]++;
      }
    }
    int active = 0;
    for (int i = 0; i < 126; i++) if (counts[i] > RF_SCAN_REPS/3) active++;
    rfActive   = (active >= RF_THRESH);
    lastRfScan = now;
  }

  // ── Fusion ───────────────────────────────────────────────────
  int score = 0;
  if (rcwlActive)  score += 3;
  if (rfActive)    score += 3;
  if (cc433Active) score += 2;
  if (micActive)   score += 2;
  if (pirActive)   score += 1;

  bool anyDetect = (score >= 3);

  if (anyDetect && (now - lastDetect > COOLDOWN_MS)) {
    lastDetect = now;
    detectionCount++;

    String threat;
    float  conf;
    if      (score >= 8) { threat = "critical"; conf = 0.95f; }
    else if (score >= 6) { threat = "high";     conf = 0.87f; }
    else if (score >= 4) { threat = "medium";   conf = 0.72f; }
    else                 { threat = "low";       conf = 0.58f; }

    String callsign = "UNK-" + String(detectionCount);
    String notes = "Score:" + String(score) + " ";
    if (rcwlActive)  notes += "RCWL. ";
    if (rfActive)    notes += "2.4GHz. ";
    if (cc433Active) notes += "433MHz. ";
    if (micActive)   notes += "Acoustic. ";
    if (pirActive)   notes += "PIR. ";
    if (!gpsFixed)   notes += "No GPS.";

    if      (threat == "critical") { setColor(255,0,255); beep(4); }
    else if (threat == "high")     { setColor(255,0,0);   beep(3); }
    else if (threat == "medium")   { setColor(255,200,0); beep(2); }
    else                           { setColor(0,255,100); beep(1); }

    showDetect(callsign, threat, conf);
    sendDetection(callsign, "Unknown", threat, gpsLat, gpsLng,
                  gpsAlt, gpsSpd, gpsCrs, conf, notes);

    Serial.printf("[DETECT] %s | %s | score=%d | %.0f%%\n",
                  callsign.c_str(), threat.c_str(), score, conf*100);
  }

  if (!anyDetect) {
    setColor(0, 180, 0);
    updateDisplay(now);
  }

  if (now - lastPing > PING_INTERVAL) {
    sendPing();
    lastPing = now;
  }

  delay(100);
}

// ════════════════════════════════════════════════════════════════
void sendDetection(String callsign, String model, String threat,
                   float lat, float lng, float alt, float spd,
                   float hdg, float conf, String notes) {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  http.begin(API_DETECT);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Api-Key", API_KEY);
  http.setTimeout(5000);

  StaticJsonDocument<512> doc;
  doc["sensorId"]   = SENSOR_ID;
  doc["callsign"]   = callsign;
  doc["model"]      = model;
  doc["threat"]     = threat;
  doc["lat"]        = serialized(String(lat, 6));
  doc["lng"]        = serialized(String(lng, 6));
  doc["altitude"]   = (int)alt;
  doc["speed"]      = spd;
  doc["heading"]    = hdg;
  doc["confidence"] = conf;
  doc["notes"]      = notes;

  String body;
  serializeJson(doc, body);
  int code = http.POST(body);
  Serial.printf("[HTTP /detect] %d\n", code);
  http.end();
}

void sendPing() {
  if (WiFi.status() != WL_CONNECTED) return;
  HTTPClient http;
  http.begin(API_PING);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Api-Key", API_KEY);
  http.setTimeout(3000);

  int sig = constrain(map(WiFi.RSSI(), -90, -40, 0, 100), 0, 100);
  StaticJsonDocument<128> doc;
  doc["sensorId"] = SENSOR_ID;
  doc["health"]   = 95;
  doc["signal"]   = sig;
  doc["status"]   = "online";

  String body;
  serializeJson(doc, body);
  http.POST(body);
  http.end();
}

// ── UI ──────────────────────────────────────────────────────────
void beep(int n) {
  for (int i = 0; i < n; i++) {
    for (int j = 0; j < 150; j++) {
      digitalWrite(BUZZER_PIN, HIGH); delayMicroseconds(500);
      digitalWrite(BUZZER_PIN, LOW);  delayMicroseconds(500);
    }
    delay(120);
  }
}

void setColor(uint8_t r, uint8_t g, uint8_t b) {
  for (int i = 0; i < LED_COUNT; i++)
    strip.setPixelColor(i, strip.Color(r, g, b));
  strip.show();
}

void showMsg(const char* l1, const char* l2) {
  display.clearDisplay(); display.setTextColor(WHITE);
  display.setTextSize(2); display.setCursor(0,0);  display.println(l1);
  display.setTextSize(1); display.setCursor(0,26); display.println(l2);
  display.display();
}

void showDetect(String cs, String thr, float conf) {
  display.clearDisplay();
  display.setTextSize(1); display.setTextColor(WHITE);
  display.setCursor(0,0);  display.println("!! DETECTION !!");
  display.setCursor(0,10); display.print("ID: ");     display.println(cs);
  display.setCursor(0,20); display.print("Threat: "); display.println(thr);
  display.setCursor(0,30); display.print("Conf:   ");
  display.print((int)(conf*100)); display.println("%");
  display.setCursor(0,40);
  if (gpsFixed) display.printf("%.4f / %.4f", gpsLat, gpsLng);
  else          display.println("GPS: no fix");
  display.display();
}

void updateDisplay(unsigned long now) {
  static unsigned long last = 0;
  if (now - last < 2000) return;
  last = now;
  display.clearDisplay();
  display.setTextSize(1); display.setTextColor(WHITE);
  display.setCursor(0,0);  display.println("Sky Guardian  v1.0");
  display.setCursor(0,9);  display.print("Sensor: "); display.println(SENSOR_ID);
  display.setCursor(0,18); display.print("WiFi:   ");
  display.println(WiFi.status()==WL_CONNECTED ? WiFi.localIP().toString() : "offline");
  display.setCursor(0,27); display.print("GPS:    ");
  display.println(gpsFixed ? "FIX OK" : "searching...");
  display.setCursor(0,36); display.print("Dets: "); display.println(detectionCount);
  display.setCursor(0,45);
  display.print("R:"); display.print(rcwlActive?1:0);
  display.print(" F:"); display.print(rfActive?1:0);
  display.print(" 4:"); display.print(cc433Active?1:0);
  display.print(" M:"); display.print(micActive?1:0);
  display.print(" P:"); display.println(pirActive?1:0);
  display.display();
}
