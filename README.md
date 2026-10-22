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

`npm run dev` 启动前端开发服务；`npm run music` 启动音乐服务。完整桌面及原生音频需另行准备 Electron、音频组件和编译工具，详见 [开发接手指南](docs/DEVELOPMENT.md)。普通构建、源码启动和安装器打包不会自动下载这些工具。

已有桌面开发环境可直接使用：

```powershell
npm run build:source
.\启动源码验证.cmd
```

`构建源码验证.cmd` 同时构建原生音频与前端；`启动源码验证.cmd` 只启动已有构建。两者沿用本机 `.tools/source-preview-*` 路径。

## 目录

| 目录 | 内容 |
| --- | --- |
| `src/` | 界面、主题、状态、目录、渲染和交互 |
| `desktop/` | Electron 宿主、窗口、预加载和显卡选择 |
| `scripts/` | 音乐服务、标签写回、构建和 Windows 安装器 |
| `native/`、`vendor/` | 原生音频实现、第三方源码和许可 |
| `art/`、`public/`、`content/` | 美术源文件、运行资源和档案内容 |
| `docs/DEVELOPMENT.md` | 环境、代码地图、数据位置与维护约定 |

依赖、工具、构建产物、缓存和个人音乐数据不进入 Git。仓库保留当前实现；历史变更由 Git 记录。

## 署名与许可

音乐适配与维护：Copyright (c) 2026 RonaldDeng。原版 [RhineLabUI](https://github.com/LBEILC/RhineLabUI)：Copyright (c) 2026 LBEILC。

可授权的应用代码使用 [MIT License](LICENSE)。字体、模型、视觉、音频、Sony 及其他第三方组件保留各自权利，详见 [NOTICE](NOTICE.md)。
