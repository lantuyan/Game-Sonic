#!/bin/bash

set -Eeuo pipefail

APP_NAME="game-sonic-running"
DEFAULT_DOMAIN="vannampham.sixpilot.technology"
DEFAULT_PORT="3000"
ENV_FILE=".env"
ECOSYSTEM_FILE="ecosystem.config.cjs"
CERTBOT_EMAIL=""
WEB_ROOT=""
SSL_CERT_FILE=""
SSL_KEY_FILE=""
SSL_PROVIDER="none"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "${CYAN}[STEP]${NC} $1"; }

if [[ ${EUID} -eq 0 ]]; then
    SUDO_PREFIX=""
else
    SUDO_PREFIX="sudo"
fi

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

can_prompt() {
    [ -t 0 ] && [ -t 1 ]
}

path_exists() {
    if [ -e "$1" ]; then
        return 0
    fi

    if [ -n "$SUDO_PREFIX" ]; then
        $SUDO_PREFIX test -e "$1" 2>/dev/null
        return $?
    fi

    return 1
}

require_apt() {
    if ! command_exists apt-get; then
        log_error "This script currently supports Debian/Ubuntu servers only."
        exit 1
    fi
}

read_env_value() {
    local key="$1"
    local file="${2:-$ENV_FILE}"

    if [ ! -f "$file" ]; then
        printf ''
        return 0
    fi

    grep -E "^${key}=" "$file" 2>/dev/null | tail -1 | cut -d '=' -f2- | sed -e 's/^[[:space:]]*//' -e "s/^['\"]//" -e "s/['\"]$//" -e 's/[[:space:]]*$//' || true
}

is_placeholder_secret() {
    case "$1" in
        ""|"replace-with-a-long-random-secret")
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

is_placeholder_hash() {
    case "$1" in
        ""|"replace-with-output-from-npm-run-hash-password")
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

ensure_nodejs() {
    local node_major

    if command_exists node; then
        node_major="$(node -v | sed 's/^v//' | cut -d '.' -f1)"
    else
        node_major="0"
    fi

    if command_exists node && [ "$node_major" -ge 18 ] 2>/dev/null; then
        return
    fi

    require_apt
    log_warning "Installing Node.js 20.x..."
    $SUDO_PREFIX apt-get update -qq
    $SUDO_PREFIX apt-get install -y -qq curl ca-certificates gnupg build-essential python3 lsof
    curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO_PREFIX -E bash -
    $SUDO_PREFIX apt-get install -y -qq nodejs
}

ensure_npm() {
    if command_exists npm; then
        return
    fi

    require_apt
    log_warning "Installing npm..."
    $SUDO_PREFIX apt-get update -qq
    $SUDO_PREFIX apt-get install -y -qq npm
}

ensure_certbot() {
    if command_exists certbot; then
        return
    fi

    require_apt
    log_warning "Installing certbot..."
    $SUDO_PREFIX apt-get update -qq
    $SUDO_PREFIX apt-get install -y -qq certbot python3-certbot-nginx
}

ensure_web_root() {
    WEB_ROOT="/var/www/${DOMAIN}"
    $SUDO_PREFIX mkdir -p "${WEB_ROOT}/.well-known/acme-challenge"
    $SUDO_PREFIX chmod 755 /var/www >/dev/null 2>&1 || true
    $SUDO_PREFIX chmod -R 755 "$WEB_ROOT" >/dev/null 2>&1 || true
}

detect_ssl_paths() {
    local origin_cert="/etc/nginx/ssl/${DOMAIN}/origin.crt"
    local origin_key="/etc/nginx/ssl/${DOMAIN}/origin.key"
    local le_cert="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
    local le_key="/etc/letsencrypt/live/${DOMAIN}/privkey.pem"

    SSL_CERT_FILE=""
    SSL_KEY_FILE=""
    SSL_PROVIDER="none"

    if path_exists "$origin_cert" && path_exists "$origin_key"; then
        SSL_CERT_FILE="$origin_cert"
        SSL_KEY_FILE="$origin_key"
        SSL_PROVIDER="cloudflare-origin"
        return
    fi

    if path_exists "$le_cert" && path_exists "$le_key"; then
        SSL_CERT_FILE="$le_cert"
        SSL_KEY_FILE="$le_key"
        SSL_PROVIDER="letsencrypt"
    fi
}

write_cloudflare_origin_cert() {
    local cert_dir="/etc/nginx/ssl/${DOMAIN}"
    local tmp_cert
    local tmp_key

    tmp_cert="$(mktemp)"
    tmp_key="$(mktemp)"

    echo
    log_info "Paste Cloudflare Origin Certificate for ${DOMAIN}, then press Ctrl+D."
    cat > "$tmp_cert"
    echo
    log_info "Paste Cloudflare Origin Private Key for ${DOMAIN}, then press Ctrl+D."
    cat > "$tmp_key"
    echo

    if [ ! -s "$tmp_cert" ] || [ ! -s "$tmp_key" ]; then
        rm -f "$tmp_cert" "$tmp_key"
        log_warning "Certificate or key was empty. Skipping Cloudflare Origin setup."
        return 1
    fi

    $SUDO_PREFIX mkdir -p "$cert_dir"
    $SUDO_PREFIX cp "$tmp_cert" "${cert_dir}/origin.crt"
    $SUDO_PREFIX cp "$tmp_key" "${cert_dir}/origin.key"
    $SUDO_PREFIX chmod 644 "${cert_dir}/origin.crt"
    $SUDO_PREFIX chmod 600 "${cert_dir}/origin.key"

    rm -f "$tmp_cert" "$tmp_key"
    log_success "Saved Cloudflare Origin certificate for ${DOMAIN}"
    return 0
}

provision_https_certificate() {
    local reply

    detect_ssl_paths
    if [ "$SSL_PROVIDER" != "none" ]; then
        return 0
    fi

    ensure_web_root

    if [ -n "$CERTBOT_EMAIL" ]; then
        ensure_certbot
        log_info "Requesting Let's Encrypt certificate for ${DOMAIN}..."
        if $SUDO_PREFIX certbot certonly --webroot -w "$WEB_ROOT" -d "$DOMAIN" --non-interactive --agree-tos --keep-until-expiring --expand -m "$CERTBOT_EMAIL"; then
            detect_ssl_paths
            if [ "$SSL_PROVIDER" = "letsencrypt" ]; then
                log_success "Let's Encrypt certificate is ready for ${DOMAIN}"
                return 0
            fi
        fi
        log_warning "Let's Encrypt provisioning did not create a usable certificate."
    fi

    if can_prompt; then
        read -r -p "No SSL certificate found for ${DOMAIN}. Configure Cloudflare Origin Certificate now? [y/N]: " reply
        case "$reply" in
            y|Y|yes|YES|Yes)
                if write_cloudflare_origin_cert; then
                    detect_ssl_paths
                    if [ "$SSL_PROVIDER" = "cloudflare-origin" ]; then
                        return 0
                    fi
                fi
                ;;
        esac
    fi

    return 1
}

reload_or_start_nginx() {
    if command_exists systemctl; then
        if $SUDO_PREFIX systemctl is-active --quiet nginx; then
            $SUDO_PREFIX systemctl reload nginx
        else
            $SUDO_PREFIX systemctl start nginx
        fi
    else
        $SUDO_PREFIX service nginx restart
    fi
}

load_runtime_values() {
    DOMAIN="$(read_env_value DOMAIN)"
    PORT="$(read_env_value PORT)"
    BASE_URL="$(read_env_value BASE_URL)"
    CERTBOT_EMAIL="$(read_env_value CERTBOT_EMAIL)"
    JWT_SECRET_VALUE="$(read_env_value JWT_SECRET)"
    ADMIN_PASSWORD_HASH_VALUE="$(read_env_value ADMIN_PASSWORD_HASH)"

    if [ -z "$DOMAIN" ]; then
        DOMAIN="$DEFAULT_DOMAIN"
    fi

    if [ -z "$PORT" ]; then
        PORT="$DEFAULT_PORT"
    fi

    if [ -z "$BASE_URL" ]; then
        BASE_URL="https://${DOMAIN}"
    fi

    WEB_ROOT="/var/www/${DOMAIN}"
}

validate_runtime_values() {
    if [ ! -f "$ENV_FILE" ]; then
        log_error ".env not found. Run ./start.sh first."
        exit 1
    fi

    if is_placeholder_secret "$JWT_SECRET_VALUE"; then
        log_error "JWT_SECRET is missing or still using the example value."
        log_error "Run ./start.sh first or update .env manually."
        exit 1
    fi

    if is_placeholder_hash "$ADMIN_PASSWORD_HASH_VALUE"; then
        log_error "ADMIN_PASSWORD_HASH is missing or still using the example value."
        log_error "Run ./start.sh first or update .env manually."
        exit 1
    fi
}

ensure_pm2() {
    if command_exists pm2; then
        return
    fi

    log_warning "PM2 is missing. Installing it now..."
    $SUDO_PREFIX npm install -g pm2
}

ensure_nginx() {
    if command_exists nginx; then
        return
    fi

    require_apt
    log_warning "Nginx is missing. Installing it now..."
    $SUDO_PREFIX apt-get update -qq
    $SUDO_PREFIX apt-get install -y -qq nginx
}

install_project_dependencies() {
    log_info "Installing project dependencies..."
    npm install
}

render_ecosystem_file() {
    mkdir -p logs

    cat > "$ECOSYSTEM_FILE" <<EOF
module.exports = {
  apps: [
    {
      name: '${APP_NAME}',
      cwd: __dirname,
      script: 'server/index.js',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: ${PORT}
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    }
  ]
};
EOF
}

free_port() {
    local port="$1"
    local pids=()
    local pid

    if command_exists lsof; then
        while IFS= read -r pid; do
            if [ -n "$pid" ]; then
                pids+=("$pid")
            fi
        done < <($SUDO_PREFIX lsof -ti :"$port" 2>/dev/null || true)
    elif command_exists fuser; then
        while IFS= read -r pid; do
            if [ -n "$pid" ]; then
                pids+=("$pid")
            fi
        done < <($SUDO_PREFIX fuser "${port}/tcp" 2>/dev/null | tr ' ' '\n' | sed '/^$/d' || true)
    fi

    if [ "${#pids[@]}" -eq 0 ]; then
        return
    fi

    log_warning "Cleaning processes on port ${port}..."
    for pid in "${pids[@]}"; do
        if [ -n "$pid" ]; then
            $SUDO_PREFIX kill -9 "$pid" 2>/dev/null || true
        fi
    done
    sleep 1
}

restart_pm2_app() {
    if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
        pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
    fi

    free_port "$PORT"

    log_info "Starting PM2 app..."
    pm2 start "$ECOSYSTEM_FILE" >/dev/null
    pm2 save >/dev/null
    log_success "PM2 app restarted"
}

render_nginx_config() {
    local nginx_conf="/etc/nginx/sites-available/${DOMAIN}"
    local nginx_link="/etc/nginx/sites-enabled/${DOMAIN}"
    local tmp_file
    local file

    ensure_web_root
    detect_ssl_paths

    tmp_file="$(mktemp)"

    if [ "$SSL_PROVIDER" != "none" ]; then
        cat > "$tmp_file" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    access_log /var/log/nginx/${DOMAIN}.access.log;
    error_log /var/log/nginx/${DOMAIN}.error.log;

    location ^~ /.well-known/acme-challenge/ {
        root ${WEB_ROOT};
        default_type text/plain;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${DOMAIN};

    access_log /var/log/nginx/${DOMAIN}.access.log;
    error_log /var/log/nginx/${DOMAIN}.error.log;

    ssl_certificate ${SSL_CERT_FILE};
    ssl_certificate_key ${SSL_KEY_FILE};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
        proxy_connect_timeout 60s;
    }
}
EOF
    else
        cat > "$tmp_file" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    access_log /var/log/nginx/${DOMAIN}.access.log;
    error_log /var/log/nginx/${DOMAIN}.error.log;

    location ^~ /.well-known/acme-challenge/ {
        root ${WEB_ROOT};
        default_type text/plain;
    }

    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
        proxy_connect_timeout 60s;
    }
}
EOF
    fi

    $SUDO_PREFIX mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled
    $SUDO_PREFIX cp "$tmp_file" "$nginx_conf"
    rm -f "$tmp_file"

    $SUDO_PREFIX rm -f "$nginx_link"
    $SUDO_PREFIX ln -s "$nginx_conf" "$nginx_link"

    for file in /etc/nginx/sites-enabled/*; do
        if [ "$file" != "$nginx_link" ] && [ -f "$file" ]; then
            if grep -q "server_name[[:space:]].*${DOMAIN}" "$file" 2>/dev/null; then
                log_warning "Disabling duplicate Nginx site: $(basename "$file")"
                $SUDO_PREFIX rm -f "$file"
            fi
        fi
    done

    if ! $SUDO_PREFIX nginx -t; then
        log_error "Nginx configuration test failed."
        exit 1
    fi

    reload_or_start_nginx

    if [ "$SSL_PROVIDER" != "none" ]; then
        log_success "Nginx reloaded with HTTPS using ${SSL_PROVIDER}"
    else
        log_success "Nginx reloaded with HTTP"
    fi
}

run_health_check() {
    if ! command_exists curl; then
        log_warning "curl is missing, skipping health check."
        return
    fi

    if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null; then
        log_success "Health check passed on http://127.0.0.1:${PORT}/api/health"
    else
        log_error "Health check failed on port ${PORT}"
        exit 1
    fi
}

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN} Game Sonic Running - restart.sh${NC}"
echo -e "${GREEN}========================================${NC}"

log_step "1. Loading runtime configuration"
load_runtime_values
validate_runtime_values

log_step "2. Checking process manager and proxy"
ensure_nodejs
ensure_npm
ensure_pm2
ensure_nginx

log_step "3. Installing Node dependencies"
install_project_dependencies

log_step "4. Writing PM2 configuration"
render_ecosystem_file

log_step "5. Restarting PM2 app"
restart_pm2_app

log_step "6. Reloading Nginx"
render_nginx_config

log_step "7. Provisioning HTTPS"
INITIAL_SSL_PROVIDER="$SSL_PROVIDER"
if provision_https_certificate; then
    detect_ssl_paths
    if [ "$SSL_PROVIDER" != "$INITIAL_SSL_PROVIDER" ]; then
        render_nginx_config
    fi
else
    detect_ssl_paths
fi

log_step "8. Running health check"
run_health_check

echo
log_success "Restart completed"
echo "App name:   ${APP_NAME}"
echo "Domain:     ${DOMAIN}"
echo "Base URL:   ${BASE_URL}"
echo "Port:       ${PORT}"
if [ "$SSL_PROVIDER" != "none" ]; then
    echo "HTTPS:      enabled (${SSL_PROVIDER})"
else
    echo "HTTPS:      disabled (HTTP only)"
fi
echo "PM2 logs:   pm2 logs ${APP_NAME}"
echo "PM2 status: pm2 status ${APP_NAME}"
