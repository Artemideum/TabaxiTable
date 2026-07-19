@echo off
cd /d "%~dp0"
title TabaxiTable - Update

where git >nul 2>nul
if errorlevel 1 (
  echo Git ne nayden.
  echo Ustanovi Git for Windows: https://git-scm.com/download/win
  echo Posle ustanovki zapusti etot fayl snova.
  pause
  exit /b 1
)

if not exist .git (
  echo Eta kopiya TabaxiTable ne svyazana s GitHub.
  echo Odin raz skachay proekt cherez GitHub Desktop ili komandu git clone.
  pause
  exit /b 1
)

echo Proveryayu obnovleniya TabaxiTable...
git pull --ff-only
if errorlevel 1 (
  echo.
  echo Ne udalos obnovit proekt. Skopiruy tekst oshibki i otprav ego v chat.
  pause
  exit /b 1
)

echo Obnovlyayu zavisimosti...
call npm install
if errorlevel 1 (
  echo Oshibka npm install. Prover internet i zapusti update.bat snova.
  pause
  exit /b 1
)

echo.
echo TabaxiTable obnovlen. Mozhno zapuskat start.bat.
pause
