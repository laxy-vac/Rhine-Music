# Rhine Music

Windows 桌面音乐播放器，基于 TypeScript、Three.js、Electron 和原生音频主机。

提供 **莱茵生命：映像（Rhine Lab: Reflections）** 与 **仿孤星（Lone Trail–Inspired）** 两套主题，共用音乐库、播放状态和渲染流程。

## 功能

- 本地、FTP 和在线专辑架；ARRAY、MATRIX、GRID 浏览、搜索、分组与排序。
- 可调唱片盒体、材质与部件，日夜配色、画质和窗口设置。
- 专辑介绍、封面和歌曲标签编辑；多歌手、主唱分组、分类规则图形编辑及 JSON 批量管理。
- MusicBrainz、Wikipedia、网易云音乐、QQ 音乐及自定义资料源；全局优先级与单专辑覆盖。
- 本地/云歌词、独立校准、同步歌词与真实音频频谱。
- PCM、DSD、DoP、均衡器、Sony 音效和 LSP 原生均衡器窗口；具体输出能力取决于已准备的组件和设备。

## 构建与运行

前端要求 **Node.js 24 或更新版本**。依赖由 `package-lock.json` 锁定。

```powershell
npm ci
npm run build
```

`npm run dev` 启动前端开发服务；`npm run music` 启动音乐服务。完整桌面及原生音频需另行准备 Electron、音频组件和编译工具，详见 [开发接手指南](docs/DEVELOPMENT.md)。普通构建、源码启动和便携 ZIP 打包不会自动下载这些工具。

已有桌面开发环境可直接使用：

```powershell
npm run build:source
.\启动源码验证.cmd
```

`构建源码验证.cmd` 同时构建原生音频与前端；`启动源码验证.cmd` 只启动已有构建。两者沿用本机 `.tools/source-preview-*` 路径。

## Windows 便携版

Windows 只提供 **Portable 便携 ZIP**，不提供 NSIS 安装器或旧式自解压 EXE。运行库和播放器都直接放在解压目录中，不会释放到 AppData。

```powershell
npm run package:windows
```

打包入口会复用 `scripts/stage-windows-payload.mjs` 检查 Electron、原生音频、Python/Sony、依赖和来源哈希，然后生成：

- `.tools/releases/<版本>-<时间>/Rhine-Music-<版本>-Windows-x64-Portable.zip`
- 与 ZIP 同名的 `.sha256` 校验文件（`Rhine-Music-<版本>-Windows-x64-Portable.zip.sha256`）
- `build-report.json`（载荷、存储布局和校验摘要）

**解压与启动**：把 ZIP 解压到一个新的、普通用户可写的空文件夹（例如 `D:\Apps\Rhine Music`），保持目录完整，双击 `Rhine Music.exe`。ZIP 已预建 `data/config/`、`data/library/lyrics/cache/`、`data/session/`、`data/logs/`、`data/crashes/`、`data/tmp/`、`data/lsp/` 和 `presets/eq/standard/` 等空存储点；首次启动直接使用，缺失时会重新创建。`presets/themes/` 与 `presets/eq/` 保存个人主题和 EQ 预设。详细说明也随 ZIP 放在根目录 `README-Portable.txt`。

**更新**：退出播放器，把新版本 ZIP 解压到另一个新文件夹，再把旧文件夹中的 `data/` 和 `presets/` 复制到新文件夹，启动新版本确认后再处理旧文件夹。不要直接覆盖正在使用的程序目录，避免新旧运行库混用。

**备份与迁移**：完整备份复制整个解压文件夹；轻量备份只复制 `data/` 和 `presets/`。删除整个解压目录会同时删除其中的 `data/` 与 `presets/`（设置、索引、缓存和个人预设），请先备份；音乐文件不在这个文件夹内，删除播放器目录不会删除外部音乐。删除 `data/` 会丢失索引、缓存和设置，删除 `presets/` 会丢失个人预设。迁移到另一台 Windows x64 电脑时复制整个文件夹，或重新解压程序后复制这两个目录。

**目录用途**：`Rhine Music.exe` 是主程序；`resources/app/` 包含界面、桌面宿主、原生音频、Python/Sony 运行库和依赖；`data/config/` 保存偏好和 EQ 库配置；`data/library/` 保存曲库索引、封面/资料缓存和默认歌词缓存；`data/session/`、`data/logs/`、`data/crashes/`、`data/tmp/`、`data/lsp/` 分别保存会话、日志、崩溃转储、临时文件和 LSP 用户数据。默认存储始终在解压目录内，播放器不会回退到 AppData。

## 目录

| 目录 | 内容 |
| --- | --- |
| `src/` | 界面、主题、状态、目录、渲染和交互 |
| `desktop/` | Electron 宿主、窗口、预加载和显卡选择 |
| `scripts/` | 音乐服务、标签写回、构建和 Windows 便携 ZIP |
| `native/`、`vendor/` | 原生音频实现、第三方源码和许可 |
| `art/`、`public/`、`content/` | 美术源文件、运行资源和档案内容 |
| `docs/DEVELOPMENT.md` | 环境、代码地图、数据位置与维护约定 |

依赖、工具、构建产物、缓存和个人音乐数据不进入 Git。仓库保留当前实现；历史变更由 Git 记录。

## 署名与许可

音乐适配与维护：Copyright (c) 2026 RonaldDeng。原版 [RhineLabUI](https://github.com/LBEILC/RhineLabUI)：Copyright (c) 2026 LBEILC。

可授权的应用代码使用 [MIT License](LICENSE)。字体、模型、视觉、音频、Sony 及其他第三方组件保留各自权利，详见 [NOTICE](NOTICE.md)。
