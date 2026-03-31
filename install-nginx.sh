#!/bin/bash

# Nginx 一键编译安装脚本
# 基于 buildnginx.mdx 文档
# 适用于 Debian/Ubuntu 系统
#
# 使用方法:
#   1. 普通用户安装（推荐）: bash install-nginx.sh
#   2. 自定义安装路径: NGINX_ROOT_PATH=/opt/nginx bash install-nginx.sh
#   3. Root用户安装: sudo bash install-nginx.sh
#   4. 启用 ACME 模块: ENABLE_ACME=1 bash install-nginx.sh
#
# 默认安装路径: /usr/local/nginx
#
# 包含模块:
#   - ngx-fancyindex: 美化目录列表
#   - nginx-acme (可选): 自动证书管理 (ACME/Let's Encrypt)

set -e  # 遇到错误立即退出

# 配置变量
FANCYINDEX_VERSION="0.5.2"
NGINX_ROOT_PATH="${NGINX_ROOT_PATH:-/usr/local/nginx}"  # 默认路径，可通过环境变量覆盖
ENABLE_ACME="1"  # 是否启用 nginx-acme 模块，默认不启用
CURRENT_USER=$(whoami)
CURRENT_GROUP=$(id -gn)

# 获取最新的nginx版本号
get_latest_nginx_version() {
    print_info "正在获取最新的 nginx 版本号..."
    # 从nginx官网获取最新稳定版本号
    NGINX_VERSION=$(curl -s https://nginx.org/en/download.html | grep -oP 'nginx-\K[0-9]+\.[0-9]+\.[0-9]+(?=\.tar\.gz">nginx)' | head -1)

    if [ -z "$NGINX_VERSION" ]; then
        print_warning "无法自动获取最新版本，使用默认版本 1.29.3"
        NGINX_VERSION="1.29.3"
    else
        print_info "检测到最新稳定版本: nginx-${NGINX_VERSION}"
    fi
}

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 打印带颜色的信息
print_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# 检查权限并提示
check_permission() {
    if [ "$EUID" -eq 0 ]; then
        print_warning "检测到使用 root 用户运行"
        USE_SUDO=""
    else
        print_info "检测到使用普通用户 ${CURRENT_USER} 运行"
        print_warning "部分操作可能需要 sudo 权限"
        USE_SUDO="sudo"
    fi
}

# 检查系统类型
check_system() {
    if [ -f /etc/debian_version ]; then
        print_info "检测到 Debian/Ubuntu 系统"
    else
        print_error "此脚本仅支持 Debian/Ubuntu 系统"
        exit 1
    fi
}

# 安装编译环境
install_dependencies() {
    print_info "步骤 1/8: 安装编译环境和依赖..."
    $USE_SUDO apt update
    $USE_SUDO apt install -y build-essential libpcre3 libpcre3-dev zlib1g-dev openssl libssl-dev wget curl

    # 如果启用 ACME 模块，安装额外依赖
    if [ "$ENABLE_ACME" = "1" ]; then
        print_info "安装 nginx-acme 模块所需的额外依赖..."
        $USE_SUDO apt install -y libclang-dev libpcre2-dev pkg-config git
    fi

    print_info "编译环境安装完成"
}

# 安装 Rust 工具链（nginx-acme 模块需要）
install_rust() {
    if [ "$ENABLE_ACME" != "1" ]; then
        return
    fi

    print_info "检查 Rust 工具链..."

    if command -v cargo &> /dev/null; then
        RUST_VERSION=$(rustc --version)
        print_info "已安装 Rust: $RUST_VERSION"
    else
        print_info "安装 Rust 工具链..."
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
        source "$HOME/.cargo/env"
        print_info "Rust 安装完成: $(rustc --version)"
    fi
}

# 下载并解压 nginx 源码
download_nginx() {
    print_info "步骤 2/8: 下载并解压 nginx-${NGINX_VERSION}..."
    cd /tmp
    wget -q --show-progress https://nginx.org/download/nginx-${NGINX_VERSION}.tar.gz
    tar -xf nginx-${NGINX_VERSION}.tar.gz
    print_info "nginx 源码解压完成"
}

# 下载并解压 fancyindex 模块
download_fancyindex() {
    print_info "步骤 3/8: 下载并解压 ngx-fancyindex 模块..."
    cd /tmp/nginx-${NGINX_VERSION}
    wget -q --show-progress https://github.com/aperezdc/ngx-fancyindex/releases/download/v${FANCYINDEX_VERSION}/ngx-fancyindex-${FANCYINDEX_VERSION}.tar.xz
    tar -xf ngx-fancyindex-${FANCYINDEX_VERSION}.tar.xz
    print_info "fancyindex 模块解压完成"
}

# 下载 nginx-acme 模块
download_nginx_acme() {
    if [ "$ENABLE_ACME" != "1" ]; then
        return
    fi

    print_info "下载 nginx-acme 模块..."
    cd /tmp/nginx-${NGINX_VERSION}

    # 克隆 nginx-acme 仓库
    if [ -d "nginx-acme" ]; then
        rm -rf nginx-acme
    fi
    git clone --depth 1 https://github.com/nginx/nginx-acme.git
    print_info "nginx-acme 模块下载完成"
}

# 创建必要目录
create_directories() {
    print_info "步骤 4/8: 创建必要目录..."
    $USE_SUDO mkdir -p /var/cache/nginx
    $USE_SUDO mkdir -p /var/log/nginx

    # 设置目录权限
    if [ -n "$USE_SUDO" ]; then
        $USE_SUDO chown -R ${CURRENT_USER}:${CURRENT_GROUP} /var/cache/nginx
        $USE_SUDO chown -R ${CURRENT_USER}:${CURRENT_GROUP} /var/log/nginx
    fi

    print_info "目录创建完成"
}

# 配置编译选项
configure_nginx() {
    print_info "步骤 5/8: 配置编译选项..."
    cd /tmp/nginx-${NGINX_VERSION}

    # 基础配置参数
    CONFIGURE_OPTS=(
        "--add-module=./ngx-fancyindex-${FANCYINDEX_VERSION}"
        "--prefix=${NGINX_ROOT_PATH}"
        "--user=${CURRENT_USER}"
        "--group=${CURRENT_GROUP}"
        "--sbin-path=${NGINX_ROOT_PATH}/sbin/nginx"
        "--conf-path=${NGINX_ROOT_PATH}/nginx.conf"
        "--error-log-path=/var/log/nginx/error.log"
        "--http-log-path=/var/log/nginx/access.log"
        "--pid-path=/var/run/nginx.pid"
        "--lock-path=/var/run/nginx.lock"
        "--http-client-body-temp-path=/var/cache/nginx/client_temp"
        "--http-proxy-temp-path=/var/cache/nginx/proxy_temp"
        "--http-fastcgi-temp-path=/var/cache/nginx/fastcgi_temp"
        "--http-uwsgi-temp-path=/var/cache/nginx/uwsgi_temp"
        "--http-scgi-temp-path=/var/cache/nginx/scgi_temp"
        "--with-compat"
        "--with-file-aio"
        "--with-threads"
        "--with-http_addition_module"
        "--with-http_auth_request_module"
        "--with-http_dav_module"
        "--with-http_flv_module"
        "--with-http_gunzip_module"
        "--with-http_gzip_static_module"
        "--with-http_mp4_module"
        "--with-http_random_index_module"
        "--with-http_realip_module"
        "--with-http_secure_link_module"
        "--with-http_slice_module"
        "--with-http_ssl_module"
        "--with-http_stub_status_module"
        "--with-http_sub_module"
        "--with-http_v2_module"
        "--with-mail"
        "--with-mail_ssl_module"
        "--with-stream"
        "--with-stream_realip_module"
        "--with-stream_ssl_module"
        "--with-stream_ssl_preread_module"
        "--with-http_v3_module"
    )

    # 如果启用 ACME 模块，添加动态模块支持
    if [ "$ENABLE_ACME" = "1" ]; then
        print_info "添加 nginx-acme 模块到编译配置..."
        CONFIGURE_OPTS+=("--add-dynamic-module=./nginx-acme")
    fi

    ./configure "${CONFIGURE_OPTS[@]}"

    print_info "配置完成"
}

# 编译安装
compile_nginx() {
    print_info "步骤 6/8: 开始编译和安装（这可能需要几分钟）..."
    cd /tmp/nginx-${NGINX_VERSION}
    make
    $USE_SUDO make install

    # 如果使用普通用户，设置安装目录权限
    if [ -n "$USE_SUDO" ]; then
        $USE_SUDO chown -R ${CURRENT_USER}:${CURRENT_GROUP} ${NGINX_ROOT_PATH}
    fi

    # 如果启用了 ACME 模块，复制动态模块文件
    if [ "$ENABLE_ACME" = "1" ]; then
        print_info "安装 nginx-acme 动态模块..."
        $USE_SUDO mkdir -p ${NGINX_ROOT_PATH}/modules
        if [ -f "objs/ngx_http_acme_module.so" ]; then
            $USE_SUDO cp objs/ngx_http_acme_module.so ${NGINX_ROOT_PATH}/modules/
            print_info "nginx-acme 模块已安装到 ${NGINX_ROOT_PATH}/modules/"
        else
            print_warning "未找到 ngx_http_acme_module.so，请检查编译日志"
        fi
    fi

    print_info "编译安装完成"
}

# 创建 systemd 服务
create_systemd_service() {
    print_info "步骤 7/8: 创建 systemd 服务..."

    $USE_SUDO tee /usr/lib/systemd/system/nginx.service > /dev/null <<EOF
[Unit]
Description=nginx - high performance web server
After=network.target

[Service]
Type=forking
ExecStart=${NGINX_ROOT_PATH}/sbin/nginx
ExecReload=${NGINX_ROOT_PATH}/sbin/nginx -s reload
ExecStop=${NGINX_ROOT_PATH}/sbin/nginx -s quit
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

    $USE_SUDO systemctl daemon-reload
    print_info "systemd 服务创建完成"
}

# 设置端口权限
setup_port_permission() {
    print_info "步骤 8/9: 设置端口绑定权限（允许使用 1024 以下端口）..."
    $USE_SUDO setcap cap_net_bind_service=+eip ${NGINX_ROOT_PATH}/sbin/nginx
    print_info "端口权限设置完成"
}

# 复制默认配置文件
copy_default_config() {
    print_info "步骤 9/9: 复制默认配置文件..."

    # 获取脚本所在目录
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    DEFAULT_CONFIG="${SCRIPT_DIR}/templates/nginx.conf"

    if [ -f "$DEFAULT_CONFIG" ]; then
        # 备份原配置文件
        if [ -f "${NGINX_ROOT_PATH}/nginx.conf" ]; then
            $USE_SUDO cp "${NGINX_ROOT_PATH}/nginx.conf" "${NGINX_ROOT_PATH}/nginx.conf.backup"
            print_info "原配置文件已备份为 nginx.conf.backup"
        fi

        # 复制默认配置
        $USE_SUDO cp "$DEFAULT_CONFIG" "${NGINX_ROOT_PATH}/nginx.conf"

        # 创建 servers 目录（用于包含额外的 server 配置）
        $USE_SUDO mkdir -p "${NGINX_ROOT_PATH}/servers"

        print_info "默认配置文件已复制到 ${NGINX_ROOT_PATH}/nginx.conf"
    else
        print_warning "未找到默认配置文件: $DEFAULT_CONFIG"
        print_info "将使用 Nginx 默认配置"
    fi
}

# 清理临时文件
cleanup() {
    print_info "清理临时文件..."
    rm -rf /tmp/nginx-${NGINX_VERSION}
    rm -f /tmp/nginx-${NGINX_VERSION}.tar.gz
    print_info "清理完成"
}

# 显示安装信息
show_info() {
    echo ""
    echo -e "${GREEN}================================================${NC}"
    echo -e "${GREEN}  Nginx 安装完成！${NC}"
    echo -e "${GREEN}================================================${NC}"
    echo ""
    echo -e "Nginx 版本: ${YELLOW}${NGINX_VERSION}${NC}"
    echo -e "安装路径: ${YELLOW}${NGINX_ROOT_PATH}${NC}"
    echo -e "配置文件: ${YELLOW}${NGINX_ROOT_PATH}/nginx.conf${NC}"
    echo -e "日志目录: ${YELLOW}/var/log/nginx/${NC}"
    echo ""
    echo -e "${GREEN}常用命令:${NC}"
    echo -e "  启动服务: ${YELLOW}systemctl start nginx${NC}"
    echo -e "  停止服务: ${YELLOW}systemctl stop nginx${NC}"
    echo -e "  重启服务: ${YELLOW}systemctl restart nginx${NC}"
    echo -e "  重载配置: ${YELLOW}systemctl reload nginx${NC}"
    echo -e "  查看状态: ${YELLOW}systemctl status nginx${NC}"
    echo -e "  开机自启: ${YELLOW}systemctl enable nginx${NC}"
    echo ""
    echo -e "  测试配置: ${YELLOW}${NGINX_ROOT_PATH}/sbin/nginx -t${NC}"
    echo -e "  查看版本: ${YELLOW}${NGINX_ROOT_PATH}/sbin/nginx -v${NC}"
    echo ""
    echo -e "${GREEN}================================================${NC}"
}

# 主函数
main() {
    print_info "开始安装 Nginx with fancyindex 模块..."
    echo ""

    check_permission
    check_system
    install_dependencies
    get_latest_nginx_version
    download_nginx
    download_fancyindex
    create_directories
    configure_nginx
    compile_nginx
    create_systemd_service
    setup_port_permission
    copy_default_config
    cleanup
    show_info

    if [ -n "$USE_SUDO" ]; then
        print_info "您可以运行 'sudo systemctl start nginx' 来启动 nginx"
    else
        print_info "您可以运行 'systemctl start nginx' 来启动 nginx"
    fi
}

# 运行主函数
main
