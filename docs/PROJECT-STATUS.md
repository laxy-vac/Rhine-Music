# 当前项目状态

更新：2026-10-17。本对话目标已由用户确认全部完成。本文只记录现行状态；下一步见[优化基线](OPTIMIZATION-BASELINE.md)，操作见[本地开发](LOCAL-DEVELOPMENT.md)，工作规则见[AGENTS](../AGENTS.md)。

## 已完成基线

| 区域 | 当前能力 |
| --- | --- |
| 统一架构 | Future/Punk 共用应用状态、目录、视图、播放和 ArchiveScene/WebGL；共享资源与生命周期，保留主题皮肤及兼容偏好读取 |
| 专辑浏览 | ARRAY / MATRIX / GRID、SHOW / GROUP / SORT、筛选与分页；打开、播放、返回和非首曲身份保持一致 |
| 主题与日夜 | 两套主题独立外观；全局日夜不随主题变化；系统跟随按真实状态变化同步，保留手动选择与重启状态 |
| 播放栏 | 统一上一曲、播放/暂停、下一曲、停止，SHUFFLE ALL 与七种 ORDER；进度上方显示当前歌词，不重复显示 DSP OFF |
| 歌词 | 首次云端解析、Local/Cloud 真切换、缺本地回退云、手动导入、副本缓存、独立偏移写回、默认跟随播放 |
| 歌词与信号展示 | 当前行、盒体与播放资料同步；32 段真实频谱的帧间平滑和需求生命周期；独立信号页 |
| EQ | 入门图形/参数界面、曲线、频段图例、推子和主题控件；LSP 采用官方 CLAP 原生窗口 |
| 设置与弹窗 | Future 昼夜控件、焦点和光效统一；搜索/在线曲库固定标题、内部细滚动条、自绘下拉与紧凑分区 |
| 唱片盒体 | Future 简单/精细/Punk 拓展与 Punk 自有盒体；编辑、独立预设、铭牌、格式标识和纸面遮挡 |
| 启动 | 后台初始化及首帧就绪后首次显示窗口；旧加载画面与 Punk intro 已移除；已显示窗口重载保持可见 |
| 音频与来源 | 本地/FTP/在线专辑，PCM/DSD/DoP 输出与处理，Sony 音效、音频信息及明确的设备错误 |

缓存更新、封面闪烁、隐藏启动无窗口、EQ 图例裁切和本轮界面反馈已关闭，不再列为“待确认”问题。版本、旧分支和历史测试结果不承担当前状态说明。

## 后续工作

下一步是启动与运行性能测量、RTX 5080 掉帧定位，以及重新设计统一入场。具体范围、现有证据和验收口径统一维护在[优化基线](OPTIMIZATION-BASELINE.md)，不在多份文档重复排期待办。

当前音频精度、LSP 输入率及复杂实时处理的能力边界见[音频实现](AUDIO-CORE-IMPLEMENTATION.md)和[LSP](LSP-ADVANCED-EQ.md)。未知的驱动/DAC 内部信息不视作已修复缺陷，也不伪造测量结果。

## 验证口径

本轮通过 TypeScript/Vite 构建、相关离线检查及真实生产前端的隔离 Electron/图形检查；用户已确认本对话目标完成。合成目录、模拟音频端口和截图检查不等于个人曲库、真实设备或硬件性能测量。

当前源码与此前 `0.3.1-preview.1` 安装器各有自己的快照；源码修复不会自动更新旧安装器。未重新打包、安装或发布。

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
