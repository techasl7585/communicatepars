import React, { useState } from "react";
import "./App.css";

const API_URL = "http://localhost:5050";

function App() {
  const [status, setStatus] = useState("Hazır");
  const [deviceInfo, setDeviceInfo] = useState("Henüz cihaz taranmadı");
  const [panel, setPanel] = useState("home");
  const [inputEvent, setInputEvent] = useState("8");
  const [ipadControlActive, setIpadControlActive] = useState(false);
  const [airplayActive, setAirplayActive] = useState(false);
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

  const startAirplay = async () => {
    try {
      setStatus("AirPlay alıcısı başlatılıyor...");
      const data = await requestJson("/airplay/start", { method: "POST" });
      setAirplayActive(Boolean(data.active));
      setStatus(data.message);
    } catch (error) {
      console.error(error);
      setAirplayActive(false);
      setStatus(error.message || "AirPlay başlatılamadı");
    }
  };
  const stopAirplay = async () => {
    try {
      setStatus("AirPlay alıcısı kapatılıyor...");
      const data = await requestJson("/airplay/stop", { method: "POST" });
      setAirplayActive(false);
      setStatus(data.message);
    } catch (error) {
      console.error(error);
      setStatus(error.message || "AirPlay kapatılamadı");
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
        <button onClick={() => setPanel("ios")}>iOS AirPlay + Kontrol</button>
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
              Android telefonu yansıt, iOS ekranını AirPlay ile göster ve mouse
              kontrolünü aynı sayfadan yönet veya WhatsApp Web panelini aç.
            </p>

            <div className="home-grid">
              <button onClick={scanDevices}>Android Tara</button>
              <button onClick={mirrorPhone}>Android Yansıt</button>
              <button onClick={() => setPanel("ios")}>iOS AirPlay + Kontrol</button>
              <button onClick={() => setPanel("whatsapp")}>WhatsApp Web</button>
            </div>
          </section>
        )}

        {panel === "ios" && (
          <section className="ipad-panel">
            <div className="topbar">
              <div>
                <h2>iOS AirPlay ve Mouse Kontrolü</h2>
                <p>
                  Önce AirPlay ile ekranı yansıt, ardından mevcut ve güvenli
                  mouse kontrol akışını başlat.
                </p>
              </div>
              <div className="control-buttons">
                <span
                  className={
                    airplayActive ? "status-badge success" : "status-badge"
                  }
                >
                  {airplayActive ? "AirPlay Açık" : "AirPlay Kapalı"}
                </span>
                <span
                  className={
                    ipadControlActive ? "status-badge success" : "status-badge"
                  }
                >
                  {ipadControlActive ? "Kontrol Açık" : "Kontrol Kapalı"}
                </span>
              </div>
            </div>

            <div className="ipad-content">
              <article className="ipad-card">
                <div className="step-number">1</div>
                <div>
                  <h3>AirPlay ekran yansıtmayı başlat</h3>
                  <p>
                    Önce AirPlay alıcısını aç. iPad ve Pardus aynı ağdayken
                    iPad Denetim Merkezi → Ekran Yansıtma → CommunicatePars
                    yolunu kullan. Bu düğme mouse kontrolünü değiştirmez.
                  </p>
                  <div className="control-buttons">
                    <button
                      className={
                        airplayActive
                          ? "control-toggle active"
                          : "control-toggle"
                      }
                      onClick={airplayActive ? stopAirplay : startAirplay}
                    >
                      {airplayActive ? "AirPlay'i Kapat" : "AirPlay'i Başlat"}
                    </button>
                  </div>
                </div>
              </article>

              <article className="ipad-card">
                <div className="step-number">2</div>
                <div className="form-area">
                  <h3>Mouse aygıtını seç</h3>
                  <p>
                    Listede mouse modelini bul. Örneğin Logitech G305 satırının
                    başında 8 yazıyorsa event alanına 8 gir. Power Button,
                    Video Bus ve HDMI satırlarını seçme.
                  </p>
                  <button
                    className="input-list-button"
                    onClick={listInputDevices}
                    disabled={inputListLoading || ipadControlActive}
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
                      disabled={ipadControlActive}
                      onChange={(event) => setInputEvent(event.target.value)}
                    />
                  </div>
                </div>
              </article>

              <article className="ipad-card">
                <div className="step-number">3</div>
                <div>
                  <h3>iOS mouse kontrolünü yönet</h3>
                  <p>
                    Kontrolü başlat ve Pardus yetki penceresini onayla. Sonra
                    iPad Bluetooth ayarlarında CommunicatePars-Mouse cihazına
                    yeniden bağlan. Kontrol kapatıldığında mevcut sunucu akışı
                    mouse'u otomatik olarak Pardus'a geri verir.
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
                        ? "Kontrolü Kapat ve Mouse'u Pardus'a Geri Al"
                        : "iOS Kontrolünü Başlat"}
                    </button>
                  </div>
                </div>
              </article>

              <aside className="ipad-help">
                <h3>Güvenli kullanım sırası</h3>
                <ol>
                  <li>iPad'de AssistiveTouch özelliğini aç.</li>
                  <li>AirPlay'i başlat ve CommunicatePars'a bağlan.</li>
                  <li>Mouse event numarasını kontrol et.</li>
                  <li>iOS Kontrolünü Başlat düğmesine bas.</li>
                  <li>Pardus yetki penceresini onayla.</li>
                  <li>
                    iPad Bluetooth ayarlarında CommunicatePars-Mouse cihazına
                    yeniden bağlan.
                  </li>
                  <li>Bitirince kontrol düğmesine tekrar bas.</li>
                  <li>
                    Acil durumda Sol Ctrl + K kullan; bu yol mouse'u Pardus'a
                    geri veren mevcut mekanizmayı çalıştırır.
                  </li>
                </ol>
                <p>
                  AirPlay'i kapatmak mouse kontrolünü kapatmaz. Mouse kontrolü
                  yalnızca kendi düğmesiyle veya Sol Ctrl + K ile sonlandırılır.
                </p>
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