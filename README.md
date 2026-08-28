# dsh-sidebar-enhancement-search

在 [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) 的**内置资源管理器标签页**里直接搜索文件（Codex 式子序列模糊匹配），并给资源管理器树和编辑器标签页加上**按文件类型区分的彩色图标徽章**。不需要新增任何标签页。

> **English**: Codex-style file search inside the built-in Explorer tab of dsh-better-sidebar, plus per-file-type icons/badges in the explorer tree and editor tabs. No extra tabs.

---

## ⚠️ 免责声明（请先读）

**本插件是 vibecoding（与 AI 协作、边聊边写）出来的作品，作者纯自用，没有经过大规模测试，也没有在其他人的环境里验证过。**

- 它直接操作 better-sidebar 的 DOM（CSS 类名后缀、注入样式表、MutationObserver），**better-sidebar 升级后可能失效**；
- 安装与使用**有风险**：可能出现徽章不显示、布局异常等问题，请自行评估后再装；
- 作者不对任何数据丢失、功能异常或使用后果负责；
- 如果遇到问题，欢迎提 issue，但**不保证修复时间**。

> **English**: This plugin was **vibecoded** (built collaboratively with AI). It is for **personal use**, not battle-tested, and touches better-sidebar's DOM directly — **install at your own risk**. No warranty of any kind.

---

## 功能

- **内嵌筛选框**：位于内置 Explorer 标签页「工作文件夹名」下方，输入即筛
- **Codex 式子序列匹配**：字符按顺序命中即可（`bxmd` 能匹配到 `博客.md`），连续/分隔符边界命中加权，文件名命中优先于路径
- **文件类型徽章**：资源管理器树与编辑器标签页按类型显示彩色徽章（TXT/DOC/XLS/PPT/PDF/IMG/ZIP/PY/JS/CFG/SH/C/WEB）；**md 文件按设计保留内置 `#` 图标**
- **搜索结果可定位**：悬停行尾的文件夹图标可「在文件夹中显示」
- **自愈机制**：徽章用 CSS 伪元素实现，React 重渲染清不掉；另有 2 秒心跳兜底，观察器失效也会自动恢复

## 依赖

- DeepSeek Harness（DSH）Web GUI
- [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) ^0.14（v1.0.2+ 已适配 0.14：挂载锚点改为 `editorTreeSearch`，Files 窗口归一化为 editor 形态）

## 安装

```sh
# 从 GitHub release 安装（tarball）
dsh plugin --profile web add https://github.com/mastereal/dsh-sidebar-enhancement-search/archive/refs/tags/v1.0.5.tar.gz
```

装完重启 `dsh web`，浏览器**硬刷新（Ctrl+Shift+R）**，并**关闭所有旧 DSH 窗口/标签页**（旧实例会残留旧代码，造成界面重复）。

## 使用

1. 打开侧边栏的**资源管理器**标签页
2. 在「工作文件夹名」下方的筛选框输入关键词
3. 点击结果在侧边栏编辑器打开；悬停行尾文件夹图标可定位到系统文件夹
4. 资源管理器树和编辑器标签页的文件图标会显示类型徽章（md 保持 `#`）

## 排障

控制台日志前缀 `[dsh-sidebar-enhancement-search]`：

- `client loaded (v1.0.5)` —— 浏览器端已加载
- `tab badges: editors=N matched=M badged=K` / `tree badges: rows=N badged=M` —— 徽章应用计数

徽章一直不显示时：关掉所有旧 DSH 窗口 → 硬刷新。仍不行请提 issue 并附上这两行日志。

## 工作原理（简）

宿主提供 `/dsh-sidebar-enhancement-search/index`（全量文件索引，忽略 `.git`/`node_modules`/`.obsidian`/`.trash` 与隐藏目录，按工作区缓存 30 秒）、`/tree`、`/reveal` 三个路由；客户端通过 CSS module 类名后缀（v1.0.2+ 用 `[class*="editorTreeSearch"]`，隐藏 0.14 自带的纯文本搜索行后植入筛选框）定位内置 Explorer，徽章用 data 属性 + CSS 伪元素绘制，React 无法清除。v1.0.5 起 reveal 会额外把资源管理器窗口激活到前台（模拟 Alt + SetForegroundWindow）。v1.0.3 起结果列表高度用 ResizeObserver 跟随树面板。

## 许可

MIT © 2026 mastereal

---

*Vibecoded with DeepSeek Harness · 纯自用作品，谨慎安装*
