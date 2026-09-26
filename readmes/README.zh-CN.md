# Pagecraft

[English](../README.md) · [한국어](README.ko.md) · **简体中文** · [日本語](README.ja.md)

**AI 生成了 HTML，现在把它变成您的作品。**

打开报告、落地页或静态原型，修改标题、调整布局，然后保存为普通 HTML。无需重新构建页面，也无需让 AI 重新生成整份文档。编辑不需要账号、API 密钥或 AI 订阅。

[**在浏览器中试用 →**](https://suwonleee.github.io/pagecraft/)

![真实英文界面：在画布上编辑报告的文本、样式和布局](../docs/images/edit-report.png)

## 使用场景

### 将 AI 草稿整理成可以分享的报告

在**报告**中选择**周报**或**决策简报**，也可以粘贴 AI 工具生成的完整 HTML。双击句子进行修改，在属性面板调整字号、颜色和间距，然后下载 HTML。内置模板包含有意义的元素 ID、响应式布局和 A4 打印规则。

![英文报告模板、粘贴 HTML 和 AI 写作要求界面](../docs/images/report-templates.png)

1. 选择**报告 → 周报**。
2. 双击标题，或在属性面板的**文本**中修改。
3. 调整**排版**、**颜色**或**尺寸与间距**。
4. 选择**下载 HTML**，重新打开文件检查结果。

模板是虚构示例。分享前请用真实资料替换示例文本和方括号中的占位内容。Pagecraft 不会编造指标，也不会调用 AI 服务。

### 无需构建流程即可完善落地页

选择**试用示例**，替换标题和按钮文案，并以桌面、平板或手机宽度预览。支持移动、调整大小、复制、删除、对齐和撤销。

![在真实画布上编辑英文落地页示例](../docs/images/edit-landing.png)

保存结果仍是 HTML：可在浏览器打开、放入 Git 仓库，或发布到自己的静态托管服务。以上截图来自真实英文界面；应用内可切换到简体中文。

## 本地运行

本地构建需要 **Node.js 22.12+** 和 npm；`.nvmrc` 指定 Node.js 24。

```sh
git clone https://github.com/suwonleee/pagecraft.git
cd pagecraft
npm ci
npm run build:web
npm run serve:web
```

打开 **http://127.0.0.1:4318/**，从报告或示例开始，或导入自己的 HTML。

### 语言设置

默认使用英语。通过顶部语言菜单选择 **English / 한국어 / 简体中文 / 日本語**。菜单、提示和错误消息、新建报告模板、示例及 AI 写作要求会使用所选语言。已导入文档的内容不会被翻译。

设置保存在浏览器 `localStorage` 的 `pagecraft-language` 键中，值为 `en`、`ko`、`zh-CN` 或 `ja`。不同浏览器配置和网站地址分别保存，不会同步，也不需要服务器配置或账号。未设置或值不受支持时回退到英语。清除网站数据会重置语言。

切换语言会重新加载编辑器，请先保存文件。如果有未保存的编辑，可以在确认对话框中取消切换。完成离线准备的网页应用和可选扩展都包含四种语言。

### 选择运行方式

| 方式 | 适用情况 | 保存方式 |
|---|---|---|
| 浏览器应用 | 单个自包含 HTML 文件 | 支持的浏览器可写回已授权的原文件；导入副本则下载保存 |
| 本地文件夹服务器 | HTML 旁边有 CSS、图片或字体 | 在指定项目文件夹内写入，提供备份和冲突检查 |
| 已安装的网页应用 | 从应用图标启动 | 与浏览器相同的文件权限；支持的环境可通过“打开方式”传入 HTML |
| 可选扩展 | 从 Chrome 工具栏打开编辑器 | 独立的文件编辑流程，不捕获或修改当前网站 |
| 文档 CLI | 编程代理和自动化 | 校验哈希后修改原文件或生成新副本 |

```sh
npm start -- ./drafts
npm start -- ./report.html --port 4319
```

文件夹模式默认使用 **http://127.0.0.1:4317**，请保持服务器运行。不带路径执行 `npm start` 会在 `.pagecraft/` 创建入门文档。该默认工作区文档和 CLI 输出仍为英语。

### 保存需要明确执行

- 在 HTTPS 或 localhost 上，Chromium 系浏览器支持打开并授权原文件后直接保存。
- 导入副本、粘贴 HTML 和使用模板时，请编辑后下载。下载不会覆盖原文件，也不会清除原文件的未保存状态。
- 浏览器临时草稿可以恢复为独立副本，但不能代替保存文件。

浏览器模式接受单个最大 **16 MiB** 的 UTF-8 HTML 文件。无法自动读取相邻资源；请嵌入 HTML 或使用文件夹模式。[保存、恢复与浏览器差异（英文）](../docs/USAGE.md)

## 与编程代理编辑同一个文件

用画布做视觉调整，让 Claude Code、Codex 等编程代理执行精确修改。CLI 处理已保存文件，无需运行编辑器服务器或安装 AI 提供商 SDK。

```sh
npm run --silent document -- inspect ./report.html --query weekly-summary-lead
```

可以这样向代理提出要求：

> 阅读 `docs/AI_EDITING.md`，检查 `report.html` 并缩短执行摘要。保留所有其他文本、样式、ID 和打印规则。写入前验证补丁，不要重新生成整份文档。

使用检查返回的哈希创建 `edits.json`：

```json
{
  "version": 1,
  "hash": "REPLACE_WITH_THE_HASH_FROM_INSPECT",
  "changes": [
    { "target": "weekly-summary-lead", "text": "核心流程已可供审核，实际效果仍在测量中。" }
  ]
}
```

```sh
npm run --silent document -- apply ./report.html --patch edits.json --dry-run
npm run --silent document -- apply ./report.html --patch edits.json --write
```

**交接前保存画布编辑；代理写入后重新打开文档。** 过期哈希会被拒绝，`--write` 会备份旧文件。这是带冲突检查的顺序交接，不是实时合并。[完整代理工作流（英文）](../docs/AI_EDITING.md)

## 扩展与静态部署

```sh
npm run build:extension
```

在 Chrome 的 `chrome://extensions` 开启开发者模式，选择“加载已解压的扩展程序”，指定 `extension-dist/`。点击 Pagecraft 图标打开编辑器。它不请求主机权限，也不注入内容脚本；目前没有扩展商店条目。

`npm run build:web` 生成可部署到静态服务器的 `web-dist/`。通过 HTTP(S) 提供服务，子目录 URL 应以 `/` 结尾。**不支持通过 `file://` 直接打开 index.html**，因为浏览器会阻止模块和 worker。预构建 ZIP 是否可用，请查看 [Releases](https://github.com/suwonleee/pagecraft/releases)。

## 常用操作与限制

| 操作 | 控件 |
|---|---|
| 编辑文本 | 双击或使用属性面板 |
| 多选 | Shift+点击，或在空白画布拖动框选 |
| 移动 | 拖动；按住 Alt/Option 暂停吸附 |
| 复制 / 删除 | `⌘/Ctrl+D` / `Delete` |
| 撤销 / 重做 | `⌘/Ctrl+Z` / `⌘/Ctrl+Shift+Z` |
| 平移 / 缩放 | 空格+拖动 / `⌘/Ctrl+滚动` |
| 保存 / 下载 | `⌘/Ctrl+S` 或 `⌘/Ctrl+Enter` |

保存通过修改源代码范围完成，不会重新序列化整份文档。浏览器模式在设备上处理文件；文件夹服务器使用回环地址。

支持静态 `.html` 和 `.htm`。预览会阻止脚本和外部资源，可能与原文件显示不同。SVG 和 canvas 保留在源文件中，但不能逐个编辑内部图形。不支持 PPTX、Figma、draw.io、改变元素父级或顺序，以及实时协作。[架构与限制（英文）](../docs/ARCHITECTURE.md)

## 开发

```sh
npm run check
npm run test:e2e
npm run test:browser
npm run test:extension
npm run build
```

安装测试浏览器：`npx playwright install chromium firefox webkit`。本地 Chromium 测试默认使用已安装的 Chrome。网页和扩展构建共享输出，请按顺序运行。

[重现截图（英文）](../docs/SCREENSHOTS.md) · [贡献与提交规范（英文）](../CONTRIBUTING.md) · [MIT 许可证](../LICENSE)
