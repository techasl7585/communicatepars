import React, { useEffect, useState } from "react";
import "./App.css";
import logo from "./assets/logo.png";

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
  const [androidBusy, setAndroidBusy] = useState(false);
  const [tabletActive, setTabletActive] = useState(false);
  const [tabletUrls, setTabletUrls] = useState([]);
  const [tabletBusy, setTabletBusy] = useState(false);
  const [androidDevices, setAndroidDevices] = useState([]);
  const [batteryDevices, setBatteryDevices] = useState([]);
  const [batteryLoading, setBatteryLoading] = useState(true);

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

  const refreshBatteryDevices = async () => {
    try {
      const data = await requestJson("/system/batteries");
      setBatteryDevices(data.devices || []);
    } catch (error) {
      console.error("Pil bilgileri alınamadı:", error);
      setBatteryDevices([]);
    } finally {
      setBatteryLoading(false);
    }
  };

  const refreshTabletStatus = async () => {
    try { const data=await requestJson("/tablet/status"); setTabletActive(Boolean(data.active)); setTabletUrls(data.urls || []); }
    catch(error) { console.error("Kalemli tablet durumu alınamadı:", error); }
  };
  const toggleTablet = async () => {
    if (tabletBusy) return;
    setTabletBusy(true);
    try {
      setStatus(tabletActive ? "Kalemli tablet kapatılıyor..." : "Kalemli tablet başlatılıyor...");
      const data=await requestJson(tabletActive ? "/tablet/stop" : "/tablet/start", { method:"POST" });
      setTabletActive(Boolean(data.active)); setTabletUrls(data.urls || []); setStatus(data.message);
    } catch(error) { setStatus(error.message || "Kalemli tablet işlemi başarısız"); }
    finally { setTabletBusy(false); refreshTabletStatus(); }
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
    refreshTabletStatus();
    refreshSharePanel();
    refreshBatteryDevices();
    const iosTimer = window.setInterval(refreshIosSessionStatus, 1500);
    const tabletTimer = window.setInterval(refreshTabletStatus, 2000);
    const batteryTimer = window.setInterval(refreshBatteryDevices, 10000);
    return () => {
      window.clearInterval(iosTimer);
      window.clearInterval(tabletTimer);
      window.clearInterval(batteryTimer);
    };
  }, []);
  const scanDevices = async () => {
    if (androidBusy) return;
    setAndroidBusy(true);
    try {
      setStatus("Android cihazlar taranıyor...");
      const data = await requestJson("/android/devices");
      const devices = data.devices || [];
      setAndroidDevices(devices);
      if (devices.length > 0) {
        const ready = devices.find((device) => device.status === "device") || devices[0];
        setDeviceInfo(`${ready.id} - ${ready.connection} - ${ready.status}`);
        setStatus(`${devices.length} Android bağlantısı bulundu`);
      } else {
        setDeviceInfo("Cihaz bulunamadı");
        setStatus("Android cihaz bulunamadı. USB hata ayıklamayı açıp kabloyu bağla.");
      }
    } catch (error) {
      console.error(error);
      setStatus(error.message || "Android cihazlar taranamadı");
    } finally {
      setAndroidBusy(false);
    }
  };
  const startAndroidMirror = async (mode) => {
    if (androidBusy) return;
    setAndroidBusy(true);
    try {
      setStatus(
        mode === "usb"
          ? "USB Android kontrolü başlatılıyor..."
          : "Kablosuz Android kontrolü başlatılıyor..."
      );
      const data = await requestJson("/android/mirror/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      setStatus(data.message);
      await scanDevicesAfterAction();
    } catch (error) {
      console.error(error);
      setStatus(error.message || "Android kontrolü başlatılamadı");
    } finally {
      setAndroidBusy(false);
    }
  };
  const scanDevicesAfterAction = async () => {
    try {
      const data = await requestJson("/android/devices");
      const devices = data.devices || [];
      setAndroidDevices(devices);
      if (devices.length) {
        const ready = devices.find((device) => device.status === "device") || devices[0];
        setDeviceInfo(`${ready.id} - ${ready.connection} - ${ready.status}`);
      }
    } catch (error) {
      console.error("Android durumu yenilenemedi:", error);
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
        "iOS kontrolü hazır. Mouse pc'ye geri alma: Sol Ctrl + K."
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
      setStatus("iOS kontrol sistemi başlatılıyor...");
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
      setStatus("iOS kontrolü kapatılıyor ve mouse geri yükleniyor...");
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
          <div
            className="logo"
            style={{
              width: "58px",
              height: "58px",
              padding: 0,
              overflow: "hidden",
              borderRadius: "14px",
              flexShrink: 0,
              background: "#0f172a",
            }}
          >
            <img
              src={logo}
              alt="CommunicatePars logosu"
              style={{
                display: "block",
                width: "100%",
                height: "100%",
                objectFit: "cover",
              }}
            />
          </div>
          <div>
            <h1>CommunicatePars</h1>
            <p></p>
          </div>
        </div>

        <button onClick={() => setPanel("home")}>Ana Ekran</button>
        <button onClick={() => setPanel("android")}>Android Kontrol</button>
        <button onClick={() => setPanel("ios")}>iOS Kontrol</button>
        <button onClick={() => setPanel("tablet")}>İkinci Ekran + Dokunmatik Pc Kontrol</button>
        <button onClick={openSharePanel}>Pardus Ağı + Dosya Paylaşımı</button>
        <button onClick={() => setPanel("whatsapp")}>WhatsApp Paneli</button>

        <div className="box">
          <span>Durum Bilgisi</span>
          <strong>{status}</strong>
        </div>

        
      </aside>

      <main className="main">
        {panel === "home" && (
          <section className="home compact-home">
            <div className="home-intro">
              <span className="home-label">COMMUNICATEPARS</span>
              <h2>Cihaz Bağlantı Merkezi</h2>
              <p></p>
            </div>

            <div className="home-grid compact-actions" style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: "14px", width: "100%", maxWidth: "1240px", margin: "100px auto 0" }}>
              <button onClick={() => setPanel("android")}><strong>Android Kontrol</strong></button>
              <button onClick={() => setPanel("ios")}><strong>iOS Kontrol</strong></button>
              <button onClick={() => setPanel("tablet")}><strong>İkinci Ekran + Dokunmatik Pc Kontrol</strong></button>
              <button onClick={openSharePanel}><strong>Pardus Ağı + Dosya Paylaşımı</strong></button>
              <button onClick={() => setPanel("whatsapp")}><strong>WhatsApp Paneli</strong></button>
            </div>

            <aside className="battery-detail" style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: "300px" }}>
              <div style={{ marginBottom: "18px" }}>
                <h3 style={{ margin: 0, fontSize: "22px", lineHeight: 1.25 }}>Pil Durumları</h3>
              </div>
              {batteryLoading ? (
                <small className="battery-unavailable" style={{ fontSize: "15px" }}>Pil bilgileri alınıyor...</small>
              ) : batteryDevices.length > 0 ? (
                <div className="battery-device-list" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "14px", width: "100%" }}>
                  {batteryDevices.map((device) => {
                    const isPc = device.type === "pc";
                    const deviceTitle = isPc ? "Bilgisayar Pili (PC)" : device.name;
                    return (
                      <div className="pc-battery-chip" key={device.id} style={{ width: "100%", minWidth: 0, minHeight: "76px", padding: "15px 16px", boxSizing: "border-box", margin: 0 }}>
                        <b style={{ fontSize: "14px", minWidth: "42px", minHeight: "42px" }}>{isPc ? "PC" : device.type === "mouse" ? "M" : device.type === "keyboard" ? "K" : device.type === "headset" ? "H" : "BT"}</b>
                        <span style={{ minWidth: 0 }}>
                          <strong style={{ display: "block", fontSize: "17px", lineHeight: 1.3 }}>{deviceTitle}</strong>
                        </span>
                        <em style={{ fontSize: "18px", fontWeight: 800, fontStyle: "normal" }}>%{device.percentage}</em>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <small className="battery-unavailable" style={{ fontSize: "15px" }}>Pardus tarafından bildirilen pil bulunamadı.</small>
              )}
            </aside>
          </section>
        )}

        {panel === "android" && (
          <section
            className="ipad-panel"
            style={{
              padding: "24px 22px 52px",
              minHeight: "100%",
              boxSizing: "border-box",
              overflowY: "auto",
            }}
          >
            <div
              className="topbar"
              style={{
                padding: "0 4px 20px",
                marginBottom: "20px",
                borderBottom: "1px solid #334155",
                alignItems: "center",
              }}
            >
              <div>
                <span style={{ display: "block", color: "#22d3ee", fontSize: "12px", fontWeight: 800, letterSpacing: "1.4px", marginBottom: "8px" }}>
                  
                </span>
                <h2 style={{ margin: "0 0 2px", fontSize: "27px" }}>Android Kontrol</h2>
                <p style={{ margin: 0, maxWidth: "760px", lineHeight: 1.55 }}>
                  
                </p>
              </div>
              <button className="small" onClick={scanDevices} disabled={androidBusy} style={{ minWidth: "168px", padding: "13px 18px" }}>
                {androidBusy ? "Taranıyor..." : "Cihazları Yenile"}
              </button>
            </div>

            <div style={{ display: "grid", gap: "20px" }}>
              <article className="ipad-card" style={{ display: "grid", gridTemplateColumns: "54px minmax(0, 1fr)", gap: "20px", padding: "23px", border: "1px solid #334155", borderRadius: "18px" }}>
                <div className="step-number" style={{ width: "46px", height: "46px", fontSize: "20px" }}>1</div>
                <div className="form-area" style={{ minWidth: 0 }}>
                  <h3 style={{ margin: "0 0 8px", fontSize: "21px" }}>USB İle Kontrol Et</h3>
                  <p style={{ margin: "0 0 18px", maxWidth: "1000px", lineHeight: 1.6 }}>
                    Geliştirici seçeneklerini ve USB hata ayıklamayı aç. Kabloyu bağladıktan sonra telefondaki bilgisayar iznini onayla.
                  </p>
                  <div className="control-buttons" style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                    <button className="small" onClick={scanDevices} disabled={androidBusy} style={{ minWidth: "158px", padding: "13px 18px" }}>
                      USB Cihazı Tara
                    </button>
                    <button className="control-toggle" onClick={() => startAndroidMirror("usb")} disabled={androidBusy} style={{ minWidth: "210px", padding: "13px 20px" }}>
                      {androidBusy ? "İşlem sürüyor..." : "USB Kontrolünü Başlat"}
                    </button>
                  </div>
                </div>
              </article>

              <article className="ipad-card" style={{ display: "grid", gridTemplateColumns: "54px minmax(0, 1fr)", gap: "20px", padding: "23px", border: "1px solid #334155", borderRadius: "18px" }}>
                <div className="step-number" style={{ width: "46px", height: "46px", fontSize: "20px" }}>2</div>
                <div className="form-area" style={{ minWidth: 0 }}>
                  <h3 style={{ margin: "0 0 8px", fontSize: "21px" }}>Kablosuz İle Kontrol Et</h3>
                  <p style={{ margin: "0 0 18px", lineHeight: 1.6 }}>
                    Telefon ile Pardus aynı Wi-Fi ağında olmalıdır. İlk bağlantıda aşağıdaki USB kurulumunu bir kez tamamla.
                  </p>

                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) minmax(280px, 0.8fr)", gap: "16px", alignItems: "stretch", marginBottom: "18px" }}>
                    <div role="note" style={{ padding: "19px 21px", border: "1px solid rgba(245, 158, 11, 0.65)", borderRadius: "15px", background: "rgba(245, 158, 11, 0.08)" }}>
                      <span style={{ display: "inline-block", marginBottom: "8px", padding: "4px 9px", borderRadius: "999px", background: "rgba(245, 158, 11, 0.18)", color: "#fbbf24", fontSize: "12px", fontWeight: 800 }}>
                        İLK BAĞLANTI
                      </span>
                      <h4 style={{ margin: "0 0 8px", fontSize: "18px", color: "#f8fafc" }}>Önce USB kablosu gereklidir</h4>
                      <p style={{ margin: "0 0 14px", lineHeight: 1.55, color: "#cbd5e1" }}>
                        USB hata ayıklamayı Ve Kablosuz Hata Ayıklamayı aç, kabloyu bağla ve telefondaki izni onayla. Sistem kablosuz ADB bağlantısını hazırlayacaktır.
                      </p>
                      <button className="control-toggle" onClick={() => startAndroidMirror("wireless")} disabled={androidBusy} style={{ width: "100%", padding: "13px 16px" }}>
                        {androidBusy ? "Kurulum hazırlanıyor..." : "USB ile İlk Kablosuz Kurulumu Yap"}
                      </button>
                    </div>

                    <div style={{ padding: "19px 21px", border: "1px solid rgba(34, 211, 238, 0.55)", borderRadius: "15px", background: "rgba(34, 211, 238, 0.07)" }}>
                      <span style={{ display: "inline-block", marginBottom: "8px", padding: "4px 9px", borderRadius: "999px", background: "rgba(34, 211, 238, 0.14)", color: "#67e8f9", fontSize: "12px", fontWeight: 800 }}>
                        SONRAKİ BAĞLANTILAR
                      </span>
                      <h4 style={{ margin: "0 0 8px", fontSize: "18px", color: "#f8fafc" }}>Kablosuz devam et</h4>
                      <p style={{ margin: "0 0 14px", lineHeight: 1.55, color: "#cbd5e1" }}>
                        İlk kurulum tamamlandıysa kabloyu çıkar. Telefon ve Pardus aynı Wi-Fi ağında kalsın.
                      </p>
                      <button className="control-toggle" onClick={() => startAndroidMirror("wireless")} disabled={androidBusy} style={{ width: "100%", padding: "13px 16px" }}>
                        {androidBusy ? "Bağlanıyor..." : "Kablosuz Kontrolü Başlat"}
                      </button>
                    </div>
                  </div>

                  <details style={{ padding: "14px 16px", border: "1px solid #334155", borderRadius: "13px", background: "rgba(15, 23, 42, 0.38)" }}>
                    <summary style={{ cursor: "pointer", color: "#67e8f9", fontWeight: 800 }}>Kurulum şartlarını göster</summary>
                    <ol style={{ margin: "13px 0 0", paddingLeft: "22px", lineHeight: 1.75 }}>
                      <li>Telefon ile Pardus bilgisayarını aynı Wi-Fi ağına bağla.</li>
                      <li>Geliştirici Seçeneklerini Aç</li>
                      <li>USB hata ayıklamayı aç ve bilgisayar iznini onayla.</li>
                      <li>Kablosuz hata ayıklamayı aç ve bilgisayar iznini onayla.</li>
                    </ol>
                  </details>
                </div>
              </article>

              <aside className="ipad-help" style={{ padding: "20px 22px", marginBottom: "12px", border: "1px solid rgba(34, 211, 238, 0.4)", borderRadius: "18px", background: "rgba(34, 211, 238, 0.06)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", marginBottom: "12px" }}>
                  <div>
                    <span style={{ display: "block", color: "#94a3b8", fontSize: "12px", fontWeight: 700, letterSpacing: "1px", marginBottom: "5px" }}>ANLIK DURUM</span>
                    <h3 style={{ margin: 0, color: "#67e8f9", fontSize: "20px" }}>Bağlantı durumu</h3>
                  </div>
                  <span className={androidDevices.length ? "status-badge success" : "status-badge"}>
                    {androidDevices.length ? `${androidDevices.length} cihaz bulundu` : "Cihaz bekleniyor"}
                  </span>
                </div>
                {androidDevices.length === 0 ? (
                  <p style={{ margin: 0, lineHeight: 1.6 }}>Henüz hazır Android bağlantısı bulunamadı. USB cihazını bağlayıp “Cihazları Yenile” düğmesini kullan.</p>
                ) : (
                  <div style={{ display: "grid", gap: "10px" }}>
                    {androidDevices.map((device) => (
                      <div key={device.id} style={{ display: "flex", justifyContent: "space-between", gap: "12px", padding: "12px 14px", borderRadius: "12px", background: "rgba(15, 23, 42, 0.55)" }}>
                        <strong>{device.id}</strong>
                        <span style={{ color: "#94a3b8" }}>{device.connection} · {device.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </aside>
            </div>
          </section>
        )}
        {panel === "ios" && (
          <section className="ipad-panel">
            <div className="topbar">
              <div>
                <h2>iOS Kontrol</h2>
                <p>
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
                Sistemi Kapatıp Mouse'u Pardus'a geri almak için: Sol Ctrl + K (Şifreden 3 Saniye Sonra Mouse Geri Gelecek)
              </p>
            </div>
            <div className="ipad-content">
              <article className="ipad-card">
                <div className="step-number">1</div>
                <div className="form-area">
                  <h3>iOS Kontrolü İçin Önce Mouse aygıtını seç</h3>
                  <p>
                   iOS Kontrolü İçin Listeden kullandığın mouse’u (mouse modeli) bul ve başındaki event numarasını aşağıdaki kutucukta seç. 
                  </p>
                  <button
                    className="input-list-button"
                    onClick={listInputDevices}
                    disabled={inputListLoading || ipadControlActive || iosSessionBusy}
                  >
                    {inputListLoading ? "Aygıtlar Taranıyor..." : "Aygıtları Göster"}
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
                  <h3>iOS kontrolünü tek tuşla yönet</h3>
                  <p
  style={{
    color: "#e2e8f0",
    fontSize: "18px",
    lineHeight: 1.6,
  }}
>
  <strong style={{ color: "#fbbf24" }}>
    Önemli Uyarı:
  </strong>{" "}
  Sol CTRL + K yapıp çıkarken şifre ekranında mouse çalışmayacağından
  şifre girdikten sonra Enter'a basın.              (Şifreden 3 Saniye Sonra Mouse Geri Gelecek)     
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
                          : "iOS Kontrolünü Başlat"}
                    </button>
                  </div>
                </div>
              </article>

              <aside className="ipad-help">
                <h3>Kullanım Kılavuzu</h3>
                <ol>
                  <li>iOS Ayarlar → Erişilebilirlik → Dokunma bölümünden AssistiveTouch açılır.</li>
                  <li>Mouse kontrolü olmadan sadece ekranı görmek istediğinizde kontrol geldikten sonra sol ctrl + k yapın</li>
                  <li>Eğer Fare Yavaşsa AssistiveTouch ayarlarından işaretçi hızı ayarlanabilir</li>
                  
                </ol>
                
              </aside>
            </div>
          </section>
        )}
        {panel === "tablet" && (
          <section className="ipad-panel">
            <div
              className="topbar"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "20px",
                padding: "20px",
              }}
            >
              <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                <h2
                  style={{
                    margin: "0 0 10px",
                    color: "#f8fafc",
                    fontSize: "27px",
                    fontWeight: 800,
                    lineHeight: 1.2,
                    textAlign: "left",
                  }}
                >
                  İkinci Ekran
                </h2>
                <p
                  style={{
                    margin: 0,
                    color: "#e2e8f0",
                    fontSize: "16px",
                    fontWeight: 500,
                    lineHeight: 1.6,
                    textAlign: "left",
                    opacity: 1,
                  }}
                >
                  Tablet veya telefonu ek monitör olarak kullanın. Bilgisayarınızı
                  uzaktan kontrol edin veya kalem destekli cihazınızla çizim yapın.
                </p>
              </div>
              <span
                className={tabletActive ? "status-badge success" : "status-badge"}
                style={{ flexShrink: 0 }}
              >
                {tabletActive ? "Weylus Açık" : "Weylus Kapalı"}
              </span>
            </div>

            <div className="ipad-content">
              <article className="ipad-card">
                <div className="step-number">1</div>
                <div className="form-area">
                  <h3>İkinci Ekranı Tek Tuşla Başlat</h3>
                  <p>
                    
                  </p>
                  <button
                    className={tabletActive ? "control-toggle active" : "control-toggle"}
                    onClick={toggleTablet}
                    disabled={tabletBusy}
                  >
                    {tabletBusy
                      ? "İşlem sürüyor..."
                      : tabletActive
                        ? "Kapat"
                        : "Başlat"}
                  </button>
                </div>
              </article>

             

              <aside className="ipad-help">
                <h3>Kullanım Koşulları</h3>
                <ol>
                 <li style={{ marginBottom: "50px" }}>
  Tablet ve Pardus aynı ağda olmalıdır.
</li>
                  <li>Bilgisayarınızı uzaktan kontrol edip veya kalem destekli cihazınızla çizim yapabilisiniz.</li>
                  <li>Başlat Tuşuna Basınca Çıkan Pencerede Varsa VAAPI NVENC Ayarları Etkin Olsun.</li>
                  <li>Çıkan Pencerede Direkt Start Tuşuna Basın Ve Çıkan QR Kodu İkinci Cihazdan Okutun.</li>
                  <li>Okumazsa Pencerede Çıkan Adresi Tarayıcıya Yazıpta Çalıştırabilirsiniz.</li>
                  <li>Gözükecek Ekran vs Gibi Ayarları Cihaz Bağlanınca Cihaz Üzerindeki Menüden Ayarlayabilirsiniz.</li>
                  <li>
                    Linux uinput izinleri etkinse basınç ve eğim bilgileri aktarılır.
                  </li>
                </ol>
              </aside>
            </div>
          </section>
        )}
        {panel === "share" && (
          <section className="ipad-panel">
            <div className="topbar">
              <div>
                <h2>Pardus Ağı ve Dosya Paylaşımı Android İos Pc Hertürlü Cihazda Çalışır </h2>
                <p>
            
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

            <div
              role="note"
              style={{
                margin: "16px 20px 0",
                padding: "16px 18px",
                border: "1px solid rgba(34, 211, 238, 0.55)",
                borderRadius: "16px",
                background: "rgba(34, 211, 238, 0.08)",
                color: "#e2e8f0",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
                <span
                  aria-hidden="true"
                  style={{
                    width: "30px",
                    height: "30px",
                    flex: "0 0 30px",
                    display: "grid",
                    placeItems: "center",
                    borderRadius: "50%",
                    background: "#22d3ee",
                    color: "#082f49",
                    fontWeight: 900,
                  }}
                >
                  i
                </span>
                <div>
                  <strong style={{ display: "block", marginBottom: "6px", color: "#a5f3fc" }}>
                    iPhone ve iPad için Safari bağlantı Uyarısı
                  </strong>
                  
                  <p style={{ margin: "0 0 8px", color: "#e2e8f0", lineHeight: 1.55 }}>
                    iPhone veya iPad'de <strong>Ayarlar → Uygulamalar → Safari → Gizlilik ve
                    Güvenlik</strong> bölümünden <strong>Güvenli Olmayan Bağlantı Uyarısı </strong>
                    seçeneğini paylaşım süresince kapat. Ardından aşağıdaki paylaşım adresini
                    Safari'nin adres çubuğuna yeniden yaz.
                  </p>
                  <small style={{ color: "#e2e8f0", lineHeight: 1.5 }}>
                    Bu işlem yalnızca CommunicatePars yerel bağlantısını açmak içindir.
                    Dosya aktarımı tamamlandığında ayarı tekrar açabilirsin.
                  </small>
                </div>
              </div>
            </div>

            <div className="ipad-content">
              <article className="ipad-card">
                <div className="step-number">1</div>
                <div className="form-area">
                  <h3>Pardus ağını aç</h3>
                  <p style={{ lineHeight: 1.7 }}>
  Pardus ağını aç ve dosya paylaşacağın cihazı{" "}
  <strong>CommunicatePars</strong> adlı Wi-Fi ağına bağla.</p><p>
   {" "}
  <strong style={{ color: "#f1f1f1" }}>
   Bağlantının çalışması için diğer cihazda mobil veriyi hücresel veriyi kapat!
  </strong>
  
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
                  <h3>Telefonda Tarayıcıyı (Örn: Safari,Chrome) aç</h3>
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
                      
                    </p>
                  )}
                </div>
              </article>

              <article className="ipad-card">
                <div className="step-number">3</div>
                <div className="form-area">
                  <h3>PC'den diğer cihaza dosya gönder</h3>
                  <p>
                    Dosyalar için “Dosya Seç”, görseller için
                    “Fotoğraf Seç” düğmesini kullan.
                  </p>
                <div
  className="control-buttons"
  style={{
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(180px, 220px))",
    justifyContent: "center",
    gap: "16px",
    marginTop: "22px",
    width: "100%",
  }}
>
  <label
    className="input-list-button"
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: "100%",
      minHeight: "50px",
      padding: "0 20px",
      boxSizing: "border-box",
      whiteSpace: "nowrap",
      borderRadius: "12px",
background: "#22d3ee",
color: "#082f49",
WebkitTextFillColor: "#082f49",
fontSize: "16px",
fontWeight: 800,
cursor: shareBusy ? "not-allowed" : "pointer",
opacity: shareBusy ? 0.6 : 1,
    }}
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
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: "100%",
      minHeight: "50px",
      padding: "0 20px",
      boxSizing: "border-box",
      whiteSpace: "nowrap",
      border: "none",
borderRadius: "12px",
background: "#22d3ee",
color: "#082f49",
WebkitTextFillColor: "#082f49",
fontSize: "16px",
fontWeight: 800,
cursor: shareBusy ? "not-allowed" : "pointer",
opacity: shareBusy ? 0.6 : 1,
     background: "#22d3ee",
color: "#082f49",
WebkitTextFillColor: "#082f49",
fontSize: "16px",
fontWeight: 800,
    }}
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
                <div>
  <h3 style={{ margin: 0 }}>
    Paylaşılan dosyalar
  </h3>

  <p
    style={{
      margin: "8px 0 0",
      color: "#cbd5e1",
      fontSize: "14px",
    }}
  >
    Dosya Görünmüyorsa Yenile Düğmesine Basın.
  </p>
</div>
                
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
  <section
    className="whatsapp"
    style={{
      width: "100%",
      height: "100vh",
      margin: 0,
      padding: 0,
      overflow: "hidden",
      background: "#ffffff",
    }}
  >
    {React.createElement("webview", {
      className: "webview",
      src: "https://web.whatsapp.com/",
      allowpopups: "true",
      partition: "persist:whatsapp",
      useragent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      style: {
        display: "flex",
        width: "100%",
        height: "100%",
        border: 0,
      },
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
                                   <h2
  id="ios-info-title"
  style={{
    margin: "0 0 8px",
    color: "#000000",
    fontWeight: 800,
  }}
>
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
                      pardus (cihaz adınız) cihazını bul ve bağlan.
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
                      Bluetooth Bağlandıktan Sonra Ekranı yansıt
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
                  Sistemi Kapatıp Mouse'u PC'ye geri almak için
                </strong>
                <span style={{ fontSize: "18px" }}>
                  Pardus klavyesinde <strong>Sol Ctrl + K</strong> tuşlarına bas. (Şifreden 3 Saniye Sonra Mouse Geri Gelecek)
                
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