# 当前项目状态

更新：2026-10-18。当前源码为本仓库 `main`，版本号仍为 `0.3.1-preview.1`。功能代码基线为 `1bef54f`，本轮只整理文档、清退一次性验收入口及其合成产物，不开展运行性能优化。

## 当前交付边界

- 下一阶段只开展启动与运行性能测量、定位和优化，范围见 [OPTIMIZATION-BASELINE](OPTIMIZATION-BASELINE.md)。
- 当前入场、ARRAY/MATRIX 桥接及 Punk 顶屏效果保留。用户已停止本轮动效设计；保留实现不代表视觉满意，不主动重新设计或移植 Punk 入场。
- 视觉验收交用户；Agent 做必要构建和与改动直接相关的有限检查。性能改动仍需真实的前后测量，不恢复多轮自动视觉审查或大截图矩阵。
- 当前源码预览已经过 TypeScript/Vite 构建。旧安装器未重新打包、安装或发布，不代表当前源码。

## 已有功能

| 区域 | 当前能力 |
| --- | --- |
| 架构 | Electron 桌面宿主、本地服务、TypeScript/Vite 前端与 Three.js；Future/Punk 共用应用状态、目录、播放、ArchiveScene 和资源生命周期 |
| 浏览 | ARRAY/MATRIX/GRID，SHOW/GROUP/SORT、搜索、分页、曲目身份、打开/播放/返回；MATRIX 拖动、惯性和悬停 |
| 空间动效 | 两主题共用固定 q 的 ARRAY/MATRIX 桥接；已有可见列持续保留，货架整体离镜，额外副本错峰升沉；原 ARRAY/MATRIX 静态镜头保持独立 |
| 主题和设置 | STYLE 管理主题、日夜配色、文字、盒体和场景外观；Settings 七类分别管理界面与交互、显示与性能、歌词、音频、音乐库、音乐来源、关于 |
| 显示 | 比例、原生全屏、画质、实验性优先显卡和合成质量建议；显卡按物理 PnP 身份去重，选择后重启生效 |
| 盒体 | Future 简单/精细/Punk 拓展与 Punk 自有盒体；简单款玻璃透光/磨砂可调，封面和金边独立；Punk 前玻璃封合、实体内板和 ARRAY 顶屏保留 |
| 入场 | Future ALBUMS 的 MATRIX/ARRAY 共用终端前导，各有场景段，可跳过/重播；欢迎文案/ID 受字母、空格及长度限制；Punk 入场暂缓 |
| 音频 | 本地/FTP/在线来源、统一播放栏、PCM/DSD/DoP、EQ、Sony 音效和官方 LSP 原生窗口 |
| 歌词与信号 | Local/Cloud 双 bank、独立偏移、导入保护、跟随播放及真实频谱；Future 界面音效跟随播放器输出，音乐播放时静音，Punk 禁用 |

主题与几何契约见 [THEME-PAGE](THEME-PAGE.md)，状态/目录边界见 [UNIFIED-ARCHITECTURE](UNIFIED-ARCHITECTURE.md)，数据及音频规则见各专项文档。

## 性能事实与未知

- 本机此前枚举的四个 DXGI/KMT 逻辑 LUID 对应同一张物理 RTX 5080，位置 PCI 1:0.0，报告显存约 15.6 GiB。身份修正不等于掉帧修复。
- 尚未建立当前版本的真实运行帧时间、CPU/GPU 负载、内存/显存或分阶段启动基线。不能将旧合成窗口 ready 时间、屏幕 FPS 或功能测试通过数当成性能结论。
- 现有质量建议使用合成场景；`ArchiveScene.stats().frameTime` 是场景累计时钟，不是单帧耗时。

## 源码地图

| 职责 | 入口 |
| --- | --- |
| 应用接线、路由和偏好 | `src/music-app.ts` |
| 公共状态与目录 | `src/music-application-state.ts`、`src/music-catalog.ts`、`src/music-catalog-markup.ts` |
| 主场景及资源 | `src/scene.ts`、`src/music-scene-resources.ts`、`src/music-shelf.ts`、`src/music-spatial-layout.ts` |
| 镜头、桥接和升沉 | `src/music-layout-flight.ts`、`src/music-layout-framing.ts`、`src/music-layout-transition.ts`、`src/music-layout-rise.ts`、`src/music-layout-addresses.ts` |
| 模型、材质与图集 | `src/case-model.ts`、`src/case-materials.ts`、`src/music-case-titles.ts`、`src/punk-case-display.ts`、`src/cover-atlas.ts` |
| 画质与合成测量 | `src/render-quality.ts`、`src/quality-detection.ts`、`src/quality-benchmark-frame.ts`、`quality-benchmark.html` |
| 桌面、启动和服务 | `desktop/main.cjs`、`desktop/preload.cjs`、`scripts/launch-source-preview.mjs`、`scripts/music-server.mjs` |
| 歌词、信号与音频 | `src/lyrics-page.ts`、`src/signal-page.ts`、`src/eq-controls.ts`、`scripts/native-output.mjs`、`native/audio-host.cpp` |

运行操作见 [LOCAL-DEVELOPMENT](LOCAL-DEVELOPMENT.md)，后续工作只在 [OPTIMIZATION-BASELINE](OPTIMIZATION-BASELINE.md) 维护。历史代码和已跟踪文档只在 Git 中按需追溯，不作为当前接手材料。
