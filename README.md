
# 妙妙屋X - Xray 服务器管理与订阅拼车系统

<div align="center">
  <img src="https://raw.githubusercontent.com/iluobei/miaomiaowuX/refs/heads/main/miaomiaowux-frontend/public/images/logo.webp" />
</div>

妙妙屋X 是 [妙妙屋](https://github.com/iluobei/miaomiaowu) 的增强版本，在原有 Clash 订阅管理基础上，新增 Xray 多服务器管理、远程节点部署、流量监控、证书管理等功能。支持主控/子服务器架构，通过 [mmw-agent](https://github.com/iluobei/mmw-agent) 实现远程服务器的统一管理。

## 功能特性

### Xray 服务器管理（新增）
- 🖥️ 多服务器管理 - 主控统一管理多台远程 Xray 服务器
- 🔌 远程连接 - WebSocket / HTTP / Pull 三种连接模式，自动回退
- 📊 实时流量 - 各服务器流量统计与实时速度监控
- 🔧 远程配置 - 在线管理远程服务器的 Xray/Nginx 配置
- 📡 入站/出站管理 - 可视化管理 Xray 入站、出站、路由规则
- 🔐 证书管理 - ACME 自动申请/续期 SSL 证书，支持多种 DNS 提供商
- 🚀 一键部署 - 远程服务器一键安装 Xray + Nginx + Agent
- 📦 套餐管理 - 用户套餐与流量限额管理
- 🔄 节点同步 - 入站变更自动同步到订阅节点

### 订阅管理（继承自妙妙屋）
- 📊 流量监控 - 支持 Xray 流量采集与外部订阅流量聚合统计
- 📈 历史流量 - 30 天流量使用趋势图表
- 📦 节点管理 - 导入个人节点或机场节点，支持批量操作
- 👥 用户管理 - 管理员/普通用户角色区分，订阅权限管理
- 🌓 主题切换 - 支持亮色/暗色模式

### 支持的客户端格式
Clash(Meta) / Surge / Loon / Quantumult X / Shadowrocket / SingBox / Stash / Surfboard / V2Ray / Egern

## 安装部署

### 方式 1：一键安装（推荐）

```bash
curl -sL https://raw.githubusercontent.com/iluobei/miaomiaowuX/main/install.sh | sudo bash
```

自动检测架构、下载最新版本、创建 systemd 服务。安装完成后访问 `http://服务器IP:12889` 进入初始化向导。

更新：
```bash
curl -sL https://raw.githubusercontent.com/iluobei/miaomiaowuX/main/install.sh | sudo bash -s update
```

卸载：
```bash
curl -sL https://raw.githubusercontent.com/iluobei/miaomiaowuX/main/install.sh | sudo bash -s uninstall
```

### 方式 2：Docker 部署

```bash
docker run -d \
  --user root \
  --name miaomiaowux \
  -p 12889:12889 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/subscribes:/app/subscribes \
  -v $(pwd)/rule_templates:/app/rule_templates \
  ghcr.io/iluobei/miaomiaowux:latest
```

#### Docker Compose

```yaml
version: '3.8'

services:
  miaomiaowux:
    image: ghcr.io/iluobei/miaomiaowux:latest
    container_name: miaomiaowux
    restart: unless-stopped
    user: root
    environment:
      - PORT=12889
      - LOG_LEVEL=info
    ports:
      - "12889:12889"
    volumes:
      - ./data:/app/data
      - ./subscribes:/app/subscribes
      - ./rule_templates:/app/rule_templates
```

### 方式 3：二进制部署

从 [Releases](https://github.com/iluobei/miaomiaowuX/releases) 下载对应平台的二进制文件：

```bash
# Linux
chmod +x mmwx-linux-amd64
./mmwx-linux-amd64

# 或指定配置文件
./mmwx-linux-amd64 -c config.yaml
```

默认端口 `12889`，访问 `http://服务器IP:12889` 进入初始化向导。

### 远程服务器部署

在主控面板添加远程服务器后，会生成一键安装命令，在远程服务器上执行即可自动安装 [mmw-agent](https://github.com/iluobei/mmw-agent) 并连接到主控。

## 架构

```
┌─────────────────────────────────────────┐
│           妙妙屋X (主控)                 │
│                                         │
│  订阅管理 / Xray管理 / 证书管理 / 用户管理 │
│  流量统计 / 套餐管理 / 节点同步           │
└────────────────┬────────────────────────┘
                 │ WebSocket / HTTP / Pull
    ┌────────────┼────────────┐
    ▼            ▼            ▼
┌────────┐  ┌────────┐  ┌────────┐
│ Agent1 │  │ Agent2 │  │ Agent3 │
│ (Xray) │  │ (Xray) │  │ (Xray) │
└────────┘  └────────┘  └────────┘
```

## 配置文件

```yaml
mode: master              # master（默认）或 remote
port: "12889"             # 监听端口
# 以下为 remote 模式配置
master_server: ""         # 主控地址
remote_token: ""          # 服务器令牌
connection_mode: "auto"   # auto | websocket | http | pull
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | `12889` |
| `LOG_LEVEL` | 日志级别 | `info` |
| `JWT_SECRET` | 会话令牌签名密钥，设置后 token 使用 HMAC 签名，更换密钥会使所有会话失效。未设置则使用纯随机 token | 未设置 |
| `ALLOWED_ORIGINS` | CORS 允许来源 | `*` |
| `MMWX_MODE` | 运行模式 | `master` |

## 技术栈

- 后端：Go 1.25 + net/http + SQLite (modernc.org/sqlite)
- 前端：React 19 + Vite 7 + TanStack Router + TailwindCSS 4 + shadcn/ui
- 单二进制部署，前端通过 Go embed 嵌入

## ⚠️ 免责声明

- 本程序仅供学习交流使用，请勿用于非法用途
- 使用本程序需遵守当地法律法规
- 作者不对使用者的任何行为承担责任

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=iluobei/miaomiaowuX&type=date&legend=top-left)](https://www.star-history.com/#iluobei/miaomiaowuX&type=date&legend=top-left)

## 许可证

MIT License

## 联系方式

- 问题反馈：[GitHub Issues](https://github.com/iluobei/miaomiaowuX/issues)
- 功能建议：[GitHub Discussions](https://github.com/iluobei/miaomiaowuX/discussions)
