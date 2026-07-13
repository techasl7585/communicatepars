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
  const [bluetoothPairingActive, setBluetoothPairingActive] = useState(false);
  const [iosInfoOpen, setIosInfoOpen] = useState(false);
  const [hotspotActive, setHotspotActive] = useState(false);
  const [hotspotInfo, setHotspotInfo] = useState(null);
  const [sharedFiles, setSharedFiles] = useState([]);
  const [shareBusy, setShareBusy] = useState(false);

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
      const [airplay, control, pairing] = await Promise.all([
        requestJson("/airplay/status"),
        requestJson("/ipad/control/status"),
        requestJson("/bluetooth/pairing/status"),
      ]);
      setAirplayActive(Boolean(airplay.active));
      setIpadControlActive(Boolean(control.active));
      setBluetoothPairingActive(Boolean(pairing.active));
    } catch (error) {
      console.error("iOS oturum durumu alınamadı:", error);
    }
  };
  useEffect(() => {
    refreshIosSessionStatus();
    refreshSharePanel();
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
      // Önce yeni/eşleşmemiş iOS cihazlar için eşleştirme modunu aç.
      // Mouse geri yükleme mekanizmasına dokunulmaz.
      setStatus("Bluetooth yeni cihaz eşleştirme modu açılıyor...");
      const pairing = await requestJson("/bluetooth/pairing/start", { method: "POST" });
      setBluetoothPairingActive(Boolean(pairing.active));

      // Mevcut sıra korunur: önce AirPlay, sonra mouse aktarımı.
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
  const openIosInfoAndStart = () => {
    setIosInfoOpen(true);
    startIosSession();
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

  const refreshSharePanel = async () => {
    try {
      const [network, files] = await Promise.all([
        requestJson("/network/hotspot/status"),
        requestJson("/share/files"),
      ]);
      setHotspotActive(Boolean(network.active));
      setHotspotInfo(network);
      setSharedFiles(files.files || []);
    } catch (error) {
      console.error("Paylaşım durumu alınamadı:", error);
      setStatus(error.message);
    }
  };
  const openSharePanel = () => {
    setPanel("share");
    refreshSharePanel();
  };
  const toggleHotspot = async () => {
    if (shareBusy) return;
    setShareBusy(true);
    try {
      const data = await requestJson(
        hotspotActive ? "/network/hotspot/stop" : "/network/hotspot/start",
        { method: "POST" }
      );
      setHotspotActive(Boolean(data.active));
      setHotspotInfo(data);
      setStatus(data.message);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setShareBusy(false);
      refreshSharePanel();
    }
  };
  const uploadSharedFiles = async (event) => {
    const selected = Array.from(event.target.files || []);
    if (!selected.length) return;
    setShareBusy(true);
    try {
      const body = new FormData();
      selected.forEach((file) => body.append("files", file));
      const data = await requestJson("/share/upload", { method: "POST", body });
      setStatus(data.message);
      event.target.value = "";
      await refreshSharePanel();
    } catch (error) {
      setStatus(error.message);
    } finally {
      setShareBusy(false);
    }
  };
  const removeSharedFile = async (id) => {
    setShareBusy(true);
    try {
      const data = await requestJson(`/share/files/${encodeURIComponent(id)}`, { method: "DELETE" });
      setStatus(data.message);
      await refreshSharePanel();
    } catch (error) {
      setStatus(error.message);
    } finally {
      setShareBusy(false);
    }
  };
  const formatBytes = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };
  const copyText = async (value, label) => {
    try {
      await navigator.clipboard.writeText(value);
      setStatus(`${label} kopyalandı`);
    } catch (error) {
      console.error("Kopyalama başarısız:", error);
      setStatus(`${label}: ${value}`);
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
        <button onClick={openSharePanel}>Pardus Ağı + Dosya Paylaşımı</button>
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
                <span className={bluetoothPairingActive ? "status-badge success" : "status-badge"}>
                  {bluetoothPairingActive ? "Yeni Eşleştirme Açık" : "Yeni Eşleştirme Kapalı"}
                </span>
              </div>
            </div>

            <div
              role="note"
              style={{
                marginBottom: "18px",
                padding: "18px 20px",
                borderRadius: "16px",
                border: "2px solid #22d3ee",
                background: "#ecfeff",
                color: "#0f172a",
              }}
            >
              <h3
                style={{
                  margin: "0 0 12px",
                  color: "#0f172a",
                  opacity: 1,
                  visibility: "visible",
                }}
              >
                Bağlantı şartları
              </h3>
              <ol
                style={{
                  margin: 0,
                  paddingLeft: "22px",
                  color: "#0f172a",
                  opacity: 1,
                  visibility: "visible",
                  lineHeight: 1.7,
                }}
              >
                <li style={{ color: "#0f172a", opacity: 1 }}>
                  iPhone veya iPad ile Pardus bilgisayarı
                  <strong style={{ color: "#0f172a" }}> aynı Wi-Fi ağına </strong>
                  bağlı olmalıdır.
                </li>
                <li style={{ color: "#0f172a", opacity: 1 }}>
                  iPhone veya iPad üzerinde
                  <strong style={{ color: "#0f172a" }}> AssistiveTouch açık </strong>
                  olmalıdır.
                </li>
              </ol>
              <p
                style={{
                  margin: "12px 0 0",
                  color: "#9f1239",
                  fontWeight: 700,
                  opacity: 1,
                  visibility: "visible",
                }}
              >
                Mouse'u Pardus'a geri almak için: Sol Ctrl + K
              </p>
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
                      onClick={ipadControlActive ? stopIosSession : openIosInfoAndStart}
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
                  <li>iPhone veya iPad ile Pardus aynı Wi-Fi ağına bağlanır.</li>
                  <li>iOS Ayarlar → Erişilebilirlik → Dokunma bölümünden AssistiveTouch açılır.</li>
                  <li>AirPlay başlatılır ve UxPlay penceresine süre verilir.</li>
                  <li>Yalnızca AirPlay başarılıysa mouse kontrolü başlatılır.</li>
                  <li>iPad'de CommunicatePars ekran yansıtmayı seç.</li>
                  <li>
                    Yeni veya eşleşmemiş iOS cihazda Ayarlar → Bluetooth menüsünü
                    aç ve CommunicatePars-Mouse cihazına bağlan. Eşleştirme modu
                    3 dakika açık kalır.
                  </li>
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
        {panel === "share" && (
          <section className="ipad-panel">
            <div className="topbar">
              <div>
                <h2>Pardus Ağı ve Dosya Paylaşımı</h2>
                <p>
                  Pardus'un Wi-Fi ağını aç, telefonu bağla ve iki cihaz arasında
                  dosya aktar.
                </p>
              </div>
              <div className="control-buttons">
                <span className={hotspotActive ? "status-badge success" : "status-badge"}>
                  {hotspotActive ? "Pardus Ağı Açık" : "Pardus Ağı Kapalı"}
                </span>
                <button className="small" onClick={refreshSharePanel} disabled={shareBusy}>
                  Yenile
                </button>
              </div>
            </div>

            <div className="ipad-content">
              <article className="ipad-card">
                <div className="step-number">1</div>
                <div className="form-area">
                  <h3>Pardus ağını aç</h3>
                  <p>
                    Bu düğme bilgisayarda <strong>CommunicatePars</strong> adlı
                    yerel Wi-Fi ağını oluşturur.
                  </p>
                  <button
                    className={hotspotActive ? "control-toggle active" : "control-toggle"}
                    onClick={toggleHotspot}
                    disabled={shareBusy}
                  >
                    {shareBusy
                      ? "İşlem sürüyor..."
                      : hotspotActive
                        ? "Pardus Ağını Kapat"
                        : "Pardus Ağını Aç"}
                  </button>

                  <div className="input-device-panel" style={{ marginTop: "16px" }}>
                    <p>
                      <strong>Ağ adı:</strong>{" "}
                      {hotspotInfo?.ssid || "CommunicatePars"}
                    </p>
                    <p>
                      <strong>Wi-Fi şifresi:</strong>{" "}
                      <code>{hotspotInfo?.password || "CommunicatePars123"}</code>
                    </p>
                    <div className="control-buttons" style={{ flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="small"
                        onClick={() =>
                          copyText(
                            hotspotInfo?.password || "CommunicatePars123",
                            "Wi-Fi şifresi"
                          )
                        }
                      >
                        Şifreyi Kopyala
                      </button>
                    </div>
                  </div>
                </div>
              </article>

              <article className="ipad-card">
                <div className="step-number">2</div>
                <div className="form-area">
                  <h3>Telefonu bağla</h3>
                  <ol style={{ margin: 0, paddingLeft: "20px", lineHeight: 1.7 }}>
                    <li>Telefonda <strong>Ayarlar → Wi-Fi</strong> bölümünü aç.</li>
                    <li><strong>CommunicatePars</strong> ağını seç.</li>
                    <li><strong>CommunicatePars123</strong> şifresini yaz.</li>
                    <li>
                      “İnternet yok” uyarısında <strong>Yine de bağlı kal</strong>
                      seçeneğini seç.
                    </li>
                    <li>Gerekirse mobil veriyi ve VPN'i geçici olarak kapat.</li>
                  </ol>
                </div>
              </article>

              <article className="ipad-card">
                <div className="step-number">3</div>
                <div className="form-area">
                  <h3>Telefonda paylaşım sayfasını aç</h3>
                  <p>
                    Safari veya Chrome'un adres çubuğuna aşağıdaki adresi yaz.
                    Google arama kutusuna yazma.
                  </p>
                  <div className="input-device-panel">
                    <code style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>
                      {hotspotInfo?.shareUrl || "http://10.42.0.1:5050/share"}
                    </code>
                  </div>
                  <div className="control-buttons" style={{ marginTop: "12px", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="small"
                      onClick={() =>
                        copyText(
                          hotspotInfo?.shareUrl || "http://10.42.0.1:5050/share",
                          "Paylaşım adresi"
                        )
                      }
                    >
                      Adresi Kopyala
                    </button>
                  </div>
                  {!hotspotActive && (
                    <p style={{ color: "#9f1239", fontWeight: 700 }}>
                      Önce 1. adımdan Pardus ağını aç.
                    </p>
                  )}
                </div>
              </article>

              <article className="ipad-card">
                <div className="step-number">4</div>
                <div className="form-area">
                  <h3>PC'den dosya gönder</h3>
                  <p>
                    Normal dosyalar için “Dosya Seç”, yalnızca görseller için
                    “Fotoğraf Seç” düğmesini kullan.
                  </p>
                  <div className="control-buttons" style={{ flexWrap: "wrap" }}>
                    <label
                      className="input-list-button"
                      style={{ display: "inline-block", cursor: "pointer" }}
                    >
                      {shareBusy ? "Bekleyin..." : "Dosya Seç"}
                      <input
                        type="file"
                        accept="*/*"
                        multiple
                        hidden
                        onChange={uploadSharedFiles}
                        disabled={shareBusy}
                      />
                    </label>
                    <label
                      className="input-list-button"
                      style={{ display: "inline-block", cursor: "pointer" }}
                    >
                      Fotoğraf Seç
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        hidden
                        onChange={uploadSharedFiles}
                        disabled={shareBusy}
                      />
                    </label>
                  </div>
                </div>
              </article>

              <aside className="ipad-help">
                <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center" }}>
                  <h3 style={{ margin: 0 }}>Paylaşılan dosyalar</h3>
                  <button className="small" onClick={refreshSharePanel} disabled={shareBusy}>
                    Yenile
                  </button>
                </div>
                <p>
                  Telefonda da bu listenin üzerinde bir <strong>Yenile</strong>
                  düğmesi bulunur.
                </p>
                {sharedFiles.length === 0 ? (
                  <p>Henüz dosya paylaşılmadı.</p>
                ) : (
                  sharedFiles.map((file) => (
                    <div
                      key={file.id}
                      style={{ padding: "12px 0", borderBottom: "1px solid #334155" }}
                    >
                      <strong
                        style={{
                          fontFamily:
                            'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", Arial, sans-serif',
                          overflowWrap: "anywhere",
                          wordBreak: "break-word",
                          fontWeight: 700,
                        }}
                      >
                        {file.name}
                      </strong>
                      <br />
                      <small>{formatBytes(file.size)}</small>
                      <div className="control-buttons" style={{ marginTop: "8px" }}>
                        <a
                          href={`${API_URL}${file.downloadUrl}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          İndir
                        </a>
                        <button
                          className="small"
                          onClick={() => removeSharedFile(file.id)}
                          disabled={shareBusy}
                        >
                          Sil
                        </button>
                      </div>
                    </div>
                  ))
                )}
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
        {iosInfoOpen && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ios-info-title"
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 9999,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "18px",
              background: "rgba(6, 10, 35, 0.78)",
            }}
          >
            <div
              style={{
                width: "min(750px, 96vw)",
                maxHeight: "92vh",
                overflowY: "auto",
                padding: "24px",
                borderRadius: "22px",
                background: "#ffffff",
                color: "#111827",
                boxShadow: "0 24px 70px rgba(0, 0, 0, 0.4)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: "18px",
                  paddingBottom: "18px",
                  borderBottom: "1px solid #cbd5e1",
                }}
              >
                <div>
                  <h2 id="ios-info-title" style={{ margin: "0 0 8px" }}>
                    iOS bağlantısını tamamla
                  </h2>
                  <p style={{ margin: 0, color: "#475569", fontSize: "18px" }}>
                    Önce Bluetooth'a bağlan, sonra ekranı yansıt.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIosInfoOpen(false)}
                  style={{
                    flexShrink: 0,
                    padding: "12px 18px",
                    border: 0,
                    borderRadius: "14px",
                    background: "#3b465f",
                    color: "#ffffff",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Menüyü Kapat
                </button>
              </div>

              <div style={{ display: "grid", gap: "2px", marginTop: "18px" }}>
                <section
                  style={{
                    minHeight: "155px",
                    display: "grid",
                    gridTemplateColumns: "58px 1fr",
                    gap: "16px",
                    padding: "20px",
                    borderRadius: "18px",
                    background: "#101229",
                    color: "#ffffff",
                  }}
                >
                  <div style={{
                    width: "44px", height: "44px", display: "grid",
                    placeItems: "center", borderRadius: "14px",
                    background: "#08c9e8", color: "#07111f",
                    fontSize: "20px", fontWeight: 800,
                  }}>1</div>
                  <div>
                    <h3 style={{ margin: "2px 0 10px", color: "#ffffff" }}>
                      Bluetooth'a bağlan
                    </h3>
                    <p style={{ margin: 0, color: "#d5d9e8", lineHeight: 1.7 }}>
                      iPhone veya iPad'de Ayarlar → Bluetooth bölümünü aç.
                      CommunicatePars-Mouse cihazını bul ve bağlan.
                    </p>
                  </div>
                </section>

                <section
                  style={{
                    minHeight: "155px",
                    display: "grid",
                    gridTemplateColumns: "58px 1fr",
                    gap: "16px",
                    padding: "20px",
                    borderRadius: "18px",
                    background: "#101229",
                    color: "#ffffff",
                  }}
                >
                  <div style={{
                    width: "44px", height: "44px", display: "grid",
                    placeItems: "center", borderRadius: "14px",
                    background: "#08c9e8", color: "#07111f",
                    fontSize: "20px", fontWeight: 800,
                  }}>2</div>
                  <div>
                    <h3 style={{ margin: "2px 0 10px", color: "#ffffff" }}>
                      Ekranı yansıt
                    </h3>
                    <p style={{ margin: 0, color: "#d5d9e8", lineHeight: 1.7 }}>
                      iPhone veya iPad'de Denetim Merkezi → Ekran Yansıtma
                      bölümünü aç ve CommunicatePars cihazını seç.
                    </p>
                  </div>
                </section>
              </div>

              <div style={{
                marginTop: "16px", padding: "18px",
                border: "2px solid #ef233c", borderRadius: "16px",
                background: "#fff1f2", color: "#9f1239", textAlign: "center",
              }}>
                <strong style={{ display: "block", marginBottom: "8px", fontSize: "20px" }}>
                  Mouse'u PC'ye geri almak için
                </strong>
                <span style={{ fontSize: "18px" }}>
                  Pardus klavyesinde <strong>Sol Ctrl + K</strong> tuşlarına bas.
                </span>
              </div>

              <button
                type="button"
                onClick={() => setIosInfoOpen(false)}
                style={{
                  minWidth: "220px", marginTop: "20px", padding: "14px 22px",
                  border: 0, borderRadius: "14px", background: "#f5a000",
                  color: "#111827", fontWeight: 800, cursor: "pointer",
                }}
              >
                Tamam
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;