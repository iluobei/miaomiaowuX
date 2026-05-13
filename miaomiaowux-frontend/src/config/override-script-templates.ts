export const OVERRIDE_SCRIPT_TEMPLATES = {
  post_fetch: [
    {
      name: '示例：修改完整配置',
      content: `function main(config) {
  // 修改 DNS 配置
  if (!config.dns) config.dns = {};
  config.dns.enable = true;
  config.dns.nameserver = ['https://doh.pub/dns-query', '223.5.5.5'];

  // 添加自定义规则（插入到最前面）
  if (!config.rules) config.rules = [];
  config.rules.unshift('DOMAIN-SUFFIX,example.com,DIRECT');

  // 修改代理组参数
  if (config['proxy-groups']) {
    config['proxy-groups'].forEach(function(group) {
      if (group.type === 'url-test') {
        group.interval = 300;
        group.tolerance = 50;
      }
    });
  }

  // 过滤包含"过期"关键字的节点
  if (config.proxies) {
    config.proxies = config.proxies.filter(function(p) {
      return p.name.indexOf('过期') === -1;
    });
  }

  return config;
}`,
    },
  ],
  pre_save_nodes: [
    {
      name: '示例：修改节点属性',
      content: `function main(proxies) {
  return proxies.map(function(proxy) {
    // 修改节点名称：添加前缀
    proxy.name = '🚀 ' + proxy.name;

    // 强制开启 skip-cert-verify
    proxy['skip-cert-verify'] = 'true';

    // 强制开启 UDP
    proxy.udp = 'true';

    return proxy;
  });
}`,
    },
  ],
}
