# 当前项目状态

更新：2026-10-22。当前源码为本仓库 `main`，版本号仍为 `0.3.1-preview.1`。保留 `435e404` 对应的性能优化；浏览镜面反射改用预计算宽幅柔光环境，实时灯保留原漫反射和阴影，Future 单独调整夜间明暗分布，Punk 盒顶白条及显示适配已移除。ARRAY/MATRIX 各自原主光方向保留，MATRIX 仍为左侧来光；极致画质、Punk 模型、材质参数和镜头动效保留。本次外观修复未做性能增益声明。

## 当前交付边界

- 2026-10-19 三项结构性性能优化已完成：封面驻留与高分辨率快照共享、主画面/阴影各自裁剪与深度复用、ARRAY 视觉提交与元数据 fit 缓存。相同极致/Punk 的逐项 FPS、P95/P99、GPU 计时及像素/身份检查见 [OPTIMIZATION-BASELINE](OPTIMIZATION-BASELINE.md#三项结构性优化2026-10-19-已完成)；平均 120 FPS 仍未达到。
- 主场景追加优化已收束：20 个方向评估后保留标签驻留、共享实例变换、同帧视窗测量和 MATRIX 保守部件裁剪；平均 120 FPS 尚未达到。最终三轮累计对照、GPU 分项、有限封面/设置/开返检查见 [OPTIMIZATION-BASELINE](OPTIMIZATION-BASELINE.md#主场景优化最终保留版本2026-10-19)。帧生成暂缓，未降低画质或改变盒体设置表现。


- MATRIX 标签缓存已完成隔离前后测量和标签像素检查；剩余性能工作见 [OPTIMIZATION-BASELINE](OPTIMIZATION-BASELINE.md)。
- Future/Punk 共用宽幅柔光环境反射，实时聚光与补光只负责原有漫反射，避免在壳体、清漆和 sheen 上叠加点状镜面高光。纸面保持原 Lambert 印刷材质，粗糙度、金属度、清漆及透光设置保留。Future 夜间降低全局铺光，只对反射光加强选片视窗与暗部的层次；Punk 保留自己的夜间环境和配色。灯位仅随既有布局转换进度变化，MATRIX 浏览对焦点仍固定。
- 当前入场与 ARRAY/MATRIX 桥接保留。Punk 顶屏白条、扫描显示、挂载适配、转场接线和专用纹理分配已移除，独立编号铭牌保留；不主动重新设计或移植 Punk 入场。
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
| 盒体 | Future 简单/精细/Punk 拓展与 Punk 自有盒体；简单款玻璃透光/磨砂可调，封面和金边独立；Punk 前玻璃封合和实体内板保留，顶部无显示白条 |
| 入场 | Future ALBUMS 的 MATRIX/ARRAY 共用终端前导，各有场景段，可跳过/重播；欢迎文案/ID 受字母、空格及长度限制；Punk 入场暂缓 |
| 音频 | 本地/FTP/在线来源、统一播放栏、PCM/DSD/DoP、EQ、Sony 音效和官方 LSP 原生窗口 |
| 歌词与信号 | Local/Cloud 双 bank、独立偏移、导入保护、跟随播放及真实频谱；Future 界面音效跟随播放器输出，音乐播放时静音，Punk 禁用 |

主题与几何契约见 [THEME-PAGE](THEME-PAGE.md)，状态/目录边界见 [UNIFIED-ARCHITECTURE](UNIFIED-ARCHITECTURE.md)，数据及音频规则见各专项文档。

## 性能事实与未知

- 本机此前枚举的四个 DXGI/KMT 逻辑 LUID 对应同一张物理 RTX 5080，位置 PCI 1:0.0，报告显存约 15.6 GiB；本轮 Electron 已确认实际使用 RTX 5080。
- 在极致/Punk、2560×1440 窗口和 3840×2160 渲染缓冲的隔离合成曲库中，三轮有效 MATRIX 拖动的合并平均帧间隔从 213.2ms 降至 26.5ms，P95 从 322.1ms 降至 116.6ms。模型绘制调用数和三角形提交量未变；28 组检查中标签像素、UV/页码与徽标身份一致。详细条件与局限见优化基线。
- 标签按显示编号复用既有分辨率图块，物理槽位换位只更新 UV/页码。缓存容量受原实例池限制，不淘汰仍被引用的图块；选中标签及 outgoing 快照继续使用独立纹理。
- 剩余长帧仍可见，封面驻留命中已避免重复绘制/复制，当前独立 GPU 诊断的主要成本在包含阴影与透射的主场景渲染。个人曲库/材质预设、完整启动阶段和整机资源基线尚未覆盖，不能将旧 ready 时间或屏幕 FPS 当成这些结论。
- 现有质量建议使用合成场景；`ArchiveScene.stats().frameTime` 是场景累计时钟，不是单帧耗时。

## 源码地图

| 职责 | 入口 |
| --- | --- |
| 应用接线、路由和偏好 | `src/music-app.ts` |
| 公共状态与目录 | `src/music-application-state.ts`、`src/music-catalog.ts`、`src/music-catalog-markup.ts` |
| 主场景及资源 | `src/scene.ts`、`src/music-scene-resources.ts`、`src/music-shelf.ts`、`src/music-spatial-layout.ts` |
| 镜头、桥接和升沉 | `src/music-layout-flight.ts`、`src/music-layout-framing.ts`、`src/music-layout-transition.ts`、`src/music-layout-rise.ts`、`src/music-layout-addresses.ts` |
| 模型、材质与图集 | `src/case-model.ts`、`src/case-materials.ts`、`src/rhine-album-info.ts`、`src/cover-atlas.ts` |
| 画质与合成测量 | `src/render-quality.ts`、`src/quality-detection.ts`、`src/quality-benchmark-frame.ts`、`quality-benchmark.html` |
| 桌面、启动和服务 | `desktop/main.cjs`、`desktop/preload.cjs`、`scripts/launch-source-preview.mjs`、`scripts/music-server.mjs` |
| 歌词、信号与音频 | `src/lyrics-page.ts`、`src/signal-page.ts`、`src/eq-controls.ts`、`scripts/native-output.mjs`、`native/audio-host.cpp` |

运行操作见 [LOCAL-DEVELOPMENT](LOCAL-DEVELOPMENT.md)，后续工作只在 [OPTIMIZATION-BASELINE](OPTIMIZATION-BASELINE.md) 维护。历史代码和已跟踪文档只在 Git 中按需追溯，不作为当前接手材料。
