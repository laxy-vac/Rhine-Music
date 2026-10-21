# 文档入口

文档只承担一种职责：状态、操作、后续工作或专项契约。已结束的阶段计划、逐轮修复战报和旧版界面审计从 Git 追溯，不再混入当前阅读顺序。

## 接手顺序

1. [PROJECT-STATUS](PROJECT-STATUS.md)：当前已完成能力与源码地图。
2. [OPTIMIZATION-BASELINE](OPTIMIZATION-BASELINE.md)：启动与运行性能目标、测量口径和保护点。
3. [LOCAL-DEVELOPMENT](LOCAL-DEVELOPMENT.md)：构建、启动、数据和检查入口。
4. [AGENTS](../AGENTS.md)：工作规则与产品保护点。

## 架构与产品

| 文档 | 职责 |
| --- | --- |
| [UNIFIED-ARCHITECTURE](UNIFIED-ARCHITECTURE.md) | 现行共享状态、目录、渲染与主题边界 |
| [THEME-PAGE](THEME-PAGE.md) | 主题、日夜、浏览、盒体、控件与动作契约 |
| [METADATA-EDITOR](METADATA-EDITOR.md) | 专辑介绍与歌曲标签编辑、保存位置、冲突处理和检查入口 |
| [LYRICS](LYRICS.md) | 来源选择、双 bank 缓存、导入、偏移和频谱 |
| [SIGNAL-PAGE](SIGNAL-PAGE.md) | 信号模式、真实音频数据与采样边界 |
| [UI-LANGUAGE](UI-LANGUAGE.md) | 中英界面与两主题共同保留词 |
| [ONLINE-LIBRARY](ONLINE-LIBRARY.md) | 在线来源、接口、联网与本地保存规则 |
| [HI-RES](HI-RES.md) | 格式标识与真实源数据判定 |

## 音频与来源

| 文档 | 职责 |
| --- | --- |
| [AUDIO-CORE-IMPLEMENTATION](AUDIO-CORE-IMPLEMENTATION.md) | 当前解码、处理链与输出实现 |
| [INTERFACE-AUDIO](INTERFACE-AUDIO.md) | Future 参考音效、触发映射、入场时钟与互斥规则 |
| [LSP-ADVANCED-EQ](LSP-ADVANCED-EQ.md) | 官方原生 EQ 窗口与能力边界 |
| [DSD-PLAYBACK](DSD-PLAYBACK.md) | DSD / DoP 独立链路 |
| [SONY-WALKMAN](SONY-WALKMAN.md) | Sony 组件来源、适配与许可边界 |
| [SONY-AUDIO-MEASUREMENTS](SONY-AUDIO-MEASUREMENTS.md) | 限定输入的参考测量，非当前设备性能验收 |
| [WASAPI-STABILITY](WASAPI-STABILITY.md) | 稳定性检查方式与参考记录 |
| [FOOBAR-STYLE-SOURCES](FOOBAR-STYLE-SOURCES.md) | Punk 主题来源和移植边界 |
| [NOTICE](../NOTICE.md) | 署名、资源与第三方许可 |

## 交付及上游资料

[PREVIEW-RELEASE](PREVIEW-RELEASE.md)说明既有品尝版的安装、数据与卸载；[CHANGELOG](../CHANGELOG.md)保留简明版本节点。它们不替代当前源码状态。

[README.original](../README.original.md)、[PWA](PWA.md)、[媒体来源](media/README.md)保留上游或素材语境，不作为当前 Windows 开发入口。旧报告的恢复方式见[本地开发](LOCAL-DEVELOPMENT.md)。
