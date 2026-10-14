@echo off
chcp 65001 >nul
cd /d "%~dp0"
title LeadCall
echo.
echo  LeadCall baslatiliyor...
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo  Node.js bulunamadi. Bu program icin gerekli ve ucretsiz.
  echo  Simdi indirme sayfasi aciliyor: indirip kur, sonra bu dosyaya tekrar cift tikla.
  start https://nodejs.org/tr/download
  pause
  exit /b 1
)
if not exist node_modules (
  echo  Ilk kurulum yapiliyor, 1-2 dakika surebilir...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo  Kurulum basarisiz oldu. Internet baglantini kontrol edip tekrar dene.
    pause
    exit /b 1
  )
)
node server.js
echo.
echo  LeadCall kapandi.
pause
