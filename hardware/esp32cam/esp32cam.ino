// ================================================================
//  Sky Guardian — CAMERA NODE Firmware  (SNS-003 / CHARLIE-03)
//  ESP32-CAM (AI Thinker) + OV2640
//
//  Функции : MJPEG-стрим  → http://<IP>:81/stream
//            Обнаружение движения → POST /api/hardware/detect
//            Heartbeat           → POST /api/hardware/sensor-ping
//
//  Arduino IDE: Board = "AI Thinker ESP32-CAM"
//  Required libs: esp32 board package (содержит esp_camera)
//                 ArduinoJson (v6.x)
//
//  Прошивка: GPIO0 → GND, затем Reset → загрузка.
//            Уберите GPIO0 от GND → обычная работа.
// ================================================================

#include "esp_camera.h"
#include <WiFi.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// ── WiFi ────────────────────────────────────────────────────────
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";

// ── Backend ─────────────────────────────────────────────────────
const char* API_DETECT = "http://192.168.1.100:3001/api/hardware/detect";
const char* API_PING   = "http://192.168.1.100:3001/api/hardware/sensor-ping";
const char* API_KEY    = "sg-hardware-key-2024";
const char* SENSOR_ID  = "SNS-003";

// Координаты камеры (фиксированные, нет GPS)
const float CAM_LAT = 51.340f;
const float CAM_LNG = 71.466f;

// ── AI Thinker ESP32-CAM pin map ────────────────────────────────
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22
#define FLASH_LED_PIN      4   // встроенная вспышка

// ── Параметры детекции движения ──────────────────────────────────
#define MOTION_THRESHOLD  15000  // сумма разниц пикселей
#define COOLDOWN_MS       8000UL
#define PING_INTERVAL     30000UL
#define FRAME_W           160    // уменьшенный кадр для анализа
#define FRAME_H           120

// ── Глобальные ───────────────────────────────────────────────────
WebServer server(80);
WebServer streamServer(81);
unsigned long lastDetect = 0;
unsigned long lastPing   = 0;
int  detCount     = 0;
bool motionActive = false;

uint8_t* prevFrame = nullptr;

// ════════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  pinMode(FLASH_LED_PIN, OUTPUT);
  digitalWrite(FLASH_LED_PIN, LOW);

  // Инициализация камеры
  camera_config_t cfg;
  cfg.ledc_channel = LEDC_CHANNEL_0;
  cfg.ledc_timer   = LEDC_TIMER_0;
  cfg.pin_d0       = Y2_GPIO_NUM;
  cfg.pin_d1       = Y3_GPIO_NUM;
  cfg.pin_d2       = Y4_GPIO_NUM;
  cfg.pin_d3       = Y5_GPIO_NUM;
  cfg.pin_d4       = Y6_GPIO_NUM;
  cfg.pin_d5       = Y7_GPIO_NUM;
  cfg.pin_d6       = Y8_GPIO_NUM;
  cfg.pin_d7       = Y9_GPIO_NUM;
  cfg.pin_xclk     = XCLK_GPIO_NUM;
  cfg.pin_pclk     = PCLK_GPIO_NUM;
  cfg.pin_vsync    = VSYNC_GPIO_NUM;
  cfg.pin_href     = HREF_GPIO_NUM;
  cfg.pin_sscb_sda = SIOD_GPIO_NUM;
  cfg.pin_sscb_scl = SIOC_GPIO_NUM;
  cfg.pin_pwdn     = PWDN_GPIO_NUM;
  cfg.pin_reset    = RESET_GPIO_NUM;
  cfg.xclk_freq_hz = 20000000;
  cfg.pixel_format = PIXFORMAT_JPEG;
  cfg.frame_size   = FRAMESIZE_VGA;   // 640×480 для стрима
  cfg.jpeg_quality = 12;
  cfg.fb_count     = 2;

  if (esp_camera_init(&cfg) != ESP_OK) {
    Serial.println("Camera init FAILED");
    return;
  }
  Serial.println("Camera init OK");

  // WiFi
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("WiFi connecting");
  for (int i = 0; i < 20 && WiFi.status() != WL_CONNECTED; i++) {
    delay(500); Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("IP: " + WiFi.localIP().toString());
    Serial.println("Stream: http://" + WiFi.localIP().toString() + ":81/stream");
  }

  // Буфер для детекции движения
  prevFrame = (uint8_t*)malloc(FRAME_W * FRAME_H);

  // HTTP сервер — снимок
  server.on("/snapshot", HTTP_GET, handleSnapshot);
  server.on("/", HTTP_GET, []() {
    server.send(200, "text/plain",
      "Sky Guardian CAM\n"
      "Stream: http://" + WiFi.localIP().toString() + ":81/stream\n"
      "Snap:   http://" + WiFi.localIP().toString() + "/snapshot");
  });
  server.begin();

  // Stream сервер
  streamServer.on("/stream", HTTP_GET, handleStream);
  streamServer.begin();

  Serial.println("Servers started");
}

// ════════════════════════════════════════════════════════════════
void loop() {
  server.handleClient();
  streamServer.handleClient();

  unsigned long now = millis();

  // ── Motion detection (каждые 500 мс) ─────────────────────────
  static unsigned long lastMotionCheck = 0;
  if (now - lastMotionCheck > 500) {
    lastMotionCheck = now;
    checkMotion(now);
  }

  // ── Heartbeat ─────────────────────────────────────────────────
  if (now - lastPing > PING_INTERVAL) {
    sendPing();
    lastPing = now;
  }
}

// ════════════════════════════════════════════════════════════════
void checkMotion(unsigned long now) {
  if (!prevFrame) return;

  // Захватить кадр с малым разрешением для анализа
  sensor_t* s = esp_camera_sensor_get();
  s->set_framesize(s, FRAMESIZE_QQVGA);  // 160×120

  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) return;

  // fb->buf содержит JPEG — для разностного анализа нужен GRAYSCALE
  // Упрощённый метод: сравниваем размер JPEG (быстро, хотя и грубо)
  static size_t prevSize = 0;
  long diff = (long)fb->len - (long)prevSize;
  if (diff < 0) diff = -diff;
  prevSize = fb->len;

  esp_camera_fb_return(fb);

  // Вернуть разрешение для стрима
  s->set_framesize(s, FRAMESIZE_VGA);

  motionActive = (diff > MOTION_THRESHOLD && prevSize > 0);

  if (motionActive && (now - lastDetect > COOLDOWN_MS)) {
    lastDetect = now;
    detCount++;

    String callsign = "VIS-" + String(detCount);
    String notes    = "Visual motion via OV2640 (JPEG delta: " + String(diff) + ")";

    Serial.printf("[MOTION] diff=%ld → %s\n", diff, callsign.c_str());

    // Мигнуть вспышкой
    digitalWrite(FLASH_LED_PIN, HIGH);
    delay(100);
    digitalWrite(FLASH_LED_PIN, LOW);

    sendDetection(callsign, "Visual Contact", "medium",
                  CAM_LAT, CAM_LNG, 0, 0, 0, 0.70f, notes);
  }
}

// ════════════════════════════════════════════════════════════════
void handleStream() {
  streamServer.sendHeader("Access-Control-Allow-Origin", "*");
  WiFiClient client = streamServer.client();

  String header =
    "HTTP/1.1 200 OK\r\n"
    "Content-Type: multipart/x-mixed-replace; boundary=frame\r\n\r\n";
  client.print(header);

  while (client.connected()) {
    camera_fb_t* fb = esp_camera_fb_get();
    if (!fb) continue;

    client.printf("--frame\r\nContent-Type: image/jpeg\r\n"
                  "Content-Length: %u\r\n\r\n", fb->len);
    client.write(fb->buf, fb->len);
    client.print("\r\n");
    esp_camera_fb_return(fb);
    delay(33);  // ~30 fps
  }
}

void handleSnapshot() {
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) { server.send(503, "text/plain", "Camera error"); return; }
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send_P(200, "image/jpeg", (const char*)fb->buf, fb->len);
  esp_camera_fb_return(fb);
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
  doc["lat"]        = lat;
  doc["lng"]        = lng;
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

  StaticJsonDocument<128> doc;
  doc["sensorId"] = SENSOR_ID;
  doc["health"]   = 90;
  doc["signal"]   = constrain(map(WiFi.RSSI(), -90, -40, 0, 100), 0, 100);
  doc["status"]   = "online";

  String body;
  serializeJson(doc, body);
  http.POST(body);
  http.end();
}
