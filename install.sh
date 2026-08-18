#!/bin/bash

# 妙妙屋X - Xray 服务器管理与订阅拼车系统 安装脚本
# 适用于 Debian/Ubuntu、RHEL 系及 Alpine Linux

set -e

# 配置
GITHUB_REPO="iluobei/miaomiaowuX"
VERSION="${MMWX_VERSION:-}"  # 为空时自动获取最新版本
RELEASE_CHANNEL="${MMWX_RELEASE_CHANNEL:-stable}" # stable | prerelease
BINARY_NAME=""  # 将根据架构自动设置
GUARD_BINARY_NAME=""
INSTALL_DIR="/usr/local/bin"
SERVICE_NAME="mmwx"
GUARD_SERVICE_NAME="mmwx-guard-master"
GUARD_BINARY_PATH="$INSTALL_DIR/mmwx-guardd-master"
RELEASE_ASSET_BASE="${MMWX_RELEASE_ASSET_BASE:-}"
GUARD_DOWNLOAD_BASE="${MMWX_GUARD_DOWNLOAD_BASE:-https://dl.miaomiaowux.com/mmwx-guard}"
GUARD_RELEASE="${MMWX_GUARD_RELEASE:-}"
GUARD_STATE_DIR="/var/lib/mmwx-guard-master"
GUARD_SOCKET="/run/mmwx-guard/guard.sock"
GUARD_MANIFEST_DIR="/usr/local/share/mmwx-guard"
GUARD_MANIFEST_PATH="$GUARD_MANIFEST_DIR/master.manifest"
GUARD_REQUIRED=1
DATA_DIR="/etc/mmwx"
CONFIG_DIR="/etc/mmwx"
SERVICE_MANAGER=""
STAGING_DIR=""
INSTALL_METHOD="${MMWX_INSTALL_METHOD:-}"
DATABASE_MODE="${MMWX_DATABASE_DRIVER:-}"
DOCKER_INSTALL_DIR="${MMWX_DOCKER_DIR:-/opt/miaomiaowux}"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

echo_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

echo_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

cleanup_staging() {
    case "$STAGING_DIR" in
        /tmp/mmwx-install.*) rm -rf -- "$STAGING_DIR" ;;
    esac
}

prepare_staging() {
    if [ -z "$STAGING_DIR" ]; then
        STAGING_DIR=$(mktemp -d /tmp/mmwx-install.XXXXXX)
        chmod 0700 "$STAGING_DIR"
    fi
}

download_asset() {
    local url="$1" destination="$2" label="$3"
    prepare_staging
    rm -f -- "$destination.tmp"
    if curl --fail --location --silent --show-error \
        --connect-timeout 15 --max-time 120 --retry 2 --retry-delay 2 --retry-max-time 120 \
        "$url" -o "$destination.tmp"; then
        mv -f -- "$destination.tmp" "$destination"
        return 0
    fi
    rm -f -- "$destination.tmp"
    echo_warn "$label 下载失败: $url"
    return 1
}

read_choice() {
    local prompt="$1" default="$2" value=""
    if [ -r /dev/tty ]; then
        read -r -p "$prompt" value </dev/tty || true
    fi
    echo "${value:-$default}"
}

choose_install_options() {
    case "$INSTALL_METHOD" in local|direct|baremetal) INSTALL_METHOD="native" ;; compose) INSTALL_METHOD="docker" ;; esac
    case "$DATABASE_MODE" in postgresql|pgsql) DATABASE_MODE="postgres" ;; esac
    if [ -z "$INSTALL_METHOD" ]; then
        echo "请选择安装方式:"
        echo "  1) 本机安装（二进制 + 系统服务）"
        echo "  2) Docker Compose 安装"
        case "$(read_choice '请选择 (1/2，默认 1): ' 1)" in
            2|docker) INSTALL_METHOD="docker" ;;
            *) INSTALL_METHOD="native" ;;
        esac
    fi
    if [ -z "$DATABASE_MODE" ]; then
        echo "请选择数据库:"
        echo "  1) SQLite（轻量，无需额外安装）"
        echo "  2) PostgreSQL 18（推荐多服务器/高并发）"
        case "$(read_choice '请选择 (1/2，默认 1): ' 1)" in
            2|postgres|postgresql|pgsql) DATABASE_MODE="postgres" ;;
            *) DATABASE_MODE="sqlite" ;;
        esac
    fi
    case "$INSTALL_METHOD" in native|docker) ;; *) echo_error "不支持的安装方式: $INSTALL_METHOD"; exit 1 ;; esac
    case "$DATABASE_MODE" in sqlite|postgres) ;; *) echo_error "不支持的数据库: $DATABASE_MODE"; exit 1 ;; esac
    echo_info "安装方式: $INSTALL_METHOD；数据库: $DATABASE_MODE"
}

install_docker_engine() {
    if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
        return
    fi
    echo_info "安装 Docker Engine 与 Compose 插件..."
    if command -v apt-get >/dev/null 2>&1; then
        apt-get update -qq
        DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-v2 >/dev/null 2>&1 || \
            DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-plugin >/dev/null 2>&1 || \
            DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-cli docker-compose >/dev/null 2>&1
    elif command -v dnf >/dev/null 2>&1; then
        dnf install -y docker docker-compose-plugin >/dev/null
    elif command -v yum >/dev/null 2>&1; then
        yum install -y docker docker-compose-plugin >/dev/null
    elif command -v apk >/dev/null 2>&1; then
        apk add --no-cache docker docker-cli-compose >/dev/null
    else
        echo_error "无法自动安装 Docker，请先安装 Docker Engine 和 Compose v2"
        exit 1
    fi
    if command -v systemctl >/dev/null 2>&1; then systemctl enable --now docker; fi
    if command -v rc-service >/dev/null 2>&1; then rc-update add docker default >/dev/null 2>&1 || true; rc-service docker start || true; fi
    docker compose version >/dev/null 2>&1 || { echo_error "Docker Compose v2 安装失败"; exit 1; }
}

random_password() {
    LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32
}

install_docker_stack() {
    install_docker_engine
    mkdir -p "$DOCKER_INSTALL_DIR"/{data,subscribes,rule_templates,postgres-data}
    curl -fsSL "https://raw.githubusercontent.com/${GITHUB_REPO}/main/docker-compose.yml" -o "$DOCKER_INSTALL_DIR/docker-compose.yml"
    local db_password=""
    if [ "$DATABASE_MODE" = "postgres" ]; then db_password="$(random_password)"; fi
    cat > "$DOCKER_INSTALL_DIR/.env" <<EOF
PORT=${PORT:-12889}
POSTGRES_DB=mmwx
POSTGRES_USER=mmwx
POSTGRES_PASSWORD=$db_password
MMWX_DATABASE_DRIVER=$([ "$DATABASE_MODE" = "postgres" ] && echo postgres)
MMWX_DATABASE_HOST=$([ "$DATABASE_MODE" = "postgres" ] && echo 127.0.0.1)
MMWX_DATABASE_PORT=$([ "$DATABASE_MODE" = "postgres" ] && echo 5432)
MMWX_DATABASE_NAME=$([ "$DATABASE_MODE" = "postgres" ] && echo mmwx)
MMWX_DATABASE_USER=$([ "$DATABASE_MODE" = "postgres" ] && echo mmwx)
MMWX_DATABASE_PASSWORD=$db_password
MMWX_DATABASE_SSLMODE=$([ "$DATABASE_MODE" = "postgres" ] && echo disable)
EOF
    chmod 600 "$DOCKER_INSTALL_DIR/.env"
    cd "$DOCKER_INSTALL_DIR"
    if [ "$DATABASE_MODE" = "postgres" ]; then
        docker compose --profile postgres up -d postgres
        echo_info "等待 PostgreSQL 18 就绪..."
        local ready="false"
        for _ in $(seq 1 30); do
            if docker exec miaomiaowux-postgres pg_isready -U mmwx -d mmwx >/dev/null 2>&1; then
                ready="true"
                break
            fi
            sleep 2
        done
        if [ "$ready" != "true" ]; then
            echo_error "PostgreSQL 18 未在 60 秒内就绪，请执行 docker logs miaomiaowux-postgres 查看原因"
            exit 1
        fi
        docker compose --profile postgres up -d
    else
        docker compose up -d
    fi
    echo_info "Docker Compose 部署完成"
    echo "配置目录: $DOCKER_INSTALL_DIR"
    echo "访问地址: http://$(primary_ip):${PORT:-12889}"
}

install_postgresql18() {
    if command -v psql >/dev/null 2>&1 && psql --version | grep -q ' 18\.'; then return; fi
    echo_info "安装 PostgreSQL 18..."
    if command -v apt-get >/dev/null 2>&1; then
        . /etc/os-release
        install -d -m 0755 /usr/share/postgresql-common/pgdg
        curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc
        echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" > /etc/apt/sources.list.d/pgdg.list
        apt-get update -qq
        DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql-18 postgresql-client-18 >/dev/null
    elif command -v dnf >/dev/null 2>&1 || command -v yum >/dev/null 2>&1; then
        local pm="dnf"; command -v dnf >/dev/null 2>&1 || pm="yum"
        $pm install -y "https://download.postgresql.org/pub/repos/yum/reporpms/EL-$(rpm -E '%{rhel}')-$(uname -m)/pgdg-redhat-repo-latest.noarch.rpm" >/dev/null
        $pm -qy module disable postgresql >/dev/null 2>&1 || true
        $pm install -y postgresql18-server postgresql18 >/dev/null
        [ -s /var/lib/pgsql/18/data/PG_VERSION ] || /usr/pgsql-18/bin/postgresql-18-setup initdb
        systemctl enable --now postgresql-18
    elif command -v apk >/dev/null 2>&1; then
        apk add --no-cache postgresql18 postgresql18-client >/dev/null || { echo_error "当前 Alpine 仓库没有 PostgreSQL 18，请升级 Alpine 或选择 SQLite/Docker"; exit 1; }
        [ -s /var/lib/postgresql/18/data/PG_VERSION ] || su postgres -c 'initdb -D /var/lib/postgresql/18/data'
        rc-update add postgresql default >/dev/null 2>&1 || true
        rc-service postgresql start
    else
        echo_error "当前系统暂不支持自动安装 PostgreSQL 18"
        exit 1
    fi
    if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files postgresql.service >/dev/null 2>&1; then systemctl enable --now postgresql; fi
}

configure_native_postgres() {
    install_postgresql18
    local password="$(random_password)"
    su postgres -c "psql -v ON_ERROR_STOP=1 --set=mmwx_password='$password'" <<'SQL'
SELECT format('CREATE ROLE mmwx LOGIN PASSWORD %L', :'mmwx_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mmwx') \gexec
ALTER ROLE mmwx PASSWORD :'mmwx_password';
SELECT 'CREATE DATABASE mmwx OWNER mmwx'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname='mmwx') \gexec
SQL
    cat > "$DATA_DIR/data/database.json" <<EOF
{"driver":"postgres","host":"127.0.0.1","port":5432,"database":"mmwx","username":"mmwx","password":"$password","ssl_mode":"disable","max_open_conns":30,"max_idle_conns":10}
EOF
    chmod 600 "$DATA_DIR/data/database.json"
}

# 检查是否为 root 用户
check_root() {
    if [ "$EUID" -ne 0 ]; then
        echo_error "请使用 root 权限运行此脚本"
        echo_info "使用命令: sudo bash install.sh"
        exit 1
    fi
}

# 检查系统架构
check_architecture() {
    ARCH=$(uname -m)
    echo_info "检测到系统架构: $ARCH"

    case "$ARCH" in
        x86_64|amd64)
            BINARY_NAME="mmwx-linux-amd64"
            GUARD_BINARY_NAME="mmwx-guardd-master-linux-amd64"
            echo_info "使用 AMD64 版本"
            ;;
        aarch64|arm64)
            BINARY_NAME="mmwx-linux-arm64"
            GUARD_BINARY_NAME="mmwx-guardd-master-linux-arm64"
            echo_info "使用 ARM64 版本"
            ;;
        *)
            echo_error "不支持的架构: $ARCH"
            echo_error "支持的架构: x86_64 (amd64), aarch64 (arm64)"
            exit 1
            ;;
    esac
}

# 安装依赖
install_dependencies() {
    echo_info "检查并安装依赖..."
    if command -v apk >/dev/null 2>&1; then
        apk add --no-cache bash wget curl jq ca-certificates openrc >/dev/null
    elif command -v apt-get >/dev/null 2>&1; then
        apt-get update -qq || true
        DEBIAN_FRONTEND=noninteractive apt-get install -y wget curl jq ca-certificates gnupg >/dev/null 2>&1
    elif command -v dnf >/dev/null 2>&1; then
        dnf install -y wget curl jq ca-certificates >/dev/null
    elif command -v yum >/dev/null 2>&1; then
        yum install -y wget curl jq ca-certificates >/dev/null
    else
        echo_error "不支持的包管理器，请先安装 wget、curl、jq 和 CA 证书"
        exit 1
    fi
}

detect_service_manager() {
    if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
        SERVICE_MANAGER="systemd"
    elif command -v rc-service >/dev/null 2>&1 && [ -e /run/openrc/softlevel ]; then
        SERVICE_MANAGER="openrc"
    elif command -v start-stop-daemon >/dev/null 2>&1; then
        # Alpine/LXC 可能装有 OpenRC，但 PID 1 并未启动 OpenRC。
        SERVICE_MANAGER="direct"
    else
        echo_error "未检测到可用的服务管理器（systemd 或 OpenRC）"
        exit 1
    fi
    echo_info "使用服务管理器: $SERVICE_MANAGER"
}

service_stop() {
    if [ "$SERVICE_MANAGER" = "systemd" ]; then
        systemctl stop "${SERVICE_NAME}.service" || true
        systemctl stop "${GUARD_SERVICE_NAME}.service" 2>/dev/null || true
    elif [ "$SERVICE_MANAGER" = "openrc" ]; then
        rc-service "$SERVICE_NAME" stop || true
        rc-service "$GUARD_SERVICE_NAME" stop 2>/dev/null || true
    else
        if [ -f "/run/${SERVICE_NAME}.pid" ]; then
            kill "$(cat "/run/${SERVICE_NAME}.pid")" 2>/dev/null || true
            rm -f "/run/${SERVICE_NAME}.pid"
        fi
        if [ -s "/run/${GUARD_SERVICE_NAME}.pid" ]; then
            kill "$(cat "/run/${GUARD_SERVICE_NAME}.pid")" 2>/dev/null || true
            rm -f "/run/${GUARD_SERVICE_NAME}.pid"
        fi
    fi
}

service_start() {
    if [ "$SERVICE_MANAGER" = "systemd" ]; then
        [ "$GUARD_REQUIRED" != "1" ] || systemctl start "${GUARD_SERVICE_NAME}.service"
        systemctl start "${SERVICE_NAME}.service"
    elif [ "$SERVICE_MANAGER" = "openrc" ]; then
        [ "$GUARD_REQUIRED" != "1" ] || rc-service "$GUARD_SERVICE_NAME" start
        rc-service "$SERVICE_NAME" start
    else
        mkdir -p /var/log "$GUARD_STATE_DIR" "$(dirname "$GUARD_SOCKET")"
        if [ "$GUARD_REQUIRED" = "1" ]; then
            start-stop-daemon --start --background --make-pidfile --pidfile "/run/${GUARD_SERVICE_NAME}.pid" \
                --chdir "$GUARD_STATE_DIR" --exec "$GUARD_BINARY_PATH" -- \
                --role master --socket "$GUARD_SOCKET" --state-dir "$GUARD_STATE_DIR" --manifest "$GUARD_MANIFEST_PATH"
            local guard_ready="false"
            for _ in $(seq 1 30); do
                if [ -S "$GUARD_SOCKET" ]; then guard_ready="true"; break; fi
                sleep 1
            done
            [ "$guard_ready" = "true" ] || { echo_error "授权守护进程未能创建 Unix Socket"; return 1; }
        fi
        local guard_env=""
        [ "$GUARD_REQUIRED" != "1" ] || guard_env="MMWX_GUARD_SOCKET=$GUARD_SOCKET"
        start-stop-daemon --start --background --make-pidfile --pidfile "/run/${SERVICE_NAME}.pid" \
            --chdir "$DATA_DIR" --exec /usr/bin/env -- \
            PORT="$(configured_port)" MMWX_DATA_DIR="$DATA_DIR/data" LOG_LEVEL=info \
            $guard_env "$INSTALL_DIR/$SERVICE_NAME"
    fi
}

service_enable() {
    if [ "$SERVICE_MANAGER" = "systemd" ]; then
        [ "$GUARD_REQUIRED" != "1" ] || systemctl enable "${GUARD_SERVICE_NAME}.service"
        systemctl enable "${SERVICE_NAME}.service"
    elif [ "$SERVICE_MANAGER" = "openrc" ]; then
        [ "$GUARD_REQUIRED" != "1" ] || rc-update add "$GUARD_SERVICE_NAME" default >/dev/null
        rc-update add "$SERVICE_NAME" default >/dev/null
    else
        echo_warn "当前环境没有运行 init 系统，服务已使用后台进程启动；系统重启后需重新执行安装命令"
    fi
}

service_disable() {
    if [ "$SERVICE_MANAGER" = "systemd" ]; then
        systemctl disable "${SERVICE_NAME}.service" || true
        systemctl disable "${GUARD_SERVICE_NAME}.service" 2>/dev/null || true
    elif [ "$SERVICE_MANAGER" = "openrc" ]; then
        rc-update del "$SERVICE_NAME" default >/dev/null 2>&1 || true
        rc-update del "$GUARD_SERVICE_NAME" default >/dev/null 2>&1 || true
    fi
}

service_is_active() {
    if [ "$SERVICE_MANAGER" = "systemd" ]; then
        if [ "$GUARD_REQUIRED" != "1" ]; then
            systemctl is-active --quiet "${SERVICE_NAME}.service"
            return $?
        fi
        systemctl is-active --quiet "${GUARD_SERVICE_NAME}.service" && \
            systemctl is-active --quiet "${SERVICE_NAME}.service"
    elif [ "$SERVICE_MANAGER" = "openrc" ]; then
        if [ "$GUARD_REQUIRED" != "1" ]; then
            rc-service "$SERVICE_NAME" status >/dev/null 2>&1
            return $?
        fi
        rc-service "$GUARD_SERVICE_NAME" status >/dev/null 2>&1 && \
            rc-service "$SERVICE_NAME" status >/dev/null 2>&1
    else
        if [ "$GUARD_REQUIRED" != "1" ]; then
            [ -s "/run/${SERVICE_NAME}.pid" ] && kill -0 "$(cat "/run/${SERVICE_NAME}.pid")" 2>/dev/null
            return $?
        fi
        [ -s "/run/${GUARD_SERVICE_NAME}.pid" ] && kill -0 "$(cat "/run/${GUARD_SERVICE_NAME}.pid")" 2>/dev/null && \
            [ -s "/run/${SERVICE_NAME}.pid" ] && kill -0 "$(cat "/run/${SERVICE_NAME}.pid")" 2>/dev/null
    fi
}

service_reload_manager() {
    if [ "$SERVICE_MANAGER" = "systemd" ]; then
        systemctl daemon-reload
    fi
}

configured_port() {
    if [ "$SERVICE_MANAGER" = "systemd" ]; then
        grep 'Environment="PORT=' "/etc/systemd/system/${SERVICE_NAME}.service" 2>/dev/null | sed 's/.*PORT=\([0-9]*\).*/\1/'
    else
        sed -n 's/^PORT="\{0,1\}\([0-9]*\)"\{0,1\}$/\1/p' "/etc/conf.d/${SERVICE_NAME}" 2>/dev/null
    fi
}

primary_ip() {
    local ip_addr
    ip_addr=$(hostname -I 2>/dev/null | awk '{print $1}')
    if [ -z "$ip_addr" ] && command -v ip >/dev/null 2>&1; then
        ip_addr=$(ip route get 1.1.1.1 2>/dev/null | awk '{for (i=1; i<=NF; i++) if ($i == "src") {print $(i+1); exit}}')
    fi
    if [ -z "$ip_addr" ]; then
        ip_addr=$(hostname -i 2>/dev/null | awk '{print $1}')
    fi
    echo "${ip_addr:-127.0.0.1}"
}

# 获取最新版本号
get_latest_version() {
    if [ -z "$VERSION" ]; then
        echo_info "获取最新${RELEASE_CHANNEL}版本..."
        if [ "$RELEASE_CHANNEL" = "prerelease" ]; then
            # /releases/latest 会排除预发布版本。预发布通道取最近发布的非 draft 版本：
            # 新 beta/rc 会被选中；正式版发布在它之后时也会自然成为该通道的新版本。
            VERSION=$(curl -fsSL "https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=30" | \
                jq -r '[.[] | select(.draft == false)] | max_by(.published_at // .created_at) | .tag_name // empty' || true)
        else
            VERSION=$(curl -fsSL "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" | jq -r '.tag_name // empty' || true)
        fi
        if [ -z "$VERSION" ] || [ "$VERSION" = "null" ]; then
            echo_error "无法获取${RELEASE_CHANNEL}版本号，请检查网络连接或 GitHub API 限流"
            exit 1
        fi
        echo_info "目标通道: $RELEASE_CHANNEL"
        echo_info "最新版本: $VERSION"
    fi
}

save_release_channel() {
    mkdir -p "$DATA_DIR"
    echo "$RELEASE_CHANNEL" > "$DATA_DIR/.update-channel"
}

release_asset_url() {
    local name="$1"
    if [ -n "$RELEASE_ASSET_BASE" ]; then
        printf '%s/%s\n' "${RELEASE_ASSET_BASE%/}" "$name"
    else
        printf 'https://github.com/%s/releases/download/%s/%s\n' "$GITHUB_REPO" "$VERSION" "$name"
    fi
}

# 下载二进制文件
download_binary() {
    echo_info "下载 $SERVICE_NAME $VERSION..."
    prepare_staging
    DOWNLOAD_URL=$(release_asset_url "$BINARY_NAME")
    if ! download_asset "$DOWNLOAD_URL" "$STAGING_DIR/$BINARY_NAME" "主控二进制"; then
        echo_error "下载失败，请检查网络连接或版本号"
        exit 1
    fi
    chmod 0755 "$STAGING_DIR/$BINARY_NAME"
    echo_info "主控下载完成"
}

download_guard_artifacts() {
    echo_info "下载并验证 MMWX 授权守护进程..."
    prepare_staging

    # v0.4.7 是引入 Guard 之前最后一个正式版本：它没有发布调用方清单，
    # 也不认识 __verify-update。先探测清单，避免拿旧二进制执行新隐藏命令
    # 后把安装器永久卡在“启动了第二个主控”的状态。仅对这个精确版本兼容，
    # 新版本缺少清单仍然按供应链错误拒绝安装。
    GUARD_MANIFEST_NAME="mmwx-master-linux-$([ "$ARCH" = "x86_64" ] || [ "$ARCH" = "amd64" ] && echo amd64 || echo arm64).manifest"
    if ! download_asset "$(release_asset_url "$GUARD_MANIFEST_NAME")" \
        "$STAGING_DIR/$GUARD_MANIFEST_NAME" "主控签名清单"; then
        if [ "$VERSION" = "v0.4.7" ] || [ "$VERSION" = "0.4.7" ]; then
            GUARD_REQUIRED=0
            echo_warn "v0.4.7 不包含 Guard 清单，将按旧版兼容模式安装；升级后会自动启用 Guard"
            return 0
        fi
        echo_error "$VERSION 缺少主控签名清单，已拒绝不完整安装"
        exit 1
    fi

    local metadata_base="${GUARD_DOWNLOAD_BASE%/}"
    if [ -n "$GUARD_RELEASE" ]; then
        metadata_base="$metadata_base/releases/$GUARD_RELEASE"
    fi
    download_asset "$metadata_base/version.json" "$STAGING_DIR/guard-version.json" "Guard 版本元数据" || {
        echo_error "无法下载 Guard 版本元数据"
        exit 1
    }
    download_asset "$metadata_base/version.json.sig" "$STAGING_DIR/guard-version.json.sig" "Guard 元数据签名" || {
        echo_error "无法下载 Guard 元数据签名"
        exit 1
    }
    if ! "$STAGING_DIR/$BINARY_NAME" __verify-update \
        "$STAGING_DIR/guard-version.json" "$STAGING_DIR/guard-version.json.sig"; then
        echo_error "Guard 版本元数据签名验证失败"
        exit 1
    fi

    local metadata_release
    metadata_release=$(jq -r 'select(.protected == true and .protector == "garble" and .secret_injection == "xor-shares-v1") | .release // empty' \
        "$STAGING_DIR/guard-version.json")
    case "$metadata_release" in
        v[0-9]*.[0-9]*.[0-9]*) ;;
        *) echo_error "Guard 元数据不是受认可的 Garble/XOR 分片版本"; exit 1 ;;
    esac
    if [ -n "$GUARD_RELEASE" ] && [ "$metadata_release" != "$GUARD_RELEASE" ]; then
        echo_error "Guard 元数据版本不匹配: 期望 $GUARD_RELEASE，实际 $metadata_release"
        exit 1
    fi
    GUARD_RELEASE="$metadata_release"

    local immutable_base="${GUARD_DOWNLOAD_BASE%/}/releases/$GUARD_RELEASE"
    download_asset "$immutable_base/$GUARD_BINARY_NAME" "$STAGING_DIR/$GUARD_BINARY_NAME" "Guard 二进制" || exit 1
    download_asset "$immutable_base/$GUARD_BINARY_NAME.sig" "$STAGING_DIR/$GUARD_BINARY_NAME.sig" "Guard 二进制签名" || exit 1
    if ! "$STAGING_DIR/$BINARY_NAME" __verify-update \
        "$STAGING_DIR/$GUARD_BINARY_NAME" "$STAGING_DIR/$GUARD_BINARY_NAME.sig"; then
        echo_error "Guard 二进制签名验证失败"
        exit 1
    fi

    chmod 0755 "$STAGING_DIR/$GUARD_BINARY_NAME"
    if ! "$STAGING_DIR/$GUARD_BINARY_NAME" --role master \
        --manifest "$STAGING_DIR/$GUARD_MANIFEST_NAME" \
        --verify-manifest-for "$STAGING_DIR/$BINARY_NAME"; then
        echo_error "主控二进制与官方签名清单不匹配"
        exit 1
    fi
    echo_info "Guard $GUARD_RELEASE 下载、元数据验签、二进制验签和调用方清单验证完成"
}

# 安装二进制文件
install_binary() {
    echo_info "安装二进制文件..."
    install -m 0755 "$STAGING_DIR/$BINARY_NAME" "$INSTALL_DIR/${SERVICE_NAME}.new"
    mv -f "$INSTALL_DIR/${SERVICE_NAME}.new" "$INSTALL_DIR/$SERVICE_NAME"
    echo_info "已安装到 $INSTALL_DIR/$SERVICE_NAME"
}

install_guard_artifacts() {
    [ "$GUARD_REQUIRED" = "1" ] || return 0
    echo_info "安装授权守护进程与主控签名清单..."
    mkdir -p "$GUARD_MANIFEST_DIR"
    install -m 0755 "$STAGING_DIR/$GUARD_BINARY_NAME" "$GUARD_BINARY_PATH.new"
    install -m 0644 "$STAGING_DIR/$GUARD_MANIFEST_NAME" "$GUARD_MANIFEST_PATH.new"
    mv -f "$GUARD_BINARY_PATH.new" "$GUARD_BINARY_PATH"
    mv -f "$GUARD_MANIFEST_PATH.new" "$GUARD_MANIFEST_PATH"
    echo_info "授权守护进程已安装到 $GUARD_BINARY_PATH"
}

# 创建数据目录
create_directories() {
    echo_info "创建数据目录..."
    mkdir -p "$DATA_DIR"
    mkdir -p "$DATA_DIR/data"
    mkdir -p "$CONFIG_DIR"
    mkdir -p "$GUARD_STATE_DIR" "$GUARD_MANIFEST_DIR"
    chmod 755 "$DATA_DIR"
    chmod 755 "$CONFIG_DIR"
    chmod 700 "$GUARD_STATE_DIR"
}

create_action_guard_service() {
    [ "$GUARD_REQUIRED" = "1" ] || return 0
    if [ "$SERVICE_MANAGER" = "systemd" ]; then
        cat > "/etc/systemd/system/${GUARD_SERVICE_NAME}.service" <<EOF
[Unit]
Description=MMWX Master Authorization Guard
After=network-online.target
Wants=network-online.target
Before=${SERVICE_NAME}.service

[Service]
Type=simple
ExecStart=$GUARD_BINARY_PATH --role master --socket $GUARD_SOCKET --state-dir $GUARD_STATE_DIR --manifest $GUARD_MANIFEST_PATH
Restart=always
RestartSec=3
RuntimeDirectory=mmwx-guard
RuntimeDirectoryMode=0750
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$GUARD_STATE_DIR /run/mmwx-guard

[Install]
WantedBy=multi-user.target
EOF
        mkdir -p "/etc/systemd/system/${SERVICE_NAME}.service.d"
        cat > "/etc/systemd/system/${SERVICE_NAME}.service.d/action-guard.conf" <<EOF
[Unit]
Wants=${GUARD_SERVICE_NAME}.service
After=${GUARD_SERVICE_NAME}.service

[Service]
Environment="MMWX_GUARD_SOCKET=$GUARD_SOCKET"
EOF
    elif [ "$SERVICE_MANAGER" = "openrc" ]; then
        cat > "/etc/init.d/${GUARD_SERVICE_NAME}" <<EOF
#!/sbin/openrc-run
name="MMWX Master Authorization Guard"
command="$GUARD_BINARY_PATH"
command_args="--role master --socket $GUARD_SOCKET --state-dir $GUARD_STATE_DIR --manifest $GUARD_MANIFEST_PATH"
supervisor="supervise-daemon"
respawn_delay=3
respawn_max=0
depend() { need net; before $SERVICE_NAME; }
start_pre() { checkpath -d -m 0750 "$(dirname "$GUARD_SOCKET")"; checkpath -d -m 0700 "$GUARD_STATE_DIR"; }
EOF
        chmod 0755 "/etc/init.d/${GUARD_SERVICE_NAME}"
        sed -i '/^MMWX_ACTION_GUARD=/d; /^MMWX_GUARD_SOCKET=/d' "/etc/conf.d/${SERVICE_NAME}"
        cat >> "/etc/conf.d/${SERVICE_NAME}" <<EOF
MMWX_GUARD_SOCKET="$GUARD_SOCKET"
EOF
        if ! grep -q 'export .*MMWX_GUARD_SOCKET' "/etc/init.d/${SERVICE_NAME}"; then
            sed -i 's/export PORT MMWX_DATA_DIR LOG_LEVEL/export PORT MMWX_DATA_DIR LOG_LEVEL MMWX_GUARD_SOCKET/' "/etc/init.d/${SERVICE_NAME}"
        fi
    fi
    service_reload_manager
}

# 创建 systemd / OpenRC 服务
create_systemd_service() {
    echo_info "创建服务配置..."

    # 询问端口号（支持非交互式环境）
    echo ""
    if [ -t 0 ]; then
        # 交互式环境，可以读取用户输入
        read -p "请输入端口号（默认 12889，直接回车使用默认值）: " PORT_INPUT
        if [ -z "$PORT_INPUT" ]; then
            PORT_INPUT=12889
        fi
    else
        # 非交互式环境（如管道），使用默认值
        PORT_INPUT=${PORT:-12889}
        echo_info "使用端口: $PORT_INPUT"
    fi

    if [ "$SERVICE_MANAGER" = "systemd" ]; then
        cat > /etc/systemd/system/${SERVICE_NAME}.service <<EOF
[Unit]
Description=妙妙屋X - Xray 服务器管理与订阅拼车系统
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=$DATA_DIR
ExecStart=$INSTALL_DIR/$SERVICE_NAME
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SERVICE_NAME

# 环境变量
Environment="PORT=$PORT_INPUT"
Environment="MMWX_DATA_DIR=$DATA_DIR/data"
Environment="LOG_LEVEL=info"

# 安全选项
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
        systemctl daemon-reload
    else
        mkdir -p /etc/conf.d /var/log
        cat > /etc/conf.d/${SERVICE_NAME} <<EOF
PORT="$PORT_INPUT"
MMWX_DATA_DIR="$DATA_DIR/data"
LOG_LEVEL="info"
EOF
        cat > /etc/init.d/${SERVICE_NAME} <<EOF
#!/sbin/openrc-run

name="妙妙屋X"
description="妙妙屋X - Xray 服务器管理与订阅拼车系统"
command="$INSTALL_DIR/$SERVICE_NAME"
command_background="yes"
directory="$DATA_DIR"
pidfile="/run/$SERVICE_NAME.pid"
output_log="/var/log/$SERVICE_NAME.log"
error_log="/var/log/$SERVICE_NAME.log"

PORT="\${PORT:-12889}"
MMWX_DATA_DIR="\${MMWX_DATA_DIR:-$DATA_DIR/data}"
LOG_LEVEL="\${LOG_LEVEL:-info}"
export PORT MMWX_DATA_DIR LOG_LEVEL

depend() {
    need net
    after firewall
}
EOF
        chmod 755 /etc/init.d/${SERVICE_NAME}
    fi
    echo_info "$SERVICE_MANAGER 服务已创建（端口: $PORT_INPUT）"
}

# 启动服务
start_service() {
    echo_info "启动服务..."
    service_enable
    service_start
    sleep 2

    if [ "$GUARD_REQUIRED" != "1" ] && service_is_active; then
        echo_info "主控服务已按旧版兼容模式启动！"
        return 0
    fi
    if service_is_active && MMWX_GUARD_SOCKET="$GUARD_SOCKET" \
        "$INSTALL_DIR/$SERVICE_NAME" __guard-self-test >/dev/null 2>&1; then
        echo_info "主控与 Guard 服务启动并完成调用方验证！"
        return 0
    else
        echo_error "主控或 Guard 启动/调用方验证失败"
        return 1
    fi
}

# 显示状态
show_status() {
    CONFIGURED_PORT=$(configured_port)
    CONFIGURED_PORT=${CONFIGURED_PORT:-12889}

    echo ""
    echo "======================================"
    echo_info "妙妙屋X 安装完成！"
    echo "======================================"
    echo ""
    echo "📦 安装位置: $INSTALL_DIR/$SERVICE_NAME"
    echo "💾 数据目录: $DATA_DIR"
    echo "🌐 访问地址: http://$(primary_ip):$CONFIGURED_PORT"
    echo ""
    echo "常用命令:"
    if [ "$SERVICE_MANAGER" = "systemd" ]; then
        echo "  启动服务: systemctl start $SERVICE_NAME"
        echo "  停止服务: systemctl stop $SERVICE_NAME"
        echo "  重启服务: systemctl restart $SERVICE_NAME"
        echo "  查看状态: systemctl status $SERVICE_NAME"
        echo "  查看日志: journalctl -u $SERVICE_NAME -f"
    elif [ "$SERVICE_MANAGER" = "openrc" ]; then
        echo "  启动服务: rc-service $SERVICE_NAME start"
        echo "  停止服务: rc-service $SERVICE_NAME stop"
        echo "  重启服务: rc-service $SERVICE_NAME restart"
        echo "  查看状态: rc-service $SERVICE_NAME status"
        echo "  查看日志: tail -f /var/log/$SERVICE_NAME.log"
    else
        echo "  停止服务: kill \$(cat /run/$SERVICE_NAME.pid)"
        echo "  启动服务: 重新执行安装或更新命令"
        echo "  查看日志: 查看进程标准输出或系统日志"
    fi
    echo "  更新版本: curl -sL https://raw.githubusercontent.com/${GITHUB_REPO}/main/install.sh | sudo bash -s update"
    echo "  覆盖安装: curl -sL https://raw.githubusercontent.com/${GITHUB_REPO}/main/install.sh | sudo bash -s reinstall"
    echo "  卸载服务: curl -sL https://raw.githubusercontent.com/${GITHUB_REPO}/main/install.sh | sudo bash -s uninstall"
    echo ""
    echo "⚠️  首次访问需要完成初始化配置"
    echo ""
}

# 更新服务
update_service() {
    echo_info "开始更新妙妙屋X..."
    echo ""

    # 检查服务是否已安装
    if [ ! -f "$INSTALL_DIR/$SERVICE_NAME" ]; then
        echo_error "未检测到已安装的服务，请先使用安装模式"
        exit 1
    fi

    # 显示当前版本
    if [ -f "$DATA_DIR/.version" ]; then
        CURRENT_VERSION=$(cat "$DATA_DIR/.version")
        echo_info "当前版本: $CURRENT_VERSION"
    fi
    echo_info "目标版本: $VERSION"
    echo ""

    # 先完整下载和验签，避免慢网络导致服务长时间离线。
    download_binary
    download_guard_artifacts

    # 询问是否修改端口（支持非交互式环境）
    CURRENT_PORT=$(configured_port)
    CURRENT_PORT=${CURRENT_PORT:-12889}
    echo ""
    if [ -t 0 ]; then
        # 交互式环境
        read -p "请输入端口号（默认 $CURRENT_PORT，直接回车使用默认值）: " PORT_INPUT
        if [ -z "$PORT_INPUT" ]; then
            PORT_INPUT=$CURRENT_PORT
        fi
    else
        # 非交互式环境，保持当前端口或使用环境变量
        PORT_INPUT=${PORT:-$CURRENT_PORT}
        echo_info "使用端口: $PORT_INPUT"
    fi

    if [ "$SERVICE_MANAGER" = "systemd" ]; then
        SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
        sed -i "s|^WorkingDirectory=.*|WorkingDirectory=$DATA_DIR|" "$SERVICE_FILE"
        sed -i "s/Environment=\"PORT=[0-9]*\"/Environment=\"PORT=$PORT_INPUT\"/" "$SERVICE_FILE"
        if grep -q '^Environment="MMWX_DATA_DIR=' "$SERVICE_FILE"; then
            sed -i "s|^Environment=\"MMWX_DATA_DIR=.*|Environment=\"MMWX_DATA_DIR=$DATA_DIR/data\"|" "$SERVICE_FILE"
        else
            sed -i "/^Environment=\"PORT=/a Environment=\"MMWX_DATA_DIR=$DATA_DIR/data\"" "$SERVICE_FILE"
        fi
    else
        sed -i "s/^PORT=.*/PORT=\"$PORT_INPUT\"/" /etc/conf.d/${SERVICE_NAME}
        if grep -q '^MMWX_DATA_DIR=' /etc/conf.d/${SERVICE_NAME}; then
            sed -i "s|^MMWX_DATA_DIR=.*|MMWX_DATA_DIR=\"$DATA_DIR/data\"|" /etc/conf.d/${SERVICE_NAME}
        else
            printf '\nMMWX_DATA_DIR="%s/data"\n' "$DATA_DIR" >> /etc/conf.d/${SERVICE_NAME}
        fi
    fi
    # 端口配置可能已更新；先让 init 系统重新载入，避免停止旧服务时报告 unit 已变更。
    service_reload_manager
    echo_info "停止服务..."
    service_stop

    local had_guard="false" had_manifest="false"
    echo_info "备份当前版本..."
    cp -p "$INSTALL_DIR/$SERVICE_NAME" "$INSTALL_DIR/${SERVICE_NAME}.bak"
    if [ -f "$GUARD_BINARY_PATH" ]; then
        cp -p "$GUARD_BINARY_PATH" "$GUARD_BINARY_PATH.bak"
        had_guard="true"
    else
        rm -f "$GUARD_BINARY_PATH.bak"
    fi
    if [ -f "$GUARD_MANIFEST_PATH" ]; then
        cp -p "$GUARD_MANIFEST_PATH" "$GUARD_MANIFEST_PATH.bak"
        had_manifest="true"
    else
        rm -f "$GUARD_MANIFEST_PATH.bak"
    fi

    create_directories
    install_guard_artifacts
    install_binary
    create_action_guard_service
    service_reload_manager

    # 启动服务
    if start_service; then
        echo "$VERSION" > "$DATA_DIR/.version"
        save_release_channel
        rm -f "$INSTALL_DIR/${SERVICE_NAME}.bak" "$GUARD_BINARY_PATH.bak" "$GUARD_MANIFEST_PATH.bak"
        echo ""
        echo "======================================"
        echo_info "更新完成！"
        echo "======================================"
        echo ""
        echo "📦 版本: $VERSION"
        echo "🌐 访问地址: http://$(primary_ip):$PORT_INPUT"
        echo ""
    else
        echo_error "更新后服务启动失败，正在回滚..."
        service_stop
        mv -f "$INSTALL_DIR/${SERVICE_NAME}.bak" "$INSTALL_DIR/$SERVICE_NAME"
        if [ "$had_guard" = "true" ]; then
            mv -f "$GUARD_BINARY_PATH.bak" "$GUARD_BINARY_PATH"
        else
            rm -f "$GUARD_BINARY_PATH"
        fi
        if [ "$had_manifest" = "true" ]; then
            mv -f "$GUARD_MANIFEST_PATH.bak" "$GUARD_MANIFEST_PATH"
        else
            rm -f "$GUARD_MANIFEST_PATH"
        fi
        if [ "$had_guard" = "true" ]; then
            service_start || true
        elif [ "$SERVICE_MANAGER" = "systemd" ]; then
            rm -f "/etc/systemd/system/${GUARD_SERVICE_NAME}.service" \
                "/etc/systemd/system/${SERVICE_NAME}.service.d/action-guard.conf"
            systemctl daemon-reload
            systemctl start "${SERVICE_NAME}.service" || true
        elif [ "$SERVICE_MANAGER" = "openrc" ]; then
            rc-update del "$GUARD_SERVICE_NAME" default >/dev/null 2>&1 || true
            rm -f "/etc/init.d/${GUARD_SERVICE_NAME}"
            rc-service "$SERVICE_NAME" start || true
        fi
        echo_error "已回滚到之前版本，请查看服务日志"
        exit 1
    fi
}

# 卸载服务
uninstall_service() {
    echo_info "开始卸载妙妙屋X..."
    echo ""

    # 检查服务是否已安装
    if [ ! -f "$INSTALL_DIR/$SERVICE_NAME" ]; then
        echo_error "未检测到已安装的服务"
        exit 1
    fi

    # 显示当前版本
    if [ -f "$DATA_DIR/.version" ]; then
        CURRENT_VERSION=$(cat "$DATA_DIR/.version")
        echo_info "当前版本: $CURRENT_VERSION"
        echo ""
    fi

    # 停止并禁用服务
    echo_info "停止并禁用服务..."
    service_stop
    service_disable
    echo_info "✓ 服务已停止"
    echo ""

    # 询问是否保留配置和数据
    KEEP_DATA=false
    if [ -t 0 ]; then
        # 交互式环境
        echo "是否保留配置和数据？"
        echo "  1) 完全删除（删除所有文件和数据）"
        echo "  2) 保留数据（保留 $DATA_DIR 和 $CONFIG_DIR 目录）"
        read -p "请选择 (1/2，默认 2): " CHOICE

        if [ "$CHOICE" = "1" ]; then
            KEEP_DATA=false
        else
            KEEP_DATA=true
        fi
    else
        # 非交互式环境，检查环境变量
        if [ "$KEEP_DATA" != "false" ]; then
            KEEP_DATA=true
        fi
        if [ "$KEEP_DATA" = "true" ]; then
            echo_info "保留数据模式"
        else
            echo_info "完全删除模式"
        fi
    fi
    echo ""

    echo_info "删除服务配置..."
    rm -f "/etc/systemd/system/${SERVICE_NAME}.service" \
        "/etc/systemd/system/${GUARD_SERVICE_NAME}.service" \
        "/etc/systemd/system/${SERVICE_NAME}.service.d/action-guard.conf" \
        "/etc/init.d/${SERVICE_NAME}" "/etc/init.d/${GUARD_SERVICE_NAME}" "/etc/conf.d/${SERVICE_NAME}"
    service_reload_manager
    echo_info "✓ 服务配置已删除"
    echo ""

    # 删除二进制文件
    echo_info "删除程序文件..."
    rm -f "$INSTALL_DIR/$SERVICE_NAME" "$INSTALL_DIR/${SERVICE_NAME}.bak" \
        "$GUARD_BINARY_PATH" "$GUARD_BINARY_PATH.bak" \
        "$GUARD_MANIFEST_PATH" "$GUARD_MANIFEST_PATH.bak"
    echo_info "✓ 程序文件已删除"
    echo ""

    # 根据选择删除或保留数据
    if [ "$KEEP_DATA" = "false" ]; then
        echo_info "删除数据和配置..."
        rm -rf "$DATA_DIR" "$CONFIG_DIR"
        rm -rf "$GUARD_STATE_DIR"
        echo_info "✓ 数据和配置已删除"
        echo ""
        echo "======================================"
        echo_info "卸载完成！所有文件已删除"
        echo "======================================"
    else
        echo_info "保留数据目录: $DATA_DIR"
        echo_info "保留配置目录: $CONFIG_DIR"
        echo ""
        echo "======================================"
        echo_info "卸载完成！配置和数据已保留"
        echo "======================================"
        echo ""
        echo "如需重新安装:"
        echo "  curl -sL https://raw.githubusercontent.com/${GITHUB_REPO}/main/install.sh | sudo bash"
    fi
    echo ""
}

# 覆盖安装（全量重装，保留数据）
reinstall_service() {
    echo_info "开始覆盖安装妙妙屋X..."
    echo ""

    download_binary
    download_guard_artifacts

    # 停止已有服务
    if service_is_active; then
        echo_info "停止现有服务..."
        service_stop
    fi

    local had_master="false" had_guard="false" had_manifest="false"
    # 备份当前二进制文件
    if [ -f "$INSTALL_DIR/$SERVICE_NAME" ]; then
        echo_info "备份当前版本..."
        cp -p "$INSTALL_DIR/$SERVICE_NAME" "$INSTALL_DIR/${SERVICE_NAME}.bak"
        had_master="true"
    fi
    if [ -f "$GUARD_BINARY_PATH" ]; then
        cp -p "$GUARD_BINARY_PATH" "$GUARD_BINARY_PATH.bak"
        had_guard="true"
    fi
    if [ -f "$GUARD_MANIFEST_PATH" ]; then
        cp -p "$GUARD_MANIFEST_PATH" "$GUARD_MANIFEST_PATH.bak"
        had_manifest="true"
    fi

    # 全量覆盖：下载、安装、重建目录和服务
    create_directories
    install_guard_artifacts
    install_binary
    create_systemd_service
    create_action_guard_service

    if start_service; then
        echo "$VERSION" > "$DATA_DIR/.version"
        save_release_channel
        rm -f "$INSTALL_DIR/${SERVICE_NAME}.bak" "$GUARD_BINARY_PATH.bak" "$GUARD_MANIFEST_PATH.bak"
        show_status
        echo_info "覆盖安装完成！数据已保留。"
        echo ""
    else
        echo_error "覆盖安装后服务启动失败，正在回滚..."
        service_stop
        if [ "$had_master" = "true" ] && [ -f "$INSTALL_DIR/${SERVICE_NAME}.bak" ]; then
            mv "$INSTALL_DIR/${SERVICE_NAME}.bak" "$INSTALL_DIR/$SERVICE_NAME"
        else
            rm -f "$INSTALL_DIR/$SERVICE_NAME"
        fi
        if [ "$had_guard" = "true" ]; then
            mv -f "$GUARD_BINARY_PATH.bak" "$GUARD_BINARY_PATH"
        else
            rm -f "$GUARD_BINARY_PATH"
        fi
        if [ "$had_manifest" = "true" ]; then
            mv -f "$GUARD_MANIFEST_PATH.bak" "$GUARD_MANIFEST_PATH"
        else
            rm -f "$GUARD_MANIFEST_PATH"
        fi
        if [ "$had_master" = "true" ] && [ "$had_guard" = "true" ]; then
            service_start || true
        fi
        echo_error "已回滚到之前版本"
        echo_error "请查看服务日志"
        exit 1
    fi
}

# 主函数
main() {
    MODE="${1:-install}"
    if [ "$MODE" = "prerelease" ]; then
        RELEASE_CHANNEL="prerelease"
        if [ -f "$INSTALL_DIR/$SERVICE_NAME" ]; then
            MODE="update"
        else
            MODE="install"
        fi
    fi
    # 检查命令行参数
    if [ "$MODE" = "update" ]; then
        echo_info "进入更新模式..."
        check_root
        check_architecture
        install_dependencies
        detect_service_manager
        get_latest_version
        update_service
    elif [ "$MODE" = "reinstall" ]; then
        echo_info "进入覆盖安装模式..."
        check_root
        check_architecture
        install_dependencies
        detect_service_manager
        get_latest_version
        reinstall_service
    elif [ "$MODE" = "uninstall" ]; then
        echo_info "进入卸载模式..."
        check_root
        detect_service_manager
        uninstall_service
    else
        echo_info "开始安装妙妙屋X..."
        echo ""

        check_root
        if [ -f "$INSTALL_DIR/$SERVICE_NAME" ]; then
            echo_error "检测到已安装的主控，请使用 update 或 reinstall 模式"
            exit 1
        fi
        choose_install_options
        if [ "$INSTALL_METHOD" = "docker" ]; then
            install_dependencies
            install_docker_stack
            return
        fi
        check_architecture
        install_dependencies
        detect_service_manager
        get_latest_version
        download_binary
        download_guard_artifacts
        create_directories
        install_guard_artifacts
        install_binary
        if [ "$DATABASE_MODE" = "postgres" ]; then
            configure_native_postgres
        fi
        create_systemd_service
        create_action_guard_service

        if start_service; then
            echo "$VERSION" > "$DATA_DIR/.version"
            save_release_channel
            show_status
        else
            service_stop
            service_disable
            rm -f "/etc/systemd/system/${SERVICE_NAME}.service" \
                "/etc/systemd/system/${GUARD_SERVICE_NAME}.service" \
                "/etc/systemd/system/${SERVICE_NAME}.service.d/action-guard.conf" \
                "/etc/init.d/${SERVICE_NAME}" "/etc/init.d/${GUARD_SERVICE_NAME}" "/etc/conf.d/${SERVICE_NAME}" \
                "$INSTALL_DIR/$SERVICE_NAME" "$GUARD_BINARY_PATH" "$GUARD_MANIFEST_PATH"
            service_reload_manager
            echo_error "安装过程中出现错误，请查看 $SERVICE_MANAGER 服务日志"
            exit 1
        fi
    fi
}

# 运行主函数
trap cleanup_staging EXIT
main "$@"
