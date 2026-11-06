@echo off
REM =============================================================
REM  BUOC 1: CAI DAT (Windows) - chi can chay 1 lan tren moi may
REM  Cach chay: nhap dup vao file nay
REM =============================================================
chcp 65001 >nul
cd /d "%~dp0"
title Cai dat Game Sonic
set "PATH=%ProgramFiles%\nodejs;%APPDATA%\npm;%PATH%"

echo ==============================================
echo    CAI DAT GAME SONIC (Windows)
echo ==============================================
echo.

REM ---- 1. Node.js -------------------------------------------
echo [1/3] Kiem tra Node.js...
call :check_node
if "%NODE_OK%"=="1" goto node_ready

echo       Chua co Node.js (hoac ban qua cu). Dang cai dat, vui long cho...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-node-windows.ps1"
set "PATH=%ProgramFiles%\nodejs;%APPDATA%\npm;%PATH%"
call :check_node
if "%NODE_OK%"=="1" goto node_ready

echo.
echo       LOI: Khong cai duoc Node.js tu dong.
echo       Hay tu cai tai https://nodejs.org (chon ban LTS), roi chay lai file nay.
goto fail

:node_ready
for /f "delims=" %%v in ('node -v') do echo       OK - da co Node.js %%v
echo.

REM ---- 2. Thu vien cua du an --------------------------------
echo [2/3] Cai thu vien cho du an (npm install)...
call npm install --no-audit --no-fund --loglevel=error
if errorlevel 1 (
  echo.
  echo       LOI: npm install that bai. Kiem tra mang Internet roi chay lai.
  goto fail
)
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
pause
exit /b 0

:fail
echo.
pause
exit /b 1

:check_node
set "NODE_OK=0"
where node >nul 2>nul
if errorlevel 1 exit /b 0
for /f "usebackq delims=" %%m in (`node -p "process.versions.node.split('.')[0]"`) do (
  if %%m GEQ 20 set "NODE_OK=1"
)
exit /b 0
