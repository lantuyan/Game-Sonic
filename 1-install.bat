@echo off
REM =============================================================
REM  BUOC 1: CAI DAT (Windows) - chi can chay 1 lan tren moi may
REM  Cach chay: nhap dup vao file nay
REM =============================================================
chcp 65001 >nul
pushd "%~dp0"
title Cai dat Game Sonic
set "PATH=%ProgramFiles%\nodejs;%APPDATA%\npm;%PATH%"

echo ==============================================
echo    CAI DAT GAME SONIC - Windows
echo ==============================================
echo.

if not exist "package.json" goto not_extracted
if not exist "scripts\install-node-windows.ps1" goto not_extracted

echo "%~dp0" | "%SystemRoot%\System32\find.exe" /i "OneDrive" >nul
if not errorlevel 1 (
  echo CANH BAO: Thu muc game dang nam trong OneDrive, co the gay loi.
  echo           Neu bi loi, hay chep ca thu muc ra o C:\ ^(vd: C:\Game-Sonic^) roi chay lai.
  echo.
)

REM ---- 1. Node.js -------------------------------------------
echo [1/3] Kiem tra Node.js...
call :check_node
if "%NODE_OK%"=="1" goto node_ready

echo       Chua co Node.js hoac ban qua cu. Dang cai dat, vui long cho...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-node-windows.ps1"
set "PATH=%ProgramFiles%\nodejs;%APPDATA%\npm;%PATH%"
call :check_node
if "%NODE_OK%"=="1" goto node_ready

echo.
echo       LOI: Khong cai duoc Node.js tu dong.
echo       Hay tu cai tai https://nodejs.org - chon ban LTS - roi chay lai file nay.
goto fail

:node_ready
echo       OK - da co Node.js %NODE_VERSION%
where npm >nul 2>nul
if errorlevel 1 (
  echo       LOI: Thieu npm. Hay cai lai Node.js tu https://nodejs.org roi chay lai file nay.
  goto fail
)
echo.

REM ---- 2. Thu vien cua du an --------------------------------
echo [2/3] Cai thu vien cho du an - npm install...
call npm install --no-audit --no-fund --loglevel=error
if not errorlevel 1 goto npm_ok
echo       Lan 1 bi loi, dang thu lai...
call npm install --no-audit --no-fund --loglevel=error
if not errorlevel 1 goto npm_ok
echo.
echo       LOI: npm install that bai.
echo       - Kiem tra mang Internet roi chay lai file nay.
echo       - Neu van loi: chup man hinh cua so nay gui giao vien.
goto fail

:npm_ok
echo       OK
echo.

REM ---- 3. File cau hinh .env --------------------------------
echo [3/3] Tao file cau hinh...
node scripts\setup-local.js
if errorlevel 1 goto fail

echo.
echo ==============================================
echo    CAI DAT XONG!
echo    Buoc tiep theo: nhap dup vao file 2-start.bat
echo ==============================================
echo.
popd
pause
exit /b 0

:not_extracted
echo LOI: Khong tim thay day du file cua game.
echo      Neu ban dang mo tu file .zip: bam chuot phai vao file zip,
echo      chon "Extract All" de giai nen, roi chay 1-install.bat trong thu muc da giai nen.
goto fail

:fail
echo.
popd
pause
exit /b 1

REM ---- Ham kiem tra Node.js ^>= 20 ----------------------------
:check_node
set "NODE_OK=0"
set "NODE_MAJOR="
set "NODE_VERSION="
where node >nul 2>nul
if errorlevel 1 exit /b 0
for /f "delims=" %%v in ('node -v 2^>nul') do set "NODE_VERSION=%%v"
for /f "tokens=1 delims=v." %%m in ('node -v 2^>nul') do set "NODE_MAJOR=%%m"
if not defined NODE_MAJOR exit /b 0
echo %NODE_MAJOR%| findstr /r "^[0-9][0-9]*$" >nul
if errorlevel 1 exit /b 0
if %NODE_MAJOR% GEQ 20 set "NODE_OK=1"
exit /b 0
