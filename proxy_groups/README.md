# 代理组配置说明

`proxy-groups-lite.json` 定义生成订阅、编辑节点和规则选择器使用的预设代理组。文件顶层必须是 JSON 数组，每个对象表示一个代理组分类。

## 分类字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `name` | 是 | 稳定、唯一的内部标识，建议使用小写英文，如 `youtube`。不要随意修改已有值。 |
| `label` | 是 | 界面显示名称，如 `油管视频`。 |
| `emoji` | 否 | 界面及默认代理组名称使用的图标。 |
| `icon` | 否 | 图标标识；未填写时使用 `emoji`。 |
| `rule_name` | 否 | Clash 规则名称；默认使用 `name`，其次使用 `label`。 |
| `group_label` | 否 | 最终代理组显示名；默认组合为 `emoji + label`。 |
| `presets` | 否 | 所属预设：`minimal`、`balanced`、`comprehensive`。省略时默认为 `comprehensive`；设为 `[]` 表示不自动加入任何预设。 |
| `site_rules` | 否 | 域名类 rule-provider 列表，默认 `behavior` 为 `domain`。 |
| `ip_rules` | 否 | IP 类 rule-provider 列表，默认 `behavior` 为 `ipcidr`。 |

## Rule Provider 字段

每条 `site_rules` 或 `ip_rules` 规则支持：

- `key`：rule-provider 的唯一名称，也是自动生成路径和 URL 的依据。
- `behavior`：`domain`、`ipcidr` 或 `classical`。
- `type`：默认 `http`，也可配置为客户端支持的其他类型。
- `format`：`mrs`、`yaml` 或 `text`；省略时从 URL/路径扩展名推断，无法推断则使用 `mrs`。
- `url`：规则下载地址。只填写 `key` 时，系统会按 MetaCubeX geosite/geoip 地址自动补全。
- `path`：本地缓存路径，默认 `./ruleset/<key>.<format>`。
- `interval`：更新间隔秒数，默认 `86400`。

## 最小示例

```json
{
  "name": "youtube",
  "label": "油管视频",
  "emoji": "📹",
  "presets": ["balanced", "comprehensive"],
  "site_rules": [
    { "key": "youtube" }
  ]
}
```

自定义规则地址示例：

```json
{
  "key": "example",
  "behavior": "classical",
  "format": "yaml",
  "url": "https://example.com/rules/example.yaml",
  "path": "./ruleset/example.yaml",
  "interval": 86400
}
```

## 修改与生效

1. 保证所有 `name` 和 rule-provider `key` 唯一。
2. 确保 `format` 与远程文件内容、缓存路径扩展名一致。
3. 验证 JSON：`node -e "JSON.parse(require('fs').readFileSync('proxy_groups/proxy-groups-lite.json'))"`。
4. 将文件发布到可访问的 HTTP/HTTPS 地址。
5. 在“系统设置 → 系统 → 自定义代理组配置”填写地址并点击“同步代理组配置”。同步成功后，生成订阅和编辑节点会立即使用新配置。

同步时后端会补齐上述默认字段并缓存规范化结果。下载或 JSON 解析失败时，当前已加载的配置不会被替换。
