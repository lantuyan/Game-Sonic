#!/bin/bash

set -Eeuo pipefail

APP_NAME="game-sonic-running"
DEFAULT_DOMAIN="vannampham.sixpilot.technology"
DEFAULT_PORT="3000"
ENV_FILE=".env"
ECOSYSTEM_FILE="ecosystem.config.cjs"

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

upsert_env_value() {
    local key="$1"
    local value="$2"
    local file="${3:-$ENV_FILE}"
    local tmp_file

    tmp_file="$(mktemp)"

    if [ -f "$file" ]; then
        awk -v key="$key" -v value="$value" '
            BEGIN { updated = 0 }
            $0 ~ ("^" key "=") {
                if (updated == 0) {
                    print key "=" value
                    updated = 1
                }
                next
            }
            { print }
            END {
                if (updated == 0) {
                    print key "=" value
                }
            }
        ' "$file" > "$tmp_file"
    else
        printf '%s=%s\n' "$key" "$value" > "$tmp_file"
    fi

    mv "$tmp_file" "$file"
}

generate_secret() {
    if command_exists openssl; then
        openssl rand -hex 32
    else
        node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
    fi
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
        log_success "Node.js $(node -v) is available"
        return
    fi

    require_apt
    log_warning "Installing Node.js 20.x..."
    $SUDO_PREFIX apt-get update -qq
    $SUDO_PREFIX apt-get install -y -qq curl ca-certificates gnupg build-essential python3 lsof
    curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO_PREFIX -E bash -
    $SUDO_PREFIX apt-get install -y -qq nodejs

    log_success "Node.js $(node -v) installed"
}

ensure_npm() {
    if command_exists npm; then
        log_success "npm $(npm -v) is available"
        return
    fi

    require_apt
    log_warning "Installing npm..."
    $SUDO_PREFIX apt-get update -qq
    $SUDO_PREFIX apt-get install -y -qq npm
    log_success "npm $(npm -v) installed"
}

ensure_pm2() {
    if command_exists pm2; then
        log_success "PM2 $(pm2 -v) is available"
        return
    fi

    log_warning "Installing PM2..."
    $SUDO_PREFIX npm install -g pm2
    log_success "PM2 installed"
}

ensure_nginx() {
    if command_exists nginx; then
        log_success "Nginx is available"
        return
    fi

    require_apt
    log_warning "Installing Nginx..."
    $SUDO_PREFIX apt-get update -qq
    $SUDO_PREFIX apt-get install -y -qq nginx
    log_success "Nginx installed"
}

configure_firewall() {
    if ! command_exists ufw; then
        log_info "UFW is not installed. Skipping firewall changes."
        return
    fi

    if $SUDO_PREFIX ufw status | head -n1 | grep -qi "inactive"; then
        log_warning "UFW is inactive. Skipping auto-enable for safety."
        log_info "If you use UFW, allow 80/tcp and 443/tcp manually."
        return
    fi

    if ! $SUDO_PREFIX ufw status | grep -q "80/tcp"; then
        $SUDO_PREFIX ufw allow 80/tcp >/dev/null
    fi

    if ! $SUDO_PREFIX ufw status | grep -q "443/tcp"; then
        $SUDO_PREFIX ufw allow 443/tcp >/dev/null
    fi

    if ! $SUDO_PREFIX ufw status | grep -q "22/tcp"; then
        $SUDO_PREFIX ufw allow 22/tcp >/dev/null || true
    fi

    log_success "Firewall rules checked"
}

ensure_env_file() {
    local port_value
    local domain_value
    local base_url_value

    if [ ! -f "$ENV_FILE" ]; then
        if [ -f ".env.example" ]; then
            cp .env.example "$ENV_FILE"
            log_success "Created .env from .env.example"
        else
            touch "$ENV_FILE"
            log_success "Created empty .env"
        fi
    fi

    port_value="$(read_env_value PORT)"
    if [ -z "$port_value" ]; then
        upsert_env_value PORT "$DEFAULT_PORT"
    fi

    domain_value="$(read_env_value DOMAIN)"
    if [ -z "$domain_value" ] || [ "$domain_value" = "yourdomain.com" ]; then
        upsert_env_value DOMAIN "$DEFAULT_DOMAIN"
        domain_value="$DEFAULT_DOMAIN"
    fi

    base_url_value="$(read_env_value BASE_URL)"
    if [ -z "$base_url_value" ] || [ "$base_url_value" = "https://yourdomain.com" ]; then
        upsert_env_value BASE_URL "https://${domain_value}"
    fi

    upsert_env_value NODE_ENV "production"
}

install_project_dependencies() {
    log_info "Installing project dependencies..."
    npm install
    log_success "Dependencies are ready"
}

ensure_runtime_secrets() {
    local jwt_secret
    local admin_hash
    local admin_password
    local admin_password_confirm

    jwt_secret="$(read_env_value JWT_SECRET)"
    if is_placeholder_secret "$jwt_secret"; then
        jwt_secret="$(generate_secret)"
        upsert_env_value JWT_SECRET "$jwt_secret"
        log_success "Generated JWT_SECRET"
    else
        log_success "JWT_SECRET already configured"
    fi

    admin_hash="$(read_env_value ADMIN_PASSWORD_HASH)"
    if is_placeholder_hash "$admin_hash"; then
        log_warning "ADMIN_PASSWORD_HASH is missing."

        while true; do
            read -r -s -p "Admin password: " admin_password
            echo
            read -r -s -p "Confirm admin password: " admin_password_confirm
            echo

            if [ -z "$admin_password" ]; then
                log_warning "Password cannot be empty."
                continue
            fi

            if [ "$admin_password" != "$admin_password_confirm" ]; then
                log_warning "Passwords do not match."
                continue
            fi

            admin_hash="$(node server/scripts/hash-password.js "$admin_password")"
            upsert_env_value ADMIN_PASSWORD_HASH "$admin_hash"
            unset admin_password admin_password_confirm
            log_success "Generated ADMIN_PASSWORD_HASH"
            break
        done
    else
        log_success "ADMIN_PASSWORD_HASH already configured"
    fi
}

load_runtime_values() {
    DOMAIN="$(read_env_value DOMAIN)"
    PORT="$(read_env_value PORT)"
    BASE_URL="$(read_env_value BASE_URL)"

    if [ -z "$DOMAIN" ]; then
        DOMAIN="$DEFAULT_DOMAIN"
    fi

    if [ -z "$PORT" ]; then
        PORT="$DEFAULT_PORT"
    fi

    if [ -z "$BASE_URL" ]; then
        BASE_URL="https://${DOMAIN}"
    fi
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

    log_success "Prepared ${ECOSYSTEM_FILE}"
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
        log_info "Port ${port} is free"
        return
    fi

    log_warning "Cleaning processes on port ${port}..."
    for pid in "${pids[@]}"; do
        if [ -n "$pid" ]; then
            $SUDO_PREFIX kill -9 "$pid" 2>/dev/null || true
        fi
    done
    sleep 1
    log_success "Port ${port} released"
}

enable_pm2_startup() {
    local target_user
    local target_home

    if ! command_exists systemctl; then
        return
    fi

    if [ -n "${SUDO_USER:-}" ] && [ "${SUDO_USER}" != "root" ]; then
        target_user="${SUDO_USER}"
        target_home="$(eval echo "~${SUDO_USER}")"
    else
        target_user="${USER}"
        target_home="${HOME}"
    fi

    $SUDO_PREFIX env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$target_user" --hp "$target_home" >/dev/null 2>&1 || true
    pm2 save >/dev/null 2>&1 || true
}

start_pm2_app() {
    if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
        pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
    fi

    free_port "$PORT"

    log_info "Starting app with PM2..."
    pm2 start "$ECOSYSTEM_FILE" >/dev/null
    pm2 save >/dev/null
    enable_pm2_startup
    log_success "PM2 app started"
}

render_nginx_config() {
    local nginx_conf="/etc/nginx/sites-available/${DOMAIN}"
    local nginx_link="/etc/nginx/sites-enabled/${DOMAIN}"
    local cert_dir="/etc/nginx/ssl/${DOMAIN}"
    local cert_file="${cert_dir}/origin.crt"
    local key_file="${cert_dir}/origin.key"
    local tmp_file
    local has_ssl="false"
    local file

    if [ -f "$cert_file" ] && [ -f "$key_file" ]; then
        has_ssl="true"
    fi

    tmp_file="$(mktemp)"

    if [ "$has_ssl" = "true" ]; then
        cat > "$tmp_file" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${DOMAIN};

    access_log /var/log/nginx/${DOMAIN}.access.log;
    error_log /var/log/nginx/${DOMAIN}.error.log;

    ssl_certificate ${cert_file};
    ssl_certificate_key ${key_file};
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

    if command_exists systemctl; then
        $SUDO_PREFIX systemctl enable nginx >/dev/null 2>&1 || true
        if $SUDO_PREFIX systemctl is-active --quiet nginx; then
            $SUDO_PREFIX systemctl reload nginx
        else
            $SUDO_PREFIX systemctl start nginx
        fi
    else
        $SUDO_PREFIX service nginx restart
    fi

    if [ "$has_ssl" = "true" ]; then
        log_success "Nginx configured for HTTPS on ${DOMAIN}"
    else
        log_success "Nginx configured for HTTP on ${DOMAIN}"
        log_info "Add Cloudflare Origin cert to /etc/nginx/ssl/${DOMAIN}/origin.crt and origin.key, then rerun this script to enable HTTPS."
    fi
}

run_health_checks() {
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
echo -e "${GREEN} Game Sonic Running - start.sh${NC}"
echo -e "${GREEN}========================================${NC}"

log_step "1. Checking runtime dependencies"
ensure_nodejs
ensure_npm
ensure_pm2
ensure_nginx

log_step "2. Preparing environment file"
ensure_env_file

log_step "3. Installing Node dependencies"
install_project_dependencies

log_step "4. Ensuring runtime secrets"
ensure_runtime_secrets
load_runtime_values

log_step "5. Writing PM2 configuration"
render_ecosystem_file

log_step "6. Configuring firewall"
configure_firewall

log_step "7. Starting PM2 process"
start_pm2_app

log_step "8. Configuring Nginx"
render_nginx_config

log_step "9. Running health check"
run_health_checks

echo
log_success "Setup completed"
echo "App name:   ${APP_NAME}"
echo "Domain:     ${DOMAIN}"
echo "Base URL:   ${BASE_URL}"
echo "Port:       ${PORT}"
echo "PM2 logs:   pm2 logs ${APP_NAME}"
echo "PM2 status: pm2 status ${APP_NAME}"
