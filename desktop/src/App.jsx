import React, { useEffect, useState } from "react";
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
  const [iosSessionBusy, setIosSessionBusy] = useState(false);
  const [showIosGuide, setShowIosGuide] = useState(false);

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

  const refreshIosSessionStatus = async () => {
    try {
      const [airplay, control] = await Promise.all([
        requestJson("/airplay/status"),
        requestJson("/ipad/control/status"),
      ]);
      setAirplayActive(Boolean(airplay.active));
      setIpadControlActive(Boolean(control.active));
    } catch (error) {
      console.error("iOS oturum durumu alınamadı:", error);
    }
  };
  useEffect(() => {
    refreshIosSessionStatus();
    const timer = window.setInterval(refreshIosSessionStatus, 1500);
    return () => window.clearInterval(timer);
  }, []);
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
  const startIosSession = async () => {
    if (iosSessionBusy) return;
    setIosSessionBusy(true);
    let airplayStartedByThisAttempt = false;
    try {
      // Güvenlik sırası: önce görüntü, ancak başarıdan sonra mouse aktarımı.
      setStatus("1/2 AirPlay başlatılıyor...");
      if (!airplayActive) {
        const airplay = await requestJson("/airplay/start", { method: "POST" });
        if (!airplay.active) throw new Error("AirPlay aktif hale gelemedi");
        setAirplayActive(true);
        airplayStartedByThisAttempt = true;
      }

      // UxPlay penceresinin Pardus'ta öne gelmesi için kısa süre tanı.
      await new Promise((resolve) => window.setTimeout(resolve, 1200));

      setStatus("2/2 iOS mouse kontrolü başlatılıyor...");
      const control = await requestJson("/ipad/control/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventNumber: inputEvent }),
      });
      setIpadControlActive(Boolean(control.active));
      if (!control.active) throw new Error("iOS mouse kontrolü aktif hale gelemedi");
      setStatus(
        "AirPlay ve iOS kontrolü hazır. Mouse pc'ye geri alma: Sol Ctrl + K."
      );
      setShowIosGuide(true);
    } catch (error) {
      console.error(error);

      // Ağ/yanıt hatasında kontrol gerçekte başlamış olabilir. Önce sunucudan
      // doğrula; mouse iOS'a geçmişse AirPlay'i asla kapatma.
      let controlReallyActive = false;
      try {
        const controlStatus = await requestJson("/ipad/control/status");
        controlReallyActive = Boolean(controlStatus.active);
        setIpadControlActive(controlReallyActive);
      } catch (statusError) {
        console.error("Kontrol durumu doğrulanamadı:", statusError);
      }

      if (controlReallyActive) {
        setStatus(
          "Mouse kontrolü aktif. AirPlay güvenlik için açık bırakıldı; kapatmak için oturum düğmesini veya Sol Ctrl + K kullan."
        );
        setShowIosGuide(true);
      } else {
        setIpadControlActive(false);
        // Kontrol kesin olarak kapalıysa, yalnızca bu denemede açılan AirPlay'i kapat.
        if (airplayStartedByThisAttempt) {
          try {
            await requestJson("/airplay/stop", { method: "POST" });
            setAirplayActive(false);
          } catch (airplayError) {
            console.error("AirPlay geri alma hatası:", airplayError);
          }
        }
        setStatus(error.message || "iOS oturumu başlatılamadı");
      }
    } finally {
      setIosSessionBusy(false);
      refreshIosSessionStatus();
    }
  };
  const stopIosSession = async () => {
    if (iosSessionBusy) return;
    setIosSessionBusy(true);
    try {
      // Kritik güvenlik sırası: önce mouse Pardus'a geri verilir.
      // Bu aşama hata verirse aşağıdaki AirPlay kapatma koduna geçilmez.
      setStatus("1/2 Mouse Pardus'a geri veriliyor...");
      const control = await requestJson("/ipad/control/stop", {
        method: "POST",
      });
      setIpadControlActive(false);

      // Mouse geri dönüşü başarıyla yanıtlandıktan sonra AirPlay kapatılır.
      setStatus("2/2 Mouse geri alındı; AirPlay kapatılıyor...");
      try {
        if (airplayActive) {
          await requestJson("/airplay/stop", { method: "POST" });
        }
        setAirplayActive(false);
        setStatus(
          control.message ||
            "iOS oturumu kapatıldı; mouse Pardus'a geri verildi."
        );
      } catch (airplayError) {
        console.error(airplayError);
        setStatus(
          `Mouse Pardus'a geri verildi; ancak AirPlay kapatılamadı: ${airplayError.message}`
        );
      }
    } catch (mouseRestoreError) {
      console.error(mouseRestoreError);
      // Mouse geri yükleme başarısızsa AirPlay'e hiçbir kapatma isteği gönderilmez.
      setStatus(
        `${mouseRestoreError.message || "Mouse geri yüklenemedi"}. AirPlay güvenlik için açık bırakıldı; Sol Ctrl + K kullan.`
      );
    } finally {
      setIosSessionBusy(false);
      refreshIosSessionStatus();
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
              Android telefonu yansıt veya AirPlay ve iOS mouse kontrolünü
              güvenli tek tuşla birlikte yönet.
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
                  Tek tuş önce AirPlay'i açar, ardından mouse kontrolünü iOS'a
                  aktarır. Kapatırken sıra tersine döner: önce mouse Pardus'a
                  geri verilir, yalnızca başarılı olursa AirPlay kapatılır.
                </p>
              </div>
              <div className="control-buttons">
                <span className={airplayActive ? "status-badge success" : "status-badge"}>
                  {airplayActive ? "AirPlay Açık" : "AirPlay Kapalı"}
                </span>
                <span className={ipadControlActive ? "status-badge success" : "status-badge"}>
                  {ipadControlActive ? "Kontrol Açık" : "Kontrol Kapalı"}
                </span>
              </div>
            </div>

            <div className="ipad-content">
              <article className="ipad-card">
                <div className="step-number">1</div>
                <div className="form-area">
                  <h3>Mouse aygıtını bir kez seç</h3>
                  <p>
                    Mouse modelinin event numarasını seç. Kontrol etkinken bu
                    alan kilitlenir; yanlış event değişikliği yapılamaz.
                  </p>
                  <button
                    className="input-list-button"
                    onClick={listInputDevices}
                    disabled={inputListLoading || ipadControlActive || iosSessionBusy}
                  >
                    {inputListLoading ? "Aygıtlar Taranıyor..." : "Mouse Indexini Göster"}
                  </button>
                  {inputDevices && (
                    <div className="input-device-panel">
                      <div className="input-device-title">
                        Kullanılabilir input aygıtları
                        <small>Mouse satırının başındaki event numarasını kullan.</small>
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
                      disabled={ipadControlActive || iosSessionBusy}
                      onChange={(event) => setInputEvent(event.target.value)}
                    />
                  </div>
                </div>
              </article>

              <article className="ipad-card">
                <div className="step-number">2</div>
                <div>
                  <h3>AirPlay + iOS kontrolünü tek tuşla yönet</h3>
                  <p>
                    Başlatma sırasında AirPlay penceresi önce açılır. Böylece
                    mouse iOS'a geçtiğinde yansıtma arka menüde kalmaz. Durdurma
                    sırasında mouse geri yüklenmeden AirPlay kapatılmaz.
                  </p>
                  <div className="control-buttons">
                    <button
                      className={ipadControlActive ? "control-toggle active" : "control-toggle"}
                      onClick={ipadControlActive ? stopIosSession : startIosSession}
                      disabled={iosSessionBusy}
                    >
                      {iosSessionBusy
                        ? "İşlem sürüyor..."
                        : ipadControlActive
                          ? "Oturumu Kapat ve Mouse'u Pardus'a Geri Al"
                          : "AirPlay + iOS Kontrolünü Başlat"}
                    </button>
                  </div>
                </div>
              </article>

              <aside className="ipad-help">
                <h3>Korunan güvenlik akışı</h3>
                <ol>
                  <li>AirPlay başlatılır ve UxPlay penceresine süre verilir.</li>
                  <li>Yalnızca AirPlay başarılıysa mouse kontrolü başlatılır.</li>
                  <li>iPad'de CommunicatePars ekran yansıtmayı seç.</li>
                  <li>CommunicatePars-Mouse Bluetooth cihazına bağlan.</li>
                  <li>Kapatırken önce mevcut mouse geri yükleme endpointi çalışır.</li>
                  <li>Mouse başarıyla dönerse AirPlay kapatılır.</li>
                  <li>Acil durumda her zaman Sol Ctrl + K kullan.</li>
                </ol>
                <p>
                  Sol Ctrl + K sonrası ekran durumu en geç 1,5 saniye içinde
                  sunucudan tekrar okunur. Backend mouse geri verme kodu
                  değiştirilmemiştir.
                </p>
              </aside>
            </div>
          </section>
        )}
        {showIosGuide && (
          <div role="dialog" aria-modal="true" aria-labelledby="ios-guide-title" style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", background: "rgba(15, 23, 42, 0.76)" }}>
            <section style={{ width: "min(760px, 100%)", maxHeight: "90vh", overflowY: "auto", borderRadius: "20px", padding: "24px", background: "#ffffff", color: "#0f172a", boxShadow: "0 24px 80px rgba(0, 0, 0, 0.35)" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "20px", paddingBottom: "18px", borderBottom: "1px solid #cbd5e1" }}>
                <div>
                  <h2 id="ios-guide-title" style={{ margin: "0 0 8px", color: "#111827", opacity: 1, visibility: "visible", textShadow: "none" }}>iOS bağlantısını tamamla</h2>
                  <p style={{ margin: 0, color: "#334155", opacity: 1, visibility: "visible", lineHeight: 1.6 }}>Önce Bluetooth'a bağlan, sonra ekranı yansıt.</p>
                </div>
                <button className="small" onClick={() => setShowIosGuide(false)} style={{ flexShrink: 0 }}>Menüyü Kapat</button>
              </div>

              <article
                className="ipad-card"
                style={{ marginTop: "18px", color: "#ffffff" }}
              >
                <div className="step-number">1</div>
                <div style={{ color: "#ffffff", opacity: 1, visibility: "visible" }}>
                  <h3 style={{ color: "#ffffff", opacity: 1, visibility: "visible" }}>
                    Bluetooth'a bağlan
                  </h3>
                  <ol style={{ color: "#ffffff", opacity: 1, visibility: "visible" }}>
                    <li style={{ color: "#ffffff", opacity: 1 }}>
                      iPhone veya iPad'de <strong style={{ color: "#ffffff" }}>Ayarlar → Bluetooth</strong> menüsünü aç.
                    </li>
                    <li style={{ color: "#ffffff", opacity: 1 }}>
                      <strong style={{ color: "#ffffff" }}>CommunicatePars-Mouse</strong> cihazına bağlan.
                    </li>
                  </ol>
                </div>
              </article>

              <article className="ipad-card" style={{ color: "#ffffff" }}>
                <div className="step-number">2</div>
                <div style={{ color: "#ffffff", opacity: 1, visibility: "visible" }}>
                  <h3 style={{ color: "#ffffff", opacity: 1, visibility: "visible" }}>
                    Ekranı yansıt
                  </h3>
                  <ol style={{ color: "#ffffff", opacity: 1, visibility: "visible" }}>
                    <li style={{ color: "#ffffff", opacity: 1 }}>
                      iOS Denetim Merkezi'ni aç.
                    </li>
                    <li style={{ color: "#ffffff", opacity: 1 }}>
                      <strong style={{ color: "#ffffff" }}>Ekran Yansıtma</strong> düğmesine dokun.
                    </li>
                    <li style={{ color: "#ffffff", opacity: 1 }}>
                      <strong style={{ color: "#ffffff" }}>CommunicatePars</strong> cihazını seç.
                    </li>
                  </ol>
                </div>
              </article>

              <div role="alert" style={{ marginTop: "16px", padding: "18px", borderRadius: "14px", border: "2px solid #dc2626", background: "#fef2f2", color: "#7f1d1d" }}>
                <h3 style={{ margin: "0 0 8px", color: "#7f1d1d", opacity: 1 }}>Mouse'u PC'ye geri almak için</h3>
                <p style={{ margin: 0, color: "#7f1d1d", opacity: 1 }}>Pardus klavyesinde <strong>Sol Ctrl + K</strong> tuşlarına bas.</p>
              </div>

              <div className="control-buttons" style={{ marginTop: "20px" }}>
                <button className="control-toggle active" onClick={() => setShowIosGuide(false)}>Tamam</button>
              </div>
            </section>
          </div>
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