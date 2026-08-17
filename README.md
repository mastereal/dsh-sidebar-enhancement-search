# sidebar-enhancement-search

Codex-style file **search inside the built-in Explorer tab** of
[dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar), plus
**per-file-type icons/badges** in the explorer tree and the editor tab bar.

No extra tabs. The filter box lives right below the workspace folder name in
the built-in Explorer; while you type, the tree is hidden and matching files
render in place with Codex-style subsequence matching (characters in order;
contiguous and boundary hits score higher; basename dominates path).

## Features

- **Inline filter box** inside the built-in Explorer tab (no new tab)
- **Codex-style fuzzy matching** — `bxmd` finds `博客.md`, `blx-2.md` style hits
- **Per-file-type badges** in the explorer tree and editor tabs:
  TXT / DOC / XLS / PPT / PDF / IMG / ZIP / PY / JS / CFG / SH / C / WEB —
  Markdown files keep the built-in `#` icon by design
- **Open in folder** from the search results (hover the row)
- Self-healing: badges are applied via CSS pseudo-elements that React
  re-renders cannot remove, with a 2s heartbeat fallback

## Requirements

- DeepSeek Harness (DSH) web GUI
- [dsh-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) ^0.12
  (any version that keeps the `explorerHeader`/`explorerRow`/`paneTab` class
  suffixes)

## Installation

From the plugin market (once listed) or via CLI:

```sh
# tarball from a GitHub release
dsh plugin --profile web add https://github.com/mastereal/sidebar-enhancement-search/archive/refs/tags/v1.0.0.tar.gz

# or from npm (when published)
dsh plugin --profile web add sidebar-enhancement-search
```

Restart `dsh web` and hard-refresh the browser (Ctrl+Shift+R).
Make sure to close older DSH tabs/windows so stale plugin instances do not
duplicate the UI.

## Usage

1. Open the built-in **Explorer** tab in the sidebar.
2. Click the filter box under the workspace folder name and type.
3. Click a result to open it in the sidebar editor; hover → open in folder.
4. File icons in the tree and on editor tabs show type badges (md keeps `#`).

## Troubleshooting

Console logs are prefixed `[sidebar-enhancement-search]`:

- `client loaded (v1.0.0)` — the browser bundle is running
- `tab badges: editors=N matched=M badged=K` / `tree badges: rows=N badged=M`
  — badge application counters

If badges stay built-in, hard-refresh with all old DSH windows closed.

## How it works

The host serves `/sidebar-enhancement-search/index`, `/tree` and `/reveal`
routes (index is cached 30s per workspace, ignores `.git`/`node_modules`/
`.obsidian`/`.trash` and hidden dirs). The client augments the built-in
Explorer via CSS-module class suffixes (`[class*="explorerHeader"]`), which
survive hashed-class rebuilds, and renders badges with data attributes +
CSS pseudo-elements so React reconciliation can never wipe them.

## License

MIT © 2026 mastereal

---

## 中文说明

**功能**：在 better-sidebar 内置的资源管理器标签页里直接搜索文件（Codex
式子序列匹配，无需新标签页），并给资源管理器树和编辑器标签页加上按文件
类型区分的彩色图标徽章（md 文件按设计保留内置 `#` 图标）；搜索结果行悬停
可"在文件夹中显示"。

**安装**：见上方 Installation（市场收录后也可在插件市场一键安装）。

**日志**：浏览器控制台前缀 `[sidebar-enhancement-search]`，启动出现
`client loaded (v1.0.0)` 即加载成功。
