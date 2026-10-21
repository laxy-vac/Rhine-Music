# 本地开发

更新：2026-10-22。功能见 [PROJECT-STATUS](PROJECT-STATUS.md)，下一阶段见 [OPTIMIZATION-BASELINE](OPTIMIZATION-BASELINE.md)，权限和保护点见 [AGENTS](../AGENTS.md)。

## 源码与启动

工作区：`D:\CodexLocalWorkContent\PersonalMusicPlayer`。唯一活动仓库：`source\Rhine-Music-Demo-AudioEnhanced`，当前分支 `main`。所有项目命令在仓库根执行，先查看 Git 状态并保留用户改动。

```powershell
node scripts/build-source-preview.mjs --interface-only
.\启动源码验证.cmd
```

`--interface-only` 只执行现有项目的 TypeScript/Vite，输出 `.tools/source-preview-interface` 及来源清单，不运行包管理器或原生组件准备。等价入口为 `npm run build:preview` 与 `npm run desktop`。

修改宿主、预加载层、服务或原生组件时按需要使用 `构建源码验证.cmd`，核心为 `node scripts/build-source-preview.mjs`；缺组件先说明，不自动安装、下载或修复环境。

- 启动器不会自动构建、准备工具或扫描曲库；前端优先使用源码预览，并检查指纹。
- `.tools/source-preview-interface` 缺失时可能回退旧 `dist`，不能把它当成新版。
- 磁盘修改不替换旧窗口内存；必要构建后完整退出并重开。
- 当前源码预览保留 `435e404` 的性能优化，并包含共享预计算柔光反射、Future 夜间光场调整和 Punk 顶屏移除；完整安装包尚未重打，性能条件与对照见 [OPTIMIZATION-BASELINE](OPTIMIZATION-BASELINE.md)。
- 窗口首次显示受初始化/首帧门控制；已显示窗口重载保持可见。Future 入场可跳过，Punk 不播放入场。
- `启动音乐播放器.bat`、`.command` 与旧 launcher 仅保留兼容引用，不是日常开发入口。

## 既有环境

| 内容 | 位置 |
| --- | --- |
| 项目依赖 | `node_modules/`；元数据写回使用 `taglib-wasm` 2.4.0，`@msgpack/msgpack` 3.1.3 为其运行依赖 |
| Electron | `.tools/source-preview-electron` |
| 前端、指纹、Vite cache | `.tools/source-preview-interface`、`.tools/source-preview-interface.manifest.json`、`.tools/source-preview-vite-cache` |
| 原生主机/DLL | `.tools/source-preview-native-audio` |
| PCM 解码组件 | `.tools/audio-codecs`、`vendor/audio/codec-sdk` |
| LSP | `.tools/lsp-plugin` |
| Zig 与缓存 | `.tools/walkman/compiler/zig-x86_64-windows-0.15.2`、`.tools/zig-cache` |
| 安装器工具 | `.tools/installer-tools/nsis/3.13/nsis-3.13` |
| 临时测量与报告 | 专用 `.tools/<任务名>`，不进入源码交付 |

这些位置不构成安装或变更授权。prepare/runtime/codec/LSP 等脚本可能联网、下载或修改环境，不能当作普通接手步骤。缺少 Node、依赖或桌面组件时报告，不自动执行 pnpm/npm install、恢复缓存或修改 PATH/全局配置。

## 个人数据

源码启动器在 `source/<仓库>` 布局下使用工作区根的 `music-data-source-preview`；其他布局使用仓库父目录下同名目录。最终路径由 `scripts/launch-source-preview.mjs` 计算，不自动迁移。

| 内容 | 位置/规则 |
| --- | --- |
| 桌面 profile、偏好 | `music-data-source-preview/desktop`；`preferences.json` |
| 索引、封面与默认缓存 | `music-data-source-preview/music-data` |
| 主题预设 | profile 旁 `presets/themes/theme-presets.json`，两主题独立 |
| EQ | profile 旁 `presets/eq/standard`、`standard-eq-library.json`、兼容聚合预设 |
| 歌词 | 用户指定缓存目录，每曲 SHA-256 的 V3 容器，Local/Cloud 双 bank，见 [LYRICS](LYRICS.md) |
| 安装版 | 安装目录中的 `data` 与 `presets`，与源码 profile 独立 |

目录移除不删除音乐；歌词导入只复制文本。坏文件、外部编辑和未知文件不能自动覆盖。性能优化、文档清理或 Git 回滚均不能清个人数据、重置预设或迁移缓存来制造结果。

## 必要检查与排查

`--interface-only` 包含类型检查和前端构建；其它检查按 [优化基线](OPTIMIZATION-BASELINE.md) 选择。只做与改动直接相关的有限验证，视觉效果交用户，不默认多轮自动审查或大截图矩阵。

专辑资料与歌曲标签编辑的后端定向检查入口为 `npm run check:metadata`。UI 操作检查先构建源码预览并启动桌面源码：`npm run build:preview` 后运行 `npm run desktop`，也可按上文使用 `启动源码验证.cmd`。TagLib-Wasm 的 Node WASI 后端要求 Node.js 24 或更新版本；所需包已在项目依赖目录，缺少时先报告，不运行安装或升级命令。验收场景见 [METADATA-EDITOR](METADATA-EDITOR.md#检查入口)。

浏览照明的有限回归为 `node --experimental-strip-types scripts/check-music-lighting.mjs`，覆盖两种布局旧版光线方向、固定光场/补光、缓存幂等、布局桥接和既有阴影设置；镜头纯检查为 `node scripts/check-music-camera.mjs`。隔离逐帧灯位、对焦点及性能对照在本机忽略目录 `.tools/performance-window-lighting-20261018/`。

既有整窗探针使用独立 profile、合成目录和 mock 音频，不能代替个人曲库、设备或硬件性能测量。音频原生检查先在本次命令进程内设置 `RHINE_NATIVE_TEST_MODE=mock-only`；不带此设置的既有套件可能访问真实设备，不能默认运行。

实际运行性能应记录真实帧间隔、环境和操作；现有 `stats().frameTime` 是场景时钟。当前没有整机性能基准报告，旧动效 ready 时间、截图 FPS 和通过数都不能用于判断掉帧原因。

看不到修改时先检查源码入口、主题、来源清单、是否重开窗口和模型版本。不要清个人缓存或重置偏好。显卡选择需完全退出后重启；可用 `node scripts/launch-source-preview.mjs --gpu-auto` 仅本次自动选卡，再由用户调整 Settings 偏好。

## 交付与历史

`npm run package:preview` / `打包品尝版.cmd` 使用已有工具生成安装器；`npm run export:source` 导出源码 ZIP。两者不会自动准备依赖；打包不等于安装或设备验收。当前旧安装器未因源码变化更新。

只维护当前仓库 `main`，不恢复第二套活动源码。远程发布由用户处理，不自动 fetch/pull/push。历史试验、旧顶屏方案和专项验收脚本从 Git 按需追溯；本轮删除的忽略目录合成报告未纳入 Git，不承诺恢复。回滚用审阅后的 `git revert`，不硬重置、不强制检出或迁移个人数据。来源与许可始终见 [NOTICE](../NOTICE.md)。
