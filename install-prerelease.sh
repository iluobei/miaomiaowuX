#!/bin/bash
# 妙妙屋X预发布通道安装/切换脚本。
# 已安装主控：保留 /etc/mmwx 数据并原地升级；未安装：执行首次安装。

set -euo pipefail

INSTALL_SCRIPT_URL="${MMWX_INSTALL_SCRIPT_URL:-https://raw.githubusercontent.com/iluobei/miaomiaowuX/main/install.sh}"
TEMP_SCRIPT="$(mktemp /tmp/mmwx-prerelease.XXXXXX.sh)"
trap 'rm -f "$TEMP_SCRIPT"' EXIT

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
    echo "[ERROR] 请使用 root 权限运行此脚本" >&2
    echo "使用命令: curl -fsSL https://raw.githubusercontent.com/iluobei/miaomiaowuX/main/install-prerelease.sh | sudo bash" >&2
    exit 1
fi

echo "[INFO] 正在下载妙妙屋X安装器..."
curl -fL --retry 3 --connect-timeout 15 "$INSTALL_SCRIPT_URL" -o "$TEMP_SCRIPT"
chmod 700 "$TEMP_SCRIPT"

echo "[WARN] 即将切换到预发布通道。预发布版本用于提前测试，可能存在未发现的问题。"
MMWX_RELEASE_CHANNEL=prerelease bash "$TEMP_SCRIPT" prerelease
