#!/bin/bash
# =============================================================
#  BUOC 1: CAI DAT (macOS) - chi can chay 1 lan tren moi may
#  Cach chay: nhap dup vao file nay (hoac: bash 1-install.command)
# =============================================================

cd "$(dirname "$0")" || exit 1

# Tim Node.js o cac vi tri thuong gap (Homebrew, nvm, ban cai dat chinh thuc)
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1

NODE_MIN=20

pause_and_exit() {
  echo ""
  read -r -p "Nhan Enter de dong cua so..." _
  exit "$1"
}

node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local major
  major=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null) || return 1
  [ "$major" -ge "$NODE_MIN" ] 2>/dev/null
}

echo "=============================================="
echo "   CAI DAT GAME SONIC (macOS)"
echo "=============================================="
echo ""

# ---- 1. Node.js ------------------------------------------------
echo "[1/3] Kiem tra Node.js..."
if node_ok; then
  echo "      OK - da co Node.js $(node -v)"
else
  if command -v node >/dev/null 2>&1; then
    echo "      Node.js $(node -v) qua cu, can ban $NODE_MIN tro len."
  else
    echo "      Chua co Node.js."
  fi
  echo "      Dang tai Node.js 22 tu nodejs.org (vui long cho)..."

  BASE_URL="https://nodejs.org/dist/latest-v22.x"
  PKG_NAME=$(curl -fsSL "$BASE_URL/SHASUMS256.txt" | awk '/\.pkg$/ {print $2}' | head -n 1)
  if [ -z "$PKG_NAME" ]; then
    echo "      LOI: Khong tai duoc. Kiem tra mang Internet roi chay lai."
    echo "      Hoac tu cai Node.js tai https://nodejs.org (chon ban LTS)."
    pause_and_exit 1
  fi

  PKG_FILE="${TMPDIR:-/tmp}/$PKG_NAME"
  if ! curl -fL --progress-bar -o "$PKG_FILE" "$BASE_URL/$PKG_NAME"; then
    echo "      LOI: Tai Node.js that bai. Kiem tra mang roi chay lai."
    pause_and_exit 1
  fi

  echo ""
  echo "      Can quyen quan tri de cai Node.js."
  echo "      >>> Hay GO MAT KHAU MAY TINH roi nhan Enter (luc go se khong hien chu) <<<"
  if ! sudo installer -pkg "$PKG_FILE" -target /; then
    echo "      LOI: Cai Node.js that bai."
    pause_and_exit 1
  fi
  rm -f "$PKG_FILE"
  hash -r

  if ! node_ok; then
    echo "      LOI: Da cai nhung chua tim thay Node.js. Hay tat may/mo lai roi chay lai file nay."
    pause_and_exit 1
  fi
  echo "      OK - da cai Node.js $(node -v)"
fi
echo ""

# ---- 2. Thu vien cua du an -------------------------------------
echo "[2/3] Cai thu vien cho du an (npm install)..."
if ! npm install --no-audit --no-fund --loglevel=error; then
  echo ""
  echo "      LOI: npm install that bai. Kiem tra mang Internet roi chay lai."
  pause_and_exit 1
fi
echo "      OK"
echo ""

# ---- 3. File cau hinh .env -------------------------------------
echo "[3/3] Tao file cau hinh..."
if ! node scripts/setup-local.js; then
  pause_and_exit 1
fi

chmod +x 2-start.command 2>/dev/null

echo ""
echo "=============================================="
echo "   CAI DAT XONG!"
echo "   Buoc tiep theo: nhap dup vao file 2-start.command"
echo "=============================================="
pause_and_exit 0
