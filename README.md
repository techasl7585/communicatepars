# CommunicatePars — Pardus kurulumu

Bu paket taşınabilir hâle getirilmiştir; klasörü kullanıcı adından veya konumundan bağımsız olarak çalıştırır.

## İlk kurulum

ZIP dosyasını çıkardıktan sonra terminali proje klasöründe açın:

```bash
chmod +x install-pardus.sh start-communicatepars.sh check-system.sh
./install-pardus.sh
```

Kurulum Weylus Community Edition, `/dev/uinput` izinleri ve Bluetooth HID
uyumluluk ayarını da otomatik hazırlar. Tamamlandıktan sonra bir kez oturumu
kapatıp açın (en güvenlisi bilgisayarı yeniden başlatmaktır), ardından kontrol edin:

```bash
./check-system.sh
```

`Sonuç: 0 hata` görülüyorsa uygulamayı açın:

```bash
./start-communicatepars.sh
```

## Gereksinimler

- Pardus/Debian tabanlı x86_64 bilgisayar
- Node.js 20.19+, 22.12+ veya daha yeni sürüm
- iPad kontrolü için çalışan Bluetooth adaptörü
- Grafik masaüstü oturumu (X11 veya XWayland)

Paketteki `hidclient` x86_64 için derlenmiştir ve `libbluetooth.so.3` kullanır. Kurulum betiği gerekli `libbluetooth3` paketini yükler.

## iPad mouse kontrolü

1. Geliştirme bilgisayarındaki çalışan ayar korunarak varsayılan mouse girişi
   **event8** yapılmıştır. Farklı bir bilgisayarda mouse numarası değişirse
   **Aygıtları Göster** düğmesi aygıt listesini yeniler ancak otomatik seçim
   yapmaz. Listede `+` seçilebilir mouse'u, `-` seçilemeyen aygıtı gösterir.
   Kullanacağınız `+` işaretli event'i menüden kendiniz seçmelisiniz. Yalnızca
   bu seçim iOS kontrolüne gönderilir ve kapatırken aynı aygıt geri bağlanır;
   uygulama başka bir event'e kendiliğinden geçmez.
   **Touchpad desteklenmez**; harici USB veya Bluetooth mouse kullanın.
2. **iOS Kontrolünü Başlat** düğmesine basın ve Pardus parola penceresini onaylayın.
3. iPad'de **Ayarlar → Bluetooth → CommunicatePars** cihazına dokunun.
4. Önceki sürümle başarısız eşleştirme varsa iPad'de cihazı **Bu Aygıtı Unut**
   ile silip yeniden eşleştirin.
5. Mouse'u Pardus'a geri vermek için **Sol Ctrl+K** kullanın. Kapatırken iki
   ayrı Pardus yönetici parola penceresi çıkabilir; mouse çalışmadığı için
   parolayı klavyeyle yazıp Enter'a basın. İlk işlem yalnızca paket içindeki
   `hidclient` sürecini doğrudan `SIGKILL (-9)` ile keser. İkinci işlem seçtiğiniz
   event'in gerçek USB üst aygıtını sürücüden ayırıp bir saniye sonra yeniden
   bağlar. Son olarak aynı event XInput ana işaretçisine eklenir. USB olmayan
   mouse'larda udev ve XInput geri yükleme yolu otomatik kullanılır.

Eşleştirme düğmesi BlueZ `NoInputNoOutput` agent'ının kaydolmasını bekler, onu
varsayılan agent yapar ve görünürlüğü ancak bundan sonra açar. Bazı BlueZ
sürümlerinin yine de metin olarak sorduğu iOS onayı, yalnızca uygulamadaki üç
dakikalık eşleştirme penceresinde otomatik kabul edilir. Böylece masaüstü
agent'ına düşen ve 30 saniye sonra `Authentication Failure (0x05)` oluşturan
yarış durumu engellenir.

Kurulum, Bluetooth servisini yeniden başlattıktan sonra adaptörün hazır olmasını
10 saniyeye kadar bekler. Böylece bazı bilgisayarlarda görülen, hemen ardından
sistem kontrolü başarılı olduğu hâlde kurulum sırasında çıkan geçici
`Bluetooth adaptörü açılamadı` hatası oluşmaz.

Bluetooth HID desteği için kurulum, BlueZ'i `--compat
--noplugin=input,hostname` seçenekleriyle çalıştırır. `hostname` eklentisinin
sınıfı yeniden PC/laptop olarak değiştirmesi engellenir ve Bluetooth sınıfı
`0x0005C0` (klavye + işaretçi çevre birimi) olarak korunur. Uygulama,
`hidclient` HID hizmet kaydını oluşturduktan sonra Bluetooth servisini yeniden
başlatmaz; böylece iPad'in bağlandığı SDP kaydı kaybolmaz.

`bluetoothctl` içindeki `AlreadyExists` mesajı cihazın zaten
eşleşmiş olduğunu gösterir; PC tarafından tekrar `pair` komutu vermeyin.
CommunicatePars HID özelliğini tamamen kaldırmak ve BlueZ varsayılanına dönmek
isterseniz:

```bash
sudo rm /etc/systemd/system/bluetooth.service.d/communicatepars-hid.conf
sudo cp /etc/bluetooth/main.conf.communicatepars-backup /etc/bluetooth/main.conf
sudo systemctl daemon-reload
sudo systemctl restart bluetooth
```

## Weylus ile iPad/tablet bağlantısı

1. Pardus bilgisayar ve iPad'i aynı, güvendiğiniz yerel ağa bağlayın.
2. Uygulamada **İkinci Ekran → Başlat** düğmesine basıp **Weylus Açık** durumunu
   bekleyin.
3. Gösterilen `http://BILGISAYAR_IP:1701` adresini iPad'de Safari ile açın.
   iPad'e ayrıca bir uygulama kurmanız gerekmez.
4. Safari'deki Weylus sayfasından aktarılacak ekranı veya pencereyi seçin ve
   bağlantıyı başlatın. Dokunma/kalem seçeneklerini aynı sayfadan açabilirsiniz.
5. Basınç, eğim ve çoklu dokunma çalışmıyorsa kurulumdan sonra Pardus oturumunu
   kapatıp yeniden açın; bu işlem `/dev/uinput` grup iznini etkinleştirir.
6. iPad'de tam ekran için Safari'nin **Paylaş → Ana Ekrana Ekle** seçeneğini
   kullanabilirsiniz.

Weylus arayüzü bilgisayarda ayrıca açılmaz; uygulama onu `--no-gui` kipinde
başlatır. Kurulum `/dev/uinput` iznini, Wayland/X11 desteğini ve etkin güvenlik
duvarında TCP 1701/9001 kurallarını hazırlar. Weylus trafiği şifrelenmediğinden
yalnızca güvendiğiniz ağlarda kullanın. Weylus varsayılan olarak mevcut ekranı
veya pencereyi aktarır; tek başına yeni bir sanal monitör oluşturmaz.

## Diğer özellikler

Ana uygulama bunlar olmadan açılır; yalnızca ilgili bölüm çalışmaz:

- Android kontrolü: `adb` ve `scrcpy`
- iPad ekran yansıtma: `uxplay`
- İkinci ekran: Weylus Community Edition Flatpak sürümü (otomatik kurulur)

Kurulum betiği Pardus deposunda bulunmayan `scrcpy` için resmî, SHA-256 ile
doğrulanan x86_64 sürümünü kurar. UxPlay depoda varsa otomatik kurulur. Weylus
Community Edition Flathub üzerinden kullanıcı hesabına otomatik kurulur.

## Hata günlüğü

Sunucu açılmazsa şu dosyaya bakın:

```text
~/.local/state/communicatepars/server.log
```

Kurulum ve sistem çıktısını paylaşırsanız sorunu nokta atışı belirlemek için şu komutu kullanın:

```bash
./check-system.sh 2>&1 | tee communicatepars-system-check.txt
```
