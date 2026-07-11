import React, { useState } from "react";
import "./App.css";

const API_URL = "http://localhost:5050";

function App() {
  const [status, setStatus] = useState("Hazır");
  const [deviceInfo, setDeviceInfo] = useState("Henüz cihaz taranmadı");
  const [panel, setPanel] = useState("home");
  const [inputEvent, setInputEvent] = useState("8");
  const [ipadControlActive, setIpadControlActive] = useState(false);
  const [inputDevices, setInputDevices] = useState("");
  const [inputListLoading, setInputListLoading] = useState(false);

  const requestJson = async (url, options = {}) => {
    const response = await fetch(`${API_URL}${url}`, options);
    const contentType = response.headers.get("content-type") || "";

    if (!contentType.includes("application/json")) {
      await response.text();
      throw new Error(
        "CommunicatePars server yanıt vermiyor. Server'ı yeniden başlat."
      );
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "İşlem başarısız");
    }

    return data;
  };

  const scanDevices = async () => {
    try {
      setStatus("Android telefonlar taranıyor...");
      const data = await requestJson("/devices");

      if (data.devices?.length > 0) {
        const device = data.devices[0];
        setDeviceInfo(`${device.id} - ${device.status}`);
        setStatus("Android telefon bulundu");
      } else {
        setDeviceInfo("Cihaz bulunamadı");
        setStatus("Android telefon bulunamadı");
      }
    } catch (error) {
      console.error(error);
      setStatus(error.message || "Server kapalı olabilir");
    }
  };

  const mirrorPhone = async () => {
    try {
      setStatus("Telefon yansıtma başlatılıyor...");
      const data = await requestJson("/mirror", { method: "POST" });
      setStatus(data.message);
    } catch (error) {
      console.error(error);
      setStatus(error.message || "Yansıtma başlatılamadı");
    }
  };

  const listInputDevices = async () => {
    try {
      setInputListLoading(true);
      setStatus("Mouse ve klavye aygıtları taranıyor...");
      const data = await requestJson("/ipad/input/list");
      setInputDevices(
        data.output || "Kullanılabilir input aygıtı bulunamadı."
      );
      setStatus(
        "Input aygıtları listelendi. Mouse satırındaki event numarasını seç."
      );
    } catch (error) {
      console.error(error);
      setInputDevices("Input aygıtları listelenirken hata oluştu.");
      setStatus(error.message);
    } finally {
      setInputListLoading(false);
    }
  };

  const startIpadControl = async () => {
    try {
      setStatus("iPad kontrol sistemi başlatılıyor...");
      const data = await requestJson("/ipad/control/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventNumber: inputEvent }),
      });

      setIpadControlActive(Boolean(data.active));
      setStatus(data.message);
    } catch (error) {
      console.error(error);
      setIpadControlActive(false);
      setStatus(error.message);
    }
  };

  const stopIpadControl = async () => {
    try {
      setStatus("iPad kontrolü kapatılıyor ve mouse geri yükleniyor...");
      const data = await requestJson("/ipad/control/stop", {
        method: "POST",
      });
      setIpadControlActive(false);
      setStatus(data.message);
    } catch (error) {
      console.error(error);
      setIpadControlActive(false);
      setStatus(error.message);
    }
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">CP</div>
          <div>
            <h1>CommunicatePars</h1>
            <p>Pardus masaüstü paneli</p>
          </div>
        </div>

        <button onClick={() => setPanel("home")}>Ana Ekran</button>
        <button onClick={scanDevices}>Telefonu Tara</button>
        <button onClick={mirrorPhone}>Telefonu Yansıt</button>
        <button onClick={() => setPanel("ipad")}>iPad Kontrol</button>
        <button onClick={() => setPanel("whatsapp")}>WhatsApp Paneli</button>

        <div className="box">
          <span>Durum</span>
          <strong>{status}</strong>
        </div>

        <div className="box">
          <span>Bağlı Android Telefon</span>
          <p>{deviceInfo}</p>
        </div>
      </aside>

      <main className="main">
        {panel === "home" && (
          <section className="home">
            <h2>CommunicatePars</h2>
            <p>
              Android telefonu yansıt, iPad kontrolünü yönet veya WhatsApp Web
              panelini aç.
            </p>

            <div className="home-grid">
              <button onClick={scanDevices}>Android Tara</button>
              <button onClick={mirrorPhone}>Android Yansıt</button>
              <button onClick={() => setPanel("ipad")}>iPad Kontrol</button>
              <button onClick={() => setPanel("whatsapp")}>WhatsApp Web</button>
            </div>
          </section>
        )}

        {panel === "ipad" && (
          <section className="ipad-panel">
            <div className="topbar">
              <div>
                <h2>iPad Kontrol</h2>
                <p>
                  Kontrolü başlat, ardından iPad'den CommunicatePars-Mouse
                  cihazına yeniden bağlan.
                </p>
              </div>

              <span
                className={
                  ipadControlActive ? "status-badge success" : "status-badge"
                }
              >
                {ipadControlActive ? "Kontrol Açık" : "Kontrol Kapalı"}
              </span>
            </div>

            <div className="ipad-content">
              <article className="ipad-card">
                <div className="step-number">1</div>
                <div className="form-area">
                  <h3>Mouse aygıtı</h3>
                  <p>
                    Listede mouse modelini bul. Örneğin Logitech G305 satırının
                    başında 8 yazıyorsa aşağıdaki event alanına 8 gir. Power
                    Button, Video Bus ve HDMI satırlarını seçme.
                  </p>

                  <button
                    className="input-list-button"
                    onClick={listInputDevices}
                    disabled={inputListLoading}
                  >
                    {inputListLoading
                      ? "Aygıtlar Taranıyor..."
                      : "Mouse Indexini Göster"}
                  </button>

                  {inputDevices && (
                    <div className="input-device-panel">
                      <div className="input-device-title">
                        Kullanılabilir input aygıtları
                        <small>
                          Mouse adını bul ve satırın başındaki event numarasını
                          kullan.
                        </small>
                      </div>
                      <pre>{inputDevices}</pre>
                    </div>
                  )}

                  <div className="event-input">
                    <span>event</span>
                    <input
                      type="number"
                      min="0"
                      max="99"
                      value={inputEvent}
                      onChange={(event) => setInputEvent(event.target.value)}
                    />
                  </div>
                </div>
              </article>

              <article className="ipad-card">
                <div className="step-number">2</div>
                <div>
                  <h3>Kontrol sistemi</h3>
                  <p>
                    Kontrolü başlat ve Pardus yetki penceresini onayla. Sonra
                    iPad Bluetooth ayarlarında CommunicatePars-Mouse cihazının
                    bağlantısını kesip yeniden bağlan. Kontrolü kapatınca mouse
                    otomatik olarak Pardus'a geri verilir.
                  </p>

                  <div className="control-buttons">
                    <button
                      className={
                        ipadControlActive
                          ? "control-toggle active"
                          : "control-toggle"
                      }
                      onClick={
                        ipadControlActive
                          ? stopIpadControl
                          : startIpadControl
                      }
                    >
                      {ipadControlActive
                        ? "Kontrolü Kapat ve Mouse'u Geri Al"
                        : "Kontrolü Başlat"}
                    </button>
                  </div>
                </div>
              </article>

              <aside className="ipad-help">
                <h3>Kullanım sırası</h3>
                <ol>
                  <li>iPad'de AssistiveTouch özelliğini aç.</li>
                  <li>Mouse event numarasını kontrol et.</li>
                  <li>Kontrolü Başlat düğmesine bas.</li>
                  <li>Pardus yetki penceresini onayla.</li>
                  <li>
                    iPad Bluetooth ayarlarında CommunicatePars-Mouse cihazına
                    yeniden bağlan.
                  </li>
                  <li>Mouse ile iPad'i kontrol et.</li>
                  <li>
                    Bitirince düğmeye tekrar bas veya Sol Ctrl + K kullan.
                  </li>
                </ol>
              </aside>
            </div>
          </section>
        )}

        {panel === "whatsapp" && (
          <section className="whatsapp">
            <div className="topbar">
              <div>
                <h2>WhatsApp Web</h2>
                <p>
                  QR kod çıkarsa telefondan WhatsApp → Bağlı Cihazlar → Cihaz
                  Bağla ile okut.
                </p>
              </div>
              <button className="small" onClick={() => setPanel("home")}>
                Kapat
              </button>
            </div>

            {React.createElement("webview", {
              className: "webview",
              src: "https://web.whatsapp.com/",
              allowpopups: "true",
              partition: "persist:whatsapp",
              useragent:
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
            })}
          </section>
        )}
      </main>
    </div>
  );
}

export default App;