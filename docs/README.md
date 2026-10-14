# 文档索引

本文区分当前入口、专项说明和历史证据。项目总体状态及四阶段进度以[PROJECT-STATUS](PROJECT-STATUS.md)和[UNIFIED-ARCHITECTURE](UNIFIED-ARCHITECTURE.md)为准；此索引不替代它们，也不把旧记录当作当前授权或验收。

## 当前入口

| 文档 | 用途 |
| --- | --- |
| [PROJECT-STATUS](PROJECT-STATUS.md) | 当前功能基线、四阶段进度、已验证事实、未验收事项与源码地图 |
| [LOCAL-DEVELOPMENT](LOCAL-DEVELOPMENT.md) | 本机源码启动、必要构建、数据边界、检查索引与回滚 |
| [UNIFIED-ARCHITECTURE](UNIFIED-ARCHITECTURE.md) | Future/Punk 统一架构的目标、阶段顺序和逐项验收 |
| [PREVIEW-RELEASE](PREVIEW-RELEASE.md) | 0.3.1-preview.1 品尝版安装、目录数据、卸载、源码导出及验证边界 |
| [PREVIEW-VALIDATION-2026-10-15](PREVIEW-VALIDATION-2026-10-15.md) | 本品尝版构建、隔离启动、实际安装/默认卸载及未覆盖范围 |

## 当前产品与技术专项

| 文档 | 用途与状态 |
| --- | --- |
| [THEME-PAGE](THEME-PAGE.md) | 两套主题、共同流程、唱片盒和画质的现行说明 |
| [AUDIO-CORE-IMPLEMENTATION](AUDIO-CORE-IMPLEMENTATION.md) | 当前音频核心、处理链、解码和输出边界 |
| [LSP-ADVANCED-EQ](LSP-ADVANCED-EQ.md) | 当前官方 CLAP 进阶 EQ 窗口、组件和验收边界 |
| [DSD-PLAYBACK](DSD-PLAYBACK.md) | DSD/DoP 路线、设置和离线证据范围 |
| [LYRICS](LYRICS.md) | 歌词来源、缓存、同步和频谱数据边界 |
| [SIGNAL-PAGE](SIGNAL-PAGE.md) | 信号页模式、真实音频数据和性能口径 |
| [ONLINE-LIBRARY](ONLINE-LIBRARY.md) | 在线来源、隐私、安全和接口边界 |
| [SONY-WALKMAN](SONY-WALKMAN.md) | Sony 音效来源、适配与验证边界 |
| [FOOBAR-STYLE-SOURCES](FOOBAR-STYLE-SOURCES.md) | Audio Archive 主题的资源来源、许可和移植边界；不是当前布局规范 |
| [HI-RES](HI-RES.md) | Hi-Res/DSD 标志与来源判定说明 |
| [UI-LANGUAGE](UI-LANGUAGE.md) | 界面语言和频谱优化记录 |

## 历史方案、专项报告与发布记录

以下材料保留原始上下文，供追溯和核对；不覆盖当前状态文档，也不证明当前版本、窗口或设备已经通过相同验收。

| 文档 | 历史范围 |
| --- | --- |
| [AUDIO-CORE-DESIGN](AUDIO-CORE-DESIGN.md) | 明确标为历史方案；当前音频实现见上面的 AUDIO-CORE-IMPLEMENTATION |
| [AUDIO-CHAIN-FIX-REPORT-2026-10-10](AUDIO-CHAIN-FIX-REPORT-2026-10-10.md) | 2026-10-10 音频链路专项修复和限定检查记录 |
| [SONY-AUDIO-MEASUREMENTS](SONY-AUDIO-MEASUREMENTS.md) | 2026-10-08 Sony 音效测量记录及输入范围 |
| [WASAPI-STABILITY](WASAPI-STABILITY.md) | WASAPI 稳定性核验记录；不覆盖所有设备或当前全部音频路径 |
| [MUSIC-SERVICE](MUSIC-SERVICE.md) | V0.3.0 macOS 音乐服务说明；不是当前 Windows 安装指南 |
| [PWA](PWA.md) | 上游 PWA 历史说明；不是当前 Windows 应用的运行方式 |
| [WINDOWS](WINDOWS.md) | 2026-10-08 旧单文件 EXE 的使用和打包记录；不是当前安装说明 |
| [UI-REVIEW-V0.3.0](UI-REVIEW-V0.3.0.md) | V0.3.0 界面回归和各轮历史截图记录 |
| [RELEASE-V0.1.0](RELEASE-V0.1.0.md) · [V0.1.1](RELEASE-V0.1.1.md) · [V0.2.0](RELEASE-V0.2.0.md) · [V0.3.0](RELEASE-V0.3.0.md) | 对应版本的发布检查和当时未覆盖范围；不是本品尝版的验收结果 |

## 历史说明、验收资料与配图

- 仓库根目录的 [README.original.md](../README.original.md) 保留上游原说明；[DESIGN.md](../DESIGN.md) 保留 V0.3.0 设计语境；[CHANGELOG.md](../CHANGELOG.md) 保留版本历史。它们不替代当前 README 和本索引。
- [verification/README.md](../verification/README.md) 是历史验收资料入口；目录中的 Markdown 记录继续作为历史证据保存，不能据此推断当前源码全部通过。
- [媒体索引](media/README.md)、[V0.2.0 配图索引](media/v0.2.0/README.md)和[设计图索引](media/v0.2.0/design/README.md)介绍各自截图与示意图的历史背景。
- 仓库还保留四个 JSON 验证记录：`SONY-CRELU-VERIFICATION.json`、`SONY-PHASE-VERIFICATION.json`、`SONY-X86-VERIFICATION.json` 和 `WINDOWS-ENHANCED-VERIFICATION.json`。它们是设备/机器验证证据，不是通用测试输入；公开源码导出前须单独审核，本索引不复述其内容。

## 来源和许可

代码、依赖、模型、字体、商标和演示素材适用范围不同。请先读仓库根目录的 [NOTICE](../NOTICE.md) 与 [LICENSE](../LICENSE)；公开源码不表示 NOTICE 中所有资源都可公开再分发。
