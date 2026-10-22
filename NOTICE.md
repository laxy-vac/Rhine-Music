# 版权、署名与资源来源

本说明区分代码授权、音乐适配的开发者署名和第三方素材的权利。公开源码不表示放弃版权，也不表示获得全部原作素材的再授权。

项目结构与构建入口见[开发接手指南](docs/DEVELOPMENT.md)。

本说明沿用直接参考项目 [gamesding/Rhine-Music-AudioEnhanced 的版权说明](https://github.com/gamesding/Rhine-Music-AudioEnhanced/blob/main/NOTICE.md)，并按当前实际使用的组件补充来源。上游署名和第三方原始许可证继续保留；本项目不为第三方内容补授权。

## 开发者与上游

| 范围 | 署名与来源 |
| --- | --- |
| 音乐播放器适配及后续修改 | **Copyright (c) 2026 RonaldDeng**。包括本地曲库与播放服务、音乐专辑模型适配、音乐界面、导航、相机交互、文字效果、响应式及版本维护中由本项目新增或修改的部分；不主张对未修改的上游代码或第三方素材享有原创权利。 |
| 原版 RhineLabUI | **Copyright (c) 2026 LBEILC**。[原仓库](https://github.com/LBEILC/RhineLabUI)，初始基于提交 [`5abab02367465d9189f4ae65bcb6f17fdb5938f7`](https://github.com/LBEILC/RhineLabUI/tree/5abab02367465d9189f4ae65bcb6f17fdb5938f7)。保留其三维档案界面、渲染与动效基础、建模脚本、资料说明和 Git 历史。 |
| Rhine-Music-Demo | [RonaldDeng / Rhine-Music-Demo](https://github.com/RonaldDeng/Rhine-Music-Demo)，音乐播放器适配、本地曲库、播放服务与音乐界面的上游来源；沿用其已有版权署名，不将其工作改称本项目原创。 |
| Rhine-Music-AudioEnhanced | [gamesding / Rhine-Music-AudioEnhanced](https://github.com/gamesding/Rhine-Music-AudioEnhanced)，直接参考的音频增强版本及版权、署名和资源来源说明。其已有第三方声明与原始许可继续保留。 |
| RhinE / Audio Archive | [ericzhang12111-cell / RhinE](https://github.com/ericzhang12111-cell/RhinE)，主题配色及盒体、货架、地面等设计资源来源；许可署名为 **the Audio Archive authors**，具体固定版本与文件用途见 [美术说明](art/README.md)。 |

有权授权的程序代码、建模脚本和技术文档沿用 [MIT License](LICENSE)，保留以上两项署名。分发代码或其重要部分时须一并保留版权声明及完整许可证；适配者的署名不取代上游署名。MIT 允许使用、修改及商业分发，软件按原样提供；本说明不在 MIT 上另加用途限制。具体以许可证原文为准，参见 [MIT 许可说明](https://choosealicense.com/licenses/mit/)。

上游原始项目说明见 [RhineLabUI README](https://github.com/LBEILC/RhineLabUI/blob/5abab02367465d9189f4ae65bcb6f17fdb5938f7/README.md)。其中“本项目”“原创”等措辞属于上游文档语境。RonaldDeng 不代表 LBEILC；音乐适配不表示上游作者参与、认可或为本衍生版本提供支持。

MATRIX 鼠标拖动、惯性和悬停适配参考上游固定版本的 [archive-drag.ts](https://github.com/LBEILC/RhineLabUI/blob/5abab02367465d9189f4ae65bcb6f17fdb5938f7/src/archive-drag.ts) 与 [scene.ts](https://github.com/LBEILC/RhineLabUI/blob/5abab02367465d9189f4ae65bcb6f17fdb5938f7/src/scene.ts)，沿用其投影与运动参数。两排列之间的迁移及 Future ARRAY 入场后半段为本播放器新增设计，仍使用现有共享场景和盒体资源。

## 原作及非代码资产

视觉参考为《明日方舟》特别映像[「莱茵生命：访问」](https://www.bilibili.com/video/BV1rr4y1b7sz/)。相关作品、名称、标志、设定、视觉设计、原 PV 及其声音的权利归相应权利人所有。本项目是独立爱好者工程，与官方制作方无隶属、赞助或授权合作关系，不主张拥有原作版权或商标。

- `art/*.blend`、`public/assets/*.glb`、界面图标、截图、动图及原作相关演示文本**不因代码采用 MIT 而自动获得原作素材许可**。上游未另行将全部非代码资产声明为 MIT；建模脚本的 MIT 授权也不等于原作相关视觉元素可任意再分发。
- `public/audio/atmosphere.ogg`、`motif.ogg`、`pulse.ogg` 和 `observatory-preview.mp3` 为继承自上游的程序编配，不重新署名为音乐适配者原创。生成入口和数据见 [音频说明](public/audio/README.md)、`scripts/render-audio.mjs` 与 `public/audio/score.json`。它们不含原片录音；依仓库 LICENSE 使用，不改变其中第三方内容的权利。
- `public/audio/typing-preview.wav` 与 `src/typing-samples.ts` 的三个 38ms 短音来自上述原 PV，来源、时间码及处理记录见 [typing-source.json](public/audio/typing-source.json)。**这些采样不属于 MIT 授权范围；来源标注不是原权利人的再分发许可。** 本项目不能为复用者授予相应权利。完整参考视频和原始音频不包含在本仓库中。
- [演示封面](public/demo-covers/README.md)是本项目生成的三张抽象图像，用于封面演示，不冒充真实唱片或音乐库。相关展示不改变字体、模型与原作元素各自的权利。
- 真实歌曲、商业专辑封面、私人曲库索引、缓存和在线介绍不随本仓库及发布包分发。

代码复用者可替换这些资产；使用或再分发涉及第三方权利的内容时，需另行遵守对应许可或取得必要授权。本文件不作“全部资源已获商业授权”的保证。

## 字体与运行依赖

| 组件 | 权利人与许可 | 随包文本 |
| --- | --- | --- |
| MiSans | 小米／Beijing Xiaomi Mobile Software Co., Ltd.，按 MiSans 字体协议随应用原样嵌入；不是 MIT，不将字体作为独立商品或字体包发布 | [署名](public/fonts/NOTICE.txt)、[完整字体协议](public/fonts/MiSans-license.pdf) |
| Three.js | three.js authors，MIT | [three.txt](public/licenses/three.txt) |
| RhinE / Audio Archive 主题 | the Audio Archive authors，MIT；主题盒体、货架/地面图像及相关适配代码按随附许可处理。没有复制 foobar2000 组件 | [原始许可](public/licenses/audio-archive-style-mit.txt)、[资产来源与生成入口](art/README.md) |
| Geist Mono | Vercel, Inc. 与字体作者，SIL Open Font License 1.1；从本地主题包原样嵌入应用，未安装系统字体 | [OFL 原文](public/licenses/geistmono-ofl.txt) |
| Rolling Number | Kit Langton，MIT | [rolling-number.txt](public/licenses/rolling-number.txt) |
| music-metadata | Borewit，MIT | [music-metadata.txt](public/licenses/music-metadata.txt) |
| OpenCC-JS | nk2028，MIT；所用 OpenCC 字典数据另受 Apache-2.0 约束 | [MIT](public/licenses/opencc-js.txt)、[第三方说明](public/licenses/opencc-js-third-party.md)、[Apache-2.0](public/licenses/apache-2.0.txt) |
| basic-ftp | Patrick Juchli，MIT | [basic-ftp.txt](public/licenses/basic-ftp.txt) |
| taglib-wasm 2.4.0 | Charles Wiltgen；TypeScript／JavaScript 代码采用 MIT，包含 TagLib 的 WebAssembly 二进制按包许可采用 LGPL-2.1-or-later。[TagLib-Wasm v2.4.0](https://github.com/CharlesWiltgen/TagLib-Wasm/tree/v2.4.0) 的 `lib/taglib` 子模块指向 [TagLib `deadc2990767dfbda0701e0ab35fdeea653db08f`](https://github.com/taglib/taglib/tree/deadc2990767dfbda0701e0ab35fdeea653db08f) | [完整包许可与附加说明](public/licenses/taglib-wasm-license.txt)、[TagLib 官方 LGPL-2.1 原文](public/licenses/taglib-lgpl-2.1.txt) |
| @msgpack/msgpack 3.1.3（TagLib-Wasm 运行依赖） | MessagePack Community，ISC；[官方仓库](https://github.com/msgpack/msgpack-javascript) | [msgpack.txt](public/licenses/msgpack.txt) |
| LSP DSP 库、LSP Parametric Equalizer、插件框架、界面工具包和 Windows 图形模块 | [LSP Plugins contributors](https://github.com/lsp-plugins)，LGPL-3.0-or-later；独立 DLL / CLAP 及其对应源码、构建补丁保留原许可 | [基础库来源清单](vendor/audio/lsp/manifest.json)、[插件来源清单](vendor/audio/lsp-plugin/manifest.json)、[完整许可与说明](vendor/audio/lsp-plugin/LICENSES.md) |
| CLAP 1.2.6 API 头文件 | Alexandre BIQUE 与 [free-audio / CLAP contributors](https://github.com/free-audio/clap)，MIT | [CLAP LICENSE](vendor/audio/lsp-plugin/clap/include/clap/LICENSE) |

这些文本保留依赖包原文；TagLib LGPL 文本对应上游 `taglib/taglib` 仓库的 `COPYING.LGPL`。完整版本树见 `package-lock.json`；其他构建工具和间接依赖按各自的 LICENSE / NOTICE 使用，不被本项目重新授权。

包含该 WASM 二进制的分发物须遵守 LGPL-2.1-or-later，提供对应源代码、修改和构建信息及用户使用修改版本的途径。TagLib-Wasm 2.4.0 与上述 TagLib 提交是本版本的对应来源；npm 包本身不含完整 TagLib 源码。便携包中的 `resources/app/node_modules/taglib-wasm/` 保留为独立文件，用户可在退出播放器后替换自己构建的兼容版本。Release 的第三方源码附件和组件清单提供对应的源码及构建资料；TagLib 不由项目 MIT 重新授权。

仓库含有九个 Sony 原版音频运行文件、模型、参数及其派生转写，位置见 `vendor/sony-walkman/`、`native/sony/` 与组件清单。这些内容不是 MIT 授权，也不因其位于公开源码仓库而取得再分发许可。此前对本机私有副本的使用授权不等于公开发布授权；公开仓库或安装器包含这些文件前，须另行确认相应权利，或在获准范围内移除它们。用户提供的 `art/DSEE_LOGO.avif`、`art/S-MASTER.webp`、`art/vinyl.png` 及描摹的 `public/audio-tech/*.svg` 保留原权利；Sony 标志不表示本项目获 Sony 认证。Sony 文件来源与生成构建入口见 [native/sony/README.md](native/sony/README.md) 和 [组件清单](scripts/sony-walkman/assets.json)。

Sony 音效由 `Sony Corporation` 提供。DSEE、S-MASTER 是 `Sony Corporation` 的商标。

© 2026 Sony Corporation

`native/sony/generated/` 是根据 Sony 原版 ARM 指令生成的 C++ 转写；原模型、参数和相关派生代码不改授 MIT。Windows 播放使用 `sony-dsp-x86.dll`；Unicorn 2.1.4 用于原 ARM 参考路径，内核适用 GPL-2.0，wheel 元数据将 Python 绑定声明为 BSD 许可。官方 Unicorn 源码归档及原版 COPYING、LGPL／GLib 说明保存在 `vendor/licenses/unicorn/`。Electron、Python 与 Chromium/Node 运行时许可文本随各自运行时保留；固定下载来源和 SHA-256 见 [runtime-assets.json](desktop/runtime-assets.json)。

Windows PCM 音乐解码使用 FFmpeg，FLAC 使用 libFLAC。FFmpeg 采用固定 BtbN Windows x64 LGPL shared 构建（LGPL-3.0-or-later），libFLAC 1.5.0 采用 Xiph BSD-3-Clause 类许可，libsoxr 0.1.3 采用 LGPL-2.1-or-later；组件不改授本项目 MIT。[固定来源与哈希](vendor/audio/codec-components.json)、[FFmpeg许可](vendor/audio/codec-sdk/licenses/FFmpeg-LICENSE.txt)、[libFLAC许可](vendor/audio/codec-sdk/licenses/libFLAC-COPYING.Xiph)、[libsoxr许可](vendor/audio/codec-sdk/licenses/libsoxr-LICENCE)随相应组件保留。

Windows 的独立 DSD／ASIO 模块使用 Un4seen BASS、BASSASIO、BASSDSD；PCM 解码使用 FFmpeg/libFLAC，不依赖 BASSFLAC/BASSOPUS。随附 Un4seen 组件适用各自的免费非商业使用条款，商业用途需要相应许可；它们不是项目 MIT 许可的一部分，便携版整体不能因此被描述为无条件允许商业分发。原文位于 [licenses](vendor/audio/windows-x64/licenses)。C++ JSON 头使用 nlohmann/json 3.12.0，MIT 文本保留于同目录。上游原生模块来源与固定哈希位于 [assets.json](vendor/audio/windows-x64/assets.json)。

PCM 均衡器与音调使用 [iir1](https://github.com/berndporr/iir1)，保留其 [MIT 许可证与署名](vendor/audio/iir1/COPYING)。高精度重采样使用 [r8brain-free-src](https://github.com/avaneev/r8brain-free-src) 7.6，Copyright (c) 2013–2026 Aleksey Vaneev，保留其 [MIT 许可证](vendor/audio/r8brain/LICENSE)。Sample rate converter designed by Aleksey Vaneev of Voxengo. 固定提交、来源与逐文件 SHA-256 记录于 [open-components.json](vendor/audio/open-components.json)；采用 Ooura FFT 头文件实现，未引入 PFFFT。源码随本地 Git 记录保存，后续分发音频主机时须同时保留上述许可证。

iir1 的上游致谢同时保留 Vinnie Falco 的 [DSPFilters](https://github.com/vinniefalco/DSPFilters) 工作。r8brain 中的 FFT 来自 **Copyright (c) 1996–2001 Takuya Ooura** 的 [FFT package](https://www.kurims.kyoto-u.ac.jp/~ooura/fft.html)，其原始许可及修改说明保留在 [fft4g.h](vendor/audio/r8brain/fft/fft4g.h)。

构建与美术工具包括 [TypeScript](https://github.com/microsoft/TypeScript)、[Vite](https://github.com/vitejs/vite)、[Prettier](https://github.com/prettier/prettier)、[Zig](https://ziglang.org/)、[Blender](https://www.blender.org/)、[Python](https://www.python.org/)、[Sharp](https://github.com/lovell/sharp) 和 [Pillow](https://github.com/python-pillow/Pillow)，保留各项目作者与许可证；开发工具不因被使用而成为本项目原创，也不表示全部随便携包分发。Electron、Chromium、Node.js 和 Python 的运行时原始许可随对应组件保留。

## 在线资料

Hi-Res Audio 标志由用户提供于 `art/Hi-Res_Audio_(logo).svg`，运行版原字节保留在 `public/audio-tech/hi-res.svg`。Hi-Res Audio 是日本音响协会（Japan Audio Society）的注册商标或商标，详见 [JAS 定义与商标说明](https://www.jas-audio.or.jp/hi-res/definition)。该素材不改授 MIT；界面依据原文件参数显示音源标识，不表示本播放器或输出设备取得 JAS 认证。

DSD 标志由用户提供于 `art/DSDlogo.svg`，运行版原字节保留在 `public/audio-tech/dsd.svg`。标志及其原有权利不改授 MIT；亮暗配色和扫光使用原 SVG 透明轮廓。

Wikipedia 摘要、Wikidata、MusicBrainz、QQ 音乐和网易云音乐的内容按各自来源权利与条款处理。专辑资料编辑器只在用户选择并保存后把介绍写入本机曲库索引、把封面写入本机用户数据缓存；候选介绍来源可保留来源链接、许可和取得时间。用户的在线资料与封面缓存不纳入项目 MIT 授权，也不随项目源码或发布包分发。MusicBrainz 将核心数据和补充数据分别授权，详见[官方数据许可](https://musicbrainz.org/doc/About/Data_License)；不能仅因为程序开源就统一将数据改授 MIT。

如发现署名遗漏或具体权利问题，请通过本仓库 [Issues](https://github.com/laxy-vac/Rhine-Music/issues) 提供涉及文件、来源及说明，维护者可据此核对。
