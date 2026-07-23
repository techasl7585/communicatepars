# CommunicatePars hidclient kaynağı

Bu dizindeki `hidclient.c`, aşağıdaki GPL-2.0 projesinin sabitlenmiş
`e98caecfd780cbdbbcc56f488591e58e79bcd0f8` revizyonundan alınmıştır:

https://github.com/benizi/hidclient

CommunicatePars değişikliği, yalnızca `--rotate-cw` seçeneğini ekler. Bu
seçenek bağıl mouse X/Y eksenlerini saat yönünde 90 derece döndürür ve dikey
iPhone ekranındaki yön uyuşmazlığını düzeltir. Seçenek verilmediğinde özgün
yatay/tablet davranışı korunur.

Derleme:

```bash
gcc -O2 -Wall -o ../hidclient hidclient.c -lbluetooth
```
