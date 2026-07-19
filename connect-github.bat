@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title TabaxiTable - GitHub setup

set "GIT_CMD=git"
where git >nul 2>nul
if errorlevel 1 (
  set "GIT_CMD="
  for /d %%D in ("%LOCALAPPDATA%\GitHubDesktop\app-*") do (
    if exist "%%D\resources\app\git\cmd\git.exe" set "GIT_CMD=%%D\resources\app\git\cmd\git.exe"
  )
)

if not defined GIT_CMD (
  echo Git ne nayden.
  echo Ustanovi GitHub Desktop: https://desktop.github.com/
  echo Posle ustanovki zapusti etot fayl snova.
  pause
  exit /b 1
)

if not exist package.json (
  echo Polozhi connect-github.bat imenno v papku TabaxiTable ryadom s package.json.
  pause
  exit /b 1
)

if not exist .git (
  echo Sozdayu lokalnyy repozitoriy...
  "%GIT_CMD%" init
  if errorlevel 1 goto :error
)

"%GIT_CMD%" config user.name >nul 2>nul
if errorlevel 1 "%GIT_CMD%" config user.name "Artemideum"
"%GIT_CMD%" config user.email >nul 2>nul
if errorlevel 1 "%GIT_CMD%" config user.email "305605441+Artemideum@users.noreply.github.com"

"%GIT_CMD%" branch -M main
"%GIT_CMD%" remote get-url origin >nul 2>nul
if errorlevel 1 (
  "%GIT_CMD%" remote add origin https://github.com/Artemideum/TabaxiTable.git
) else (
  "%GIT_CMD%" remote set-url origin https://github.com/Artemideum/TabaxiTable.git
)

echo Dobavlyayu fayly. Komnaty i node_modules ostanutsya tolko na etom PK...
for %%F in (package.json package-lock.json server.js start.bat update.bat connect-github.bat README.md FEATURES.md AGENTS.md Dockerfile .dockerignore .gitignore) do (
  if exist "%%F" "%GIT_CMD%" add -- "%%F"
)
if exist public "%GIT_CMD%" add -- public
if exist test "%GIT_CMD%" add -- test
if exist data\.gitkeep "%GIT_CMD%" add -- data\.gitkeep
if errorlevel 1 goto :error

"%GIT_CMD%" diff --cached --quiet
if errorlevel 1 (
  "%GIT_CMD%" commit -m "Initial TabaxiTable release"
  if errorlevel 1 goto :error
)

echo Otpravlyayu TabaxiTable na GitHub. Mozhet otkrytsya okno vhoda...
"%GIT_CMD%" push -u origin main
if errorlevel 1 goto :error

echo.
echo GOTOVO. TabaxiTable podklyuchen k GitHub.
echo Teper dlya obnovleniya mozhno ispolzovat update.bat ili GitHub Desktop.
pause
exit /b 0

:error
echo.
echo Ne poluchilos. Sdelay skrin etogo okna i otprav ego v chat.
pause
exit /b 1
