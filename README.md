# LeadCall

Şehir ve iş kolunu yaz, işletmeleri listele, ara, görüşmeyi kaydet. Yapay zeka görüşmeyi yazıya çevirir, özetler ve **“geri dönüş skoru”** verir: bu işletmeye tekrar dönmeye değer mi?

## Başlamak için

1. **Node.js’i kur** (ücretsiz, bir kez): [nodejs.org](https://nodejs.org/tr/download) → “LTS” sürümü.
2. **Başlat dosyasına çift tıkla:**
   - Windows: `baslat.bat`
   - Mac: `baslat.command` (ilk seferde sağ tık → Aç)
   - Linux: terminalde `./baslat.sh`
3. Tarayıcı kendiliğinden açılır. Açılmazsa pencerede yazan adresi (genelde `http://localhost:3000`) tarayıcına yapıştır.

İlk açılışta kurulum kendiliğinden yapılır (1-2 dakika). Sonraki açılışlar birkaç saniye sürer. Kapatmak için siyah pencereyi kapat.

> Terminal kullanmayı seviyorsan: `npm install` ve `npm start`.

## İlk kullanım

Ekrandaki **Kurulum** kutusu seni yönlendirir; dosya düzenlemen gerekmez. Sağ üstteki **Ayarlar**’dan:

| Ne için | Ne yapmalısın | Zorunlu mu? |
| --- | --- | --- |
| Ne sattığın | Bir cümle yaz. Skor buna göre verilir. | Önerilir |
| İşletme arama | [serpapi.com](https://serpapi.com) ya da [serper.dev](https://serper.dev) anahtarını yapıştır (biri yeter). | İsteğe bağlı; yoksa ücretsiz harita verisi kullanılır ama telefonlar eksik çıkar |
| Sesi yazıya çevirme | [console.groq.com](https://console.groq.com) → API Keys | Ses kaydı için |
| Yapay zeka analizi | [build.nvidia.com](https://build.nvidia.com) → Get API Key | Skor ve özet için |

Her anahtarın yanındaki **Test et** düğmesi çalışıp çalışmadığını söyler.

**Anahtarsız denemek istersen:** ekrandaki “Önce örnek verilerle dene”ye bas. Sahte işletmelerle arayüzü gezebilirsin.

## Günlük kullanım

1. Şehir ve iş kolunu yaz (ya da alttaki öneri düğmelerinden birini seç) → **İşletmeleri bul**.
2. Listeden bir işletmeye tıkla. Sağda telefon numarası, durum ve notların açılır.
3. Aramaya başlarken mikrofon düğmesine bas, bitince tekrar bas. Karşı tarafın sesi de kaydolsun diye aramayı hoparlöre al.
4. Birkaç saniye içinde özet, notlar, itirazlar, sonraki adım ve geri dönüş skoru gelir.

Diğer özellikler:

- **Kendi listemi ekle:** Excel’den kopyalayıp yapıştır. Her satır: `işletme adı ; telefon ; adres`.
- **Kayıtlılarım:** Aradığın ya da not aldığın tüm işletmeler.
- **Filtreler:** Henüz aranmadı, Aradıklarım, Sıcak (%60+), Reddedenler.
- Ses olmadan da çalışır: “konuşma metnini yapıştır” ile elindeki metni analiz ettirebilirsin.
- Bir adım hata verirse kayıt silinmez; **Yeniden dene** ile tekrar işlenir.
- Aynı arama 7 gün boyunca kayıttan gelir (arama kredin harcanmaz). “Güncel sonuçları getir” ile yenileyebilirsin.

## Verilerin nerede?

Her şey bilgisayarında kalır: kayıtlar `data/db.json`, sesler `data/recordings/`, ayarlar `data/settings.json`. Uygulama varsayılan olarak **sadece senin bilgisayarından** erişilebilir; aynı ağdaki başkaları göremez.

Yedek almak için `data` klasörünü kopyalaman yeterli.

## Sık sorulanlar

**“Node.js bulunamadı” diyor.** Node.js’i kurduktan sonra bilgisayarı yeniden başlatmadan `baslat` dosyasına tekrar çift tıklamayı dene; olmazsa bilgisayarı yeniden başlat.

**Mikrofon çalışmıyor.** Tarayıcı izin ister: adres çubuğundaki mikrofon simgesinden izin ver. Sayfa `localhost` üzerinden açılmalıdır.

**Telefon numaraları eksik.** Ücretsiz harita verisi küçük işletmelerin telefonunu çoğu zaman içermez. Ayarlar’dan SerpApi ya da Serper anahtarı ekle.

**Başka bilgisayarda/telefonda kullanabilir miyim?** Varsayılan olarak hayır (güvenlik için). Bunu bilerek açmak istiyorsan `.env` dosyasına `HOST=0.0.0.0` yaz; anahtarlarına ve kayıtlarına ağdaki herkes ulaşabilir, bu yüzden önermiyoruz.

**Ayarları dosyadan yönetmek istiyorum.** `.env.example` dosyasını `.env` olarak kopyala. Ayarlar ekranında girilen değer `.env`’in önüne geçer.

## Hukuki notlar

- Görüşmeyi kaydederken karşı tarafı bilgilendir; kişisel verilerin işlenmesinde KVKK’ya dikkat et.
- Soğuk arama yaparken İletişim Yönetimi Yönetmeliği’ndeki kurallar (ör. İYS) ticari aramalar için geçerli olabilir; kendi durumuna göre kontrol et.
- Serper ve Google’ın ücretsiz kotaları sınırlıdır; kullanımını kendi hesabından takip et.
