# 当前项目状态

更新：2026-10-17。本文只记录现行实现状态；下一步见[优化基线](OPTIMIZATION-BASELINE.md)，操作见[本地开发](LOCAL-DEVELOPMENT.md)，工作规则见[AGENTS](../AGENTS.md)。

## 已完成基线

| 区域 | 当前能力 |
| --- | --- |
| 统一架构 | Future/Punk 共用应用状态、目录、视图、播放和 ArchiveScene/WebGL；共享资源与生命周期，保留主题皮肤及兼容偏好读取 |
| 专辑浏览 | ARRAY / MATRIX / GRID、SHOW / GROUP / SORT、筛选与分页；打开、播放、返回和非首曲身份保持一致 |
| STYLE 外观 | 两主题保留原 Style 视觉与预览；仅调整主题、日夜配色、主题色、文字字号、盒体与场景外观。内部页面值仍为 `theme` |
| Settings | 固定七类：界面与交互、显示与性能、歌词、音频、音乐库、音乐来源、关于；界面与交互默认打开，各项控件只在所属类别出现一次 |
| 显示与性能 | 窗口比例、全屏、渲染画质、优先显卡和性能检测集中在 Settings；减少动态与唱片波动位于界面与交互 |
| 物理显卡身份 | DXGI 逻辑适配器按物理 PnP 身份归并；偏好同时保存稳定物理身份及会话 LUID，旧偏好只按精确别名迁移，不按型号猜卡 |
| 播放栏 | 统一上一曲、播放/暂停、下一曲、停止，SHUFFLE ALL 与七种 ORDER；进度上方显示当前歌词，不重复显示 DSP OFF |
| 歌词 | 首次云端解析、Local/Cloud 真切换、缺本地回退云、手动导入、副本缓存、独立偏移写回、默认跟随播放 |
| 歌词与信号展示 | 当前行、盒体与播放资料同步；32 段真实频谱的帧间平滑和需求生命周期；独立信号页 |
| EQ | 入门图形/参数界面、曲线、频段图例、推子和主题控件；LSP 采用官方 CLAP 原生窗口 |
| 设置与弹窗 | Future 昼夜控件、焦点和光效统一；搜索/在线曲库固定标题、内部细滚动条、自绘下拉与紧凑分区 |
| 唱片盒体 | Future 简单/精细/Punk 拓展与 Punk 自有盒体；编辑、独立预设、铭牌、格式标识和纸面遮挡 |
| 启动 | 后台初始化及首帧就绪后首次显示窗口；Future ALBUMS/MATRIX 每次打开播放可跳过的入场；欢迎文案/ID 可自定义并限制字母、空格与长度；Punk 保留待适配的禁用入口；已显示窗口重载保持可见 |
| 音频与来源 | 本地/FTP/在线专辑，PCM/DSD/DoP 输出与处理，Sony 音效、音频信息及明确的设备错误 |
| 界面音效与释放 | Future 按参考接入入场与交互音序、方向声像和十声部尾音叠加，跟随播放器输出，音乐播放期间静音，Punk 禁用待设计；暂停、停止、结束及错误后关闭音乐设备，暂停保留准确进度以供重开恢复 |

缓存更新、封面闪烁、隐藏启动无窗口、EQ 图例裁切和本轮界面反馈已关闭，不再列为“待确认”问题。版本、旧分支和历史测试结果不承担当前状态说明。

## 后续工作

下一步是启动与运行性能测量、RTX 5080 掉帧定位，以及按用户后续参考划分其他主题/排列的入场。具体范围、现有证据和验收口径统一维护在[优化基线](OPTIMIZATION-BASELINE.md)，不在多份文档重复排期待办。

当前音频精度、LSP 输入率及复杂实时处理的能力边界见[音频实现](AUDIO-CORE-IMPLEMENTATION.md)和[LSP](LSP-ADVANCED-EQ.md)。未知的驱动/DAC 内部信息不视作已修复缺陷，也不伪造测量结果。

## 验证口径

当前已通过 TypeScript/Vite 构建、运行模块图检查和 24 项显卡身份/偏好离线检查（含两项保存并发守卫）。隔离真实窗口已确认七类 Settings、两主题 STYLE 页面、原生全屏往返、物理显卡去重与手动启动，以及动效/画质互不覆盖。36 张合成专辑的入场回归包含自然播放约 25.36 秒、跳过、重播、文案/ID 边界、十次首帧就绪与重载、分类归属和 Punk 禁用入口。此范围不表示个人硬件性能已优化，也不替代设备安装或发布验收。

收集截图时仅测试进程采用避免遮挡的调度选项，并在首帧就绪后临时维持绘制、结束前恢复；原生隐藏启动与重载另由不覆盖绘制时钟的启动探针检查。合成目录和截图检查不等于个人曲库、真实设备或硬件性能测量。

当前本机隔离调查发现四个 DXGI/KMT 逻辑 LUID 全部对应同一个物理 PnP 设备，合并后为一张 RTX 5080；SetupAPI 从物理设备节点读取的位置为 PCI 1:0.0，DXGI 报告显存 16,753,098,752 字节（15.6 GiB）。原逻辑地址 `0:0.1` 与越界值不代表物理 PCI 位置。该映射修正设备身份，不构成掉帧修复结论；性能测量仍列在[优化基线](OPTIMIZATION-BASELINE.md)。

当前源码与此前 `0.3.1-preview.1` 安装器各有自己的快照；源码修复不会自动更新旧安装器。未重新打包、安装或发布。

Future 音效通过 51 项播放器/适配器/原生会话模拟检查、16 项混音/路由/取消检查及 39 项 Electron 离线合成与生命周期检查；6 项硬件检查明确跳过。全部 17 类参考音色均生成不同的非静音 PCM WAV，原生音效路径的 AudioContext 创建数为零；既有原生解码器的无输出模式也已逐样本验证渐进 Float32 输入。Future/Punk 昼夜滑杆填充、拖动、键盘、数字编辑/去重和禁用态均经隔离窗口检查；入场自然播放约 25.36 秒并停在总览，跳过、重播和十次首帧就绪/重载通过。参考触发映射见[界面音效](INTERFACE-AUDIO.md)。上述结果不包含真实设备听音验收。

## 源码地图

| 职责 | 首选入口 |
| --- | --- |
| 应用编排、路由、偏好 | `src/music-app.ts` |
| 公共状态、目录、展示 | `src/music-application-state.ts`、`src/music-catalog.ts`、`src/music-catalog-markup.ts` |
| 场景、布局、货架和资源 | `src/scene.ts`、`src/music-spatial-layout.ts`、`src/music-shelf.ts`、`src/music-scene-resources.ts` |
| 专辑、队列和焦点 | `src/album-panel.ts`、`src/album-interaction.ts`、`src/album-queue.ts` |
| 主题和盒体 | `src/music-style.ts`、`src/case-model.ts`、`src/case-editor.ts`、`src/future-*.css`、`src/punk-*.css` |
| 歌词、频谱与信号 | `src/lyrics-page.ts`、`src/lyrics-settings.ts`、`src/signal-page.ts` |
| EQ、音频与服务 | `src/eq-controls.ts`、`scripts/music-server.mjs`、`scripts/native-output.mjs`、`native/audio-host.cpp` |
| 窗口和启动 | `desktop/main.cjs`、`desktop/preload.cjs`、`scripts/launch-source-preview.mjs` |
| 隔离质量检测 | `src/quality-detection.ts`、`quality-benchmark.html` |

规范见[文档索引](README.md)，资源权利见[NOTICE](../NOTICE.md)。
