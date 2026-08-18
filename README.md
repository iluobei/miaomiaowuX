
# 妙妙屋X - Xray 服务器管理与订阅拼车系统

<div align="center">
  <img height="200px" src="https://raw.githubusercontent.com/iluobei/miaomiaowuX/refs/heads/main/screenshots/mmwx_light.webp" />
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

脚本会依次让你选择：

1. **本机安装**或 **Docker Compose 安装**；
2. **SQLite** 或 **PostgreSQL 18**。

本机 + SQLite 不安装额外数据库；本机 + PostgreSQL 会安装 PostgreSQL 18、创建数据库和账号并写入 `/etc/mmwx/data/database.json`。Docker 使用 Compose 部署，选择 PostgreSQL 时会额外启动 `postgres:18-alpine` 并自动把连接信息交给主控。安装完成后访问 `http://服务器公网IP:12889`。

无人值守安装可设置 `MMWX_INSTALL_METHOD=native|docker` 和 `MMWX_DATABASE_DRIVER=sqlite|postgres`。

更新：
```bash
curl -sL https://raw.githubusercontent.com/iluobei/miaomiaowuX/main/install.sh | sudo bash -s update
```

切换到最新预发布版本（保留现有配置和数据库）：

```bash
curl -fsSL https://raw.githubusercontent.com/iluobei/miaomiaowuX/main/install-prerelease.sh | sudo bash
```

卸载：
```bash
curl -sL https://raw.githubusercontent.com/iluobei/miaomiaowuX/main/install.sh | sudo bash -s uninstall
```

### 方式 2：手动 Docker Compose 部署

> 默认使用 host 网络模式 — 便于 agent 反向连接、多端口场景,也避免后续新增端口又要改 compose。
>
> 镜像已内置 Nginx，无需 systemd。使用 host 网络后，主控可直接申请、部署证书并管理 HTTPS；请确保宿主机的 80/443 端口未被其他服务占用。

```bash
mkdir -p /opt/miaomiaowux && cd /opt/miaomiaowux
curl -O https://raw.githubusercontent.com/iluobei/miaomiaowuX/main/docker-compose.yml

# SQLite：只启动主控
docker compose up -d

# PostgreSQL 18：先在 .env 设置 POSTGRES_PASSWORD 及 MMWX_DATABASE_*，再启动 profile
docker compose --profile postgres up -d
```

推荐直接使用一键脚本生成 `.env`，避免数据库密码与连接参数不一致。持久化目录为 `data/`、`subscribes/`、`rule_templates/` 与 `postgres-data/`。

#### Docker 开启 HTTPS

1. 确认宿主机 80/443 端口未被占用，并使用上述 host 网络方式启动；
2. 在「证书管理」添加 DNS 提供商，申请与主控域名匹配的证书；
3. 将证书部署到主控。系统会生成反向代理配置，并直接启动或重载容器内的 Nginx。

也可以使用宿主机已有的 Nginx/Caddy 反代 `127.0.0.1:12889`。两种方式只选一种，避免争用 80/443。

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

## 探针 API

探针提供当前状态、WebSocket 实时推送和 24 小时历史序列接口。响应采用字段白名单，不包含服务器 ID、IP、Token、Agent 地址或 Xray 配置。

| 接口 | 说明 |
|------|------|
| `GET /api/public/probe-servers` | 服务器状态、系统指标、周期流量、延迟及回程信息 |
| `WS /api/public/probe-ws` | 每 5 秒推送与 `probe-servers` 相同的数据结构 |
| `GET /api/public/probe-series` | 查询 `1h`、`6h` 或 `24h` 延迟和系统指标历史 |

独立探针开启接口保护后，需要发送 `X-MMwx-Probe-Token` 请求头。字段单位、可选开关、历史查询参数及完整响应结构请参阅[探针 API 字段说明](https://miaomiaowux.com/docs/probe-api)。

<details>
<summary>展开查看完整字段速查</summary>

顶层字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `enabled` | boolean | 探针是否启用；关闭时仅保证包含此字段 |
| `title` / `logo` | string | 自定义标题及 Logo URL 或 `data:` URI |
| `appearance` | object | `theme`、`color_mode`、`revision` |
| `block_login` | boolean | 是否禁止访问原登录页 |
| `show_name` / `show_globe` | boolean | 名称与 3D 地球展示开关 |
| `license_badge` | object | 可选许可证 `name`、`display_name` |
| `servers` | array | 展示服务器列表 |

`servers[]` 字段：

| 字段 | 单位/类型 | 说明 |
|------|-----------|------|
| `name` / `online` | string / boolean | 服务器名称与在线状态 |
| `region` / `region_country` / `region_name` / `region_city` | string | 地区 Emoji、国家、完整地域与城市 |
| `provider_name` / `provider_url` / `telecom_paid_peer` | string / boolean | 服务商信息与 163 Paid Peer 标记 |
| `upload_speed` / `download_speed` | B/s | 当前上下行网速 |
| `traffic_used` / `traffic_limit` | byte | 按服务器统计模式计算的当前周期计费用量及限额 |
| `traffic_used_up` / `traffic_used_down` | byte | 当前周期实际上行、下行流量 |
| `traffic_used_total` | byte | 当前周期实际上下行合计 |
| `period_start` / `period_end` | `YYYY-MM-DD` | 当前计费周期起点（含）与下一重置日（不含） |
| `cumulative_up` / `cumulative_down` | byte | 系统网卡当前周期累计上下行 |
| `daily_traffic` | array | `{date, uplink, downlink, total}` 每日流量 |
| `cpu_pct` / `loadavg` | % / string | CPU 使用率与负载 |
| `mem_used` / `mem_total` | byte | 内存使用量及总量 |
| `disk_used` / `disk_total` | byte | 磁盘使用量及总量 |
| `uptime` | second | 系统在线时长 |
| `cpu_model` / `cpu_cores` / `cpu_threads` | string / integer | CPU 信息 |
| `os` / `kernel` / `arch` | string | 系统、内核与架构 |
| `ping` | array | `{key,label,isp,current_ms,loss_pct,buckets}`；`-1` 表示无数据或失败 |
| `expires_at` | `YYYY-MM-DD` | 到期日期 |
| `renewal_price` / `renewal_currency` / `renewal_cycle` | number / string | 原币价格、币种及月/季/半年/年周期 |
| `renewal_price_cny` | number | 按许可证汇率换算的人民币价格 |
| `return_routes` | array | `{carrier,region,route_type,tested_at}` 三网回程 |

历史接口参数：`server` 是 `servers` 数组下标；`metric` 为 `ping` 或 `system`；`range` 支持 `1h`、`6h`、`24h`；`target` 指定延迟目标；`all=1` 返回全部目标。响应包含 `success`、`bucket_sec`、`generated_at`、`series`，系统序列包含 CPU、内存、网速及累计上下行，每个点为 `{t, value}`。

关闭采集开关、Agent 不支持或暂时无数据时，可选字段会被省略，而不是固定返回 `0`。

</details>

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
| `MMWX_FORCE_PUBLIC_ACCESS` | 公网访问自救开关。因“关闭公网访问”配置导致无法进入面板时，设为 `1` 并重启；程序会恢复 `0.0.0.0` 监听并清除本地访问限制。确认恢复后请移除此变量 | 未设置 |
| `MMWX_WAL_CHECKPOINT_INTERVAL` | SQLite WAL 在线 PASSIVE checkpoint 巡检间隔；设为 `0` 可关闭额外巡检 | `1m` |
| `MMWX_WAL_CHECKPOINT_MIN_BYTES` | WAL 达到该大小后才执行在线 checkpoint，避免小 WAL 高频写回主库 | `16777216`（16 MiB） |

## 技术栈

- 后端：Go + net/http + SQLite / PostgreSQL 18
- 前端：React 19 + Vite 7 + TanStack Router + TailwindCSS 4 + shadcn/ui
- 单二进制部署，前端通过 Go embed 嵌入

## ⚠️ 免责声明

- 本程序仅供学习交流使用，请勿用于非法用途
- 使用本程序需遵守当地法律法规
- 作者不对使用者的任何行为承担责任

<details>
<summary>更新日志</summary>
### v0.4.8-beta.18 (2026-08-17)
- 🌈 新增订阅IP白名单与节点流量名称，修复到期提醒与升级校验
- 🛠️ fix: 令牌轮换未同步迁移授权槽位
- 🛠️ fix: 避免入站嗅探改写连接目标

### v0.4.8-beta.17 (2026-08-17)
- 🛠️ fix: 完善品牌图标、升级与入站配置
- 🛠️ fix: 明确服务器授权槽位失败原因
### v0.4.8-beta.16 (2026-08-17)
- 🛠️ fix: 完善 Agent Guard 安装与授权链路
- 🛠️ fix: 许可证激活相关问题
- 🛠️ fix: 探针流量校准
### v0.4.8-beta.15 (2026-08-16)
- 🛠️ fix: 连接数显示问题
- 🛠️ fix: tmp垃圾文件
- 🛠️ fix: 更换许可证导致的agent槽没有替换
- 🛠️ fix: 配置漂移误报
- 🛠️ fix: 授权轮换导致共享服务器掉线
- 🛠️ fix: nginx安装检测错误
### v0.4.8-beta.14 (2026-08-16)
- 🛠️ fix: nginx相关逻辑报错
- 🛠️ fix: 流量详情返回套餐周期
### v0.4.8-beta.13 (2026-08-16)
- 🛠️ fix: nginx相关逻辑报错
- 🛠️ fix: Agent 0.5.5 连接数为 0、租约竞态及 Xray 重启漏记
- 🛠️ fix: 租约无法替换
- 🛠️ fix: 缺少验签工具自动安装openssl
### v0.4.8-beta.12 (2026-08-15)
- 🛠️ fix: 安装启动失败
### v0.4.8-beta.11 (2026-08-15)
- 🛠️ fix: 更新agent概率启动失败
### v0.4.8-beta.10 (2026-08-15)
- 🛠️ fix: 冗余文件
### v0.4.8-beta.9 (2026-08-15)
- 🛠️ fix: 主控自更新失败
- 🛠️ fix: 网页升级主控失败
### v0.4.8-beta.8 (2026-08-15)
- 🛠️ fix: 滚动升级先升级一台测试
### v0.4.8-beta.7 (2026-08-15)
- 🛠️ fix: 外置xray权限问题
### v0.4.8-beta.6 (2026-08-15)
- 🛠️ fix: 主控和agent同机启动失败
- 🛠️ fix: docker新版启动失败
### v0.4.8-beta.5 (2026-08-15)
- 🛠️ fix: nat机和alpine agent启动失败
### v0.4.8-beta.4 (2026-08-15)
- v0.4.8-patch
### v0.4.8-beta.3 (2026-08-15)
- 🌈 feat: 管理员支持绑定套餐订阅
- 🔐 feat: 支持全量重置订阅凭据
- 🛠️ fix: 优化节点与套餐配置同步
- 🛠️ fix: 外部节点作为出站时的缓存同步问题
- 🛠️ fix: 中转组描述错误
- 🛠️ fix: 更新前重载服务配置
- 🧹 fix: 清理升级后的配套备份
- 🛡️ feat: 安装器接入签名 Guard
- 🛠️ fix: 临时回滚安装器 Guard 依赖
- 🌈 支持普通SS
- 🌈 支持用户多套餐
- 🛠️ 修复测试包校验清单生成
- 🧪 修正测试包校验清单路径
- 🧪 支持隔离许可证端到端测试包
- 🛠️ 修复跨架构测试包验签
- 🧪 增加签名测试包构建
- 🧪 覆盖Guard CDN签名回退
- 🌈 agent更新、安装优先走cf cdn
- 🌈 套餐支持拼车发布
- 🌈 增加premium-light主题
- 🌈 套餐支持分享到官方拼车页
### v0.4.8-beta.2 (2026-08-12)
- 🌈 修改套餐支持继承流量与到期时间
- 🛠️ fix: 反代ssl缺失sni配置
- 🌈 调整更新下载超时时间
- 🌈 支持点击整个节点出站tag修改、删除出站
- 🛠️ fix: 部分en环境下显示中文问题
- 🛠️ fix: 迁移后的sql兼容性报错
- 🛠️ fix: 服务器tokenurl转义问题
- 🛠️ fix: 许可证上报不再包含外部节点
- 🛠️ fix: 套餐与单节点流量显示约束
- 🛠️ fix: 迁移数据库期间误报离线
- 🛠️ fix: sqlite备份恢复失败
- 🌈 开启禁止公网方案的临时解决方案
- 🛠️ fix: 用户自己导入的节点获取订阅时丢失
- 🛠️ fix: docker一键安装脚本安装失败
### v0.4.8-beta.1 (2026-08-12)
- 🌈 探针优化
- 🛠️ fix: v3模板生成订阅自动绑定
- 🛠️ fix: tg每日上下行流量不一致
- 🛠️ fix: 套餐保存外部节点报错
- 🌈 修复妙妙屋X默认title优先显示
- 🌈 套餐增加默认重置日期
### v0.4.7 (2026-08-11)
- 🌈 更新release
- 🌈 Premium
- 🌈 支持套餐单独设置节点流量
- 🌈 支持各种问题引起的xray凭据错误修复
- 🌈 探针自定义主题名称
- 🌈 uri支持服务器筛选
- 🌈 探针API参数说明
- 🌈 偷自己的禁止开启reality防偷
- 🌈 支持配置自定义主题名称
- 🌈 reality支持防偷配置开关
- 🌈 支持外部订阅静默同步与中转组
- 🌈 DNS供应商支持表单配置
- 🌈 增加节点级别的连接数显示
- 🌈 更新一键安装脚本
- 🌈 套餐内节点支持排序
- 🌈 续费通知增加我已续费按钮
- 🌈 补全探针数据(cpu、os)
- 🌈 补全探针数据(日流量)
- 🌈 补全探针数据
- 🛠️ fix: 偶发前后端交互解密失败
- 🛠️ fix: 保存套餐节点报错
- 🛠️ fix: 编辑订阅错误自动修复
- 🛠️ fix: 修改节点导致节点名称被覆盖
- 🛠️ fix: 删除源节点的时候移除tunnel
- 🛠️ fix: 节点连接数显示错误
- 🛠️ fix: openrc 重启失败
- 🛠️ fix: 修改自定义连接后无效
- 🛠️ fix: tg通知[转义
- 🛠️ fix: 增加探针数据
- 🛠️ fix: 节点更新导致的子用户重置
- 🛠️ fix: tgbot与主控自定义外观统一
- 🛠️ fix: 套餐与用户部分失败时回滚
- 🛠️ fix: 探针的单独开关不起作用
- 🛠️ fix: 每日流量折线图按“流量统计服务器”配置过滤
- 🛠️ fix: 通知的每日增量流量问题
- 🛠️ fix: socks5 解析错误
- 🛠️ fix: 锁定的入口的服务器作为出站也使用锁定IP
- 🛠️ fix: 证书只允许主控申请
- 🛠️ fix: 迁移TG 时区问题自动修复
- 🛠️ fix: 部署证书增加超时时间
- 🛠️ fix: 每日流量没有使用日终快照
- 🛠️ fix: 绑定套餐意外获取到历史流量
- 🛠️ fix: 偶发修改套餐、用户导致子账户失效
- 🛠️ fix: mirror.gh-proxy.com失效
- 🛠️ fix: 服务器无法删除
- 🛠️ fix: pg_dump版本自适应
- 🛠️ fix: 禁止绑定第二个TG管理员
### v0.4.7-beta.7 (2026-08-10)
- 🌈 支持套餐单独设置节点流量
### v0.4.7-beta.6 (2026-08-10)
- 🛠️ fix: 偶发前后端交互解密失败
- 🛠️ fix: 保存套餐节点报错
- 🛠️ fix: 编辑订阅错误自动修复
- 🛠️ fix: 修改节点导致节点名称被覆盖
- 🛠️ fix: 删除源节点的时候移除tunnel
- 🛠️ fix: 节点连接数显示错误
- 🌈 支持套餐单独设置节点流量
### v0.4.7-beta.5 (2026-08-10)
- 🛠️ fix: openrc 重启失败
- 🌈 支持各种问题引起的xray凭据错误修复
- 🛠️ fix: 修改自定义连接后无效
- 🌈 探针自定义主题名称
- 🛠️ fix: tg通知[转义
- 🌈 uri支持服务器筛选
- 🛠️ fix: 增加探针数据
- 🛠️ fix: 节点更新导致的子用户重置
- 🌈 探针API参数说明
### v0.4.7-beta.4 (2026-08-09)
- 🌈 偷自己的禁止开启reality防偷
### v0.4.7-beta.3 (2026-08-09)
- 🌈 支持配置自定义主题名称
- 🌈 reality支持防偷配置开关
- 🛠️ fix: tgbot与主控自定义外观统一
- 🛠️ fix: 套餐与用户部分失败时回滚
- 🛠️ fix: 探针的单独开关不起作用
- 🛠️ fix: 每日流量折线图按“流量统计服务器”配置过滤
- 🛠️ fix: 通知的每日增量流量问题
- 🌈 支持外部订阅静默同步与中转组
- 🛠️ fix: socks5 解析错误
- 🛠️ fix: 锁定的入口的服务器作为出站也使用锁定IP
- 🛠️ fix: 证书只允许主控申请
- 🌈 DNS供应商支持表单配置
- 🌈 增加节点级别的连接数显示
- 🛠️ fix: 迁移TG 时区问题自动修复
- 🌈 更新一键安装脚本
- 🛠️ fix: 部署证书增加超时时间
- 🛠️ fix: 每日流量没有使用日终快照
- 🛠️ fix: 绑定套餐意外获取到历史流量
- 🌈 套餐内节点支持排序
### v0.4.7-beta.2 (2026-08-07)
- 🌈 续费通知增加我已续费按钮
### v0.4.7-beta.1 (2026-08-07)
- 🌈 补全探针数据(cpu、os)
- 🌈 补全探针数据(日流量)
- 🌈 补全探针数据
- 🛠️ fix: 偶发修改套餐、用户导致子账户失效
- 🛠️ fix: mirror.gh-proxy.com失效
- 🛠️ fix: mirror.gh-proxy.com失效
- 🛠️ fix: 服务器无法删除
- 🛠️ fix: pg_dump版本自适应
- 🛠️ fix: pg_dump版本自适应
- 🛠️ fix: 禁止绑定第二个TG管理员
### v0.4.6 (2026-08-05)
- 🛠️ fix: 备份恢复失败
- 🛠️ fix: 修改节点路由出站节点未同步
- 🛠️ fix: 内置外置探针独立开关
- 🛠️ fix: 普通用户能看到所有模板
- 🛠️ fix: pgsql数据库备份问题
- 🛠️ fix: 网站管理反代缺少ssl配置
- 🛠️ fix: pgsql测试连接失败
- 🛠️ fix: 绑定新套餐流量显示错误
- 🛠️ fix: 绑定新套餐流量显示错误
- 🛠️ fix: tunnel转发错误判断为外部节点
- 🛠️ fix: bot流量显示与面板不一致
- 🛠️ fix: 套餐内节点名称显示异常
- 🛠️ fix: 历史流量数据重新迁移补偿
- 🛠️ fix: 迁移数据库导致服务器流量异常重置
- 🛠️ fix: 确认续费sql写错了
### v0.4.5 (2026-08-04)
- 🌈 支持内置外置探针同时开启
- 🌈 回程任务只跑选择的探针服务器
- 🌈 切换主控域名时，关闭cf验证码
- 🌈 探针增加三网回程测试
- 🌈 孤儿子账户xray账户定时清理
- 🌈 支持快速续费与服务商地址跳转
- 🛠️ fix: 服务器安装命令支持alpine
- 🌈 修改节点重新上线
- 🛠️ fix: 端口范围添加节点时越界
- 🛠️ fix: ss tfo根据服务器情况开启
- 🛠️ fix: 服务器流量未重置
- 🛠️ fix: socks5按用户名区分出站
- 🌈 支持重置管理员凭据
- 🌈 支持重置管理员凭据
- 🛠️ fix: 模板代理组顺序错误
- 🌈 支持自定义路由给罪恶模板
- 🌈 支持更多探针数据
- 🌈 支持更多探针数据
- 🌈 增加预发布安装脚本
- 🌈 写扩散优化
- 🌈 备份支持pg数据库
- 🌈 支持postgresql数据库
- 🌈 优化用户禁用启用流程
- 🌈 支持从主控更新测速端
- 🌈 优化普通用户的miniapp续费
- 🌈 服务器视图流量支持日期筛选
- 🌈 增加prerelease版本
- 🌈 获取订阅通知增加流量与套餐
- 🌈 增加用户自主续费功能
- 🌈 支持再套餐为节点设置专用节点名
- 🛠️ fix: 自动填写备份主控地址
- 🛠️ fix: bot错误被后端吃掉了
- 🛠️ fix: 离线服务器删除失败
### v0.4.4-beta.3 (2026-08-03)
- 🌈 优化用户禁用启用流程
- 🌈 写扩散优化
- 🌈 备份支持pg数据库
- 🌈 支持postgresql数据库
- 🌈 支持从主控更新测速端
### v0.4.4-beta.2 (2026-08-03)
- 🌈 优化普通用户的miniapp续费
- 🌈 服务器视图流量支持日期筛选
### v0.4.4-beta.1 (2026-08-03)
- 🌈 增加prerelease版本
- 🌈 增加用户自主续费功能
- 🌈 支持再套餐为节点设置专用节点名
- 🌈 获取订阅通知增加流量与套餐
- 🛠️ fix: bot错误被后端吃掉了
- 🛠️ fix: 离线服务器删除失败
- 🛠️ fix: 自动填写备份主控地址
### v0.4.3 (2026-08-02)
- 🛠️ fix: windows system.call 问题
### v0.4.2 (2026-08-02)
- 🌈 TG相关功能增加超链接
- 🌈 主控与agent互联优化
- 🌈 增加主控https不可用时的自愈机制
- 🌈 增加备用主控url
- 🌈 增加探针延迟与丢包通知
- 🌈 增加每日流量增量推送
- 🌈 增加流量信息服务器选择
- 🌈 增加证书下载
- 🌈 增加迁移流程
- 🌈 支持docker内置nginx
- 🌈 支持独立探针
- 🌈 支持独立订阅域名配置
- 🌈 支持网站管理
- 🛠️ fix: 备份缺少自签证书
- 🛠️ fix: 套餐订阅名称移除.yaml后缀
- 🛠️ fix: 套餐订阅流量信息节点未生效
- 🛠️ fix: 服务器IP变更后的节点同步问题
### v0.4.1 (2026-07-31)
- 🌈 管理员miniapp增加服务器xray开关
- 🛠️ fix: 流量重置逻辑闭环
### v0.4.1 (2026-07-31)
- 🌈 增加批量关闭跳过证书验证按钮
- 🛠️ fix: surge snellv6 版本号转换错误
- 🛠️ fix: 修改服务器地址没有成功更新节点server
- 🛠️ fix: 偷自己部署失败没有重试
- 🛠️ fix: 更新主控域名时，重新下发到agent
- 🛠️ fix: 用户流量详情显示套餐周期内的
### v0.4.0 (2026-07-30)
- 🌈 套餐支持配置默认surge模板
- 🛠️ fix: 模板重复配置tiktok
- 🛠️ fix: 管理员小程序展示内容调整
- 🛠️ fix: 自定义代理组配置重复
### v0.3.9 (2026-07-30)
- 🌈 同步订阅显示流量节点功能
- 🌈 增加备份数据库与自动恢复
- 🌈 外部订阅导入支持选择节点
- 🌈 支持xray pcs参数
- 🌈 添加中转、隧道支持新增节点
- 🌈 添加禁止浏览器访问订阅开关
- 🌈 迁移tgbotapp 到主控
- 🛠️ fix: Hysteria2 托管证书续期不同步
- 🛠️ fix: vless+wss节点无法添加
- 🛠️ fix: 下载备份偶发文件乱码
- 🛠️ fix: 主控偷自己的配置问题
- 🛠️ fix: 从订阅生成模板丢失rule-providers配置
- 🛠️ fix: 删除服务器前先卸载agent
- 🛠️ fix: 删除重复打包的错误更新日志
- 🛠️ fix: 增加自定义代理组配置
- 🛠️ fix: 彻底修复写扩散的问题
- 🛠️ fix: 新的reality节点默认不跳过证书
- 🛠️ fix: 用户无法删除自己导入的订阅
- 🛠️ fix: 移除备份密码
- 🛠️ fix: 移除默认模板的中转、落地组
- 🛠️ fix: 自定义代理组兼容老版本
- 🛠️ fix: 证书同步节点证书缺少
### v0.3.8 (2026-07-28)
- 🌈 增加cdn更新配置
- 🌈优化mcp
- 🛠️ fix: mieru用户名错误，添加出站502
- 🛠️ fix: tgminiapp流量增加倍率
- 🛠️ fix: 偶发许可证失效无法自愈
- 🛠️ fix: 先屏蔽修改节点按钮
- 🛠️ fix: 分享服务器与证书加载bug
- 🛠️ fix: 小火箭订阅有效期兼容
- 🛠️ fix: 流量offset误报
- 🛠️ fix: 锁定节点IPv6不生效
- 🛠️ fix: 静默模式没有包含套餐短码
### v0.3.7 (2026-07-26)
- 🌈 ss默认开启tcpfastopen,hy2支持自签
- 🌈 增加cdn更新配置
- 🌈 支持探测已存在的tunnel
- 🌈 支持绑定tg用户
- 🌈 支持自定义部分网站信息
- 🌈 移植妙妙屋clash链式代理
- 🌈tg公告增加日志
- 🌈管理员模板支持分享用户
- 🛠️ fix: clash过滤snellv6的节点
- 🛠️ fix: http|socks5密码下发错误
- 🛠️ fix: ssrf
- 🛠️ fix: tg通知失败400
- 🛠️ fix: v6节点在没有v6的探测点误报被墙
- 🛠️ fix: 上报间隔修改导致sqlite busy
- 🛠️ fix: 中转过的节点用户凭据未生效
- 🛠️ fix: 修改节点的时候增加中转配置没有生效
- 🛠️ fix: 用户禁用后没有踢出登录状态
- 🛠️ fix: 纯 IPv6 服务器节点同步
- 🛠️ fix: 自装旧版Nginx时提示不兼容
- 🛠️ fix: 迁移过来的订阅无法删除
- 🛠️ fix: 近期改动导致分享服务器的功能缺失异常
### v0.3.6 (2026-07-23)
- 🌈 增加auto类型订阅客户端
- 🌈 编辑订阅支持调整可用节点比例
- 🌈 隧道和转发支持连通性探测
- 🛠️ fix: docker配置缺少订阅目录
- 🛠️ fix: 一堆bug
- 🛠️ fix: 已有倍率的节点流量回填错误
- 🛠️ fix: 支持服务器可用性探测
- 🛠️ fix: 服务器地址输入IP时没有同步节点配置
- 🛠️ fix: 真*wal*占用磁盘问题修复
- 🛠️ fix: 覆写功能被模板覆盖
- 🛠️ fix: 订阅文件重名覆盖
- 🛠️ fix: 许可证到期限速配置无法解除
### v0.3.5 (2026-07-21)
- Change license to Miaomiaowu X Source Available License
- 🌈 tg通知支持配置文本
- 🌈 增加共享 reality 域名池
- 🌈 增加日志管理
- 🌈 探针功能优化
- 🌈 探针支持系统指标
- 🌈 支持修改节点部分配置
- 🌈 支持用户设置默认模板
- 🌈 调整系统设置与增加公告
- 🌈 部分显示优化
- 🛠️ fix: agent安装接口命令注入#10
- 🛠️ fix: docker主控无法开启https
- 🛠️ fix: socks5节点无法复制uri
- 🛠️ fix: tg注册改为备注用户名与id
- 🛠️ fix: websocket并发写导致的panic
- 🛠️ fix: 增加ddns状态显示图标
- 🛠️ fix: 增加伪装探针时原登录页的开关
- 🛠️ fix: 增加用户流量限制覆写
- 🛠️ fix: 增加许可证失效容忍度，防止许可证服务不可用导致失效
- 🛠️ fix: 备份功能不可用
- 🛠️ fix: 套餐用户绑定同步
- 🛠️ fix: 接口ssrf漏洞
- 🛠️ fix: 移除兼容妙妙屋短链接
- 🛠️ fix: 管理员查看用户流量未计算倍率
- 🛠️ fix: 节点X无法确定所属服务器
- 🛠️ fix: 获取订阅订阅名称不正确
- 🛠️ fix: 订阅文件接口没有按用户鉴权
- 🛠️ fix: 路由出站匹配节点失败
- 🛠️ fix: 链式隧道优化
- 🛠️ fix: 首次安装时 Xray 启动报错 config.json not found #14
- 🛠️ fix: 默认开启udp=true参数
### v0.3.4 (2026-07-15)
- 🌈 增加二次元主题
- 🌈 增加伪装探针模式
- 🌈 增加幻想风格主题
- 🌈 增加默认主题设置
- 🌈 支持创建链式端口转发
- 🌈 用户管理增加续费视图
- 🌈 访问频繁的接口改为ws
- 🛠️ fix: snell节点路由出站与当作出站使用问题
- 🛠️ fix: 不带vision的reality路由出站配置错误
- 🛠️ fix: 流量统计带下划线用户不准确
### v0.3.3 (2026-07-10)
- 🌈 增加tgbot复制文案配置
- 🌈 客户端限流配置改为连接数限制
- 🌈 支持snell协议
- 🛠️ fix: anytls udp fullcone
- 🛠️ fix: mmwx-wal异常占用磁盘
- 🛠️ fix: tgapp上的流量无法重置
- 🛠️ fix: 流量信息流量显示错误
- 🛠️ fix: 流量通知没有计算offset
- 🛠️ fix: 添加节点证书首次下发失败
- 🛠️ fix: 管理员支持管理所有外部订阅
- 🛠️ fix: 节点名称重复的时候自动给新节点添加后缀
- 🛠️ fix:tg通知特殊字符导致通知失败
- 🛠️ fix:v4+v6双栈节点绑定套餐失败#6
- 🛠️ fix:ws和vless偷自己nginx配置冲突
- 🛠️ fix:xray配置错误导致的重启风暴
- 🛠️ fix:偶尔添加账户绑定套餐用户重复
- 🛠️ fix:分享的服务器节点丢失
- 🛠️ fix:分享的服务断联后无法恢复
- 🛠️ fix:外置xray添加anytls节点报错
- 🛠️ fix:用户管理支持复制用户的客户端订阅
### v0.3.2 (2026-07-03)
- 🌈 修改许可证服务器域名
- 🌈 增加ipv6开关
- 🌈 增加上下线通知容忍阈值
- 🌈 流量统计增加MAX(IN/OUT)模式
- 🌈 节点管理增加uri视图
- 🛠️ fix:Agent隐身模式更新报错504
- 🛠️ fix:clash配置导入节点失败
- 🛠️ fix:中转服务节点真实节点透出
- 🛠️ fix:从妙妙屋迁移的妙妙屋管理员无法删除
- 🛠️ fix:分享出去的服务器下发证书失败
- 🛠️ fix:删除用户网速相关后计算
- 🛠️ fix:套餐的用户ss节点配置下发错误
- 🛠️ fix:带中转配置的节点服务器匹配错误
- 🛠️ fix:开关外部订阅导致节点乱序
- 🛠️ fix:流量重置功能未生效
- 🛠️ fix:用户侧限速失效
- 🛠️ fix:用户外部订阅无法删除
- 🛠️ fix:节点倍率不再继承父节点
- 🛠️ fix:许可证触发限流时pro不可用
- 🛠️ fix:路由出站vless reality缺少配置
- 🛠️ fix删除节点耗时超长
### v0.3.1 (2026-06-29)
- 🛠️ fix:shadowrocket无法获取节点
- 🛠️ fix:上线通知发送失败
- 🛠️ fix:节点删除后流量信息一起删除
- 🛠️ fix:限速配置下发的子账户错误
### v0.3.0 (2026-06-27)
- ♻️ refactor: 节点解析/订阅转换迁移到 proxyparser 共享模块
- 🌈专家模式支持中转服务器端口配置
- 🌈创建节点支持选择多IP
- 🌈增加agent签名验证，防篡改
- 🌈增加备份加密
- 🛠️ fix:主动探测主控域名与浏览器域名不一致的情况
- 🛠️ fix:优化内存占用
- 🛠️ fix:删除节点级联解除出站
- 🛠️ fix:增加流量子账户快照
- 🛠️ fix:日志没有生成文件与自动清理
- 🛠️ fix:某些场景误封ip的问题
- 🛠️ fix:添加服务ddns开关样式错误
- 🛠️ fix:重复添加用户凭据
- 🛠️ fix:验证码配置误报
### v0.2.9 (2026-06-19)
- 🛠️ fix:hy2 parser 缺少 urldecode
- 🛠️ fix:migrate顺序不对导致全新启动失败
- 🛠️ fix:tg通知没有同步系统时区
### v0.2.8 (2026-06-18)
- Update README.md
- 🌈tunnel管理支持端口转发
- 🌈优化出站管理的显示
- 🌈服务器流量支持系统维度
- 🌈添加服务器支持通过dns添加域名与动态DNS
- 🛠️ fix:docker切换到nginx官方镜像
- 🛠️ fix:hy2协议订阅节点缺少sni参数
- 🛠️ fix:hy2等协议使用udping测试
- 🛠️ fix:ipv6机器更新agent失败
- 🛠️ fix:socks5节点入站绑定节点失败
- 🛠️ fix:telegram规则命名冲突
- 🛠️ fix:vless reality出站缺少sniffing.exclude配置
- 🛠️ fix:今日和本周改为0点开始统计
- 🛠️ fix:前端版本号不同步
- 🛠️ fix:多余文件删除
- 🛠️ fix:恢复新机器后旧机器重连报错
- 🛠️ fix:服务器上报IP优先级>服务器地址
- 🛠️ fix:用户网速计算周期不准确
- 🛠️ fix:移除配置模板中的冗余配置
- 🛠️ fix:系统的流量统计规则影响到节点流量显示
- 🛠️ fix:配置漂移时显示配置对比
### v0.2.7 (2026-06-14)
- 迁移前端代码到单独的仓库
- 🌈docker镜像内置nginx(beta)
- 🌈增加cloudflare人机验证测试
- 🌈增加家宽常用和测速分流路由规则
- 🛠️ fix:docker模式必须host网络启动
- 🛠️ fix:nginx没有添加开机启动
- 🛠️ fix:pull模式切换失败
- 🛠️ fix:pull模式添加心跳包
- 🛠️ fix:vless wss节点无法使用
- 🛠️ fix:前端版本号不同步
- 🛠️ fix:只有v6的机器没有显示IP
- 🛠️ fix:同步前端节点缓存
- 🛠️ fix:多管理员的情况下流量统计用户错误
- 🛠️ fix:模板管理与生成订阅失败
- 🛠️ fix:测速端镜像地址错误
- 🛠️ fix:用户网速显示错误
- 🛠️ fix:调整clash-to-loon remote-rule位置
- 🛠️ fix:迁移前端代码到单独的仓库
- 🛠️ fix:部分类型节点联动删除失败
- 🛠️ fix:部分通知发送失败没有重试
### v0.2.7 (2026-06-14)
- 迁移前端代码到单独的仓库
- 🌈docker镜像内置nginx(beta)
- 🌈增加cloudflare人机验证测试
- 🌈增加家宽常用和测速分流路由规则
- 🛠️ fix:docker模式必须host网络启动
- 🛠️ fix:nginx没有添加开机启动
- 🛠️ fix:pull模式切换失败
- 🛠️ fix:pull模式添加心跳包
- 🛠️ fix:vless wss节点无法使用
- 🛠️ fix:前端版本号不同步
- 🛠️ fix:只有v6的机器没有显示IP
- 🛠️ fix:同步前端节点缓存
- 🛠️ fix:多管理员的情况下流量统计用户错误
- 🛠️ fix:模板管理与生成订阅失败
- 🛠️ fix:测速端镜像地址错误
- 🛠️ fix:用户网速显示错误
- 🛠️ fix:调整clash-to-loon remote-rule位置
- 🛠️ fix:迁移前端代码到单独的仓库
- 🛠️ fix:部分类型节点联动删除失败
- 🛠️ fix:部分通知发送失败没有重试
### v0.2.7 (2026-06-14)
- 迁移前端代码到单独的仓库
- 🌈docker镜像内置nginx(beta)
- 🌈增加cloudflare人机验证测试
- 🌈增加家宽常用和测速分流路由规则
- 🛠️ fix:docker模式必须host网络启动
- 🛠️ fix:nginx没有添加开机启动
- 🛠️ fix:pull模式切换失败
- 🛠️ fix:pull模式添加心跳包
- 🛠️ fix:vless wss节点无法使用
- 🛠️ fix:前端版本号不同步
- 🛠️ fix:只有v6的机器没有显示IP
- 🛠️ fix:同步前端节点缓存
- 🛠️ fix:多管理员的情况下流量统计用户错误
- 🛠️ fix:模板管理与生成订阅失败
- 🛠️ fix:测速端镜像地址错误
- 🛠️ fix:用户网速显示错误
- 🛠️ fix:调整clash-to-loon remote-rule位置
- 🛠️ fix:迁移前端代码到单独的仓库
- 🛠️ fix:部分类型节点联动删除失败
- 🛠️ fix:部分通知发送失败没有重试
### v0.2.6 (2026-06-14)
- 🛠️ fix:迁移前端代码到单独的仓库
### v0.2.5 (2026-06-14)
- 迁移前端代码到单独的仓库
- 🌈docker镜像内置nginx(beta)
- 🌈增加cloudflare人机验证测试
- 🌈增加家宽常用和测速分流路由规则
- 🛠️ fix:docker模式必须host网络启动
- 🛠️ fix:nginx没有添加开机启动
- 🛠️ fix:pull模式切换失败
- 🛠️ fix:pull模式添加心跳包
- 🛠️ fix:vless wss节点无法使用
- 🛠️ fix:只有v6的机器没有显示IP
- 🛠️ fix:同步前端节点缓存
- 🛠️ fix:多管理员的情况下流量统计用户错误
- 🛠️ fix:模板管理与生成订阅失败
- 🛠️ fix:测速端镜像地址错误
- 🛠️ fix:用户网速显示错误
- 🛠️ fix:调整clash-to-loon remote-rule位置
- 🛠️ fix:迁移前端代码到单独的仓库
- 🛠️ fix:部分类型节点联动删除失败
- 🛠️ fix:部分通知发送失败没有重试
### v0.2.4 (2026-06-11)
- 🌈xray设置移动端页面适配
- 🌈测速端支持docker安装
- 🌈迁移订阅序列化格式切换设置
- 🌈迁移订阅覆写自选规则
- 🛠️ fix:docker无法自动部署证书问题
- 🛠️ fix:不是妙妙屋管理的路由出站改为可编辑
- 🛠️ fix:修复大量BUG
- 🛠️ fix:前后端交互偶发解密失败
- 🛠️ fix:套餐订阅漏发获取订阅通知
- 🛠️ fix:流量信息今日、本周、本月显示错误
- 🛠️ fix:节点与服务器识别错误
### v0.2.3 (2026-06-09)
- 🌈支持warp出站配置
- 🌈迁移妙妙屋节点多标签
### v0.2.2 (2026-06-08)
- 🌈前后端交互安全加固
- 🌈套餐管理显示优化
- 🌈手机端适配优化
- 🌈支持按入站+用户限速
- 🛠️ fix:下发TLS证书连接失败
- 🛠️ fix:找回密码脚本错误
- 🛠️ fix:暴力探测接口拉黑失败
- 🛠️ fix:简易模式证书自动配置失败
### v0.2.1 (2026-06-05)
- 🌈支持cloudflare turnstile 验证码
- 🛠️ fix: tgbot用户注册后无法访问节点
- 🛠️ fix: 检查版本号逻辑
### v0.2.0 (2026-06-04)
- 🌈MCP功能补全
- 🌈TG BOT开发测试
- 🌈TGBOT支持邀请码注册绑定套餐
- 🌈优化lxc容器的识别
- 🌈优化xray路由管理与出站管理
- 🌈支持TgBot和MiniApp
- 🌈支持节点单独设置倍率与倍率展示
- 🌈迁移妙妙屋代理组编辑的中转代理组功能
- 🛠️ fix: 修改插件默认组织
- 🛠️ fix: 功能性BUG修复
- 🛠️ fix: 每日流量折线图重启错误统计数据
- 🛠️ fix: 节点流量用户展示错误
- 🛠️ fix:出招allowinsecure改为pinnedPeerCertSha256
- 🛠️ fix:出站allowinsecure改为pinnedPeerCertSha256
- 🛠️ fix:已经是路由出站的节点不能再次添加路由出站
### v0.1.9 (2026-06-02)
- 🌈Xray管理路由规则管理优化
- 🌈支持AnyTLS
- 🌈证书上传功能优化
- 🛠️ fix:ss节点配置错误
- 🛠️ fix:前端UI功能优化
### v0.1.8 (2026-06-01)
- 🌈增加服务在线离线筛选
- 🌈增加自定义安全管控配置
- 🛠️ fix:历史版本使用user@email的流量未统计补丁
- 🛠️ fix:安全规则无法识别docker与反代环境的真实IP
- 🛠️ fix:离线通知IP错误
### v0.1.7 (2026-05-31)
- 🌈增加自定义安全管控配置
- 🛠️ fix:ss2022多用户密码拼接错误
- 🛠️ fix:添加服务器的安装命令丢失参数
- 🛠️ fix:用户流量统计聚合逻辑错误
### v0.1.6 (2026-05-30)
- 🌈优化主控使用CDN情况下的Agent互联
- 🛠️ fix:dialog溢出屏幕问题
- 🛠️ fix:docker开启https后无法访问
- 🛠️ fix:代理集合接口查询404
- 🛠️ fix:偶发Agent上报ipv6
- 🛠️ fix:恢复doh使用IP
- 🛠️ fix:模板dns配置不可用的覆盖补丁
- 🛠️ fix:点击模板管理报错缓存读取失败
- 🛠️ fix:订阅管理流量显示错误
- 🛠️ fix:许可证限制错误的应用在外部节点上
### v0.1.5 (2026-05-29)
- 🛠️ fix:dns配置错误
- 🛠️ fix:模板越权问题
- 🛠️ fix:调整普通用户的查看权限
- 🛠️ fix:路由出站功能BUG
- 🛠️ fix:迁移的用户订阅错误
### v0.1.4 (2026-05-28)
- 🌈代理集合前端代码优化
- 🌈优化xray管理代码结构
- 🌈优化编辑节点代码结构
- 🛠️ fix:Agent安装的主控地址错误
- 🛠️ fix:修复若干BUG
- 🛠️ fix:测速页面UIBUG
### v0.1.3 (2026-05-26)
- 🌈合并妙妙屋更新补丁
- 🌈增加妙妙屋迁移入口
- 🌈增加路由出站功能
- 🌈支持从妙妙屋迁移
- 🌈支持节点真延迟测试
- 🌈支持路由出站（入站复用）
- 🛠️ fix:debian13nginx安装失败
- 🛠️ fix:分享的服务器xray_mode没有解析
- 🛠️ fix:自定义Agent端口无效
- 🛠️ fix:自定义规则BUG修复
### v0.1.2 (2026-05-23)
- 🌈测速结果支持出口IP显示
- 🛠️ fix:订阅管理报错
### v0.1.1 (2026-05-23)
- 🌈增加MCP服务，可以接入openclaw或hermes
- 🛠️ fix:数据库增量更新顺序错误
### v0.1.0 (2026-05-22)
- 🛠️ fix:测速代码丢失
### v0.0.10 (2026-05-22)
- 🌈主控支持mihomo测速
- 🌈优化tunnel的配置流程与管理
- 🌈增加xray负载均衡出站配置
- 🌈增加节点测速
- 🌈支持HY2协议
- 🛠️ fix:Dokcer镜像打包失败
- 🛠️ fix:上报间隔配置不生效
- 🛠️ fix:服务器轮换密钥时短暂假离线
- 🛠️ fix:流量信息页面流量始终为0
- 🛠️ fix:系统配置异常丢失
### v0.0.9 (2026-05-21)
- 🌈 同步妙妙屋订阅管理
- 🌈 增加限速单位换算提示
- 🌈优化与licenseserver交互
- 🌈优化与许可证服务交互
- 🌈增加上报频率设置
- 🌈增加批量升级agent
- 🌈支持分享服务器给其他妙妙屋X
- 🌈支持普通用户访问部分妙妙屋功能
- 🌈支持用户配置自定义短码
- 🌈用户禁用时删除节点里的用户配置
- 🛠️ fix:Agent缺少某些错误提示
- 🛠️ fix:优化服务管理
- 🛠️ fix:流量统计错误
- 🛠️ fix:添加节点现在仅添加当前用户
- 🛠️ fix:缺少节点流量统计
- 🛠️ fix:迁移妙妙屋最新补丁
- 🛠️ fix:限速失败
- 🛠️ fix:首页用户网速显示错误
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
