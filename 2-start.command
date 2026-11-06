#!/bin/bash
# =============================================================
#  BUOC 2: CHAY GAME (macOS)
#  Cach chay: nhap dup vao file nay (hoac: bash 2-start.command)
#  - Cua so nay se hien link http://localhost:3000 -> mo tren trinh duyet
#  - Sua code va luu lai -> trinh duyet tu cap nhat, KHONG can chay lai
#  - Muon tat: dong cua so nay hoac nhan Ctrl + C
# =============================================================

cd "$(dirname "$0")" || exit 1

export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1

pause_and_exit() {
  echo ""
  read -r -p "Nhan Enter de dong cua so..." _
  exit "$1"
}

if ! command -v node >/dev/null 2>&1; then
  echo "Chua cai Node.js. Hay chay file 1-install.command truoc."
  pause_and_exit 1
fi

if ! node -e "require('express');require('dotenv');require('bcryptjs');require('@electric-sql/pglite')" >/dev/null 2>&1; then
  echo "Thu vien chua cai du, dang cai (npm install)..."
  npm install --no-audit --no-fund --loglevel=error || { echo "LOI: npm install that bai. Hay chay 1-install.command."; pause_and_exit 1; }
fi

node scripts/setup-local.js || pause_and_exit 1

node scripts/dev.js
pause_and_exit $?
