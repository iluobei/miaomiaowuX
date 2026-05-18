
# 妙妙屋X - Xray 服务器管理与订阅拼车系统

<div align="center">
  <img height="200px" src="https://raw.githubusercontent.com/iluobei/miaomiaowuX/refs/heads/main/miaomiaowux-frontend/public/images/logo.webp" />
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

<details>
<summary>更新日志</summary>

### v0.0.8 (2026-05-18)
- 🛠️ fix:交换密钥失败导致session断开
- 🛠️ fix:服务器卡片界面显示问题
- 🛠️ fix:用户管理绑定套餐看不见套餐
- 🛠️ fix:节点管理ip域名恢复错误
### v0.0.7 (2026-05-18)
- 🌈 增加与agent交互的错误提示
- 🌈 增加主控与agent交互协议展示
- 🛠️ fix:优化内嵌xray菜单展示
- 🛠️ fix:优化许可证展示
- 🛠️ fix:优化顶部菜单展示
- 🛠️ fix:添加服务器窗口异常撑大
### v0.0.6 (2026-05-18)
- 🛠️ fix:docker镜像打包系统版本不对
- 🛠️ fix:reality节点创建多了出站
### v0.0.5-beta (2026-05-18)
- 🛠️ fix:agent自动上报IPv4优先
### v0.0.5 (2026-05-18)
- 🛠️ fix:主控开启小黄云获取agent IP错误
### v0.0.4 (2026-05-17)
- 🌈 PRO功能展示优化
- 🌈 优化发布脚本
- 🌈 增加妙妙屋菜单
- 🌈 妙妙屋功能增加开关控制
- 🛠️ fix:同步妙妙屋修改
- 🛠️ fix:证书保存目录错误写死了/etc
### v0.0.4-beta (2026-05-17)
- 🛠️ fix:cloudflare证书不再本地验证dns
- 🛠️ fix:自动限速无法恢复
- 🌈 增加自动限速与解除限速
- 🛠️ fix:主控与偷自己逻辑优化
- 🌈 增加主控与agent交互加密
- 🌈 增加证书申请日志显示
- 🛠️ fix:修复大量bug
- 🌈 同步mmw功能
- 🌈 支持内联xray与外置xray切换
### v0.0.3-beta (2026-05-14)
- 🌈 支持套餐限速与用户限速
- 🌈 支持套餐限速与用户限速
- 🌈 同步mmw功能
- 🌈 同步mmw功能
### v0.0.2 (2026-05-13)
- 🛠️ fix:移植外部订阅功能
- 🛠️ fix:topbar 按钮阴影消失
- 🌈 支持i18n
- 🌈 支持扁平主题
- 🌈 优化发布流程
- 🌈 增加2fa
- 🌈 增加通知
- 🌈 允许用户自行添加出站
</details>

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=iluobei/miaomiaowuX&type=date&legend=top-left)](https://www.star-history.com/#iluobei/miaomiaowuX&type=date&legend=top-left)

## 许可证

MIT License

## 联系方式

- 问题反馈：[GitHub Issues](https://github.com/iluobei/miaomiaowuX/issues)
- 功能建议：[GitHub Discussions](https://github.com/iluobei/miaomiaowuX/discussions)
