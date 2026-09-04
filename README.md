# dsh-mcp-manager

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.0-green.svg)](./package.json)

> Manage MCP servers inside DeepSeek Harness (DSH) — add / remove / edit / enable servers at runtime via model tools (`mcp_list` / `mcp_add` / ...) and a Web GUI settings panel, without hand-editing `cordis.patch.yml`.

一个 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai) 通用插件:把 MCP 服务器管理做成一等公民。每台服务器是 `@deepseek-ai/dsh-mcp-client` 的一个动态挂载,其工具以 `mcp__<id>__<tool>` 的形式直接出现在模型工具列表里。

## 特性

- **MCP Servers / MCP 服务器**设置面板(dsh web / DSH Desktop 的设置对话框)
- **模型工具**:`mcp_list` / `mcp_status` / `mcp_add` / `mcp_update` / `mcp_remove` / `mcp_set_enabled`
- **动态挂载**:添加即用,不用重启;`patchReload: live` 的 profile 热加载
- **持久化注册表**:保存在 `<dshHome>/mcp-manager/servers.json`(默认 `~/.dsh/mcp-manager/servers.json`,权限 0600)
- **机密打码**:GUI 与模型输出中按 KEY / PASSWORD / SECRET / TOKEN 模式自动打码
- **通用**:任何组合了 tools 服务的 profile(web / desktop / headless / sdk)都可用;存在 webServer 时才挂 GUI 路由

## 安装

```sh
dsh plugin --profile <name> add <本仓库路径>
```

例(本机 Desktop):

```sh
git clone https://github.com/ByboyCn/dsh-mcp-manager.git
dsh plugin --profile desktop add D:\src\dsh-mcp-manager
```

`patchReload: live` 的 profile(web / desktop / 自定义)热加载;startup 类 profile 重启后生效。

## 使用

### GUI

打开设置 → **MCP 服务器**:添加服务器(选 stdio 或 streamable-http,填命令 / URL、参数、环境变量等),用行内按钮启停、编辑、删除;状态点表示 已就绪 / 连接中 / 错误,展开可看该服务器发现的工具列表。

### 对话(模型工具)

> 帮我加一个 GitHub 的 MCP 服务器,id 叫 github,用 npx -y @modelcontextprotocol/server-github,token 在环境变量 GITHUB_TOKEN 里。

模型会调用 `mcp_add`,之后 `mcp__github__*` 工具即可用。

## 构建

```sh
pnpm install
pnpm run build   # 产出 lib/index.js(host 半)与 client/client.js(浏览器半)
pnpm run check   # tsc --noEmit 类型检查
```

## 项目结构

```
src/
├── index.ts        # 插件入口(cordis plugin)
├── manager.ts      # MCP 服务器生命周期管理
├── registry.ts     # servers.json 持久化注册表
├── http.ts         # /mcp-manager/api/* 路由
├── tools.ts        # 模型工具定义
└── client/         # Web GUI(设置面板)
    ├── McpSection.tsx
    ├── api.ts
    └── locales.ts
```

## 安全说明

- `env` / `headers` 中的机密明文保存在 `servers.json`(权限 0600);GUI 与模型输出中按 KEY / PASSWORD / SECRET / TOKEN 模式打码。
- HTTP 路由(`/mcp-manager/api/*`)与 dsh web UI 同源,继承 dsh webServer 的暴露面。

## 已知限制

- 服务器配置在多个 profile 间共享(同一注册表文件);两个 profile 同时运行时各自挂载各自的 fiber。
- `mcp-client` 的重连是内置的(指数退避,最多 10 次);「连接中 / 暂无工具」可能意味着启动失败,详情看 host 日志。
- 状态从工具注册表推导:工具数为 0 但无报错时无法区分「连接中」与「服务器没有任何工具」。

## License

[MIT](./LICENSE) © ByboyCn
