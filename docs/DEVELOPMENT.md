# 开发接手指南

## 1. 环境与入口

唯一源码仓库使用当前 `main`；先查看 `git status`，保留未提交工作。环境为 Node.js 24+、npm 锁定依赖、TypeScript/Vite。Windows 桌面使用 Electron，原生主机使用已有 Zig/C++ 工具链。

```powershell
npm run dev             # 前端开发
npm run music           # 本地音乐服务
npm run build           # 类型检查、前端与离线资源构建，输出 dist/
npm run build:source    # 只构建源码调试界面
npm run desktop         # 启动已有桌面源码构建
npm run build:native    # 构建原生音频及 LSP
npm run build:sony      # 构建 Sony x86 桥接
npm run package:windows # 使用已经准备好的组件生成 Windows 安装器
```

根目录保留 `构建源码验证.cmd` 和 `启动源码验证.cmd`。前者用项目内 Electron 提供的 Node 构建原生主机与界面；只改前端时可使用 `npm run build:source`。后者不构建、不安装、不扫描曲库，缺少输入时直接报错。

本机组件布局：

| 路径 | 用途 |
| --- | --- |
| `node_modules/` | 项目依赖；TagLib-Wasm 写回需要 Node 24+ |
| `.tools/source-preview-electron/` | 源码调试 Electron |
| `.tools/source-preview-interface/` | 调试界面；同级 manifest 记录来源 |
| `.tools/source-preview-native-audio/` | 调试音频主机、DLL 与来源清单 |
| `.tools/walkman/compiler/` | 已准备的 Zig |
| `.tools/audio-codecs/`、`.tools/lsp-eq/`、`.tools/lsp-plugin/` | 编解码与均衡器构建输入 |
| `release/.desktop-staging/` | Electron/Python 等运行时准备中间目录 |
| `.tools/installer-tools/nsis/3.13/nsis-3.13/` | Windows 安装器编译器 |
| `.tools/releases/` | 安装器载荷、报告和成品 |

新克隆不携带本机工具和依赖。`prepare-*`、`package-desktop.mjs` 等环境准备脚本可能下载文件或安装依赖，使用前先阅读脚本并取得明确授权；不能把它们当作普通启动步骤。`package-desktop.mjs` 为源码调试和安装器提供运行时 staging，日常发布入口是 `package:windows`。普通打包只检查和使用现有组件，不代为准备环境。

修改前端后重新构建，当前窗口可用 Ctrl+R 刷新。修改服务、宿主或预加载层后完整退出再启动。界面/原生来源清单不匹配时重建对应目标，不清个人缓存来绕过检查。

## 2. 代码地图

| 职责 | 入口 |
| --- | --- |
| 应用接线、路由和偏好 | `src/music-app.ts` |
| 状态、目录及布局身份 | `src/music-application-state.ts`、`src/music-catalog.ts`、`src/music-view-settings.ts` |
| 三维主场景和资源生命周期 | `src/scene.ts`、`src/music-scene-resources.ts`、`src/music-shelf.ts` |
| 布局、镜头、过渡 | `src/music-layout-*.ts`、`src/music-spatial-layout.ts` |
| 盒体、材质、印刷和图集 | `src/case-*.ts`、`src/rhine-album-info.ts`、`src/cover-atlas.ts` |
| 主题、日夜和通用控件 | `src/music-style.ts`、`src/future-appearance-picker.ts`、主题 CSS |
| 音乐库设置和分类 | `src/library-settings-navigation.ts`、`src/genre-rules-editor.ts`、`src/music-genre-rules.mjs` |
| 专辑/歌曲编辑 UI | `src/album-info-editor.ts`、`src/metadata-editor-types.ts` |
| 音乐库、资料来源、标签写回 | `scripts/music-library.mjs`、`scripts/album-info-sources.mjs`、`scripts/music-metadata-editor.mjs`、`scripts/metadata-tag-*.mjs` |
| 歌词、EQ、信号 | `src/lyrics-page.ts`、`src/eq-controls.ts`、`src/signal-page.ts` |
| 服务与音频链 | `scripts/music-server.mjs`、`scripts/native-output.mjs`、`scripts/sony-walkman.mjs` |
| 桌面宿主 | `desktop/main.cjs`、`desktop/preload.cjs`、窗口/GPU 模块 |
| 原生音频 | `native/audio-host.cpp` 及其头文件、`native/sony/`、`vendor/audio/` |
| 画质建议 | `src/quality-detection.ts`、`src/quality-benchmark-frame.ts`、`quality-benchmark.html` |

合成画质检测页是产品功能，不是历史测试产物。原版档案入口和相关内容/美术资源仍属于源码的一部分；`scripts/export-records.mjs` 在前端构建前更新可下载档案文本。

## 3. 共享状态和视觉约定

- 正式主题名为莱茵生命：映像 / Rhine Lab: Reflections，以及仿孤星 / Lone Trail–Inspired。内部主题值仍为 `rhine` / `archive`，盒体结构值 `punk` 和既有偏好键保持兼容。
- 两主题共用播放器、音乐库和渲染状态。公共布局值 `shelf/array/grid` 分别显示 ARRAY/MATRIX/GRID；切布局须保留选中项、分组、曲目身份和分页。
- 日夜全局共享。莱茵生命：映像提供暖昼/晴昼/深夜；仿孤星使用日间/深夜。主题切换不重置日夜、盒体、材质或个人预设；仿孤星首次默认霜白陶瓷。
- ARRAY/MATRIX 各保留原主光方向，MATRIX 左侧来光。浏览光场和 MATRIX 焦点固定在选片视窗；布局转换沿现有进度过渡，不追随专辑移动。
- 共享柔光环境预计算；保持原材质、玻璃透射、部件位置、封面深度和遮挡。修改美术源模型时同步导出、资源版本和来源清单。
- 仿孤星控件保持紧凑方角，莱茵生命：映像使用现有圆角玻璃控件。新控件优先复用主题规则，展开标题不得误套普通按钮皮肤。
- 动画、波动和滚字不因画质预设被关闭。减少动态效果按已有用户设置生效。

## 4. 音乐库和编辑规则

音乐库设置分为文件夹、分类与排列、专辑资料、资料来源。切页保留草稿；目录、分类与来源分别显式保存。分类规则只重归类本地索引，不能顺便修改音频标签。

资料源初始队列为 MusicBrainz → Wikipedia → 网易云 → QQ；MusicBrainz 需要有效联系邮箱。用户可添加来源并排序，未指定的专辑继承全局队列。逐层寻找可用介绍，同源多个结果先采用一个，允许在单专辑编辑里改选。全局更新默认保留手工介绍/来源指定；完全覆盖须显式确认，查询失败不能抹掉原内容，晚到请求不能覆盖更新的手工修改。

专辑介绍和封面保存于本机资料；歌曲标签由用户主动保存后写回文件。多艺人以独立值和顺序保存，首位为分类主唱。保留未知标签；封面按支持情况嵌入或保存为可读的同目录 sidecar。写回须校验并发外部修改，不能盲目覆盖。

## 5. 音频、歌词和数据

音频能力以真实解码、处理与提交格式报告，不推测 DAC 内部格式。未知精度不包装成更高位深；错误不能静默切设备、采样率或关闭处理。LSP 使用官方原生窗口。PCM 与 DSD/DoP 路径分开维护，原生源码和第三方源码/许可不能拆散。

歌词使用每曲 V3 容器，Local/Cloud 分别保存文本与偏移。用户显式选择优先；迟到自动查询不能覆盖新选择。导入只复制歌词，不能改删原文件；本地缺失后的云回退不改变用户偏好或混写偏移。

源码调试数据位于仓库外的 `music-data-source-preview/`。在 `source/<仓库>` 布局中，它位于工作区根：

- `desktop/`：桌面 profile、`preferences.json`。
- `music-data/`：曲库索引、封面与资料缓存。
- profile 旁 `presets/themes/`、`presets/eq/`：主题与 EQ 个人预设。

安装版使用安装目录中的 `data/` 与 `presets/`，不自动迁移源码 profile。歌词可使用用户指定的缓存目录。移除音乐目录、清理源码或卸载默认不删除原音乐和个人数据。

## 6. 美术、许可和交付

`art/` 保留模型工程和建模脚本；运行模型在 `public/assets/`，主题图像在 `src/assets/style/`。美术修改的导出操作与来源见 `art/README.md`；字体、音频、模型与第三方组件的权利以根 `NOTICE.md` 和各自许可证为准。

发布前至少完成 `npm run build` 和必要的原生构建。桌面打包校验源码、组件、许可和载荷，不捆绑曲库、凭据或用户预设。安装器使用普通用户权限，卸载只删除其清单内文件并默认保留数据。构建成功不等于实际设备、视觉或性能验收；这些按本次改动在用户环境验证。

不自动上传、推送或发布。构建产物放忽略目录，不进入仓库。开发中不另建历史阶段文档；更新本指南中的现行操作和约定即可。
