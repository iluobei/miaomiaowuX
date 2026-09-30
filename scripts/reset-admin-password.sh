#!/usr/bin/env bash
# reset-admin-password.sh — 重置妙妙屋X 管理员密码(本地,无需登录管理面板)。
#
# 设计意图:admin 忘密码 / TOTP 丢失 / 误操作锁死自己 时的本地救场工具。
# 不通过任何远程服务(License、API 等)修改数据库,杜绝"中心服务被攻破 → 全用户主控沦陷"的风险。
#
# 兼容:
#   - 一键安装 systemd 部署(默认 /etc/mmwx/data,SQLite 或本机 PostgreSQL)
#   - Docker / docker compose(容器名 miaomiaowux 或镜像 ghcr.io/iluobei/miaomiaowux;
#     SQLite 从容器挂载点找到宿主机文件,PostgreSQL 优先进 miaomiaowux-postgres 容器执行)
#   - 二进制直跑(从进程 cwd 找到 data 目录)
#   数据库选择与主控一致:MMWX_DATABASE_* 环境变量 > data/database.json > 默认 SQLite。
#
# 用法:
#   sudo bash reset-admin-password.sh                        # 交互式,自动探测
#   sudo bash reset-admin-password.sh --db /path/to/mmwx.db  # 显式指定 SQLite 文件
#   sudo bash reset-admin-password.sh --data-dir /etc/mmwx/data
#   sudo bash reset-admin-password.sh --container miaomiaowux
#   sudo bash reset-admin-password.sh --user admin           # 直接指定要重置的管理员
#   sudo bash reset-admin-password.sh --no-restart           # 不重启服务
#
# 退出码:0 成功;1 找不到数据库;2 找不到用户;3 hash 失败;4 写库失败;5 用户取消。

set -euo pipefail

#─── 输出样式 ──────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
info()  { echo -e "${BLUE}[INFO]${NC} $*" >&2; }
ok()    { echo -e "${GREEN}[ OK ]${NC} $*" >&2; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*" >&2; }
err()   { echo -e "${RED}[FAIL]${NC} $*" >&2; }

#─── 参数解析 ──────────────────────────────────────────────
DB_PATH=""
DATA_DIR_ARG=""
CONTAINER_ARG=""
TARGET=""
RESTART=1
SERVICE_NAME="mmwx"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --db)         DB_PATH="$2"; shift 2 ;;
        --data-dir)   DATA_DIR_ARG="$2"; shift 2 ;;
        --container)  CONTAINER_ARG="$2"; shift 2 ;;
        --user)       TARGET="$2"; shift 2 ;;
        --no-restart) RESTART=0; shift ;;
        -h|--help)
            sed -n '2,22p' "$0"; exit 0 ;;
        *)
            err "未知参数: $1"; exit 2 ;;
    esac
done

if [[ $EUID -ne 0 ]]; then
    warn "当前不是 root,读取数据库 / 控制服务可能失败,建议用 sudo 运行"
fi

#─── 1. 探测系统 + 包管理器 ────────────────────────────────
OS=""; PKG_INSTALL=""
detect_os() {
    if [[ -f /etc/os-release ]]; then
        # shellcheck disable=SC1091
        . /etc/os-release
        OS="$ID"
    elif command -v lsb_release &>/dev/null; then
        OS=$(lsb_release -si | tr '[:upper:]' '[:lower:]')
    else
        OS="unknown"
    fi
    case "$OS" in
        debian|ubuntu|linuxmint|raspbian) PKG_INSTALL="apt-get install -y" ;;
        rhel|centos|rocky|almalinux|fedora|ol|amzn) PKG_INSTALL="yum install -y" ;;
        alpine) PKG_INSTALL="apk add --no-cache" ;;
        arch|manjaro) PKG_INSTALL="pacman -S --noconfirm" ;;
        *) PKG_INSTALL="" ;;
    esac
}
detect_os
info "系统: $OS"

ensure_pkg() {
    local cmd="$1"; local pkg="$2"
    if command -v "$cmd" &>/dev/null; then return 0; fi
    if [[ -z "$PKG_INSTALL" ]]; then
        err "缺少 $cmd 且不识别本系统包管理器,请手动安装"; return 1
    fi
    info "$cmd 未安装,正在安装 $pkg..."
    if [[ "$PKG_INSTALL" == apt-get* ]]; then apt-get update -y >/dev/null 2>&1 || true; fi
    if ! $PKG_INSTALL "$pkg" >/dev/null 2>&1; then
        err "$pkg 安装失败,请手动 $PKG_INSTALL $pkg"; return 1
    fi
    if ! command -v "$cmd" &>/dev/null; then
        err "$pkg 已装但 $cmd 仍找不到"; return 1
    fi
    ok "$pkg 安装完成"
}

#─── 2. 探测部署方式:systemd / docker / 裸进程 ─────────────
# DEPLOY=systemd|docker|none;CID=主控容器 ID;PROC_ENV=主控进程看到的环境变量(KEY=VAL 每行一条)
DEPLOY="none"
CID=""
CID_RUNNING=0
PROC_ENV=""
WORKDIR=""

find_mmwx_container() {
    command -v docker &>/dev/null || return 1
    if [[ -n "$CONTAINER_ARG" ]]; then
        docker inspect -f '{{.Id}}' "$CONTAINER_ARG" 2>/dev/null | cut -c1-12
        return
    fi
    # 官方 compose:container_name=miaomiaowux、镜像 ghcr.io/iluobei/miaomiaowux、进程 /app/server。
    # 旧版只按 "mmwx" 匹配名字/镜像,一个都对不上 —— docker 部署完全探测不到。
    docker ps -a --no-trunc --format '{{.ID}}|{{.Names}}|{{.Image}}|{{.Command}}' 2>/dev/null |
        awk -F'|' '
            tolower($2 $3) ~ /postgres/ { next }
            { $1 = substr($1, 1, 12) }
            $2 == "miaomiaowux"                       { print $1; found=1; exit }
            tolower($3) ~ /(miaomiaowux|mmwx)/ && !img { img=$1 }
            $4 ~ /\/app\/server/ && !cmd               { cmd=$1 }
            END { if (!found) { if (img) print img; else if (cmd) print cmd } }'
}

if systemctl cat "$SERVICE_NAME" &>/dev/null; then
    DEPLOY="systemd"
    WORKDIR=$(systemctl show "$SERVICE_NAME" -p WorkingDirectory --value 2>/dev/null || true)
    # Environment= 是空格分隔的 KEY=VAL;EnvironmentFile 里的也要读(install.sh 的 drop-in 两种都用过)
    PROC_ENV=$(systemctl show "$SERVICE_NAME" -p Environment --value 2>/dev/null | tr ' ' '\n' || true)
    while IFS= read -r ef; do
        ef="${ef%% (*}"; ef="${ef#-}"
        [[ -n "$ef" && -f "$ef" ]] && PROC_ENV+=$'\n'"$(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$ef" | sed -E "s/^([^=]+)=[\"']?([^\"']*)[\"']?\$/\1=\2/")"
    done < <(systemctl show "$SERVICE_NAME" -p EnvironmentFiles --value 2>/dev/null | tr ' ' '\n' | grep '^/\|^-/' || true)
else
    CID=$(find_mmwx_container || true)
    if [[ -n "$CID" ]]; then
        DEPLOY="docker"
        [[ "$(docker inspect -f '{{.State.Running}}' "$CID" 2>/dev/null)" == "true" ]] && CID_RUNNING=1
        PROC_ENV=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$CID" 2>/dev/null || true)
        WORKDIR=$(docker inspect -f '{{.Config.WorkingDir}}' "$CID" 2>/dev/null || true)
        info "Docker 容器: ${BOLD}$(docker inspect -f '{{.Name}}' "$CID" | sed 's#^/##')${NC} ($CID)"
    fi
fi
info "部署方式: $DEPLOY"

# proc_env KEY → 主控进程里该变量的值(后出现的覆盖前面的,与 systemd / docker 一致)
proc_env() {
    printf '%s\n' "$PROC_ENV" | awk -F= -v k="$1" '$1 == k { v = substr($0, length(k) + 2) } END { print v }'
}

# host_path 把容器内路径换算成宿主机路径(按挂载点最长前缀匹配)。非 docker 原样返回。
host_path() {
    local p="$1"
    if [[ "$DEPLOY" != "docker" ]]; then echo "$p"; return 0; fi
    docker inspect -f '{{range .Mounts}}{{.Destination}}|{{.Source}}{{println}}{{end}}' "$CID" 2>/dev/null |
        awk -F'|' -v p="$p" '
            $1 != "" && (p == $1 || index(p, $1 "/") == 1) && length($1) > best {
                best = length($1); out = $2 substr(p, length($1) + 1)
            }
            END { if (out != "") print out; else exit 1 }'
}

#─── 3. 解析数据库配置(与主控 LoadDatabaseConfig 同一优先级) ──
# service_data_dir → 探测到的主控自己用的数据目录(宿主机路径);容器里没挂载出来时为空。
service_data_dir() {
    local cdir
    cdir=$(proc_env MMWX_DATA_DIR)
    if [[ -z "$cdir" ]]; then
        case "$DEPLOY" in
            docker)  cdir="${WORKDIR:-/app}/data" ;;
            systemd) [[ -n "$WORKDIR" && "$WORKDIR" != "/" ]] && cdir="$WORKDIR/data" ;;
        esac
    fi
    [[ -z "$cdir" ]] && cdir="/etc/mmwx/data"
    host_path "$cdir" || true
}

DATA_DIR=""
if [[ -n "$DATA_DIR_ARG" ]]; then
    DATA_DIR="$DATA_DIR_ARG"
    # --data-dir 指到的不是探测到的那个主控的目录:那个主控跟本次要改的库无关 ——
    # 不读它的环境变量(否则会拿它的库配置去改),也绝不停止 / 重启它。
    # (测试时就这样误重启过同机另一套主控。)显式 --container 视为用户已确认两者对应。
    if [[ "$DEPLOY" != "none" && -z "$CONTAINER_ARG" ]]; then
        svc_dir=$(service_data_dir)
        if [[ -z "$svc_dir" || "$(readlink -f "$DATA_DIR_ARG")" != "$(readlink -f "$svc_dir")" ]]; then
            warn "--data-dir 不是运行中主控($DEPLOY)的数据目录${svc_dir:+($svc_dir)},本次不会停止或重启任何服务"
            DEPLOY="none"; CID=""; CID_RUNNING=0; PROC_ENV=""
        fi
    fi
else
    DATA_DIR=$(service_data_dir)
    if [[ -z "$DATA_DIR" ]]; then
        err "容器内数据目录没有挂载到宿主机,无法定位数据库。可用 --data-dir 或 --db 手动指定"
        exit 1
    fi
fi

# json_get KEY FILE → database.json 里某个键的值(字符串或数字)。有 python3 用它,没有退回正则。
json_get() {
    local key="$1" file="$2"
    if command -v python3 &>/dev/null; then
        python3 - "$key" "$file" <<'PY' 2>/dev/null && return 0
import json, sys
v = json.load(open(sys.argv[2])).get(sys.argv[1], "")
print("" if v is None else v)
PY
    fi
    tr -d '\n' < "$file" | grep -oE "\"$key\"[[:space:]]*:[[:space:]]*(\"([^\"\\\\]|\\\\.)*\"|[0-9]+)" |
        head -1 | sed -E "s/^\"$key\"[[:space:]]*:[[:space:]]*//; s/^\"//; s/\"\$//"
}

DB_DRIVER=""; PG_HOST=""; PG_PORT=""; PG_DB=""; PG_USER=""; PG_PASS=""; PG_SSL=""; SQLITE_CONF_PATH=""
DB_SOURCE=""
if [[ -z "$DB_PATH" ]]; then
    env_driver=$(proc_env MMWX_DATABASE_DRIVER)
    env_any=""
    for k in MMWX_DATABASE_DRIVER MMWX_DATABASE_PATH MMWX_DATABASE_HOST MMWX_DATABASE_PORT \
             MMWX_DATABASE_NAME MMWX_DATABASE_USER MMWX_DATABASE_PASSWORD MMWX_DATABASE_SSLMODE; do
        [[ -n "$(proc_env "$k")" ]] && env_any=1
    done
    if [[ -f "$DATA_DIR/database.json" ]]; then
        DB_SOURCE="$DATA_DIR/database.json"
        DB_DRIVER=$(json_get driver "$DATA_DIR/database.json")
        SQLITE_CONF_PATH=$(json_get path "$DATA_DIR/database.json")
        PG_HOST=$(json_get host "$DATA_DIR/database.json")
        PG_PORT=$(json_get port "$DATA_DIR/database.json")
        PG_DB=$(json_get database "$DATA_DIR/database.json")
        PG_USER=$(json_get username "$DATA_DIR/database.json")
        PG_PASS=$(json_get password "$DATA_DIR/database.json")
        PG_SSL=$(json_get ssl_mode "$DATA_DIR/database.json")
    fi
    # 环境变量逐项覆盖(主控 applyDatabaseEnv 也是逐项覆盖,不是整份替换)
    if [[ -n "$env_any" ]]; then
        DB_SOURCE="${DB_SOURCE:+$DB_SOURCE + }进程环境变量 MMWX_DATABASE_*"
        [[ -n "$env_driver" ]] && DB_DRIVER="$env_driver"
        v=$(proc_env MMWX_DATABASE_PATH); [[ -z "$v" ]] && v=$(proc_env DATABASE_PATH); [[ -n "$v" ]] && SQLITE_CONF_PATH="$v"
        v=$(proc_env MMWX_DATABASE_HOST);     [[ -n "$v" ]] && PG_HOST="$v"
        v=$(proc_env MMWX_DATABASE_PORT);     [[ -n "$v" ]] && PG_PORT="$v"
        v=$(proc_env MMWX_DATABASE_NAME);     [[ -n "$v" ]] && PG_DB="$v"
        v=$(proc_env MMWX_DATABASE_USER);     [[ -n "$v" ]] && PG_USER="$v"
        v=$(proc_env MMWX_DATABASE_PASSWORD); [[ -n "$v" ]] && PG_PASS="$v"
        v=$(proc_env MMWX_DATABASE_SSLMODE);  [[ -n "$v" ]] && PG_SSL="$v"
    elif [[ -z "$SQLITE_CONF_PATH" ]]; then
        v=$(proc_env DATABASE_PATH); [[ -n "$v" ]] && SQLITE_CONF_PATH="$v"
    fi
fi
DB_DRIVER=$(echo "${DB_DRIVER:-sqlite}" | tr '[:upper:]' '[:lower:]')
case "$DB_DRIVER" in postgresql|pgsql) DB_DRIVER="postgres" ;; esac
[[ -n "$DB_PATH" ]] && DB_DRIVER="sqlite"
PG_PORT="${PG_PORT:-5432}"; PG_SSL="${PG_SSL:-prefer}"

#─── 4a. SQLite:定位文件 ──────────────────────────────────
find_db_via_process() {
    local pids
    pids=$(pgrep -f '(^|/)(mmwx|server)($|[[:space:]])' 2>/dev/null | head -5 || true)
    for pid in $pids; do
        local cwd
        cwd=$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)
        [[ -z "$cwd" ]] && continue
        for cand in "$cwd/data/mmwx.db" "$cwd/mmwx.db"; do
            if [[ -f "$cand" ]]; then echo "$cand"; return 0; fi
        done
    done
    return 1
}

find_db_via_scan() {
    local found
    found=$(find /etc /opt /root /var/lib /srv /home -maxdepth 5 -name 'mmwx.db' -not -path '*/proc/*' 2>/dev/null | head -5 || true)
    [[ -z "$found" ]] && return 1
    if [[ $(echo "$found" | wc -l) -eq 1 ]]; then echo "$found"; return 0; fi
    warn "找到多个候选 db 文件:"
    local i=1; local arr=()
    while IFS= read -r line; do
        arr+=("$line"); echo "  [$i] $line" >&2; ((i++))
    done <<<"$found"
    printf "选择 [1-%d]: " "$((i-1))" >&2; read -r idx
    if [[ "$idx" =~ ^[0-9]+$ ]] && (( idx >= 1 && idx <= ${#arr[@]} )); then
        echo "${arr[$((idx-1))]}"; return 0
    fi
    return 1
}

SERVICE_OWNS_DB=1   # 这份库是不是正在跑的主控在用的(--db 指到别处时不去停服务)
if [[ "$DB_DRIVER" == "sqlite" ]]; then
    if [[ -n "$DB_PATH" ]]; then
        SERVICE_OWNS_DB=0
    else
        if [[ -n "$SQLITE_CONF_PATH" ]]; then
            DB_PATH=$(host_path "$SQLITE_CONF_PATH" || true)
        else
            DB_PATH="$DATA_DIR/mmwx.db"
            # 与主控一致:data/mmwx.db 不存在而上一级有老库时用老库
            if [[ ! -f "$DB_PATH" && -f "$(dirname "$DATA_DIR")/mmwx.db" ]]; then
                DB_PATH="$(dirname "$DATA_DIR")/mmwx.db"
            fi
        fi
        if [[ -z "$DB_PATH" || ! -f "$DB_PATH" ]] && [[ "$DEPLOY" == "none" ]]; then
            DB_PATH=$(find_db_via_process 2>/dev/null || find_db_via_scan 2>/dev/null || true)
        fi
    fi
    if [[ -n "$DB_PATH" && -f "$DB_PATH" && "$SERVICE_OWNS_DB" == 0 && "$DEPLOY" != "none" ]]; then
        # --db 指的恰好就是服务在用的那份 → 仍需停服务
        svc_db="$DATA_DIR/mmwx.db"; [[ -n "$SQLITE_CONF_PATH" ]] && svc_db=$(host_path "$SQLITE_CONF_PATH" || echo "")
        if [[ -n "$svc_db" && -f "$svc_db" && "$(readlink -f "$DB_PATH")" == "$(readlink -f "$svc_db")" ]]; then
            SERVICE_OWNS_DB=1
        fi
    fi
    if [[ -z "$DB_PATH" || ! -f "$DB_PATH" ]]; then
        err "找不到 SQLite 数据库(${DB_PATH:-未探测到})。可手动指定:bash $0 --db /path/to/mmwx.db"
        exit 1
    fi
    ok "数据库: SQLite ${BOLD}$DB_PATH${NC}"
    if ! ensure_pkg sqlite3 sqlite3; then exit 1; fi
else
    if [[ -z "$PG_HOST" || -z "$PG_DB" || -z "$PG_USER" ]]; then
        err "PostgreSQL 配置不完整(host/database/user),来源: ${DB_SOURCE:-无}"
        exit 1
    fi
    ok "数据库: PostgreSQL ${BOLD}$PG_USER@$PG_HOST:$PG_PORT/$PG_DB${NC}(配置来自 ${DB_SOURCE})"
fi

#─── 4b. PostgreSQL:选执行方式 ────────────────────────────
# 优先进 postgres 容器执行 psql(compose 部署的宿主机通常没装客户端);
# 找不到对应容器才用宿主机 psql,缺了就装客户端包。
PG_CONTAINER=""
find_pg_container() {
    command -v docker &>/dev/null || return 1
    local rows
    rows=$(docker ps --format '{{.ID}}|{{.Names}}|{{.Image}}|{{.Label "com.docker.compose.service"}}|{{.Ports}}' 2>/dev/null |
        awk -F'|' 'tolower($3) ~ /postgres/' || true)
    [[ -z "$rows" ]] && return 1
    case "$PG_HOST" in
        127.0.0.1|localhost|::1|"[::1]")
            # 本机地址:认 compose 的 miaomiaowux-postgres,或把 PG_PORT 发布到宿主机的那个容器
            echo "$rows" | awk -F'|' -v port="$PG_PORT" '
                $2 == "miaomiaowux-postgres" { print $1; exit }
                index($5, ":" port "->") && !p { p = $1 }
                END { if (p) print p }' | head -1
            ;;
        *)
            # compose 内网里写的是服务名 / 容器名
            echo "$rows" | awk -F'|' -v h="$PG_HOST" '$2 == h || $4 == h { print $1; exit }'
            ;;
    esac
}

if [[ "$DB_DRIVER" == "postgres" ]]; then
    PG_CONTAINER=$(find_pg_container || true)
    if [[ -n "$PG_CONTAINER" ]]; then
        info "通过容器 $(docker inspect -f '{{.Name}}' "$PG_CONTAINER" | sed 's#^/##') 执行 psql"
    else
        case "$OS" in
            debian|ubuntu|linuxmint|raspbian|alpine) ensure_pkg psql postgresql-client || exit 1 ;;
            *) ensure_pkg psql postgresql || exit 1 ;;
        esac
    fi
fi

# pg_sql [psql 参数...] < SQL:容器内走本地 socket(官方镜像 local 连接免密),宿主机走 TCP + 密码。
pg_sql() {
    if [[ -n "$PG_CONTAINER" ]]; then
        docker exec -i -e PGPASSWORD="$PG_PASS" "$PG_CONTAINER" \
            psql -X -q -At -v ON_ERROR_STOP=1 -U "$PG_USER" -d "$PG_DB" "$@"
    else
        PGPASSWORD="$PG_PASS" PGSSLMODE="$PG_SSL" PGCONNECT_TIMEOUT=10 \
            psql -X -q -At -v ON_ERROR_STOP=1 -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" "$@"
    fi
}

# sql_quote:SQLite 字面量转义(单引号加倍)
sql_quote() { printf "%s" "${1//\'/\'\'}"; }

#─── 5. bcrypt 生成器 ─────────────────────────────────────
HASHER=""
detect_hasher() {
    if command -v htpasswd &>/dev/null; then HASHER="htpasswd"; return 0; fi
    if command -v python3 &>/dev/null && python3 -c 'import bcrypt' 2>/dev/null; then
        HASHER="python"; return 0
    fi
    return 1
}
if ! detect_hasher; then
    case "$OS" in
        debian|ubuntu|linuxmint|raspbian|alpine) ensure_pkg htpasswd apache2-utils || true ;;
        rhel|centos|rocky|almalinux|fedora|ol|amzn) ensure_pkg htpasswd httpd-tools || true ;;
        arch|manjaro) ensure_pkg htpasswd apache || true ;;
        *) ;;
    esac
    if ! detect_hasher && command -v python3 &>/dev/null; then
        info "尝试用 pip 安装 python bcrypt..."
        python3 -m pip install --quiet bcrypt 2>/dev/null || \
            (ensure_pkg pip3 python3-pip && python3 -m pip install --quiet bcrypt) || true
        detect_hasher || true
    fi
fi
if [[ -z "$HASHER" ]]; then
    err "无法准备 bcrypt 生成工具。请手动安装 apache2-utils(htpasswd)或 python3-bcrypt"
    exit 3
fi
ok "bcrypt 工具: $HASHER"

#─── 6. 列出 admin 用户 ────────────────────────────────────
list_admins() {
    local q="SELECT username FROM users WHERE role='admin' AND is_active=1 ORDER BY username;"
    if [[ "$DB_DRIVER" == "postgres" ]]; then
        echo "$q" | pg_sql
    else
        sqlite3 "$DB_PATH" "$q"
    fi
}
if ! ADMIN_LIST=$(list_admins 2>&1); then
    err "读取用户表失败: $ADMIN_LIST"
    exit 2
fi
mapfile -t ADMINS < <(printf '%s\n' "$ADMIN_LIST" | sed '/^$/d')
if [[ ${#ADMINS[@]} -eq 0 ]]; then
    err "未找到任何 active admin 用户。是不是动错了库?"
    exit 2
fi

if [[ -n "$TARGET" ]]; then
    printf '%s\n' "${ADMINS[@]}" | grep -qxF -- "$TARGET" || { err "管理员 $TARGET 不存在或未启用"; exit 2; }
    info "目标管理员: ${BOLD}$TARGET${NC}"
elif [[ ${#ADMINS[@]} -eq 1 ]]; then
    TARGET="${ADMINS[0]}"
    info "唯一管理员: ${BOLD}$TARGET${NC}"
    printf "确认重置此用户的密码 [y/N]: " >&2; read -r confirm
    [[ "$confirm" =~ ^[Yy]$ ]] || { warn "已取消"; exit 5; }
else
    echo >&2
    echo -e "${BOLD}发现 ${#ADMINS[@]} 个管理员账号:${NC}" >&2
    for i in "${!ADMINS[@]}"; do
        printf "  ${BOLD}[%d]${NC} %s\n" $((i+1)) "${ADMINS[$i]}" >&2
    done
    echo >&2
    while [[ -z "$TARGET" ]]; do
        printf "选择要重置的管理员编号 [1-%d]: " "${#ADMINS[@]}" >&2; read -r idx
        if [[ "$idx" =~ ^[0-9]+$ ]] && (( idx >= 1 && idx <= ${#ADMINS[@]} )); then
            TARGET="${ADMINS[$((idx-1))]}"
        else
            warn "输入无效"
        fi
    done
    info "已选择: ${BOLD}$TARGET${NC}"
fi

#─── 7. 输入新密码(隐藏,两次确认) ──────────────────────
# 提示一律输出到 stderr,只把最终密码 echo 到 stdout —— 否则 $(prompt_password) 会把提示一起捕获。
prompt_password() {
    local pw1 pw2
    while true; do
        printf "请输入新密码(至少 8 位,不显示): " >&2; read -rs pw1; echo >&2
        if (( ${#pw1} < 8 )); then warn "密码至少 8 位"; continue; fi
        printf "再次输入新密码: " >&2; read -rs pw2; echo >&2
        if [[ "$pw1" != "$pw2" ]]; then warn "两次输入不一致,重来"; continue; fi
        printf '%s' "$pw1"; return 0
    done
}
NEW_PASS=$(prompt_password)

hash_password() {
    local plain="$1"
    case "$HASHER" in
        htpasswd)
            # htpasswd 输出 ":$2y$10$...",改成 $2a$ 兼容 golang.org/x/crypto/bcrypt
            htpasswd -bnBC 10 '' "$plain" 2>/dev/null | tr -d ':\n' | sed 's/^\$2y\$/$2a$/'
            ;;
        python)
            python3 -c '
import bcrypt,sys
print(bcrypt.hashpw(sys.argv[1].encode(), bcrypt.gensalt(rounds=10)).decode())
' "$plain"
            ;;
    esac
}
HASH=$(hash_password "$NEW_PASS")
unset NEW_PASS
if [[ -z "$HASH" || ( "${HASH:0:4}" != "\$2a\$" && "${HASH:0:4}" != "\$2b\$" ) ]]; then
    err "生成 bcrypt hash 失败"
    exit 3
fi
ok "已生成 bcrypt hash"

#─── 8. 服务控制 ──────────────────────────────────────────
stop_service() {
    case "$DEPLOY" in
        systemd)
            if systemctl is-active --quiet "$SERVICE_NAME"; then
                info "停止 systemd $SERVICE_NAME 服务..."; systemctl stop "$SERVICE_NAME"; WAS_RUNNING=1
            fi ;;
        docker)
            if (( CID_RUNNING == 1 )); then
                info "停止容器 $CID..."; docker stop "$CID" >/dev/null; WAS_RUNNING=1
            fi ;;
    esac
}
start_service() {
    (( WAS_RUNNING == 1 )) || { info "主控之前未运行,无需启动"; return 0; }
    case "$DEPLOY" in
        systemd) systemctl start "$SERVICE_NAME" && ok "$SERVICE_NAME 服务已启动" || warn "systemctl start 失败,请手动启动" ;;
        docker)  docker start "$CID" >/dev/null && ok "容器已启动" || warn "docker start 失败,请手动启动" ;;
    esac
}
restart_service() {
    case "$DEPLOY" in
        systemd)
            systemctl is-active --quiet "$SERVICE_NAME" || return 0
            systemctl restart "$SERVICE_NAME" && ok "$SERVICE_NAME 服务已重启" || warn "重启失败,请手动重启" ;;
        docker)
            (( CID_RUNNING == 1 )) || return 0
            docker restart "$CID" >/dev/null && ok "容器已重启" || warn "重启失败,请手动重启" ;;
    esac
}
WAS_RUNNING=0

#─── 9. 写库 ──────────────────────────────────────────────
if [[ "$DB_DRIVER" == "postgres" ]]; then
    # PG 不存在文件锁,不必停服务。先把原值导成一条可直接执行的还原语句。
    BACKUP_DIR="$DATA_DIR"; [[ -d "$BACKUP_DIR" && -w "$BACKUP_DIR" ]] || BACKUP_DIR="/root"
    [[ -d "$BACKUP_DIR" && -w "$BACKUP_DIR" ]] || BACKUP_DIR="/tmp"
    BACKUP="$BACKUP_DIR/admin-password-rollback-$(date +%Y%m%d%H%M%S).sql"
    if ! pg_sql -v u="$TARGET" > "$BACKUP" <<'SQL'
SELECT format('UPDATE users SET password_hash = %L, totp_enabled = %s, totp_secret = %L WHERE username = %L;',
              password_hash, COALESCE(totp_enabled, 0), COALESCE(totp_secret, ''), username)
FROM users WHERE username = :'u' AND role = 'admin';
SQL
    then
        err "备份原密码失败,未做任何修改"; rm -f "$BACKUP"; exit 4
    fi
    chmod 600 "$BACKUP"
    ok "已备份原密码(还原用 SQL): $BACKUP"

    if ! UPDATED=$(pg_sql -v u="$TARGET" -v h="$HASH" <<'SQL'
UPDATE users
SET password_hash = :'h', totp_enabled = 0, totp_secret = '', updated_at = CURRENT_TIMESTAMP
WHERE username = :'u' AND role = 'admin'
RETURNING username;
SQL
    ) || [[ -z "$UPDATED" ]]; then
        err "UPDATE 失败,数据库未改动"
        exit 4
    fi
    ok "数据库已更新"
    # 登录防爆破的锁定在主控内存里,重启一次顺带清掉
    if (( RESTART == 1 )); then restart_service; else info "已跳过重启(--no-restart)"; fi
else
    # SQLite:先停服务再写,避免 database is locked;WAL 在主控正常退出时已回写。
    if (( SERVICE_OWNS_DB == 1 )); then stop_service; sleep 1; fi
    BACKUP="${DB_PATH}.bak-$(date +%Y%m%d%H%M%S)"
    if ! cp -a "$DB_PATH" "$BACKUP"; then err "备份失败"; start_service; exit 4; fi
    for ext in -wal -shm; do [[ -f "$DB_PATH$ext" ]] && cp -a "$DB_PATH$ext" "$BACKUP$ext"; done
    ok "已备份: $BACKUP"

    TQ=$(sql_quote "$TARGET")
    if ! UPDATED=$(sqlite3 "$DB_PATH" <<SQL
UPDATE users
SET password_hash = '$HASH', totp_enabled = 0, totp_secret = '', updated_at = CURRENT_TIMESTAMP
WHERE username = '$TQ' AND role = 'admin';
SELECT changes();
SQL
    ) || [[ "$UPDATED" != "1" ]]; then
        err "UPDATE 失败,回滚备份并恢复服务"
        cp -af "$BACKUP" "$DB_PATH"
        start_service
        exit 4
    fi
    ok "数据库已更新"
    if (( RESTART == 1 )); then
        start_service
    else
        (( WAS_RUNNING == 1 )) && info "已跳过启动(--no-restart);记得手动启动主控才能登录"
    fi
fi

#─── 10. 完成 ───────────────────────────────────────────
echo
echo -e "${GREEN}${BOLD}✔ 密码已更新${NC}(两步验证已同时关闭)"
echo "  用户名: $TARGET"
echo -e "  新密码: ${BOLD}(刚才你输入的那个)${NC}"
echo "  备份  : $BACKUP"
echo
echo "下一步:打开主控登录页,用新密码登录。"
echo "建议:登录后在「系统设置 → 修改密码」再手动设一次,并重新开启两步验证、新建第二个 admin 账号作为备份。"
