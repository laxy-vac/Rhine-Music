# 版权、署名与资源来源

本说明区分代码授权、音乐适配的开发者署名和第三方素材的权利。公开源码不表示放弃版权，也不表示获得全部原作素材的再授权。

## 开发者与上游

| 范围 | 署名与来源 |
| --- | --- |
| 音乐播放器适配及后续修改 | **Copyright (c) 2026 RonaldDeng**。包括本地曲库与播放服务、音乐专辑模型适配、音乐界面、导航、相机交互、文字效果、响应式及版本维护中由本项目新增或修改的部分；不主张对未修改的上游代码或第三方素材享有原创权利。 |
| 原版 RhineLabUI | **Copyright (c) 2026 LBEILC**。[原仓库](https://github.com/LBEILC/RhineLabUI)，初始基于提交 [`5abab02367465d9189f4ae65bcb6f17fdb5938f7`](https://github.com/LBEILC/RhineLabUI/tree/5abab02367465d9189f4ae65bcb6f17fdb5938f7)。保留其三维档案界面、渲染与动效基础、建模脚本、资料说明和 Git 历史。 |

有权授权的程序代码、建模脚本和技术文档沿用 [MIT License](LICENSE)，保留以上两项署名。分发代码或其重要部分时须一并保留版权声明及完整许可证；适配者的署名不取代上游署名。MIT 允许使用、修改及商业分发，软件按原样提供；本说明不在 MIT 上另加用途限制。具体以许可证原文为准，参见 [MIT 许可说明](https://choosealicense.com/licenses/mit/)。

[README.original.md](README.original.md) 保留上游原说明，其中“本项目”“原创”等措辞归属于该上游文档的语境。RonaldDeng 不代表 LBEILC，音乐适配不表示上游作者参与、认可或为本衍生版本提供支持。

MATRIX 鼠标拖动、惯性和悬停适配参考上游的 [archive-drag.ts](https://github.com/LBEILC/RhineLabUI/blob/main/src/archive-drag.ts) 与 [scene.ts](https://github.com/LBEILC/RhineLabUI/blob/main/src/scene.ts)，沿用其投影与运动参数。两排列之间的迁移及 Future ARRAY 入场后半段为本播放器新增设计，仍使用现有共享场景和盒体资源。

## 原作及非代码资产

视觉参考为《明日方舟》特别映像[「莱茵生命：访问」](https://www.bilibili.com/video/BV1rr4y1b7sz/)。相关作品、名称、标志、设定、视觉设计、原 PV 及其声音的权利归相应权利人所有。本项目是独立爱好者工程，与官方制作方无隶属、赞助或授权合作关系，不主张拥有原作版权或商标。

- `art/*.blend`、`public/assets/*.glb`、界面图标、截图、动图及原作相关演示文本**不因代码采用 MIT 而自动获得原作素材许可**。上游未另行将全部非代码资产声明为 MIT；建模脚本的 MIT 授权也不等于原作相关视觉元素可任意再分发。
- `public/audio/atmosphere.ogg`、`motif.ogg`、`pulse.ogg` 和 `observatory-preview.mp3` 为继承自上游的程序编配，按其[音频说明](public/audio/README.md)随项目采用 LICENSE；不将其重新署名为音乐适配者原创。
- `public/audio/typing-preview.wav` 与 `src/typing-samples.ts` 的三个 38ms 短音来自上述原 PV，来源、时间码及处理记录见 [typing-source.json](public/audio/typing-source.json)。**这些采样不属于 MIT 授权范围；来源标注不是原权利人的再分发许可。** 本项目不能为复用者授予相应权利。仅用于本地比对的 `reference/typing-original.wav` 不随本次源码快照和 ZIP 分发；旧 Git 历史未重写。
- [演示封面](public/demo-covers/README.md)是本项目早期音乐适配阶段生成的三张抽象图像，当前文档用它们演示界面，不冒充真实唱片或音乐库。V0.2.0 历史截图由该版本运行画面采集，V0.3.0 界面回归截图使用隔离示例库采集；截图不改变其中字体、模型与原作元素各自的权利。
- 真实歌曲、商业专辑封面、私人曲库索引、缓存和在线介绍不随本仓库及发布包分发。

代码复用者可替换这些资产；使用或再分发涉及第三方权利的内容时，需另行遵守对应许可或取得必要授权。本文件不作“全部资源已获商业授权”的保证。

## 字体与运行依赖

| 组件 | 权利人与许可 | 随包文本 |
| --- | --- | --- |
| MiSans | 小米／Beijing Xiaomi Mobile Software Co., Ltd.，按 MiSans 字体协议随应用原样嵌入；不是 MIT，不将字体作为独立商品或字体包发布 | [署名](public/fonts/NOTICE.txt)、[完整字体协议](public/fonts/MiSans-license.pdf) |
| Three.js | three.js authors，MIT | [three.txt](public/licenses/three.txt) |
| RhinE / Audio Archive 主题 | the Audio Archive authors，MIT；10 盒型、货架/地面、10 套开场预渲染片源、配色 token 与界面绘制/交互的移植。没有复制 foobar2000 组件 | [原始许可](public/licenses/audio-archive-style-mit.txt)、[来源与移植边界](docs/FOOBAR-STYLE-SOURCES.md) |
| Geist Mono | Vercel, Inc. 与字体作者，SIL Open Font License 1.1；从本地主题包原样嵌入应用，未安装系统字体 | [OFL 原文](public/licenses/geistmono-ofl.txt) |
| Rolling Number | Kit Langton，MIT | [rolling-number.txt](public/licenses/rolling-number.txt) |
| music-metadata | Borewit，MIT | [music-metadata.txt](public/licenses/music-metadata.txt) |
| OpenCC-JS | nk2028，MIT；所用 OpenCC 字典数据另受 Apache-2.0 约束 | [MIT](public/licenses/opencc-js.txt)、[第三方说明](public/licenses/opencc-js-third-party.md)、[Apache-2.0](public/licenses/apache-2.0.txt) |
| basic-ftp | Patrick Juchli，MIT | [basic-ftp.txt](public/licenses/basic-ftp.txt) |
| taglib-wasm 2.4.0 | Charles Wiltgen；TypeScript／JavaScript 代码采用 MIT。其 WebAssembly 二进制包含 TagLib，按该包许可说明采用 LGPL-2.1-or-later。包的许可文件将 TagLib 源码指向其仓库 `lib/taglib/`；已安装 npm 包标明 TagLib-Wasm 版本为 2.4.0，但没有标出嵌入的 TagLib 精确修订版。[TagLib-Wasm 仓库](https://github.com/CharlesWiltgen/TagLib-Wasm)；上游 TagLib 仓库：[taglib/taglib](https://github.com/taglib/taglib) | [完整包许可与附加说明](public/licenses/taglib-wasm-license.txt)、[TagLib 官方 LGPL-2.1 原文](public/licenses/taglib-lgpl-2.1.txt) |
| @msgpack/msgpack 3.1.3（TagLib-Wasm 运行依赖） | MessagePack Community，ISC；[官方仓库](https://github.com/msgpack/msgpack-javascript) | [msgpack.txt](public/licenses/msgpack.txt) |

这些文本保留依赖包原文；TagLib LGPL 文本于 2026-10-22 从官方 `taglib/taglib` 仓库 `master/COPYING.LGPL` 获取。完整版本树见 `package-lock.json`；其他构建工具和间接依赖按安装包各自的 LICENSE / NOTICE 使用，不被本项目重新授权。

当前源码树尚未打包或发布包含 TagLib-Wasm 二进制的安装器。本仓库保留许可文本和来源说明，不表示未来二进制分发义务已经完成。若分发包含这些 WASM 二进制的产品，发布前须按 LGPL-2.1-or-later 提供适用的完整对应源代码、修改与构建脚本或其他许可允许的获取方式，并提供用户以修改后的 TagLib 重新链接或替换该 WASM 库的实际途径；TagLib 及其修改不由项目 MIT 重新授权。

本私有增强副本按用户 2026-10-07 的明确要求保留九个 Sony 原版音频运行文件于 `vendor/sony-walkman/`，并纳入独立 EXE；这些音频库、模型、运行库和参数不改授 MIT。用户提供的 `art/DSEE_LOGO.avif`、`art/S-MASTER.webp`、`art/vinyl.png` 及描摹的 `public/audio-tech/*.svg` 保留原权利；Sony 标志不表示本项目获 Sony 认证。来源、哈希与验证边界见 [Sony 桥接说明](docs/SONY-WALKMAN.md)。本轮未公开发布这些组件。

Sony 音效由 `Sony Corporation` 提供。DSEE、S-MASTER 是 `Sony Corporation` 的商标。

© 2026 Sony Corporation

`native/sony/generated/` 是根据 Sony 原版 ARM 指令生成的 C++ 转写，原模型、参数和相关派生代码不改授 MIT。Windows 播放执行 `sony-dsp-x86.dll`；[Unicorn](https://github.com/unicorn-engine/unicorn) 2.1.4 用于原 ARM 对照及保留的参考路径。wheel 元数据声明 Python 绑定为 BSD，原生内核为 GPL-2.0；原版 COPYING、LGPL／GLib 说明及完整固定版本源归档保存在 `vendor/licenses/unicorn/`。嵌入式 Python、Electron 与内置 Chromium／Node 的原 LICENSE 和第三方说明随运行时保留；固定下载来源见 [runtime-assets.json](desktop/runtime-assets.json)。

当前 Windows PCM 音乐解码使用 FFmpeg；FLAC 直接使用 libFLAC。FFmpeg 采用固定 BtbN Windows x64 LGPL shared 构建（其实际许可为 LGPL-3.0-or-later），libFLAC 1.5.0 采用 Xiph BSD-3-Clause 类许可，SoX/libsoxr 0.1.3 采用 LGPL-2.1-or-later；组件不改授本项目 MIT。[固定来源与哈希](vendor/audio/codec-components.json)、[FFmpeg许可](vendor/audio/codec-sdk/licenses/FFmpeg-LICENSE.txt)、[libFLAC许可](vendor/audio/codec-sdk/licenses/libFLAC-COPYING.Xiph)、[libsoxr许可](vendor/audio/codec-sdk/licenses/libsoxr-LICENCE)随SDK保留。动态运行库及构建缓存只位于项目.tools，本轮未制作或公开分发最终包；最终分发须保留对应许可、来源和适用源码义务。

Windows 的独立 DSD／ASIO 模块仍使用 Un4seen BASS、BASSASIO、BASSDSD；BASSFLAC/BASSOPUS仅为上游历史文件，不再加载作PCM解码，源码验证生成目录去除其已核验副本。Un4seen组件适用各自条款，不是项目MIT许可；原文位于 [licenses](vendor/audio/windows-x64/licenses)。C++ JSON头使用nlohmann/json3.12.0，MIT文本保留于同目录。上游原生模块来源与固定哈希位于 [assets.json](vendor/audio/windows-x64/assets.json)。

PCM 均衡器与音调使用 [iir1](https://github.com/berndporr/iir1)，保留其 [MIT 许可证与署名](vendor/audio/iir1/COPYING)。高精度重采样使用 [r8brain-free-src](https://github.com/avaneev/r8brain-free-src) 7.6，Copyright (c) 2013–2026 Aleksey Vaneev，保留其 [MIT 许可证](vendor/audio/r8brain/LICENSE)。Sample rate converter designed by Aleksey Vaneev of Voxengo. 固定提交、来源与逐文件 SHA-256 记录于 [open-components.json](vendor/audio/open-components.json)；采用 Ooura FFT 头文件实现，未引入 PFFFT。源码随本地 Git 记录保存，后续分发音频主机时须同时保留上述许可证。

## 在线资料

Hi-Res Audio 标志由用户提供于 `art/Hi-Res_Audio_(logo).svg`，运行版原字节保留在 `public/audio-tech/hi-res.svg`。Hi-Res Audio 是日本音响协会（Japan Audio Society）的注册商标或商标，详见 [JAS 定义与商标说明](https://www.jas-audio.or.jp/hi-res/definition)。该素材不改授 MIT；界面依据原文件参数显示音源标识，不表示本播放器或输出设备取得 JAS 认证。

DSD 标志由用户提供于 `art/DSDlogo.svg`，运行版原字节保留在 `public/audio-tech/dsd.svg`。标志及其原有权利不改授 MIT；亮暗配色和扫光使用原 SVG 透明轮廓。

Wikipedia 摘要、Wikidata、MusicBrainz、QQ 音乐和网易云音乐的内容按各自来源权利与条款处理。专辑资料编辑器只在用户选择并保存后把介绍写入本机曲库索引、把封面写入本机用户数据缓存；候选介绍来源可保留来源链接、许可和取得时间。用户的在线资料与封面缓存不纳入项目 MIT 授权，也不随项目源码或发布包分发。MusicBrainz 将核心数据和补充数据分别授权，详见[官方数据许可](https://musicbrainz.org/doc/About/Data_License)；不能仅因为程序开源就统一将数据改授 MIT。

如发现署名遗漏或具体权利问题，请通过本仓库 [Issues](https://github.com/RonaldDeng/Rhine-Music-Demo/issues) 提供涉及文件、来源及说明，维护者可据此核对。
