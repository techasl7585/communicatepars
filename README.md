# CommunicatePars Pardus Cihaz Bağlantı Merkezi

CommunicatePars, Pardus işletim sistemi için geliştirilen açık kaynaklı bir cihaz entegrasyon uygulamasıdır. Android, iOS ve diğer ağ cihazlarıyla dosya paylaşımı, ekran yansıtma, uzaktan kontrol ve ikinci ekran gibi özellikleri tek bir arayüz altında sunmayı amaçlar.

- CommunicatePars; İos Kontrol Özelliği İçerisinde İphone veya İpad cihazınızın ekranını pardustan görüp ve pardus üzerinden cihazı Kontrol etmeyi aynı anda sağlayan ilk defa bizim yaptığımız ios kontrol yazılımını barındırıyor.

- Ayrıca İkinci Ekran Özelliği içerisinde bilgisayarınız için diğer cihazınızı ikinci ekran olarak kullanabileceğiniz veya diğer cihazınızdan bilgisayarınızı dokunmatik olarak veya kalem destekli (apple pencil Samsung Spen veya farklı tablet ve kalemleri) kontrol imkanı sunuyor.

- Dosya Paylaşım Bölümde ise pardus ağı üzerinden wifi bağlanan her türlü cihaza yüksek hızlı dosya paylaşım imkanı sunuyor.

- Android kontrol bölümde ise android cihazınızı kablolu veya kablosuz olarak tek tuşla kontrol edebilirsiniz.

- İçerisindeki whatsapp paneli sayesinde whatsapp mesajlarınızı yönetebilirsiniz.

- Ana ekranda bağlı bluetooth cihazlarınızın ve fare gibi çevre birimlerinizin pil durumunu görebilirsiniz

- Bu Uygulama İçerisindeki Güçlü Özellikler İle Cihazlar Arası İşlemlerinizi Daha Hızlı Ve Pratik Şekilde Yönetmenize İmkan Sağlar

## Gereksinimler

- Kurulum İçin İnternet Bağlantısı (İnternet kesilirse kurulum kesilir bu durumda kurulumu yeniden başlatın tarif edilen şekilde)
  
- İos Kontrolü Çalışması İçin X11 Masaüstü Ortamına Geçmeniz Gerekmektedir Aşağıda Geçiş adımları anlatılmıştır
  
- Pardus GNOME
  
- Bilgisayarınızda Bluetooth Ve Wifi Özelliğinin Olması Gerekir Özelliklerin Çalışması İçin
  
- İos Kontrolü İçin usb Fare (Touchpad desteklenmiyor , bluetooth fare test edilmedi)




## İlk kurulum

Uygulamayı Kurmak için github üzerinden sağ üst köşedeki yeşil code kısmından "download zip" basıp indirin indirdiğiniz
ZIP dosyasını çıkardıktan sonra çıkarttığınız klasöre girin ve terminalde şu komutları girin:

```bash
chmod +x install-pardus.sh start-communicatepars.sh check-system.sh
./install-pardus.sh
```

Kurulum Bitince CommunicatePars'ı Pardus uygulamalar menüsüne ve masaüstüne ekler Kurulum Bitince eğer X11 masaüstü ortamına geçmediyseniz aşağıdaki adımlarla geçin yoksa ios kontrol özelliği çalışmaz. Geçtikten sonra uygulamayı sorunsuz şekilde çalıştırabilirsiniz.

## X11 Masaüstü Ortamına Geçiş (İos Kontrol Özelliğinin Çalışması İçin)

- Uçbirimi (Terminali) açın.

- Pardus GNOME İçin: Terminale Kodu girin ve enter'a basın: sudo nano /etc/gdm3/daemon.conf
  
- Açılan metin editöründe #waylandEnable=false satırını bulun
ve yön oklarıyla # işaretinini bi yanına gelerek başındaki # işaretini silerek
waylandEnable=false haline getirin.
(Eger bu satir yoksa [daemon] veya
[seat:*] bölümünün altına ekleyin).

- Dosyayı kaydedip çikmak için Ctrl + O, Enter ve ardından Ctrl + X tuslarına basın.
  
- Değişikliklerin Çalışması için bilgisayarınızı yeniden başlatın.


  

