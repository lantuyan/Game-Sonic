@echo off
REM =============================================================
REM  BUOC 2: CHAY GAME (Windows)
REM  Cach chay: nhap dup vao file nay
REM  - Cua so nay se hien link http://localhost:3000 -> mo tren trinh duyet
REM  - Sua code va luu lai -> trinh duyet tu cap nhat, KHONG can chay lai
REM  - Muon tat: dong cua so nay hoac nhan Ctrl + C
REM =============================================================
chcp 65001 >nul
pushd "%~dp0"
title Game Sonic - DANG CHAY - dong cua so nay de tat game
set "PATH=%ProgramFiles%\nodejs;%APPDATA%\npm;%PATH%"

if not exist "package.json" goto not_extracted
if not exist "scripts\dev.js" goto not_extracted

call :check_node
if "%NODE_OK%"=="1" goto node_ready
echo Chua cai Node.js ^(hoac ban qua cu^).
echo Hay chay file 1-install.bat truoc, roi chay lai file nay.
goto fail

:node_ready
REM Kiem tra thu vien da cai du chua (khong chi kiem tra thu muc node_modules)
node -e "require('express');require('dotenv');require('bcryptjs');require('@electric-sql/pglite')" >nul 2>nul
if not errorlevel 1 goto modules_ok
echo Thu vien chua cai du, dang cai - npm install...
where npm >nul 2>nul
if errorlevel 1 (
  echo LOI: Thieu npm. Hay chay lai file 1-install.bat.
  goto fail
)
call npm install --no-audit --no-fund --loglevel=error
if errorlevel 1 (
  echo LOI: npm install that bai. Hay chay lai file 1-install.bat.
  goto fail
)

:modules_ok
node scripts\setup-local.js
if errorlevel 1 goto fail

echo.
echo Dang khoi dong game... ^(Neu Windows Firewall hoi, bam Allow / Cho phep^)
node scripts\dev.js
if errorlevel 1 goto fail
popd
exit /b 0

:not_extracted
echo LOI: Khong tim thay day du file cua game.
echo      Neu ban dang mo tu file .zip: bam chuot phai vao file zip,
echo      chon "Extract All" de giai nen, roi chay file trong thu muc da giai nen.
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
where node >nul 2>nul
if errorlevel 1 exit /b 0
for /f "tokens=1 delims=v." %%m in ('node -v 2^>nul') do set "NODE_MAJOR=%%m"
if not defined NODE_MAJOR exit /b 0
echo %NODE_MAJOR%| findstr /r "^[0-9][0-9]*$" >nul
if errorlevel 1 exit /b 0
if %NODE_MAJOR% GEQ 20 set "NODE_OK=1"
exit /b 0
