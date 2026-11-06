@echo off
REM =============================================================
REM  BUOC 2: CHAY GAME (Windows)
REM  Cach chay: nhap dup vao file nay
REM  - Cua so nay se hien link http://localhost:3000 -> mo tren trinh duyet
REM  - Sua code va luu lai -> trinh duyet tu cap nhat, KHONG can chay lai
REM  - Muon tat: dong cua so nay hoac nhan Ctrl + C
REM =============================================================
chcp 65001 >nul
cd /d "%~dp0"
title Game Sonic - dang chay (dong cua so nay de tat game)
set "PATH=%ProgramFiles%\nodejs;%APPDATA%\npm;%PATH%"

where node >nul 2>nul
if errorlevel 1 (
  echo Chua cai Node.js. Hay chay file 1-install.bat truoc.
  goto fail
)

if not exist "node_modules\" (
  echo Chua cai thu vien, dang cai ^(npm install^)...
  call npm install --no-audit --no-fund --loglevel=error
  if errorlevel 1 (
    echo LOI: npm install that bai. Hay chay 1-install.bat.
    goto fail
  )
)

node scripts\setup-local.js
if errorlevel 1 goto fail

node scripts\dev.js

:fail
echo.
pause
exit /b 1
