#!/bin/bash

# Nginx 卸载脚本
# 用于卸载通过 install-nginx.sh 安装的 Nginx
# 适用于 Debian/Ubuntu 系统
#
# 使用方法:
#   1. 普通用户卸载（推荐）: bash uninstall_nginx.sh
#   2. 自定义安装路径: NGINX_ROOT_PATH=/opt/nginx bash uninstall_nginx.sh
#   3. Root用户卸载: sudo bash uninstall_nginx.sh
#   4. 非交互式卸载（跳过确认）: bash uninstall_nginx.sh -y
#
# 默认安装路径: /usr/local/nginx

set -e  # 遇到错误立即退出

# 解析命令行参数
AUTO_CONFIRM=false
DELETE_LOGS=true

while getopts "y" opt; do
    case $opt in
        y)
            AUTO_CONFIRM=true
            ;;
        *)
            ;;
    esac
done

# 配置变量
NGINX_ROOT_PATH="${NGINX_ROOT_PATH:-/usr/local/nginx}"  # 默认路径，可通过环境变量覆盖
CURRENT_USER=$(whoami)

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

# 确认卸载
confirm_uninstall() {
    echo ""
    print_warning "警告：此操作将卸载 Nginx 并删除以下内容："
    echo -e "  - Nginx 安装目录: ${YELLOW}${NGINX_ROOT_PATH}${NC}"
    echo -e "  - Nginx 缓存目录: ${YELLOW}/var/cache/nginx${NC}"
    echo -e "  - Nginx 日志目录: ${YELLOW}/var/log/nginx${NC}"
    echo -e "  - Systemd 服务文件: ${YELLOW}/usr/lib/systemd/system/nginx.service${NC}"
    echo ""

    if [ "$AUTO_CONFIRM" = true ]; then
        print_info "非交互式模式，自动确认卸载"
        return 0
    fi

    read -p "确定要继续吗？(y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_info "已取消卸载"
        exit 0
    fi
}

# 停止并禁用 systemd 服务
stop_nginx_service() {
    print_info "步骤 1/6: 停止并禁用 Nginx 服务..."

    if systemctl is-active --quiet nginx 2>/dev/null; then
        print_info "正在停止 Nginx 服务..."
        $USE_SUDO systemctl stop nginx
    else
        print_info "Nginx 服务未运行"
    fi

    if systemctl is-enabled --quiet nginx 2>/dev/null; then
        print_info "正在禁用 Nginx 开机自启..."
        $USE_SUDO systemctl disable nginx
    fi

    print_info "服务已停止并禁用"
}

# 删除 systemd 服务文件
remove_systemd_service() {
    print_info "步骤 2/6: 删除 systemd 服务文件..."

    if [ -f /usr/lib/systemd/system/nginx.service ]; then
        $USE_SUDO rm -f /usr/lib/systemd/system/nginx.service
        $USE_SUDO systemctl daemon-reload
        print_info "systemd 服务文件已删除"
    else
        print_info "systemd 服务文件不存在，跳过"
    fi
}

# 删除 Nginx 安装目录
remove_nginx_installation() {
    print_info "步骤 3/6: 删除 Nginx 安装目录..."

    if [ -d "${NGINX_ROOT_PATH}" ]; then
        $USE_SUDO rm -rf "${NGINX_ROOT_PATH}"
        print_info "Nginx 安装目录已删除: ${NGINX_ROOT_PATH}"
    else
        print_warning "Nginx 安装目录不存在: ${NGINX_ROOT_PATH}"
    fi
}

# 删除缓存目录
remove_cache_directory() {
    print_info "步骤 4/6: 删除缓存目录..."

    if [ -d /var/cache/nginx ]; then
        $USE_SUDO rm -rf /var/cache/nginx
        print_info "缓存目录已删除: /var/cache/nginx"
    else
        print_info "缓存目录不存在，跳过"
    fi
}

# 删除日志目录
remove_log_directory() {
    print_info "步骤 5/6: 删除日志目录..."

    if [ "$AUTO_CONFIRM" = true ]; then
        # 非交互式模式，根据 DELETE_LOGS 变量决定
        if [ "$DELETE_LOGS" = true ]; then
            if [ -d /var/log/nginx ]; then
                $USE_SUDO rm -rf /var/log/nginx
                print_info "日志目录已删除: /var/log/nginx"
            else
                print_info "日志目录不存在，跳过"
            fi
        else
            print_info "已保留日志目录"
        fi
        return 0
    fi

    read -p "是否删除日志目录 /var/log/nginx？(y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        if [ -d /var/log/nginx ]; then
            $USE_SUDO rm -rf /var/log/nginx
            print_info "日志目录已删除: /var/log/nginx"
        else
            print_info "日志目录不存在，跳过"
        fi
    else
        print_info "已保留日志目录"
    fi
}

# 删除 PID 和 Lock 文件
remove_runtime_files() {
    print_info "步骤 6/6: 删除运行时文件..."

    if [ -f /var/run/nginx.pid ]; then
        $USE_SUDO rm -f /var/run/nginx.pid
        print_info "PID 文件已删除"
    fi

    if [ -f /var/run/nginx.lock ]; then
        $USE_SUDO rm -f /var/run/nginx.lock
        print_info "Lock 文件已删除"
    fi

    print_info "运行时文件已清理"
}

# 显示卸载完成信息
show_completion() {
    echo ""
    echo -e "${GREEN}================================================${NC}"
    echo -e "${GREEN}  Nginx 卸载完成！${NC}"
    echo -e "${GREEN}================================================${NC}"
    echo ""
    print_info "Nginx 已从系统中完全移除"
    echo ""
    print_warning "注意：编译依赖包未被删除"
    echo -e "如需删除编译依赖，请手动运行："
    echo -e "${YELLOW}sudo apt remove build-essential libpcre3 libpcre3-dev zlib1g-dev openssl libssl-dev${NC}"
    echo -e "${YELLOW}sudo apt autoremove${NC}"
    echo ""
    echo -e "${GREEN}================================================${NC}"
}

# 主函数
main() {
    print_info "开始卸载 Nginx..."
    echo ""

    check_permission
    confirm_uninstall

    echo ""
    print_info "开始卸载流程..."
    echo ""

    stop_nginx_service
    remove_systemd_service
    remove_nginx_installation
    remove_cache_directory
    remove_log_directory
    remove_runtime_files

    show_completion
}

# 运行主函数
main
