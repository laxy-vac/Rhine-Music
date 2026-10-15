# 当前音频核心实现

更新：2026-10-16。本文描述当前架构/能力，历史专项证据见 [2026-10-10修复报告](AUDIO-CHAIN-FIX-REPORT-2026-10-10.md)，当前进度/授权见 [状态](PROJECT-STATUS.md) 与 [AGENTS](../AGENTS.md)。界面检查与真实音频设备验收分别报告。

## 处理与线程

普通PCM：libFLAC/FFmpeg解码 → 预分配double解码SPSC → PCM生产者（RG/音调/EQ、SRC、曲间处理）→ double设备块SPSC → 有限消费/最终音量/唯一量化/容器打包 → WASAPI或ASIO。

Sony路线使用自己的处理管道/缓存，再接PCM后段；其Float32输入/输出与未知内部精度据实报告，不宣称全程double。RAW/DoP有独立可取消读取生产者与RtDsdBuffer，不经过普通PCM DSP。

SPSC单生产/单消费，release/acquire发布，双方停止后才reset；文件、复杂DSP、FFT/JSON和控制不进常规设备提交回调。控制/COM/第三方驱动仍可能阻塞，不宣称整个音频线程硬实时。

## 模块

| 层 | 当前入口 |
| --- | --- |
| 配置/Poweramp/Rhine备份 | src/audio-processing-model.mjs及声明 |
| 设置/EQ/预设 | src/music-app.ts、eq-controls.ts、lsp-eq-controls.ts |
| 播放适配 | src/native-audio.ts、music-player.ts |
| 服务/会话 | scripts/music-server.mjs、native-output.mjs |
| 主机/PCM队列 | native/audio-host.cpp、pcm-engine.h |
| 标准DSP/SRC | native/pcm-processing.h、pcm-resampler.h |
| Windows/DSD | native/wasapi-output.h、ASIO实现、dop-packing.h |
| 官方LSP | native/lsp-clap-host.h |
| 实际链路显示 | src/audio-info.ts |

## 解码与SRC

FLAC及识别出的Ogg FLAC直用libFLAC；其它通用PCM由FFmpeg本地文件解码，不保留BASS通用PCM回退。BASS的DSD/ASIO用途独立保留，不借此删依赖。

整数16/24/32有效位可精确归一化到double，Float32扩展、Float64保持；不能据此猜解码器内部运算精度。渐进Sony缓存保留专用WAV reader；未知精确帧数的Sony输入先完整解码计数，不用估算时长硬截尾。

PCM处理在实际输入率域，之后SRC；可选SoX/libsoxr双精度HQ/VHQ与通带、r8brain及快速插值。设备提交率8–768kHz含705.6/768选项，实际设备须接受，不静默降率。LSP输入上限384kHz与后级SRC输出上限是两回事。

## EQ、音调与保存

- EQ专页集中均衡器开关/参数、预设管理及独立低音/高音区；设置 → 音频不再挂载这些控件。音调共用自己的启用开关，与EQ开关独立；默认低音80 Hz、高音8000 Hz、Q均为0.707、增益均为0 dB。原生处理在0 dB时跳过对应滤波，开关开启但保持默认参数与关闭等效；关闭只停用，不清空参数。
- 入门EQ：图形5–32段、统一带宽；参数模式独立频率/Q/类型/声道/启停/锁定/增删。
- 图形推子/曲线只改增益；参数卡横向浏览，频率/Q旋钮及数值可直接输入，参数曲线只读。
- 频响在控件下方随整页滚动；总响应与单段分开，关闭EQ仅预览配置。
- 图形q=0按完整邻频对数间距估带宽，0.5–2倍；标准RBJ/iir1响应不保证与Poweramp逐点一致。
- Poweramp导入保留原件文本/精度和明确模式映射；音调独立，导入不自动开启。无新增压限器。
- 工作状态、命名EQ预设和模式银行分别保留；Rhine备份默认作为EQ预设导入，完整恢复需明确操作，不改后端/设备。
- 预设/模式银行保存在profile旁`presets/eq/audio-processing-presets.json`，独立于服务端口；新文件缺失时兼容读取旧`profile/audio-processing-presets.json`，下一次用户保存才写新位置。串行原子保存，损坏/外部替换拒绝覆盖，不删源导入文件；本次界面迁移不改变保存机制。
- LSP进阶是固定官方Float32 CLAP原生独立窗，完整pluginState保存，旧DSP-only字段仅兼容，见 [LSP](LSP-ADVANCED-EQ.md)。

## 播放与输出边界

WASAPI兼容PCM可预载/连续交接/自动手动交叉渐变/曲间停顿，不同源率混音需共同目标率；follow不偷偷改率。身份/位置按实际消费span更新。匹配IIR状态可延续，逐轨SRC排空不等于跨文件整段逐样本一致。

ASIO共用DSP/SRC/量化，但当前不宣告其队列/交叉渐变。LSP编辑期间等条件会临时停预载；Sony/DSD不预载未经支持的原始PCM。稳定格式热更新保留时间轴，结构/延迟变更可重开，失败保留/恢复旧状态。

WASAPI原生Core Audio共享/独占，ASIO使用现有BASSASIO；设备ID与ASIO编号独立。设备/率/格式拒绝时明确报错，不静默换设备/模式。暂停保留设备，停止/结束/错误/退出释放。

ASIO有效整数位右对齐，WASAPI整数容器按Windows有效位规则左对齐。浮点可保留>0dBFS余量，整数在最终编码饱和，状态区分overRange/clipping/peak。共享系统混音格式不等于DAC内部格式。

## 受控PCM纯输出

一键纯输出派生临时effective设置，暂停Sony/EQ/音调/RG/SRC/数字音量/抖动/淡变/混音，保留源率与unity gain。WASAPI临时独占，关闭恢复保存偏好，不要求用户永久改独占。

资格来自实际解码器的无损整数16/24/32有效位，允许无损零填充扩容器；拒绝有损/浮点解码/DSD转PCM/Sony缓存或不足有效位的输出。当前不预载混音。

整数打包前后数值/格点校验仅显示等待/一致/不一致；缺计数不假称通过。它覆盖本地提交边界，不认证解码器、驱动、USB或DAC，也不保证原文件padding字节相同。

## DSD与DoP

WASAPI共享只转PCM，独占可DoP；ASIO独立pcm/native/dop配置。DoP是DSD载荷加PCM整数传输容器，不是转PCM音乐，不做普通DSP/数字音量/淡变。精确率、有效24位、marker/idle连续；ASIO Float32 DoP明确拒绝。

DSF/未压缩DFF受支持，DST压缩DFF不冒充支持。位流与PCM频谱/缓存分开。软件封装/路由检查不等于DAC接收，见 [DSD](DSD-PLAYBACK.md)。

## 界面、组件与证据

音频浮层默认实际链路，按音轨/解码/处理/音量/输出/设备显示；区分源位深、实际处理边界和提交格式。未知内部精度集中到关于，不把软件Float64说成设备位深或输出回环认证。

组件来源/哈希/许可在vendor/audio/codec-components.json、open-components.json、lsp-plugin/manifest.json；固定SDK/许可提交，运行库/工具/缓存只在.tools。不新装环境或自动准备组件。

2026-10-10专项报告有其离线/数值/回调/默认设备PCM静音证据；后续LSP与模型改动没有自动获得全硬件验收。当前ASIO/DSD/DoP、768kHz真实输出、长文件/复杂切换及LSP整体验收仍有限。构建/启动与报告索引见 [本地开发](LOCAL-DEVELOPMENT.md)，不把历史命令当新测试授权。
