#!/bin/bash
# 妙妙屋 - 一键安装命令（简化版）

set -e

VERSION="v0.5.5-beta.12"
GITHUB_REPO="Jimleerx/miaomiaowu"
VERSION_FILE=".version"
PORT_FILE=".port"

# 检测系统架构
ARCH=$(uname -m)
case "$ARCH" in
    x86_64|amd64)
        BINARY_NAME="mmw-linux-amd64"
        ;;
    aarch64|arm64)
        BINARY_NAME="mmw-linux-arm64"
        ;;
    *)
        echo "❌ 不支持的架构: $ARCH"
        echo "支持的架构: x86_64 (amd64), aarch64 (arm64)"
        exit 1
        ;;
esac

DOWNLOAD_URL="https://github.com/${GITHUB_REPO}/releases/download/${VERSION}/${BINARY_NAME}"

# ask_port 问端口。优先走 /dev/tty,这样 `curl … | bash` 也能问 —— 那种写法下 stdin 是
# 管道、[ -t 0 ] 为假,但键盘其实还接着,以前一律闷头用默认值,用户没有机会改端口。
#
# 问不到就用默认值继续,绝不中断。收不到输入只有两种情况:
#   1) 真的没有终端(CI / 纯管道):/dev/tty 打不开;
#   2) `curl … | sudo bash`:sudo 自 1.9.14 起默认 use_pty(Debian 13、Ubuntu 24.04
#      都开着),脚本被关进它自建的 pty,/dev/tty 可读、提示也打得出来,但 sudo 自己的
#      stdin 已被管道占住,不会去读键盘,按键永远进不来。判据是「stdin 是管道」+
#      「在 sudo 下」,实测四种调用方式只有这一种组合收不到按键。
#
# 与 install.sh 的 read_choice 不同,这里问不到不 exit:那边要选本机/Docker、
# SQLite/PostgreSQL,选错后果完全不同,问不到就该停;这里只是个有合理默认的端口,
# 为它中断一次安装不值得,保持原来「用默认值继续」的行为。
# outer_tty 在「管道 + sudo」下找出真正连着键盘的那个终端,找不到回空串。
#
# sudo(use_pty)把脚本关进自建 pty,我们的 /dev/tty 指的就是它,里面永远不会有按键;
# 但 sudo 的输出照样转发到外层终端 —— 说明外层那个 tty 还在,只是脚本手上没有任何
# fd 指向它。沿进程链往上找第一个与自身不同的 tty 就是它:父进程那个 sudo 已经在
# 内层 pty 上了,再上一层才是外层终端。打开它直接读,按键就拿得到。
#
# 用 /proc 而不是 ps:ps 来自 procps,极简发行版未必装,而这段要在
# install_dependencies 之前就能用。只有 Linux 有 /proc,而原生安装本来就只支持
# Linux(见 check_architecture)。
#
# 读别人的终端在这里是安全的:管道里的 sudo 与外层 shell 同属一个前台进程组,
# 读它不会触发 SIGTTIN;外层 shell 此刻正等着这条管道结束,也不会来抢输入。
outer_tty() {
    local self up ppid dev
    self="$(readlink /proc/$$/fd/2 2>/dev/null)"   # fd2 在内层 pty 上,代表"自身这个终端"
    up="$PPID"
    for _ in 1 2 3 4 5 6 7 8; do
        [ -n "$up" ] && [ -d "/proc/$up" ] || return 0
        dev="$(readlink /proc/$up/fd/0 2>/dev/null)"
        case "$dev" in
            /dev/pts/*|/dev/tty[0-9]*|/dev/ttyS*)
                if [ "$dev" != "$self" ] && [ -c "$dev" ] && [ -r "$dev" ]; then
                    printf '%s' "$dev"
                    return 0
                fi
                ;;
        esac
        ppid="$(awk '/^PPid:/{print $2}' "/proc/$up/status" 2>/dev/null)"
        [ "$ppid" = "$up" ] && return 0
        up="$ppid"
    done
    return 0
}

# 这个脚本自己的分发地址。注意不能用 GITHUB_REPO 拼 —— 那个指的是二进制所在的仓
# (Jimleerx/miaomiaowu),脚本本身是从 iluobei/miaomiaowuX 发出去的。
SCRIPT_URL="https://raw.githubusercontent.com/iluobei/miaomiaowuX/main/quick-install.sh"
PORT_RESULT=""
ask_port() {
    local default="$1" value=""
    PORT_RESULT="$default"
    { : < /dev/tty; } 2>/dev/null || { echo "使用端口: $PORT_RESULT"; return 0; }
    local source_tty="/dev/tty"
    # curl … | sudo bash:/dev/tty 是 sudo 造的内层 pty,键盘在外层终端上,
    # 换成外层终端就能照常发问;真找不到就用默认值继续,不中断安装。
    if [ ! -t 0 ] && [ -n "${SUDO_USER:-}" ]; then
        source_tty="$(outer_tty)"
        if [ -z "$source_tty" ]; then
            echo "收不到键盘输入(sudo 的 use_pty),使用端口: $PORT_RESULT"
            echo "想自己指定端口:curl -fsSL $SCRIPT_URL | sudo env PORT=8080 bash"
            return 0
        fi
    fi
    # -t 是兜底:万一判据漏了某种环境,也不会像原来的 read 那样无限等下去。
    read -r -t 60 -p "请输入端口号(默认 $default,直接回车使用默认值): " value <"$source_tty" || {
        echo
        echo "未读到输入,使用端口: $PORT_RESULT"
        return 0
    }
    PORT_RESULT="${value:-$default}"
}

# 安装函数
install() {
    echo "正在下载并安装妙妙屋X $VERSION ($ARCH)..."

    # 下载
    wget -q --show-progress "$DOWNLOAD_URL" -O mmw

    # 赋予执行权限
    chmod +x mmw

    # 创建数据目录
    mkdir -p data

    # 保存版本信息
    echo "$VERSION" > "$VERSION_FILE"

    # 询问端口号（支持非交互式环境）
    echo ""
    ask_port "${PORT:-8080}"
    PORT="$PORT_RESULT"

    # 保存端口配置
    echo "$PORT" > "$PORT_FILE"

    # 设置环境变量并运行
    export PORT=$PORT
    nohup ./mmw > mmw.log 2>&1 &

    # 显示完成信息
    echo ""
    echo "✅ 安装完成！"
    echo ""
    echo "访问地址: http://localhost:$PORT"
    echo ""
    echo "更新版本:"
    echo "  curl -sL https://raw.githubusercontent.com/${GITHUB_REPO}/main/quick-install.sh | bash -s update"
    echo ""
    echo "卸载:"
    echo "  curl -sL https://raw.githubusercontent.com/${GITHUB_REPO}/main/quick-install.sh | bash -s uninstall"
    echo ""
}

# 更新函数
update() {
    echo "正在更新妙妙屋X ($ARCH)..."
    echo ""

    # 检查是否已安装
    if [ ! -f "mmw" ]; then
        echo "❌ 未检测到已安装的 mmw，请先运行安装"
        exit 1
    fi

    # 显示当前版本
    if [ -f "$VERSION_FILE" ]; then
        CURRENT_VERSION=$(cat "$VERSION_FILE")
        echo "当前版本: $CURRENT_VERSION"
    fi
    echo "目标版本: $VERSION ($ARCH)"
    echo ""

    # 查找并停止运行中的进程
    if pgrep -f "./mmw" > /dev/null; then
        echo "停止运行中的服务..."
        pkill -f "./mmw" || true
        sleep 2
    fi

    # 备份当前版本
    if [ -f "mmw" ]; then
        echo "备份当前版本..."
        cp mmw mmw.bak
    fi

    # 下载新版本
    echo "下载新版本..."
    wget -q --show-progress "$DOWNLOAD_URL" -O mmw

    # 赋予执行权限
    chmod +x mmw

    # 保存版本信息
    echo "$VERSION" > "$VERSION_FILE"

    # 询问端口号（支持非交互式环境）
    echo ""
    # 尝试读取之前保存的端口号
    SAVED_PORT=""
    if [ -f "$PORT_FILE" ]; then
        SAVED_PORT=$(cat "$PORT_FILE")
    fi

    ask_port "${PORT:-${SAVED_PORT:-8080}}"
    PORT="$PORT_RESULT"

    # 保存端口配置
    echo "$PORT" > "$PORT_FILE"

    # 设置环境变量并运行
    export PORT=$PORT
    nohup ./mmw > mmw.log 2>&1 &

    echo ""
    echo "✅ 更新完成！"
    echo ""
    echo "📦 版本: $VERSION"
    echo "🌐 访问地址: http://localhost:$PORT"
    echo ""
    echo "运行服务:"
    echo "  PORT=$PORT ./mmw"
    echo ""
    echo "后台运行:"
    echo "  PORT=$PORT nohup ./mmw > mmw.log 2>&1 &"
    echo ""
    echo "如遇问题可回滚到备份版本:"
    echo "  mv mmw.bak mmw"
    echo ""
}

# 卸载函数
uninstall() {
    echo "正在卸载妙妙屋X..."
    echo ""

    # 检查是否已安装
    if [ ! -f "mmw" ]; then
        echo "❌ 未检测到已安装的 mmw"
        exit 1
    fi

    # 显示当前版本
    if [ -f "$VERSION_FILE" ]; then
        CURRENT_VERSION=$(cat "$VERSION_FILE")
        echo "当前版本: $CURRENT_VERSION"
        echo ""
    fi

    # 查找并停止运行中的进程
    if pgrep -f "./mmw" > /dev/null; then
        echo "停止运行中的服务..."
        pkill -f "./mmw" || true
        sleep 2
        echo "✓ 服务已停止"
        echo ""
    fi

    # 询问是否保留配置和数据。
    #
    # 默认**保留** —— 数据删了不可恢复,而残留数据随时能再删。
    # 从前这里无条件 KEEP_DATA=false,把外部传入的环境变量冲掉了:
    # 下面非交互分支注释写着「检查环境变量」,但它读到的永远是刚被覆盖的 false,
    # 于是管道式卸载(curl ... | bash -s uninstall,管道 = 非交互)会静默删光数据。
    # install.sh 已经修过同一处,这个姊妹脚本当时漏了。
    KEEP_DATA="${MMWX_KEEP_DATA:-${KEEP_DATA:-true}}"
    if [ -t 0 ]; then
        # 交互式环境
        echo "是否保留配置和数据？"
        echo "  1) 完全删除（删除所有文件和数据）"
        echo "  2) 保留数据（保留 data 目录和订阅文件）"
        read -p "请选择 (1/2，默认 2): " CHOICE

        if [ "$CHOICE" = "1" ]; then
            KEEP_DATA=false
        else
            KEEP_DATA=true
        fi
    else
        # 非交互式:沿用上面从 MMWX_KEEP_DATA / KEEP_DATA 解析出的值(默认 true)。
        # 要在非交互下彻底删除,显式传 MMWX_KEEP_DATA=false。
        if [ "$KEEP_DATA" = "true" ]; then
            echo "保留数据模式"
        else
            echo "完全删除模式"
        fi
    fi
    echo ""

    # 删除主程序和版本文件
    echo "删除程序文件..."
    rm -f mmw mmw.bak "$VERSION_FILE" "$PORT_FILE" mmw.log
    echo "✓ 程序文件已删除"
    echo ""

    # 根据选择删除或保留数据
    if [ "$KEEP_DATA" = "false" ]; then
        echo "删除数据和配置..."
        rm -rf data/ subscribes/
        echo "✓ 数据和配置已删除"
        echo ""
        echo "✅ 卸载完成！所有文件已删除"
    else
        echo "保留数据目录: data/"
        echo "保留订阅目录: subscribes/"
        echo ""
        echo "✅ 卸载完成！配置和数据已保留"
        echo ""
        echo "如需重新安装:"
        echo "  curl -sL https://raw.githubusercontent.com/${GITHUB_REPO}/main/quick-install.sh | bash"
    fi
    echo ""
}

# 主函数
main() {
    if [ "$1" = "update" ]; then
        update
    elif [ "$1" = "uninstall" ]; then
        uninstall
    else
        install
    fi
}

# 运行主函数
main "$@"
