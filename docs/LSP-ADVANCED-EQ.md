# 当前LSP进阶EQ

更新：2026-10-14。当前方案是**固定官方CLAP插件的原生独立窗口**。自绘DSP-only、内嵌、整页自动打开和Rhine原生主题/中文覆盖均已撤回，不是待续功能。状态见 [全局交接](PROJECT-STATUS.md)。

## 使用与状态

EQ页“简单入门”保持图形/参数界面；切到“LSP · 进阶”后手动点“打开LSP原生面板”。处理引擎互斥、参数独立保存，EQ主开关与窗口显隐分开，关窗不自动停EQ。

播放时窗口与PCM处理共用插件实例；无活动LSP处理时使用不打开音频设备的编辑实例，可见时零输入更新曲线。离页/切引擎先取最终状态再关窗；保存/另存为/导出主动同步，不只依赖轮询。

完整不透明CLAP状态存eq.lsp.pluginState（有界base64），随工作状态、本机预设、撤销和Rhine备份保存。旧自绘eq.lsp字段仅兼容保留，不能描述当前插件算法或把旧Poweramp字段自动映射成官方参数。

## 固定组件与精度

- 插件ID：`in.lsp-plug.para_equalizer_x32_stereo`。
- 套件1.2.35、PEQ模块1.0.40、CLAP头1.2.6；版本/哈希以vendor/audio/lsp-plugin/manifest.json及实际运行库清单为准。
- 只加载清单校验的固定lsp-para-equalizer.clap及同目录WGL DLL，不扫描任意插件。
- 实际DSP为Float32，最高输入384kHz；不标Float64，不静默把更高输入截低。后级SRC仍可输出768kHz。
- 使用上游generic DSP核和有记录的dispatch兼容补丁，不能冒充官方SIMD优化构建。公共库CPU初始化/内存辅助单独编译不等于DSP已SIMD化。
- 固定来源归档不改；工具、补丁和前后哈希可溯源。插件/工具/许可不改授项目MIT。

## 生命周期与音频

native/lsp-clap-host.h管理工厂、端口、Float32平面缓冲、Win32父窗口、状态流与延迟。窗口/状态/插件生命周期在专用消息线程，DSP在PCM生产者；不在设备输出回调执行插件、文件I/O或复杂控制。

当前上游wrapper reset为空，seek/reset据保存状态重建实例。算法/延迟变化可在可听位置重开，失败尝试恢复；首部补偿/曲尾排空仍由PcmEngine管理。打开编辑器会丢弃旧参数预载、暂缓预载/交叉混音；关闭后重新准备。

暂停时零输入曲线刷新会改变内部历史，恢复播放按可听位置重开；页面销毁等待未完成打开请求并最终关闭，避免孤立窗口。DSD位流和纯输出不进LSP。Float32转回double缓冲不恢复已丢精度。

## 构建与落点

| 内容 | 位置 |
| --- | --- |
| 来源/工具/补丁清单 | vendor/audio/lsp-plugin |
| 准备/构建 | scripts/prepare-lsp-plugin.mjs、scripts/build-lsp-plugin.mjs |
| 工具/源码工作副本/运行库 | .tools/lsp-plugin |
| 原生源码预览运行副本 | .tools/source-preview-native-audio |
| 插件本机偏好 | .tools/lsp-plugin/user-data/lsp-plugins |

复用已有Zig及项目内已准备GNU/MSYS2工具；PHP未安装、文档构建关闭。普通构建不下载。缺工具须按授权规则处理，不把旧准备记录当新安装许可。

native主机和界面联合构建入口见 [本地开发](LOCAL-DEVELOPMENT.md)。源码清单检查CLAP/WGL与宿主指纹，不能只换DLL放宽验证。旧retired-ui-checkout副本留作溯源，不借整理删除。

## 已验证与待验收

恢复官方独立窗阶段（checkpoint/lsp-popup-restored）已完成插件、宿主、TypeScript/Vite构建与来源/缓存检查；本轮主题/模型检查没有重新验收LSP。

实际面板开关、参数保存/重启、引擎切换、暂停/seek/切歌、高延迟算法、不同DPI和复杂设备行为仍未全面运行验收。没有新授权不自动补测；旧音频报告不作为当前LSP证明。

历史实现可用Git查看checkpoint/lsp-advanced-eq、checkpoint/lsp-native-panel和checkpoint/lsp-popup-restored。回滚审阅依赖后git revert、按对应版本重建，不重置预设；运行库退役仅在明确任务中审查显式入口。
