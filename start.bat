@echo off
cd /d "%~dp0"
title TabaxiTable
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js ne nayden. Ustanovi ego s https://nodejs.org/
  pause
  exit /b 1
)
if not exist node_modules (
  echo Pervyy zapusk: ustanavlivayu zavisimosti...
  call npm install
  if errorlevel 1 (
    echo Oshibka ustanovki. Prover internet i zapusti fayl eshche raz.
    pause
    exit /b 1
  )
)
set AUTO_OPEN=1
echo Zapusk TabaxiTable. Brauzer otkroetsya avtomaticheski...
call npm start
pause
