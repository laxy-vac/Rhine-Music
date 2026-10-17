# 本地开发

更新：2026-10-17。状态见[PROJECT-STATUS](PROJECT-STATUS.md)，优化范围见[OPTIMIZATION-BASELINE](OPTIMIZATION-BASELINE.md)，权限与产品保护点见[AGENTS](../AGENTS.md)。

## 工作目录与启动

所有命令在本仓库 `Rhine-Music-Demo-AudioEnhanced` 根目录执行。日常开发使用 `main`，修改前检查 Git 状态并保留用户工作。

```powershell
node scripts/build-source-preview.mjs --interface-only
.\启动源码验证.cmd
```

等价 npm 入口为 `npm run build:preview` 与 `npm run desktop`。界面包含 TypeScript/Vite 构建，输出 `.tools/source-preview-interface` 和来源清单，不覆盖上游 `dist`。

修改桌面宿主、预加载层、服务或原生组件时使用 `构建源码验证.cmd`（核心是 `node scripts/build-source-preview.mjs`）。复用已有组件；缺项先说明，不自动下载或安装。

- 源码入口不会自动构建、准备工具或扫描曲库；修改后先完成相应构建。
- desktop/服务读取当前源码，前端优先使用 `.tools/source-preview-interface`，指纹不一致会拒绝启动。
- 调试界面缺失时仍有旧 `dist` 回退；它不能代表新版，先补当前构建。
- 磁盘修改不会替换旧窗口内存或已载入模型。构建后完整退出并重开窗口。
- 窗口在后台初始化与首帧就绪后首次显示；已显示窗口重载保持可见，无旧加载页或 Punk intro。
- Future 的 ALBUMS/MATRIX 默认每次新开窗口在显示后播放入场并停在总览；按钮、Enter、Esc 可跳过。设置 → 界面与交互 → 终端入场可配置自动播放、欢迎文案与 ID 或手动重播；Punk 保留禁用入口。两主题的 STYLE 页面只管理主题、日夜配色、文字字号、盒体与场景外观预览。
- Settings → 界面与交互管理语言、减少动态、唱片波动、入场和界面声音；Settings → 显示与性能管理窗口比例、全屏、渲染画质、优先显卡与性能检测。各项控件只出现于对应类别，Style 页面不重复这些设置。显卡选择完全退出并重开后生效；默认自动，设备按物理 PnP 身份归并，不安装工具或改系统配置。若选卡后无法正常启动，可运行 `node scripts/launch-source-preview.mjs --gpu-auto` 仅本次使用自动，再到 Settings → 显示与性能选择自动恢复默认；安装版也接受 `--gpu-auto` 启动参数。
- Future 的 STYLE → LIGHT 下可选“暖白 / 原版”，选择随 Future 主题档案保存；切 DARK 或 Punk 不覆盖它。旧偏好缺少此字段时保持暖白。`node scripts/check-day-palette.mjs` 检查规范化/保存结构和颜色映射；`node desktop/check-startup-entry.cjs --graphics` 包含双层胶囊、颜色过渡、键盘/焦点和日夜/Punk 隔离检查。
- Future 的 STYLE → 简单粗糙提供玻璃透光率、磨砂度调节，实时预览并保存；封面和金边保持独立。“恢复玻璃默认设置”只恢复主体与背板的这两项参数，保留其他材质与结构设置。

`启动音乐播放器.bat`、`.command`及其旧 launcher 保留兼容测试引用，不是当前开发入口。`Build-Windows-EXE.cmd`是当前品尝版打包的兼容包装。

## 现有环境与产物

| 内容 | 位置 |
| --- | --- |
| 项目依赖 | `node_modules/` |
| Electron 运行时 | `.tools/source-preview-electron` |
| 前端、指纹、Vite缓存 | `.tools/source-preview-interface`、同名前缀 manifest、`.tools/source-preview-vite-cache` |
| 原生主机与复制 DLL | `.tools/source-preview-native-audio` |
| PCM 解码组件 | `.tools/audio-codecs`、`vendor/audio/codec-sdk` |
| LSP 工具 | `.tools/lsp-plugin` |
| Zig 编译器与缓存 | `.tools/walkman/compiler/zig-x86_64-windows-0.15.2`、`.tools/zig-cache` |
| 安装器工具 | `.tools/installer-tools/nsis/3.13/nsis-3.13` |
| 任务日志和临时产物 | 项目专用 `.tools/<任务名>`；工作区临时文件按已有规范放置 |

以上是已有落点，不是安装授权。prepare/runtime/codec/LSP 等准备脚本可能联网或改变环境，不能作为普通接手步骤；新克隆缺少本机环境时先取得用户批准。不要改全局 PATH、共享依赖、注册表、服务、权限或安全机制。

## 数据位置与保护

源码启动器在 `source/<仓库>` 布局下使用工作区根的 `music-data-source-preview`；其他布局使用仓库父目录下同名目录。路径由 `scripts/launch-source-preview.mjs`计算，不通过文档猜测或自动迁移。

| 内容 | 位置/规则 |
| --- | --- |
| 桌面 profile | `music-data-source-preview/desktop` |
| 偏好 | profile 的 `preferences.json`；全局日夜、跟随系统、画质、比例、减少动态、唱片波动、公共 view 与主题配置 |
| 索引、封面与默认缓存 | `music-data-source-preview/music-data` |
| 主题个人预设 | profile 旁 `presets/themes/theme-presets.json`；Future/Punk 两库独立 |
| 入门 EQ 文件 | 默认 profile 旁 `presets/eq/standard`，用户可主动选择目录 |
| EQ 目录配置 | profile 的 `standard-eq-library.json` |
| LSP/旧 EQ 聚合预设 | profile 旁 `presets/eq/audio-processing-presets.json`；兼容读取保留 |
| 歌词 | 用户指定缓存目录；每曲 SHA-256 命名 V3 容器，独立 Local/Cloud bank，详见[歌词](LYRICS.md) |
| 安装版 | `<安装目录>/data` 与 `<安装目录>/presets`，与源码 profile 分开 |

目录移除不删除音乐。歌词导入只复制文本，不接收原始路径或改删原文件；偏移写对应缓存 bank。坏文件、外部编辑和未知文件不能被自动覆盖。缓存路径调整不自动搬运文件；Git 回滚不会迁移或降级个人数据。

## 验证与排查

`npm test`是默认有限离线检查；`--interface-only`包含类型检查与前端构建。按实际改动选择[优化基线的检查入口](OPTIMIZATION-BASELINE.md)，不为了补历史台账重复运行全套测试。

隔离 Electron/图形检查使用专用 profile、合成目录和 mock 音频，不能接入个人目录或真实音频设备。实际窗口、硬件、安装/卸载和性能验收分别记录。

Future 界面音效可用 `node scripts/check-interface-audio.mjs` 验证模拟设备路由、主题/播放互斥、迟到请求取消、WAV 校验及缓存上限。`node desktop/check-interface-audio.cjs` 使用既有 Electron 的隔离隐藏页验证真实离线合成及外部 sink 生命周期，不调用真实音频设备。原生会话检查须在本次命令进程内设置 `RHINE_NATIVE_TEST_MODE=mock-only` 再执行 `node --test scripts/check-native-output.mjs`；不加此设置的既有套件包含真实设备检查，不能作为默认离线命令。

Settings 分类、两主题 STYLE 页面、原生全屏往返及本机显卡枚举使用 `node desktop/check-startup-entry.cjs --graphics`。其中 `desktop/check-future-settings.mjs` 检查 Future 七类设置的桌面/窄窗布局、控件可达性与分组，并把日间两种配色、夜间及 Punk 对照截图保存到该次隔离目录的 `future-settings/`；`desktop/check-eq-sliders.mjs` 检查 Future 昼夜图形/参数 EQ 和高低音滑条的静态悬停、统一材质与横竖拖动，截图同样保存在该次隔离目录。`--graphics` 是兼容保留的 probe 参数名；显卡设置位于 Settings → 显示与性能。加 `--gpu-manual` 可在隔离配置中以可用物理卡启动，验证真实前端的手动选卡路径。纯偏好及身份/LUID 边界检查为 `node scripts/check-gpu-selection.cjs`。这些检查不接入个人曲库、播放设备或系统显卡设置。

看不到修改时，依次核对当前源码入口与主题、构建来源清单、是否完整退出旧窗口、模型内容版本与地址。模型变更须同步对应资源版本并重建；不要清个人缓存或重置偏好制造新版效果。

无窗口问题应检查完整生产前端的隐藏启动链路和日志；不能用简单 data 页面通过替代。性能问题按[优化基线](OPTIMIZATION-BASELINE.md)记录环境与分阶段测量，不凭平均 FPS 或合成推荐推断个人设备结论。

## 打包与源码导出

`npm run package:preview`或`打包品尝版.cmd`使用已准备工具生成安装器；`npm run export:source`生成交付 ZIP。两者不自动准备依赖或同步远程，打包不等于安装/设备验收。

本仓库是唯一活动源码。用户自行设置远程并只发布 `main`；ZIP 不用于建立第二份日常开发仓库。工具、个人配置、机器日志与原曲库不入库，许可与交付范围见[品尝版说明](PREVIEW-RELEASE.md)和[NOTICE](../NOTICE.md)。

## 历史与回滚

当前入口不保留已结束阶段计划或逐轮战报。按需读取整理前的文件：

```powershell
git show fc0790e:docs/PROJECT-STATUS.md
```

旧分支和标签保留本地，不自动合并或发布。回滚采用审阅后的 `git revert`，不用硬重置或强制检出；回滚源码后重建对应产物。不要通过删除缓存、降级歌词容器或覆盖用户预设来适配旧代码。
