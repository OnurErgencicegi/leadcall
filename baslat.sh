#!/bin/bash
# Mac: Finder'da çift tıkla. Linux: terminalde ./baslat.command
cd "$(dirname "$0")"
echo
echo " LeadCall başlatılıyor..."
echo
if ! command -v node >/dev/null 2>&1; then
  echo " Node.js bulunamadı. Bu program için gerekli ve ücretsiz."
  echo " İndirme sayfası açılıyor: kurup bu dosyaya tekrar çift tıkla."
  (open "https://nodejs.org/tr/download" || xdg-open "https://nodejs.org/tr/download") >/dev/null 2>&1
  read -n 1 -s -r -p " Çıkmak için bir tuşa bas..."
  exit 1
fi
if [ ! -d node_modules ]; then
  echo " İlk kurulum yapılıyor, 1-2 dakika sürebilir..."
  npm install --no-audit --no-fund || { echo " Kurulum başarısız. İnternetini kontrol edip tekrar dene."; read -n 1 -s -r; exit 1; }
fi
node server.js
