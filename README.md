# Folo Local — 本地桌面版

> [!IMPORTANT]
> 这是基于 [RSSNext/Folo](https://github.com/RSSNext/Folo) 修改的非官方本地桌面版，
> 不是 RSSNext 或 Folo 官方发行版，也未获得其背书。

Folo Local 将订阅、文章、阅读状态和 AI 配置保存在用户自己的电脑上，主要面向希望
使用单机 RSS 阅读器、无需账号和云端后端的用户。

## 与官方版本的主要区别

- 取消注册、登录、退出和会话 Cookie。
- 使用 Electron 内嵌本地 API，不再依赖独立远程业务后端。
- 使用本地 SQLite 保存订阅、文章、已读、收藏、摘要和设置。
- 支持导入旧版 Follow/Folo SQLite 数据库，并按 URL 和 ID 去重。
- 支持普通 RSS/Atom 地址以及 `rsshub://` 协议。
- 可在设置中配置 RSSHub 实例，提供超时和错误说明。
- 支持部分常见但非标准 RSS 页面与备用 Feed。
- 支持可配置的 OpenAI-compatible API，用于摘要、翻译和 AI 对话等能力。
- 自动过滤不适合长文阅读的短内容，并改善正文与摘要回退。
- 文章列表摘要以纯文本显示，不暴露 HTML 标签。

## 数据与隐私

- 默认数据库：`~/Library/Application Support/Folo/local-api.db`（macOS）。
- API Key 和 AI 设置保存在本机数据库中，请自行保护操作系统账户和数据库备份。
- RSS 抓取会访问订阅源或用户配置的 RSSHub 实例。
- AI 功能启用后，所选文章内容会发送至用户配置的 OpenAI-compatible 服务。
- 本地版不提供云端同步，也不承诺与官方 Folo 服务兼容。

## macOS 下载

Apple Silicon 用户可从本仓库的
[Releases](https://github.com/Guyungy/Folo/releases) 下载最新版 ZIP。

当前构建使用 ad-hoc 签名，未经过 Apple 公证。首次启动如果被 Gatekeeper 拦截，请在
“系统设置 → 隐私与安全性”中确认打开。请仅从本仓库 Release 下载，并核对发布页提供的
SHA-256。

## 本地开发

项目使用 pnpm workspace 和 Turbo：

```bash
pnpm install

# 浏览器渲染器
pnpm --dir apps/desktop run dev:web

# 完整 Electron 桌面版
pnpm --dir apps/desktop run dev:electron

# 构建 Electron 应用
pnpm --dir apps/desktop run build:electron-vite
pnpm --dir apps/desktop exec electron-forge package
```

数据库导入：

```bash
DATABASE_PATH="/path/to/local-api.db" \
  pnpm --dir apps/server import:follow-db -- "/path/to/follow.db"
```

导入前请退出应用并备份目标数据库。

## 修改记录

本地版修改始于 2026 年 9 月，主要实现集中在：

- `apps/server`：本地 API、SQLite、RSS/RSSHub、AI 与数据库导入。
- `apps/desktop/layer/main`：在 Electron 主进程内嵌本地 API。
- `apps/desktop/layer/renderer`：本地设置、错误提示及本地版交互。

完整变更可查看 [提交记录](https://github.com/Guyungy/Folo/commits/dev) 和各版本
[Release Notes](https://github.com/Guyungy/Folo/releases)。

## 上游项目与署名

本项目派生自 [RSSNext/Folo](https://github.com/RSSNext/Folo)，感谢原项目作者与所有贡献者。
“Folo”名称及原项目美术资源归其各自权利人所有。本地版应被视为社区修改版本。

为遵守上游额外条款，本地桌面构建不再使用上游 `icons/mgc` 中标记为不可再分发的资源。
界面图标改用 Apache-2.0 许可的
[`@iconify-json/mingcute`](https://www.npmjs.com/package/@iconify-json/mingcute)
及其他依赖各自许可的图标。

## 许可证与源码

Folo 主体及本地版修改依据 GNU Affero General Public License version 3 发布，完整条款见
[`LICENSE`](./LICENSE)，附加说明见 [`NOTICE.md`](./NOTICE.md)。对应源代码就是本仓库中与
下载包 Release 标签相同的提交，可从 Release 页面下载源码归档。

本软件按“原样”提供，不附带任何明示或默示担保，包括但不限于适销性或特定用途适用性的
担保。使用者自行承担运行、数据迁移、第三方 RSS/RSSHub 与 AI 服务产生的风险。
